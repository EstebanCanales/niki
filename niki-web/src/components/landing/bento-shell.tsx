import { ProductDemo } from "./product-demo";
import { WaitlistForm } from "./waitlist-form";

export function BentoShell() {
  return (
    <main className="bento-page">
      <article className="bento-shell" aria-labelledby="niki-title">
        <header className="landing-masthead">
          <img alt="Niki" height="32" src="/logo-niki.svg" width="76" />
          <a href="/login">Ya tengo acceso</a>
        </header>

        <div className="landing-lead">
          <div className="landing-intro">
            <p className="landing-kicker">Niki para macOS</p>
            <h1 id="niki-title">
              <span>Tu Mac,</span>
              ahora te entiende.
            </h1>
            <p className="landing-intro__body">
              Dile qué necesitas. Niki conserva únicamente el contexto que eliges y te pide
              permiso antes de actuar.
            </p>

            <div className="landing-access" aria-label="Acceso privado">
              <WaitlistForm compact />
              <p>Acceso personal por invitación.</p>
            </div>
          </div>

          <ProductDemo />
        </div>

        <div className="editorial-band">
          <section className="conversation-plane" aria-label="Una conversación continua">
            <p className="editorial-index">Una conversación continua</p>
            <blockquote>
              “Organiza lo que me queda hoy y deja un rato para caminar.”
            </blockquote>
            <div className="conversation-reply">
              <span aria-hidden="true" />
              <p>
                Tienes tres pendientes. Puedo mover lo flexible y dejar media hora libre antes de
                que oscurezca. Te enseño el cambio antes de hacerlo.
              </p>
            </div>
          </section>

          <section className="principles-plane" aria-label="Contexto y privacidad">
            <p className="principles-statement">Niki trabaja contigo, no por encima de ti.</p>
            <dl>
              <div>
                <dt>Recuerda contigo</dt>
                <dd>La memoria que guardas permanece visible, editable y tuya.</dd>
              </div>
              <div>
                <dt>Actúa con permiso</dt>
                <dd>La sincronización es opcional y cada decisión sensible espera tu confirmación.</dd>
              </div>
            </dl>
          </section>
        </div>
      </article>
    </main>
  );
}
