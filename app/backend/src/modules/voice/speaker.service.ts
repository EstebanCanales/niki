import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import * as path from "path";

import { BACKEND, WorkerJson } from "./worker-json";

/**
 * Huella de voz: decide si quien habló es el dueño de la cuenta.
 *
 * Corre en paralelo con la transcripción, no antes. La app ya sube el audio una vez y
 * Groq tarda ~1.1 s, así que verificar quién habló no agrega latencia percibida.
 *
 * La plomería del worker (proceso vivo, JSON por línea, cola, tiempo límite) está en
 * WorkerJson, compartida con la huella de cara: es la parte delicada y no conviene
 * tenerla escrita dos veces.
 */

export type SpeakerVerdict = {
  /** Hay un perfil registrado para este usuario. */
  enrolled: boolean;
  /** Si la voz coincide. **Siempre true cuando no hay perfil** — ver `verify`. */
  match: boolean;
  score: number | null;
  threshold?: number;
};

const SCRIPT = path.join(BACKEND, "speaker", "verify.py");

@Injectable()
export class SpeakerService implements OnModuleDestroy {
  private readonly logger = new Logger(SpeakerService.name);
  private readonly worker = new WorkerJson("la huella de voz", SCRIPT, this.logger);

  onModuleDestroy() {
    this.worker.detener();
  }

  get available(): boolean {
    return this.worker.available;
  }

  async enroll(userId: string, samples: Buffer[]) {
    return this.worker.enviar<{ ok: boolean; error?: string; threshold?: number; samples?: number }>({
      op: "enroll",
      userId,
      samples: samples.map((s) => s.toString("base64")),
    });
  }

  async status(userId: string) {
    return this.worker.enviar<{ ok: boolean; enrolled: boolean; threshold?: number; samples?: number }>({
      op: "status",
      userId,
    });
  }

  /**
   * ¿Habló el dueño?
   *
   * **Falla en abierto, siempre.** Sin perfil, con el worker caído o con un error
   * inesperado, devuelve `match: true`. La alternativa —fallar cerrado— convierte
   * cualquier problema de esta pieza en "Niki no me escucha", que es mucho peor que
   * responderle alguna vez a otra persona.
   */
  async verify(userId: string, audio: Buffer): Promise<SpeakerVerdict> {
    if (!this.available) return { enrolled: false, match: true, score: null };
    try {
      const r = await this.worker.enviar<SpeakerVerdict & { ok: boolean }>({
        op: "verify",
        userId,
        audio: audio.toString("base64"),
      });
      return { enrolled: !!r.enrolled, match: r.match !== false, score: r.score ?? null, threshold: r.threshold };
    } catch (error) {
      this.logger.warn(`[huella] verificación falló, se acepta el turno: ${String(error)}`);
      return { enrolled: false, match: true, score: null };
    }
  }
}
