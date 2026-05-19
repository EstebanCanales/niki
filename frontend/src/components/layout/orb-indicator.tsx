"use client";

import { useWorkspaceStore } from "@/stores/use-workspace-store";
import type { AgentVisualState } from "@/types/niki";

export function OrbIndicator({
  state,
  size = 16,
  fixed = false,
}: {
  state: AgentVisualState;
  size?: number;
  fixed?: boolean;
}) {
  const orbColors = useWorkspaceStore((s) => s.orbColors);

  const background =
    fixed
      ? orbColors.normal
      : state === "error"
        ? orbColors.error
        : state === "success"
          ? orbColors.success
          : orbColors.normal;

  return (
    <div
      className="rounded-full"
      style={{
        width: size,
        height: size,
        background,
        boxShadow: fixed
          ? "0 0 18px rgba(0,200,255,0.22), 0 0 36px rgba(0,200,255,0.12)"
          : "0 0 14px rgba(255,255,255,0.15)",
        animation: "niki-breathe 5.2s ease-in-out infinite",
      }}
    />
  );
}
