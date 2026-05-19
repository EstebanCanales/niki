import { Inject, Injectable } from "@nestjs/common";

import { AppConfigService } from "../common/app-config.service";
import { RuntimeStateService } from "../common/runtime-state.service";

@Injectable()
export class HealthService {
  constructor(
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
    @Inject(RuntimeStateService)
    private readonly runtimeState: RuntimeStateService,
  ) {}

  status() {
    const config = this.configService.get();
    const infra = this.configService.infraStatus();
    const state = this.runtimeState.snapshot();

    return {
      ok: true,
      service: config.appName,
      environment: config.environment,
      transport: "nestjs-regulated-core",
      infra,
      counts: {
        users: state.users.length,
        sessions: state.sessions.length,
        auditEvents: state.auditEvents.length,
      },
    };
  }
}
