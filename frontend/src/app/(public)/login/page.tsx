"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { wrapperHeaders, wrapperUrl } from "@/core/runtime/wrapper";
import { useWorkspaceStore } from "@/stores/use-workspace-store";

type Step = "credentials" | "mfa";
const MFA_SLOTS = [0, 1, 2, 3, 4, 5] as const;

function setAuthFieldVisualState(input: HTMLInputElement, focused: boolean) {
  input.style.cssText = focused
    ? "border-color: rgba(0,200,255,0.28); background: rgba(0,200,255,0.04);"
    : "border-color: rgba(255,255,255,0.08); background: rgba(255,255,255,0.03);";
}

// ── MFA 6-box input ───────────────────────────────────────────────────────────
function MfaBoxes({
  value,
  onChange,
  onComplete,
}: {
  value: string;
  onChange(v: string): void;
  onComplete(): void;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  const handleKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !value[i] && i > 0) {
      refs.current[i - 1]?.focus();
      onChange(value.slice(0, i - 1));
    }
    if (e.key === "Enter" && value.length === 6) onComplete();
  };

  const handleChange = (i: number, v: string) => {
    const digit = v.replace(/\D/g, "").slice(-1);
    const next = (value.slice(0, i) + digit + value.slice(i + 1)).slice(0, 6);
    onChange(next);
    if (digit && i < 5) refs.current[i + 1]?.focus();
    if (next.length === 6) onComplete();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 6);
    if (pasted) {
      onChange(pasted);
      refs.current[Math.min(pasted.length, 5)]?.focus();
    }
    e.preventDefault();
  };

  return (
    <div className="flex gap-2.5" onPaste={handlePaste}>
      {MFA_SLOTS.map((i) => (
        <motion.input
          key={`mfa-slot-${i}`}
          ref={(node) => {
            refs.current[i] = node;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] ?? ""}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKey(i, e)}
          onClick={() => refs.current[i]?.select()}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04, duration: 0.2 }}
          className="h-14 w-full rounded-xl border text-center text-xl font-semibold outline-none transition-all duration-150"
          style={{
            background: value[i]
              ? "rgba(0,210,255,0.08)"
              : "rgba(255,255,255,0.03)",
            borderColor: value[i]
              ? "rgba(0,210,255,0.35)"
              : "rgba(255,255,255,0.09)",
            color: value[i]
              ? "rgba(160,240,255,0.95)"
              : "rgba(255,255,255,0.5)",
            fontFamily: "'DM Mono', monospace",
            caretColor: "transparent",
          }}
        />
      ))}
    </div>
  );
}

// ── Animated background mesh ──────────────────────────────────────────────────
function LeftPanel() {
  return (
    <div
      className="relative hidden h-full overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12"
      style={{
        background:
          "linear-gradient(135deg, #040608 0%, #060c14 50%, #040810 100%)",
      }}
    >
      {/* Dot grid */}
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(0,200,255,0.55) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* Radial glow center */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-[520px] w-[520px] rounded-full opacity-25"
        style={{
          background:
            "radial-gradient(circle, rgba(0,190,255,0.4) 0%, rgba(0,80,180,0.15) 45%, transparent 72%)",
          animation: "pulse-glow 6s ease-in-out infinite",
        }}
      />

      {/* Sphere */}
      <motion.div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-52 w-52 rounded-full"
        animate={{ scale: [1, 1.04, 1] }}
        transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
        style={{
          background:
            "radial-gradient(circle at 34% 30%, rgba(220,248,255,0.92), rgba(0,190,240,0.48) 50%, rgba(0,60,100,0.14) 76%)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.12)",
          clipPath: "inset(0 0 18% 0 round 50%)",
        }}
      >
        <motion.div
          className="absolute inset-0 m-auto h-24 w-24 rounded-full"
          style={{
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background:
              "radial-gradient(circle, rgba(230,248,255,0.94), rgba(0,200,255,0.42) 38%, rgba(0,80,120,0.06) 72%)",
          }}
          animate={{ scale: [1, 0.93, 1], opacity: [0.8, 1, 0.8] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.div>

      {/* Top wordmark */}
      <div className="relative z-10">
        <motion.p
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-[10px] uppercase tracking-[0.3em]"
          style={{
            color: "rgba(0,200,255,0.55)",
            fontFamily: "'DM Mono', monospace",
          }}
        >
          Niki — v0.1
        </motion.p>
      </div>

      {/* Bottom copy */}
      <div className="relative z-10 space-y-3">
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.5 }}
          className="text-4xl font-semibold leading-tight tracking-tight"
          style={{
            color: "rgba(255,255,255,0.88)",
            fontFamily: "'Syne', sans-serif",
          }}
        >
          Intelligence
          <br />
          <span style={{ color: "rgba(0,200,255,0.85)" }}>moves markets.</span>
        </motion.h2>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55 }}
          className="text-sm leading-relaxed"
          style={{
            color: "rgba(255,255,255,0.32)",
            fontFamily: "'DM Mono', monospace",
          }}
        >
          Autonomous workflows · Real-time decisions
          <br />
          x402 payments · Zero friction
        </motion.p>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700&family=DM+Mono:wght@300;400;500&display=swap');
        @keyframes pulse-glow {
          0%, 100% { opacity: 0.22; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 0.32; transform: translate(-50%, -50%) scale(1.08); }
        }
      `}</style>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const { replace } = useRouter();
  const hasHydrated = useWorkspaceStore((s) => s._hasHydrated);
  const accessToken = useWorkspaceStore((s) => s.accessToken);
  const setAccessToken = useWorkspaceStore((s) => s.setAccessToken);
  const setUserId = useWorkspaceStore((s) => s.setUserId);
  const setDisplayName = useWorkspaceStore((s) => s.setDisplayName);
  const baseUrl = useWorkspaceStore((s) => s.backendBaseUrl);

  const [step, setStep] = useState<Step>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!hasHydrated) return;
    if (accessToken) {
      replace("/");
      return;
    }

    const timeoutId = window.setTimeout(() => emailRef.current?.focus(), 100);
    return () => window.clearTimeout(timeoutId);
  }, [hasHydrated, accessToken, replace]);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError("Email and password required.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(wrapperUrl(baseUrl, "/v1/auth/login"), {
        method: "POST",
        headers: wrapperHeaders(undefined, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(d.message ?? `${res.status}`);
      }
      const d = (await res.json()) as {
        user: { id: string; displayName: string };
        mfa: { challengeId: string };
      };
      setUserId(d.user.id);
      setDisplayName(d.user.displayName);
      setChallengeId(d.mfa.challengeId);
      setStep("mfa");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleMfa = async () => {
    if (mfaCode.length < 6) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(wrapperUrl(baseUrl, "/v1/auth/mfa/verify"), {
        method: "POST",
        headers: wrapperHeaders(undefined, {
          "content-type": "application/json",
        }),
        body: JSON.stringify({ challengeId, code: mfaCode }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(d.message ?? "Invalid code.");
      }
      const d = (await res.json()) as { accessToken: string };
      setAccessToken(d.accessToken);
      replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "MFA failed.");
      setMfaCode("");
    } finally {
      setLoading(false);
    }
  };

  if (!hasHydrated)
    return (
      <div
        className="flex h-screen items-center justify-center"
        style={{ background: "#040608" }}
      >
        <motion.div
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 1.6, repeat: Infinity }}
          className="size-1.5 rounded-full bg-cyan-400"
        />
      </div>
    );

  return (
    <div
      className="grid h-screen"
      style={{ gridTemplateColumns: "1fr auto", background: "#040608" }}
    >
      <LeftPanel />

      {/* Right form panel */}
      <div
        className="flex h-full w-full flex-col items-center justify-center px-12 lg:w-[420px]"
        style={{ borderLeft: "1px solid rgba(255,255,255,0.05)" }}
      >
        <div className="w-full max-w-[340px]">
          <AnimatePresence mode="wait">
            {step === "credentials" ? (
              <motion.div
                key="credentials"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.22 }}
                className="space-y-7"
              >
                {/* Header */}
                <div className="space-y-1">
                  <p
                    className="text-[10px] uppercase tracking-[0.28em]"
                    style={{
                      color: "rgba(0,200,255,0.45)",
                      fontFamily: "'DM Mono', monospace",
                    }}
                  >
                    Secure access
                  </p>
                  <h1
                    className="text-3xl font-semibold tracking-tight"
                    style={{
                      color: "rgba(255,255,255,0.92)",
                      fontFamily: "'Syne', sans-serif",
                    }}
                  >
                    Sign in
                  </h1>
                </div>

                {/* Fields */}
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="login-email"
                      className="text-[11px] uppercase tracking-[0.18em]"
                      style={{
                        color: "rgba(255,255,255,0.3)",
                        fontFamily: "'DM Mono', monospace",
                      }}
                    >
                      Email
                    </label>
                    <input
                      id="login-email"
                      ref={emailRef}
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleLogin();
                      }}
                      placeholder="operator@niki.com"
                      autoComplete="email"
                      className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all duration-150"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        color: "rgba(255,255,255,0.82)",
                        fontFamily: "'DM Mono', monospace",
                      }}
                      onFocus={(e) =>
                        setAuthFieldVisualState(e.currentTarget, true)
                      }
                      onBlur={(e) =>
                        setAuthFieldVisualState(e.currentTarget, false)
                      }
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label
                      htmlFor="login-password"
                      className="text-[11px] uppercase tracking-[0.18em]"
                      style={{
                        color: "rgba(255,255,255,0.3)",
                        fontFamily: "'DM Mono', monospace",
                      }}
                    >
                      Password
                    </label>
                    <input
                      id="login-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleLogin();
                      }}
                      placeholder="••••••••••"
                      autoComplete="current-password"
                      className="w-full rounded-xl px-4 py-3 text-sm outline-none transition-all duration-150"
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        color: "rgba(255,255,255,0.82)",
                        fontFamily: "'DM Mono', monospace",
                      }}
                      onFocus={(e) =>
                        setAuthFieldVisualState(e.currentTarget, true)
                      }
                      onBlur={(e) =>
                        setAuthFieldVisualState(e.currentTarget, false)
                      }
                    />
                  </div>
                </div>

                {/* Error */}
                <AnimatePresence>
                  {error && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="rounded-xl px-4 py-2.5 text-xs"
                      style={{
                        background: "rgba(255,60,80,0.08)",
                        border: "1px solid rgba(255,60,80,0.18)",
                        color: "rgba(255,140,150,0.9)",
                        fontFamily: "'DM Mono', monospace",
                      }}
                    >
                      {error}
                    </motion.p>
                  )}
                </AnimatePresence>

                {/* Button */}
                <motion.button
                  onClick={() => void handleLogin()}
                  disabled={loading}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  className="relative w-full overflow-hidden rounded-xl py-3.5 text-sm font-medium transition-all disabled:opacity-40"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(0,190,255,0.18) 0%, rgba(0,120,200,0.12) 100%)",
                    border: "1px solid rgba(0,200,255,0.22)",
                    color: "rgba(200,242,255,0.92)",
                    fontFamily: "'Syne', sans-serif",
                    letterSpacing: "0.04em",
                  }}
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    {loading && (
                      <motion.span
                        animate={{ rotate: 360 }}
                        transition={{
                          duration: 0.8,
                          repeat: Infinity,
                          ease: "linear",
                        }}
                        className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent"
                      />
                    )}
                    {loading ? "Signing in…" : "Continue"}
                  </span>
                </motion.button>
              </motion.div>
            ) : (
              <motion.div
                key="mfa"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.22 }}
                className="space-y-7"
              >
                {/* Header */}
                <div className="space-y-1">
                  <p
                    className="text-[10px] uppercase tracking-[0.28em]"
                    style={{
                      color: "rgba(0,200,255,0.45)",
                      fontFamily: "'DM Mono', monospace",
                    }}
                  >
                    Two-factor
                  </p>
                  <h1
                    className="text-3xl font-semibold tracking-tight"
                    style={{
                      color: "rgba(255,255,255,0.92)",
                      fontFamily: "'Syne', sans-serif",
                    }}
                  >
                    Verify
                  </h1>
                  <p
                    className="text-sm"
                    style={{
                      color: "rgba(255,255,255,0.32)",
                      fontFamily: "'DM Mono', monospace",
                    }}
                  >
                    Code sent to {email}
                  </p>
                </div>

                {/* 6-box MFA */}
                <MfaBoxes
                  value={mfaCode}
                  onChange={setMfaCode}
                  onComplete={handleMfa}
                />

                {/* Error */}
                <AnimatePresence>
                  {error && (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="rounded-xl px-4 py-2.5 text-xs"
                      style={{
                        background: "rgba(255,60,80,0.08)",
                        border: "1px solid rgba(255,60,80,0.18)",
                        color: "rgba(255,140,150,0.9)",
                        fontFamily: "'DM Mono', monospace",
                      }}
                    >
                      {error}
                    </motion.p>
                  )}
                </AnimatePresence>

                {/* Verify button */}
                <motion.button
                  onClick={handleMfa}
                  disabled={loading || mfaCode.length < 6}
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full rounded-xl py-3.5 text-sm font-medium transition-all disabled:opacity-35"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(0,190,255,0.18) 0%, rgba(0,120,200,0.12) 100%)",
                    border: "1px solid rgba(0,200,255,0.22)",
                    color: "rgba(200,242,255,0.92)",
                    fontFamily: "'Syne', sans-serif",
                    letterSpacing: "0.04em",
                  }}
                >
                  <span className="flex items-center justify-center gap-2">
                    {loading && (
                      <motion.span
                        animate={{ rotate: 360 }}
                        transition={{
                          duration: 0.8,
                          repeat: Infinity,
                          ease: "linear",
                        }}
                        className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent"
                      />
                    )}
                    {loading ? "Verifying…" : "Verify code"}
                  </span>
                </motion.button>

                <button
                  onClick={() => {
                    setStep("credentials");
                    setError("");
                    setMfaCode("");
                  }}
                  className="w-full text-center text-xs transition-opacity hover:opacity-60"
                  style={{
                    color: "rgba(255,255,255,0.22)",
                    fontFamily: "'DM Mono', monospace",
                  }}
                >
                  ← back to sign in
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom status */}
        <div className="absolute bottom-6 right-6">
          <p
            className="text-[9px] uppercase tracking-[0.2em]"
            style={{
              color: "rgba(0,200,255,0.22)",
              fontFamily: "'DM Mono', monospace",
            }}
          >
            Backend · {baseUrl.replace("http://", "")}
          </p>
        </div>
      </div>
    </div>
  );
}
