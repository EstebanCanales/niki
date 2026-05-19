import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { IdentityModule } from "../identity/identity.module";
import { WorkItemsModule } from "../work-items/work-items.module";
import { ConversationContextService } from "./conversation-context.service";
import { RuntimeController } from "./runtime.controller";
import { RuntimeService } from "./runtime.service";

@Module({
  imports: [IdentityModule, AuditModule, WorkItemsModule],
  controllers: [RuntimeController],
  providers: [RuntimeService, ConversationContextService],
  exports: [RuntimeService],
})
export class RuntimeModule {}
