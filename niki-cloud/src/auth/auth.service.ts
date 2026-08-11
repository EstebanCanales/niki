import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../database/prisma.service";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
}

const MAGIC_CODE_EXPIRY_MS = 10 * 60 * 1000;
const MAX_MAGIC_CODE_ATTEMPTS = 5;
const SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async joinWaitlist(email: string): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);

    await this.prisma.waitlistEntry.upsert({
      where: { emailNormalized: normalizedEmail },
      create: { email: normalizedEmail, emailNormalized: normalizedEmail },
      update: {},
    });
  }

  async issueMagicCode(email: string): Promise<string> {
    const normalizedEmail = this.normalizeEmail(email);
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");

    await this.prisma.magicCode.create({
      data: {
        emailNormalized: normalizedEmail,
        codeHash: this.hashMagicCode(code),
        expiresAt: new Date(Date.now() + MAGIC_CODE_EXPIRY_MS),
      },
    });

    return code;
  }

  async verifyMagicCode(email: string, code: string): Promise<AuthUser> {
    const normalizedEmail = this.normalizeEmail(email);
    const now = new Date();

    const user = await this.prisma.$transaction(async (transaction) => {
      const magicCode = await transaction.magicCode.findFirst({
        where: { emailNormalized: normalizedEmail, consumedAt: null },
        orderBy: { createdAt: "desc" },
      });

      if (
        !magicCode ||
        magicCode.expiresAt <= now ||
        magicCode.attemptCount >= MAX_MAGIC_CODE_ATTEMPTS
      ) {
        return null;
      }

      if (!this.matchesMagicCode(code, magicCode.codeHash)) {
        await transaction.magicCode.updateMany({
          where: {
            id: magicCode.id,
            consumedAt: null,
            attemptCount: { lt: MAX_MAGIC_CODE_ATTEMPTS },
          },
          data: { attemptCount: { increment: 1 } },
        });
        return null;
      }

      const consumed = await transaction.magicCode.updateMany({
        where: {
          id: magicCode.id,
          consumedAt: null,
          expiresAt: { gt: now },
          attemptCount: { lt: MAX_MAGIC_CODE_ATTEMPTS },
        },
        data: { consumedAt: now },
      });

      if (consumed.count !== 1) {
        return null;
      }

      return transaction.user.upsert({
        where: { email: normalizedEmail },
        create: { email: normalizedEmail },
        update: {},
        select: { id: true, email: true, displayName: true },
      });
    });

    if (!user) {
      throw new UnauthorizedException("Invalid or expired magic code");
    }

    return user;
  }

  async createUserForEmail(email: string): Promise<AuthUser> {
    const normalizedEmail = this.normalizeEmail(email);
    return this.prisma.user.upsert({
      where: { email: normalizedEmail },
      create: { email: normalizedEmail },
      update: {},
      select: { id: true, email: true, displayName: true },
    });
  }

  async createSession(user: AuthUser): Promise<string> {
    const token = randomBytes(32).toString("base64url");

    await this.prisma.webSession.create({
      data: {
        userId: user.id,
        tokenHash: this.hashSessionToken(token),
        expiresAt: new Date(Date.now() + SESSION_EXPIRY_MS),
      },
    });

    return token;
  }

  signSessionToken(token: string): string {
    return `${token}.${this.sign(token)}`;
  }

  async getUserForSignedSession(signedToken: string | undefined): Promise<AuthUser | null> {
    const token = this.getVerifiedSessionToken(signedToken);
    if (!token) {
      return null;
    }

    const session = await this.prisma.webSession.findFirst({
      where: {
        tokenHash: this.hashSessionToken(token),
        expiresAt: { gt: new Date() },
      },
      select: {
        user: { select: { id: true, email: true, displayName: true } },
      },
    });

    return session?.user ?? null;
  }

  async revokeSignedSession(signedToken: string | undefined): Promise<void> {
    const token = this.getVerifiedSessionToken(signedToken);
    if (!token) {
      return;
    }

    await this.prisma.webSession.deleteMany({
      where: { tokenHash: this.hashSessionToken(token) },
    });
  }

  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private hashMagicCode(code: string): string {
    return createHmac("sha256", this.config.magicCodePepper).update(code).digest("hex");
  }

  private matchesMagicCode(code: string, storedHash: string): boolean {
    const suppliedHash = this.hashMagicCode(code);
    return timingSafeEqual(Buffer.from(suppliedHash, "hex"), Buffer.from(storedHash, "hex"));
  }

  private hashSessionToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private sign(token: string): string {
    return createHmac("sha256", this.config.sessionCookieSecret).update(token).digest("base64url");
  }

  private getVerifiedSessionToken(signedToken: string | undefined): string | null {
    if (!signedToken) {
      return null;
    }

    const separator = signedToken.lastIndexOf(".");
    if (separator < 1) {
      return null;
    }

    const token = signedToken.slice(0, separator);
    const signature = signedToken.slice(separator + 1);
    const expectedSignature = this.sign(token);
    const suppliedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (suppliedBuffer.length !== expectedBuffer.length) {
      return null;
    }

    return timingSafeEqual(suppliedBuffer, expectedBuffer) ? token : null;
  }
}
