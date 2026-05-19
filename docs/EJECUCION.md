# Guia de Ejecucion

## Requisitos previos

- macOS para ejecutar las apps nativas.
- Node.js 18 o superior.
- npm.
- Rust y Cargo para Tauri.
- Xcode para `macOs-app` y `NikiNotch`.
- Hermes API Server si se desea usar chat real con runtime.

## Variables de entorno

El backend puede configurarse con un archivo `.env` dentro de `backend/`.

Variables comunes:

```env
PORT=8000
HOST=127.0.0.1
WRAPPER_API_KEY=
INTERNAL_API_KEY=
HERMES_API_SERVER_URL=http://127.0.0.1:8642
HERMES_API_KEY=
HERMES_MODEL=
```

El frontend puede recibir:

```env
NEXT_PUBLIC_NIKI_BACKEND_BASE_URL=http://127.0.0.1:8000
NEXT_PUBLIC_NIKI_BACKEND_API_KEY=
```

## Ejecutar backend

```bash
cd backend
npm install
npm run start
```

Para desarrollo:

```bash
cd backend
npm run dev
```

Validacion:

```bash
cd backend
npm run typecheck
npm run build
```

## Ejecutar frontend web

```bash
cd frontend
npm install
npm run dev
```

La app web queda disponible en:

```text
http://localhost:3000
```

Validacion:

```bash
cd frontend
npm run typecheck
npm run build
```

## Ejecutar Tauri

```bash
cd frontend
npm run tauri:dev
```

Build de escritorio:

```bash
cd frontend
npm run tauri:build
```

## Ejecutar app nativa macOS

1. Abrir `macOs-app/NikiDesktop.xcodeproj`.
2. Seleccionar el scheme `NikiDesktop`.
3. Ejecutar en `My Mac`.

Validacion por terminal:

```bash
xcodebuild \
  -project macOs-app/NikiDesktop.xcodeproj \
  -scheme NikiDesktop \
  -configuration Debug \
  -destination platform=macOS \
  CODE_SIGNING_ALLOWED=NO \
  build
```

## Ejecutar NikiNotch

1. Abrir `NikiNotch/boringNotch.xcodeproj`.
2. Seleccionar el scheme `boringNotch`.
3. Ejecutar en `My Mac`.

Validacion por terminal:

```bash
xcodebuild \
  -project NikiNotch/boringNotch.xcodeproj \
  -scheme boringNotch \
  -configuration Debug \
  -destination platform=macOS \
  CODE_SIGNING_ALLOWED=NO \
  build
```

## Credenciales demo

Usuario:

```text
operator@niki.com
```

Password:

```text
demo-password
```

Codigo MFA:

```text
123456
```

## Uso con Docker

Actualmente el proyecto no incluye un `Dockerfile` o `docker-compose.yml` oficial. La ejecucion recomendada es local, usando Node.js, npm, Xcode y Tauri.

## Orden recomendado para levantar el sistema

1. Levantar Hermes API Server, si se usara chat real.
2. Levantar `backend`.
3. Levantar `frontend` o Tauri.
4. Abrir `macOs-app` si se desea probar la app nativa.
5. Abrir `NikiNotch` o dejar que `macOs-app` lo administre.

