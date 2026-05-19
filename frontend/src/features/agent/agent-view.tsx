"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CheckSquare } from "lucide-react";
import { useWorkspaceStore } from "@/stores/use-workspace-store";
import { stripChatControlMarkers } from "@/core/runtime/chat-history";
import { AgentCanvas } from "./agent-canvas";
import { AgentChatDrawer } from "./agent-chat-drawer";
import { BottomActionDock } from "./bottom-action-dock";
import { MiniPanel } from "./mini-panel";
import { useAgentChat } from "./use-agent-chat";
import { useStt } from "./use-stt";
import { CELL_SIZE } from "./constants";
import { nowTs } from "./utils";
import type { MiniPanelTab, WidgetDef } from "./types";

const ALL_WIDGETS: WidgetDef[] = [
  { id: "tasks", label: "Tasks", icon: CheckSquare },
];

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

export function AgentView() {
  const pathname = usePathname();
  const [entered, setEntered] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<MiniPanelTab | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [morphingOut, setMorphingOut] = useState(false);
  const [frameLog, setFrameLog] = useState<string[]>([]);

  const cellSizeRef = useRef<number>(CELL_SIZE);

  const widgetEnabled = useWorkspaceStore((s) => s.widgetEnabled);
  const agentGridCellColor = useWorkspaceStore((s) => s.agentGridCellColor);
  const chatSessions = useWorkspaceStore((s) => s.chatSessions);
  const activeChatSessionId = useWorkspaceStore((s) => s.activeChatSessionId);
  const createChatSession = useWorkspaceStore((s) => s.createChatSession);
  const setActiveChatSession = useWorkspaceStore((s) => s.setActiveChatSession);
  const appendChatMessage = useWorkspaceStore((s) => s.appendChatMessage);
  const updateChatSession = useWorkspaceStore((s) => s.updateChatSession);
  const autoVoiceConversation = useWorkspaceStore(
    (s) => s.autoVoiceConversation,
  );
  const setAutoVoiceConversation = useWorkspaceStore(
    (s) => s.setAutoVoiceConversation,
  );
  const setAutoVoice = useWorkspaceStore((s) => s.setAutoVoice);
  const chatHistory = useWorkspaceStore(
    (s) => s.chatMessages[activeChatSessionId] ?? [],
  );

  const activeSession = useMemo(
    () =>
      chatSessions.find((session) => session.id === activeChatSessionId) ??
      null,
    [activeChatSessionId, chatSessions],
  );

  const widgetItems = useMemo(
    () => ALL_WIDGETS.filter((w) => widgetEnabled[w.id]),
    [widgetEnabled],
  );

  const log = useCallback((message: string) => {
    setFrameLog((prev) => [...prev, `${nowTs()} ${message}`].slice(-20));
  }, []);

  const {
    phase,
    response,
    streamProgress,
    execStatus,
    gridBitmap,
    textInput,
    setTextInput,
    handleTextSend,
    handleNewChat,
    setPhase,
    setResponse,
    setGridBitmap,
    setStreamProgress,
    setExecStatus,
    chat,
  } = useAgentChat({
    setChatOpen,
    setGridHint: () => {},
    log,
  });

  const stt = useStt({
    lang: "es-ES",
    onTranscript: useCallback(
      (text: string) => {
        if (!text.trim() || phase === "chatting") return;
        void chat(text.trim());
      },
      [chat, phase],
    ),
  });

  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 80);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    setChatOpen(false);
  }, [pathname]);

  const busy = phase === "chatting";
  const railOffset = 0;

  const handleGridActivate = useCallback(
    (_x: number, _y: number) => {
      if (gridBitmap) {
        setMorphingOut(true);
        return;
      }
      if (panelOpen) {
        setPanelOpen(false);
        setActivePanel(null);
      }
    },
    [gridBitmap, panelOpen],
  );

  const handleOpenChat = useCallback(() => {
    setPanelOpen(true);
    setActivePanel("chat" as MiniPanelTab);
    if (busy) return;
    if (chatHistory.length > 0) return;

    const sessionId = activeChatSessionId || createChatSession();
    if (!activeChatSessionId) setActiveChatSession(sessionId);

    const friendlyIntro =
      "Hi, I am Niki. What do you need? I am here and ready to help.";
    appendChatMessage(sessionId, {
      id: `msg-assistant-welcome-${Date.now()}`,
      role: "assistant",
      content: friendlyIntro,
      createdAt: new Date().toISOString(),
    });
    updateChatSession(sessionId, {
      status: "live",
      updatedAt: new Date().toISOString(),
      summary: friendlyIntro.slice(0, 120) || "Niki session ready.",
    });
    setResponse(friendlyIntro);
    setPhase("done");
  }, [
    activeChatSessionId,
    appendChatMessage,
    busy,
    createChatSession,
    chatHistory.length,
    setActiveChatSession,
    updateChatSession,
    setResponse,
    setPhase,
  ]);

  return (
    <>
      <div
        className="relative h-dvh w-full overflow-hidden bg-[#06080a]"
        style={{
          opacity: entered ? 1 : 0,
          transform: entered ? "scale(1)" : "scale(1.06)",
          transition:
            "opacity 800ms cubic-bezier(0.16,1,0.3,1), transform 900ms cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.06),transparent_18%),radial-gradient(circle_at_50%_62%,rgba(255,255,255,0.03),transparent_22%),linear-gradient(180deg,rgba(6,8,10,0.95),rgba(3,4,6,1))]" />
        </div>

        <AgentCanvas
          phase={phase}
          sttListening={stt.recording}
          gridBitmap={gridBitmap}
          railOffset={railOffset}
          menuOpen={false}
          morphOut={morphingOut}
          onActivate={handleGridActivate}
          onMorphOutComplete={() => {
            setGridBitmap(null);
            setMorphingOut(false);
          }}
          cellSizeRef={cellSizeRef}
        />

        <AgentChatDrawer
          open={chatOpen}
          onOpenChange={setChatOpen}
          history={chatHistory}
          activeTitle={activeSession?.title ?? "New chat"}
          activeSummary={stripChatControlMarkers(
            activeSession?.summary ?? "Niki session ready.",
          )}
          phase={phase}
          response={response}
          streamProgress={streamProgress}
          textInput={textInput}
          onTextInputChange={setTextInput}
          onTextSend={handleTextSend}
          onNewChat={handleNewChat}
          sttListening={stt.recording}
          sttProcessing={stt.processing}
          sttSupported={stt.supported}
          sttAudioLevel={stt.audioLevel}
          onSttToggle={stt.toggle}
        />

        {frameLog.length > 0 && (
          <div
            className="pointer-events-none absolute bottom-6 z-10 hidden max-w-sm rounded-2xl border border-white/[0.06] bg-black/14 px-3 py-2 text-[11px] text-white/24 backdrop-blur xl:block"
            style={{ left: `${railOffset + 20}px` }}
          >
            <p className="mb-1 uppercase tracking-[0.16em] text-white/18">
              Agent
            </p>
            <p className="truncate">{frameLog[frameLog.length - 1]}</p>
            <p className="mt-1 text-white/15">status: {execStatus}</p>
          </div>
        )}
      </div>

      {/* App border glow — lights up when chatting */}
      <div
        className="fixed inset-0 z-[60] pointer-events-none transition-all duration-700"
        style={{
          boxShadow: stt.recording
            ? `inset 0 0 0 1px rgba(255,255,255,0.08), inset 28px 0 90px ${rgbaFromHex(agentGridCellColor, 0.08)}, inset -28px 0 90px ${rgbaFromHex(agentGridCellColor, 0.08)}, 0 0 60px ${rgbaFromHex(agentGridCellColor, 0.04)}`
            : phase === "chatting"
              ? "inset 0 0 0 1px rgba(255,255,255,0.10), inset 24px 0 72px rgba(110,205,255,0.05), inset -24px 0 72px rgba(110,205,255,0.05), 0 0 40px rgba(255,255,255,0.03)"
              : "inset 0 0 0 1px rgba(255,255,255,0.03)",
        }}
      />

      <MiniPanel
        open={panelOpen}
        onClose={() => {
          setPanelOpen(false);
          setActivePanel(null);
        }}
        panel={activePanel}
      />
      <BottomActionDock
        activePanel={activePanel}
        appItems={widgetItems}
        busy={busy}
        onChat={handleOpenChat}
        onNewChat={handleNewChat}
        onSettings={() => {
          setPanelOpen(true);
          setActivePanel("settings");
        }}
        onSelect={(id) => {
          setPanelOpen(true);
          setActivePanel(id);
        }}
        autoVoiceConversation={autoVoiceConversation}
        setAutoVoiceConversation={setAutoVoiceConversation}
        setAutoVoice={setAutoVoice}
      />
    </>
  );
}
