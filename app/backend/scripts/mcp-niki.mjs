#!/usr/bin/env node
/**
 * Servidor MCP que le da al agente el control de la máquina que ya tiene Niki.
 *
 * El runtime trae terminal y archivos, pero no puede mover el mouse, tipear ni sacar una
 * captura: eso necesita el helper de entrada que vive en el backend de Niki. En vez de
 * duplicar esas 24 capacidades dentro del fork —que sería código nuestro dentro de algo
 * que queremos poder rebasar contra upstream— se exponen por MCP, que es el mecanismo
 * que el runtime ya sabe consumir.
 *
 * Habla JSON-RPC 2.0 por stdin/stdout (transporte stdio de MCP) y reenvía cada llamada a
 * `POST /computer/action` del backend. Stdio y no HTTP porque no hay que abrir otro
 * puerto ni manejar autenticación: el proceso lo lanza el propio runtime.
 *
 * Se registra con:
 *   hermes mcp add niki --command node --args <ruta a este archivo>
 */

const BACKEND = process.env.NIKI_BACKEND_URL || "http://127.0.0.1:8000";

/** Las que de verdad aportan algo que el terminal no puede hacer. */
const PERMITIDAS = new Set([
  "screen_capture", "screen_info",
  "mouse_click", "mouse_move", "mouse_drag", "mouse_scroll",
  "keyboard_type", "keyboard_key",
  "app_launch", "app_activate", "app_list", "app_quit",
  "clipboard_read", "clipboard_write",
  "open_url", "notify", "system_info", "system_volume",
]);

function enviar(mensaje) {
  process.stdout.write(JSON.stringify(mensaje) + "\n");
}

function responder(id, result) {
  enviar({ jsonrpc: "2.0", id, result });
}

function fallar(id, mensaje) {
  enviar({ jsonrpc: "2.0", id, error: { code: -32000, message: mensaje } });
}

async function capacidades() {
  const res = await fetch(`${BACKEND}/computer/capabilities`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`capabilities ${res.status}`);
  const data = await res.json();
  const lista = Array.isArray(data) ? data : data.capabilities || data.tools || [];
  return lista.filter((c) => PERMITIDAS.has(c.name));
}

/** Traduce una capacidad de Niki al formato de herramienta que espera MCP. */
function comoHerramientaMcp(cap) {
  return {
    name: `niki_${cap.name}`,
    description: cap.description || `Control de la máquina: ${cap.name}`,
    inputSchema: cap.parameters ||
      cap.inputSchema || { type: "object", properties: {}, additionalProperties: true },
  };
}

async function ejecutar(nombre, args) {
  const accion = nombre.replace(/^niki_/, "");
  if (!PERMITIDAS.has(accion)) throw new Error(`acción no permitida: ${accion}`);
  const res = await fetch(`${BACKEND}/computer/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BACKEND },
    body: JSON.stringify({ action: accion, params: args || {} }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

async function manejar(msg) {
  const { id, method, params } = msg;

  if (method === "initialize") {
    return responder(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "niki-computer", version: "1.0.0" },
    });
  }

  if (method === "tools/list") {
    try {
      const caps = await capacidades();
      return responder(id, { tools: caps.map(comoHerramientaMcp) });
    } catch (error) {
      // Sin backend no hay herramientas, pero el servidor no se cae: devolver la lista
      // vacía deja al agente trabajar con lo que ya tiene en vez de romper el turno.
      return responder(id, { tools: [] });
    }
  }

  if (method === "tools/call") {
    try {
      const salida = await ejecutar(params?.name, params?.arguments);
      return responder(id, {
        content: [{ type: "text", text: JSON.stringify(salida) }],
      });
    } catch (error) {
      return responder(id, {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true,
      });
    }
  }

  // Las notificaciones (sin id) no llevan respuesta.
  if (id !== undefined) fallar(id, `método no soportado: ${method}`);
}

let buffer = "";
process.stdin.on("data", async (chunk) => {
  buffer += chunk.toString();
  const lineas = buffer.split("\n");
  buffer = lineas.pop() ?? "";
  for (const linea of lineas) {
    if (!linea.trim()) continue;
    try {
      await manejar(JSON.parse(linea));
    } catch {
      /* línea inválida: se ignora en vez de tirar el servidor */
    }
  }
});
