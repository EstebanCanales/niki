"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { mockSnapshot } from "@/core/mock-data/runtime";
import { stripChatControlMarkers } from "@/core/runtime/chat-history";
import type {
  RuntimeTransportMode,
  RuntimeUpdate,
  InteractionMode,
  Locale,
  RuntimePatch,
  RuntimeSnapshot,
  SessionMessage,
  SessionSummary,
} from "@/types/niki";

type InspectorTab = "activity" | "approvals" | "tool" | "context";

type NotchSettings = {
  enabled: boolean;
  collapsedHeight: number;
  expandedWidth: number;
  expandedHeight: number;
  topMargin: number;
  alwaysOnTop: boolean;
  visibleOnAllWorkspaces: boolean;
};

type NotchStatus = {
  visible: boolean;
  effectiveWidth: number;
  effectiveHeight: number;
  lastError: string;
};

interface WorkspaceStore {
  _hasHydrated: boolean;
  _setHasHydrated(v: boolean): void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed(collapsed: boolean): void;
  toggleSidebar(): void;
  locale: Locale;
  interactionMode: InteractionMode;
  commandPaletteOpen: boolean;
  activeInspectorTab: InspectorTab;
  selectedToolId: string;
  inspectorVisible: boolean;
  runtimeTransport: RuntimeTransportMode;
  runtimeAutoConnect: boolean;
  runtimeConnected: boolean;
  backendBaseUrl: string;
  backendApiKey: string;
  userId: string;
  setUserId(id: string): void;
  accessToken: string | null;
  setAccessToken(token: string | null): void;
  displayName: string;
  setDisplayName(name: string): void;
  navIconOnly: boolean;
  setNavIconOnly(v: boolean): void;
  widgetEnabled: Record<string, boolean>;
  setWidgetEnabled(id: string, enabled: boolean): void;
  workItemsRefreshToken: number;
  bumpWorkItemsRefreshToken(): void;
  orbColors: { normal: string; success: string; error: string };
  setOrbColors(colors: { normal: string; success: string; error: string }): void;
  notchSettings: NotchSettings;
  setNotchSettings(patch: Partial<NotchSettings>): void;
  notchStatus: NotchStatus;
  setNotchStatus(patch: Partial<NotchStatus>): void;
  agentGridCellColor: string;
  setAgentGridCellColor(color: string): void;
  sidebarAudioActive: boolean;
  setSidebarAudioActive(active: boolean): void;
  autoVoice: boolean;
  setAutoVoice(enabled: boolean): void;
  autoVoiceConversation: boolean;
  setAutoVoiceConversation(enabled: boolean): void;
  ttsVoice: string;
  setTtsVoice(voice: string): void;
  chatSessions: SessionSummary[];
  chatMessages: Record<string, SessionMessage[]>;
  activeChatSessionId: string;
  runtime: RuntimeSnapshot;
  setLocale(locale: Locale): void;
  setInteractionMode(mode: InteractionMode): void;
  setSelectedToolId(id: string): void;
  setCommandPaletteOpen(open: boolean): void;
  setInspectorTab(tab: InspectorTab): void;
  setInspectorVisible(visible: boolean): void;
  toggleInspectorVisible(): void;
  setRuntimeAutoConnect(autoConnect: boolean): void;
  setRuntimeConnected(connected: boolean): void;
  setBackendBaseUrl(baseUrl: string): void;
  setBackendApiKey(apiKey: string): void;
  createChatSession(seedText?: string): string;
  setActiveChatSession(id: string): void;
  appendChatMessage(sessionId: string, message: SessionMessage): void;
  upsertChatMessage(sessionId: string, message: SessionMessage): void;
  updateChatSession(sessionId: string, patch: Partial<SessionSummary>): void;
  hydrateSnapshot(snapshot: RuntimeSnapshot): void;
  applyRuntimeUpdate(update: RuntimeUpdate): void;
}

function mergeRuntimePatch(runtime: RuntimeSnapshot, patch: RuntimePatch): RuntimeSnapshot {
  return {
    ...runtime,
    ...patch,
  };
}

function createSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}`;
}

function summarizeSessionTitle(seedText?: string) {
  const trimmed = seedText?.trim() ?? "";
  if (!trimmed) return "New chat";
  return trimmed.length > 44 ? `${trimmed.slice(0, 44)}...` : trimmed;
}

function summarizeSessionPreview(text?: string) {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) return "Niki session ready.";
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}...` : trimmed;
}

function buildChatSession(seedText?: string): SessionSummary {
  const now = new Date().toISOString();
  return {
    id: createSessionId(),
    title: summarizeSessionTitle(seedText),
    summary: seedText ? summarizeSessionPreview(seedText) : "Niki session ready.",
    status: "live",
    mode: "chat",
    updatedAt: now,
    toolsUsed: ["hermes"],
    titleCustomized: false,
  };
}

const initialChatSession = buildChatSession();

function clampNotchSettings(settings: NotchSettings): NotchSettings {
  return {
    ...settings,
    collapsedHeight: Math.max(28, settings.collapsedHeight || 28),
    expandedWidth: Math.max(760, settings.expandedWidth || 760),
    expandedHeight: Math.max(340, settings.expandedHeight || 340),
    topMargin: Math.max(0, settings.topMargin || 8),
  };
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      _hasHydrated: false,
      _setHasHydrated: (v) => set({ _hasHydrated: v }),
      sidebarCollapsed: false,
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      locale: "en",
      interactionMode: "autopilot",
      commandPaletteOpen: false,
      activeInspectorTab: "activity",
      selectedToolId: mockSnapshot.tools[0].id,
      inspectorVisible: true,
      runtimeTransport:
        process.env.NEXT_PUBLIC_NIKI_RUNTIME_TRANSPORT === "mock" ? "mock" : "backend",
      runtimeAutoConnect: false,
      runtimeConnected: false,
      backendBaseUrl:
        process.env.NIKI_BACKEND_BASE_URL ??
        process.env.NEXT_PUBLIC_NIKI_BACKEND_BASE_URL ??
        "http://127.0.0.1:8000",
      backendApiKey:
        process.env.NIKI_BACKEND_API_KEY ??
        process.env.NEXT_PUBLIC_NIKI_BACKEND_API_KEY ??
        "",
      userId: "user-demo",
      setUserId: (userId) => set({ userId }),
      accessToken: null,
      setAccessToken: (accessToken) => set({ accessToken }),
      displayName: "Esteban",
      setDisplayName: (displayName) => set({ displayName }),
      navIconOnly: false,
      setNavIconOnly: (navIconOnly) => set({ navIconOnly }),
      widgetEnabled: { tasks: true },
      setWidgetEnabled: (id, enabled) => set((s) => ({ widgetEnabled: { ...s.widgetEnabled, [id]: enabled } })),
      workItemsRefreshToken: 0,
      bumpWorkItemsRefreshToken: () =>
        set((state) => ({ workItemsRefreshToken: state.workItemsRefreshToken + 1 })),
      orbColors: {
        normal: "radial-gradient(circle, rgba(220,248,255,0.96), rgba(0,190,240,0.6))",
        success: "radial-gradient(circle, rgba(200,255,230,0.96), rgba(67,207,152,0.6))",
        error: "radial-gradient(circle, rgba(255,210,220,0.96), rgba(224,70,123,0.6))",
      },
      setOrbColors: (orbColors) => set({ orbColors }),
      notchSettings: {
        enabled: true,
        collapsedHeight: 28,
        expandedWidth: 760,
        expandedHeight: 340,
        topMargin: 8,
        alwaysOnTop: true,
        visibleOnAllWorkspaces: true,
      },
      setNotchSettings: (patch) =>
        set((state) => ({ notchSettings: { ...state.notchSettings, ...patch } })),
      notchStatus: {
        visible: false,
        effectiveWidth: 760,
        effectiveHeight: 28,
        lastError: "",
      },
      setNotchStatus: (patch) =>
        set((state) => ({ notchStatus: { ...state.notchStatus, ...patch } })),
      agentGridCellColor: "#5ea2ff",
      setAgentGridCellColor: (agentGridCellColor) => set({ agentGridCellColor }),
      sidebarAudioActive: false,
      setSidebarAudioActive: (sidebarAudioActive) => set({ sidebarAudioActive }),
      autoVoice: false,
      setAutoVoice: (autoVoice) => set({ autoVoice }),
      autoVoiceConversation: false,
      setAutoVoiceConversation: (autoVoiceConversation) => set({ autoVoiceConversation }),
      ttsVoice: "es_AR-daniela",
      setTtsVoice: (ttsVoice) => set({ ttsVoice }),
      chatSessions: [initialChatSession],
      chatMessages: {
        [initialChatSession.id]: [],
      },
      activeChatSessionId: initialChatSession.id,
      runtime: structuredClone(mockSnapshot),
      setLocale: (locale) => set({ locale }),
      setInteractionMode: (interactionMode) => set({ interactionMode }),
      setSelectedToolId: (selectedToolId) => set({ selectedToolId, activeInspectorTab: "tool" }),
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      setInspectorTab: (activeInspectorTab) => set({ activeInspectorTab }),
      setInspectorVisible: (inspectorVisible) => set({ inspectorVisible }),
      toggleInspectorVisible: () =>
        set((state) => ({ inspectorVisible: !state.inspectorVisible })),
      setRuntimeAutoConnect: (runtimeAutoConnect) => set({ runtimeAutoConnect }),
      setRuntimeConnected: (runtimeConnected) => set({ runtimeConnected }),
      setBackendBaseUrl: (backendBaseUrl) => set({ backendBaseUrl }),
      setBackendApiKey: (backendApiKey) => set({ backendApiKey }),
      createChatSession: (seedText) => {
        const session = buildChatSession(seedText);
        set((state) => ({
          chatSessions: [session, ...state.chatSessions],
          chatMessages: {
            ...state.chatMessages,
            [session.id]: [],
          },
          activeChatSessionId: session.id,
        }));
        return session.id;
      },
      setActiveChatSession: (activeChatSessionId) => set({ activeChatSessionId }),
      appendChatMessage: (sessionId, message) =>
        set((state) => {
          const normalizedMessage =
            message.role === "assistant"
              ? { ...message, content: stripChatControlMarkers(message.content) }
              : message;
          const current = state.chatMessages[sessionId] ?? [];
          const nextMessages = [...current, normalizedMessage];
          const firstUser = nextMessages.find((item) => item.role === "user");
          const latestAssistant =
            [...nextMessages].reverse().find((item) => item.role === "assistant") ??
            [...nextMessages].reverse().find((item) => item.role === "user");
          const updatedAt = normalizedMessage.createdAt ?? new Date().toISOString();

          return {
            chatMessages: {
              ...state.chatMessages,
              [sessionId]: nextMessages,
            },
            chatSessions: state.chatSessions.map((session) =>
              session.id === sessionId
                ? {
                    ...session,
                    title: session.titleCustomized
                      ? session.title
                      : summarizeSessionTitle(firstUser?.content ?? session.title),
                    summary: summarizeSessionPreview(latestAssistant?.content ?? session.summary),
                    status: normalizedMessage.role === "assistant" ? "complete" : "live",
                    updatedAt,
                    toolsUsed: session.toolsUsed.includes("hermes")
                      ? session.toolsUsed
                      : [...session.toolsUsed, "hermes"],
                  }
                : session,
            ),
          };
        }),
      upsertChatMessage: (sessionId, message) =>
        set((state) => {
          const normalizedMessage =
            message.role === "assistant"
              ? { ...message, content: stripChatControlMarkers(message.content) }
              : message;
          const current = state.chatMessages[sessionId] ?? [];
          const existingIndex = current.findIndex((item) => item.id === normalizedMessage.id);
          const nextMessages =
            existingIndex >= 0
              ? current.map((item, index) =>
                  index === existingIndex ? normalizedMessage : item,
                )
              : [...current, normalizedMessage];
          const firstUser = nextMessages.find((item) => item.role === "user");
          const latestAssistant =
            [...nextMessages].reverse().find((item) => item.role === "assistant") ??
            [...nextMessages].reverse().find((item) => item.role === "user");
          const updatedAt = normalizedMessage.createdAt ?? new Date().toISOString();

          return {
            chatMessages: {
              ...state.chatMessages,
              [sessionId]: nextMessages,
            },
            chatSessions: state.chatSessions.map((session) =>
              session.id === sessionId
                ? {
                    ...session,
                    title: session.titleCustomized
                      ? session.title
                      : summarizeSessionTitle(firstUser?.content ?? session.title),
                    summary: summarizeSessionPreview(latestAssistant?.content ?? session.summary),
                    status: normalizedMessage.role === "assistant" ? "live" : session.status,
                    updatedAt,
                    toolsUsed: session.toolsUsed.includes("hermes")
                      ? session.toolsUsed
                      : [...session.toolsUsed, "hermes"],
                  }
                : session,
            ),
          };
        }),
      updateChatSession: (sessionId, patch) =>
        set((state) => ({
          chatSessions: state.chatSessions.map((session) =>
            session.id === sessionId ? { ...session, ...patch } : session,
          ),
        })),
      hydrateSnapshot: (runtime) => set({ runtime }),
      applyRuntimeUpdate: (update) =>
        set((state) => {
          if (update.kind === "snapshot") {
            return { runtime: update.snapshot };
          }
          if (update.kind === "partial") {
            return { runtime: mergeRuntimePatch(state.runtime, update.patch) };
          }
          return {
            runtime: {
              ...state.runtime,
              logs: [update.event, ...state.runtime.logs].slice(0, 12),
            },
          };
        }),
    }),
    {
      name: "niki-preferences",
      onRehydrateStorage: () => (state) => {
        state?._setHasHydrated(true);
      },
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        locale: state.locale,
        interactionMode: state.interactionMode,
        inspectorVisible: state.inspectorVisible,
        runtimeAutoConnect: state.runtimeAutoConnect,
        backendBaseUrl: state.backendBaseUrl,
        backendApiKey: state.backendApiKey,
        userId: state.userId,
        accessToken: state.accessToken,
        displayName: state.displayName,
        navIconOnly: state.navIconOnly,
        widgetEnabled: state.widgetEnabled,
        orbColors: state.orbColors,
        notchSettings: state.notchSettings,
        agentGridCellColor: state.agentGridCellColor,
        sidebarAudioActive: state.sidebarAudioActive,
        autoVoice: state.autoVoice,
        autoVoiceConversation: state.autoVoiceConversation,
        ttsVoice: state.ttsVoice,
        chatSessions: state.chatSessions,
        chatMessages: state.chatMessages,
        activeChatSessionId: state.activeChatSessionId,
      }),
      merge: (persistedState, currentState) => {
        const mergedState = {
          ...currentState,
          ...(persistedState as Partial<WorkspaceStore>),
        };

        const persistedChats = (persistedState as Partial<WorkspaceStore>)?.chatSessions;
        const persistedMessages = (persistedState as Partial<WorkspaceStore>)?.chatMessages;
        const fallbackSession = buildChatSession();
        const chatSessions =
          persistedChats && persistedChats.length > 0
            ? persistedChats.map((session) => ({
                ...session,
                summary: stripChatControlMarkers(session.summary),
              }))
            : [fallbackSession];
        const activeChatSessionId =
          (persistedState as Partial<WorkspaceStore>)?.activeChatSessionId?.trim() ||
          chatSessions[0].id;
        const chatMessages = {
          ...(persistedMessages ?? {}),
        };
        for (const session of chatSessions) {
          if (!chatMessages[session.id]) {
            chatMessages[session.id] = [];
            continue;
          }
          chatMessages[session.id] = chatMessages[session.id].map((message) =>
            message.role === "assistant"
              ? { ...message, content: stripChatControlMarkers(message.content) }
              : message,
          );
        }

        return {
          ...mergedState,
          runtimeTransport: currentState.runtimeTransport,
          workItemsRefreshToken: currentState.workItemsRefreshToken,
          notchSettings: clampNotchSettings({
            ...currentState.notchSettings,
            ...((persistedState as Partial<WorkspaceStore>)?.notchSettings ?? {}),
          }),
          notchStatus: currentState.notchStatus,
          runtimeConnected:
            (persistedState as Partial<WorkspaceStore>)?.runtimeConnected ??
            currentState.runtimeConnected,
          chatSessions,
          chatMessages,
          activeChatSessionId,
        };
      },
    }
  )
);
