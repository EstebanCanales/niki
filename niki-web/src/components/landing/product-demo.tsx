"use client";

import { useState } from "react";

import { NikiOrb, NikiOrbState } from "./niki-orb";

const moments: Array<{
  state: Exclude<NikiOrbState, "resting">;
  action: string;
  message: string;
}> = [
  {
    state: "listening",
    action: "Escuchar",
    message: "Dime qué necesitas.",
  },
  {
    state: "thinking",
    action: "Pensar",
    message: "Pensando contigo.",
  },
  {
    state: "acting",
    action: "Actuar",
    message: "Listo para actuar, cuando tú confirmes.",
  },
];

export function ProductDemo() {
  const [activeState, setActiveState] = useState<(typeof moments)[number]["state"]>("listening");
  const activeMoment = moments.find((moment) => moment.state === activeState) ?? moments[0];

  return (
    <section className="presence-plane" aria-label="Presencia de Niki">
      <div className="presence-status">
        <span aria-hidden="true" />
        Disponible en tu Mac
      </div>

      <div className="presence-stage">
        <div className="presence-notch" aria-hidden="true">
          <i />
        </div>
        <div className="presence-horizon" aria-hidden="true" />
        <NikiOrb state={activeMoment.state} />
        <p aria-live="polite">{activeMoment.message}</p>
      </div>

      <div className="presence-controls" aria-label="Estados de Niki">
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
      </div>
    </section>
  );
}
