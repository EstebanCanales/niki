import { Injectable, Logger } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";

/**
 * Guarda los turnos hablados que contesta la ruta rápida.
 *
 * El runtime del agente deja cada sesión suya en `agent-home/sessions/*.json` con la
 * trayectoria entera, y de ahí sale el dataset. Pero la ruta rápida de voz no pasa por el
 * runtime — va derecho a Groq para contestar en menos de un segundo — así que esos turnos
 * no quedaban en ningún lado: `recordAssistantReply` solo guarda un resumen en el
 * contexto corto, que vive en memoria y se pierde.
 *
 * Es justo la conversación que más existe: hablarle. Sin esto, el dataset de Niki tiene
 * todo menos lo que Niki más hace.
 *
 * Un archivo JSONL por día, appendeando. No se versiona (ver .gitignore): son
 * conversaciones reales.
 */
@Injectable()
export class TurnRecorderService {
  private readonly logger = new Logger(TurnRecorderService.name);
  private readonly carpeta: string;
  private avisoDado = false;

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
   * Anota un turno hablado. Nunca lanza: esto corre después de cerrar el stream, y un
   * problema de disco no puede romper una conversación que el usuario ya dio por
   * terminada.
   */
  record(turno: {
    sessionId: string;
    userId: string;
    channel: string;
    input: string;
    reply: string;
    model: string;
    latencyMs?: number;
  }) {
    const input = turno.input?.trim();
    const reply = turno.reply?.trim();
    // Un turno sin una de las dos mitades no enseña nada.
    if (!input || !reply) return;

    try {
      fs.mkdirSync(this.carpeta, { recursive: true });
      const fila = JSON.stringify({ ...turno, input, reply, at: new Date().toISOString() });
      fs.appendFileSync(this.archivoDeHoy(new Date()), fila + "\n");
    } catch (error) {
      // Una vez por proceso: si el disco no deja escribir, no va a dejar en el turno 200.
      if (!this.avisoDado) {
        this.avisoDado = true;
        this.logger.warn(`[dataset] no se pudo anotar el turno de voz: ${String(error)}`);
      }
    }
  }
}
