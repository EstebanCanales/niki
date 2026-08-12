const DEFAULT_CLOUD_URL = "http://localhost:4001";

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

export async function joinWaitlist(email: string): Promise<void> {
  const cloudUrl = (process.env.NEXT_PUBLIC_NIKI_CLOUD_URL ?? DEFAULT_CLOUD_URL).replace(
    /\/$/,
    "",
  );
  const response = await fetch(`${cloudUrl}/v1/waitlist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: normalizeEmail(email) }),
  });

  if (!response.ok) {
    throw new CloudRequestError("Waitlist request failed", response.status);
  }
}
