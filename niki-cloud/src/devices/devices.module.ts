import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../database/prisma.service";
import { DeviceSecretEncryptionService } from "./device-secret-encryption.service";
import { DevicesController } from "./devices.controller";
import { DevicesService } from "./devices.service";

@Module({
  imports: [AuthModule],
  controllers: [DevicesController],
  providers: [
    DevicesService,
    PrismaService,
    AppConfigService,
    {
      provide: DeviceSecretEncryptionService,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new DeviceSecretEncryptionService(config.deviceSecretEncryptionKey),
    },
  ],
  exports: [DevicesService, DeviceSecretEncryptionService],
})
export class DevicesModule {}
