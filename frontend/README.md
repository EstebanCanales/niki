# Niki Frontend

Niki is a premium desktop shell for Hermes. The frontend is built desktop-first with `Tauri + Next.js + TypeScript` and uses a tool-first UI with a central agent, operational activity inspector, and a backend-driven runtime layer.

## Stack

- Tauri 2
- Next.js App Router
- TypeScript
- Tailwind CSS
- Framer Motion
- Zustand
- TanStack Query
- react-resizable-panels

## Run

```bash
npm install
npm run dev
```

To run the desktop shell with Tauri:

```bash
npm run tauri:dev
```

## Runtime configuration

Copy `.env.example` to `.env.local`.

Niki uses Hermes via backend by default.

Important:

- Install Hermes first with the official installer:
  `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`
- Enable the API server in `~/.hermes/.env` with `API_SERVER_ENABLED=true`
- Start or restart `hermes gateway`
- Unless you override it, Niki expects Hermes at `http://127.0.0.1:8642`
- The frontend no longer connects directly to a runtime WebSocket
- `NEXT_PUBLIC_NIKI_RUNTIME_TRANSPORT=mock` is a dev-only override for offline UI work

Frontend envs:

- `NEXT_PUBLIC_NIKI_RUNTIME_TRANSPORT`
- `NIKI_BACKEND_BASE_URL`
- `NIKI_BACKEND_API_KEY`
- `NEXT_PUBLIC_NIKI_BACKEND_BASE_URL`
- `NEXT_PUBLIC_NIKI_BACKEND_API_KEY`

## Voice pipeline

Niki still routes voice through the local Niki backend and the configured voice provider.

Required env vars:

- `NIKI_BACKEND_BASE_URL`
- `NIKI_BACKEND_API_KEY`
- `CLAWBOT_DEFAULT_VOICE` (default: `carla`)
- `CLAWBOT_STT_LANGUAGE` (default: `es`)

## Validation

```bash
npm run typecheck
npm run lint
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```
