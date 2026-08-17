import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { SCRIPT_HUELLA_CARA, WorkerJson } from "./worker-json";

/**
 * Huella de cara: decide si quien está frente a la cámara es el dueño de la cuenta.
 *
 * Hermano de SpeakerService, con la misma regla de oro: **falla en abierto**. Sin perfil,
 * con el worker caído, con la cámara tapada o con un error inesperado, devuelve
 * `match: true`. Esto sirve para saber quién sos y personalizar, no para dejar a nadie
 * afuera; fallar cerrado convertiría cualquier problema de esta pieza en "Niki no me
 * responde", que es mucho peor.
 *
 * **No es un control de seguridad.** Una webcam 2D se engaña con una foto en un teléfono.
 */

export type FaceVerdict = {
  /** Hay un perfil registrado para este usuario. */
  enrolled: boolean;
  /** Si la cara coincide. **Siempre true cuando no hay perfil o no se vio a nadie.** */
  match: boolean;
  score: number | null;
  threshold?: number;
  /** null cuando no hay perfil; false cuando se miró y no había nadie. */
  faceFound?: boolean | null;
};

const SCRIPT = SCRIPT_HUELLA_CARA;

@Injectable()
export class FaceService implements OnModuleDestroy {
  private readonly logger = new Logger(FaceService.name);
  private readonly worker = new WorkerJson("la huella de cara", SCRIPT, this.logger);

  onModuleDestroy() {
    this.worker.detener();
  }

  get available(): boolean {
    return this.worker.available;
  }

  /** Registra la cara con varias tomas. Cuatro es el mínimo del worker. */
  async enroll(userId: string, frames: Buffer[]) {
    const r = await this.worker.enviar<{ ok: boolean; error?: string; threshold?: number; samples?: number }>({
      op: "enroll",
      userId,
      frames: frames.map((f) => f.toString("base64")),
    });
    // Al log siempre, salga bien o mal. Un registro que falla del lado del modelo
    // devuelve 200 con ok:false, así que sin esto en el servidor no queda rastro de por
    // qué —y "no me funciona" sin motivo no se puede arreglar.
    const tamaños = frames.map((f) => f.length).join(", ");
    if (r.ok) {
      this.logger.log(`[cara] registrada: umbral ${r.threshold}, ${r.samples} tomas (bytes: ${tamaños})`);
    } else {
      this.logger.warn(`[cara] registro rechazado: ${r.error} (bytes: ${tamaños})`);
    }
    return r;
  }

  async status(userId: string) {
    return this.worker.enviar<{ ok: boolean; enrolled: boolean; threshold?: number; samples?: number }>({
      op: "status",
      userId,
    });
  }

  async forget(userId: string) {
    return this.worker.enviar<{ ok: boolean; enrolled: boolean }>({ op: "forget", userId });
  }

  /** ¿Es el dueño el que está en cámara? Ver la nota de la clase: falla en abierto. */
  async verify(userId: string, frame: Buffer): Promise<FaceVerdict> {
    if (!this.available) return { enrolled: false, match: true, score: null, faceFound: null };
    try {
      const r = await this.worker.enviar<FaceVerdict & { ok: boolean }>({
        op: "verify",
        userId,
        frame: frame.toString("base64"),
      });
      return {
        enrolled: !!r.enrolled,
        match: r.match !== false,
        score: r.score ?? null,
        threshold: r.threshold,
        faceFound: r.faceFound ?? null,
      };
    } catch (error) {
      this.logger.warn(`[cara] verificación falló, se sigue igual: ${String(error)}`);
      return { enrolled: false, match: true, score: null, faceFound: null };
    }
  }
}
