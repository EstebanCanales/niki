import { Module } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service";
import { DeviceSignatureService } from "./device-signature.service";
import { MeteringController } from "./metering.controller";
import { MeteringService } from "./metering.service";

@Module({
  controllers: [MeteringController],
  providers: [DeviceSignatureService, MeteringService, PrismaService],
  exports: [DeviceSignatureService, MeteringService],
})
export class MeteringModule {}
