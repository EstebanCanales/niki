"use client";

import { isTauri, invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import {
  LoaderCircle,
  CheckCircle2,
  XCircle,
  Wifi,
  WifiOff,
  Volume2,
} from "lucide-react";

import { useWorkspaceStore } from "@/stores/use-workspace-store";
import { wrapperHeaders, wrapperUrl } from "@/core/runtime/wrapper";
import { useRuntime } from "@/hooks/use-runtime";
import { useMemory } from "@/hooks/use-memory";
import type {
  NikiBrevityPreference,
  NikiPersonaProfile,
  NikiResponseStylePreference,
  NikiTonePreference,
} from "@/types/niki";

type HealthStatus = "idle" | "checking" | "ready" | "down";

const GRID_COLOR_PRESETS = [
  { label: "Blue", value: "#5ea2ff" },
  { label: "Ice", value: "#91c4ff" },
  { label: "Cyan", value: "#63d7ff" },
  { label: "Mint", value: "#67e0be" },
  { label: "Rose", value: "#f08aa8" },
  { label: "Gold", value: "#f2c56f" },
] as const;

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-white/40 uppercase tracking-widest">
        {label}
      </p>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl px-3 py-2 text-sm text-white/80 placeholder-white/20 outline-none transition"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      />
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="space-y-4 rounded-2xl p-4"
      style={{
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-white/50">
        {title}
      </p>
      {children}
    </div>
  );
}

function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange(v: T): void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-white/40 uppercase tracking-widest">
        {label}
      </p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full rounded-xl px-3 py-2 text-sm text-white/80 outline-none transition"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            className="bg-zinc-950 text-white"
          >
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
  note,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
  note?: React.ReactNode;
}) {
  return (
    <label
      className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/72"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-white"
      />
      <span className="flex items-center gap-2">
        <span>{label}</span>
        {note}
      </span>
    </label>
  );
}

const DEFAULT_PERSONA_PROFILE: NikiPersonaProfile = {
  assistantName: "Niki",
  tone: "grounded",
  brevity: "concise",
  operationalRules:
    "Be concise, practical, and action-oriented. Confirm only what actually changed.",
  forbiddenBehaviors:
    "Do not pretend completed work if it was only planned. Do not present yourself as Hermes.",
  responseStyle: "operational",
  updatedAt: "",
};

function ActionBtn({
  onClick,
  disabled,
  children,
  variant = "primary",
}: {
  onClick(): void;
  disabled?: boolean;
  children: React.ReactNode;
  variant?: "primary" | "ghost";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-full px-4 py-1.5 text-xs font-semibold transition disabled:opacity-40"
      style={
        variant === "primary"
          ? {
              background: "rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.85)",
              border: "1px solid rgba(255,255,255,0.12)",
            }
          : {
              background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.55)",
              border: "1px solid rgba(255,255,255,0.08)",
            }
      }
    >
      {children}
    </button>
  );
}

export function SettingsView() {
  const runtime = useRuntime();
  const [restartingNotch, setRestartingNotch] = useState(false);
  const displayName = useWorkspaceStore((s) => s.displayName);
  const setDisplayName = useWorkspaceStore((s) => s.setDisplayName);
  const backendBaseUrl = useWorkspaceStore((s) => s.backendBaseUrl);
  const backendApiKey = useWorkspaceStore((s) => s.backendApiKey);
  const runtimeConnected = useWorkspaceStore((s) => s.runtimeConnected);
  const runtimeAutoConnect = useWorkspaceStore((s) => s.runtimeAutoConnect);
  const setBackendBaseUrl = useWorkspaceStore((s) => s.setBackendBaseUrl);
  const setBackendApiKey = useWorkspaceStore((s) => s.setBackendApiKey);
  const setRuntimeConnected = useWorkspaceStore((s) => s.setRuntimeConnected);
  const setRuntimeAutoConnect = useWorkspaceStore(
    (s) => s.setRuntimeAutoConnect,
  );
  const memory = useMemory();

  const [healthStatus, setHealthStatus] = useState<HealthStatus>("idle");
  const [healthMsg, setHealthMsg] = useState("");
  const [modelInfo, setModelInfo] = useState("");
  const [runtimeApiServerUrl, setRuntimeApiServerUrl] = useState("");
  const [runtimeApiKey, setRuntimeApiKey] = useState("");
  const [runtimeModel, setRuntimeModel] = useState("");
  const [runtimeContextLengthOverride, setRuntimeContextLengthOverride] =
    useState("");
  const [runtimeCompatibilityMode, setRuntimeCompatibilityMode] = useState<
    "standard" | "hermes_agent"
  >("standard");
  const [runtimeDiagnosticsEnabled, setRuntimeDiagnosticsEnabled] =
    useState(false);
  const [runtimeCompatibilityMessage, setRuntimeCompatibilityMessage] =
    useState("");
  const [runtimeConfigError, setRuntimeConfigError] = useState("");
  const [saved, setSaved] = useState(false);
  const [personaProfile, setPersonaProfile] = useState<NikiPersonaProfile>(
    DEFAULT_PERSONA_PROFILE,
  );
  const [personaSaved, setPersonaSaved] = useState(false);

  const agentGridCellColor = useWorkspaceStore((s) => s.agentGridCellColor);
  const setAgentGridCellColor = useWorkspaceStore(
    (s) => s.setAgentGridCellColor,
  );
  const notchSettings = useWorkspaceStore((s) => s.notchSettings);
  const setNotchSettings = useWorkspaceStore((s) => s.setNotchSettings);
  const notchStatus = useWorkspaceStore((s) => s.notchStatus);
  const setNotchStatus = useWorkspaceStore((s) => s.setNotchStatus);
  const autoVoice = useWorkspaceStore((s) => s.autoVoice);
  const setAutoVoice = useWorkspaceStore((s) => s.setAutoVoice);
  const autoVoiceConversation = useWorkspaceStore(
    (s) => s.autoVoiceConversation,
  );
  const setAutoVoiceConversation = useWorkspaceStore(
    (s) => s.setAutoVoiceConversation,
  );
  const ttsVoice = useWorkspaceStore((s) => s.ttsVoice);
  const setTtsVoice = useWorkspaceStore((s) => s.setTtsVoice);

  const restartNotch = async () => {
    if (!isTauri() || restartingNotch) return;
    setRestartingNotch(true);
    try {
      await invoke("close_boring_notch").catch(() => undefined);
      await invoke("launch_boring_notch");
      setNotchStatus({
        visible: true,
        effectiveWidth: notchSettings.expandedWidth,
        effectiveHeight: notchSettings.expandedHeight,
        lastError: "",
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : JSON.stringify(error);
      setNotchStatus({ lastError: message });
    } finally {
      setRestartingNotch(false);
    }
  };

  const runtimeLabel = useMemo(() => {
    const s = runtime.connection.state;
    if (s === "ready") return "ready";
    if (s === "connecting") return "connecting";
    if (s === "degraded") return "degraded";
    return "offline";
  }, [runtime.connection.state]);

  useEffect(() => {
    const base = backendBaseUrl.trim();
    if (!base) return;

    let cancelled = false;

    const loadRuntimeConfig = async () => {
      try {
        const res = await fetch(wrapperUrl(base, "/runtime/config"), {
          method: "GET",
          headers: wrapperHeaders(backendApiKey),
          cache: "no-store",
        });
        const payload = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (!res.ok) {
          throw new Error(String(payload.error ?? `HTTP ${res.status}`));
        }
        if (cancelled) return;
        setRuntimeApiServerUrl(String(payload.apiServerUrl ?? ""));
        setRuntimeApiKey(String(payload.apiKey ?? ""));
        setRuntimeModel(String(payload.model ?? ""));
        setRuntimeContextLengthOverride(
          payload.contextLengthOverride == null
            ? ""
            : String(payload.contextLengthOverride),
        );
        setRuntimeCompatibilityMode(
          payload.compatibilityMode === "hermes_agent"
            ? "hermes_agent"
            : "standard",
        );
        setRuntimeDiagnosticsEnabled(Boolean(payload.diagnosticsEnabled));
        setRuntimeCompatibilityMessage(
          String(
            (payload.compatibility as Record<string, unknown> | undefined)
              ?.message ?? "",
          ),
        );
        setRuntimeConfigError("");
      } catch (error) {
        if (cancelled) return;
        setRuntimeConfigError(
          error instanceof Error
            ? error.message
            : "Could not load Hermes config.",
        );
      }
    };

    void loadRuntimeConfig();
    return () => {
      cancelled = true;
    };
  }, [backendApiKey, backendBaseUrl]);

  useEffect(() => {
    const raw = memory.entries.find(
      (entry) => entry.key === "preferences.persona_profile",
    )?.value;
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<NikiPersonaProfile>;
      setPersonaProfile({
        assistantName:
          typeof parsed.assistantName === "string" &&
          parsed.assistantName.trim()
            ? parsed.assistantName.trim()
            : "Niki",
        tone:
          parsed.tone === "warm" || parsed.tone === "direct"
            ? parsed.tone
            : "grounded",
        brevity:
          parsed.brevity === "balanced" || parsed.brevity === "detailed"
            ? parsed.brevity
            : "concise",
        operationalRules:
          typeof parsed.operationalRules === "string" &&
          parsed.operationalRules.trim()
            ? parsed.operationalRules.trim()
            : DEFAULT_PERSONA_PROFILE.operationalRules,
        forbiddenBehaviors:
          typeof parsed.forbiddenBehaviors === "string" &&
          parsed.forbiddenBehaviors.trim()
            ? parsed.forbiddenBehaviors.trim()
            : DEFAULT_PERSONA_PROFILE.forbiddenBehaviors,
        responseStyle:
          parsed.responseStyle === "friendly" ||
          parsed.responseStyle === "brief_status"
            ? parsed.responseStyle
            : "operational",
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      });
    } catch {
      setPersonaProfile(DEFAULT_PERSONA_PROFILE);
    }
  }, [memory.entries]);

  const onCheck = async () => {
    setHealthStatus("checking");
    setHealthMsg("");
    setModelInfo("");
    try {
      const base = backendBaseUrl.trim() || "http://127.0.0.1:8000";
      const headers = wrapperHeaders(backendApiKey);
      const [healthRes, runtimeRes] = await Promise.all([
        fetch(wrapperUrl(base, "/healthz"), {
          method: "GET",
          headers,
          cache: "no-store",
        }),
        fetch(wrapperUrl(base, "/runtime/status"), {
          method: "GET",
          headers,
          cache: "no-store",
        }),
      ]);

      const healthPayload = (await healthRes
        .json()
        .catch(() => ({}))) as Record<string, unknown>;
      const runtimePayload = (await runtimeRes
        .json()
        .catch(() => ({}))) as Record<string, unknown>;

      if (!healthRes.ok || !runtimeRes.ok) {
        const detail = String(
          runtimePayload.detail ??
            healthPayload.error ??
            `HTTP ${Math.max(healthRes.status, runtimeRes.status)}`,
        );
        setHealthStatus("down");
        setHealthMsg(detail);
        return;
      }

      setHealthStatus("ready");
      setHealthMsg(
        `chat: ${healthPayload.chat ? "on" : "off"} · runtime: ${runtimePayload.state ?? "unknown"}`,
      );
      setModelInfo(
        `model: ${runtimePayload.resolvedModel ?? runtimePayload.defaultModel ?? "n/a"} · provider: Hermes`,
      );
      setRuntimeCompatibilityMessage(
        String(
          (runtimePayload.compatibility as Record<string, unknown> | undefined)
            ?.message ?? "",
        ),
      );
    } catch (e) {
      setHealthStatus("down");
      setHealthMsg(e instanceof Error ? e.message : "connection failed");
    }
  };

  const onSave = async () => {
    try {
      const base = backendBaseUrl.trim() || "http://127.0.0.1:8000";
      const res = await fetch(wrapperUrl(base, "/runtime/config"), {
        method: "POST",
        headers: wrapperHeaders(backendApiKey, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          apiServerUrl: runtimeApiServerUrl,
          apiKey: runtimeApiKey,
          model: runtimeModel,
          contextLengthOverride: runtimeContextLengthOverride.trim()
            ? Number(runtimeContextLengthOverride)
            : null,
          compatibilityMode: runtimeCompatibilityMode,
          diagnosticsEnabled: runtimeDiagnosticsEnabled,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!res.ok) {
        throw new Error(String(payload.error ?? `HTTP ${res.status}`));
      }

      setRuntimeApiServerUrl(
        String(payload.apiServerUrl ?? runtimeApiServerUrl),
      );
      setRuntimeApiKey(String(payload.apiKey ?? runtimeApiKey));
      setRuntimeModel(String(payload.model ?? runtimeModel));
      setRuntimeContextLengthOverride(
        payload.contextLengthOverride == null
          ? ""
          : String(payload.contextLengthOverride),
      );
      setRuntimeCompatibilityMode(
        payload.compatibilityMode === "hermes_agent"
          ? "hermes_agent"
          : "standard",
      );
      setRuntimeDiagnosticsEnabled(Boolean(payload.diagnosticsEnabled));
      setRuntimeCompatibilityMessage(
        String(
          (payload.compatibility as Record<string, unknown> | undefined)
            ?.message ?? "",
        ),
      );
      setRuntimeConfigError("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    } catch (error) {
      setRuntimeConfigError(
        error instanceof Error
          ? error.message
          : "Could not save Hermes config.",
      );
    }
  };

  const onSavePersona = async () => {
    const nextProfile: NikiPersonaProfile = {
      ...personaProfile,
      updatedAt: new Date().toISOString(),
    };
    setPersonaProfile(nextProfile);
    await memory.set(
      "preferences.persona_profile",
      JSON.stringify(nextProfile),
    );
    setPersonaSaved(true);
    setTimeout(() => setPersonaSaved(false), 1200);
  };

  return (
    <div className="flex flex-col gap-4 px-3 py-4">
      <Section title="Profile">
        <Field
          label="Display name"
          value={displayName}
          onChange={setDisplayName}
          placeholder="Your name"
        />
      </Section>

      <Section title="Niki persona">
        <div className="grid gap-3 md:grid-cols-2">
          <Field
            label="Assistant name"
            value={personaProfile.assistantName}
            onChange={(assistantName) =>
              setPersonaProfile((current) => ({ ...current, assistantName }))
            }
            placeholder="Niki"
          />
          <SelectField<NikiTonePreference>
            label="Tone"
            value={personaProfile.tone}
            onChange={(tone) =>
              setPersonaProfile((current) => ({ ...current, tone }))
            }
            options={[
              { value: "grounded", label: "Grounded" },
              { value: "warm", label: "Warm" },
              { value: "direct", label: "Direct" },
            ]}
          />
          <SelectField<NikiBrevityPreference>
            label="Brevity"
            value={personaProfile.brevity}
            onChange={(brevity) =>
              setPersonaProfile((current) => ({ ...current, brevity }))
            }
            options={[
              { value: "concise", label: "Concise" },
              { value: "balanced", label: "Balanced" },
              { value: "detailed", label: "Detailed" },
            ]}
          />
          <SelectField<NikiResponseStylePreference>
            label="Response style"
            value={personaProfile.responseStyle}
            onChange={(responseStyle) =>
              setPersonaProfile((current) => ({ ...current, responseStyle }))
            }
            options={[
              { value: "operational", label: "Operational" },
              { value: "friendly", label: "Friendly" },
              { value: "brief_status", label: "Brief status" },
            ]}
          />
        </div>
        <Field
          label="Operational rules"
          value={personaProfile.operationalRules}
          onChange={(operationalRules) =>
            setPersonaProfile((current) => ({ ...current, operationalRules }))
          }
          placeholder="Be concise, practical, and action-oriented."
        />
        <Field
          label="Forbidden behaviors"
          value={personaProfile.forbiddenBehaviors}
          onChange={(forbiddenBehaviors) =>
            setPersonaProfile((current) => ({ ...current, forbiddenBehaviors }))
          }
          placeholder="Do not pretend work was done if it was only planned."
        />
        <p className="text-xs leading-5 text-white/35">
          This persists the structured operator profile used by Hermes across
          sessions.
        </p>
        <div className="flex items-center gap-2">
          <ActionBtn onClick={() => void onSavePersona()} variant="ghost">
            {personaSaved ? "Saved ✓" : "Save persona"}
          </ActionBtn>
          {memory.error ? (
            <span className="text-xs text-red-400">{memory.error}</span>
          ) : null}
        </div>
      </Section>

      <Section title="Backend · HTTP">
        <Field
          label="Base URL"
          value={backendBaseUrl}
          onChange={setBackendBaseUrl}
          placeholder="http://127.0.0.1:8000"
        />
        <Field
          label="API Key"
          value={backendApiKey}
          onChange={setBackendApiKey}
          placeholder="optional"
          type="password"
        />

        <div className="flex flex-wrap items-center gap-2">
          <ActionBtn onClick={onCheck} disabled={healthStatus === "checking"}>
            {healthStatus === "checking" ? (
              <LoaderCircle className="mr-1 inline h-3.5 w-3.5 animate-spin" />
            ) : null}
            Test connection
          </ActionBtn>
          <ActionBtn onClick={onSave} variant="ghost">
            {saved ? "Saved ✓" : "Save"}
          </ActionBtn>
        </div>

        {healthStatus !== "idle" && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              {healthStatus === "ready" && (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              )}
              {healthStatus === "down" && (
                <XCircle className="h-3.5 w-3.5 text-red-400" />
              )}
              {healthStatus === "checking" && (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin text-white/40" />
              )}
              <span
                className={`text-xs ${healthStatus === "ready" ? "text-emerald-400" : healthStatus === "down" ? "text-red-400" : "text-white/40"}`}
              >
                {healthStatus === "ready"
                  ? "Connected"
                  : healthStatus === "down"
                    ? healthMsg
                    : "Checking…"}
              </span>
            </div>
            {healthStatus === "ready" && healthMsg && (
              <p className="pl-5 text-xs text-white/30">{healthMsg}</p>
            )}
            {modelInfo && (
              <p className="pl-5 text-xs text-white/30">{modelInfo}</p>
            )}
          </div>
        )}
      </Section>

      <Section title="Grid cells">
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-white/40 uppercase tracking-widest">
            Cell color
          </p>
          <div className="grid grid-cols-3 gap-2">
            {GRID_COLOR_PRESETS.map((preset) => {
              const active =
                agentGridCellColor.toLowerCase() === preset.value.toLowerCase();

              return (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setAgentGridCellColor(preset.value)}
                  className="flex items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-white/75 transition"
                  style={{
                    background: active
                      ? "rgba(255,255,255,0.08)"
                      : "rgba(255,255,255,0.04)",
                    border: active
                      ? "1px solid rgba(255,255,255,0.16)"
                      : "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/[0.08]"
                    style={{ background: preset.value }}
                  />
                  <span>{preset.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <p className="text-xs leading-5 text-white/35">
          This changes the color of the grid cells in the main agent canvas.
        </p>
      </Section>

      <Section title="Runtime · Hermes">
        <div className="grid gap-3">
          <Field
            label="API Server URL"
            value={runtimeApiServerUrl}
            onChange={setRuntimeApiServerUrl}
            placeholder="http://127.0.0.1:8642"
          />
          <Field
            label="Runtime API Key"
            value={runtimeApiKey}
            onChange={setRuntimeApiKey}
            placeholder="optional"
            type="password"
          />
          <Field
            label="Model"
            value={runtimeModel}
            onChange={setRuntimeModel}
            placeholder="Hermes-4-70B"
          />
          <Field
            label="Context override"
            value={runtimeContextLengthOverride}
            onChange={setRuntimeContextLengthOverride}
            placeholder="64000"
            type="number"
          />
          <SelectField<"standard" | "hermes_agent">
            label="Compatibility mode"
            value={runtimeCompatibilityMode}
            onChange={setRuntimeCompatibilityMode}
            options={[
              { value: "standard", label: "Standard" },
              { value: "hermes_agent", label: "Hermes Agent" },
            ]}
          />
          <ToggleField
            label="Diagnostics mode"
            checked={runtimeDiagnosticsEnabled}
            onChange={setRuntimeDiagnosticsEnabled}
          />
          <p className="text-xs leading-5 text-white/35">
            If you change local Hermes gateway settings, restart it with{" "}
            <span className="font-mono text-white/55">
              hermes gateway restart
            </span>
            .
          </p>
          {runtimeCompatibilityMessage ? (
            <p className="text-xs text-white/45">
              {runtimeCompatibilityMessage}
            </p>
          ) : null}
          {runtimeConfigError ? (
            <p className="text-xs text-red-400">{runtimeConfigError}</p>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-widest text-white/40">
              Runtime source
            </p>
            <div
              className="rounded-xl px-3 py-2 text-sm text-white/72"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              Hermes via backend
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-widest text-white/40">
              Live runtime
            </p>
            <div className="flex gap-2">
              <ActionBtn onClick={() => setRuntimeConnected(true)}>
                Connect
              </ActionBtn>
              <ActionBtn
                onClick={() => setRuntimeConnected(false)}
                variant="ghost"
              >
                Disconnect
              </ActionBtn>
            </div>
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-white/40">
          <input
            type="checkbox"
            checked={runtimeAutoConnect}
            onChange={(e) => setRuntimeAutoConnect(e.target.checked)}
            className="h-3.5 w-3.5 accent-white"
          />
          Auto-connect Hermes when Niki launches
        </label>

        <div className="flex items-center gap-1.5">
          {runtimeConnected ? (
            <Wifi className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-white/25" />
          )}
          <span
            className={`text-xs ${runtimeConnected ? "text-emerald-400" : "text-white/30"}`}
          >
            {runtimeLabel} · {runtime.connection.runtimeVersion || "—"} ·{" "}
            {runtime.connection.latencyMs ?? 0}ms
          </span>
        </div>
      </Section>

      <Section title="Voice">
        <SelectField<string>
          label="TTS Voice"
          value={ttsVoice}
          onChange={(voice) => setTtsVoice(voice)}
          options={[
            { value: "es_AR-daniela", label: "Daniela — Español (AR) · Femenina · High" },
            { value: "es_ES-davefx", label: "Dave — Español (ES) · Masculina · Medium" },
            { value: "es_ES-sharvard", label: "Sharvard — Español (ES) · Masculina · Medium" },
            { value: "es_ES-mls_10246", label: "MLS 10246 — Español (ES) · Femenina · Low" },
            { value: "es_ES-mls_9972", label: "MLS 9972 — Español (ES) · Femenina · Low" },
            { value: "en_US-amy", label: "Amy — English (US) · Femenina · Medium" },
            { value: "en_GB-aru", label: "Aru — English (GB) · Femenina · Medium" },
            { value: "en_GB-cori", label: "Cori — English (GB) · Femenina · Medium" },
            { value: "en_GB-semaine", label: "Semaine — English (GB) · Femenina · Medium" },
          ]}
        />
        <ToggleField
          label="Auto voice"
          checked={autoVoice}
          onChange={setAutoVoice}
        />
        <ToggleField
          label="Voice conversation"
          checked={autoVoiceConversation}
          onChange={(v) => {
            setAutoVoiceConversation(v);
            if (v) setAutoVoice(true);
          }}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const audio = new Audio();
              const text =
                ttsVoice.startsWith("es")
                  ? "Hola, soy Niki. ¿En qué puedo ayudarte?"
                  : "Hello, I'm Niki. How can I help you today?";
              fetch(wrapperUrl(backendBaseUrl, "/voice/synthesize"), {
                method: "POST",
                headers: wrapperHeaders(backendApiKey, {
                  "Content-Type": "application/json",
                }),
                body: JSON.stringify({ text, voice: ttsVoice }),
              })
                .then((res) => res.json())
                .then((data: { ok: boolean; audio?: string }) => {
                  if (data.ok && data.audio) {
                    const blob = new Blob(
                      [
                        Uint8Array.from(atob(data.audio), (c) =>
                          c.charCodeAt(0),
                        ),
                      ],
                      { type: "audio/wav" },
                    );
                    audio.src = URL.createObjectURL(blob);
                    void audio.play();
                  }
                })
                .catch(console.error);
            }}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs font-medium text-white/70 transition hover:bg-white/10"
          >
            <Volume2 className="h-3.5 w-3.5" />
            Test voice
          </button>
        </div>
        <p className="text-xs leading-5 text-white/35">
          Auto voice automatically speaks assistant replies. Test voice previews
          the selected voice model.
        </p>
      </Section>

      <Section title="Notch">
        <div className="grid gap-3 md:grid-cols-2">
          <ToggleField
            label="Enable notch"
            checked={notchSettings.enabled}
            onChange={(enabled) => setNotchSettings({ enabled })}
            note={
              <>
                <span className="rounded-full border border-amber-300/18 bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200/85">
                  Experimental
                </span>
                <span className="rounded-full border border-white/10 bg-white/6 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/55">
                  macOS only
                </span>
              </>
            }
          />
        </div>
        <p className="text-xs leading-5 text-white/35">
          Niki launches the local{" "}
          <span className="font-mono text-white/55">Niki Notch</span> app bundle
          on startup and closes it when the main app closes.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void restartNotch()}
            disabled={!notchSettings.enabled || restartingNotch}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs font-medium text-white/70 transition hover:bg-white/10 disabled:opacity-40"
          >
            {restartingNotch ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            Restart notch
          </button>
        </div>
        <p className="text-xs leading-5 text-white/35">
          Visible: {notchStatus.visible ? "yes" : "no"} · size:{" "}
          {notchStatus.effectiveWidth}×{notchStatus.effectiveHeight}
        </p>
        {notchStatus.lastError ? (
          <p className="text-xs text-red-400">{notchStatus.lastError}</p>
        ) : null}
      </Section>
    </div>
  );
}
