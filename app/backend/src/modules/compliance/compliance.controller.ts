import { Controller, Get, Inject, Param, Req } from "@nestjs/common";
import type { Request } from "express";

import { ComplianceService } from "./compliance.service";

@Controller("internal/compliance")
export class ComplianceController {
  constructor(
    @Inject(ComplianceService)
    private readonly complianceService: ComplianceService,
  ) {}

  @Get("profiles/:userId")
  profile(@Param("userId") userId: string, @Req() req: Request) {
    this.complianceService.assertInternal(req);
    return this.complianceService.profile(userId);
  }
}
