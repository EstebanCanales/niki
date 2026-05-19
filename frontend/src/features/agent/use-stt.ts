"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { wrapperHeaders, wrapperUrl } from "@/core/runtime/wrapper";
import { useWorkspaceStore } from "@/stores/use-workspace-store";
import { useVoiceRecorder } from "./use-voice-recorder";

export function useStt({
  lang = "es-ES",
  onTranscript,
}: {
  lang?: string;
  onTranscript?(text: string): void;
}) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const backendBaseUrl = useWorkspaceStore((s) => s.backendBaseUrl);
  const backendApiKey = useWorkspaceStore((s) => s.backendApiKey);

  const sendAudio = useCallback(
    async (blob: Blob) => {
      setProcessing(true);
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        const headers = wrapperHeaders(backendApiKey);
        headers.set("Content-Type", "application/json");

        const res = await fetch(wrapperUrl(backendBaseUrl, "/voice/transcribe"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            audio: base64,
            language: lang.slice(0, 2),
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }

        const data = (await res.json()) as {
          ok: boolean;
          text?: string;
          error?: string;
        };
        if (!data.ok) {
          throw new Error(data.error || "Transcription failed");
        }

        onTranscript?.(data.text?.trim() ?? "");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        setProcessing(false);
      }
    },
    [backendBaseUrl, backendApiKey, lang, onTranscript],
  );

  const voiceRecorder = useVoiceRecorder({
    onBlob: sendAudio,
    maxDurationMs: 30_000,
  });

  const startRef = useRef(voiceRecorder.start);
  const stopRef = useRef(voiceRecorder.stop);
  startRef.current = voiceRecorder.start;
  stopRef.current = voiceRecorder.stop;

  const start = useCallback(() => {
    setError(null);
    void startRef.current();
  }, []);

  const stop = useCallback(() => {
    stopRef.current();
  }, []);

  const toggle = useCallback(() => {
    if (voiceRecorder.recording || processing) {
      stop();
    } else {
      start();
    }
  }, [voiceRecorder.recording, processing, start, stop]);

  useEffect(() => {
    return () => stopRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    supported: true,
    recording: voiceRecorder.recording,
    processing,
    audioLevel: voiceRecorder.audioLevel,
    duration: voiceRecorder.duration,
    error: error ?? voiceRecorder.error,
    start,
    stop,
    toggle,
  };
}
