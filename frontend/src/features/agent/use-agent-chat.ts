"use client";

import { useCallback, useRef, useState } from "react";
import {
  buildHermesRequestMessages,
  extractWorkItemMarkers,
  stripChatControlMarkers,
} from "@/core/runtime/chat-history";
import { wrapperHeaders, wrapperUrl } from "@/core/runtime/wrapper";
import { useWorkspaceStore } from "@/stores/use-workspace-store";
import type { SessionMessage } from "@/types/niki";
import { CELL_SIZE } from "./constants";
import {
  buildBarChart,
  buildDotMatrix,
} from "./grid-engine";
import type { Phase } from "./types";
import {
  appendProgressEntry,
  extractProgressMarkers,
  nowTs,
  parseExecStatus,
  parseGridCmd,
  stripExecStatusMarker,
  stripUiMarkers,
  summarizeSessionPreview,
  summarizeSessionTitle,
} from "./utils";

export function useAgentChat({
  setChatOpen,
  setGridHint,
  log,
}: {
  setChatOpen(open: boolean): void;
  setGridHint(hint: string): void;
  log(message: string): void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [response, setResponse] = useState<string | null>(null);
  const [streamProgress, setStreamProgress] = useState<string[]>([]);
  const [execStatus, setExecStatus] = useState<
    "pendiente" | "verificada" | "parcial" | "sin_acciones"
  >("pendiente");
  const [gridBitmap, setGridBitmap] = useState<boolean[][] | null>(null);
  const [textInput, setTextInput] = useState("");

  const backendBaseUrl = useWorkspaceStore((s) => s.backendBaseUrl);
  const backendApiKey = useWorkspaceStore((s) => s.backendApiKey);
  const userId = useWorkspaceStore((s) => s.userId);
  const applyRuntimeUpdate = useWorkspaceStore((s) => s.applyRuntimeUpdate);
  const activeChatSessionId = useWorkspaceStore((s) => s.activeChatSessionId);
  const createChatSession = useWorkspaceStore((s) => s.createChatSession);
  const setActiveChatSession = useWorkspaceStore((s) => s.setActiveChatSession);
  const appendChatMessage = useWorkspaceStore((s) => s.appendChatMessage);
  const updateChatSession = useWorkspaceStore((s) => s.updateChatSession);
  const bumpWorkItemsRefreshToken = useWorkspaceStore(
    (s) => s.bumpWorkItemsRefreshToken,
  );
  const setWidgetEnabledStore = useWorkspaceStore((s) => s.setWidgetEnabled);
  const interactionMode = useWorkspaceStore((s) => s.interactionMode);

  const chat = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      const startedAt = performance.now();
      const sessionId = activeChatSessionId || createChatSession(text);
      const now = new Date().toISOString();
      const userMessage: SessionMessage = {
        id: `msg-user-${Date.now()}`,
        role: "user",
        content: text,
        createdAt: now,
      };

      setChatOpen(true);
      setStreamProgress([]);
      setPhase("chatting");
      setResponse("");
      setExecStatus("pendiente");
      setGridBitmap(null);
      appendChatMessage(sessionId, userMessage);
      const requestMessages = buildHermesRequestMessages(
        useWorkspaceStore.getState().chatMessages[sessionId] ?? [],
      );
      updateChatSession(sessionId, {
        status: "live",
        updatedAt: now,
        summary: summarizeSessionPreview(text),
        title: summarizeSessionTitle(text),
      });

      const runtime = useWorkspaceStore.getState().runtime;
      applyRuntimeUpdate({
        kind: "partial",
        patch: {
          agent: {
            ...runtime.agent,
            state: "thinking",
            currentTask: "Streaming response",
            summary: text,
          },
        },
      });
      log("Streaming from Hermes...");

      try {
        const baseUrl = backendBaseUrl.trim();
        const res = await fetch(wrapperUrl(baseUrl, "/chat/stream"), {
          method: "POST",
          headers: (() => {
            const h = wrapperHeaders(backendApiKey, {
              "content-type": "application/json",
            });
            if (userId) h.set("x-niki-user-id", userId);
            return h;
          })(),
          body: JSON.stringify({
            input: text,
            sessionId,
            channel: interactionMode === "automoto" ? "automoto" : "niki-agent",
            messages: requestMessages,
          }),
        });

        if (!res.ok) {
          const raw = await res.text();
          const fallback =
            raw || `Couldn't complete that. Chat failed HTTP ${res.status}.`;
          setResponse(fallback);
          setExecStatus("parcial");
          appendChatMessage(sessionId, {
            id: `msg-assistant-${Date.now()}`,
            role: "assistant",
            content: fallback,
            createdAt: new Date().toISOString(),
          });
          updateChatSession(sessionId, {
            status: "paused",
            updatedAt: new Date().toISOString(),
            summary: summarizeSessionPreview(fallback),
          });
          setPhase("error");
          log(`Chat failed HTTP ${res.status}`);
          return;
        }

        if (!res.body) {
          const fallback = "Couldn't complete that. Chat stream body missing.";
          setResponse(fallback);
          setExecStatus("parcial");
          appendChatMessage(sessionId, {
            id: `msg-assistant-${Date.now()}`,
            role: "assistant",
            content: fallback,
            createdAt: new Date().toISOString(),
          });
          updateChatSession(sessionId, {
            status: "paused",
            updatedAt: new Date().toISOString(),
            summary: summarizeSessionPreview(fallback),
          });
          setPhase("error");
          log("Chat stream body missing");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let full = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const block of parts) {
            const raw = block
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n")
              .trim();

            if (!raw || raw === "[DONE]") continue;

            try {
              const payload = JSON.parse(raw) as Record<string, unknown>;
              const choices = payload.choices as
                | Array<Record<string, unknown>>
                | undefined;
              const delta = choices?.[0]?.delta as
                | Record<string, unknown>
                | undefined;
              const content = String(delta?.content ?? "");
              if (!content) continue;

              const { cleanText, progress } = extractProgressMarkers(content);
              if (progress.length > 0) {
                setStreamProgress((prev) => {
                  let next = prev;
                  for (const item of progress)
                    next = appendProgressEntry(next, item);
                  return next;
                });
              }
              if (!cleanText) continue;

              full += cleanText;
              const cleaned = full
                .replace(/<think>[\s\S]*?<\/think>/g, "")
                .trim();
              const noMarker = cleaned
                .replace(/\n?\[\[exec_status:[^\]]+\]\]\s*$/i, "")
                .trim();
              const visibleMarkerless = stripUiMarkers(noMarker);
              setResponse(visibleMarkerless);

              const nextRuntime = useWorkspaceStore.getState().runtime;
              applyRuntimeUpdate({
                kind: "partial",
                patch: {
                  agent: {
                    ...nextRuntime.agent,
                    state: "speaking",
                    currentTask: "Streaming response",
                    summary:
                      visibleMarkerless.slice(0, 180) || "Streaming response",
                  },
                },
              });
            } catch {
              continue;
            }
          }
        }

        const clean =
          full.replace(/<think>[\s\S]*?<\/think>/g, "").trim() ||
          "Done. No final text from model.";
        const status = parseExecStatus(clean);
        const uiText = stripExecStatusMarker(clean);
        const workItemMarkers = extractWorkItemMarkers(uiText);
        const visibleText = stripUiMarkers(uiText);
        const cmd = parseGridCmd(uiText);
        const cols = Math.max(12, Math.ceil(window.innerWidth / CELL_SIZE));
        const rows = Math.max(12, Math.ceil(window.innerHeight / CELL_SIZE));

        if (cmd?.type === "text") {
          setGridBitmap(buildDotMatrix(cmd.value, cols, rows));
        } else if (cmd?.type === "bar") {
          setGridBitmap(buildBarChart(cmd.values, cols, rows));
        } else {
          setGridBitmap(null);
        }

        setResponse(visibleText);
        setGridHint("Ask me anything. I can keep going in real time.");
        setExecStatus(status);
        setStreamProgress([]);
        appendChatMessage(sessionId, {
          id: `msg-assistant-${Date.now()}`,
          role: "assistant",
          content: visibleText,
          createdAt: new Date().toISOString(),
        });
        updateChatSession(sessionId, {
          status: "complete",
          updatedAt: new Date().toISOString(),
          summary: summarizeSessionPreview(visibleText || text),
        });
        setPhase("done");
        log(`Completed in ${Math.round(performance.now() - startedAt)}ms`);

        if (workItemMarkers.length > 0) {
          bumpWorkItemsRefreshToken();
          setWidgetEnabledStore("tasks", true);
        }

        const nextRuntime = useWorkspaceStore.getState().runtime;
        applyRuntimeUpdate({
          kind: "partial",
          patch: {
            agent: {
              ...nextRuntime.agent,
              state: "success",
              currentTask: "Completed",
              summary: visibleText.slice(0, 160) || "Completed",
            },
          },
        });

        window.setTimeout(() => {
          const idleRuntime = useWorkspaceStore.getState().runtime;
          applyRuntimeUpdate({
            kind: "partial",
            patch: {
              agent: {
                ...idleRuntime.agent,
                state: "idle",
                currentTask: "Ready for realtime requests",
                summary: "Connected to Hermes and ready.",
              },
            },
          });
        }, 1200);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const fallback = `Couldn't complete that. ${message}`;
        setResponse(fallback);
        setGridHint("Something went wrong. Try again and I will help.");
        setExecStatus("parcial");
        setStreamProgress([]);
        appendChatMessage(sessionId, {
          id: `msg-assistant-${Date.now()}`,
          role: "assistant",
          content: fallback,
          createdAt: new Date().toISOString(),
        });
        updateChatSession(sessionId, {
          status: "paused",
          updatedAt: new Date().toISOString(),
          summary: summarizeSessionPreview(fallback),
        });
        setPhase("error");
        log(`Chat error: ${message}`);
      }
    },
    [
      activeChatSessionId,
      appendChatMessage,
      applyRuntimeUpdate,
      backendApiKey,
      backendBaseUrl,
      createChatSession,
      interactionMode,
      log,
      bumpWorkItemsRefreshToken,
      setWidgetEnabledStore,
      updateChatSession,
      setChatOpen,
      setGridHint,
    ],
  );

  const handleTextSend = useCallback(() => {
    const next = textInput.trim();
    if (!next || phase === "chatting") return;
    setTextInput("");
    void chat(next);
  }, [phase, chat, textInput]);

  const handleNewChat = useCallback(() => {
    const nextId = createChatSession();
    setActiveChatSession(nextId);
    setTextInput("");
    setResponse(null);
    setGridBitmap(null);
    setStreamProgress([]);
    setExecStatus("pendiente");
    setPhase("idle");
    setGridHint("Click the grid and tell me what you need.");
  }, [createChatSession, setActiveChatSession, setGridHint]);

  return {
    phase,
    response,
    streamProgress,
    execStatus,
    gridBitmap,
    textInput,
    setTextInput,
    chat,
    handleTextSend,
    handleNewChat,
    setPhase,
    setResponse,
    setStreamProgress,
    setExecStatus,
    setGridBitmap,
  };
}
