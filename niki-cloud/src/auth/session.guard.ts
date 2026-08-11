import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";

import { AuthService, AuthUser } from "./auth.service";

export interface AuthenticatedRequest {
  headers: { cookie?: string };
  user?: AuthUser;
}

export function getCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.authService.getUserForSignedSession(
      getCookieValue(request.headers.cookie, "niki_session"),
    );

    if (!user) {
      throw new UnauthorizedException();
    }

    request.user = user;
    return true;
  }
}
