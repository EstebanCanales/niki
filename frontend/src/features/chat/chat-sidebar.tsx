"use client";

import {
  Bot,
  Check,
  ChevronRight,
  LoaderCircle,
  Mic,
  Paperclip,
  Phone,
  Plus,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { RichMessage } from "@/components/chat/rich-message";
import { navCardClassName } from "@/components/layout/nav-visuals";
import { stripChatControlMarkers } from "@/core/runtime/chat-history";
import { useRuntime } from "@/hooks/use-runtime";
import { useWorkspaceStore } from "@/stores/use-workspace-store";
import type { NotchFileContext } from "@/types/niki";
import { useStt } from "../agent/use-stt";
import { useTts } from "../agent/use-tts";
import { sendChatTurn } from "./send-chat-turn";

function formatTime(iso: string | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return null;
  }
}

export function ChatSidebar() {
  const baseUrl = useWorkspaceStore((s) => s.backendBaseUrl);
  const apiKey = useWorkspaceStore((s) => s.backendApiKey);
  const userId = useWorkspaceStore((s) => s.userId);
  const activeChatSessionId = useWorkspaceStore((s) => s.activeChatSessionId);
  const activeSession = useWorkspaceStore(
    (s) =>
      s.chatSessions.find((session) => session.id === s.activeChatSessionId) ??
      null,
  );
  const rawHistory = useWorkspaceStore(
    (s) => s.chatMessages[activeChatSessionId] ?? [],
  );

  // Deduplicate by message id to prevent duplicate bubbles
  const history = useMemo(() => {
    const seen = new Set<string>();
    return rawHistory.filter((msg) => {
      if (seen.has(msg.id)) return false;
      seen.add(msg.id);
      return true;
    });
  }, [rawHistory]);

  // Debug: log if duplicates are detected
  useEffect(() => {
    const ids = rawHistory.map((m) => m.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length > 0) {
      console.warn("[chat-sidebar] duplicate message ids detected:", dupes);
    }
  }, [rawHistory]);
  const updateChatSession = useWorkspaceStore((s) => s.updateChatSession);
  const createChatSession = useWorkspaceStore((s) => s.createChatSession);
  const setActiveChatSession = useWorkspaceStore((s) => s.setActiveChatSession);
  const setSidebarAudioActive = useWorkspaceStore(
    (s) => s.setSidebarAudioActive,
  );
  const autoVoice = useWorkspaceStore((s) => s.autoVoice);
  const setAutoVoice = useWorkspaceStore((s) => s.setAutoVoice);
  const autoVoiceConversation = useWorkspaceStore(
    (s) => s.autoVoiceConversation,
  );
  const setAutoVoiceConversation = useWorkspaceStore(
    (s) => s.setAutoVoiceConversation,
  );
  const runtime = useRuntime();

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [titleDraft, setTitleDraft] = useState(
    activeSession?.title ?? "New chat",
  );
  const [editingTitle, setEditingTitle] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [pluginMenuOpen, setPluginMenuOpen] = useState(false);
  const [planModeEnabled, setPlanModeEnabled] = useState(false);
  const [selectedPluginIds, setSelectedPluginIds] = useState<string[]>([]);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(
    null,
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const isSendingRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const wasStreamingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerMenuRef = useRef<HTMLDivElement>(null);

  const resizeInput = useCallback(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    textarea.style.cssText = [
      "height: 0px",
      `height: ${Math.min(textarea.scrollHeight, 180)}px`,
      `overflow-y: ${textarea.scrollHeight > 180 ? "auto" : "hidden"}`,
    ].join("; ");
  }, []);

  const updateInput = useCallback(
    (nextValue: string) => {
      setInput(nextValue);
      window.requestAnimationFrame(() => resizeInput());
    },
    [resizeInput],
  );

  const availablePlugins = useMemo(() => {
    if (runtime.plugins.length > 0) {
      return runtime.plugins;
    }

    return runtime.tools.reduce<typeof runtime.plugins>((plugins, tool) => {
      if (tool.origin !== "plugin" && tool.origin !== "skill") {
        return plugins;
      }

      plugins.push({
        id: tool.id,
        name: tool.name,
        type: tool.origin === "skill" ? "skill" : "plugin",
        version: "runtime",
        status: tool.status,
        origin: tool.origin,
        description: tool.description,
      });
      return plugins;
    }, []);
  }, [runtime.plugins, runtime.tools]);

  const selectedPlugins = useMemo(
    () =>
      availablePlugins.filter((plugin) =>
        selectedPluginIds.includes(plugin.id),
      ),
    [availablePlugins, selectedPluginIds],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, liveText]);

  useEffect(() => {
    setTitleDraft(activeSession?.title ?? "New chat");
  }, [activeSession?.title, activeChatSessionId]);

  useEffect(() => {
    if (editingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [editingTitle]);

  useEffect(() => {
    setSelectedPluginIds((current) => {
      const next = current.filter((id) =>
        availablePlugins.some((plugin) => plugin.id === id),
      );
      return next.length === current.length ? current : next;
    });
  }, [availablePlugins]);

  useEffect(() => {
    if (!composerMenuOpen && !pluginMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!composerMenuRef.current?.contains(event.target as Node)) {
        setComposerMenuOpen(false);
        setPluginMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [composerMenuOpen, pluginMenuOpen]);

  const hasText = input.trim().length > 0;
  const hasAttachments = selectedFiles.length > 0;
  const headerTitle = activeSession?.title ?? "New chat";

  const commitTitle = useCallback(() => {
    const nextTitle = titleDraft.trim() || "New chat";
    if (!activeChatSessionId) return;
    updateChatSession(activeChatSessionId, {
      title: nextTitle,
      titleCustomized: true,
      updatedAt: new Date().toISOString(),
    });
    setEditingTitle(false);
  }, [activeChatSessionId, titleDraft, updateChatSession]);

  const handleFilesPicked = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      if (files.length === 0) return;
      setSelectedFiles((current) => [...current, ...files]);
      event.target.value = "";
    },
    [],
  );

  const removeSelectedFile = useCallback((index: number) => {
    setSelectedFiles((current) =>
      current.filter((_, fileIndex) => fileIndex !== index),
    );
  }, []);

  const togglePluginSelection = useCallback((pluginId: string) => {
    setSelectedPluginIds((current) =>
      current.includes(pluginId)
        ? current.filter((id) => id !== pluginId)
        : [...current, pluginId],
    );
  }, []);

  const handleNewChat = useCallback(() => {
    const sessionId = createChatSession();
    setActiveChatSession(sessionId);
    updateInput("");
    setLiveText("");
    setSelectedFiles([]);
    setPlanModeEnabled(false);
    setSelectedPluginIds([]);
    setComposerMenuOpen(false);
    setPluginMenuOpen(false);
    setEditingTitle(false);
  }, [createChatSession, setActiveChatSession, updateInput]);

  const cancelSend = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStreaming(false);
    setLiveText("");
    isSendingRef.current = false;
  }, []);

  const send = useCallback(
    async (overrideText?: string) => {
      if (isSendingRef.current) return;
      isSendingRef.current = true;

      const usingOverride = typeof overrideText === "string";
      const text = (overrideText ?? input).trim();
      const files = usingOverride ? [] : selectedFiles;
      if ((!text && files.length === 0) || streaming) {
        isSendingRef.current = false;
        return;
      }
      if (!usingOverride) {
        updateInput("");
      }

      const turnDirectives = [
        planModeEnabled
          ? "Plan mode is enabled. Think through the approach before answering."
          : null,
        selectedPlugins.length > 0
          ? `Prefer these Hermes plugins or skills when relevant: ${selectedPlugins
              .map((plugin) => `${plugin.name} (${plugin.id})`)
              .join(", ")}.`
          : null,
      ].filter((value): value is string => Boolean(value));

      setStreaming(true);
      setLiveText("");
      setSelectedFiles([]);
      abortControllerRef.current = new AbortController();

      try {
        const fileContext: NotchFileContext[] = files.map((file) => ({
          name: file.name,
          path: file.name,
          kind: file.type || "file",
        }));

        await sendChatTurn({
          text,
          files: fileContext,
          baseUrl,
          apiKey,
          userId,
          sessionId: activeChatSessionId || undefined,
          channel: "niki-agent",
          turnDirectives,
          messageIdPrefix: "chat",
          onToken: setLiveText,
          signal: abortControllerRef.current.signal,
        });
      } catch (err) {
        console.error("[chat-sidebar] send error", err);
      } finally {
        abortControllerRef.current = null;
        setLiveText("");
        setStreaming(false);
        isSendingRef.current = false;
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    },
    [
      input,
      selectedFiles,
      streaming,
      activeChatSessionId,
      apiKey,
      userId,
      baseUrl,
      planModeEnabled,
      selectedPlugins,
      updateInput,
    ],
  );

  const stt = useStt({
    lang: "es-ES",
    onTranscript: useCallback(
      (text: string) => {
        if (!text.trim() || streaming || isSendingRef.current) return;
        const trimmed = text.trim();
        if (autoVoiceConversation) {
          void send(trimmed);
        } else {
          updateInput(trimmed);
          window.setTimeout(() => inputRef.current?.focus(), 100);
        }
      },
      [streaming, updateInput, autoVoiceConversation, send],
    ),
  });

  const tts = useTts({ lang: "es-ES" });

  const speakMessage = useCallback(
    async (messageId: string, text: string) => {
      if (!text.trim() || isSpeakingRef.current) return;
      isSpeakingRef.current = true;
      setSpeakingMessageId(messageId);
      try {
        await tts.speak(text);
      } finally {
        isSpeakingRef.current = false;
      }
    },
    [tts],
  );

  const stopSpeaking = useCallback(() => {
    tts.stop();
    setSpeakingMessageId(null);
  }, [tts]);

  // Track when TTS naturally finishes
  useEffect(() => {
    if (!tts.speaking && speakingMessageId) {
      setSpeakingMessageId(null);
    }
  }, [tts.speaking, speakingMessageId]);

  // Auto-speak completed assistant messages — triggered only when streaming finishes
  const lastSpokenIdRef = useRef<string | null>(null);
  useEffect(() => {
    const justFinished = wasStreamingRef.current && !streaming;
    wasStreamingRef.current = streaming;
    if (!justFinished) return;
    if (!autoVoice && !autoVoiceConversation) return;

    const lastMessage = history[history.length - 1];
    if (!lastMessage || lastMessage.role !== "assistant") return;
    const cleanText = stripChatControlMarkers(lastMessage.content).trim();
    if (!cleanText) return;
    if (lastSpokenIdRef.current === lastMessage.id) return;
    if (isSpeakingRef.current) return;

    lastSpokenIdRef.current = lastMessage.id;
    isSpeakingRef.current = true;
    void tts
      .speak(cleanText)
      .then(() => {
        setSpeakingMessageId(lastMessage.id);
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => {
        isSpeakingRef.current = false;
      });
  }, [streaming, history, autoVoice, autoVoiceConversation, tts]);

  // Cancel TTS when switching chat sessions
  useEffect(() => {
    stopSpeaking();
    lastSpokenIdRef.current = null;
    isSpeakingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatSessionId]);

  useEffect(() => {
    setSidebarAudioActive(stt.recording);
    return () => setSidebarAudioActive(false);
  }, [stt.recording, setSidebarAudioActive]);

  const isTogglingRef = useRef(false);

  const toggleListening = useCallback(() => {
    if (isTogglingRef.current) return;
    isTogglingRef.current = true;
    console.log("[chat-sidebar] toggleListening clicked");
    if (streaming) {
      isTogglingRef.current = false;
      return;
    }
    stt.toggle();
    window.setTimeout(() => {
      isTogglingRef.current = false;
    }, 500);
  }, [streaming, stt]);

  const attachmentSummary = useMemo(() => {
    if (selectedFiles.length === 0) return null;
    return `${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} selected`;
  }, [selectedFiles.length]);

  const pluginSummary = useMemo(() => {
    if (selectedPlugins.length === 0) {
      return `${availablePlugins.length} Hermes ${
        availablePlugins.length === 1 ? "plugin" : "plugins"
      } available`;
    }

    return `${selectedPlugins.length} selected`;
  }, [availablePlugins.length, selectedPlugins.length]);

  return (
    <div className="flex h-full flex-col bg-[linear-gradient(180deg,rgba(255,255,255,0.012)_0%,rgba(255,255,255,0.02)_100%)]">
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] p-3">
        <div className="flex justify-between items-center">
          <div>
            {editingTitle ? (
              <input
                ref={titleInputRef}
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={commitTitle}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitTitle();
                  if (event.key === "Escape") {
                    setTitleDraft(headerTitle);
                    setEditingTitle(false);
                  }
                }}
                className="w-full bg-transparent text-sm font-semibold text-white/84 outline-none"
              />
            ) : (
              <button
                onClick={() => setEditingTitle(true)}
                className="max-w-full text-left text-sm font-semibold text-white/84 transition hover:text-white"
              >
                {headerTitle}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const next = !autoVoiceConversation;
              setAutoVoiceConversation(next);
              if (next) setAutoVoice(true);
            }}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] transition ${
              autoVoiceConversation
                ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200/80"
                : "border-white/[0.08] bg-white/[0.04] text-white/68 hover:bg-white/[0.08]"
            }`}
            title={
              autoVoiceConversation
                ? "Voice conversation is on"
                : "Voice conversation is off"
            }
          >
            <Phone className="size-3" />
            {autoVoiceConversation ? "Voice" : "Text"}
          </button>
          <button
            onClick={handleNewChat}
            className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/68 transition hover:bg-white/[0.08]"
          >
            <Plus className="size-3.5" />
            New chat
          </button>
        </div>
      </div>

      <div className="scrollbar-subtle flex-1 overflow-y-auto px-0 py-0">
        {history.length === 0 && !streaming ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-3 py-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03]">
              <Bot className="size-5 text-white/30" />
            </div>
            <div>
              <p className="text-sm text-white/60">Start a conversation</p>
              <p className="mt-1 text-xs text-white/28">
                Titles are created automatically and you can rename them inline.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 px-3 py-3">
            {history.map((msg) => {
              const isUser = msg.role === "user";
              return (
                <div
                  key={msg.id}
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`flex max-w-[86%] flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`px-3 py-2.5 text-xs leading-relaxed ${
                        isUser
                          ? "rounded-2xl rounded-tr-sm border border-white/[0.08] bg-white/[0.08] text-white/86"
                          : `${navCardClassName} rounded-tl-sm text-white/76`
                      }`}
                    >
                      {isUser ? (
                        <p>{msg.content}</p>
                      ) : !stripChatControlMarkers(msg.content).trim() ? (
                        <LoaderCircle className="size-3.5 animate-spin text-white/30" />
                      ) : (
                        <RichMessage
                          content={stripChatControlMarkers(msg.content)}
                        />
                      )}
                      {msg.attachments?.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {msg.attachments.map((attachment) => (
                            <span
                              key={attachment}
                              className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] text-white/54"
                            >
                              {attachment}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {formatTime(msg.createdAt) ? (
                      <span className="px-1 text-[9px] text-white/20">
                        {formatTime(msg.createdAt)}
                      </span>
                    ) : null}
                    {!isUser && tts.supported ? (
                      <button
                        onClick={() => {
                          if (speakingMessageId === msg.id) {
                            stopSpeaking();
                          } else {
                            const cleanText = stripChatControlMarkers(
                              msg.content,
                            ).trim();
                            if (cleanText) void speakMessage(msg.id, cleanText);
                          }
                        }}
                        className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition ${
                          speakingMessageId === msg.id
                            ? "bg-cyan-300/20 text-cyan-200"
                            : "text-white/20 hover:text-white/50 hover:bg-white/[0.06]"
                        }`}
                        title={speakingMessageId === msg.id ? "Stop" : "Listen"}
                      >
                        {speakingMessageId === msg.id ? (
                          <VolumeX className="size-3" />
                        ) : (
                          <Volume2 className="size-3" />
                        )}
                        {speakingMessageId === msg.id ? "Speaking" : "Listen"}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {streaming ? (
              <div className="flex justify-start">
                <div className="flex max-w-[86%] flex-col gap-1 items-start">
                  <div
                    className={`${navCardClassName} rounded-tl-sm px-3 py-2.5 text-xs leading-relaxed text-white/72`}
                  >
                    {liveText ? (
                      <RichMessage
                        content={stripChatControlMarkers(liveText)}
                      />
                    ) : (
                      <LoaderCircle className="size-3.5 animate-spin text-white/30" />
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-3 py-3">
        {selectedFiles.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {selectedFiles.map((file, index) => {
              const fileKey = [file.name, file.size, file.lastModified].join(
                "-",
              );
              return (
                <button
                  key={fileKey}
                  onClick={() => removeSelectedFile(index)}
                  className="flex min-h-14 min-w-14 max-w-[120px] flex-col justify-between rounded-[18px] border border-white/[0.08] bg-white/[0.045] px-3 py-2 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                >
                  <span className="truncate text-[11px] font-medium text-white/74">
                    {file.name}
                  </span>
                  <span className="mt-2 text-[10px] text-white/30">remove</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {planModeEnabled || selectedPlugins.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {planModeEnabled ? (
              <button
                onClick={() => setPlanModeEnabled(false)}
                className="inline-flex items-center gap-2 rounded-full border border-cyan-300/16 bg-cyan-300/10 px-3 py-1.5 text-[11px] text-cyan-100/90 transition hover:bg-cyan-300/14"
                title="Disable plan mode"
              >
                <Sparkles className="size-3.5" />
                <span className="max-w-[220px] truncate">Plan mode</span>
                <X className="size-3" />
              </button>
            ) : null}

            {selectedPlugins.map((plugin) => (
              <button
                key={plugin.id}
                onClick={() => togglePluginSelection(plugin.id)}
                className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.045] px-3 py-1.5 text-[11px] text-white/72 transition hover:bg-white/[0.08]"
                title="Remove plugin"
              >
                <span className="max-w-[160px] truncate">{plugin.name}</span>
                <span className="rounded-full border border-white/[0.08] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.16em] text-white/34">
                  {plugin.type}
                </span>
                <X className="size-3 text-white/34" />
              </button>
            ))}
          </div>
        ) : null}

        <div ref={composerMenuRef} className="relative">
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col overflow-hidden rounded-[24px] border border-white/[0.08] bg-white/[0.04]">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => updateInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={streaming ? "Streaming…" : "Message…"}
                disabled={streaming}
                rows={1}
                className="min-h-[56px] max-h-[180px] w-full resize-none bg-transparent px-4 pb-1 pt-3 text-sm text-white/82 placeholder:text-white/24 outline-none disabled:opacity-40"
              />

              <div className="flex items-center justify-between px-3 pb-2 pt-0">
                <button
                  onClick={() => {
                    setComposerMenuOpen((current) => {
                      const next = !current;
                      if (!next) setPluginMenuOpen(false);
                      return next;
                    });
                  }}
                  className={`flex size-9 shrink-0 items-center justify-center rounded-xl transition ${
                    composerMenuOpen
                      ? "bg-white/[0.12] text-white/90"
                      : "text-white/58 hover:bg-white/[0.08] hover:text-white/82"
                  }`}
                  title="Composer options"
                >
                  <Plus
                    className={`size-4 transition-transform ${
                      composerMenuOpen ? "rotate-45" : "rotate-0"
                    }`}
                  />
                </button>

                <div className="flex items-center gap-1">
                  {stt.error ? (
                    <span className="mr-1 text-[10px] text-rose-300/80">
                      {stt.error}
                    </span>
                  ) : null}
                  <button
                    onClick={toggleListening}
                    disabled={streaming || !stt.supported}
                    className={`relative flex size-9 shrink-0 items-center justify-center rounded-xl transition ${
                      stt.recording
                        ? "bg-rose-500 text-white shadow-[0_0_24px_rgba(255,80,80,0.45)] animate-pulse"
                        : stt.processing
                          ? "bg-amber-500/20 text-amber-300"
                          : stt.error
                            ? "bg-rose-500/10 text-rose-300/60"
                            : "text-white/58 hover:bg-white/[0.08] hover:text-white/82"
                    } disabled:opacity-30`}
                    title={
                      !stt.supported
                        ? "Voice not supported"
                        : stt.error
                          ? stt.error
                          : stt.recording
                            ? "Click to stop recording"
                            : stt.processing
                              ? "Transcribing..."
                              : "Click to start voice input"
                    }
                  >
                    {stt.recording ? (
                      <span className="size-2.5 rounded-sm bg-white" />
                    ) : stt.processing ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Mic className="size-4" />
                    )}
                    {stt.recording && (
                      <span
                        className="absolute bottom-0 left-0 h-0.5 bg-white/70 transition-all duration-75 rounded-b-xl"
                        style={{
                          width: `${Math.min(100, (stt.audioLevel ?? 0) * 100)}%`,
                        }}
                      />
                    )}
                  </button>

                  <button
                    onClick={() => {
                      if (streaming) {
                        cancelSend();
                      } else {
                        void send();
                      }
                    }}
                    disabled={!streaming && !hasText && !hasAttachments}
                    className="flex size-9 shrink-0 items-center justify-center rounded-xl text-white/72 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-30"
                    title={streaming ? "Cancel" : "Send"}
                  >
                    {streaming ? (
                      <X className="size-4 text-rose-300" />
                    ) : (
                      <Send className="size-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {composerMenuOpen ? (
            <>
              <div className="absolute bottom-full left-0 z-30 mb-3 w-[280px] rounded-2xl bg-black/85 p-2 shadow-[0_18px_40px_rgba(0,0,0,0.32)] backdrop-blur-xl">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-white/78 transition hover:bg-white/[0.06]"
                >
                  <Paperclip className="size-4 shrink-0 text-white/58" />
                  <div className="min-w-0">
                    <p className="truncate">Attach files</p>
                    {attachmentSummary ? (
                      <p className="text-[11px] text-white/34">
                        {attachmentSummary}
                      </p>
                    ) : null}
                  </div>
                </button>

                <div className="my-1 h-px bg-white/[0.06]" />

                <button
                  onClick={() => setPlanModeEnabled((current) => !current)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm text-white/78 transition hover:bg-white/[0.06]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Sparkles className="size-4 shrink-0 text-cyan-200/80" />
                    <div className="min-w-0">
                      <p>Plan mode</p>
                      <p className="truncate text-[11px] text-white/34">
                        {planModeEnabled ? "On" : "Off"}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition ${
                      planModeEnabled ? "bg-cyan-300/70" : "bg-white/15"
                    }`}
                  >
                    <span
                      className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white transition-transform ${
                        planModeEnabled ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </span>
                </button>

                <button
                  onClick={() => setAutoVoice(!autoVoice)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm text-white/78 transition hover:bg-white/[0.06]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Volume2 className="size-4 shrink-0 text-white/58" />
                    <div className="min-w-0">
                      <p>Auto voice</p>
                      <p className="truncate text-[11px] text-white/34">
                        {autoVoice ? "On" : "Off"}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition ${
                      autoVoice ? "bg-cyan-300/70" : "bg-white/15"
                    }`}
                  >
                    <span
                      className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white transition-transform ${
                        autoVoice ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </span>
                </button>



                <button
                  onClick={() => setPluginMenuOpen((current) => !current)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm text-white/78 transition hover:bg-white/[0.06]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Sparkles className="size-4 shrink-0 text-white/58" />
                    <div className="min-w-0">
                      <p>Plugins</p>
                      <p className="truncate text-[11px] text-white/34">
                        {pluginSummary}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-white/34" />
                </button>
              </div>

              {pluginMenuOpen ? (
                <div className="absolute bottom-full left-[292px] z-30 mb-3 w-[260px] rounded-2xl bg-black/85 p-2 shadow-[0_18px_40px_rgba(0,0,0,0.32)] backdrop-blur-xl">
                  {availablePlugins.length > 0 ? (
                    availablePlugins.map((plugin) => {
                      const isSelected = selectedPluginIds.includes(plugin.id);
                      return (
                        <button
                          key={plugin.id}
                          onClick={() => togglePluginSelection(plugin.id)}
                          className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-white/[0.06]"
                        >
                          <div className="min-w-0 flex items-center gap-3">
                            <Check
                              className={`size-4 shrink-0 ${
                                isSelected ? "text-cyan-200" : "text-white/18"
                              }`}
                            />
                            <div className="min-w-0">
                              <p className="truncate text-sm text-white/76">
                                {plugin.name}
                              </p>
                              <p className="truncate text-[11px] text-white/34">
                                {plugin.type}
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    <p className="px-3 py-2 text-xs text-white/34">
                      No Hermes plugins detected right now.
                    </p>
                  )}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFilesPicked}
        />
      </div>
    </div>
  );
}
