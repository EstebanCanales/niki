import { Module } from "@nestjs/common";

import { ComplianceModule } from "../compliance/compliance.module";
import { AuditController } from "./audit.controller";
import { AuditService } from "./audit.service";

@Module({
  imports: [ComplianceModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
