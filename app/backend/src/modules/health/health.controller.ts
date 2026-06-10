import { Controller, Get, Inject } from "@nestjs/common";

import { HealthService } from "./health.service";

@Controller()
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get("internal/health")
  getHealth() {
    return this.healthService.status();
  }
}
