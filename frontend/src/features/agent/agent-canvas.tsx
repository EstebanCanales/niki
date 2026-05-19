"use client";

import { useRef, useEffect } from "react";
import { CELL_SIZE } from "./constants";
import { drawAgentGrid } from "./grid-engine";
import type { Phase } from "./types";
import { useWorkspaceStore } from "@/stores/use-workspace-store";

function rgbFromHex(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const value =
    clean.length === 3
      ? clean
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : clean.padEnd(6, "0");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

export function AgentCanvas({
  phase,
  sttListening,
  gridBitmap,
  railOffset,
  menuOpen,
  morphOut,
  onActivate,
  onMorphOutComplete,
  cellSizeRef,
}: {
  phase: Phase;
  sttListening: boolean;
  gridBitmap: boolean[][] | null;
  railOffset: number;
  menuOpen: boolean;
  morphOut: boolean;
  onActivate(x: number, y: number): void;
  onMorphOutComplete(): void;
  cellSizeRef: React.RefObject<number>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef(0);
  const agentGridCellColor = useWorkspaceStore((s) => s.agentGridCellColor);

  const phaseRef = useRef(phase);
  const listeningRef = useRef(sttListening);
  const bitmapRef = useRef(gridBitmap);
  const prevBitmapRef = useRef(gridBitmap);
  const menuOpenRef = useRef(menuOpen);
  const morphOutRef = useRef(morphOut);
  const bitmapRevealRef = useRef(gridBitmap ? 1 : 0);
  const exitProgressRef = useRef(1);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    listeningRef.current = sttListening;
  }, [sttListening]);

  useEffect(() => {
    if (gridBitmap && !prevBitmapRef.current) {
      bitmapRevealRef.current = 0;
    }
    prevBitmapRef.current = gridBitmap;
    bitmapRef.current = gridBitmap;
  }, [gridBitmap]);

  useEffect(() => {
    if (menuOpen && !menuOpenRef.current) {
      exitProgressRef.current = 1;
    }
    menuOpenRef.current = menuOpen;
  }, [menuOpen]);

  useEffect(() => {
    morphOutRef.current = morphOut;
  }, [morphOut]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let frameHandle = 0;
    let resizeHandle = 0;

    let lastAt = 0;
    const render = (timestamp = 0) => {
      const target = canvasRef.current;
      if (!target || document.hidden) {
        frameHandle = window.requestAnimationFrame(render);
        return;
      }
      if (timestamp - lastAt < 16) {
        frameHandle = window.requestAnimationFrame(render);
        return;
      }
      lastAt = timestamp;

      if (morphOutRef.current) {
        bitmapRevealRef.current = Math.max(0, bitmapRevealRef.current - 0.045);
        if (bitmapRevealRef.current === 0) {
          onMorphOutComplete();
        }
      } else if (bitmapRef.current && bitmapRevealRef.current < 1) {
        bitmapRevealRef.current = Math.min(1, bitmapRevealRef.current + 0.045);
      }
      if (
        menuOpenRef.current &&
        !bitmapRef.current &&
        exitProgressRef.current > 0
      ) {
        exitProgressRef.current = Math.max(0, exitProgressRef.current - 0.07);
      } else if (!menuOpenRef.current) {
        exitProgressRef.current = 1;
      }
      drawAgentGrid(
        target,
        window.innerWidth - railOffset,
        window.innerHeight,
        frameRef.current,
        phaseRef.current,
        listeningRef.current,
        bitmapRef.current,
        menuOpenRef.current,
        bitmapRevealRef.current,
        exitProgressRef.current,
        rgbFromHex(agentGridCellColor),
        cellSizeRef.current ?? CELL_SIZE,
      );
      frameRef.current += 1;
      frameHandle = window.requestAnimationFrame(render);
    };

    const onResize = () => {
      window.cancelAnimationFrame(resizeHandle);
      resizeHandle = window.requestAnimationFrame(() => {
        const target = canvasRef.current;
        if (!target) return;
        drawAgentGrid(
          target,
          window.innerWidth - railOffset,
          window.innerHeight,
          frameRef.current,
          phaseRef.current,
          listeningRef.current,
          bitmapRef.current,
          menuOpenRef.current,
          bitmapRevealRef.current,
          exitProgressRef.current,
          rgbFromHex(agentGridCellColor),
          cellSizeRef.current ?? CELL_SIZE,
        );
      });
    };

    render();
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(frameHandle);
      window.cancelAnimationFrame(resizeHandle);
      window.removeEventListener("resize", onResize);
    };
  }, [railOffset, onMorphOutComplete, agentGridCellColor]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full cursor-pointer"
      onClick={(e) => onActivate(e.clientX, e.clientY)}
      style={{
        transform: "scale(1.14)",
        transformOrigin: "center center",
      }}
    />
  );
}
