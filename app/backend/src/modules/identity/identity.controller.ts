import { Body, Controller, Get, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";

import type { LoginRequest, VerifyMfaRequest } from "../../domain/contracts";
import { actingUserIdFrom, correlationIdFrom } from "../common/request-context";
import { IdentityService } from "./identity.service";

@Controller("v1")
export class IdentityController {
  constructor(
    @Inject(IdentityService)
    private readonly identityService: IdentityService,
  ) {}

  @Post("auth/login")
  login(@Body() body: LoginRequest, @Req() req: Request) {
    return this.identityService.login(body, correlationIdFrom(req));
  }

  @Post("auth/mfa/verify")
  verifyMfa(@Body() body: VerifyMfaRequest, @Req() req: Request) {
    return this.identityService.verifyMfa(body, correlationIdFrom(req));
  }

  @Get("me")
  me(@Req() req: Request) {
    return this.identityService.me(actingUserIdFrom(req));
  }
}
