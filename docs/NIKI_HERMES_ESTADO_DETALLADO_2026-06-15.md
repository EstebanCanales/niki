# Estado Detallado: Niki Hermes-First Operator Console

Fecha: 2026-06-15

## Resumen Ejecutivo

Este documento resume:

1. Lo que ya quedó implementado en la migración Hermes-first de Niki.
2. Lo nuevo agregado en las últimas pasadas de trabajo.
3. Lo que todavía falta para considerar el objetivo "completo" a nivel de producto, runtime y shell.
4. El estado real de validación.

La situación actual es:

- El runtime principal ya es Hermes-first.
- El backend ya proyecta capacidades, sesiones, approvals, perfiles, MCP y eventos SSE adaptados para el app.
- El shell Swift ya consume módulos capability-driven y no depende de varios hardcodes anteriores.
- Ya existe una base operativa real para `computer_use`, approvals, sesiones remotas, `MCP admin`, diagnostics y discover.
- Lo que falta ya no es "la infraestructura base", sino profundidad operativa, cierre de integración y validación final del shell.

---

## Meta Original

La meta era llevar toda la infraestructura `app/backend` y `app/Niki` a un estado 1:1 con Hermes Agent, con estas líneas principales:

- runtime Hermes-only
- config Hermes-only
- approvals reales
- `computer_use`
- sesiones remotas
- `/undo`
- multi-profile
- `MCP catalog/admin`
- `LSP diagnostics`
- `x_search`
- `video_generate`
- operator console adaptable por capabilities y feature flags

---

## Qué Ya Quedó Hecho

## 1. Runtime Hermes-Only

Ya no se mantiene el flujo principal como runtime híbrido local + Hermes.

Quedó encaminado así:

- `chat/stream` va por Hermes.
- el backend usa `~/.hermes/config.yaml` como fuente fuerte para runtime config relevante.
- se removieron o debilitaron rutas/local branches que sostenían comportamiento legacy local.
- la compatibilidad Hermes se proyecta hacia el app desde backend.

Archivos clave:

- [runtime.service.ts](/Users/estebancanales/Work/agente/app/backend/src/modules/runtime/runtime.service.ts)
- [wrapper.controller.ts](/Users/estebancanales/Work/agente/app/backend/src/wrapper/wrapper.controller.ts)
- [wrapper.service.ts](/Users/estebancanales/Work/agente/app/backend/src/wrapper/wrapper.service.ts)

---

## 2. Foundation Adaptable Para El App

Se construyó una capa de adaptación común para que el shell no asuma features fijas, sino que se adapte a lo que Hermes soporte.

Esto incluye:

- projection de capabilities desde backend
- envelopes SSE normalizados
- gating de módulos por disponibilidad
- snapshots iniciales para que el shell arranque con estado coherente

Backend:

- [runtime-capabilities.ts](/Users/estebancanales/Work/agente/app/backend/src/modules/runtime/runtime-capabilities.ts)
- [runtime-events.ts](/Users/estebancanales/Work/agente/app/backend/src/modules/runtime/runtime-events.ts)
- endpoint `GET /runtime/capabilities`

Shell Swift:

- [NikiFeatureRegistry.swift](/Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/Core/NikiFeatureRegistry.swift)
- [NikiOperatorContracts.swift](/Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/Core/NikiOperatorContracts.swift)
- [NikiModels.swift](/Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/Core/NikiModels.swift)
- [NikiAppModel.swift](/Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/Core/NikiAppModel.swift)

Estado:

- módulos se muestran u ocultan por capabilities
- el dock ya no depende tanto de superficies fijas
- el shell ya puede reaccionar a snapshots de capabilities, sessions, MCP y profiles

---

## 3. Approvals Reales De Hermes

Ya existe soporte operativo para approvals del API server de Hermes.

### Ya implementado

- normalización de eventos `approval_request`
- normalización de eventos `approval_resolved`
- cola de approvals pendientes en runtime status
- endpoint `POST /runtime/approvals/respond`
- soporte de `resolveAll`
- actualización local del estado aunque Hermes no reemita inmediatamente el evento

Archivos clave:

- [runtime-events.ts](/Users/estebancanales/Work/agente/app/backend/src/modules/runtime/runtime-events.ts)
- [runtime-approval-state.ts](/Users/estebancanales/Work/agente/app/backend/src/modules/runtime/runtime-approval-state.ts)
- [runtime.service.ts](/Users/estebancanales/Work/agente/app/backend/src/modules/runtime/runtime.service.ts)
- [NikiApprovalsPanel.swift](/Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/Components/NikiApprovalsPanel.swift)
- [NikiAppModel.swift](/Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/Core/NikiAppModel.swift)

### Mejora nueva importante

Antes:

- el shell dependía demasiado de que Hermes devolviera el evento de resolución para limpiar la UI.

Ahora:

- el backend aplica una resolución local determinista sobre las approvals pendientes del `runId`
- rebroadcast de `approval_resolved` sale de inmediato
- eso evita que la UI quede “colgada” esperando el eco de Hermes

### Qué falta aquí

- mejor contexto por approval
- agrupar por run/tool
- expiración/timeout más visible
- UX más rica para approvals múltiples y de alto riesgo

---

## 4. Sesiones Remotas, `/undo`, Handoff y Multi-Profile

La superficie de sesiones ya no es solo lectura.

### Ya implementado

- proyección de sesiones desde Hermes
- unión de `sessions.json` + `state.db`
- parseo de `profileId`
- cálculo de `messageCount`, `apiCallCount`, `resumePending`, `resumeReason`
- lectura de `handoffState`, `handoffPlatform`, `handoffError`
- lectura de `handoffTargets`
- endpoint `GET /runtime/sessions`
- endpoint `GET /runtime/profiles`

Archivos clave:

- [runtime-sessions.ts](/Users/estebancanales/Work/agente/app/backend/src/modules/runtime/runtime-sessions.ts)
- [runtime-profiles.ts](/Users/estebancanales/Work/agente/app/backend/src/modules/runtime/runtime-profiles.ts)

### Acciones reales ya implementadas

- `POST /runtime/sessions/handoff`
- `POST /runtime/sessions/undo`

Handoff:

- escribe estado real tipo Hermes en `state.db`
- valida targets desde `channel_directory.json`

Undo:

- usa `SessionDB` real de Hermes
- reescribe transcript y `state.db`
- bloquea operación si la sesión está ocupada según `processes.json`

Archivo clave:

- [runtime-session-actions.ts](/Users/estebancanales/Work/agente/app/backend/src/modules/runtime/runtime-session-actions.ts)

### Mejora nueva importante

Ahora además existe un evento SSE explícito de feedback para acciones de sesión:

- `session_action`

Eso permite que el shell reciba confirmación clara de:

- handoff solicitado
- undo realizado

sin depender solo del refresh posterior de sesiones.

Archivos clave:

- [runtime-events.ts](/Users/estebancanales/Work/agente/app/backend/src/modules/runtime/runtime-events.ts)
- [runtime.service.ts](/Users/estebancanales/Work/agente/app/backend/src/modules/runtime/runtime.service.ts)
- [NikiModels.swift](/Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/Core/NikiModels.swift)
- [NikiAppModel.swift](/Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/Core/NikiAppModel.swift)

### UI ya implementada

- panel de sesiones
- botones reales de undo
- botones reales de handoff por target
- uso de perfil remoto activo

Archivo clave:

- [NikiSessionsPanel.swift](/Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/Components/NikiSessionsPanel.swift)

### Qué falta aquí

- orquestación más profunda de resume/handoff
- menos refresh manual y más stream integral de cambios
- mejor integración cross-module del `activeProfile`
- UX más fuerte para sesiones largas, estados suspendidos y recuperación

---

## 5. MCP Catalog / Admin Surface

Ya existe una base funcional para administración de MCP desde Niki.

### Ya implementado

- parseo de `mcp_servers` desde `~/.hermes/config.yaml`
- proyección de inventario MCP
- endpoint `GET /runtime/mcp`
- mutación de `enabled` para servidores MCP
- endpoint `POST /runtime/mcp/server`

Archivos clave:

- [runtime-mcp.ts](/Users/estebancanales/Work/agente/app/backend/src/modules/runtime/runtime-mcp.ts)
- [wrapper.controller.ts](/Users/estebancanales/Work/agente/app/backend/src/wrapper/wrapper.controller.ts)
- [wrapper.service.ts](/Users/estebancanales/Work/agente/app/backend/src/wrapper/wrapper.service.ts)

### UI ya implementada

- módulo/panel MCP
- toggle enable/disable
- busy/error state

Archivo clave:

- [NikiMcpPanel.swift](/Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/Components/NikiMcpPanel.swift)

### Qué falta aquí

- health operativo más profundo
- auth/setup flow
- detalle de transport y fallos accionables
- acciones admin más completas que solo enable/disable

---

## 6. LSP Diagnostics

Ya existe entrada real de diagnostics post-write hacia Niki.

### Ya implementado

- normalización de evento `lsp_diagnostics`
- envelope `diagnostics`
- consumo en SSE del shell
- lista de diagnostics en app state

Archivos clave:

- [runtime-events.ts](/Users/estebancanales/Work/agente/app/backend/src/modules/runtime/runtime-events.ts)
- [NikiDiagnosticsPanel.swift](/Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/Components/NikiDiagnosticsPanel.swift)

### Qué falta aquí

- navegación más operativa
- acciones sobre errores
- mejor UX para severidad, archivo, agrupación y resolución

---

## 7. Discover, `x_search`, `video_generate` y Profiles Remotos

Ya existe la base adaptable para discover y perfiles remotos.

### Ya implementado

- proyección de discover capabilities
- endpoint `GET /runtime/discover?profileId=...`
- inventario explícito de perfiles remotos
- uso del perfil activo desde el shell

Archivos clave:

- [runtime-discover.ts](/Users/estebancanales/Work/agente/app/backend/src/modules/runtime/runtime-discover.ts)
- [runtime-profiles.ts](/Users/estebancanales/Work/agente/app/backend/src/modules/runtime/runtime-profiles.ts)
- [NikiDiscoverPanel.swift](/Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/Components/NikiDiscoverPanel.swift)

### Qué falta aquí

- convertir discover en una superficie más ejecutable
- no solo mostrar capacidades, sino flujos reales de operador
- integración más profunda con profiles remotos en toda la consola

---

## 8. Computer Use

Esta es la parte más viva de las últimas pasadas.

### Estado anterior

Ya existían:

- endpoint `GET /computer/capabilities`
- endpoint `GET /computer/recent`
- endpoint `POST /computer/action`
- panel `Computer`
- capacidades backend
- acciones recientes
- captura de pantalla manual

### Lo nuevo agregado

#### 8.1. Operator Surface proyectada por backend

Ya no se definen quick actions fijas solo en Swift.

Ahora backend proyecta:

- `summary`
- `recommendedActions`
- `inputs`
- `state`
- `reason`

Archivo clave:

- [computer-operator-surface.ts](/Users/estebancanales/Work/agente/app/backend/src/modules/computer/computer-operator-surface.ts)

Pruebas:

- [computer-operator-surface.test.ts](/Users/estebancanales/Work/agente/app/backend/src/modules/computer/computer-operator-surface.test.ts)

#### 8.2. Acciones guiadas ya soportadas por operator surface

Actualmente la superficie puede proyectar, según capabilities reales:

- `screen_capture`
- `screen_info`
- `clipboard_read`
- `app_list`
- `system_info`
- `app_activate`
- `open_url`
- `clipboard_write`
- `notify`

Las acciones que requieren input ahora pueden describir inputs mínimos para que el shell las ejecute sin hardcodes paralelos.

#### 8.3. Shell ya consume el contrato adaptable

El panel `Computer` ya:

- renderiza acciones recomendadas desde backend
- dibuja inputs dinámicos por acción
- decide enable/disable por `state`
- ejecuta la acción usando el contrato recibido

Archivos clave:

- [NikiModels.swift](/Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/Core/NikiModels.swift)
- [NikiAppModel.swift](/Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/Core/NikiAppModel.swift)
- [NikiComputerPanel.swift](/Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/Components/NikiComputerPanel.swift)

#### 8.4. Viewport más vivo

Esto también mejoró:

- refresh manual del viewport
- timestamp de última captura
- modo `Start Live` / `Stop Live`
- loop de auto-refresh controlado en el app model
- la captura inicial se dispara si todavía no existe imagen

Estado:

- ya no es solo "toma una captura y la deja ahí"
- sigue sin ser takeover visual total, pero ya se acerca a una consola operator-friendly

### Qué falta aquí

Esta sigue siendo una de las áreas más incompletas a nivel producto:

- takeover más real
- viewport más rico que una serie de capturas
- interacciones guiadas más profundas para input real
- acciones visuales/manuales más cercanas a control completo
- mejor sincronización entre estado visual y acciones de operador

---

## 9. Dock y Módulos del Shell

La navegación del shell ya está más alineada al modelo operator console.

Ya existe:

- dock capability-driven
- paneles por módulo
- ocultamiento de superficies no listas

Módulos ya integrados o parcialmente integrados:

- Chat
- Computer
- Approvals
- Sessions
- MCP
- Diagnostics
- Discover
- Settings

Archivos relevantes:

- [DockItem.swift](/Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/Models/DockItem.swift)
- [NikiDockView.swift](/Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/Components/NikiDockView.swift)
- [NikiSidebarPanels.swift](/Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/Components/NikiSidebarPanels.swift)

---

## Lo Nuevo Agregado En Las Últimas Pasadas

Lista resumida de adiciones recientes de mayor impacto:

- approvals ya se resuelven localmente en backend y rebroadcast inmediato
- `session_action` SSE para handoff/undo
- `computer operator surface` proyectada por backend
- acciones guiadas dinámicas para computer
- viewport live con auto-refresh
- nuevas acciones guiadas `clipboard_write` y `notify`
- feedback más claro en approvals cuando una acción de scope resuelve varias solicitudes

---

## Qué Falta

## Prioridad Alta

### 1. Computer Use Profundo

Falta:

- takeover más real
- capacidades visuales y de acción más profundas
- mejor modelo de control guiado
- flujo más claro entre observación, intervención y recuperación

### 2. Session Orchestration Más Completa

Falta:

- más estados SSE para ciclo completo de handoff/resume
- mejor integración con multi-profile
- menos dependencia de refresh puntual

### 3. Discover Más Ejecutable

Falta:

- acciones reales de operador para `x_search`
- acciones reales para `video_generate`
- mejor unión con perfiles remotos

## Prioridad Media

### 4. MCP Admin Más Operativo

Falta:

- health más profundo
- setup/auth detail
- errores accionables
- acciones administrativas más allá de enable/disable

### 5. Diagnostics UX Más Fuerte

Falta:

- navegación
- agrupación
- acciones sobre problemas

## Prioridad De Cierre

### 6. Validación Final del Shell

Falta:

- validación fresca de compilación Swift
- validación más end-to-end del shell
- revisión final de integración visual y operativa

### 7. Cleanup Final

Falta:

- recorte adicional de restos legacy internos
- depuración de superficies que todavía sobreviven solo como compatibilidad parcial

---

## Estado Real De Validación

## Verificado en backend

Se corrieron múltiples validaciones durante estas pasadas, incluyendo:

```bash
node --import tsx --test src/modules/computer/computer-operator-surface.test.ts
node --import tsx --test src/modules/runtime/runtime-approval-state.test.ts
node --import tsx --test src/modules/runtime/runtime-approvals.test.ts
node --import tsx --test src/modules/runtime/runtime-capabilities.test.ts
node --import tsx --test src/modules/runtime/runtime-events.test.ts
node --import tsx --test src/modules/runtime/runtime-profiles.test.ts
npm run typecheck
npm run build
git diff --check -- app/backend app/Niki
```

Estado:

- backend tests dirigidos: sí
- backend typecheck: sí
- backend build: sí
- diff check: sí

## No verificado fresco en esta fase

No quedó validado de forma fresca en estas últimas pasadas:

- `xcodebuild`
- integración final Swift end-to-end

Por eso no se debe afirmar todavía que el shell completo está 100% verificado en compilación nativa.

---

## Conclusión

La base Hermes-first ya existe y ya es bastante seria.

Lo más importante que ya no falta:

- la arquitectura adaptable
- los contratos backend -> shell
- la integración SSE principal
- approvals funcionales
- sesiones remotas funcionales
- feedback operativo explícito
- una primera versión real de `computer_use`

Lo que falta ahora no es “empezar”, sino cerrar las capas de profundidad:

- `computer_use` más fuerte
- session orchestration más completa
- discover más ejecutable
- MCP admin más profundo
- validación final del shell

Si se sigue el orden correcto, la siguiente mejor secuencia es:

1. profundizar `computer_use`
2. cerrar `sessions + multi-profile + resume/handoff`
3. hacer `discover` más ejecutable
4. robustecer `MCP admin`
5. correr validación final del shell
