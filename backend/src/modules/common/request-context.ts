import type { Request } from "express";

export type RequestWithId = Request & { requestId?: string };

export function correlationIdFrom(req: Request) {
  return (req as RequestWithId).requestId?.trim() || "request";
}

export function internalApiKeyFrom(req: Request) {
  return String(req.headers["x-internal-api-key"] ?? "").trim();
}

export function wrapperApiKeyFrom(req: Request) {
  return String(req.headers["x-niki-api-key"] ?? "").trim();
}

export function actingUserIdFrom(req: Request) {
  const explicit = String(req.headers["x-niki-user-id"] ?? "").trim();
  if (explicit) return explicit;

  const authHeader = String(req.headers.authorization ?? "").trim();
  if (authHeader.toLowerCase().startsWith("bearer user_")) {
    return authHeader.slice("bearer ".length).trim();
  }

  return "user-demo";
}
