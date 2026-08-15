/**
 * Detecta cuándo Esteban vuelve a preguntar lo mismo.
 *
 * Es la señal más barata que hay y no cuesta una sola llamada: si repregunta algo que ya
 * había preguntado, la respuesta anterior no le sirvió. Para entrenar, ese par
 * (pregunta, respuesta descartada) vale más que cien turnos que salieron bien, porque
 * marca dónde el modelo falla.
 *
 * No usa un modelo para decidirlo: comparar dos frases cortas no lo necesita, y meter una
 * llamada más en el camino del turno para conseguir una señal sería pagar latencia por
 * telemetría.
 */

/**
 * Sin tildes, sin puntuación, sin mayúsculas: "¿Qué hora es?" y "que hora es" son lo mismo.
 *
 * La ñ también pierde la tilde y queda en n. Es lo que conviene acá: lo que se compara es
 * lo que dijo el reconocimiento de voz, que escribe "mañana" o "manana" según le pinte, y
 * dos formas de la misma palabra tienen que contar como la misma.
 */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Palabras que aparecen en todas las preguntas y no distinguen ninguna. Sin sacarlas,
 * "¿me pasás la hora?" y "¿me pasás el clima?" se parecen demasiado.
 */
const VACIAS = new Set([
  "el", "la", "los", "las", "un", "una", "de", "del", "que", "y", "o", "a", "en", "es",
  "me", "te", "se", "lo", "le", "por", "para", "con", "mi", "tu", "su", "al", "esa",
  "ese", "esto", "eso", "como", "cual", "pero", "si", "no", "ya", "che", "dale",
]);

function fichas(texto: string): Set<string> {
  return new Set(normalizar(texto).split(" ").filter((p) => p.length > 1 && !VACIAS.has(p)));
}

/** Cuánto se parecen dos frases, de 0 a 1, por palabras compartidas (Jaccard). */
export function parecido(a: string, b: string): number {
  const fa = fichas(a);
  const fb = fichas(b);
  if (fa.size === 0 || fb.size === 0) return 0;
  let comunes = 0;
  for (const f of fa) if (fb.has(f)) comunes += 1;
  return comunes / (fa.size + fb.size - comunes);
}

/** Desde este parecido se considera que es la misma pregunta otra vez. */
export const UMBRAL_REPETICION = 0.7;

/**
 * ¿`actual` es una repregunta de algo que ya está en el historial?
 *
 * Solo mira las últimas cuatro preguntas: volver a un tema media hora después no es
 * repreguntar, es otra conversación. Devuelve la pregunta anterior que coincide, o null.
 */
export function preguntaRepetida(
  historial: { role: string; content: string }[],
  actual: string,
  ventana = 4,
): string | null {
  const previas = historial
    .filter((m) => m.role === "user" && typeof m.content === "string" && m.content.trim())
    .slice(-ventana);

  for (let i = previas.length - 1; i >= 0; i -= 1) {
    const anterior = previas[i].content;
    if (parecido(anterior, actual) >= UMBRAL_REPETICION) return anterior;
  }
  return null;
}
