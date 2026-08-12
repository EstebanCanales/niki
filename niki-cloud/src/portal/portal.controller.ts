import { BadRequestException, Controller, Get, Query, Req, UseGuards } from "@nestjs/common";

import { AuthenticatedRequest, SessionGuard } from "../auth/session.guard";
import { PortalService, UsagePeriod } from "./portal.service";

const USAGE_PERIODS = new Set<UsagePeriod>(["day", "week", "month"]);

@Controller("v1")
@UseGuards(SessionGuard)
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get("dashboard")
  getDashboard(@Req() request: AuthenticatedRequest) {
    return this.portal.getDashboard(request.user!.id);
  }

  @Get("usage")
  getUsage(
    @Req() request: AuthenticatedRequest,
    @Query("period") period = "month",
  ) {
    if (!USAGE_PERIODS.has(period as UsagePeriod)) {
      throw new BadRequestException("period must be day, week, or month");
    }
    return this.portal.getUsage(request.user!.id, period as UsagePeriod);
  }

  @Get("credits")
  getCredits(@Req() request: AuthenticatedRequest) {
    return this.portal.getCredits(request.user!.id);
  }
}
