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

## Chat

### POST `/chat/stream`

Envia un mensaje al runtime Hermes y devuelve una respuesta en streaming.

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

