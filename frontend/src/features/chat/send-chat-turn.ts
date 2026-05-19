"use client";

import { isTauri, invoke } from "@tauri-apps/api/core";

import {
  buildHermesRequestMessages,
  extractWorkItemMarkers,
  stripChatControlMarkers,
} from "@/core/runtime/chat-history";
import { wrapperHeaders, wrapperUrl } from "@/core/runtime/wrapper";
import { useWorkspaceStore } from "@/stores/use-workspace-store";
import type {
  MessageRole,
  NotchFileContext,
  SessionMessage,
} from "@/types/niki";

type HermesRequestMessage = {
  role: MessageRole;
  content: string;
};

export interface SendChatTurnOptions {
  text: string;
  files?: NotchFileContext[];
  baseUrl: string;
  apiKey: string;
  userId?: string;
  sessionId?: string;
  channel?: string;
  turnDirectives?: string[];
  messageIdPrefix?: string;
  onToken?: (visibleText: string) => void;
  signal?: AbortSignal;
}

export interface SendChatTurnResult {
  sessionId: string;
  finalText: string;
}

type NotchResponseState = "streaming" | "complete" | "error";

async function pushNotchResponse(
  text: string,
  state: NotchResponseState,
  sessionId: string,
) {
  if (!isTauri()) return;
  try {
    await invoke("push_notch_response", {
      response: JSON.stringify({
        text,
        state,
        sessionId,
        updatedAt: new Date().toISOString(),
      }),
    });
  } catch (error) {
    console.error("[notch] push response failed", error);
  }
}

async function clearNotchResponse() {
  if (!isTauri()) return;
  try {
    await invoke("clear_notch_response");
  } catch (error) {
    console.error("[notch] clear response failed", error);
  }
}

function summarizeTitle(text?: string) {
  const t = text?.trim() ?? "";
  return t.length > 44 ? `${t.slice(0, 44)}...` : t || "New chat";
}

function summarizePreview(text?: string) {
  const t = text?.trim() ?? "";
  return t.length > 120 ? `${t.slice(0, 120)}...` : t;
}

function buildFileContext(files: NotchFileContext[]) {
  if (files.length === 0) return "";
  const entries = files.map((file) => {
    const kind = file.kind ? ` (${file.kind})` : "";
    const path = file.path ? `: ${file.path}` : "";
    return `- ${file.name}${path}${kind}`;
  });
  return `Attached file context:\n${entries.join("\n")}`;
}

function withTurnDirectives(
  messages: HermesRequestMessage[],
  directives: string[],
) {
  if (directives.length === 0 || messages.length === 0) return messages;

  return [
    ...messages.slice(0, -1),
    {
      role: "system" as const,
      content: [
        "Operator preferences for this turn only:",
        ...directives.map((directive) => `- ${directive}`),
        "Use these preferences only if they are available and relevant.",
      ].join("\n"),
    },
    messages[messages.length - 1]!,
  ];
}

function replaceLatestUserContent(
  messages: HermesRequestMessage[],
  content: string,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return messages.map((message, messageIndex) =>
        messageIndex === index ? { ...message, content } : message,
      );
    }
  }

  return messages;
}

const IN_FLIGHT = new Set<string>();

export async function sendChatTurn({
  text,
  files = [],
  baseUrl,
  apiKey,
  userId,
  sessionId,
  channel = "niki-agent",
  turnDirectives = [],
  messageIdPrefix = "chat",
  onToken,
  signal,
}: SendChatTurnOptions): Promise<SendChatTurnResult> {
  const cleanText = text.trim();
  const fileContext = buildFileContext(files);
  if (!cleanText && !fileContext) {
    return { sessionId: sessionId ?? "", finalText: "" };
  }

  const state = useWorkspaceStore.getState();
  const displayText =
    cleanText ||
    `Attached ${files.length} file${files.length === 1 ? "" : "s"}.`;
  const modelInput =
    cleanText && fileContext
      ? `${cleanText}\n\n${fileContext}`
      : cleanText || fileContext;
  const resolvedSessionId =
    sessionId ||
    state.activeChatSessionId ||
    state.createChatSession(displayText);
  const now = new Date().toISOString();
  const attachmentNames = files.flatMap((file) =>
    file.name ? [file.name] : [],
  );

  // Global in-flight guard — prevents race-condition duplicates
  const flightKey = `${resolvedSessionId}:${displayText}`;
  if (IN_FLIGHT.has(flightKey)) {
    console.info("[chat-turn] already in flight, skipping", {
      source: messageIdPrefix,
      flightKey,
    });
    return { sessionId: resolvedSessionId, finalText: "" };
  }
  IN_FLIGHT.add(flightKey);

  const wrap = (result: SendChatTurnResult): SendChatTurnResult => {
    IN_FLIGHT.delete(flightKey);
    return result;
  };

  // Check for duplicate user message (same content as last message)
    const existingMessages =
      useWorkspaceStore.getState().chatMessages[resolvedSessionId] ?? [];
    const lastMessage = existingMessages[existingMessages.length - 1];
    const isDuplicate =
      lastMessage?.role === "user" && lastMessage.content === displayText;

    let userMessageId: string;
    if (isDuplicate) {
      userMessageId = lastMessage.id;
      console.info("[chat-turn] skipping duplicate user message", {
        source: messageIdPrefix,
        sessionId: resolvedSessionId,
        existingId: userMessageId,
      });
    } else {
      const userMessage: SessionMessage = {
        id: `msg-user-${messageIdPrefix}-${Date.now()}`,
        role: "user",
        content: displayText,
        createdAt: now,
        attachments: attachmentNames.length > 0 ? attachmentNames : undefined,
      };
      userMessageId = userMessage.id;
      console.info("[chat-turn] append user message", {
        source: messageIdPrefix,
        sessionId: resolvedSessionId,
        textChars: displayText.length,
        modelInputChars: modelInput.length,
        fileCount: files.length,
      });
      state.appendChatMessage(resolvedSessionId, userMessage);
    }

  const streamingAssistantId = `msg-assistant-${messageIdPrefix}-stream-${Date.now()}`;
  state.upsertChatMessage(resolvedSessionId, {
    id: streamingAssistantId,
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
  });

  let requestMessages = buildHermesRequestMessages(
    useWorkspaceStore.getState().chatMessages[resolvedSessionId] ?? [],
  );
  if (modelInput && modelInput !== displayText) {
    requestMessages = replaceLatestUserContent(requestMessages, modelInput);
  }
  requestMessages = withTurnDirectives(requestMessages, turnDirectives);

  const currentSession = useWorkspaceStore
    .getState()
    .chatSessions.find((session) => session.id === resolvedSessionId);

  useWorkspaceStore.getState().updateChatSession(resolvedSessionId, {
    status: "live",
    updatedAt: now,
    title:
      currentSession?.titleCustomized || currentSession?.title
        ? currentSession.title
        : summarizeTitle(displayText),
    summary: summarizePreview(displayText),
  });

  try {
    void clearNotchResponse();
    const headers = wrapperHeaders(apiKey, {
      "content-type": "application/json",
    });
    if (userId) headers.set("x-niki-user-id", userId);

    console.info("[chat-turn] fetch /chat/stream", {
      source: messageIdPrefix,
      sessionId: resolvedSessionId,
      channel,
      messageCount: requestMessages.length,
      baseUrl,
    });
    const response = await fetch(wrapperUrl(baseUrl, "/chat/stream"), {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        input: modelInput || displayText,
        sessionId: resolvedSessionId,
        channel,
        messages: requestMessages,
      }),
    });

    if (!response.ok || !response.body) {
      const fallback = `Error ${response.status}`;
      console.error("[chat-turn] stream response failed", {
        source: messageIdPrefix,
        sessionId: resolvedSessionId,
        status: response.status,
        hasBody: Boolean(response.body),
      });
      useWorkspaceStore.getState().appendChatMessage(resolvedSessionId, {
        id: `msg-assistant-${messageIdPrefix}-error-${Date.now()}`,
        role: "assistant",
        content: fallback,
        createdAt: new Date().toISOString(),
      });
      useWorkspaceStore.getState().updateChatSession(resolvedSessionId, {
        status: "paused",
        updatedAt: new Date().toISOString(),
        summary: fallback,
      });
      return wrap({ sessionId: resolvedSessionId, finalText: fallback });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") continue;

        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const token = json.choices?.[0]?.delta?.content ?? "";
          if (token) {
            full += token;
            const visible = stripChatControlMarkers(full);
            onToken?.(visible);
            useWorkspaceStore.getState().upsertChatMessage(resolvedSessionId, {
              id: streamingAssistantId,
              role: "assistant",
              content: visible,
              createdAt: now,
            });
            void pushNotchResponse(visible, "streaming", resolvedSessionId);
          }
        } catch {
          // Ignore malformed SSE chunks and keep the stream alive.
        }
      }
    }

    const assistantContent = stripChatControlMarkers(full);
    const workItemMarkers = extractWorkItemMarkers(full);
    const finalText =
      assistantContent ||
      full ||
      "Niki no recibió texto final de Hermes. Inténtalo otra vez.";

    console.info("[chat-turn] stream complete", {
      source: messageIdPrefix,
      sessionId: resolvedSessionId,
      rawChars: full.length,
      visibleChars: finalText.length,
      markerCount: workItemMarkers.length,
    });
    if (workItemMarkers.length > 0) {
      useWorkspaceStore.getState().bumpWorkItemsRefreshToken();
    }

    useWorkspaceStore.getState().upsertChatMessage(resolvedSessionId, {
      id: streamingAssistantId,
      role: "assistant",
      content: finalText,
      createdAt: now,
    });
    void pushNotchResponse(finalText, "complete", resolvedSessionId);
    useWorkspaceStore.getState().updateChatSession(resolvedSessionId, {
      status: "complete",
      updatedAt: new Date().toISOString(),
      summary: summarizePreview(finalText),
    });

    return wrap({ sessionId: resolvedSessionId, finalText });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.info("[chat-turn] aborted", {
        source: messageIdPrefix,
        sessionId: resolvedSessionId,
      });
      useWorkspaceStore.getState().upsertChatMessage(resolvedSessionId, {
        id: streamingAssistantId,
        role: "assistant",
        content: "Cancelled.",
        createdAt: now,
      });
      useWorkspaceStore.getState().updateChatSession(resolvedSessionId, {
        status: "paused",
        updatedAt: new Date().toISOString(),
        summary: "Cancelled.",
      });
      return wrap({ sessionId: resolvedSessionId, finalText: "Cancelled." });
    }
    const fallback = `Error: ${String(error)}`;
    console.error("[chat-turn] stream error", {
      source: messageIdPrefix,
      sessionId: resolvedSessionId,
      error,
    });
    useWorkspaceStore.getState().upsertChatMessage(resolvedSessionId, {
      id: streamingAssistantId,
      role: "assistant",
      content: fallback,
      createdAt: now,
    });
    void pushNotchResponse(fallback, "error", resolvedSessionId);
    useWorkspaceStore.getState().updateChatSession(resolvedSessionId, {
      status: "paused",
      updatedAt: new Date().toISOString(),
      summary: fallback,
    });
    return wrap({ sessionId: resolvedSessionId, finalText: fallback });
  }
}
