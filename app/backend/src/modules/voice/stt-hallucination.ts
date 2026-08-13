/**
 * Detección de alucinaciones de Whisper.
 *
 * Whisper no devuelve silencio cuando no oye nada: devuelve algo. Sobre ruido o silencio
 * produce muletillas de sus datos de entrenamiento ("Gracias.", "Subtítulos realizados
 * por la comunidad de Amara.org") o se traba repitiendo ("No, no, no, no, no."). Todo
 * eso llegaba a Niki como si el usuario lo hubiera dicho, y Niki respondía en serio.
 *
 * La lista de frases exactas que había antes solo atrapa lo que ya vimos. Acá se suman
 * las señales que el propio Whisper reporta en `verbose_json` y una prueba de repetición
 * que no depende de conocer la frase de antemano.
 */

/** Frases que Whisper inventa sobre silencio. Coincidencia exacta, ya normalizada. */
const FRASES_INVENTADAS = new Set([
  ".", "..", "...", "…", "♪", "♫", "music", "música",
  "[música]", "[music]", "[silencio]", "[silence]", "[aplausos]", "[applause]",
  "gracias", "gracias.", "gracias por ver el video", "thanks for watching",
  "subtítulos realizados por la comunidad de amara.org",
  "subtitles by the amara.org community",
  "subtítulos por la comunidad de amara.org",
  "amara.org",
]);

/**
 * Señales por segmento del `verbose_json` de Whisper.
 *
 * - `no_speech_prob`: cuánto cree el propio modelo que ahí no había voz.
 * - `compression_ratio`: cuánto comprime el texto. Alto = muy repetitivo; es el
 *   indicador clásico de que se trabó en un bucle.
 * - `avg_logprob`: confianza media. Muy bajo = estuvo adivinando.
 */
export type WhisperSegment = {
  text?: string;
  no_speech_prob?: number;
  compression_ratio?: number;
  avg_logprob?: number;
};

/** Umbrales de la documentación de Whisper, que son los que usa su propio decoder. */
export const NO_SPEECH_MAX = 0.6;
export const COMPRESSION_RATIO_MAX = 2.4;
export const AVG_LOGPROB_MIN = -1.0;

function normalizar(texto: string): string {
  return texto
    .trim()
    .toLowerCase()
    .replace(/[¡!¿?"'()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ¿El texto es un bucle de repetición?
 *
 * "No, no, no, no, no." o "sí sí sí sí sí". Se pide un mínimo de repeticiones para no
 * marcar un "no, no" enfático, que es habla normal.
 */
export function esBucleRepetido(texto: string, minRepeticiones = 4): boolean {
  const palabras = normalizar(texto).split(/[\s,.]+/).filter(Boolean);
  if (palabras.length < minRepeticiones) return false;

  const unicas = new Set(palabras);
  // Una sola palabra repetida muchas veces.
  if (unicas.size === 1) return true;
  // O dominada por una: "eh eh eh eh eh sí".
  if (unicas.size <= 2 && palabras.length >= minRepeticiones + 2) {
    const conteos = [...unicas].map((p) => palabras.filter((x) => x === p).length);
    return Math.max(...conteos) / palabras.length >= 0.75;
  }
  return false;
}

/** Frase exacta de las que Whisper inventa sobre silencio. */
export function esFraseInventada(texto: string): boolean {
  return FRASES_INVENTADAS.has(normalizar(texto));
}

/**
 * Se queda solo con los segmentos que parecen habla de verdad.
 * Devuelve el texto limpio, o "" si no sobrevivió ninguno.
 */
export function textoDeSegmentosConfiables(segmentos: WhisperSegment[]): string {
  const buenos = segmentos.filter((s) => {
    if ((s.no_speech_prob ?? 0) >= NO_SPEECH_MAX) return false;
    if ((s.compression_ratio ?? 0) > COMPRESSION_RATIO_MAX) return false;
    if (s.avg_logprob !== undefined && s.avg_logprob < AVG_LOGPROB_MIN) return false;
    return true;
  });
  return buenos.map((s) => (s.text ?? "").trim()).join(" ").trim();
}

/**
 * ¿El texto es solo palabras del vocabulario que le pasamos?
 *
 * Medido: sobre un tono puro, sin `prompt` Whisper devolvía vacío; con
 * `prompt="Niki. Esteban."` devolvía "Esteban.". El sesgo de vocabulario mejora los
 * nombres propios cuando hay voz, y sobre ruido hace que el modelo escupa justo esas
 * palabras. Es la contra de la técnica, y hay que taparla donde se genera.
 *
 * Contrapartida asumida: decir solo "Niki", sin nada más, se descarta. En una llamada ya
 * en curso nadie dice únicamente el nombre, y si pasa, Niki simplemente sigue
 * escuchando — mucho más barato que responderle a un ventilador.
 */
export function esSoloVocabulario(texto: string, vocabulario: string[]): boolean {
  const limpio = normalizar(texto).replace(/[.,;:]/g, " ").trim();
  if (!limpio) return false;
  const terminos = new Set(
    vocabulario.flatMap((v) => normalizar(v).split(/[\s.,;:]+/)).filter(Boolean),
  );
  if (terminos.size === 0) return false;
  const palabras = limpio.split(/\s+/).filter(Boolean);
  return palabras.length > 0 && palabras.every((p) => terminos.has(p));
}

/** Veredicto final sobre un texto ya ensamblado. */
export function esAlucinacion(texto: string, vocabulario: string[] = []): boolean {
  const limpio = texto.trim();
  if (!limpio) return true;
  if (esFraseInventada(limpio) || esBucleRepetido(limpio)) return true;
  return esSoloVocabulario(limpio, vocabulario);
}
