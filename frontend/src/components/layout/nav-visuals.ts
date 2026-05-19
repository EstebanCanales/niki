import type { LucideIcon } from "lucide-react";
import { Bot, CheckSquare, MessageSquare, Settings } from "lucide-react";
import { cn } from "@/core/utils/cn";

export type AgentRailItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

export const agentRailItems: AgentRailItem[] = [
  { href: "/", label: "Agent", icon: Bot },
  { href: "/sessions", label: "Sessions", icon: MessageSquare },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/settings", label: "Settings", icon: Settings },
];

export const navPanelClassName =
  "border-white/[0.06] bg-[#070b11]/78 backdrop-blur-2xl";
export const navCardClassName =
  "rounded-2xl border border-white/[0.08] bg-white/[0.03]";
export const navSidebarShellClassName = cn(
  "bg-[rgba(0,0,0,0.65)] backdrop-blur-[50px] saturate-[200%]",
  "shadow-[0_40px_80px_-20px_rgba(0,0,0,0.9),0_10px_30px_-10px_rgba(0,0,0,0.7),inset_0_2px_3px_-1px_rgba(255,255,255,0.08),inset_0_-2px_4px_-1px_rgba(255,255,255,0.03),inset_0_0_0_1px_rgba(255,255,255,0.06)]",
);
export const navSidebarInnerClassName = cn(
  "rounded-[22px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.045)_0%,rgba(255,255,255,0.02)_100%)]",
  "shadow-[inset_0_1px_0_rgba(255,255,255,0.05),inset_0_0_0_1px_rgba(0,200,255,0.04)]",
);
export const navLogoShellClassName =
  "flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-[#0a1520] shadow-[0_0_18px_rgba(255,255,255,0.04)]";
export const navIconShellClassName =
  "flex h-9 w-9 items-center justify-center rounded-2xl border border-white/[0.06] bg-[#09111a]/80";

export const navDockGlassClassName = cn(
  "rounded-full bg-[rgba(0,0,0,0.65)] backdrop-blur-[50px] saturate-[200%]",
  "shadow-[0_40px_80px_-20px_rgba(0,0,0,0.9),0_10px_30px_-10px_rgba(0,0,0,0.7),inset_0_2px_3px_-1px_rgba(255,255,255,0.10),inset_0_-2px_4px_-1px_rgba(255,255,255,0.03),inset_0_0_0_1px_rgba(255,255,255,0.08)]",
);

export const navDockTopReflectionClassName = cn(
  "pointer-events-none absolute top-px left-px right-[1px] z-[6] h-[46%]",
  "rounded-[99px_99px_24px_24px/99px_99px_12px_12px]",
  "bg-[linear-gradient(180deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0)_100%)]",
);

export function navToneClass(active: boolean, hovered = false): string {
  if (active) {
    return cn(
      "bg-white/[0.08] border-white/15 text-white/90",
      "shadow-[0_0_0_1px_rgba(255,255,255,0.06),inset_0_0_28px_rgba(255,255,255,0.03)]",
    );
  }
  if (hovered) {
    return "bg-white/[0.04] border-white/[0.08] text-white/80";
  }
  return "bg-transparent border-white/[0.04] text-white/50";
}

export function dockToneClass(active: boolean, hovered = false): string {
  if (active) {
    return cn(
      "bg-white/[0.08] text-white/90",
      "shadow-[0_0_0_1px_rgba(255,255,255,0.06),inset_0_0_28px_rgba(255,255,255,0.03)]",
    );
  }
  if (hovered) {
    return "bg-white/[0.04] text-white/80";
  }
  return "bg-transparent text-white/50";
}

export function navIconColorClass(active: boolean, hovered = false): string {
  if (active) return "text-white/90";
  if (hovered) return "text-white/80";
  return "text-white/50";
}

export function revealLabelClass(expanded: boolean): string {
  return cn(
    "overflow-hidden transition-[max-width,opacity] duration-200",
    expanded ? "max-w-[120px] opacity-100" : "max-w-0 opacity-0",
  );
}
