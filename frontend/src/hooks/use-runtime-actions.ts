"use client";

import { createContext, useContext } from "react";

import type { RuntimeActions } from "@/types/niki";

export const RuntimeActionsContext = createContext<RuntimeActions | null>(null);

export function useRuntimeActions() {
  const actions = useContext(RuntimeActionsContext);

  if (!actions) {
    throw new Error("Runtime actions context is not available.");
  }

  return actions;
}
