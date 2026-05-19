function normalizeWrapperBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return "http://127.0.0.1:8000";
  }
  return trimmed.replace(/\/+$/, "");
}

export function wrapperUrl(baseUrl: string, path: string): string {
  const normalizedBase = normalizeWrapperBaseUrl(baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function wrapperHeaders(apiKey?: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const trimmed = apiKey?.trim();
  if (trimmed) {
    headers.set("x-niki-api-key", trimmed);
  }
  return headers;
}
