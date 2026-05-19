"use client";

import { useRef, useEffect } from "react";
import { ChatSidebar } from "@/features/chat/chat-sidebar";
import { SessionsView } from "@/features/sessions/sessions-view";
import { TasksView } from "@/features/tasks/tasks-view";
import { SettingsView } from "@/features/settings/settings-view";
import { MessageSquare, CheckSquare, Settings2 } from "lucide-react";
import {
  navSidebarInnerClassName,
  navSidebarShellClassName,
} from "@/components/layout/nav-visuals";
import { OrbIndicator } from "@/components/layout/orb-indicator";
import { useWorkspaceStore } from "@/stores/use-workspace-store";
import type { MiniPanelTab, PanelDef } from "./types";

const PANEL_CONTENT: Record<string, PanelDef> = {
  chat: { label: "Chat", icon: MessageSquare, content: <ChatSidebar /> },
  sessions: {
    label: "Sessions",
    icon: MessageSquare,
    content: <SessionsView />,
  },
  tasks: { label: "Tasks", icon: CheckSquare, content: <TasksView /> },
  settings: { label: "Settings", icon: Settings2, content: <SettingsView /> },
};

const panelStyle: React.CSSProperties = {
  width: 560,
  borderRadius: 20,
};

function rgbaFromHex(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const value =
    clean.length === 3
      ? clean
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : clean.padEnd(6, "0");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function MiniPanel({
  open,
  onClose,
  panel,
}: {
  open: boolean;
  onClose(): void;
  panel: MiniPanelTab | null;
}) {
  const info = panel ? PANEL_CONTENT[panel] : null;
  const asideRef = useRef<HTMLElement>(null);
  const sidebarAudioActive = useWorkspaceStore((s) => s.sidebarAudioActive);
  const agentGridCellColor = useWorkspaceStore((s) => s.agentGridCellColor);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (asideRef.current && !asideRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open, onClose]);

  return (
    <aside
      ref={asideRef}
      className={`fixed left-4 top-4 bottom-4 z-50 flex flex-col overflow-hidden ${navSidebarShellClassName}`}
      style={{
        ...panelStyle,
        transform: open ? "translateX(0)" : "translateX(calc(-100% - 16px))",
        transition: "transform 0.4s cubic-bezier(0.32,0.72,0,1)",
        boxShadow: sidebarAudioActive
          ? `0 0 0 1px rgba(255,255,255,0.08), 0 0 0 2px ${rgbaFromHex(agentGridCellColor, 0.1)}, 0 0 52px ${rgbaFromHex(agentGridCellColor, 0.16)}, 0 40px 80px -20px rgba(0,0,0,0.9), 0 10px 30px -10px rgba(0,0,0,0.7), inset 0 2px 3px -1px rgba(255,255,255,0.08), inset 0 -2px 4px -1px rgba(255,255,255,0.03), inset 0 0 0 1px rgba(255,255,255,0.06)`
          : undefined,
      }}
    >
      <div
        className={`relative z-10 flex-1 overflow-hidden ${navSidebarInnerClassName}`}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-[linear-gradient(180deg,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0)_100%)]" />
        <div className="relative h-full overflow-y-auto scrollbar-subtle">
          {info?.content}
        </div>
      </div>
    </aside>
  );
}
