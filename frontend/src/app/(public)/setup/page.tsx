"use client";

import { CheckCircle, LoaderCircle, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { wrapperHeaders, wrapperUrl } from "@/core/runtime/wrapper";
import { useWorkspaceStore } from "@/stores/use-workspace-store";

export default function SetupPage() {
  const { push, replace } = useRouter();
  const hasHydrated = useWorkspaceStore((s) => s._hasHydrated);
  const storedBaseUrl = useWorkspaceStore((s) => s.backendBaseUrl);
  const storedApiKey = useWorkspaceStore((s) => s.backendApiKey);
  const setBackendBaseUrl = useWorkspaceStore((s) => s.setBackendBaseUrl);
  const setBackendApiKey = useWorkspaceStore((s) => s.setBackendApiKey);

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<"idle" | "testing" | "ok" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!hasHydrated) return;
    setBaseUrl(storedBaseUrl);
    setApiKey(storedApiKey);
  }, [hasHydrated, storedBaseUrl, storedApiKey]);

  const handleSubmit = async () => {
    if (!baseUrl.trim()) {
      setErrorMsg("Base URL is required.");
      setStatus("error");
      return;
    }
    setStatus("testing");
    setErrorMsg("");
    try {
      const res = await fetch(wrapperUrl(baseUrl, "/healthz"), {
        headers: wrapperHeaders(apiKey),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setBackendBaseUrl(baseUrl.trim());
      setBackendApiKey(apiKey.trim());
      setStatus("ok");
      setTimeout(() => push("/login"), 600);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Connection failed.");
      setStatus("error");
    }
  };

  if (!hasHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoaderCircle className="size-6 animate-spin text-white/30" />
      </div>
    );
  }

  if (storedBaseUrl.trim() && status === "idle") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div
          className="w-full max-w-sm rounded-3xl border border-white/[0.08] p-8"
          style={{
            background: "rgba(22,22,28,0.7)",
            backdropFilter: "blur(40px)",
          }}
        >
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-widest text-white/30">
              Hermes Runtime
            </p>
            <h1 className="text-xl font-semibold text-white/90">
              Backend already configured
            </h1>
            <p className="text-sm text-white/40">
              Niki already has a backend URL saved. Continue to login or update
              the connection details.
            </p>
          </div>

          <div className="mt-6 space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 text-sm text-white/72">
            <p>
              <span className="text-white/40">Base URL:</span> {storedBaseUrl}
            </p>
            <p>
              <span className="text-white/40">API key:</span>{" "}
              {storedApiKey.trim() ? "Configured" : "Not set"}
            </p>
          </div>

          <div className="mt-6 flex gap-2">
            <button
              onClick={() => replace("/login")}
              className="flex-1 rounded-xl bg-white/10 py-3 text-sm font-medium text-white/80 transition hover:bg-white/[0.14]"
            >
              Continue to login
            </button>
            <button
              onClick={() => {
                setBaseUrl(storedBaseUrl);
                setApiKey(storedApiKey);
                setStatus("testing");
                setTimeout(() => setStatus("idle"), 0);
              }}
              className="rounded-xl border border-white/[0.08] px-4 py-3 text-sm text-white/60 transition hover:bg-white/[0.06]"
            >
              Edit
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div
        className="w-full max-w-sm rounded-3xl border border-white/[0.08] p-8"
        style={{
          background: "rgba(22,22,28,0.7)",
          backdropFilter: "blur(40px)",
        }}
      >
        <div className="mb-8">
          <p className="text-xs uppercase tracking-widest text-white/30">
            Hermes Runtime
          </p>
          <h1 className="mt-1 text-xl font-semibold text-white/90">
            Connect backend
          </h1>
          <p className="mt-1 text-sm text-white/40">
            Enter your Niki backend URL. Hermes runs behind that wrapper. API
            key is optional.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="setup-base-url"
              className="mb-1.5 block text-xs text-white/40"
            >
              Base URL
            </label>
            <input
              id="setup-base-url"
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSubmit();
              }}
              placeholder="http://127.0.0.1:8000"
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 placeholder:text-white/20 outline-none transition focus:border-white/20 focus:bg-white/[0.06]"
            />
          </div>

          <div>
            <label
              htmlFor="setup-api-key"
              className="mb-1.5 block text-xs text-white/40"
            >
              API Key <span className="text-white/20">(optional)</span>
            </label>
            <input
              id="setup-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSubmit();
              }}
              placeholder="sk-•••••••• (leave empty if not required)"
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm text-white/80 placeholder:text-white/20 outline-none transition focus:border-white/20 focus:bg-white/[0.06]"
            />
          </div>
        </div>

        {status === "error" && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs text-red-400">
            <XCircle className="size-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {status === "ok" && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-green-500/20 bg-green-500/10 px-3 py-2.5 text-xs text-green-400">
            <CheckCircle className="size-4 shrink-0" />
            <span>Connected. Redirecting…</span>
          </div>
        )}

        <button
          onClick={() => void handleSubmit()}
          disabled={status === "testing" || status === "ok"}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 py-3 text-sm font-medium text-white/80 transition hover:bg-white/[0.14] disabled:opacity-40"
        >
          {status === "testing" && (
            <LoaderCircle className="size-4 animate-spin" />
          )}
          {status === "testing" ? "Testing…" : "Connect"}
        </button>
      </div>
    </div>
  );
}
