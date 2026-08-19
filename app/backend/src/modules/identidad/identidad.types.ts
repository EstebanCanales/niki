/**
 * Quién está del otro lado, según la cara y la voz.
 *
 * Es un sistema aparte del agente a propósito: la cara y la voz las resuelven dos workers
 * propios (`face/verify.py`, `speaker/verify.py`) que no saben nada de conversaciones, y
 * el agente no sabe nada de umbrales ni de embeddings. Lo único que cruza esa frontera es
 * este veredicto.
 */

/** Cuánto se puede afirmar sobre quién está. */
export type ConfianzaDeIdentidad =
  /** Cara y voz coinciden. */
  | "alta"
  /** Una de las dos coincide y la otra no pudo mirar. */
  | "media"
  /** Ninguna pudo decir nada: sin registrar, sin cámara, sin micrófono. */
  | "nula"
  /** Alguna dijo que NO es él. */
  | "negativa";

export type SenalDeIdentidad = {
  /** Hay un perfil registrado contra el cual comparar. */
  registrado: boolean;
  /**
   * `null` cuando no se pudo mirar — cámara tapada, sin audio, worker caído.
   *
   * La distinción entre `false` y `null` es la más importante de este archivo: "no sos
   * vos" y "no pude ver" llevan a decisiones opuestas, y tratarlas igual es exactamente
   * lo que rompe estos sistemas.
   */
  coincide: boolean | null;
  puntaje: number | null;
  umbral: number | null;
};

export type VeredictoDeIdentidad = {
  /** true, false, o null si no se pudo saber. Nunca se adivina. */
  esElDueño: boolean | null;
  confianza: ConfianzaDeIdentidad;
  porCara: SenalDeIdentidad;
  porVoz: SenalDeIdentidad;
  /** Una frase para meter en el contexto del agente. Ver `frasePara`. */
  resumen: string;
};

export const SIN_SENAL: SenalDeIdentidad = {
  registrado: false,
  coincide: null,
  puntaje: null,
  umbral: null,
};

/**
 * Junta las dos señales en un veredicto.
 *
 * Las reglas, y por qué:
 *
 * - Si alguna dice que NO es él, el veredicto es negativo aunque la otra diga que sí. Es
 *   la única forma de que la información sirva: decir "es Esteban" cuando una de las dos
 *   dice que no sería peor que no decir nada.
 * - Si ninguna pudo mirar, el veredicto es `null`, no `false`. Sin cámara ni micrófono no
 *   se sabe quién está, y eso no es lo mismo que saber que es otro.
 * - Nada de esto bloquea: el veredicto sirve para personalizar, no para autorizar. Una
 *   webcam 2D se engaña con una foto.
 */
export function juntarSenales(cara: SenalDeIdentidad, voz: SenalDeIdentidad): VeredictoDeIdentidad {
  const dijeronQueNo = cara.coincide === false || voz.coincide === false;
  const dijeronQueSi = [cara.coincide === true, voz.coincide === true].filter(Boolean).length;

  let esElDueño: boolean | null;
  let confianza: ConfianzaDeIdentidad;

  if (dijeronQueNo) {
    esElDueño = false;
    confianza = "negativa";
  } else if (dijeronQueSi === 2) {
    esElDueño = true;
    confianza = "alta";
  } else if (dijeronQueSi === 1) {
    esElDueño = true;
    confianza = "media";
  } else {
    esElDueño = null;
    confianza = "nula";
  }

  return { esElDueño, confianza, porCara: cara, porVoz: voz, resumen: frasePara(confianza) };
}

/**
 * Cómo se le cuenta esto al agente.
 *
 * En prosa y no en JSON porque va dentro de sus instrucciones, y una frase la respeta
 * mejor que un campo booleano perdido entre veinte más.
 */
export function frasePara(confianza: ConfianzaDeIdentidad): string {
  switch (confianza) {
    case "alta":
      return "Estás hablando con Esteban: lo confirman su cara y su voz.";
    case "media":
      return "Probablemente estés hablando con Esteban: lo confirma una de las dos huellas, la otra no pudo mirar.";
    case "negativa":
      return "Quien está hablando NO parece ser Esteban. Contestá igual, pero no cuentes nada personal suyo.";
    case "nula":
      return "No se pudo confirmar quién está hablando. Contestá normalmente, sin dar por hecho que es Esteban.";
  }
}
