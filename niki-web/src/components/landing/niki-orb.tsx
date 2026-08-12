"use client";

import { useEffect, useRef } from "react";

export type NikiOrbState = "listening" | "thinking" | "acting" | "resting";

interface NikiOrbProps {
  className?: string;
  state?: NikiOrbState;
}

const stateLabels: Record<NikiOrbState, string> = {
  listening: "Niki está escuchando",
  thinking: "Niki está pensando",
  acting: "Niki está actuando",
  resting: "Niki está disponible",
};

const stateMotion: Record<NikiOrbState, { energy: number; speed: number }> = {
  listening: { energy: 0.82, speed: 0.72 },
  thinking: { energy: 0.62, speed: 1.35 },
  acting: { energy: 0.96, speed: 1.05 },
  resting: { energy: 0.46, speed: 0.35 },
};

export function NikiOrb({ className = "", state = "resting" }: NikiOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const surface = canvas;
    const painter = context;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motion = stateMotion[state];
    let animationFrame = 0;
    let start = performance.now();

    function draw(now: number) {
      const bounds = surface.getBoundingClientRect();
      const width = Math.max(bounds.width, 220);
      const height = Math.max(bounds.height, 220);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

      if (surface.width !== width * pixelRatio || surface.height !== height * pixelRatio) {
        surface.width = width * pixelRatio;
        surface.height = height * pixelRatio;
        painter.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      }

      const time = reduceMotion ? 0 : (now - start) / 1000;
      const centerX = width / 2;
      const centerY = height / 2;
      const radius = Math.min(width, height) * 0.235;
      painter.clearRect(0, 0, width, height);

      const halo = painter.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius * 2.5);
      halo.addColorStop(0, "rgba(105, 230, 255, 0.19)");
      halo.addColorStop(0.42, "rgba(73, 168, 195, 0.075)");
      halo.addColorStop(1, "rgba(9, 12, 16, 0)");
      painter.fillStyle = halo;
      painter.fillRect(0, 0, width, height);

      for (let index = 0; index < 92; index += 1) {
        const seed = index * 2.399963;
        const layer = 0.18 + ((index * 37) % 83) / 100;
        const pulse = Math.sin(time * motion.speed + index * 0.43) * 4 * motion.energy;
        const orbit = seed + time * motion.speed * (index % 2 === 0 ? 0.16 : -0.11);
        const distance = radius * layer + pulse;
        const squash = state === "listening" ? 1.14 : state === "acting" ? 0.86 : 1;
        const x = centerX + Math.cos(orbit) * distance * squash;
        const y = centerY + Math.sin(orbit) * distance;
        const pointRadius = index % 11 === 0 ? 1.9 : 0.75 + layer * 0.7;
        painter.beginPath();
        painter.arc(x, y, pointRadius, 0, Math.PI * 2);
        painter.fillStyle = `rgba(${index % 7 === 0 ? "218, 249, 255" : "91, 218, 245"}, ${0.25 + layer * 0.68})`;
        painter.fill();
      }

      painter.beginPath();
      painter.arc(centerX, centerY, radius * (0.66 + motion.energy * 0.05), 0, Math.PI * 2);
      painter.fillStyle = "rgba(12, 24, 30, 0.72)";
      painter.fill();
      painter.strokeStyle = "rgba(159, 239, 255, 0.25)";
      painter.lineWidth = 0.8;
      painter.stroke();

      if (!reduceMotion) animationFrame = window.requestAnimationFrame(draw);
    }

    draw(start);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [state]);

  return (
    <div
      aria-label={stateLabels[state]}
      className={`niki-orb niki-orb--${state} ${className}`.trim()}
      data-state={state}
      role="img"
    >
      <span className="niki-orb__volume" aria-hidden="true" />
      <span className="niki-orb__texture" aria-hidden="true" />
      <canvas aria-hidden="true" ref={canvasRef} />
      <span className="niki-orb__core" aria-hidden="true" />
    </div>
  );
}
