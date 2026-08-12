import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AppConfigService, decodeDeviceSecretEncryptionKey } from "./config/app-config.service";
import { PrismaService } from "./database/prisma.service";
import { AuthModule } from "./auth/auth.module";
import { DevicesModule } from "./devices/devices.module";
import { HealthController } from "./health/health.controller";
import { MeteringModule } from "./metering/metering.module";

@Module({
  imports: [
    AuthModule,
    DevicesModule,
    MeteringModule,
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (environment: Record<string, string | undefined>) => {
        const port = Number.parseInt(environment.PORT ?? "4001", 10);

        if (!environment.DATABASE_URL) {
          throw new Error("DATABASE_URL is required");
        }

        decodeDeviceSecretEncryptionKey(environment.DEVICE_SECRET_ENCRYPTION_KEY);

        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error("PORT must be a valid port number");
        }

        return {
          DATABASE_URL: environment.DATABASE_URL,
          DEVICE_SECRET_ENCRYPTION_KEY: environment.DEVICE_SECRET_ENCRYPTION_KEY,
          MAGIC_CODE_PEPPER: environment.MAGIC_CODE_PEPPER,
          MAIL_FROM: environment.MAIL_FROM,
          NIKI_CLOUD_DEV_AUTH: environment.NIKI_CLOUD_DEV_AUTH === "1",
          PORT: port,
          RESEND_API_KEY: environment.RESEND_API_KEY,
          SESSION_COOKIE_SECRET: environment.SESSION_COOKIE_SECRET,
          WEB_ORIGIN: environment.WEB_ORIGIN ?? "http://localhost:3001",
        };
      },
    }),
  ],
  controllers: [HealthController],
  providers: [AppConfigService, PrismaService],
  exports: [AppConfigService, PrismaService],
})
export class AppModule {}
