import { Module } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../database/prisma.service";
import { AuthModule } from "../auth/auth.module";
import { MeteringModule } from "../metering/metering.module";
import { ContentCryptoService } from "./content-crypto.service";
import { ConversationsController } from "./conversations.controller";
import { ConversationsService } from "./conversations.service";

@Module({
  imports: [AuthModule, MeteringModule],
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    PrismaService,
    AppConfigService,
    {
      provide: ContentCryptoService,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new ContentCryptoService(config.conversationEncryptionKey),
    },
  ],
  exports: [ConversationsService],
})
export class ConversationsModule {}
