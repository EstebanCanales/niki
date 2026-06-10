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

/**
 * Anti drive-by: el backend escucha en localhost y permite CORS abierto, así que
 * cualquier web podría disparar acciones (incluido control de la computadora) vía
 * fetch. Los navegadores envían `Origin` en esas peticiones; los clientes nativos
 * (Tauri IPC, curl, app macOS) no, o usan esquemas locales. Confiamos en peticiones
 * sin Origin o con Origin local/Tauri, y rechazamos orígenes web externos.
 */
export function isTrustedOrigin(req: Request): boolean {
  if (String(process.env.NIKI_DISABLE_ORIGIN_GUARD ?? "").trim() === "1") return true;

  const origin = String(req.headers.origin ?? "").trim();
  // Sin Origin = cliente nativo / curl / IPC de Tauri.
  if (!origin) return true;

  const extra = String(process.env.NIKI_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().toLowerCase())
    .filter(Boolean);
  if (extra.includes(origin.toLowerCase())) return true;

  try {
    const url = new URL(origin);
    if (url.protocol === "tauri:") return true;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "tauri.localhost" ||
      host.endsWith(".localhost")
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
