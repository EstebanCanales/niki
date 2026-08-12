"use client";

import { FormEvent, useId, useState } from "react";

import { CloudRequestError, joinWaitlist } from "@/lib/cloud-client";

type SubmissionState = "idle" | "loading" | "success" | "invalid" | "network";

interface WaitlistFormProps {
  compact?: boolean;
}

export function WaitlistForm({ compact = false }: WaitlistFormProps) {
  const inputId = useId();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<SubmissionState>("idle");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setState("invalid");
      return;
    }

    setState("loading");
    try {
      await joinWaitlist(email);
      setState("success");
    } catch (error) {
      setState(error instanceof CloudRequestError && error.status === 400 ? "invalid" : "network");
    }
  }

  if (state === "success") {
    return (
      <div className="waitlist-flow">
        <div className="waitlist-confirmation" role="status">
          <span className="confirmation-mark" aria-hidden="true">
            ✓
          </span>
          <span>
            <strong>Estás en la lista privada.</strong>
            <small>Te escribiremos cuando tu acceso esté listo.</small>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="waitlist-flow">
      <form
        className={compact ? "waitlist-form waitlist-form--compact" : "waitlist-form"}
        noValidate
        onSubmit={handleSubmit}
      >
        <label className="sr-only" htmlFor={inputId}>
          Correo
        </label>
        <input
          aria-describedby={state === "invalid" || state === "network" ? `${inputId}-error` : undefined}
          aria-invalid={state === "invalid"}
          autoComplete="email"
          id={inputId}
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="tu@correo.com"
          required
          type="email"
          value={email}
        />
        <button disabled={state === "loading"} type="submit">
          {state === "loading"
            ? "Solicitando…"
            : state === "network"
              ? "Intentar de nuevo"
              : "Solicitar acceso"}
        </button>
        {state === "invalid" ? (
          <p className="waitlist-error" id={`${inputId}-error`} role="alert">
            Escribe un correo válido.
          </p>
        ) : null}
        {state === "network" ? (
          <p className="waitlist-error" id={`${inputId}-error`} role="alert">
            No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.
          </p>
        ) : null}
      </form>
    </div>
  );
}
