# Niki

Niki es un sistema de escritorio para interactuar con un asistente de inteligencia artificial, gestionar tareas, usar voz y conectar una experiencia nativa de macOS con un backend local. El proyecto integra una app nativa de macOS en SwiftUI (ventana principal + overlay del notch en un solo proceso) y un backend en NestJS.

## Objetivo del proyecto

El objetivo es construir un centro de control personal para un agente de IA que permita:

- Enviar mensajes al asistente y recibir respuestas en tiempo real.
- Gestionar tareas y elementos de trabajo.
- Usar entrada y salida de voz mediante transcripcion y sintesis.
- Mostrar una experiencia nativa en macOS mediante una app de escritorio.
- Mostrar acceso rapido desde el notch de la Mac (integrado en la misma app).
- **Controlar la computadora**: un agente local (Groq) ejecuta acciones reales en la Mac
  (shell, AppleScript, mouse, teclado, capturas, apps, archivos) con una capa de seguridad.

## Tecnologias utilizadas

- **App macOS (Niki):** Swift, SwiftUI, AppKit — ventana principal + overlay del notch en un proceso unico.
- **Backend:** NestJS, TypeScript, Node.js.
- **Runtime IA:** agente local con Groq (function-calling + control de la computadora) y, como alterno, Hermes API Server via HTTP/SSE.
- **Persistencia local:** estado en memoria y archivo JSON local para work items.
- **Voz:** rutas locales para STT/TTS mediante servicios configurables.

## Estructura del proyecto

```text
.
├── app/
│   ├── Niki/       # app macOS: ventana principal + overlay del notch
│   └── backend/    # API NestJS
├── docs/           # documentación técnica
└── README.md
```

## Instrucciones rapidas de ejecucion

### Backend

```bash
cd app/backend
npm install
npm run start
```

Por defecto el backend escucha en:

```text
http://127.0.0.1:8000
```

### App macOS (Niki)

Requiere Xcode 16+ y [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```bash
cd app/Niki
xcodegen generate
open Niki.xcodeproj
```

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

