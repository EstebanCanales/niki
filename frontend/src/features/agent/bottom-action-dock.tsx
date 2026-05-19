"use client";

import { useState } from "react";
import { MessageSquare, Phone, Settings2 } from "lucide-react";
import {
  dockToneClass,
  navDockGlassClassName,
  navDockTopReflectionClassName,
  navIconColorClass,
} from "@/components/layout/nav-visuals";
import type { MiniPanelTab, WidgetDef } from "./types";

function cn(...inputs: (string | false | undefined)[]) {
  return inputs.filter(Boolean).join(" ");
}

interface DockItem {
  id: string;
  label: string;
  icon: React.ElementType;
  onClick(): void;
  disabled?: boolean;
  active?: boolean;
  isWidget?: boolean;
}

export function BottomActionDock({
  activePanel,
  appItems,
  busy: _busy,
  onChat,
  onNewChat: _onNewChat,
  onSettings,
  onSelect,
  autoVoiceConversation,
  setAutoVoiceConversation,
  setAutoVoice,
}: {
  activePanel: MiniPanelTab | null;
  appItems: WidgetDef[];
  busy?: boolean;
  onChat(): void;
  onNewChat?(): void;
  onSettings(): void;
  onSelect(id: MiniPanelTab): void;
  autoVoiceConversation: boolean;
  setAutoVoiceConversation: (v: boolean) => void;
  setAutoVoice: (v: boolean) => void;
}) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  const chatItem: DockItem = {
    id: "chat",
    label: "Chat",
    icon: MessageSquare,
    onClick: onChat,
    disabled: false,
    active: false,
  };

  const widgetItems: DockItem[] = appItems.map((w) => ({
    id: w.id,
    label: w.label,
    icon: w.icon,
    onClick: () => onSelect(w.id as MiniPanelTab),
    disabled: false,
    active: activePanel === w.id,
    isWidget: true,
  }));

  const voiceItem: DockItem = {
    id: "voice",
    label: autoVoiceConversation ? "Voice mode" : "Text mode",
    icon: Phone,
    onClick: () => {
      const next = !autoVoiceConversation;
      setAutoVoiceConversation(next);
      if (next) setAutoVoice(true);
    },
    disabled: false,
    active: autoVoiceConversation,
  };

  const settingsItem: DockItem = {
    id: "settings",
    label: "Settings",
    icon: Settings2,
    onClick: onSettings,
    disabled: false,
    active: false,
  };

  const allItems: DockItem[] = [chatItem, ...widgetItems, voiceItem, settingsItem];

  return (
    <div className="fixed bottom-3 right-3 z-50">
      <div
        className={`relative flex items-center gap-0.5 border border-white/[0.08] p-2 ${navDockGlassClassName}`}
      >
        <div className={navDockTopReflectionClassName} />

        {allItems.map((item, index) => {
          const hovered = hoveredItem === item.id;
          const isSeparator =
            item.id !== settingsItem.id &&
            allItems[index + 1]?.id === settingsItem.id &&
            widgetItems.length > 0;

          return (
            <div key={item.id} className="relative flex items-center">
              <button
                disabled={item.disabled}
                onClick={item.onClick}
                onMouseEnter={() => setHoveredItem(item.id)}
                onMouseLeave={() =>
                  setHoveredItem((current) =>
                    current === item.id ? null : current,
                  )
                }
                className={cn(
                  "group relative flex h-10 w-10 items-center justify-center rounded-full border-none outline-none transition-all duration-200 disabled:opacity-40",
                  dockToneClass(item.active ?? false, hovered),
                )}
                title={item.label}
              >
                <item.icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    navIconColorClass(item.active ?? false, hovered),
                  )}
                />

                {/* Tooltip */}
                <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-black/80 px-2.5 py-1 text-[11px] font-medium text-white/90 opacity-0 shadow-lg backdrop-blur-md transition-opacity duration-150 group-hover:opacity-100">
                  {item.label}
                </span>
              </button>

              {isSeparator && (
                <div className="mx-1.5 h-5 w-px bg-white/[0.08]" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
