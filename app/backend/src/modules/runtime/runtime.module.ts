import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { ComputerModule } from "../computer/computer.module";
import { IdentityModule } from "../identity/identity.module";
import { WorkItemsModule } from "../work-items/work-items.module";
import { ConversationContextService } from "./conversation-context.service";
import { GroqAgentService } from "./groq-agent.service";
import { RuntimeController } from "./runtime.controller";
import { RuntimeService } from "./runtime.service";

@Module({
  imports: [IdentityModule, AuditModule, WorkItemsModule, ComputerModule],
  controllers: [RuntimeController],
  providers: [RuntimeService, ConversationContextService, GroqAgentService],
  exports: [RuntimeService, GroqAgentService],
})
export class RuntimeModule {}
