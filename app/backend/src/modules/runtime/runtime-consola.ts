/**
 * Qué de lo que pasa adentro del runtime vale la pena mostrar en la consola.
 *
 * El runtime emite un evento por cada cosa que hace, y dos de ellas son casi todo el
 * volumen: `message.delta`, uno por cada pedacito de texto que va escribiendo, y
 * `reasoning.delta` igual. Medido en un turno de una sola herramienta: once de veinte
 * eventos eran deltas. En una conversación real son cientos, y empujan fuera de la
 * pantalla lo único que uno vino a buscar.
 *
 * No se pierden: el texto que traen es la respuesta, y esa se ve en el chat.
 */

/** Eventos que no entran a la consola porque su contenido ya se ve en otro lado. */
const RUIDO = new Set([
  "message.delta",
  "reasoning.delta",
  "response.output_text.delta",
  "token",
]);

export function esRuidoDeConsola(eventType: string): boolean {
  return RUIDO.has(eventType);
}

/**
 * Una línea legible para un evento de herramienta.
 *
 * El JSON del runtime trae el dato bueno pero enterrado: `tool.started` lleva el comando
 * en `preview`, y `tool.completed` lleva cuánto tardó y si falló. Sin esto la consola dice
 * "Tool Started" veinte veces y hay que abrir cada una para saber cuál fue cuál.
 *
 * Devuelve null cuando el evento no es de herramienta o el JSON no tiene lo que esperamos,
 * y ahí el llamador se queda con la etiqueta genérica.
 */
export function etiquetaDeHerramienta(
  eventType: string,
  data: unknown,
): { titulo: string; resumen: string } | null {
  if (!eventType.startsWith("tool.")) return null;
  if (!data || typeof data !== "object") return null;

  const d = data as Record<string, unknown>;
  const herramienta = typeof d.tool === "string" ? d.tool : "";
  if (!herramienta) return null;

  if (eventType === "tool.started") {
    const preview = typeof d.preview === "string" ? d.preview : "";
    return {
      titulo: `${herramienta}`,
      resumen: preview || "sin vista previa",
    };
  }

  if (eventType === "tool.completed") {
    const fallo = d.error === true;
    const duracion = typeof d.duration === "number" ? `${d.duration.toFixed(2)} s` : "";
    return {
      titulo: `${herramienta} ${fallo ? "falló" : "terminó"}`,
      resumen: duracion,
    };
  }

  return { titulo: `${herramienta} · ${eventType.slice(5)}`, resumen: "" };
}
