# Documentacion de Servicios

La API principal expuesta al frontend, app nativa y NikiNotch esta en el backend NestJS. Por defecto corre en:

```text
http://127.0.0.1:8000
```

La mayoria de endpoints requieren autorizacion mediante header:

```http
x-niki-api-key: <API_KEY>
```

Cuando hay sesion, tambien puede enviarse:

```http
authorization: Bearer <ACCESS_TOKEN>
```

## Endpoints publicos del wrapper

| Metodo | Endpoint | Descripcion |
|---|---|---|
| `GET` | `/healthz` | Verifica estado del backend. |
| `GET` | `/config/public` | Devuelve configuracion publica. |
| `GET` | `/runtime/config` | Consulta configuracion del runtime. |
| `POST` | `/runtime/config` | Actualiza configuracion del runtime. |
| `GET` | `/runtime/status` | Consulta estado del runtime Hermes. |
| `GET` | `/runtime/events` | Stream SSE de eventos del runtime. |
| `POST` | `/chat/stream` | Envia un turno de chat y recibe streaming. |
| `POST` | `/notch/debug` | Encola una solicitud enviada desde NikiNotch. |
| `POST` | `/notch/consume` | Consume solicitudes pendientes del notch. |
| `GET` | `/v1/me` | Devuelve usuario autenticado. |
| `GET` | `/v1/activities` | Lista actividad/auditoria. |
| `GET` | `/v1/memory` | Lista memoria de usuario. |
| `POST` | `/v1/memory` | Guarda una entrada de memoria. |
| `DELETE` | `/v1/memory/:key` | Elimina una entrada de memoria. |
| `GET` | `/v1/work-items` | Lista tareas. |
| `POST` | `/v1/work-items` | Crea una tarea. |
| `PATCH` | `/v1/work-items/:id` | Actualiza una tarea. |
| `DELETE` | `/v1/work-items/:id` | Elimina una tarea. |
| `POST` | `/voice/transcribe` | Transcribe audio a texto. |
| `POST` | `/voice/synthesize` | Convierte texto a audio. |
| `GET` | `/computer/capabilities` | Lista capacidades, config y permisos de control. |
| `GET` | `/computer/config` | Consulta modo y config del control de la computadora. |
| `POST` | `/computer/config` | Cambia el modo (`open`/`guarded`/`locked`). |
| `GET` | `/computer/recent` | Últimas acciones ejecutadas (auditoría). |
| `POST` | `/computer/action` | Ejecuta una acción de control de la computadora. |

## Autenticacion

### POST `/v1/auth/login`

Inicia login con email y password.

Entrada:

```json
{
  "email": "operator@niki.com",
  "password": "demo-password"
}
```

Respuesta esperada:

```json
{
  "ok": true,
  "user": {
    "id": "user-demo",
    "email": "operator@niki.com",
    "displayName": "Operator"
  },
  "mfa": {
    "required": true,
    "challengeId": "challenge-id",
    "method": "totp"
  }
}
```

### POST `/v1/auth/mfa/verify`

Verifica el codigo MFA.

Entrada:

```json
{
  "challengeId": "challenge-id",
  "code": "123456"
}
```

Respuesta esperada:

```json
{
  "ok": true,
  "accessToken": "token",
  "tokenType": "Bearer"
}
```

## Control de la computadora

Niki incluye un **agente local** (Groq con function-calling) cuyas herramientas controlan
la Mac donde corre el backend. Se selecciona automáticamente cuando `GROQ_API_KEY` está
configurada (`provider=groq-local`). El agente actúa desde `/chat/stream`; también se puede
invocar cada capacidad directamente.

Capacidades (23): `shell_exec`, `applescript_run`, `screen_capture`, `screen_info`,
`mouse_move`, `mouse_click`, `mouse_drag`, `mouse_scroll`, `keyboard_type`, `keyboard_key`,
`clipboard_read`, `clipboard_write`, `app_launch`, `app_activate`, `app_quit`, `app_list`,
`fs_read`, `fs_write`, `fs_list`, `open_url`, `notify`, `system_volume`, `system_info`.

### Modelo de seguridad

El control de la computadora es una capacidad intencional y potente; el modelo de
seguridad es por capas y **honesto** sobre sus límites:

- **Guard de Origin (anti drive-by):** como el backend usa CORS abierto en localhost,
  cualquier web podría disparar acciones vía `fetch`. `/chat/stream`, `/computer/action`
  y `/computer/config` rechazan peticiones con `Origin` web externo (403). Clientes
  nativos (Tauri, curl, app macOS) no envían `Origin` o usan `localhost`/`tauri:`. Se
  amplía con `NIKI_ALLOWED_ORIGINS`.
- **Modos:** `locked` (solo lectura — límite real), `guarded` (alto riesgo exige
  `confirm: true`), `open` (todo salvo denylist).
- **Niveles de riesgo** por capacidad (`low`/`medium`/`high`).
- **Denylist de catástrofes** (siempre activa): normaliza el comando (comillas,
  backslashes, espacios) y bloquea borrados recursivos de rutas críticas, formateo de
  disco, apagado/reinicio, fork bombs, deshabilitar SIP/Gatekeeper, etc. Es un
  *speed-bump* de defensa en profundidad, **no un sandbox**: un shell con sustitución de
  comandos no puede acotarse por completo.
- **AppleScript:** se bloquea `with administrator privileges` (sin escalación silenciosa
  a root).
- **Escritura de archivos** restringida a raíces permitidas (home, tmp, proyecto);
  timeouts, truncado de salida y **auditoría** de cada acción (`GET /computer/recent`).
- **Recomendado:** define `WRAPPER_API_KEY` para exigir `x-niki-api-key` en todos los
  endpoints. El backend escucha solo en `127.0.0.1`.

El gate `confirm` en `guarded` es una guardia de cooperación del agente; los límites
duros son `locked`, la denylist de catástrofes, el bind a localhost y el guard de Origin.

### POST `/computer/action`

Entrada:

```json
{
  "action": "shell_exec",
  "params": { "command": "echo hola", "confirm": true }
}
```

Respuesta esperada (ejemplo):

```json
{ "ok": true, "exitCode": 0, "stdout": "hola\n", "stderr": "" }
```

Si una acción de alto riesgo se envía sin `confirm` en modo `guarded`:

```json
{ "ok": false, "requiresConfirmation": true, "error": "...high-risk; resend with confirm=true" }
```

### POST `/computer/config`

```json
{ "mode": "open" }
```

Requisitos de macOS en runtime: permiso de **Accesibilidad** (mouse/teclado) y **Grabación
de pantalla** (`screen_capture`).

## Chat

### POST `/chat/stream`

Envia un mensaje al agente (local Groq o, alternativamente, Hermes) y devuelve la respuesta
en streaming. Con el agente local, Niki puede ejecutar acciones de control de la computadora
durante el turno.

Entrada:

```json
{
  "sessionId": "session-1",
  "channel": "niki-agent",
  "input": "Hola, ayudame con mis tareas",
  "messages": [
    {
      "role": "user",
      "content": "Hola, ayudame con mis tareas"
    }
  ]
}
```

Respuesta esperada:

- Tipo: `text/event-stream`.
- Cada evento contiene fragmentos de respuesta del asistente.
- El cliente concatena los tokens hasta recibir el final del stream.

## Work items

### GET `/v1/work-items`

Parametros opcionales:

- `kind`
- `status`
- `search`

Respuesta esperada:

```json
{
  "items": [
    {
      "id": "work_123",
      "userId": "user-demo",
      "kind": "task",
      "title": "Preparar entrega",
      "status": "open",
      "priority": "medium",
      "subtasks": [],
      "proposalStatus": "none",
      "source": "manual"
    }
  ]
}
```

### POST `/v1/work-items`

Entrada:

```json
{
  "title": "Preparar documentacion",
  "notes": "Completar README y arquitectura",
  "priority": "medium",
  "status": "open"
}
```

### PATCH `/v1/work-items/:id`

Entrada:

```json
{
  "status": "done"
}
```

### DELETE `/v1/work-items/:id`

Elimina una tarea por identificador.

## Voice

### POST `/voice/transcribe`

Acepta audio por multipart:

```http
Content-Type: multipart/form-data
```

Campo:

- `audio`: archivo de audio.
- `language`: idioma opcional.

Respuesta esperada:

```json
{
  "ok": true,
  "text": "Texto transcrito"
}
```

### POST `/voice/synthesize`

Entrada:

```json
{
  "text": "Hola, soy Niki",
  "language": "es-ES",
  "voice": "es_AR-daniela"
}
```

Respuesta esperada:

```json
{
  "ok": true,
  "audio": "<base64>",
  "format": "wav",
  "mime": "audio/wav"
}
```

## Endpoints internos

Estos endpoints son para operadores o integraciones internas.

| Metodo | Endpoint | Descripcion |
|---|---|---|
| `GET` | `/internal/health` | Salud interna del backend. |
| `GET` | `/internal/runtime/status` | Estado interno del runtime. |
| `GET` | `/internal/runtime/tools` | Herramientas disponibles. |
| `GET` | `/internal/runtime/audit-summary` | Resumen de auditoria. |
| `GET` | `/internal/audit/events` | Eventos de auditoria. |
| `GET` | `/internal/compliance/profiles/:userId` | Perfil de cumplimiento. |

