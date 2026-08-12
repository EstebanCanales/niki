import Link from "next/link";

import { MagicCodeForm } from "@/components/auth/magic-code-form";

export default function LoginPage() {
  return (
    <main className="auth-page">
      <header className="auth-header">
        <Link className="wordmark" href="/" aria-label="Niki, inicio">
          niki<span>•</span>
        </Link>
        <Link href="/">Volver al inicio</Link>
      </header>
      <section className="auth-stage" aria-labelledby="login-title">
        <div className="auth-presence" aria-hidden="true">
          <span />
        </div>
        <div className="auth-copy">
          <p className="utility-label">ACCESO PERSONAL / PRIVADO</p>
          <h1 id="login-title">Vuelve a tu espacio.</h1>
          <p>
            Sin contraseñas que recordar. Niki te reconoce con un código temporal enviado a tu
            correo.
          </p>
        </div>
        <div className="auth-panel">
          <p className="auth-panel__index">01 — IDENTIDAD</p>
          <MagicCodeForm />
          <p className="auth-privacy-note">La sesión vive en una cookie segura. Nunca exponemos su contenido al navegador.</p>
        </div>
      </section>
    </main>
  );
}
