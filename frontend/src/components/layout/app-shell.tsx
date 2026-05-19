import type { CSSProperties, ReactNode } from "react";

const platformTopInset: CSSProperties = {
  paddingTop: "max(env(safe-area-inset-top, 0px), 16px)",
};

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#060810] font-sans text-white">
      {/* macOS titlebar overlay — drag region over entire top bar */}
      <div
        data-tauri-drag-region
        className="fixed inset-x-0 top-0 z-50 h-9 pointer-events-none select-none"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />
      <div className="flex-1 overflow-hidden box-border" style={platformTopInset}>
        {children}
      </div>
    </div>
  );
}
