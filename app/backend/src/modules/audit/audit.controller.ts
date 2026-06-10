import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { Request } from "express";

import { actingUserIdFrom } from "../common/request-context";
import { ComplianceService } from "../compliance/compliance.service";
import { AuditService } from "./audit.service";

@Controller()
export class AuditController {
  constructor(
    @Inject(AuditService)
    private readonly auditService: AuditService,
    @Inject(ComplianceService)
    private readonly complianceService: ComplianceService,
  ) {}

  @Get("v1/activities")
  activities(@Req() req: Request) {
    return this.auditService.activities(actingUserIdFrom(req));
  }

  @Get("internal/audit/events")
  events(@Req() req: Request) {
    this.complianceService.assertInternal(req);
    return this.auditService.events();
  }
}
