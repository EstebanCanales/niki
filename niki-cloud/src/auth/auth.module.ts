import { Module } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../database/prisma.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { MailerService } from "./mailer.service";
import { SessionGuard } from "./session.guard";

@Module({
  controllers: [AuthController],
  providers: [AppConfigService, AuthService, MailerService, PrismaService, SessionGuard],
  exports: [AuthService, SessionGuard],
})
export class AuthModule {}
