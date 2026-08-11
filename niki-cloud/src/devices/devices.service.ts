import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { randomBytes, randomInt } from "node:crypto";

import { AuthUser } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";

const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LINK_CODE_LENGTH = 6;
const LINK_CODE_EXPIRY_MS = 10 * 60 * 1000;

interface PendingDeviceLink {
  claimed: boolean;
  expiresAt: Date;
  userId: string;
}

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
  private readonly pendingLinks = new Map<string, PendingDeviceLink>();

  constructor(private readonly prisma: PrismaService) {}

  createLinkCode(user: AuthUser): { code: string; expiresAt: Date } {
    this.removeExpiredLinks();

    let code: string;
    do {
      code = Array.from({ length: LINK_CODE_LENGTH }, () =>
        LINK_CODE_ALPHABET[randomInt(0, LINK_CODE_ALPHABET.length)],
      ).join("");
    } while (this.pendingLinks.has(code));

    const expiresAt = new Date(Date.now() + LINK_CODE_EXPIRY_MS);
    this.pendingLinks.set(code, { claimed: false, expiresAt, userId: user.id });

    return { code, expiresAt };
  }

  async link(input: LinkDeviceInput): Promise<LinkedDeviceCredential> {
    const code = input.code.trim().toUpperCase();
    const pendingLink = this.pendingLinks.get(code);

    if (!pendingLink || pendingLink.claimed || pendingLink.expiresAt.getTime() <= Date.now()) {
      this.pendingLinks.delete(code);
      throw new UnauthorizedException("Invalid or expired device link code");
    }

    pendingLink.claimed = true;
    const secret = randomBytes(32).toString("hex");

    try {
      const device = await this.prisma.device.create({
        data: {
          userId: pendingLink.userId,
          name: input.name.trim(),
          platform: input.platform?.trim() || null,
          // The random credential is the HMAC key. It is never returned by another endpoint.
          secretHash: secret,
        },
        select: { id: true },
      });

      this.pendingLinks.delete(code);
      return { deviceId: device.id, secret };
    } catch (error) {
      pendingLink.claimed = false;
      throw error;
    }
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

  private removeExpiredLinks(): void {
    const now = Date.now();
    for (const [code, pendingLink] of this.pendingLinks) {
      if (pendingLink.expiresAt.getTime() <= now) {
        this.pendingLinks.delete(code);
      }
    }
  }
}
