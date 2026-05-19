"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { wrapperHeaders, wrapperUrl } from "@/core/runtime/wrapper";
import { useWorkspaceStore } from "@/stores/use-workspace-store";

/** Strip markdown so TTS doesn't read asterisks, hashes, backticks, etc. */
function sanitizeForTts(text: string): string {
  return (
    text
      // Headers: ### Title → Title
      .replace(/^#{1,6}\s+/gm, "")
      // Bold/italic: **text**, *text*, __text__, _text_ → text
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(\*|_)(.+?)\1/g, "$2")
      // Inline code: `text` → text
      .replace(/`([^`]+)`/g, "$1")
      // Code blocks: ```lang\ncode\n``` → (omit)
      .replace(/```[\s\S]*?```/g, " ")
      // Links: [text](url) → text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // List markers
      .replace(/^[\s]*[-*+][\s]+/gm, "")
      .replace(/^[\s]*\d+\.[\s]+/gm, "")
      // Blockquote
      .replace(/^>\s?/gm, "")
      // Horizontal rules
      .replace(/^-{3,}\s*$/gm, " ")
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Split text into sentence-sized chunks, respecting max length. */
function segmentText(text: string, maxChars = 220): string[] {
  if (text.length <= maxChars) return [text];

  // Split into sentences preserving delimiters
  const raw = text.split(/(?<=[.!?])\s+/);
  const sentences = raw.map((s) => s.trim()).filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) {
      chunks.push(current.trim());
      current = "";
    }
  };

  for (const sentence of sentences) {
    if (!sentence) continue;

    const combined = current ? `${current} ${sentence}` : sentence;

    if (combined.length <= maxChars) {
      current = combined;
      continue;
    }

    // Doesn't fit — flush what we have
    flush();

    if (sentence.length <= maxChars) {
      current = sentence;
      continue;
    }

    // Single sentence is too long — split by commas
    const commaParts = sentence.split(", ");
    for (const part of commaParts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      const combinedPart = current ? `${current}, ${trimmed}` : trimmed;

      if (combinedPart.length <= maxChars) {
        current = combinedPart;
      } else {
        flush();
        if (trimmed.length <= maxChars) {
          current = trimmed;
        } else {
          // Hard split by words
          const words = trimmed.split(/\s+/);
          let wordBuf = "";
          for (const word of words) {
            const next = wordBuf ? `${wordBuf} ${word}` : word;
            if (next.length <= maxChars) {
              wordBuf = next;
            } else {
              if (wordBuf) chunks.push(wordBuf.trim());
              wordBuf = word;
            }
          }
          if (wordBuf) chunks.push(wordBuf.trim());
        }
      }
    }
  }

  flush();
  return chunks.filter((c) => c.length > 0);
}

export function useTts({
  lang = "es-ES",
}: {
  lang?: string;
} = {}) {
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);

  const baseUrl = useWorkspaceStore((s) => s.backendBaseUrl);
  const apiKey = useWorkspaceStore((s) => s.backendApiKey);
  const ttsVoice = useWorkspaceStore((s) => s.ttsVoice);

  const abortRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setSupported(Boolean(baseUrl));
    return () => {
      abortRef.current = true;
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
    };
  }, [baseUrl]);

  const synthesizeChunk = useCallback(
    async (text: string): Promise<string | null> => {
      try {
        const res = await fetch(wrapperUrl(baseUrl, "/voice/synthesize"), {
          method: "POST",
          headers: wrapperHeaders(apiKey, { "Content-Type": "application/json" }),
          body: JSON.stringify({ text, language: lang, voice: ttsVoice }),
        });

        const data = (await res.json()) as {
          ok: boolean;
          audio?: string;
          mime?: string;
          error?: string;
        };

        if (!data.ok || !data.audio) {
          console.error("[tts] chunk failed:", data.error);
          return null;
        }

        const mime = data.mime ?? "audio/wav";
        const blob = new Blob(
          [Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0))],
          { type: mime },
        );
        return URL.createObjectURL(blob);
      } catch (err) {
        console.error("[tts] chunk error:", err);
        return null;
      }
    },
    [baseUrl, apiKey, lang, ttsVoice],
  );

  const playBlobUrls = useCallback(
    async (blobUrls: string[]) => {
      for (const url of blobUrls) {
        if (abortRef.current) {
          URL.revokeObjectURL(url);
          continue;
        }

        await new Promise<void>((resolve) => {
          const audio = new Audio(url);
          currentAudioRef.current = audio;

          const cleanup = () => {
            URL.revokeObjectURL(url);
            if (currentAudioRef.current === audio) {
              currentAudioRef.current = null;
            }
            resolve();
          };

          audio.onended = cleanup;
          audio.onerror = cleanup;
          audio.play().catch(cleanup);
        });
      }
    },
    [],
  );

  const speak = useCallback(
    async (rawText: string) => {
      if (!baseUrl || !rawText.trim()) return;

      // Cancel previous playback explicitly
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      abortRef.current = true; // cancel previous
      await new Promise((r) => setTimeout(r, 50)); // let previous audio clean up
      abortRef.current = false;

      const cleanText = sanitizeForTts(rawText);
      if (!cleanText) return;

      const chunks = segmentText(cleanText);
      if (chunks.length === 0) return;

      setSpeaking(true);

      try {
        // Synthesize ALL chunks in parallel for speed
        const blobUrls = await Promise.all(
          chunks.map((chunk) => synthesizeChunk(chunk)),
        );

        const validUrls = blobUrls.filter((u): u is string => u !== null);

        if (validUrls.length > 0 && !abortRef.current) {
          await playBlobUrls(validUrls);
        } else {
          // Cleanup unused URLs
          validUrls.forEach((u) => URL.revokeObjectURL(u));
        }
      } finally {
        setSpeaking(false);
      }
    },
    [baseUrl, synthesizeChunk, playBlobUrls],
  );

  const stop = useCallback(() => {
    abortRef.current = true;
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    setSpeaking(false);
  }, []);

  return {
    supported,
    speaking,
    speak,
    stop,
  };
}
