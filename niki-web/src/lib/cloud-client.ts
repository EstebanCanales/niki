const DEFAULT_CLOUD_URL = "http://localhost:4001";

export interface CloudUser {
  id: string;
  email: string;
  displayName: string | null;
}

interface MagicCodeResponse {
  ok: true;
  debugCode?: string;
}

export class CloudRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CloudRequestError";
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function cloudUrl(path: string): string {
  const baseUrl = (process.env.NEXT_PUBLIC_NIKI_CLOUD_URL ?? DEFAULT_CLOUD_URL).replace(
    /\/$/,
    "",
  );
  return `${baseUrl}${path}`;
}

async function readJson<T>(response: Response, message: string): Promise<T> {
  if (!response.ok) {
    throw new CloudRequestError(message, response.status);
  }

  return response.json() as Promise<T>;
}

export async function joinWaitlist(email: string): Promise<void> {
  const response = await fetch(cloudUrl("/v1/waitlist"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: normalizeEmail(email) }),
  });

  if (!response.ok) {
    throw new CloudRequestError("Waitlist request failed", response.status);
  }
}

export async function requestMagicCode(email: string): Promise<MagicCodeResponse> {
  const response = await fetch(cloudUrl("/v1/auth/request-code"), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: normalizeEmail(email) }),
  });

  return readJson<MagicCodeResponse>(response, "Magic code request failed");
}

export async function verifyMagicCode(email: string, code: string): Promise<CloudUser> {
  const response = await fetch(cloudUrl("/v1/auth/verify-code"), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: normalizeEmail(email), code }),
  });
  const result = await readJson<{ user: CloudUser }>(response, "Magic code verification failed");
  return result.user;
}

export async function getCurrentUser(signal?: AbortSignal): Promise<CloudUser | null> {
  const response = await fetch(cloudUrl("/v1/me"), {
    credentials: "include",
    signal,
  });

  if (response.status === 401) {
    return null;
  }

  return readJson<CloudUser>(response, "Session request failed");
}

export async function logout(): Promise<void> {
  const response = await fetch(cloudUrl("/v1/auth/logout"), {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    throw new CloudRequestError("Logout failed", response.status);
  }
}
