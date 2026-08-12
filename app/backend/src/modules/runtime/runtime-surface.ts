import type { RuntimeSurfacePayload } from "./runtime-events";

type SurfaceTrigger = {
  kind: RuntimeSurfacePayload["kind"];
  patterns: RegExp[];
};

const TRIGGERS: SurfaceTrigger[] = [
  {
    kind: "map",
    patterns: [
      // Español
      /d[oó]nde queda\s+(.+)/i,
      /d[oó]nde est[aá]\s+(.+)/i,
      /c[oó]mo llego a\s+(.+)/i,
      /(?:mu[eé]strame|ens[eé][ñn]ame)\s+(?:el mapa|d[oó]nde queda)\s*(.*)/i,
      /(?:mu[eé]strame|ens[eé][ñn]ame)\s+en el mapa\s+(.+)/i,
      /(?:mu[eé]strame|ens[eé][ñn]ame)\s+c[oó]mo (?:llego|llegar|se llega)\s+a\s+(.+)/i,
      // English
      /where\s+is\s+(?:the\s+)?(.+)/i,
      /where\s+are\s+(.+)/i,
      /how\s+do\s+i\s+get\s+to\s+(.+)/i,
      /show\s+me\s+(?:the\s+map\s+(?:of|to)|where)\s+(.+)/i,
    ],
  },
  {
    kind: "search",
    patterns: [
      // Español — cubre busco/busca/buscas/buscamos/buscar/búscame y el subjuntivo
      // busque/busques (irregular: c→qu antes de e), como en "quiero que me busques X".
      /b[uú]s(?:c|qu)\w*\s+(?:me\s+)?(?:el\s+|la\s+|los\s+|las\s+)?(.+)/i,
      /mu[eé]strame\s+el\s+men[uú]\s*(.*)/i,
      // English
      /search\s+for\s+(.+)/i,
      /look\s+up\s+(.+)/i,
      /find\s+me\s+(.+)/i,
    ],
  },
  {
    kind: "model3d",
    patterns: [
      // Español
      /render\S*\s+(?:me\s+)?(?:un\s+)?modelo\s*3d\s*(?:de)?\s*(.*)/i,
      /mu[eé]strame\s+(?:un\s+)?modelo\s*3d\s*(?:de)?\s*(.*)/i,
      /render\s*3d\s+(?:de)?\s*(.*)/i,
      // English
      /(?:show|render)\s+me\s+a\s+3d\s+model\s+(?:of\s+)?(.*)/i,
      /3d\s+model\s+of\s+(.+)/i,
    ],
  },
];

const CLEAR_PATTERNS: RegExp[] = [
  // Español
  /^ci[eé]rra(?:lo|la)\b/i,
  /^quita\s+(?:eso|el mapa|la b[uú]squeda|el modelo)/i,
  /^esconde\s+(?:eso|el mapa)/i,
  /ya no (?:lo |la )?necesito ver/i,
  // English
  /^close\s+(?:it|that|this)\b/i,
  /^hide\s+(?:it|that|this)\b/i,
  /^dismiss\s+(?:it|that|this)\b/i,
];

export function detectClearIntent(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  return CLEAR_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function toTitle(kind: RuntimeSurfacePayload["kind"], subject: string) {
  const clean = subject.trim();
  if (kind === "map") return clean ? `Ubicación: ${clean}` : "Ubicación";
  if (kind === "model3d") return clean ? `Modelo 3D: ${clean}` : "Modelo 3D";
  return clean ? `Búsqueda: ${clean}` : "Búsqueda";
}

export function detectSurfaceIntent(input: string): RuntimeSurfacePayload | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  for (const trigger of TRIGGERS) {
    for (const pattern of trigger.patterns) {
      const match = trimmed.match(pattern);
      if (!match) continue;
      const subject = (match[1] ?? "").replace(/[.?!]+$/, "").trim();

      const payload: RuntimeSurfacePayload = {
        id: `surface:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        kind: trigger.kind,
        title: toTitle(trigger.kind, subject),
        subtitle: subject || undefined,
        createdAt: new Date().toISOString(),
      };

      if (trigger.kind === "map") {
        payload.location = { label: subject || trimmed, address: subject || undefined };
      } else if (trigger.kind === "search") {
        payload.query = subject || trimmed;
        payload.url = `https://www.google.com/search?q=${encodeURIComponent(subject || trimmed)}`;
      } else if (trigger.kind === "model3d") {
        payload.query = subject || undefined;
      }

      return payload;
    }
  }

  return null;
}
