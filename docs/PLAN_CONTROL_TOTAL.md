# Plan: Niki con Control Total de la Computadora

> Objetivo: que la app sea **totalmente funcional**, tenga **control completo de la
> computadora** y sea **totalmente estable**.

## Diagnóstico inicial

- Backend NestJS hace solo *proxy* de chat hacia Hermes (runtime externo). Sin Hermes
  corriendo, el chat no responde → la app no es funcional por sí sola.
- `groq-sdk` ya es dependencia (backend y frontend) pero **no se usa**. `GROQ_API_KEY`
  está presente en `.env`.
- Herramientas de automatización macOS disponibles: `swiftc`/`xcrun`, `osascript`,
  `screencapture`, `pbcopy`/`pbpaste`. (`cliclick` y `pyautogui` ausentes.)
- Frontend consume `/chat/stream` con SSE estilo OpenAI (`choices[0].delta.content`).

## Decisión de arquitectura

Construir un **agente local basado en Groq** con *function-calling*, donde las
herramientas son **primitivas de control de la computadora** ejecutadas en la Mac local
(el backend corre en la máquina del usuario).

Beneficios:
1. La app funciona sin depender del runtime externo Hermes.
2. El agente obtiene control completo de la computadora.
3. Verificable end-to-end con `curl` (no requiere UI ni Xcode).
4. El contrato SSE no cambia → el frontend sigue funcionando igual.

Hermes permanece como proveedor alterno seleccionable.

## Fases

### Fase 1 — Helper nativo de entrada (Swift CGEvent)
`backend/native/niki-input/main.swift`: CLI que ejecuta mouse (move/click/drag/scroll),
teclado (type/key/hotkey), posición del cursor y geometría de pantallas vía CGEvent.
Compilado on-demand a `backend/native/bin/niki-input` con `swiftc`.

### Fase 2 — ComputerControlService
`backend/src/modules/computer/`: ejecutor de capacidades con capa de seguridad.
- Capacidades: `shell.exec`, `applescript.run`, `jxa.run`, `screen.capture`,
  `screen.info`, `mouse.*`, `keyboard.*`, `clipboard.*`, `app.*`, `fs.*`, `system.*`,
  `notify`.
- Seguridad: niveles de riesgo, modos (`open`/`guarded`/`locked`), denylist de shell,
  límites de path, timeouts, truncado de salida, auditoría completa.
- `getToolSchemas()` (para Groq), `executeTool()`, `capabilities()`.

### Fase 3 — GroqAgentService (agente local)
`backend/src/modules/runtime/groq-agent.service.ts`: loop de tool-calling con `groq-sdk`.
Stream de texto + eventos de herramienta por callbacks. Integrado en
`RuntimeService.proxyChatStream` con selección de proveedor.

### Fase 4 — Endpoints directos + wiring
`GET /computer/capabilities`, `POST /computer/action`, `GET/POST /computer/config`.
Importar `ComputerModule` en `RuntimeModule` y `WrapperModule`.

### Fase 5 — Frontend
Panel `features/computer/` + hook `use-computer.ts` + entrada de navegación. Ajustes de
proveedor y modo de control. El chat ya funciona vía `/chat/stream`.

### Fase 6 — Estabilidad, pruebas y docs
- Validación de entrada, gating de permisos, manejo de errores sin crashear el proceso.
- Script de humo (`backend/scripts/smoke.mjs`) que arranca el server y ejercita endpoints
  y acciones seguras (echo, clipboard roundtrip, screen.info).
- Builds verdes (typecheck/lint/build front y back).
- Actualizar `README`, `ARQUITECTURA`, `API_SERVICIOS`, `.env.example`.

## Permisos de macOS requeridos (runtime)

- **Accesibilidad**: para mouse/teclado vía CGEvent y AppleScript de UI.
- **Grabación de pantalla**: para `screen.capture`.

El servicio detecta y reporta el estado de permisos; no puede otorgarlos automáticamente.

## Resultados de la revisión adversarial

Un workflow multi-agente revisó la superficie nueva (seguridad, correctitud, wiring) y
verificó cada hallazgo. Resumen de lo aplicado:

- **Drive-by RCE (crítico):** CORS abierto + sin auth permitía que cualquier web
  ejecutara acciones. → **Guard de Origin** en `/chat/stream`, `/computer/action`,
  `/computer/config`.
- **Denylist evadible (crítico):** regex evadible por comillas/variables. → Normalización
  + patrones ampliados (speed-bump honesto, documentado como no-sandbox).
- **AppleScript con privilegios admin (crítico):** → bloqueado `with administrator
  privileges`.
- **Correctitud del loop del agente:** `JSON.parse("null")` y mismatch de
  `tool_call_id` con ids aleatorios → corregidos.
- **Estabilidad SSE:** `broadcast()` con guard + poda de listeners; path Hermes con
  AbortController (cancela upstream al desconectar) y escrituras seguras.
- **Provider:** `resolveAgentProvider` clampa a `hermes` si Groq no está disponible.
- **Decisiones de diseño (no bugs):** shell/AppleScript arbitrarios y lectura/escritura
  amplia de archivos son la *feature* de control completo; el vector remoto queda cerrado
  por el guard de Origin y el bind a localhost. El gate `confirm` es cooperativo; el
  límite duro es el modo `locked`.

Verificación: backend `typecheck`/`build` ✓, frontend `typecheck`/`lint`/`build` ✓,
`npm run smoke` 11/11 (incluye evasiones de denylist bloqueadas, escalación admin
bloqueada y guard de Origin probado).
