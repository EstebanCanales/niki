import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Request } from "express";

import { RuntimeStateService } from "../common/runtime-state.service";
import { AppConfigService } from "../common/app-config.service";
import { internalApiKeyFrom } from "../common/request-context";

@Injectable()
export class ComplianceService {
  constructor(
    @Inject(RuntimeStateService)
    private readonly runtimeState: RuntimeStateService,
    @Inject(AppConfigService)
    private readonly configService: AppConfigService,
  ) {}

  assertInternal(req: Request) {
    const expected = this.configService.get().internalApiKey;
    if (expected && internalApiKeyFrom(req) !== expected) {
      throw new ForbiddenException("invalid internal api key");
    }
  }

  profile(userId: string) {
    const profile = this.runtimeState.complianceFor(userId);
    if (!profile) {
      throw new NotFoundException("compliance profile not found");
    }
    return {
      ok: true,
      profile,
    };
  }
}
