import { NikiOrb } from "@/components/landing/niki-orb";
import { ProductDemo } from "@/components/landing/product-demo";
import { WaitlistForm } from "@/components/landing/waitlist-form";

const moments = [
  {
    marker: "01 / VOZ",
    title: "Dilo como lo dirías.",
    copy: "Habla en español o en inglés, cambia de idea a mitad de frase y sigue. Niki entiende intención, no comandos memorizados.",
    echo: "“Recuérdame llamar a mamá cuando termine esta reunión.”",
  },
  {
    marker: "02 / CONTEXTO",
    title: "No empiezas de cero.",
    copy: "Niki mantiene el hilo entre sesiones con la memoria que tú decides conservar. Puedes verla, corregirla o borrarla.",
    echo: "Contexto elegido · 3 recuerdos disponibles",
  },
  {
    marker: "03 / ACCIÓN",
    title: "Pasa de decir a hacer.",
    copy: "Busca, organiza y prepara acciones con tus herramientas. Cuando algo importa, Niki muestra el cambio y pide tu permiso.",
    echo: "Acción preparada · Esperando confirmación",
  },
];

export default function LandingPage() {
  return (
    <main>
      <header className="site-header">
        <a className="wordmark" href="#inicio" aria-label="Niki, inicio">
          niki<span aria-hidden="true">°</span>
        </a>
        <nav aria-label="Navegación principal">
          <a href="#como-funciona">Cómo funciona</a>
          <a href="#privacidad">Privacidad</a>
          <a className="private-link" href="/login">
            Acceso privado <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>

      <section className="hero" id="inicio" aria-labelledby="hero-title">
        <div className="hero-notch" aria-hidden="true">
          <span className="hero-notch__sensor" />
        </div>
        <div className="hero-copy">
          <p className="utility-label hero-kicker">AGENTE PERSONAL / MACOS</p>
          <h1 id="hero-title">
            Tu Mac,
            <span>ahora más cerca de ti.</span>
          </h1>
          <p className="hero-intro">
            Niki conversa contigo, mantiene el contexto que eliges y trabaja con tus herramientas.
            Siempre cerca. Nunca por encima de ti.
          </p>
          <WaitlistForm />
          <p className="form-note">Acceso personal por invitación. Sin ruido, sin spam.</p>
        </div>
        <div className="hero-presence">
          <div className="hero-presence__axis" aria-hidden="true" />
          <NikiOrb className="hero-orb" state="resting" />
          <p className="presence-status">
            <span aria-hidden="true" />
            DISPONIBLE EN TU MAC
          </p>
        </div>
        <a className="scroll-cue" href="#como-funciona">
          <span aria-hidden="true">↓</span> CONOCER A NIKI
        </a>
      </section>

      <section className="moments section-shell" id="como-funciona" aria-labelledby="moments-title">
        <div className="section-heading">
          <p className="utility-label">UNA CONVERSACIÓN CONTINUA</p>
          <h2 id="moments-title">De una frase a algo hecho.</h2>
          <p>Niki aparece cuando la necesitas y se aparta cuando ya está resuelto.</p>
        </div>
        <ol className="moment-sequence">
          {moments.map((moment) => (
            <li key={moment.marker}>
              <div className="moment-index">
                <span>{moment.marker}</span>
              </div>
              <div className="moment-copy">
                <h3>{moment.title}</h3>
                <p>{moment.copy}</p>
              </div>
              <p className="moment-echo">{moment.echo}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="privacy section-shell" id="privacidad" aria-labelledby="privacy-title">
        <div className="privacy-signal" aria-hidden="true">
          <span className="privacy-signal__ring" />
          <span className="privacy-signal__core" />
          <span className="privacy-signal__line" />
        </div>
        <div className="privacy-copy">
          <p className="utility-label">PRIVADO POR DECISIÓN</p>
          <h2 id="privacy-title">
            Tu contexto no es
            <span>nuestro producto.</span>
          </h2>
          <p className="privacy-lead">
            Niki parte de una regla simple: tú decides qué sale de tu Mac, qué se recuerda y cuándo
            puede actuar.
          </p>
          <dl className="privacy-facts">
            <div>
              <dt>Conversaciones</dt>
              <dd>La sincronización está apagada hasta que tú la activas.</dd>
            </div>
            <div>
              <dt>Memoria</dt>
              <dd>Visible y editable. Un recuerdo se puede borrar sin borrar tu cuenta.</dd>
            </div>
            <div>
              <dt>Acciones</dt>
              <dd>Las decisiones sensibles esperan una confirmación clara.</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="demo-section section-shell" aria-labelledby="demo-title">
        <div className="demo-heading">
          <p className="utility-label">PRESENCIA, NO INTERRUPCIÓN</p>
          <h2 id="demo-title">Un control center que sabe hacerse pequeño.</h2>
          <p>
            El notch te deja ver si Niki escucha, piensa o actúa. Abre el centro de control cuando
            quieres revisar el detalle.
          </p>
        </div>
        <ProductDemo />
      </section>

      <section className="final-cta" aria-labelledby="final-title">
        <div className="final-cta__notch" aria-hidden="true">
          <span />
        </div>
        <p className="utility-label">ACCESO PERSONAL / LISTA PRIVADA</p>
        <h2 id="final-title">Tu Mac ya hace mucho.<br />Ahora puede entenderte.</h2>
        <p>Estamos abriendo Niki con cuidado, una persona a la vez.</p>
        <WaitlistForm compact />
      </section>

      <footer>
        <a className="wordmark" href="#inicio" aria-label="Niki, volver al inicio">
          niki<span aria-hidden="true">°</span>
        </a>
        <p>Agente personal para macOS · Hecho con cuidado en Costa Rica.</p>
        <div>
          <a href="mailto:hola@niki.ai">Contacto</a>
          <a href="#privacidad">Privacidad</a>
          <span>© 2026</span>
        </div>
      </footer>
    </main>
  );
}
