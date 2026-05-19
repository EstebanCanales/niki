# Arquitectura del Sistema

## Tipo de arquitectura

Niki utiliza una arquitectura **cliente-servidor** con separacion por capas:

- **Clientes:** frontend Tauri/Next.js, app nativa macOS y NikiNotch.
- **Backend:** API NestJS que actua como BFF y wrapper del runtime.
- **Runtime de IA:** Hermes API Server, consumido por el backend.
- **Persistencia local:** memoria del proceso y archivo JSON para datos locales.

Tambien se aplica una organizacion modular en backend, similar a una arquitectura por dominios: identidad, runtime, tareas, memoria, voz y wrapper.

## Componentes principales

### Frontend web y Tauri

Ubicacion: `frontend/`

Responsabilidades:

- Renderizar la experiencia principal de Niki.
- Consumir la API wrapper del backend.
- Mostrar chat, tareas, settings y estado del runtime.
- En modo Tauri, empaquetar la app web como aplicacion de escritorio.

### Backend

Ubicacion: `backend/`

Responsabilidades:

- Exponer endpoints HTTP para los clientes.
- Autenticar solicitudes mediante API key y token.
- Proxy de chat hacia Hermes.
- Emitir eventos de runtime por SSE.
- Gestionar work items, memoria, actividades y voz.
- Mantener estado local del sistema.

### App nativa macOS

Ubicacion: `macOs-app/`

Responsabilidades:

- Ofrecer una experiencia nativa en SwiftUI.
- Gestionar chat, tareas, voz y settings desde macOS.
- Sincronizar configuracion local con NikiNotch.
- Abrir y cerrar NikiNotch como companion app.

### NikiNotch

Ubicacion: `NikiNotch/`

Responsabilidades:

- Mostrar una interfaz rapida en el notch.
- Enviar prompts al backend.
- Consumir respuestas del backend.
- Leer configuracion local desde `~/.niki/notch-config.json`.

### Hermes Runtime

Servicio externo/local esperado por el backend.

Responsabilidades:

- Ejecutar el modelo o agente.
- Responder a requests de chat.
- Emitir eventos de ejecucion.

## Comunicacion entre componentes

```mermaid
flowchart LR
    User["Usuario"] --> Desktop["Niki Desktop macOS"]
    User --> Tauri["Frontend Tauri/Next.js"]
    User --> Notch["NikiNotch"]

    Desktop -->|HTTP /chat /tasks /voice| Backend["Backend NestJS"]
    Tauri -->|HTTP + SSE| Backend
    Notch -->|HTTP notch/debug + consume| Backend

    Backend -->|HTTP /v1/runs| Hermes["Hermes API Server"]
    Hermes -->|Run events| Backend

    Backend --> LocalState["RuntimeStateService"]
    Backend --> LocalDb[".niki/local-db.json"]
```

## Flujo de chat

1. El usuario escribe un mensaje en la app web, app nativa o notch.
2. El cliente envia la solicitud al backend.
3. El backend valida autorizacion.
4. El backend envia el prompt a Hermes mediante `/chat/stream`.
5. Hermes responde en streaming.
6. El backend reenvia el stream al cliente.
7. El cliente renderiza la respuesta y actualiza el estado visual.

## Flujo de tareas

1. El cliente solicita tareas mediante `GET /v1/work-items`.
2. El backend lee los work items desde el servicio de estado/local DB.
3. El usuario puede crear, editar, completar o eliminar tareas.
4. El backend persiste los cambios en `.niki/local-db.json`.

## Flujo de NikiNotch

1. Niki Desktop escribe `~/.niki/notch-config.json`.
2. Niki Desktop abre NikiNotch.
3. NikiNotch lee la configuracion local.
4. Los prompts del notch se envian a `POST /notch/debug`.
5. La app consume solicitudes con `POST /notch/consume`.

