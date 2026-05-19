import type { SpeechRecognitionCtorLike, ExecStatus, GridCmd } from "./types";

export function nowTs() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function summarizeSessionTitle(seedText?: string) {
  const trimmed = seedText?.trim() ?? "";
  if (!trimmed) return "New chat";
  return trimmed.length > 44 ? `${trimmed.slice(0, 44)}...` : trimmed;
}

export function summarizeSessionPreview(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "Niki session ready.";
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}...` : trimmed;
}

export function getSpeechRecognitionCtor(): SpeechRecognitionCtorLike | null {
  if (typeof window === "undefined") return null;
  const candidate = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtorLike;
    webkitSpeechRecognition?: SpeechRecognitionCtorLike;
  };
  return (
    candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null
  );
}

export function parseExecStatus(text: string): ExecStatus {
  const match = text.match(/\[\[exec_status:([a-z_]+)\|/i);
  const code = (match?.[1] ?? "").toLowerCase();
  if (code === "verificada" || code === "parcial" || code === "sin_acciones")
    return code;
  return "pendiente";
}

export function stripExecStatusMarker(text: string): string {
  return text.replace(/\n?\[\[exec_status:[^\[\]]+\]\]\s*$/i, "").trim();
}

export function stripUiMarkers(text: string) {
  return text
    .replace(/\[@([^\]]+)\]\(plugin:\/\/([^\)]+)\)/gi, "")
    .replace(/\[\[work_item_(?:created|updated|deleted):[^\]]+\]\]/gi, "")
    .replace(/\[\[grid:[^\]]+\]\]/gi, "")
    .trim();
}

export function appendProgressEntry(entries: string[], next: string): string[] {
  const trimmed = next.trim();
  if (!trimmed || entries[entries.length - 1] === trimmed) return entries;
  return [...entries, trimmed].slice(-5);
}

export function extractProgressMarkers(text: string): {
  cleanText: string;
  progress: string[];
} {
  const progress: string[] = [];
  const cleanText = text.replace(
    /\[\[progress:([^\[\]]+)\]\]/gi,
    (_, message: string) => {
      const trimmed = String(message).trim();
      if (trimmed) progress.push(trimmed);
      return "";
    },
  );
  return { cleanText, progress };
}

export function parseGridCmd(text: string): GridCmd {
  const match = text.match(/\[\[grid:([^\]]+)\]\]/i);
  if (!match) return null;
  const inner = match[1].trim();
  if (inner.startsWith("bar:")) {
    const nums = inner
      .slice(4)
      .split(",")
      .map((n) => Number.parseFloat(n.trim()))
      .filter((n) => !Number.isNaN(n));
    if (nums.length) return { type: "bar", values: nums };
  }
  return {
    type: "text",
    value: inner.replace(/[^A-Za-z0-9!?%+\-. ]/g, "").slice(0, 4),
  };
}

export function formatMsgTime(iso: string | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return sameDay
      ? time
      : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
  } catch {
    return null;
  }
}
