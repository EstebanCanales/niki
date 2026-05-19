import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { Request } from "express";

import { RuntimeService } from "./runtime.service";

@Controller("internal/runtime")
export class RuntimeController {
  constructor(
    @Inject(RuntimeService)
    private readonly runtimeService: RuntimeService,
  ) {}

  @Get("status")
  status(@Req() req: Request) {
    this.runtimeService.assertInternal(req);
    return this.runtimeService.status();
  }

  @Get("tools")
  tools(@Req() req: Request) {
    this.runtimeService.assertInternal(req);
    return this.runtimeService.listTools();
  }

  @Get("audit-summary")
  auditSummary(@Req() req: Request) {
    this.runtimeService.assertInternal(req);
    return this.runtimeService.generateAuditSummary();
  }
}
