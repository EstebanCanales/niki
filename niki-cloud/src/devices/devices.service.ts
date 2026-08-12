import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { DeviceLinkAttempt, Prisma } from "@prisma/client";
import { randomBytes, randomInt, randomUUID } from "node:crypto";

import { AuthUser } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { DeviceSecretEncryptionService } from "./device-secret-encryption.service";

const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LINK_CODE_LENGTH = 6;
const LINK_CODE_EXPIRY_MS = 10 * 60 * 1000;
const LINK_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const MAX_LINK_ATTEMPTS = 5;
const GENERIC_LINK_ERROR = "Invalid or expired device link code";

export interface LinkDeviceInput {
  code: string;
  name: string;
  platform?: string;
}

export interface LinkedDeviceCredential {
  deviceId: string;
  secret: string;
}

export interface DeviceView {
  id: string;
  name: string;
  platform: string | null;
  linkedAt: Date;
  revokedAt: Date | null;
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: DeviceSecretEncryptionService,
  ) {}

  async createLinkCode(user: AuthUser): Promise<{ code: string; expiresAt: Date }> {
    for (let collisionAttempt = 0; collisionAttempt < 10; collisionAttempt += 1) {
      const code = Array.from({ length: LINK_CODE_LENGTH }, () =>
        LINK_CODE_ALPHABET[randomInt(0, LINK_CODE_ALPHABET.length)],
      ).join("");
      const expiresAt = new Date(Date.now() + LINK_CODE_EXPIRY_MS);

      try {
        await this.prisma.deviceLinkCode.create({
          data: {
            userId: user.id,
            codeHash: this.secrets.hashLinkCode(code),
            expiresAt,
          },
        });
        return { code, expiresAt };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          continue;
        }
        throw error;
      }
    }

    throw new Error("Unable to allocate a unique device link code");
  }

  async link(input: LinkDeviceInput, origin = "unknown"): Promise<LinkedDeviceCredential> {
    const code = input.code.trim().toUpperCase();
    const codeHash = this.secrets.hashLinkCode(code);
    const originHash = this.secrets.hashLinkOrigin(origin);
    const now = new Date();

    const credential = await this.prisma.$transaction(async (transaction) => {
      const attemptBudget = await this.lockAttemptBudget(transaction, originHash, now);
      if (attemptBudget.lockedUntil && attemptBudget.lockedUntil > now) {
        return null;
      }

      const pendingLink = await transaction.deviceLinkCode.findUnique({ where: { codeHash } });
      if (
        !pendingLink ||
        pendingLink.claimedAt ||
        pendingLink.expiresAt <= now ||
        pendingLink.failedAttemptCount >= MAX_LINK_ATTEMPTS
      ) {
        if (pendingLink && !pendingLink.claimedAt) {
          const nextCodeFailure = pendingLink.failedAttemptCount + 1;
          await transaction.deviceLinkCode.update({
            where: { id: pendingLink.id },
            data: {
              failedAttemptCount: { increment: 1 },
              claimedAt: nextCodeFailure >= MAX_LINK_ATTEMPTS ? now : undefined,
            },
          });
        }
        await this.recordOriginFailure(transaction, attemptBudget, now);
        return null;
      }

      const claimed = await transaction.deviceLinkCode.updateMany({
        where: {
          id: pendingLink.id,
          claimedAt: null,
          expiresAt: { gt: now },
          failedAttemptCount: { lt: MAX_LINK_ATTEMPTS },
        },
        data: { claimedAt: now },
      });
      if (claimed.count !== 1) {
        await this.recordOriginFailure(transaction, attemptBudget, now);
        return null;
      }

      const deviceId = randomUUID();
      const secret = randomBytes(32).toString("hex");
      const encryptedSecret = this.secrets.encrypt(secret, deviceId);
      await transaction.device.create({
        data: {
          id: deviceId,
          userId: pendingLink.userId,
          name: input.name.trim(),
          platform: input.platform?.trim() || null,
          ...encryptedSecret,
        },
      });
      await transaction.deviceLinkAttempt.delete({ where: { originHash } });

      return { deviceId, secret };
    });

    if (!credential) {
      throw new UnauthorizedException(GENERIC_LINK_ERROR);
    }

    return credential;
  }

  list(user: AuthUser): Promise<DeviceView[]> {
    return this.prisma.device.findMany({
      where: { userId: user.id },
      orderBy: { linkedAt: "desc" },
      select: {
        id: true,
        name: true,
        platform: true,
        linkedAt: true,
        revokedAt: true,
      },
    });
  }

  async revoke(user: AuthUser, deviceId: string): Promise<void> {
    const result = await this.prisma.device.updateMany({
      where: { id: deviceId, userId: user.id },
      data: { revokedAt: new Date() },
    });

    if (result.count !== 1) {
      throw new NotFoundException("Device not found");
    }
  }

  private async lockAttemptBudget(
    transaction: Prisma.TransactionClient,
    originHash: string,
    now: Date,
  ): Promise<DeviceLinkAttempt> {
    await transaction.deviceLinkAttempt.upsert({
      where: { originHash },
      create: { originHash, windowStartedAt: now },
      update: {},
    });
    const [attemptBudget] = await transaction.$queryRaw<DeviceLinkAttempt[]>`
      SELECT *
      FROM "DeviceLinkAttempt"
      WHERE "originHash" = ${originHash}
      FOR UPDATE
    `;

    const windowExpired =
      attemptBudget.windowStartedAt.getTime() + LINK_ATTEMPT_WINDOW_MS <= now.getTime();
    const lockExpired = attemptBudget.lockedUntil && attemptBudget.lockedUntil <= now;
    if (windowExpired || lockExpired) {
      return transaction.deviceLinkAttempt.update({
        where: { originHash },
        data: {
          failedAttemptCount: 0,
          windowStartedAt: now,
          lockedUntil: null,
        },
      });
    }

    return attemptBudget;
  }

  private async recordOriginFailure(
    transaction: Prisma.TransactionClient,
    attemptBudget: DeviceLinkAttempt,
    now: Date,
  ): Promise<void> {
    const failedAttemptCount = attemptBudget.failedAttemptCount + 1;
    await transaction.deviceLinkAttempt.update({
      where: { originHash: attemptBudget.originHash },
      data: {
        failedAttemptCount,
        lockedUntil:
          failedAttemptCount >= MAX_LINK_ATTEMPTS
            ? new Date(now.getTime() + LINK_ATTEMPT_WINDOW_MS)
            : null,
      },
    });
  }
}
