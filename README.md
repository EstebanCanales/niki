# Niki

Niki es un sistema de escritorio para interactuar con un asistente de inteligencia artificial, gestionar tareas, usar voz y conectar una experiencia nativa de macOS con un backend local. El proyecto integra una aplicacion web de escritorio con Tauri, un backend en NestJS, una app nativa de macOS en SwiftUI y un companion app de notch llamado NikiNotch.

## Objetivo del proyecto

El objetivo es construir un centro de control personal para un agente de IA que permita:

- Enviar mensajes al asistente y recibir respuestas en tiempo real.
- Gestionar tareas y elementos de trabajo.
- Usar entrada y salida de voz mediante transcripcion y sintesis.
- Mostrar una experiencia nativa en macOS mediante una app de escritorio.
- Conectar la app principal con NikiNotch para acceso rapido desde la barra superior.
- **Controlar la computadora**: un agente local (Groq) ejecuta acciones reales en la Mac
  (shell, AppleScript, mouse, teclado, capturas, apps, archivos) con una capa de seguridad.

## Tecnologias utilizadas

- **Frontend web:** Next.js 15, React 19, TypeScript, Tailwind CSS.
- **Desktop web:** Tauri 2, Rust.
- **Backend:** NestJS, TypeScript, Node.js.
- **Runtime IA:** agente local con Groq (function-calling + control de la computadora) y, como alterno, Hermes API Server vía HTTP/SSE.
- **App macOS nativa:** SwiftUI, AppKit, AVFoundation.
- **Notch macOS:** SwiftUI sobre la base de Boring Notch, adaptado como NikiNotch.
- **Persistencia local:** estado en memoria y archivo JSON local para work items.
- **Voz:** rutas locales para STT/TTS mediante servicios configurables.

## Estructura del proyecto

```text
.
├── backend/       # API NestJS y wrapper del runtime
├── frontend/      # app Next.js + Tauri
├── macOs-app/     # app nativa macOS en SwiftUI
├── NikiNotch/     # companion app de notch para macOS
├── docs/          # documentacion tecnica del proyecto
└── README.md      # documento principal
```

## Instrucciones rapidas de ejecucion

### Backend

```bash
cd backend
npm install
npm run start
```

Por defecto el backend escucha en:

```text
http://127.0.0.1:8000
```

### Frontend web / Tauri

```bash
cd frontend
npm install
npm run dev
```

Para modo escritorio con Tauri:

```bash
cd frontend
npm run tauri:dev
```

### App nativa macOS

Abrir `macOs-app/NikiDesktop.xcodeproj` en Xcode y ejecutar el target `NikiDesktop`.

### NikiNotch

Abrir `NikiNotch/boringNotch.xcodeproj` en Xcode y ejecutar el scheme `boringNotch`. El producto generado usa el nombre `NikiNotch`.

## Evidencia visual

Las capturas de pantalla del sistema funcionando deben colocarse en:

```text
docs/assets/screenshots/
```

Se recomienda incluir al menos:

- Pantalla principal de Niki Desktop.
- Sidebar de chat funcionando.
- Panel de tareas.
- Settings con configuracion de backend y NikiNotch.
- NikiNotch abierto.

## Documentacion adicional

- [Arquitectura del sistema](docs/ARQUITECTURA.md)
- [Diseno de base de datos](docs/BASE_DE_DATOS.md)
- [Servicios y endpoints](docs/API_SERVICIOS.md)
- [Guia de ejecucion](docs/EJECUCION.md)
- [Mejoras futuras](docs/MEJORAS_FUTURAS.md)

