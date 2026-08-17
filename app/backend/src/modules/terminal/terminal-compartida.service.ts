import { Injectable, Logger } from "@nestjs/common";
import { spawn } from "child_process";
import * as path from "path";

import { blockedShellReason } from "../computer/computer-control.service";
import {
  guionParaSesion,
  sesionDeLaIA,
  sesionPropia,
  type SesionDeTerminal,
} from "./terminal-sesion";

const RAIZ = path.resolve(__dirname, "..", "..", "..", "..", "..");

/** Cuánto se espera un comando antes de matarlo. Un `npm install` entra; un servidor no. */
const TIEMPO_LIMITE_MS = 120_000;

/** Tope de salida. Un `find /` sin filtro llena la memoria del backend y la de la app. */
const SALIDA_MAXIMA = 200_000;

export type ResultadoDeComando = {
  ok: boolean;
  comando: string;
  salida: string;
  codigo: number | null;
  cwd: string;
  compartidaConLaIA: boolean;
  cortadoPorTiempo: boolean;
  bloqueado?: string;
};

/**
 * La terminal que comparten Esteban y Niki.
 *
 * No es una terminal nueva: entra a la que la IA ya usa. El runtime guarda el estado de su
 * sesión —directorio y entorno— en dos archivos del temporal y los relee en cada comando
 * (ver terminal-sesion.ts). Usando la misma receta sobre los mismos archivos, los dos
 * quedan parados en el mismo lugar: si Niki hace `cd`, la terminal de Esteban aparece ahí,
 * y si él exporta una variable, ella la ve.
 *
 * Eso es lo que se pidió y también es un filo: son dos manos en un teclado. Si Esteban se
 * va a /tmp y después le pide a Niki que lea un archivo del proyecto, ella busca en /tmp.
 *
 * No hay PTY. Cada comando es un bash nuevo, igual que para la IA: `vim`, `top` y `ssh` no
 * andan. Ponerlos pide un módulo nativo y un emulador de terminal, y no es lo que se pidió.
 */
@Injectable()
export class TerminalCompartidaService {
  private readonly logger = new Logger(TerminalCompartidaService.name);

  /** Dónde está parada la terminal y si es la de la IA. */
  estado(): { cwd: string; compartidaConLaIA: boolean; sesion: string } {
    const s = this.sesion();
    return { cwd: s.cwd, compartidaConLaIA: s.compartidaConLaIA, sesion: s.id };
  }

  private sesion(): SesionDeTerminal {
    return sesionDeLaIA() ?? sesionPropia(RAIZ);
  }

  /**
   * Corre un comando de Esteban en la sesión de la IA.
   *
   * Los comandos catastróficos —`rm -rf /`, `mkfs`, bomba de forks— piden confirmación
   * explícita aunque los escriba él. Es a propósito y es distinto de una terminal de
   * verdad: acá se tipea en una cajita adentro de una app, sin el ritual de abrir la
   * Terminal, y un dedo de más no tiene deshacer. Son doce patrones que no aparecen en el
   * trabajo normal, así que el costo de la fricción es cero salvo el día que salva algo.
   */
  async ejecutar(comando: string, opciones: { confirmado?: boolean } = {}): Promise<ResultadoDeComando> {
    const limpio = comando.trim();
    const sesion = this.sesion();

    if (!limpio) {
      return {
        ok: false, comando, salida: "", codigo: null,
        cwd: sesion.cwd, compartidaConLaIA: sesion.compartidaConLaIA, cortadoPorTiempo: false,
      };
    }

    const peligro = blockedShellReason(limpio);
    if (peligro && !opciones.confirmado) {
      return {
        ok: false,
        comando: limpio,
        salida: "",
        codigo: null,
        cwd: sesion.cwd,
        compartidaConLaIA: sesion.compartidaConLaIA,
        cortadoPorTiempo: false,
        bloqueado: peligro,
      };
    }

    const guion = guionParaSesion(sesion, limpio);
    const { salida, codigo, cortadoPorTiempo } = await this.correr(guion);
    const despues = this.sesion();

    this.logger.log(
      `[terminal] ${sesion.compartidaConLaIA ? "sesión de la IA" : "sesión propia"} ` +
        `${sesion.cwd} $ ${limpio.slice(0, 120)} → código ${codigo}`,
    );

    return {
      ok: codigo === 0,
      comando: limpio,
      salida,
      codigo,
      cwd: despues.cwd,
      compartidaConLaIA: despues.compartidaConLaIA,
      cortadoPorTiempo,
    };
  }

  private correr(guion: string): Promise<{ salida: string; codigo: number | null; cortadoPorTiempo: boolean }> {
    return new Promise((resolve) => {
      // zsh es el shell de Esteban, pero el snapshot lo escribe bash (`export -p`,
      // `declare -f`): se corre con bash para que lo que dejó el runtime se pueda leer.
      const proc = spawn("/bin/bash", ["-c", guion], { cwd: RAIZ, env: process.env });
      let salida = "";
      let cortadoPorTiempo = false;
      let cerrado = false;

      const acumular = (c: Buffer) => {
        if (salida.length >= SALIDA_MAXIMA) return;
        salida += c.toString();
        if (salida.length > SALIDA_MAXIMA) {
          salida = `${salida.slice(0, SALIDA_MAXIMA)}\n…[cortado: la salida pasó los ${SALIDA_MAXIMA} caracteres]`;
          // Un comando que escupe sin parar no se deja correr hasta el timeout.
          proc.kill("SIGKILL");
        }
      };
      // stderr va junto a stdout: en una terminal se ven mezclados y en el orden real.
      proc.stdout.on("data", acumular);
      proc.stderr.on("data", acumular);

      const reloj = setTimeout(() => {
        cortadoPorTiempo = true;
        proc.kill("SIGKILL");
      }, TIEMPO_LIMITE_MS);

      const terminar = (codigo: number | null) => {
        if (cerrado) return;
        cerrado = true;
        clearTimeout(reloj);
        resolve({ salida, codigo, cortadoPorTiempo });
      };

      proc.on("close", terminar);
      proc.on("error", (error) => {
        salida += `\n[no se pudo ejecutar: ${String(error)}]`;
        terminar(null);
      });
    });
  }
}
