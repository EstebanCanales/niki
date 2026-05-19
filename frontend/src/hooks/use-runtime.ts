"use client";

import { useWorkspaceStore } from "@/stores/use-workspace-store";

export function useRuntime() {
  return useWorkspaceStore((state) => state.runtime);
}
