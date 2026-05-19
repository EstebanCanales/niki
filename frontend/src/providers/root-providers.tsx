"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { Toaster } from "sonner";
import type { ReactNode } from "react";

import { mockSnapshot } from "@/core/mock-data/runtime";
import {
  buildHermesRequestMessages,
  extractWorkItemMarkers,
  stripChatControlMarkers,
} from "@/core/runtime/chat-history";
import { wrapperHeaders, wrapperUrl } from "@/core/runtime/wrapper";
import { RuntimeActionsContext } from "@/hooks/use-runtime-actions";
import type {
  IntegrationStatus,
  PromptRequest,
  RuntimeActions,
  RuntimeSnapshot,
  RuntimeUpdate,
  ToolActionRequest,
} from "@/types/niki";
import { useWorkspaceStore } from "@/stores/use-workspace-store";

function cloneRuntimeSnapshot() {
  return structuredClone(mockSnapshot);
}

function buildRuntimePatchFromStatus(
  payload: Record<string, unknown>,
  state: ReturnType<typeof useWorkspaceStore.getState>,
): Partial<RuntimeSnapshot> {
  const connectionState = String(payload.state ?? "disconnected") as
    | "disconnected"
    | "connecting"
    | "pairing"
    | "syncing"
    | "ready"
    | "degraded";
  const model =
    String(payload.resolvedModel ?? payload.defaultModel ?? state.runtime.agent.model).trim() ||
    state.runtime.agent.model;
  const endpoint =
    String(payload.apiServerUrl ?? payload.gatewayUrl ?? state.backendBaseUrl).trim() ||
    state.backendBaseUrl;
  const detail = String(payload.detail ?? "").trim();
  const summary =
    connectionState === "ready"
      ? `Connected to Hermes with ${model}.`
      : connectionState === "degraded"
        ? "Wrapper is online, but Hermes is degraded."
        : "Wrapper or Hermes is offline.";

  const integrations: IntegrationStatus[] = state.runtime.integrations.map((integration) =>
    integration.id === "int-hermes-runtime"
      ? {
          ...integration,
          id: "int-hermes-runtime",
          name: "Hermes Runtime",
          state:
            connectionState === "ready"
              ? "connected"
              : connectionState === "degraded"
                ? "attention"
                : "disconnected",
          health:
            connectionState === "ready"
              ? "healthy"
              : connectionState === "degraded"
                ? "degraded"
                : "offline",
          updatedAt: new Date().toISOString(),
          description: detail || summary,
        }
      : integration,
  );

  return {
    connection: {
      state: connectionState,
      endpoint,
      latencyMs: state.runtime.connection.latencyMs,
      operatorMode: "wrapper",
      runtimeVersion: model,
    },
    agent: {
      ...state.runtime.agent,
      state:
        connectionState === "ready"
          ? "idle"
          : connectionState === "degraded"
            ? "warning"
            : "error",
      model,
      channel: "Niki app -> Hermes",
      currentTask:
        connectionState === "ready"
          ? "Ready for realtime requests"
          : connectionState === "degraded"
            ? "Waiting for Hermes recovery"
            : "Disconnected",
      summary,
    },
    integrations,
  };
}

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (content: string) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      const raw = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n")
        .trim();

      if (!raw || raw === "[DONE]") continue;

      try {
        const payload = JSON.parse(raw) as Record<string, unknown>;
        const choices = payload.choices as Array<Record<string, unknown>> | undefined;
        const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
        const content = String(delta?.content ?? "");
        if (!content) continue;
        full += content;
        onChunk(full);
      } catch {
        continue;
      }
    }
  }

  return full;
}

export function RootProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const runtimeTransport = useWorkspaceStore((state) => state.runtimeTransport);
  const runtimeConnected = useWorkspaceStore((state) => state.runtimeConnected);
  const backendBaseUrl = useWorkspaceStore((state) => state.backendBaseUrl);
  const backendApiKey = useWorkspaceStore((state) => state.backendApiKey);
  const setUserId = useWorkspaceStore((state) => state.setUserId);
  const applyRuntimeUpdate = useWorkspaceStore((state) => state.applyRuntimeUpdate);
  const hydrateSnapshot = useWorkspaceStore((state) => state.hydrateSnapshot);
  const setCommandPaletteOpen = useWorkspaceStore((state) => state.setCommandPaletteOpen);
  const setInteractionMode = useWorkspaceStore((state) => state.setInteractionMode);
  const toggleInspectorVisible = useWorkspaceStore((state) => state.toggleInspectorVisible);
  const bumpWorkItemsRefreshToken = useWorkspaceStore(
    (state) => state.bumpWorkItemsRefreshToken,
  );
  const lastRuntimeStateRef = useRef<string>("");

  useEffect(() => {
    if (runtimeTransport === "mock") {
      const snapshot = cloneRuntimeSnapshot();
      snapshot.connection = {
        ...snapshot.connection,
        state: "ready",
        endpoint: "mock://hermes-runtime",
        operatorMode: "mock",
        runtimeVersion: "hermes/mock",
        latencyMs: 16,
      };
      snapshot.agent = {
        ...snapshot.agent,
        model: "Hermes mock",
        channel: "Niki app -> Hermes",
        summary: "Mock Hermes runtime ready.",
      };
      snapshot.integrations = snapshot.integrations.map((integration) =>
        integration.id === "int-hermes-runtime"
          ? {
              ...integration,
              id: "int-hermes-runtime",
              name: "Hermes Runtime",
              description: "Mock Hermes runtime for local UI development.",
              state: "connected",
              health: "healthy",
              updatedAt: new Date().toISOString(),
            }
          : integration,
      );
      startTransition(() => hydrateSnapshot(snapshot));
      return;
    }

    let cancelled = false;
    let timerId: number | undefined;
    let eventSource: EventSource | null = null;

    const syncStatus = async () => {
      try {
        const headers = wrapperHeaders(backendApiKey);
        const res = await fetch(wrapperUrl(backendBaseUrl, "/runtime/status"), {
          cache: "no-store",
          headers,
        });
        const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          throw new Error(String(payload.error ?? `HTTP ${res.status}`));
        }
        const state = useWorkspaceStore.getState();
        const patch = buildRuntimePatchFromStatus(payload, state);
        const signature = `${patch.connection?.state}|${patch.connection?.runtimeVersion}|${patch.connection?.endpoint}`;

        startTransition(() => {
          applyRuntimeUpdate({ kind: "partial", patch });
        });

        if (lastRuntimeStateRef.current !== signature) {
          lastRuntimeStateRef.current = signature;
          startTransition(() => {
            applyRuntimeUpdate({
              kind: "event",
              event: {
                id: `runtime-status-${Date.now()}`,
                ts: new Date().toISOString(),
                level:
                  patch.connection?.state === "ready"
                    ? "success"
                    : patch.connection?.state === "degraded"
                      ? "warning"
                      : "error",
                source: "runtime",
                type: `runtime.${patch.connection?.state ?? "unknown"}`,
                title:
                  patch.connection?.state === "ready"
                    ? "Hermes connected"
                    : patch.connection?.state === "degraded"
                      ? "Hermes degraded"
                      : "Hermes disconnected",
                summary: patch.agent?.summary ?? "Runtime status changed.",
                detail: patch.connection?.endpoint,
              },
            });
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Runtime sync failed";
        const state = useWorkspaceStore.getState();
        startTransition(() => {
          applyRuntimeUpdate({
            kind: "partial",
            patch: {
              connection: {
                state: "disconnected",
                endpoint: backendBaseUrl,
                latencyMs: 0,
                operatorMode: "wrapper",
                runtimeVersion: state.runtime.agent.model,
              },
              agent: {
                ...state.runtime.agent,
                state: "error",
                channel: "Niki app -> Hermes",
                currentTask: "Disconnected",
                summary: message,
              },
            },
          });
        });
      } finally {
        if (!cancelled && runtimeConnected) {
          timerId = window.setTimeout(syncStatus, 15_000);
        }
      }
    };

    if (!runtimeConnected) {
      const state = useWorkspaceStore.getState();
      startTransition(() => {
        applyRuntimeUpdate({
          kind: "partial",
          patch: {
            connection: {
              state: "disconnected",
              endpoint: backendBaseUrl,
              latencyMs: 0,
              operatorMode: "wrapper",
              runtimeVersion: state.runtime.agent.model,
            },
            agent: {
              ...state.runtime.agent,
              state: "warning",
              channel: "Niki app -> Hermes",
              currentTask: "Connection paused",
              summary: "Runtime connection is paused.",
            },
          },
        });
      });
    } else {
      const state = useWorkspaceStore.getState();
      startTransition(() => {
        applyRuntimeUpdate({
          kind: "partial",
          patch: {
            connection: {
              state: "connecting",
              endpoint: backendBaseUrl,
              latencyMs: 0,
              operatorMode: "wrapper",
              runtimeVersion: state.runtime.agent.model,
            },
            agent: {
              ...state.runtime.agent,
              state: "thinking",
              channel: "Niki app -> Hermes",
              currentTask: "Connecting",
              summary: "Connecting to Hermes runtime.",
            },
          },
        });
      });

      void syncStatus();

      const eventsUrl = new URL(wrapperUrl(backendBaseUrl, "/runtime/events"));
      if (backendApiKey.trim()) {
        eventsUrl.searchParams.set("apiKey", backendApiKey.trim());
      }
      eventSource = new EventSource(eventsUrl.toString());
      eventSource.onmessage = (event) => {
        try {
          const update = JSON.parse(event.data) as RuntimeUpdate;
          startTransition(() => applyRuntimeUpdate(update));
        } catch {
          // Ignore malformed runtime events.
        }
      };
      eventSource.onerror = () => {
        const runtimeState = useWorkspaceStore.getState();
        startTransition(() => {
          applyRuntimeUpdate({
            kind: "partial",
            patch: {
              connection: {
                state: "degraded",
                endpoint: backendBaseUrl,
                latencyMs: runtimeState.runtime.connection.latencyMs,
                operatorMode: "wrapper",
                runtimeVersion: runtimeState.runtime.agent.model,
              },
              agent: {
                ...runtimeState.runtime.agent,
                state: "warning",
                channel: "Niki app -> Hermes",
                currentTask: "Realtime unavailable",
                summary: "Hermes event stream is unavailable. Chat can still recover on reconnect.",
              },
            },
          });
        });
      };
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent("niki-focus-composer"));
      }
      if (event.altKey && event.key.toLowerCase() === "i") {
        event.preventDefault();
        toggleInspectorVisible();
      }
      if (event.altKey && event.code === "Space") {
        event.preventDefault();
        setInteractionMode("chat");
        window.dispatchEvent(new CustomEvent("niki-focus-composer"));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelled = true;
      if (timerId) {
        window.clearTimeout(timerId);
      }
      eventSource?.close();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    applyRuntimeUpdate,
    backendApiKey,
    backendBaseUrl,
    hydrateSnapshot,
    runtimeConnected,
    runtimeTransport,
    setCommandPaletteOpen,
    setInteractionMode,
    toggleInspectorVisible,
  ]);

  useEffect(() => {
    if (!backendApiKey.trim() || runtimeTransport === "mock") return;
    fetch(wrapperUrl(backendBaseUrl, "/v1/me"), {
      headers: wrapperHeaders(backendApiKey),
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((data: { ok?: boolean; user?: { id?: string } }) => {
        if (data.ok && data.user?.id) setUserId(data.user.id);
      })
      .catch(() => undefined);
  }, [backendApiKey, backendBaseUrl, runtimeTransport, setUserId]);

  const runtimeActions = useMemo<RuntimeActions>(
    () => ({
      async sendPrompt(request: PromptRequest) {
        if (runtimeTransport === "mock") {
          const state = useWorkspaceStore.getState();
          startTransition(() => {
            applyRuntimeUpdate({
              kind: "event",
              event: {
                id: `mock-prompt-${Date.now()}`,
                ts: new Date().toISOString(),
                level: "info",
                source: "runtime",
                type: `prompt.${request.mode}`,
                title: "Mock Hermes prompt received",
                summary: request.content,
              },
            });
            applyRuntimeUpdate({
              kind: "partial",
              patch: {
                agent: {
                  ...state.runtime.agent,
                  state: "success",
                  model: "Hermes mock",
                  channel: "Niki app -> Hermes",
                  currentTask: "Completed",
                  summary: request.content.slice(0, 180),
                },
              },
            });
          });
          return;
        }

        const state = useWorkspaceStore.getState();
        const headers = wrapperHeaders(state.backendApiKey, { "content-type": "application/json" });
        if (state.userId) headers.set("x-niki-user-id", state.userId);
        const activeSessionId = state.activeChatSessionId;
        const requestMessages = buildHermesRequestMessages([
          ...(state.chatMessages[activeSessionId] ?? []),
          {
            id: `prompt-${Date.now()}`,
            role: "user",
            content: request.content,
            createdAt: new Date().toISOString(),
          },
        ]);

        startTransition(() => {
          applyRuntimeUpdate({
            kind: "partial",
            patch: {
              agent: {
                ...state.runtime.agent,
                state: "thinking",
                channel: "Niki app -> Hermes",
                currentTask: "Submitting prompt",
                summary: request.content.slice(0, 180),
              },
            },
          });
        });

        const res = await fetch(wrapperUrl(state.backendBaseUrl, "/chat/stream"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            input: request.content,
            sessionId: activeSessionId,
            channel: request.mode === "automoto" ? "automoto" : "main-composer",
            messages: requestMessages,
          }),
        });

        if (!res.ok || !res.body) {
          const detail = await res.text().catch(() => `HTTP ${res.status}`);
          startTransition(() => {
            applyRuntimeUpdate({
              kind: "event",
              event: {
                id: `runtime-prompt-error-${Date.now()}`,
                ts: new Date().toISOString(),
                level: "error",
                source: "runtime",
                type: "runtime.prompt.error",
                title: "Hermes request failed",
                summary: detail || `HTTP ${res.status}`,
              },
            });
          });
          throw new Error(detail || `HTTP ${res.status}`);
        }

        const full = await readSseStream(res.body, (rawText) => {
          const visibleText = stripChatControlMarkers(rawText);
          const nextState = useWorkspaceStore.getState();
          startTransition(() => {
            applyRuntimeUpdate({
              kind: "partial",
              patch: {
                agent: {
                  ...nextState.runtime.agent,
                  state: "speaking",
                  channel: "Niki app -> Hermes",
                  currentTask: "Streaming response",
                  summary: visibleText.slice(0, 180) || "Streaming response",
                },
              },
            });
          });
        });

        const visibleText = stripChatControlMarkers(full) || "Completed.";
        if (extractWorkItemMarkers(full).length > 0) {
          bumpWorkItemsRefreshToken();
        }
        startTransition(() => {
          applyRuntimeUpdate({
            kind: "event",
            event: {
              id: `runtime-prompt-complete-${Date.now()}`,
              ts: new Date().toISOString(),
              level: "success",
              source: "runtime",
              type: "runtime.prompt.complete",
              title: "Hermes response completed",
              summary: visibleText.slice(0, 180),
            },
          });
          applyRuntimeUpdate({
            kind: "partial",
            patch: {
              agent: {
                ...useWorkspaceStore.getState().runtime.agent,
                state: "success",
                channel: "Niki app -> Hermes",
                currentTask: "Completed",
                summary: visibleText.slice(0, 180),
              },
            },
          });
        });
      },

      async runToolAction(request: ToolActionRequest) {
        startTransition(() => {
          applyRuntimeUpdate({
            kind: "event",
            event: {
              id: `runtime-tool-${Date.now()}`,
              ts: new Date().toISOString(),
              level: "warning",
              source: request.toolId,
              type: "runtime.tool.unsupported",
              title: "Direct tool actions are disabled",
              summary: "Hermes v1 migration keeps chat and runtime events first. Direct tool actions are not wired yet.",
            },
          });
        });
      },

      async approveExec(id: string, approved: boolean) {
        startTransition(() => {
          applyRuntimeUpdate({
            kind: "event",
            event: {
              id: `runtime-approval-${Date.now()}`,
              ts: new Date().toISOString(),
              level: "warning",
              source: "runtime",
              type: "runtime.approval.unsupported",
              title: "Runtime approvals are not wired",
              summary: `Approval ${id} was ${approved ? "approved" : "rejected"} locally, but Hermes v1 does not expose this control in Niki yet.`,
            },
          });
        });
      },
    }),
    [applyRuntimeUpdate, bumpWorkItemsRefreshToken, runtimeTransport],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RuntimeActionsContext.Provider value={runtimeActions}>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            classNames: {
              toast: "!border-white/10 !bg-[#0e0b18] !text-white",
            },
          }}
        />
      </RuntimeActionsContext.Provider>
    </QueryClientProvider>
  );
}
