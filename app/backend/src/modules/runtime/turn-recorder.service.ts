import { Injectable, Logger } from "@nestjs/common";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

/** Las señales que este sistema ya produce y hasta ahora tiraba. */
export type SenalDeCalidad =
  | "interrupcion" // la cortaste a mitad de frase: esa respuesta era mala
  | "repeticion" // repreguntaste lo mismo: la anterior no sirvió
  | "aprobacion" // aceptaste la acción que propuso
  | "rechazo" // la rechazaste
  | "cayo-al-agente"; // la ruta rápida no pudo y hubo que ir al agente completo

type Turno = {
  sessionId: string;
  userId: string;
  channel: string;
  input: string;
  reply: string;
  model: string;
  latencyMs?: number;
};

/**
 * Guarda los turnos hablados y las señales de si salieron bien o mal.
 *
 * Dos huecos que este servicio tapa.
 *
 * Uno: la ruta rápida de voz no pasa por el runtime —va derecho a Groq para contestar en
 * menos de un segundo— así que esos turnos no quedaban en ningún lado. El runtime sí deja
 * sus sesiones en `agent-home/sessions/*.json`, pero `recordAssistantReply` guarda apenas
 * un resumen en memoria. Justo la conversación que más existe era la única que no se
 * guardaba.
 *
 * Dos, y más importante: imitar conversaciones enseña a sonar como Niki, no a mejorar.
 * Para mejorar hace falta saber qué salió mal, y eso el sistema ya lo sabe y lo tiraba:
 * cuándo la interrumpiste, cuándo repreguntaste, qué acciones aprobaste y cuáles no.
 *
 * Formato: un JSONL por día, appendeando, con líneas de dos tipos —`turno` y `senal`—
 * atadas por `turnId`. Append puro y nada de reescribir: dos procesos escribiendo a la
 * vez no se pisan, y una señal que llega tarde no obliga a tocar lo ya escrito.
 *
 * No se versiona (ver .gitignore): son conversaciones reales.
 */
@Injectable()
export class TurnRecorderService {
  private readonly logger = new Logger(TurnRecorderService.name);
  private readonly carpeta: string;
  private avisoDado = false;

  /**
   * Último turno de cada sesión, para que una señal que llega suelta —"me interrumpió"—
   * sepa a qué turno pertenece. Acotado: sin el tope, un backend de semanas se queda con
   * una entrada por cada sesión que existió.
   */
  private readonly ultimoTurno = new Map<string, string>();
  private static readonly MAX_SESIONES = 500;

  /** La carpeta es un parámetro para que los tests no ensucien el dataset de verdad. */
  constructor(carpeta?: string) {
    this.carpeta = carpeta ?? path.resolve(__dirname, "..", "..", "..", "dataset", "voz");
  }

  /** Archivo del día, en UTC para que no salte con el horario local. */
  private archivoDeHoy(ahora: Date): string {
    const dia = ahora.toISOString().slice(0, 10);
    return path.join(this.carpeta, `turnos-${dia}.jsonl`);
  }

  /**
   * Escribe una línea. Nunca lanza: esto corre después de cerrar el stream, y un problema
   * de disco no puede romper una conversación que el usuario ya dio por terminada.
   */
  private escribir(fila: Record<string, unknown>) {
    try {
      fs.mkdirSync(this.carpeta, { recursive: true });
      fs.appendFileSync(this.archivoDeHoy(new Date()), JSON.stringify(fila) + "\n");
    } catch (error) {
      // Una vez por proceso: si el disco no deja escribir, no va a dejar en el turno 200.
      if (!this.avisoDado) {
        this.avisoDado = true;
        this.logger.warn(`[dataset] no se pudo anotar: ${String(error)}`);
      }
    }
  }

  private recordar(sessionId: string, turnId: string) {
    this.ultimoTurno.set(sessionId, turnId);
    if (this.ultimoTurno.size > TurnRecorderService.MAX_SESIONES) {
      // Map conserva el orden de inserción: el primero es el más viejo.
      const masViejo = this.ultimoTurno.keys().next().value;
      if (masViejo !== undefined) this.ultimoTurno.delete(masViejo);
    }
  }

  /**
   * Anota un turno hablado y devuelve su id, para poder colgarle señales después.
   * Devuelve null si el turno quedó a medias y no se anotó.
   */
  record(turno: Turno): string | null {
    const input = turno.input?.trim();
    const reply = turno.reply?.trim();
    // Un turno sin una de las dos mitades no enseña nada.
    if (!input || !reply) return null;

    const turnId = crypto.randomUUID();
    this.escribir({ type: "turno", turnId, ...turno, input, reply, at: new Date().toISOString() });
    this.recordar(turno.sessionId, turnId);
    return turnId;
  }

  /**
   * Anota una señal sobre el último turno de una sesión.
   *
   * Se cuelga del último turno y no de uno explícito porque quien manda la señal —la app
   * cuando la interrumpís, el panel cuando aprobás— sabe en qué sesión está, no en qué
   * turno. Si la sesión todavía no tuvo ningún turno hablado (por ejemplo, va toda por el
   * agente), la señal igual se anota con el `sessionId`: el exportador la ata a la sesión.
   */
  signal(sessionId: string, senal: SenalDeCalidad, detalle?: string) {
    if (!sessionId) return;
    this.escribir({
      type: "senal",
      turnId: this.ultimoTurno.get(sessionId) ?? null,
      sessionId,
      senal,
      ...(detalle ? { detalle: detalle.slice(0, 500) } : {}),
      at: new Date().toISOString(),
    });
  }
}
