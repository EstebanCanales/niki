"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, "WAVE");

  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);

  writeString(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export function useVoiceRecorder({
  onBlob,
  maxDurationMs = 30_000,
}: {
  onBlob?(blob: Blob): void;
  maxDurationMs?: number;
}) {
  const [recording, setRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const timerRef = useRef<number>(0);
  const samplesRef = useRef<Float32Array[]>([]);
  const sampleRateRef = useRef(44100);
  const startTimeRef = useRef<number>(0);
  const recordingRef = useRef(false);

  recordingRef.current = recording;

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) window.clearInterval(timerRef.current);
    rafRef.current = 0;
    timerRef.current = 0;

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // ignore
      }
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }

    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      try {
        void audioCtxRef.current.close();
      } catch {
        // ignore
      }
    }

    processorRef.current = null;
    streamRef.current = null;
    analyserRef.current = null;
    audioCtxRef.current = null;
    samplesRef.current = [];
  }, []);

  const stop = useCallback(() => {
    const sampleArrays = samplesRef.current;
    const totalLength = sampleArrays.reduce((sum, arr) => sum + arr.length, 0);
    if (totalLength > 0) {
      const allSamples = new Float32Array(totalLength);
      let offset = 0;
      for (const arr of sampleArrays) {
        allSamples.set(arr, offset);
        offset += arr.length;
      }
      const blob = encodeWav(allSamples, sampleRateRef.current);
      if (blob.size > 44) onBlob?.(blob);
    }

    cleanup();
    setRecording(false);
  }, [cleanup, onBlob]);

  const start = useCallback(async () => {
    cleanup();
    setError(null);
    setAudioLevel(0);
    setDuration(0);
    setRecording(true);
    samplesRef.current = [];

    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      setError("Microphone not available");
      cleanup();
      setRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      sampleRateRef.current = audioCtx.sampleRate;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const channelData = e.inputBuffer.getChannelData(0);
        samplesRef.current.push(new Float32Array(channelData));
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      startTimeRef.current = performance.now();

      timerRef.current = window.setInterval(() => {
        const elapsed = Math.round(performance.now() - startTimeRef.current);
        setDuration(elapsed);
        if (elapsed >= maxDurationMs) {
          stop();
        }
      }, 250);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const checkLevel = () => {
        if (!recordingRef.current || !analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(Math.min(1, avg / 128));
        rafRef.current = requestAnimationFrame(checkLevel);
      };
      rafRef.current = requestAnimationFrame(checkLevel);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message.includes("Permission") ? "Microphone permission denied" : message);
      cleanup();
      setRecording(false);
    }
  }, [cleanup, onBlob, maxDurationMs, stop]);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return {
    recording,
    audioLevel,
    duration,
    error,
    start,
    stop,
    supported: true,
  };
}
