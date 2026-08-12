"use client";

import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";

import { useCurrentUser } from "@/hooks/use-current-user";
import { logout } from "@/lib/cloud-client";

import { PortalNav } from "./portal-nav";

export function PortalShell({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const { user, isLoading, error, reload } = useCurrentUser();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string>();

  useEffect(() => {
    if (!isLoading && !error && !user) {
      router.replace("/login");
    }
  }, [error, isLoading, router, user]);

  async function handleLogout() {
    setIsLoggingOut(true);
    setLogoutError(undefined);
    try {
      await logout();
      router.replace("/login");
      router.refresh();
    } catch {
      setLogoutError("No pudimos cerrar la sesión. Inténtalo de nuevo.");
      setIsLoggingOut(false);
    }
  }

  if (isLoading || (!error && !user)) {
    return (
      <main className="portal-gate" aria-live="polite">
        <span className="portal-gate__signal" aria-hidden="true" />
        <p className="utility-label">NIKI / SESIÓN</p>
        <h1>Verificando tu espacio privado…</h1>
      </main>
    );
  }

  if (error || !user) {
    return (
      <main className="portal-gate" aria-live="polite">
        <p className="utility-label">CONEXIÓN INTERRUMPIDA</p>
        <h1>No pudimos verificar tu sesión.</h1>
        <p>Tu información privada sigue oculta. Comprueba que Niki Cloud esté disponible.</p>
        <button className="auth-primary" type="button" onClick={reload}>
          Intentar de nuevo
        </button>
      </main>
    );
  }

  return (
    <div className="portal-shell">
      <aside className="portal-sidebar">
        <a className="wordmark portal-wordmark" href="/" aria-label="Niki, inicio">
          niki<span>•</span>
        </a>
        <div className="portal-presence" aria-hidden="true">
          <span />
        </div>
        <PortalNav />
        <div className="portal-account">
          <p>{user.displayName || "Espacio personal"}</p>
          <span>{user.email}</span>
          <button type="button" onClick={() => void handleLogout()} disabled={isLoggingOut}>
            {isLoggingOut ? "Cerrando…" : "Cerrar sesión"}
          </button>
          {logoutError ? <p role="alert">{logoutError}</p> : null}
        </div>
      </aside>
      <div className="portal-frame">
        <header className="portal-topbar">
          <span className="portal-status"><i /> Niki conectada</span>
          <span className="utility-label">ACCESO PERSONAL</span>
        </header>
        <main className="portal-content">{children}</main>
      </div>
    </div>
  );
}
