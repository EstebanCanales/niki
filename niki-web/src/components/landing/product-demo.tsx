"use client";

import { useState } from "react";

import { NikiOrb, NikiOrbState } from "./niki-orb";

const moments: Array<{
  state: Exclude<NikiOrbState, "resting">;
  action: string;
  cue: string;
  title: string;
  detail: string;
}> = [
  {
    state: "listening",
    action: "Escuchar",
    cue: "Voz detectada · Español",
    title: "Habla como hablas.",
    detail: "Niki reconoce tu intención sin obligarte a aprender comandos.",
  },
  {
    state: "thinking",
    action: "Pensar",
    cue: "Contexto personal · Solo lo que permites",
    title: "Continúa donde lo dejaste.",
    detail: "Conecta lo que dijiste con el contexto que ya elegiste guardar.",
  },
  {
    state: "acting",
    action: "Actuar",
    cue: "Herramienta · Calendario",
    title: "Hazlo, con tu permiso.",
    detail: "Prepara la acción, te muestra qué cambiará y espera tu confirmación.",
  },
];

export function ProductDemo() {
  const [activeState, setActiveState] = useState<(typeof moments)[number]["state"]>("listening");
  const activeMoment = moments.find((moment) => moment.state === activeState) ?? moments[0];

  return (
    <div className="product-demo">
      <div
        aria-label="Vista previa del centro de control Niki"
        className="product-demo__window"
        role="region"
      >
        <div className="product-demo__chrome" aria-hidden="true">
          <span />
          <span />
          <span />
          <small>NIKI / CONTROL</small>
        </div>
        <div className="product-demo__body">
          <aside className="product-demo__rail" aria-label="Estados de Niki">
            {moments.map((moment) => (
              <button
                aria-pressed={activeState === moment.state}
                key={moment.state}
                onClick={() => setActiveState(moment.state)}
                type="button"
              >
                <span aria-hidden="true" />
                {moment.action}
              </button>
            ))}
          </aside>
          <div className="product-demo__stage">
            <div className="product-demo__notch" aria-hidden="true">
              <span />
            </div>
            <NikiOrb state={activeMoment.state} />
            <p className="product-demo__cue">{activeMoment.cue}</p>
            <h3>{activeMoment.title}</h3>
            <p className="product-demo__detail">{activeMoment.detail}</p>
          </div>
          <aside className="product-demo__activity" aria-label="Actividad reciente">
            <span className="utility-label">Ahora</span>
            <div>
              <span className="activity-line" />
              <p>{activeMoment.cue}</p>
              <small>Revisión disponible</small>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
