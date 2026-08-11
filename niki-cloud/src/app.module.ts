import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { AppConfigService } from "./config/app-config.service";
import { PrismaService } from "./database/prisma.service";
import { HealthController } from "./health/health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (environment: Record<string, string | undefined>) => {
        const port = Number.parseInt(environment.PORT ?? "4001", 10);

        if (!environment.DATABASE_URL) {
          throw new Error("DATABASE_URL is required");
        }

        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error("PORT must be a valid port number");
        }

        return {
          DATABASE_URL: environment.DATABASE_URL,
          PORT: port,
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
