import { Body, Controller, Get, Post, Req, Res, UseGuards } from "@nestjs/common";

import { AuthService, AuthUser } from "./auth.service";
import { MailerService } from "./mailer.service";
import { RequestMagicCodeDto, VerifyMagicCodeDto, WaitlistRequestDto } from "./auth.schemas";
import { AuthenticatedRequest, getCookieValue, SessionGuard } from "./session.guard";
import { AppConfigService } from "../config/app-config.service";

const SESSION_COOKIE_NAME = "niki_session";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface CookieResponse {
  clearCookie(name: string, options: Record<string, unknown>): void;
  cookie(name: string, value: string, options: Record<string, unknown>): void;
}

@Controller("v1")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: AppConfigService,
    private readonly mailer: MailerService,
  ) {}

  @Post("waitlist")
  async joinWaitlist(@Body() body: WaitlistRequestDto): Promise<{ ok: true }> {
    await this.authService.joinWaitlist(body.email);
    return { ok: true };
  }

  @Post("auth/request-code")
  async requestCode(
    @Body() body: RequestMagicCodeDto,
  ): Promise<{ ok: true; debugCode?: string }> {
    const code = await this.authService.issueMagicCode(body.email);

    if (this.config.isDevAuthEnabled) {
      return { ok: true, debugCode: code };
    }

    await this.mailer.sendMagicCode(body.email, code);
    return { ok: true };
  }

  @Post("auth/verify-code")
  async verifyCode(
    @Body() body: VerifyMagicCodeDto,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<{ user: AuthUser }> {
    const user = await this.authService.verifyMagicCode(body.email, body.code);
    const sessionToken = await this.authService.createSession(user);

    response.cookie(SESSION_COOKIE_NAME, this.authService.signSessionToken(sessionToken), {
      httpOnly: true,
      maxAge: SESSION_MAX_AGE_MS,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    return { user };
  }

  @Post("auth/logout")
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ): Promise<{ ok: true }> {
    await this.authService.revokeSignedSession(
      getCookieValue(request.headers.cookie, SESSION_COOKIE_NAME),
    );
    response.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return { ok: true };
  }

  @Get("me")
  @UseGuards(SessionGuard)
  getMe(@Req() request: AuthenticatedRequest): AuthUser {
    return request.user!;
  }
}
