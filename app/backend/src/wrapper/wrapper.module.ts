import { Module } from "@nestjs/common";

import { AuditModule } from "../modules/audit/audit.module";
import { ComputerModule } from "../modules/computer/computer.module";
import { TerminalModule } from "../modules/terminal/terminal.module";
import { IdentityModule } from "../modules/identity/identity.module";
import { RuntimeModule } from "../modules/runtime/runtime.module";
import { VoiceModule } from "../modules/voice/voice.module";
import { WrapperController } from "./wrapper.controller";
import { WrapperService } from "./wrapper.service";

@Module({
  imports: [RuntimeModule, IdentityModule, AuditModule, VoiceModule, ComputerModule, TerminalModule],
  controllers: [WrapperController],
  providers: [WrapperService],
  exports: [WrapperService],
})
export class WrapperModule {}
