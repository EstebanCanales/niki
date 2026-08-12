import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { ComputerModule } from "../computer/computer.module";
import { IdentityModule } from "../identity/identity.module";
import { WorkItemsModule } from "../work-items/work-items.module";
import { ConversationContextService } from "./conversation-context.service";
import { RuntimeController } from "./runtime.controller";
import { RuntimeService } from "./runtime.service";
import { RuntimeSurfaceIntentService } from "./runtime-surface-intent.service";

@Module({
  imports: [IdentityModule, AuditModule, WorkItemsModule, ComputerModule],
  controllers: [RuntimeController],
  providers: [RuntimeService, ConversationContextService, RuntimeSurfaceIntentService],
  exports: [RuntimeService, RuntimeSurfaceIntentService],
})
export class RuntimeModule {}
