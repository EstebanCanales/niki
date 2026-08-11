import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { PrismaService } from "../database/prisma.service";
import { DevicesController } from "./devices.controller";
import { DevicesService } from "./devices.service";

@Module({
  imports: [AuthModule],
  controllers: [DevicesController],
  providers: [DevicesService, PrismaService],
  exports: [DevicesService],
})
export class DevicesModule {}
