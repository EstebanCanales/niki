"use client";

import type { ReactNode, ElementType } from "react";

export type Phase = "idle" | "chatting" | "done" | "error";
export type ContextMenu = { x: number; y: number } | null;
export type ExecStatus = "pendiente" | "verificada" | "parcial" | "sin_acciones";

export type SpeechRecognitionAlternativeLike = { transcript: string };
export type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
  length: number;
};
export type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};
export type SpeechRecognitionErrorEventLike = {
  error?: string;
  message?: string;
};
export type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
};
export type SpeechRecognitionCtorLike = new () => SpeechRecognitionLike;

export type GridCmd =
  | { type: "text"; value: string }
  | { type: "bar"; values: number[] }
  | null;

export type PanelId = "chat" | "sessions" | "settings";
export type WidgetId = "tasks";
export type MiniPanelTab = PanelId | WidgetId;

export interface WidgetDef {
  id: WidgetId;
  label: string;
  icon: ElementType;
}

export interface PanelDef {
  label: string;
  icon: ElementType;
  content: ReactNode;
}
