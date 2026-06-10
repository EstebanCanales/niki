# Niki Single App — Design Spec

> Aprobado por el usuario el 2026-06-10

## Objetivo

Fusionar `app/Notch/` (NikiNotch, overlay del notch) y `app/app/` (NikiDesktop, ventana principal) en un único proceso macOS. Eliminar toda nomenclatura "Boring/boringNotch". Mover `outdate-frontend/` a la Papelera.

## Contexto previo

- `app/Notch/` = fork de BoringNotch. 121 archivos Swift. Entry point: `DynamicNotchApp (@main)`. Gestiona `NSWindow` overlay en el notch de la pantalla.
- `app/app/` = NikiDesktop. 16 archivos Swift. Entry point: `NikiDesktopApp (@main)`. Ventana principal SwiftUI.
- Comunicación actual: IPC vía `DistributedNotificationCenter` (`com.niki.notch.*`) + `NSWorkspace.openApplication` para lanzar/matar la app del notch.
- `outdate-frontend/` = Next.js obsoleto, no se usa. A la Papelera.

## Arquitectura objetivo

### Estructura de carpetas

```
app/
├── Niki/
│   ├── project.yml             # XcodeGen — genera Niki.xcodeproj
│   ├── Sources/
│   │   ├── App/
│   │   │   ├── NikiApp.swift           # @main único (fusión de ambos entry points)
│   │   │   └── NikiAppDelegate.swift   # AppDelegate unificado
│   │   ├── Notch/                      # código de overlay (de app/Notch/boringNotch/)
│   │   ├── Desktop/                    # vistas de escritorio (de app/app/NikiDesktop/)
│   │   └── Shared/                     # modelos, APIClient, utilidades comunes
│   └── NikiXPCHelper/                  # era BoringNotchXPCHelper
└── backend/
```

### Entry point unificado

```swift
@main
struct NikiApp: App {
    @NSApplicationDelegateAdaptor(NikiAppDelegate.self) var appDelegate
    @StateObject private var appModel = NikiAppModel()
    var body: some Scene {
        WindowGroup("Niki") {
            ContentView().environmentObject(appModel)
        }
        Settings {
            SettingsView(updaterController: appDelegate.updaterController)
        }
    }
}
```

`NikiAppDelegate` fusiona:
- Lógica de overlay del notch (ventanas `NikiNotchWindow`, drag detectors, etc.)
- Ciclo de vida del desktop (era `NikiDesktopAppDelegate`)
- Elimina `ensureNotchRunning()` y toda comunicación IPC externa

### Renombrado completo Boring → Niki

| Antes | Después |
|---|---|
| `BoringViewCoordinator` | `NikiNotchCoordinator` |
| `BoringViewModel` | `NikiNotchViewModel` |
| `BoringNotchWindow` | `NikiNotchWindow` |
| `BoringNotchSkyLightWindow` | `NikiNotchSkyLightWindow` |
| `BoringNotchXPCHelper` | `NikiXPCHelper` |
| `BoringExtrasMenu` | `NikiExtrasMenu` |
| `BoringLargeButtons` | `NikiLargeButtons` |
| `BoringHeader` | `NikiNotchHeader` |
| `BoringBatteryView` | `NikiBatteryView` |
| `BoringStatusMenu` | `NikiStatusMenu` |
| `BoringAnimations` | `NikiAnimations` |
| `BoringCalendar` (struct) | `NikiCalendar` |
| `DynamicNotchApp` | `NikiApp` |
| `theboringteam.boringnotch.BoringNotchXPCHelper` (XPC service) | `com.niki.NikiXPCHelper` |
| `boringShelf` (Defaults key) | `nikiShelf` |
| `boring.m4a` | `niki.m4a` |
| carpeta `boringNotch/` | `Notch/` (dentro de Sources/) |
| carpeta `BoringNotchXPCHelper/` | `NikiXPCHelper/` |

### IPC eliminado

Estos métodos de `NikiAppModel` se reemplazan con llamadas directas al `NikiAppDelegate`:

| Eliminar | Reemplazar con |
|---|---|
| `ensureNotchRunning()` | `NikiAppDelegate.shared.setupNotchWindows()` |
| `terminateNotchApp()` | llamada directa en `applicationWillTerminate` |
| `openNotchSettings()` + DistributedNotificationCenter | `SettingsWindowController.shared.showWindow()` directo |
| `restartNotchApp()` + DistributedNotificationCenter | `ApplicationRelauncher.restart()` directo |
| `setNotchVisible()` + DistributedNotificationCenter | `NikiAppDelegate.shared.vm.open/close()` directo |

## Dependencias Swift (se mantienen)

AsyncXPCConnection, Defaults, KeyboardShortcuts, LaunchAtLogin-Modern, Lottie, MacroVisionKit, Pow, SkyLightWindow, Sparkle, swift-collections, swift-syntax, SwiftUI-Introspect.

## Bundle ID

`com.niki.app` (era `com.niki.desktop` y `com.niki.notch` separados).

## Fuera del alcance

- Backend (`app/backend/`) — no cambia estructura
- Review de errores en backend — tarea separada dentro del mismo plan
