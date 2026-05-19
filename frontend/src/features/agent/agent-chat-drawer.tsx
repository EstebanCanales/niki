"use client";

import { useEffect, useRef } from "react";
import { Bot, LoaderCircle, MessageSquare, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RichMessage } from "@/components/chat/rich-message";
import { VoiceButton } from "@/components/agent/voice-button";
import { stripChatControlMarkers } from "@/core/runtime/chat-history";
import type { SessionMessage } from "@/types/niki";
import type { Phase } from "./types";
import { formatMsgTime } from "./utils";

export function AgentChatDrawer({
  open,
  onOpenChange,
  history,
  activeTitle,
  activeSummary,
  phase,
  response,
  streamProgress,
  textInput,
  onTextInputChange,
  onTextSend,
  onNewChat,
  sttListening,
  sttProcessing,
  sttSupported,
  sttInterim,
  sttAudioLevel,
  onSttToggle,
}: {
  open: boolean;
  onOpenChange(next: boolean): void;
  history: SessionMessage[];
  activeTitle: string;
  activeSummary: string;
  phase: Phase;
  response: string | null;
  streamProgress: string[];
  textInput: string;
  onTextInputChange(next: string): void;
  onTextSend(): void;
  onNewChat(): void;
  sttListening?: boolean;
  sttProcessing?: boolean;
  sttSupported?: boolean;
  sttInterim?: string;
  sttAudioLevel?: number;
  onSttToggle?(): void;
}) {
  const busy = phase === "chatting";
  const surfaceRef = useRef<HTMLDivElement>(null);
  const closeDrawerRef = useRef(onOpenChange);
  const latestProgress =
    streamProgress[streamProgress.length - 1] ?? "Thinking…";

  useEffect(() => {
    closeDrawerRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDrawerRef.current(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        surfaceRef.current &&
        !surfaceRef.current.contains(e.target as Node)
      ) {
        closeDrawerRef.current(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <>
      <div
        className={`absolute inset-0 z-40 flex items-center justify-center px-4 py-5 transition-all duration-300 ${
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
        style={{
          background: open
            ? "radial-gradient(circle at 62% 48%, rgba(255,255,255,0.04), transparent 24%), rgba(3,6,10,0.28)"
            : "transparent",
          backdropFilter: open ? "blur(8px)" : "blur(0px)",
        }}
      >
        <div
          ref={surfaceRef}
          className={`page-shell relative flex h-full w-full max-w-[880px] flex-col overflow-hidden transition-all duration-300 ${
            open ? "translate-y-0 scale-100" : "translate-y-6 scale-[0.97]"
          }`}
          style={{
            maxHeight: "min(88vh, 920px)",
            background:
              "radial-gradient(circle at top, rgba(255,255,255,0.06), transparent 28%), linear-gradient(180deg, rgba(11,15,21,0.92), rgba(7,10,15,0.96))",
          }}
        >
          <div className="pointer-events-none absolute inset-x-10 top-0 h-24 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.08),transparent_72%)] blur-3xl" />

          <div className="relative border-b border-white/[0.07] p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-11 items-center justify-center rounded-[18px] border border-white/10 bg-white/[0.05] text-white/80">
                    <Bot className="size-5" />
                  </span>
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.26em] text-white/60">
                      Conversation
                    </p>
                    <p className="mt-1 text-xl font-semibold text-white">
                      {activeTitle}
                    </p>
                  </div>
                </div>
                <p className="mt-4 max-w-xl text-sm leading-6 text-white/46">
                  {activeSummary}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onNewChat}
                  title="New chat"
                  className="rounded-full px-4"
                >
                  <Plus className="size-3.5" />
                  New chat
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onOpenChange(false)}
                  title="Close chat"
                  className="size-10 rounded-full text-white/62"
                >
                  <X className="size-5" />
                </Button>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/52">
                {busy ? "Streaming" : "Ready"}
              </span>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] text-white/60">
                Dedicated conversation
              </span>
            </div>
          </div>

          <div className="scrollbar-subtle relative flex-1 overflow-y-auto px-5 py-6">
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5">
              {history.length === 0 && phase === "idle" && (
                <div className="rounded-[32px] border border-white/[0.07] bg-white/[0.03] px-8 py-12 text-center shadow-[0_24px_80px_rgba(0,0,4,0.32)]">
                  <div className="mx-auto max-w-sm space-y-3">
                    <p className="text-lg font-medium text-white">
                      Start the conversation
                    </p>
                    <p className="text-sm leading-6 text-white/44">
                      This should feel like a floating conversation chamber over
                      the grid, not navigation chrome.
                    </p>
                  </div>
                </div>
              )}

              {streamProgress.length > 0 && (
                <div className="rounded-[26px] border border-white/[0.08] bg-white/[0.04] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.16)]">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-white/70">
                    <LoaderCircle className="size-3.5 animate-spin" />
                    Progress feed
                  </div>
                  <div className="mt-3 space-y-2">
                    {streamProgress.map((item) => (
                      <p key={item} className="text-sm text-white/76">
                        {item}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {history.map((msg) => {
                const isUser = msg.role === "user";
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`flex max-w-[88%] flex-col gap-2 ${isUser ? "items-end" : "items-start"}`}
                    >
                      <div
                        className={`flex items-center gap-2 px-1 text-[11px] uppercase tracking-[0.18em] ${
                          isUser ? "text-white/70" : "text-white/60"
                        }`}
                      >
                        <span className="inline-flex size-8 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04]">
                          {isUser ? (
                            <MessageSquare className="size-3.5" />
                          ) : (
                            <Bot className="size-3.5" />
                          )}
                        </span>
                        {isUser ? "You" : "Niki"}
                        {formatMsgTime(msg.createdAt) ? (
                          <span className="normal-case tracking-normal text-white/30">
                            {formatMsgTime(msg.createdAt)}
                          </span>
                        ) : null}
                      </div>

                      <div
                        className={`px-5 py-4 text-sm leading-7 shadow-[0_26px_70px_rgba(0,0,0,0.18)] ${
                          isUser
                            ? "rounded-[30px] rounded-tr-[12px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.04))] text-white"
                            : "rounded-[30px] rounded-tl-[12px] border border-white/[0.06] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] text-white/82 backdrop-blur-xl"
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
                      </div>
                    </div>
                  </div>
                );
              })}

              {phase === "chatting" && (
                <div className="flex justify-start">
                  <div className="flex max-w-[88%] flex-col gap-2">
                    <div className="flex items-center gap-2 px-1 text-[11px] uppercase tracking-[0.18em] text-white/60">
                      <span className="inline-flex size-8 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04]">
                        <Bot className="size-3.5" />
                      </span>
                      Niki live
                    </div>

                    <div className="rounded-[30px] rounded-tl-[12px] border border-white/[0.06] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] px-5 py-4 text-sm leading-7 text-white/80 backdrop-blur-xl shadow-[0_26px_70px_rgba(0,0,0,0.18)]">
                      {response ? (
                        <RichMessage content={response} />
                      ) : (
                        <div className="space-y-3">
                          <p className="text-white/72">{latestProgress}</p>
                          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/34">
                            <LoaderCircle className="size-3.5 animate-spin" />
                            Streaming response
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="relative border-t border-white/[0.07] p-5">
            <div className="mx-auto w-full max-w-[720px]">
              <div className="rounded-[32px] border border-white/[0.07] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))] p-3 shadow-[0_24px_80px_rgba(0,0,4,0.28)] backdrop-blur-2xl">
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={textInput}
                      onChange={(e) => onTextInputChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          onTextSend();
                        }
                      }}
                      placeholder={
                        sttListening
                          ? sttInterim || "Listening..."
                          : busy
                            ? "Hermes is responding..."
                            : "Ask Niki anything..."
                      }
                      disabled={busy || sttListening}
                      className="h-14 w-full rounded-[24px] border border-white/[0.06] bg-[rgba(255,255,255,0.04)] px-5 text-sm text-white/84 placeholder:text-white/24 outline-none transition-all focus:border-white/15 focus:bg-[rgba(255,255,255,0.06)] disabled:opacity-40"
                    />
                  </div>

                  <VoiceButton
                    listening={sttListening ?? false}
                    processing={sttProcessing ?? false}
                    supported={sttSupported ?? false}
                    audioLevel={sttAudioLevel}
                    onClick={() => onSttToggle?.()}
                    disabled={busy}
                  />
                  <Button
                    onClick={onTextSend}
                    disabled={!textInput.trim() || busy || sttListening}
                    size="icon"
                    className="size-14 rounded-[24px]"
                    title="Send message"
                  >
                    <svg width="17" height="17" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M3 8h10M8 3l5 5-5 5"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </Button>
                </div>

                <div className="mt-3 flex items-center justify-between px-2 text-[11px] text-white/34">
                  <span>{busy ? "Live stream active" : "Enter to send"}</span>
                  <span>Floating chat surface</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
