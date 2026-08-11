import { Controller, Get } from "@nestjs/common";

@Controller("healthz")
export class HealthController {
  @Get()
  getHealth(): { ok: true } {
    return { ok: true };
  }
}
