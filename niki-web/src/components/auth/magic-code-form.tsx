"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

import {
  CloudRequestError,
  normalizeEmail,
  requestMagicCode,
  verifyMagicCode,
} from "@/lib/cloud-client";

const RESEND_COOLDOWN_SECONDS = 10 * 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Step = "email" | "code";

function formatCooldown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function MagicCodeForm() {
  const router = useRouter();
  const codeInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [code, setCode] = useState("");
  const [debugCode, setDebugCode] = useState<string>();
  const [cooldown, setCooldown] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }

    const timer = window.setInterval(
      () => setCooldown((seconds) => Math.max(0, seconds - 1)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") {
      codeInputRef.current?.focus();
    }
  }, [step]);

  async function sendCode(address: string) {
    const normalizedEmail = normalizeEmail(address);
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError("Escribe un correo válido.");
      return;
    }

    setError(undefined);
    setIsSubmitting(true);
    try {
      const response = await requestMagicCode(normalizedEmail);
      setSubmittedEmail(normalizedEmail);
      setDebugCode(response.debugCode);
      setCode("");
      setStep("code");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (requestError) {
      setError(
        requestError instanceof CloudRequestError && requestError.status === 429
          ? "Ya hay un código activo. Espera unos minutos o usa el último que recibiste."
          : "No pudimos enviar el código. Revisa tu conexión e inténtalo de nuevo.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendCode(email);
  }

  async function handleCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Escribe los seis dígitos del código.");
      return;
    }

    setError(undefined);
    setIsSubmitting(true);
    try {
      await verifyMagicCode(submittedEmail, code);
      router.push("/dashboard");
      router.refresh();
    } catch (verificationError) {
      if (verificationError instanceof CloudRequestError && verificationError.status === 401) {
        setCode("");
        setError("El código no es válido o ya venció.");
        requestAnimationFrame(() => codeInputRef.current?.focus());
      } else {
        setError("No pudimos verificar el código. Revisa tu conexión e inténtalo de nuevo.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  if (step === "email") {
    return (
      <form className="magic-code-form" onSubmit={handleEmailSubmit} noValidate>
        <div className="auth-field">
          <label htmlFor="login-email">Correo</label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="tu@correo.com"
            aria-describedby="login-email-note auth-error"
            disabled={isSubmitting}
          />
          <p id="login-email-note">Te enviaremos un código privado de un solo uso.</p>
        </div>
        {error ? <p className="auth-error" id="auth-error" role="alert">{error}</p> : null}
        <button className="auth-primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Enviando…" : "Enviar código"}
        </button>
      </form>
    );
  }

  return (
    <form className="magic-code-form" onSubmit={handleCodeSubmit} noValidate>
      <div className="auth-step-heading">
        <p role="status">Enviamos un código a {submittedEmail}.</p>
        <button
          type="button"
          onClick={() => {
            setStep("email");
            setError(undefined);
            setDebugCode(undefined);
          }}
        >
          Cambiar correo
        </button>
      </div>
      {debugCode ? <p className="auth-debug-code">Código local: {debugCode}</p> : null}
      <div className="auth-field">
        <label htmlFor="login-code">Código de seis dígitos</label>
        <input
          ref={codeInputRef}
          id="login-code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          aria-describedby="auth-error"
          disabled={isSubmitting}
        />
      </div>
      {error ? <p className="auth-error" id="auth-error" role="alert">{error}</p> : null}
      <button className="auth-primary" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Verificando…" : "Entrar"}
      </button>
      <button
        className="auth-resend"
        type="button"
        disabled={isSubmitting || cooldown > 0}
        onClick={() => void sendCode(submittedEmail)}
      >
        {cooldown > 0 ? `Reenviar en ${formatCooldown(cooldown)}` : "Reenviar código"}
      </button>
    </form>
  );
}
