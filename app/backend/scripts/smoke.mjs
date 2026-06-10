#!/usr/bin/env node
// Smoke test del backend Niki: health, config, control de computadora y (opcional) chat.
// Uso: node scripts/smoke.mjs   (requiere el backend corriendo en BASE)
//      BASE=http://127.0.0.1:8000 SKIP_CHAT=1 node scripts/smoke.mjs

const BASE = process.env.BASE ?? "http://127.0.0.1:8000";
const API_KEY = process.env.NIKI_BACKEND_API_KEY ?? process.env.WRAPPER_API_KEY ?? "";
const SKIP_CHAT = process.env.SKIP_CHAT === "1";

let pass = 0;
let fail = 0;

function headers(extra = {}) {
  const h = { "content-type": "application/json", ...extra };
  if (API_KEY) h["x-niki-api-key"] = API_KEY;
  return h;
}

function ok(name, cond, detail = "") {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, { headers: headers() });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function action(name, params = {}) {
  const res = await fetch(`${BASE}/computer/action`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ action: name, params }),
  });
  return res.json().catch(() => ({ ok: false, error: "bad json" }));
}

async function actionFromOrigin(origin, name, params = {}) {
  const res = await fetch(`${BASE}/computer/action`, {
    method: "POST",
    headers: headers({ Origin: origin }),
    body: JSON.stringify({ action: name, params }),
  });
  return res.status;
}

async function chat(input) {
  const res = await fetch(`${BASE}/chat/stream`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ input, sessionId: "smoke", channel: "niki-agent" }),
  });
  if (!res.ok || !res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") continue;
      try {
        text += JSON.parse(payload).choices?.[0]?.delta?.content ?? "";
      } catch {
        /* ignore */
      }
    }
  }
  return text;
}

async function main() {
  console.log(`Niki backend smoke @ ${BASE}\n`);

  console.log("Health & config:");
  const health = await getJson("/healthz");
  ok("GET /healthz", health.status === 200 && health.body.ok === true);
  const cfg = await getJson("/runtime/config");
  ok("GET /runtime/config", cfg.status === 200 && cfg.body.ok === true, `provider=${cfg.body.provider}`);
  const caps = await getJson("/computer/capabilities");
  ok(
    "GET /computer/capabilities",
    caps.status === 200 && Array.isArray(caps.body.capabilities) && caps.body.capabilities.length > 0,
    `${caps.body.capabilities?.length ?? 0} tools, helper=${caps.body.config?.inputHelper?.available}`,
  );

  console.log("\nComputer control (safe actions):");
  const info = await action("system_info");
  ok("system_info", info.ok === true, info.platform);

  const clipText = `niki-smoke-${Date.now()}`;
  const w = await action("clipboard_write", { text: clipText });
  const r = await action("clipboard_read");
  ok("clipboard roundtrip", w.ok === true && r.ok === true && r.text === clipText);

  const screen = await action("screen_info");
  ok("screen_info", screen.ok === true && Array.isArray(screen.screens));

  const blocked = await action("shell_exec", { command: "echo hi" });
  ok("guarded blocks high-risk w/o confirm", blocked.ok === false && blocked.requiresConfirmation === true);

  const allowed = await action("shell_exec", { command: "echo niki-ok", confirm: true });
  ok("shell_exec w/ confirm", allowed.ok === true && String(allowed.stdout).includes("niki-ok"));

  const deny = await action("shell_exec", { command: "rm -rf /", confirm: true });
  ok("denylist blocks destructive", deny.ok === false && /denylist/.test(String(deny.error)));

  const apps = await action("app_list");
  ok("app_list", apps.ok === true && Array.isArray(apps.apps));

  console.log("\nSecurity hardening:");
  const evasions = ['"shut"down -h now', "rm -rf $HOME", "rm --recursive --force /"];
  for (const cmd of evasions) {
    const r = await action("shell_exec", { command: cmd, confirm: true });
    ok(`denylist blocks evasion: ${cmd}`, r.ok === false && /denylist/.test(String(r.error)));
  }
  const admin = await action("applescript_run", {
    script: 'do shell script "id" with administrator privileges',
    confirm: true,
  });
  ok("applescript admin escalation blocked", admin.ok === false);

  const evilStatus = await actionFromOrigin("https://evil.example.com", "system_info");
  ok("origin guard blocks external web origin", evilStatus === 403, `status=${evilStatus}`);
  const localStatus = await actionFromOrigin("http://localhost:3000", "system_info");
  ok("origin guard allows localhost origin", localStatus === 200, `status=${localStatus}`);

  if (!SKIP_CHAT) {
    console.log("\nLocal agent (chat + tool calling — needs network):");
    try {
      const out = await chat("¿Qué aplicaciones tengo abiertas? lista corta");
      ok("chat/stream agent reply", out.trim().length > 0, `${out.trim().slice(0, 60)}…`);
    } catch (err) {
      ok("chat/stream agent reply", false, String(err));
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke crashed:", err);
  process.exit(1);
});
