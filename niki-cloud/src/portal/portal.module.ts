import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../database/prisma.service";
import { PortalController } from "./portal.controller";
import { PortalService } from "./portal.service";

@Module({
  imports: [AuthModule],
  controllers: [PortalController],
  providers: [PortalService, PrismaService],
  exports: [PortalService],
})
export class PortalModule {}
