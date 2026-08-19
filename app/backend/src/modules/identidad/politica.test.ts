import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { juntarSenales, SIN_SENAL, type SenalDeIdentidad } from "./identidad.types";
import { AjusteDeIdentidad, decidir, puedeEscribir, type ModoAjeno } from "./politica";

const si: SenalDeIdentidad = { registrado: true, coincide: true, puntaje: 0.9, umbral: 0.6 };
const no: SenalDeIdentidad = { registrado: true, coincide: false, puntaje: 0.2, umbral: 0.6 };
const noMiro: SenalDeIdentidad = { registrado: true, coincide: null, puntaje: null, umbral: 0.6 };

/** La tabla completa: cada combinación de señales, con cada ajuste. */
const CASOS: {
  que: string;
  cara: SenalDeIdentidad;
  voz: SenalDeIdentidad;
  espera: Record<ModoAjeno, string>;
}[] = [
  {
    que: "las dos lo confirman",
    cara: si, voz: si,
    espera: { sinDatos: "pasa", ignorar: "pasa", avisar: "pasa" },
  },
  {
    que: "solo la voz lo confirma, la cámara no miró",
    cara: noMiro, voz: si,
    espera: { sinDatos: "pasa", ignorar: "pasa", avisar: "pasa" },
  },
  {
    que: "solo la cara lo confirma, sin audio",
    cara: si, voz: SIN_SENAL,
    espera: { sinDatos: "pasa", ignorar: "pasa", avisar: "pasa" },
  },
  {
    // El caso que ordena el ajuste: acá cada uno quiere algo distinto.
    que: "la voz dice que NO es él",
    cara: noMiro, voz: no,
    espera: { sinDatos: "pasaSinDatos", ignorar: "descarta", avisar: "pasa" },
  },
  {
    // Una en contra manda aunque la otra diga que sí: ver juntarSenales.
    que: "la cara dice que sí pero la voz dice que no",
    cara: si, voz: no,
    espera: { sinDatos: "pasaSinDatos", ignorar: "descarta", avisar: "pasa" },
  },
  {
    // El caso más común: chat de texto, cámara tapada, sin perfil de voz.
    que: "no hay ninguna señal",
    cara: SIN_SENAL, voz: SIN_SENAL,
    espera: { sinDatos: "pasaSinDatos", ignorar: "pasaSinDatos", avisar: "pasaSinDatos" },
  },
  {
    que: "registrado pero ninguna pudo mirar",
    cara: noMiro, voz: noMiro,
    espera: { sinDatos: "pasaSinDatos", ignorar: "pasaSinDatos", avisar: "pasaSinDatos" },
  },
];

for (const caso of CASOS) {
  test(`decisión: ${caso.que}`, () => {
    const v = juntarSenales(caso.cara, caso.voz);
    for (const modo of ["sinDatos", "ignorar", "avisar"] as ModoAjeno[]) {
      const r = decidir(v, modo);
      assert.equal(r.decision, caso.espera[modo], `con modo "${modo}"`);
      assert.ok(r.motivo.length > 0, "toda decisión tiene que decir por qué");
    }
  });
}

test("no saber nunca hace que deje de contestar", () => {
  // Es la regla que evita que Niki se quede muda con la cámara tapada, que es lo normal.
  const v = juntarSenales(SIN_SENAL, SIN_SENAL);
  for (const modo of ["sinDatos", "ignorar", "avisar"] as ModoAjeno[]) {
    assert.notEqual(decidir(v, modo).decision, "descarta", `con modo "${modo}"`);
  }
});

test("solo un turno confirmado deja rastro", () => {
  // La prueba de "que ni sea afectada": lo que gobierna las escrituras es esto.
  assert.equal(puedeEscribir("pasa"), true);
  assert.equal(puedeEscribir("pasaSinDatos"), false);
  assert.equal(puedeEscribir("descarta"), false);
});

test("el ajuste se guarda y sobrevive al reinicio", () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "niki-ident-"));
  const ajuste = new AjusteDeIdentidad(carpeta);

  assert.equal(ajuste.leer(), "sinDatos", "el de por defecto es el prudente");
  ajuste.escribir("ignorar");
  // Instancia nueva: como después de reiniciar el backend.
  assert.equal(new AjusteDeIdentidad(carpeta).leer(), "ignorar");
});

test("un ajuste corrupto cae en el de por defecto en vez de romper", () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "niki-ident-"));
  fs.writeFileSync(path.join(carpeta, "modo-ajeno"), "cualquier cosa");
  assert.equal(new AjusteDeIdentidad(carpeta).leer(), "sinDatos");
});
