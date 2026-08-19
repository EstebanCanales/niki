import * as fs from "fs";
import * as path from "path";

import type { VeredictoDeIdentidad } from "./identidad.types";

/**
 * Qué hacer con un turno según quién parece estar hablando.
 *
 * Pura y en su propio archivo por un motivo: es una decisión de tres salidas que gobierna
 * si se escribe en la memoria y en el dataset de Esteban. Una cosa así se prueba con una
 * tabla de casos, no leyendo un `if` perdido en medio de un método de trescientas líneas.
 */

export type Decision =
  /** Es él, o no se sabe y el ajuste deja pasar. Responde normal y escribe. */
  | "pasa"
  /** Responde, pero sin memoria ni nombre, y **no escribe nada**. */
  | "pasaSinDatos"
  /** Ni contesta. */
  | "descarta";

/** Qué hacer cuando la voz o la cara dicen que NO es él. Lo elige Esteban. */
export type ModoAjeno =
  /** Contesta sin usar nada suyo y sin dejar rastro. El razonable por defecto. */
  | "sinDatos"
  /** No contesta. Lo más estricto — y si te reconoce mal, Niki se queda muda. */
  | "ignorar"
  /** Contesta normal; queda el aviso en la consola. */
  | "avisar";

export const MODO_POR_DEFECTO: ModoAjeno = "sinDatos";

export type ResultadoDePolitica = {
  decision: Decision;
  /** Por qué, en una frase. Va a la consola y al log: una decisión sin motivo no se audita. */
  motivo: string;
};

/**
 * La decisión.
 *
 * Las dos reglas que la ordenan:
 *
 * - **No saber no es acusar.** Sin cámara y sin voz registrada —el caso más común, escribir
 *   en el chat— no se puede afirmar nada, así que se contesta pero sin datos personales.
 *   Es lo que eligió Esteban, y es distinto de lo que hacía antes, que era asumir que era
 *   él. El matiz que lo hace usable: el veredicto vale cinco minutos, así que un mensaje
 *   escrito justo después de una conversación hablada hereda la confirmación.
 * - **Decir que no es él sí es una afirmación**, y qué hacer con ella es preferencia suya,
 *   no nuestra: hay quien prefiere que Niki se calle y quien prefiere que nunca falle.
 */
export function decidir(veredicto: VeredictoDeIdentidad, modo: ModoAjeno): ResultadoDePolitica {
  if (veredicto.esElDueño === true) {
    return {
      decision: "pasa",
      motivo:
        veredicto.confianza === "alta"
          ? "es él: coinciden la cara y la voz"
          : "es él: coincide una de las dos huellas",
    };
  }

  if (veredicto.esElDueño === false) {
    switch (modo) {
      case "ignorar":
        return { decision: "descarta", motivo: "no es él y el ajuste dice no contestar" };
      case "avisar":
        return { decision: "pasa", motivo: "no es él, pero el ajuste dice contestar igual" };
      case "sinDatos":
        return { decision: "pasaSinDatos", motivo: "no es él: contesta sin datos personales" };
    }
  }

  // esElDueño === null: no se pudo saber.
  return {
    decision: "pasaSinDatos",
    motivo: "no se pudo confirmar quién es: contesta sin datos personales",
  };
}

/** ¿Este turno puede dejar rastro? Solo los que se confirman como suyos. */
export function puedeEscribir(decision: Decision): boolean {
  return decision === "pasa";
}

/**
 * El ajuste, guardado en el backend y no en la app.
 *
 * Acá porque acá se toma la decisión. Un ajuste que viajara en cada pedido lo podría
 * mandar cualquiera que sepa la URL, y entonces la compuerta la abriría el que quiere
 * pasar — que es justo el problema que este archivo existe para resolver.
 *
 * Un archivo suelto, igual que el interruptor de captura del dataset
 * (`turn-recorder.service.ts`): es un enum, no hace falta una base de datos.
 */
export class AjusteDeIdentidad {
  private readonly archivo: string;

  constructor(carpeta: string) {
    this.archivo = path.join(carpeta, "modo-ajeno");
  }

  leer(): ModoAjeno {
    try {
      const valor = fs.readFileSync(this.archivo, "utf8").trim();
      if (valor === "ignorar" || valor === "avisar" || valor === "sinDatos") return valor;
    } catch {
      /* sin archivo: el de por defecto */
    }
    return MODO_POR_DEFECTO;
  }

  escribir(modo: ModoAjeno) {
    fs.mkdirSync(path.dirname(this.archivo), { recursive: true });
    fs.writeFileSync(this.archivo, modo);
  }
}
