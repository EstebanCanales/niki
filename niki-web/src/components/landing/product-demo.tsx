"use client";

import { useState } from "react";

import { NikiOrb, NikiOrbState } from "./niki-orb";

const moments: Array<{
  state: Exclude<NikiOrbState, "resting">;
  action: string;
  cue: string;
  message: string;
}> = [
  {
    state: "listening",
    action: "Escuchar",
    cue: "Tu voz, en el centro",
    message: "Dime qué necesitas.",
  },
  {
    state: "thinking",
    action: "Pensar",
    cue: "El contexto toma forma",
    message: "Pensando contigo.",
  },
  {
    state: "acting",
    action: "Actuar",
    cue: "Tu permiso decide",
    message: "Listo para actuar, cuando tú confirmes.",
  },
];

export function ProductDemo() {
  const [activeState, setActiveState] = useState<(typeof moments)[number]["state"]>("listening");
  const activeMoment = moments.find((moment) => moment.state === activeState) ?? moments[0];

  return (
    <section
      className="presence-plane"
      aria-label="Presencia de Niki"
      data-plane="presence"
      data-presence-state={activeMoment.state}
    >
      <p className="presence-status">
        <span aria-hidden="true" />
        Niki está aquí
      </p>

      <div className="presence-stage">
        <div className="presence-notch" data-notch aria-hidden="true">
          <i />
        </div>
        <div className="presence-focal-light" aria-hidden="true" />
        <div className="presence-horizon" aria-hidden="true" />
        <NikiOrb state={activeMoment.state} />
        <div className="presence-copy" aria-live="polite">
          <span>{activeMoment.cue}</span>
          <p>{activeMoment.message}</p>
        </div>
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
