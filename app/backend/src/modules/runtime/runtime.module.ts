import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { ComputerModule } from "../computer/computer.module";
import { IdentidadModule } from "../identidad/identidad.module";
import { IdentityModule } from "../identity/identity.module";
import { WorkItemsModule } from "../work-items/work-items.module";
import { ConversationContextService } from "./conversation-context.service";
import { RuntimeController } from "./runtime.controller";
import { RuntimeService } from "./runtime.service";
import { RuntimeSurfaceIntentService } from "./runtime-surface-intent.service";
import { NikiVoiceRuntimeService } from "./niki-voice-runtime.service";
import { TurnRecorderService } from "./turn-recorder.service";

@Module({
  imports: [IdentityModule, AuditModule, WorkItemsModule, ComputerModule, IdentidadModule],
  controllers: [RuntimeController],
  providers: [RuntimeService, TurnRecorderService, ConversationContextService, RuntimeSurfaceIntentService, NikiVoiceRuntimeService],
  exports: [RuntimeService, TurnRecorderService, RuntimeSurfaceIntentService, NikiVoiceRuntimeService],
})
export class RuntimeModule {}
