"use client";

import { useMemo } from "react";
import { useWorkspaceStore } from "@/stores/use-workspace-store";

export function SessionsView() {
  const chatSessions = useWorkspaceStore((state) => state.chatSessions);
  const activeChatSessionId = useWorkspaceStore((state) => state.activeChatSessionId);
  const setActiveChatSession = useWorkspaceStore((state) => state.setActiveChatSession);
  const createChatSession = useWorkspaceStore((state) => state.createChatSession);

  const sessions = useMemo(
    () =>
      [...chatSessions].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [chatSessions],
  );

  const handleCreate = () => {
    const sessionId = createChatSession();
    setActiveChatSession(sessionId);
  };

  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-white/[0.05] flex items-center justify-between">
        <p className="text-xs text-white/40">{sessions.length} chats</p>
        <button
          onClick={handleCreate}
          className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-xs text-white/70 transition hover:bg-white/[0.07] hover:text-white"
        >
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-0.5 px-2 py-2">
        {sessions.length === 0 && (
          <p className="px-3 py-4 text-xs text-white/25 text-center">No conversations yet.</p>
        )}
        {sessions.map((session) => {
          const active = session.id === activeChatSessionId;
          return (
            <button
              key={session.id}
              onClick={() => setActiveChatSession(session.id)}
              className="w-full rounded-2xl px-3 py-2.5 text-left transition"
              style={{
                background: active
                  ? "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))"
                  : "transparent",
                boxShadow: active ? "inset 0 0 0 1px rgba(255,255,255,0.05)" : "none",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-white/85">{session.title}</p>
                <span className="shrink-0 text-[10px] text-white/24">{formatDate(session.updatedAt)}</span>
              </div>
              <p className="mt-0.5 line-clamp-1 text-xs text-white/32">{session.summary}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
