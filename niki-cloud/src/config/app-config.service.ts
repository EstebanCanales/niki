import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

interface CloudEnvironment {
  DATABASE_URL: string;
  DEVICE_SECRET_ENCRYPTION_KEY?: string;
  MAGIC_CODE_PEPPER?: string;
  MAIL_FROM?: string;
  PORT: number;
  RESEND_API_KEY?: string;
  SESSION_COOKIE_SECRET?: string;
  NIKI_CLOUD_DEV_AUTH: boolean;
  WEB_ORIGIN: string;
}

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService<CloudEnvironment, true>) {}

  get databaseUrl(): string {
    return this.configService.getOrThrow("DATABASE_URL", { infer: true });
  }

  get deviceSecretEncryptionKey(): Buffer {
    return decodeDeviceSecretEncryptionKey(
      this.configService.get("DEVICE_SECRET_ENCRYPTION_KEY", { infer: true }),
    );
  }

  get magicCodePepper(): string {
    return this.getRequiredSecret("MAGIC_CODE_PEPPER");
  }

  get mailFrom(): string | undefined {
    return this.configService.get("MAIL_FROM", { infer: true });
  }

  get port(): number {
    return this.configService.getOrThrow("PORT", { infer: true });
  }

  get resendApiKey(): string | undefined {
    return this.configService.get("RESEND_API_KEY", { infer: true });
  }

  get sessionCookieSecret(): string {
    return this.getRequiredSecret("SESSION_COOKIE_SECRET");
  }

  get isDevAuthEnabled(): boolean {
    return this.configService.getOrThrow("NIKI_CLOUD_DEV_AUTH", { infer: true });
  }

  get webOrigin(): string {
    return this.configService.getOrThrow("WEB_ORIGIN", { infer: true });
  }

  private getRequiredSecret(name: "MAGIC_CODE_PEPPER" | "SESSION_COOKIE_SECRET"): string {
    const value = this.configService.get(name, { infer: true });

    if (!value) {
      throw new Error(`${name} is required for authentication`);
    }

    return value;
  }
}

export function decodeDeviceSecretEncryptionKey(value: string | undefined): Buffer {
  if (!value) {
    throw new Error("DEVICE_SECRET_ENCRYPTION_KEY is required");
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value) {
    throw new Error("DEVICE_SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }

  return decoded;
}
