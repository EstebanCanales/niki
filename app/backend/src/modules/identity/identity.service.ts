import {
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";

import type { LoginRequest, VerifyMfaRequest } from "../../domain/contracts";
import { RuntimeStateService } from "../common/runtime-state.service";

@Injectable()
export class IdentityService {
  constructor(
    @Inject(RuntimeStateService)
    private readonly runtimeState: RuntimeStateService,
  ) {}

  login(input: LoginRequest, correlationId: string) {
    const user = this.runtimeState.findUserByEmail(input.email);
    if (!user || input.password !== "demo-password") {
      this.runtimeState.audit(
        "anonymous",
        "auth.login",
        input.email,
        correlationId,
        "Login rejected: invalid credentials.",
        "warning",
      );
      throw new UnauthorizedException("invalid credentials");
    }

    const session = this.runtimeState.createSession(user.id);
    const challenge = this.runtimeState.createMfaChallenge(user.id);
    this.runtimeState.audit(
      user.id,
      "auth.login",
      session.id,
      correlationId,
      "Login accepted; MFA challenge issued.",
    );

    return {
      ok: true,
      user,
      session,
      mfa: {
        required: true,
        challengeId: challenge.id,
        method: challenge.method,
      },
    };
  }

  verifyMfa(input: VerifyMfaRequest, correlationId: string) {
    const challenge = this.runtimeState.verifyMfaChallenge(
      input.challengeId,
      input.code,
    );
    if (!challenge) {
      throw new UnauthorizedException("invalid mfa challenge");
    }

    const user = this.runtimeState.findUser(challenge.userId);
    if (!user) {
      throw new NotFoundException("user not found");
    }

    this.runtimeState.audit(
      user.id,
      "auth.mfa.verify",
      challenge.id,
      correlationId,
      "MFA challenge verified.",
    );

    return {
      ok: true,
      user,
      accessToken: `user_${user.id}`,
      tokenType: "Bearer",
    };
  }

  me(userId: string) {
    const user = this.runtimeState.findUser(userId);
    if (!user) {
      throw new NotFoundException("user not found");
    }

    return {
      ok: true,
      user,
      compliance: this.runtimeState.complianceFor(userId),
    };
  }
}
