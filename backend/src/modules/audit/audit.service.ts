import { Inject, Injectable } from "@nestjs/common";

import { RuntimeStateService } from "../common/runtime-state.service";

@Injectable()
export class AuditService {
  constructor(
    @Inject(RuntimeStateService)
    private readonly runtimeState: RuntimeStateService,
  ) {}

  activities(userId: string) {
    return {
      ok: true,
      activities: this.runtimeState.activitiesFor(userId),
    };
  }

  events() {
    return {
      ok: true,
      events: this.runtimeState.snapshot().auditEvents,
    };
  }
}
