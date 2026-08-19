import { Inject, Injectable, Logger } from "@nestjs/common";
import * as path from "path";

import { BACKEND } from "../voice/worker-json";

import { FaceService } from "../voice/face.service";
import { SpeakerService } from "../voice/speaker.service";
import {
  juntarSenales,
  SIN_SENAL,
  type SenalDeIdentidad,
  type VeredictoDeIdentidad,
} from "./identidad.types";
import {
  AjusteDeIdentidad,
  decidir,
  puedeEscribir,
  type Decision,
  type ModoAjeno,
  type ResultadoDePolitica,
} from "./politica";

/**
 * Quién está del otro lado.
 *
 * Un sistema aparte del agente: acá viven la cara y la voz, y lo único que sale hacia el
 * agente es un veredicto en una frase. Ni el agente sabe de umbrales ni esto sabe de
 * conversaciones.
 *
 * **Guarda el último veredicto en memoria** porque las dos huellas se miden en momentos
 * distintos —la cara al empezar la conversación, la voz en cada turno hablado— y el
 * agente pregunta en un tercer momento. Sin recordar, cada turno empezaría sin saber nada
 * de lo que ya se averiguó hace diez segundos.
 */
@Injectable()
export class IdentidadService {
  private readonly logger = new Logger(IdentidadService.name);

  /** Lo último que se supo de cada persona, con cuándo. */
  private readonly ultimo = new Map<string, { cara: SenalDeIdentidad; voz: SenalDeIdentidad; at: number }>();

  /**
   * Cuánto vale un veredicto antes de olvidarlo.
   *
   * Cinco minutos: lo suficiente para que una conversación entera se apoye en el
   * reconocimiento del principio, y poco como para que alguien que se sentó después no
   * herede la sesión del anterior.
   */
  private static readonly VIGENCIA_MS = 5 * 60_000;

  private readonly ajuste = new AjusteDeIdentidad(
    path.join(BACKEND, "agent-home", "identidad"),
  );

  constructor(
    @Inject(FaceService) private readonly cara: FaceService,
    @Inject(SpeakerService) private readonly voz: SpeakerService,
  ) {}

  /**
   * Qué hacer con un turno: la decisión, con su motivo.
   *
   * Este es el punto por el que pasa todo. Antes la compuerta vivía en la app —si la voz
   * no coincidía, el cliente no mandaba el turno— y el backend no verificaba nada, aunque
   * es el que escribe la memoria y el dataset. O sea que la protección era que el cliente
   * tuviera la gentileza de no llamar.
   */
  decidirTurno(userId: string): ResultadoDePolitica & { veredicto: VeredictoDeIdentidad } {
    const veredicto = this.veredicto(userId);
    const r = decidir(veredicto, this.modo());
    return { ...r, veredicto };
  }

  /** ¿Este turno puede dejar rastro en la memoria, el dataset o el contexto? */
  puedeEscribir(decision: Decision): boolean {
    return puedeEscribir(decision);
  }

  modo(): ModoAjeno {
    return this.ajuste.leer();
  }

  cambiarModo(modo: ModoAjeno) {
    this.ajuste.escribir(modo);
    this.logger.log(`[identidad] modo para voces ajenas → ${modo}`);
  }

  /**
   * Si el sistema de identidad está en condiciones de decir algo.
   *
   * Existe por la parte de "asegurándose del funcionamiento": hasta ahora, si un worker se
   * caía, todo fallaba en abierto **en silencio** y nadie se enteraba de que la identidad
   * había dejado de existir. Fallar en abierto está bien; hacerlo sin avisar, no.
   */
  /**
   * Lo que se puede decir sin preguntarle a nadie: si las piezas están instaladas.
   *
   * Va en el camino del turno, que corre en cada mensaje. La versión buena consulta a los
   * workers —un proceso de Python de ida y vuelta— y eso no puede pagarse por turno solo
   * para escribir una línea informativa en la consola.
   */
  saludRapida(): string[] {
    const problemas: string[] = [];
    if (!this.cara.available) problemas.push("la huella de cara no está instalada");
    if (!this.voz.available) problemas.push("la huella de voz no está instalada");
    return problemas;
  }

  async salud(userId: string) {
    // Se le pregunta a los workers, no al veredicto guardado. El veredicto es lo último
    // que se supo y puede estar viejo: en una prueba dijo que había una voz registrada
    // justo después de haberla borrado, porque miraba el recuerdo en vez de mirar el
    // disco. Una función que se llama "salud" no puede contestar de memoria.
    const [caraOk, vozOk] = await Promise.all([
      this.registrado(this.cara, userId),
      this.registrado(this.voz, userId),
    ]);

    const problemas: string[] = [];
    if (!this.cara.available) problemas.push("la huella de cara no está instalada");
    else if (!caraOk) problemas.push("no hay una cara registrada");
    if (!this.voz.available) problemas.push("la huella de voz no está instalada");
    else if (!vozOk) problemas.push("no hay una voz registrada");

    return {
      // Con una de las dos alcanza para poder afirmar algo. Con ninguna, este sistema
      // no puede decir nada de nadie y conviene que se sepa.
      puedeIdentificar: caraOk || vozOk,
      problemas,
      modo: this.modo(),
    };
  }

  private async registrado(
    huella: { available: boolean; status(userId: string): Promise<{ enrolled: boolean }> },
    userId: string,
  ): Promise<boolean> {
    if (!huella.available) return false;
    try {
      return (await huella.status(userId)).enrolled;
    } catch {
      return false;
    }
  }

  /** Lo que se sabe ahora mismo de esta persona. */
  veredicto(userId: string): VeredictoDeIdentidad {
    const guardado = this.ultimo.get(userId);
    if (!guardado || Date.now() - guardado.at > IdentidadService.VIGENCIA_MS) {
      return juntarSenales(SIN_SENAL, SIN_SENAL);
    }
    return juntarSenales(guardado.cara, guardado.voz);
  }

  /** Anota lo que dijo la cámara. Lo llama el endpoint de verificación de cara. */
  anotarCara(userId: string, senal: SenalDeIdentidad) {
    this.anotar(userId, { cara: senal });
  }

  /** Anota lo que dijo el micrófono. Lo llama la transcripción, que ya verifica al hablar. */
  anotarVoz(userId: string, senal: SenalDeIdentidad) {
    this.anotar(userId, { voz: senal });
  }

  private anotar(userId: string, parcial: { cara?: SenalDeIdentidad; voz?: SenalDeIdentidad }) {
    const previo = this.ultimo.get(userId);
    const vigente = previo && Date.now() - previo.at <= IdentidadService.VIGENCIA_MS;
    const cara = parcial.cara ?? (vigente ? previo!.cara : SIN_SENAL);
    const voz = parcial.voz ?? (vigente ? previo!.voz : SIN_SENAL);
    this.ultimo.set(userId, { cara, voz, at: Date.now() });

    const v = juntarSenales(cara, voz);
    this.logger.log(
      `[identidad] ${userId}: ${v.confianza}` +
        ` (cara ${describir(cara)}, voz ${describir(voz)})`,
    );
  }

  /**
   * Olvida lo que se sabía. Al colgar, al cambiar de usuario, o al borrar una huella.
   *
   * Lo último es lo que motivó llamarlo desde afuera: al borrar el perfil de cara, el
   * veredicto guardado seguía diciendo "es él" durante cinco minutos, apoyado en una
   * comparación contra un perfil que ya no existía.
   */
  olvidar(userId: string) {
    this.ultimo.delete(userId);
  }

  /** ¿Están las dos huellas instaladas? Para el panel y el diagnóstico. */
  disponibilidad() {
    return { cara: this.cara.available, voz: this.voz.available };
  }
}

function describir(s: SenalDeIdentidad): string {
  if (!s.registrado) return "sin registrar";
  if (s.coincide === null) return "no miró";
  return s.coincide ? `sí (${s.puntaje?.toFixed(2)})` : `no (${s.puntaje?.toFixed(2)})`;
}
