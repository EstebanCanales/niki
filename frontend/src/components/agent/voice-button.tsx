"use client";

import { Mic, MicOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export function VoiceButton({
  listening,
  processing,
  supported,
  audioLevel,
  onClick,
  disabled,
}: {
  listening: boolean;
  processing?: boolean;
  supported: boolean;
  audioLevel?: number;
  onClick(): void;
  disabled?: boolean;
}) {
  const isActive = listening || processing;

  return (
    <div className="relative">
      <Button
        type="button"
        variant={isActive ? "default" : "secondary"}
        size="icon"
        disabled={!supported || disabled}
        onClick={onClick}
        title={
          !supported
            ? "Speech recognition not supported"
            : processing
              ? "Transcribing..."
              : listening
                ? "Stop listening"
                : "Start voice input"
        }
        className={
          isActive
            ? "relative overflow-hidden bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 border-rose-500/30"
            : ""
        }
      >
        {processing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : listening ? (
          <Mic className="h-4 w-4" />
        ) : (
          <MicOff className="h-4 w-4" />
        )}

        {/* Audio level bar inside button when recording */}
        {listening && audioLevel !== undefined && (
          <span
            className="absolute bottom-0 left-0 h-0.5 bg-rose-400/70 transition-all duration-75"
            style={{ width: `${Math.min(100, audioLevel * 100)}%` }}
          />
        )}
      </Button>

      {/* Outer ring pulse when recording */}
      {listening && (
        <span className="absolute inset-0 rounded-md animate-ping bg-rose-500/20" />
      )}
    </div>
  );
}
