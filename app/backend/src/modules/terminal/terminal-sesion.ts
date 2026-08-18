import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Cómo entrar a la sesión de terminal que usa la IA.
 *
 * El runtime no mantiene un shell vivo: corre cada comando en un `bash` nuevo y hace que
 * parezca una sesión guardando dos archivos en el directorio temporal
 * (`tools/environments/base.py:318`):
 *
 *   hermes-snap-<id>.sh   variables de entorno, funciones y alias (`export -p`, `declare -f`)
 *   hermes-cwd-<id>.txt   el directorio donde quedó
 *
 * Cada comando hace `source` del primero, `cd` a lo que dice el segundo, corre, y vuelve a
 * escribir los dos. Si el backend usa la misma receta sobre los mismos archivos, queda en
 * la misma sesión que la IA — mismo directorio, mismas variables — sin tocar el fork.
 *
 * El `<id>` es un uuid al azar que el runtime genera al crear su entorno, no el id de la
 * conversación: no se puede deducir, hay que encontrarlo. Se saca del log de Niki, donde
 * el runtime deja "Session snapshot created (session=...)" al abrir su entorno.
 *
 * Antes se tomaba el archivo más reciente del temporal, y eso estaba mal: si en la misma
 * máquina corre otro Hermes —el personal de Esteban, en ~/.hermes— escribe en el mismo
 * directorio con el mismo formato de nombre, y la terminal de Niki terminaba metida en la
 * sesión del otro. Pasó: la terminal apareció parada en /Users/estebancanales, que era
 * donde estaba el Hermes personal. El log de agent-home, en cambio, es de Niki y de nadie
 * más.
 *
 * ## Qué se comparte y qué no (medido, no supuesto)
 *
 * - **El entorno va en los dos sentidos.** Probado: `export NIKI_PRUEBA=...` escrito acá,
 *   y la IA lo leyó en su siguiente comando. Es porque ella hace `source` del snapshot
 *   antes de cada comando, así que ve lo último que haya.
 * - **El directorio va solo de ella hacia acá.** Probado: ella hizo `cd /tmp` y esta
 *   terminal apareció en /tmp; al revés no. El runtime le pasa a `_wrap_command` el
 *   directorio que tiene en memoria y recién relee el archivo *después* de ejecutar
 *   (`tools/environments/local.py:600`), así que el valor que escribimos nosotros lo pisa
 *   su propio `pwd`.
 *
 * Se podría igualar tocando el fork, y no vale: es un conflicto futuro cada vez que
 * traigamos upstream (ver app/agent-runtime/UPSTREAM.md) a cambio de que el `cd` de
 * Esteban pueda mover a Niki a mitad de una tarea, que tampoco está claro que se quiera.
 * O sea: esta terminal **sigue** a Niki, y el `cd` propio dura hasta que ella se mueva.
 */

/** Dónde escribe el runtime, que es `/tmp` salvo que TMPDIR diga otra cosa. En macOS dice. */
/** El log del runtime de Niki. Es de Niki y de nadie más: por eso sirve para distinguir
 *  sus sesiones de las de cualquier otro Hermes que corra en la misma máquina. */
export const LOG_DE_NIKI = path.resolve(
  __dirname, "..", "..", "..", "agent-home", "logs", "agent.log",
);

export function directorioTemporal(): string {
  return process.env.TMPDIR?.replace(/\/$/, "") || os.tmpdir() || "/tmp";
}

export type SesionDeTerminal = {
  id: string;
  archivoCwd: string;
  archivoSnapshot: string;
  /** Dónde está parada la sesión ahora mismo. */
  cwd: string;
  /** false cuando la IA todavía no corrió nada y esta sesión la abrió Esteban. */
  compartidaConLaIA: boolean;
};

/**
 * La sesión que la IA está usando, o null si todavía no corrió ningún comando.
 *
 * Se elige por fecha de modificación y no por nombre: los archivos de gateways anteriores
 * quedan en el temporal, y tomar uno viejo sería aterrizar en el directorio de anteayer.
 */
/** Las sesiones que abrió el runtime de Niki, la más nueva primero. */
export function sesionesDeNiki(log = LOG_DE_NIKI): string[] {
  let texto = "";
  try {
    // Solo el final del archivo: crece sin parar y lo único que interesa es lo último.
    const fd = fs.openSync(log, "r");
    const { size } = fs.fstatSync(fd);
    const desde = Math.max(0, size - 200_000);
    const buffer = Buffer.alloc(size - desde);
    fs.readSync(fd, buffer, 0, buffer.length, desde);
    fs.closeSync(fd);
    texto = buffer.toString("utf8");
  } catch {
    return [];
  }

  const ids: string[] = [];
  for (const m of texto.matchAll(/Session snapshot created \(session=([0-9a-f]{6,})/g)) {
    ids.push(m[1]);
  }
  return ids.reverse();
}

export function sesionDeLaIA(temp = directorioTemporal(), log = LOG_DE_NIKI): SesionDeTerminal | null {
  const candidatos = sesionesDeNiki(log).map((id) => ({ id }));
  if (candidatos.length === 0) return null;

  for (const { id } of candidatos) {
    const archivoCwd = path.join(temp, `hermes-cwd-${id}.txt`);
    const archivoSnapshot = path.join(temp, `hermes-snap-${id}.sh`);
    // Sin el snapshot no hay entorno que compartir; sería una sesión a medias.
    if (!fs.existsSync(archivoSnapshot)) continue;
    const cwd = leerCwd(archivoCwd);
    if (!cwd) continue;
    return { id, archivoCwd, archivoSnapshot, cwd, compartidaConLaIA: true };
  }
  return null;
}

function leerCwd(archivo: string): string {
  try {
    const valor = fs.readFileSync(archivo, "utf8").trim();
    // Si la IA borró el directorio donde estaba, `cd` fallaría con 126 y el comando de
    // Esteban se perdería sin explicación.
    return valor && fs.existsSync(valor) ? valor : "";
  } catch {
    return "";
  }
}

/**
 * El guion que corre un comando dentro de una sesión.
 *
 * Es la misma receta de `_wrap_command` del runtime, en el mismo orden: cargar el
 * snapshot, ir al directorio, ejecutar, volver a volcar el entorno y anotar el directorio
 * nuevo. Cualquier diferencia acá significa que la IA y Esteban terminan en sesiones que
 * se parecen pero no son la misma.
 */
export function guionParaSesion(sesion: SesionDeTerminal, comando: string): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const partes = [
    `source ${q(sesion.archivoSnapshot)} >/dev/null 2>&1 || true`,
    `builtin cd -- ${q(sesion.cwd)} || exit 126`,
    comando,
    "__niki_ec=$?",
    // Se vuelca el entorno de vuelta para que un `export` de Esteban lo vea la IA.
    `export -p > ${q(sesion.archivoSnapshot)} 2>/dev/null || true`,
    `pwd -P > ${q(sesion.archivoCwd)} 2>/dev/null || true`,
    "exit $__niki_ec",
  ];
  return partes.join("\n");
}

/**
 * Una sesión propia, para cuando la IA todavía no abrió la suya.
 *
 * No intenta adivinar ni crear la de la IA: el runtime genera su uuid cuando quiere, y
 * fabricar archivos con otro nombre no haría que los adopte. Esta sesión es real y
 * funciona; cuando la IA corra algo, la terminal se pasa a la suya sola.
 */
export function sesionPropia(raiz: string, temp = directorioTemporal()): SesionDeTerminal {
  // A propósito no es hexadecimal: el runtime nombra las suyas con `uuid4().hex[:12]`, así
  // que un id con letras fuera de a-f nunca puede confundirse con una sesión de la IA
  // cuando se buscan las suyas.
  const id = "niki";
  const archivoCwd = path.join(temp, `hermes-cwd-${id}.txt`);
  const archivoSnapshot = path.join(temp, `hermes-snap-${id}.sh`);
  const cwd = leerCwd(archivoCwd) || raiz;
  if (!fs.existsSync(archivoSnapshot)) {
    fs.writeFileSync(archivoSnapshot, "");
  }
  return { id, archivoCwd, archivoSnapshot, cwd, compartidaConLaIA: false };
}
