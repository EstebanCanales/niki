export type GeocodeResult = {
  lat: number;
  lng: number;
  displayName: string;
};

type FetchLike = (input: string, init?: Record<string, unknown>) => Promise<{
  ok: boolean;
  json: () => Promise<unknown>;
}>;

/**
 * Resuelve una dirección/lugar a coordenadas usando Nominatim (OpenStreetMap).
 * Sin API key. Nunca lanza — devuelve null si falla, se agota el tiempo, o no hay resultados,
 * para que el surface de mapa siempre pueda mostrarse (con o sin coordenadas precisas).
 */
// Artículos iniciales ("la Torre Eiffel", "el Café Central") confunden a Nominatim: a veces
// matchean falsos positivos literales (una calle llamada "La Torre Eiffel" en Zaragoza) y a
// veces rompen el parseo por completo cuando se combinan con un calificador de ciudad
// ("la Torre Eiffel de Paris" → sin resultados, mientras que "Torre Eiffel de Paris" resuelve
// perfecto). Los quitamos antes de geocodificar; el texto original se sigue mostrando en UI.
const LEADING_ARTICLES = /^(?:la|el|los|las|the)\s+/i;

function stripLeadingArticle(value: string): string {
  return value.replace(LEADING_ARTICLES, "").trim();
}

export async function geocodeAddress(
  address: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  timeoutMs = 4000,
): Promise<GeocodeResult | null> {
  const query = stripLeadingArticle(address.trim());
  if (!query) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "NikiAssistant/1.0 (local desktop assistant; contact: operator@niki.local)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const first = data[0] as Record<string, unknown>;
    const lat = Number(first.lat);
    const lng = Number(first.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return {
      lat,
      lng,
      displayName: typeof first.display_name === "string" ? first.display_name : query,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
