# Niki Single App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fusionar NikiNotch y NikiDesktop en un único proceso macOS, renombrar todo lo "Boring" a "Niki", y limpiar `outdate-frontend/`.

**Architecture:** Single `@main NikiApp` struct que gestiona tanto la ventana de escritorio como las ventanas overlay del notch. `NikiAppDelegate` unificado reemplaza los dos AppDelegates actuales. IPC vía `DistributedNotificationCenter` eliminado — llamadas directas en su lugar.

**Tech Stack:** Swift 5.10, SwiftUI, AppKit, XcodeGen (project.yml), macOS 14+. Packages: Defaults, KeyboardShortcuts, Sparkle, SkyLightWindow, Pow, Lottie, LaunchAtLogin-Modern, AsyncXPCConnection, MacroVisionKit, SwiftUI-Introspect, swift-collections.

**Spec:** `docs/superpowers/specs/2026-06-10-niki-single-app-design.md`

---

## File Map

### Crear (nuevos)
- `app/Niki/project.yml` — XcodeGen config (reemplaza ambos xcodeproj)
- `app/Niki/Sources/App/NikiApp.swift` — `@main` unificado
- `app/Niki/Sources/App/NikiAppDelegate.swift` — AppDelegate unificado

### Mover y renombrar (Notch sources)
- `app/Notch/boringNotch/` → `app/Niki/Sources/Notch/`
- `app/Notch/BoringNotchXPCHelper/` → `app/Niki/NikiXPCHelper/`
- `app/Notch/mediaremote-adapter/` → `app/Niki/mediaremote-adapter/`
- `app/Notch/Configuration/` → `app/Niki/Configuration/`

### Mover y renombrar (Desktop sources)
- `app/app/NikiDesktop/` → `app/Niki/Sources/Desktop/`

### Eliminar
- `app/Notch/boringNotch.xcodeproj/` — reemplazado por project.yml
- `app/app/NikiDesktop.xcodeproj/` — reemplazado por project.yml
- `app/Notch/boringNotchApp.swift` entrada point — reemplazado por NikiApp.swift
- `app/app/NikiDesktopApp.swift` — reemplazado por NikiApp.swift

### Archivos a renombrar dentro de Sources/Notch/
| Antes | Después |
|---|---|
| `boringNotchApp.swift` | eliminado (fusionado en App/) |
| `BoringViewCoordinator.swift` | `NikiNotchCoordinator.swift` |
| `models/BoringViewModel.swift` | `models/NikiNotchViewModel.swift` |
| `components/Notch/BoringNotchWindow.swift` | `components/Notch/NikiNotchWindow.swift` |
| `components/Notch/BoringNotchSkyLightWindow.swift` | `components/Notch/NikiNotchSkyLightWindow.swift` |
| `components/Notch/BoringExtrasMenu.swift` | `components/Notch/NikiExtrasMenu.swift` |
| `components/Notch/BoringHeader.swift` | `components/Notch/NikiNotchHeader.swift` |
| `components/Calendar/BoringCalendar.swift` | `components/Calendar/NikiCalendar.swift` |
| `XPCHelperClient/BoringNotchXPCHelperProtocol.swift` | `XPCHelperClient/NikiXPCHelperProtocol.swift` |
| `boringNotch.entitlements` | `Niki.entitlements` |
| `boring.m4a` | `niki.m4a` |

---

## Task 1: Mover outdate-frontend a la Papelera

**Files:** ninguno en git — solo filesystem

- [ ] **Step 1: Mover a Trash**

```bash
osascript -e 'tell application "Finder" to move POSIX file "/Users/estebancanales/Work/agente/outdate-frontend" to trash'
```

Expected: sin error, carpeta desaparece de `ls /Users/estebancanales/Work/agente/`

- [ ] **Step 2: Verificar**

```bash
ls /Users/estebancanales/Work/agente/
```

Expected: `outdate-frontend` ya no aparece.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove outdated frontend"
```

---

## Task 2: Crear estructura de carpetas app/Niki/

**Files:** Crear directorios

- [ ] **Step 1: Crear árbol de directorios**

```bash
mkdir -p /Users/estebancanales/Work/agente/app/Niki/Sources/App
mkdir -p /Users/estebancanales/Work/agente/app/Niki/Sources/Notch
mkdir -p /Users/estebancanales/Work/agente/app/Niki/Sources/Desktop
mkdir -p /Users/estebancanales/Work/agente/app/Niki/Sources/Shared
mkdir -p /Users/estebancanales/Work/agente/app/Niki/NikiXPCHelper
```

- [ ] **Step 2: Verificar**

```bash
find /Users/estebancanales/Work/agente/app/Niki -type d
```

Expected: 6 directorios listados.

---

## Task 3: Mover fuentes de app/Notch/ a app/Niki/Sources/Notch/

**Files:**
- Mover: `app/Notch/boringNotch/*` → `app/Niki/Sources/Notch/`
- Mover: `app/Notch/BoringNotchXPCHelper/*` → `app/Niki/NikiXPCHelper/`
- Mover: `app/Notch/mediaremote-adapter/` → `app/Niki/mediaremote-adapter/`
- Mover: `app/Notch/Configuration/` → `app/Niki/Configuration/`

- [ ] **Step 1: Mover contenido de boringNotch/ (excepto boringNotchApp.swift que se reemplazará)**

```bash
cp -R /Users/estebancanales/Work/agente/app/Notch/boringNotch/. /Users/estebancanales/Work/agente/app/Niki/Sources/Notch/
```

- [ ] **Step 2: Mover XPC Helper**

```bash
cp -R /Users/estebancanales/Work/agente/app/Notch/BoringNotchXPCHelper/. /Users/estebancanales/Work/agente/app/Niki/NikiXPCHelper/
```

- [ ] **Step 3: Mover mediaremote-adapter y Configuration**

```bash
cp -R /Users/estebancanales/Work/agente/app/Notch/mediaremote-adapter /Users/estebancanales/Work/agente/app/Niki/mediaremote-adapter
cp -R /Users/estebancanales/Work/agente/app/Notch/Configuration /Users/estebancanales/Work/agente/app/Niki/Configuration
```

- [ ] **Step 4: Verificar conteo de archivos Swift**

```bash
find /Users/estebancanales/Work/agente/app/Niki/Sources/Notch -name "*.swift" | wc -l
```

Expected: ~120 archivos.

---

## Task 4: Mover fuentes de app/app/ a app/Niki/Sources/Desktop/

**Files:**
- Mover: `app/app/NikiDesktop/*` → `app/Niki/Sources/Desktop/`

- [ ] **Step 1: Copiar NikiDesktop (excepto NikiDesktopApp.swift)**

```bash
cp -R /Users/estebancanales/Work/agente/app/app/NikiDesktop/. /Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/
```

- [ ] **Step 2: Eliminar el entry point antiguo del desktop (se reemplaza en Task 6)**

```bash
rm /Users/estebancanales/Work/agente/app/Niki/Sources/Desktop/NikiDesktopApp.swift
```

- [ ] **Step 3: Verificar**

```bash
find /Users/estebancanales/Work/agente/app/Niki/Sources/Desktop -name "*.swift" | wc -l
```

Expected: ~15 archivos (NikiDesktop tenía 16 menos NikiDesktopApp.swift).

---

## Task 5: Renombrar tipos Boring* → Niki* en Sources/Notch/ (sed masivo)

**Files:** Todos los `.swift` en `app/Niki/Sources/Notch/`

- [ ] **Step 1: Renombrar tipos en contenido de archivos**

```bash
cd /Users/estebancanales/Work/agente/app/Niki/Sources/Notch

# Tipos de clase/struct
find . -name "*.swift" -exec sed -i '' \
  -e 's/BoringViewCoordinator/NikiNotchCoordinator/g' \
  -e 's/BoringViewModel/NikiNotchViewModel/g' \
  -e 's/BoringNotchSkyLightWindow/NikiNotchSkyLightWindow/g' \
  -e 's/BoringNotchWindow/NikiNotchWindow/g' \
  -e 's/BoringLargeButtons/NikiLargeButtons/g' \
  -e 's/BoringExtrasMenu/NikiExtrasMenu/g' \
  -e 's/BoringHeader/NikiNotchHeader/g' \
  -e 's/BoringBatteryView/NikiBatteryView/g' \
  -e 's/BoringStatusMenu/NikiStatusMenu/g' \
  -e 's/BoringAnimations/NikiAnimations/g' \
  -e 's/BoringCalendar/NikiCalendar/g' \
  -e 's/BoringNotchXPCHelperProtocol/NikiXPCHelperProtocol/g' \
  {} +
```

- [ ] **Step 2: Renombrar XPC service name**

```bash
find /Users/estebancanales/Work/agente/app/Niki -name "*.swift" -exec sed -i '' \
  -e 's/theboringteam\.boringnotch\.BoringNotchXPCHelper/com.niki.NikiXPCHelper/g' \
  {} +
```

- [ ] **Step 3: Renombrar clave de Defaults boringShelf → nikiShelf**

```bash
find /Users/estebancanales/Work/agente/app/Niki -name "*.swift" -exec sed -i '' \
  -e 's/"boringShelf"/"nikiShelf"/g' \
  -e 's/\.boringShelf/.nikiShelf/g' \
  {} +
```

- [ ] **Step 4: Renombrar referencia al audio**

```bash
find /Users/estebancanales/Work/agente/app/Niki -name "*.swift" -exec sed -i '' \
  -e 's/fileName: "boring"/fileName: "niki"/g' \
  {} +
```

- [ ] **Step 5: Renombrar comentarios de cabecera (// boringNotch → // Niki)**

```bash
find /Users/estebancanales/Work/agente/app/Niki -name "*.swift" -exec sed -i '' \
  -e 's|//  boringNotch|//  Niki|g' \
  -e 's|//  boringNotchApp|//  Niki|g' \
  {} +
```

- [ ] **Step 6: Renombrar la notificación de sharingDidFinish**

```bash
find /Users/estebancanales/Work/agente/app/Niki -name "*.swift" -exec sed -i '' \
  -e 's/com\.boringNotch\./com.niki./g' \
  {} +
```

- [ ] **Step 7: Renombrar archivos con Boring en nombre**

```bash
cd /Users/estebancanales/Work/agente/app/Niki/Sources/Notch

mv BoringViewCoordinator.swift NikiNotchCoordinator.swift
mv models/BoringViewModel.swift models/NikiNotchViewModel.swift
mv components/Notch/BoringNotchWindow.swift components/Notch/NikiNotchWindow.swift
mv components/Notch/BoringNotchSkyLightWindow.swift components/Notch/NikiNotchSkyLightWindow.swift
mv components/Notch/BoringExtrasMenu.swift components/Notch/NikiExtrasMenu.swift
mv components/Notch/BoringHeader.swift components/Notch/NikiNotchHeader.swift
mv "components/Calendar/BoringCalendar.swift" "components/Calendar/NikiCalendar.swift"
mv XPCHelperClient/BoringNotchXPCHelperProtocol.swift XPCHelperClient/NikiXPCHelperProtocol.swift
```

- [ ] **Step 8: Renombrar entitlements y audio**

```bash
mv /Users/estebancanales/Work/agente/app/Niki/Sources/Notch/boringNotch.entitlements \
   /Users/estebancanales/Work/agente/app/Niki/Sources/Notch/Niki.entitlements

mv /Users/estebancanales/Work/agente/app/Niki/Sources/Notch/boring.m4a \
   /Users/estebancanales/Work/agente/app/Niki/Sources/Notch/niki.m4a
```

- [ ] **Step 9: Renombrar XPC helper files**

```bash
cd /Users/estebancanales/Work/agente/app/Niki/NikiXPCHelper

mv BoringNotchXPCHelper.swift NikiXPCHelper.swift
mv BoringNotchXPCHelperProtocol.swift NikiXPCHelperProtocol.swift

# Update content
sed -i '' 's/BoringNotchXPCHelper/NikiXPCHelper/g' NikiXPCHelper.swift
sed -i '' 's/BoringNotchXPCHelper/NikiXPCHelper/g' NikiXPCHelperProtocol.swift
```

- [ ] **Step 10: Verificar que no quedan referencias boring en Sources/**

```bash
grep -ri "boring" /Users/estebancanales/Work/agente/app/Niki/Sources --include="*.swift" | grep -v "^Binary" | grep -v "theboringteam" | head -20
```

Expected: 0 líneas (o solo TheBoring en comentarios de asset paths).

---

## Task 6: Eliminar boringNotchApp.swift de Notch/ y crear NikiApp.swift unificado

**Files:**
- Eliminar: `app/Niki/Sources/Notch/boringNotchApp.swift`
- Crear: `app/Niki/Sources/App/NikiApp.swift`
- Crear: `app/Niki/Sources/App/NikiAppDelegate.swift`
- Modificar: `app/Niki/Sources/Desktop/Core/NikiAppModel.swift`

- [ ] **Step 1: Eliminar entry point antiguo**

```bash
rm /Users/estebancanales/Work/agente/app/Niki/Sources/Notch/boringNotchApp.swift
```

- [ ] **Step 2: Crear NikiApp.swift**

Crear `app/Niki/Sources/App/NikiApp.swift`:

```swift
import AVFoundation
import Combine
import Defaults
import KeyboardShortcuts
import Sparkle
import SwiftUI

@main
struct NikiApp: App {
    @NSApplicationDelegateAdaptor(NikiAppDelegate.self) var appDelegate
    @StateObject private var appModel = NikiAppModel()

    var body: some Scene {
        WindowGroup("Niki") {
            ContentView()
                .environmentObject(appModel)
                .frame(minWidth: 1240, minHeight: 820)
                .onAppear {
                    appDelegate.setupNotchWindows()
                }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1440, height: 920)
        .commands {
            CommandGroup(replacing: .newItem) { }
        }

        Settings {
            SettingsView(updaterController: appDelegate.updaterController)
        }
    }
}
```

- [ ] **Step 3: Crear NikiAppDelegate.swift**

Crear `app/Niki/Sources/App/NikiAppDelegate.swift` fusionando el `AppDelegate` de boringNotchApp.swift con `NikiDesktopAppDelegate`. El `AppDelegate` original de boringNotchApp.swift tiene ~400 líneas — copiar íntegramente y aplicar los siguientes cambios:

```swift
import AVFoundation
import Combine
import Defaults
import KeyboardShortcuts
import Sparkle
import SwiftUI

class NikiAppDelegate: NSObject, NSApplicationDelegate {
    // Updater (antes era en DynamicNotchApp.init)
    let updaterController: SPUStandardUpdaterController = {
        let c = SPUStandardUpdaterController(
            startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
        SettingsWindowController.shared.setUpdaterController(c)
        return c
    }()

    var statusItem: NSStatusItem?
    var windows: [String: NSWindow] = [:]
    var viewModels: [String: NikiNotchViewModel] = [:]
    var window: NSWindow?
    let vm: NikiNotchViewModel = .init()
    @ObservedObject var coordinator = NikiNotchCoordinator.shared
    var quickShareService = QuickShareService.shared
    var whatsNewWindow: NSWindow?
    var timer: Timer?
    var closeNotchTask: Task<Void, Never>?
    private var previousScreens: [NSScreen]?
    private var onboardingWindowController: NSWindowController?
    private var screenLockedObserver: Any?
    private var screenUnlockedObserver: Any?
    private var isScreenLocked: Bool = false
    private var windowScreenDidChangeObserver: Any?
    private var dragDetectors: [String: DragDetector] = [:]

    // MARK: - Notch setup (llamado desde NikiApp.onAppear)

    func setupNotchWindows() {
        // Misma lógica que applicationDidFinishLaunching del AppDelegate original,
        // pero sin los observers de DistributedNotificationCenter para IPC externo
        // (ya no son necesarios — estamos en el mismo proceso)
        guard window == nil && windows.isEmpty else { return }
        applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
    }

    // MARK: NSApplicationDelegate

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        NotificationCenter.default.removeObserver(self)
        DistributedNotificationCenter.default().removeObserver(self)
        if let observer = screenLockedObserver {
            DistributedNotificationCenter.default().removeObserver(observer)
            screenLockedObserver = nil
        }
        if let observer = screenUnlockedObserver {
            DistributedNotificationCenter.default().removeObserver(observer)
            screenUnlockedObserver = nil
        }
        MusicManager.shared.destroy()
        cleanupDragDetectors()
        cleanupWindows()
        XPCHelperClient.shared.stopMonitoringAccessibilityAuthorization()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Eliminar los 4 observers de DistributedNotificationCenter para IPC externo:
        //   com.niki.notch.openSettings → reemplazado por método directo
        //   com.niki.notch.restart     → reemplazado por método directo
        //   com.niki.notch.open        → reemplazado por método directo
        //   com.niki.notch.close       → reemplazado por método directo
        //
        // Mantener TODOS los demás observers (screen, shortcuts, screen lock/unlock)
        // — copiar íntegramente del AppDelegate original de boringNotchApp.swift
        // a partir de la línea con NotificationCenter.default.addObserver(selectedScreenChanged)
        //
        // [Pegar aquí el bloque de observers y setup de ventanas del AppDelegate original]
    }

    // Métodos públicos para NikiAppModel (reemplazan IPC)

    func openNotchSettings() {
        SettingsWindowController.shared.showWindow()
    }

    func restartApp() {
        ApplicationRelauncher.restart()
    }

    func openNotch() {
        if Defaults[.showOnAllDisplays] {
            viewModels.values.forEach { $0.open() }
        } else {
            vm.open()
        }
    }

    func closeNotch() {
        closeNotchTask?.cancel()
        closeNotchTask = nil
        if Defaults[.showOnAllDisplays] {
            viewModels.values.forEach { $0.close() }
        } else {
            vm.close()
        }
    }

    // [Copiar resto de métodos del AppDelegate original:
    //  onScreenLocked, onScreenUnlocked, enableSkyLightOnAllWindows,
    //  disableSkyLightOnAllWindows, cleanupWindows, cleanupDragDetectors,
    //  setupDragDetectors, createNikiNotchWindow, positionWindow,
    //  screenConfigurationDidChange, adjustWindowPosition, togglePopover,
    //  showMenu, quitAction, showOnboardingWindow, playWelcomeSound,
    //  deviceHasNotch — renombrando BoringNotchSkyLightWindow→NikiNotchSkyLightWindow
    //  y BoringViewModel→NikiNotchViewModel]
}
```

> **Nota de implementación:** `NikiAppDelegate.swift` es mayormente el `AppDelegate` original de `boringNotchApp.swift`. Los únicos cambios son:
> 1. Nombre de clase: `AppDelegate` → `NikiAppDelegate`
> 2. Eliminar los 4 `DistributedNotificationCenter` observers de IPC externo (openSettings/restart/open/close)
> 3. Eliminar los 4 métodos `@objc` correspondientes (`openSettingsFromDesktopBridge`, etc.)
> 4. Agregar `setupNotchWindows()` público
> 5. Agregar `openNotchSettings()`, `restartApp()`, `openNotch()`, `closeNotch()` públicos
> 6. Tipos renombrados (aplicados por Task 5)

- [ ] **Step 4: Actualizar NikiAppModel — eliminar IPC externo**

En `app/Niki/Sources/Desktop/Core/NikiAppModel.swift`, eliminar/reemplazar:

```swift
// ELIMINAR estas propiedades privadas:
// private let notchBundleID = "com.niki.notch"
// private let notchOpenSettingsNotification = ...
// private let notchRestartNotification = ...
// private let notchOpenNotification = ...
// private let notchCloseNotification = ...
// private var didRequestNotchLaunch = false

// ELIMINAR estos métodos completos:
// ensureNotchRunning()
// openNotchApp()
// terminateNotchApp()
// writeNotchBridgeConfig()
// runningNotchApp()
// notchApplicationURL()
// postNotchNotification()

// REEMPLAZAR con:
private weak var appDelegate: NikiAppDelegate?

func connectAppDelegate(_ delegate: NikiAppDelegate) {
    appDelegate = delegate
}

func openNotchSettings() {
    appDelegate?.openNotchSettings()
    notchBridgeStatus = "Settings opened."
}

func restartNotchApp() {
    appDelegate?.restartApp()
    notchBridgeStatus = "Restarting..."
}

func setNotchVisible(_ visible: Bool) {
    notchVisible = visible
    if visible {
        appDelegate?.openNotch()
        notchBridgeStatus = "Notch visible."
    } else {
        appDelegate?.closeNotch()
        notchBridgeStatus = "Notch hidden."
    }
}
```

- [ ] **Step 5: Conectar appDelegate en NikiApp.onAppear**

En `NikiApp.swift`, actualizar `onAppear`:

```swift
.onAppear {
    appModel.connectAppDelegate(appDelegate)
    appDelegate.setupNotchWindows()
}
```

---

## Task 7: Crear project.yml para XcodeGen

**Files:**
- Crear: `app/Niki/project.yml`

- [ ] **Step 1: Crear project.yml**

Crear `app/Niki/project.yml`:

```yaml
name: Niki
options:
  deploymentTarget:
    macOS: "14.0"
  xcodeVersion: "16"
packages:
  AsyncXPCConnection:
    url: https://github.com/ChimeHQ/AsyncXPCConnection
    from: "0.3.0"
  Defaults:
    url: https://github.com/sindresorhus/Defaults
    from: "7.0.0"
  KeyboardShortcuts:
    url: https://github.com/sindresorhus/KeyboardShortcuts
    from: "2.0.0"
  LaunchAtLoginModern:
    url: https://github.com/sindresorhus/LaunchAtLogin-Modern
    from: "1.0.0"
  Lottie:
    url: https://github.com/airbnb/lottie-spm.git
    from: "4.0.0"
  MacroVisionKit:
    url: https://github.com/TheBoredTeam/MacroVisionKit
    from: "1.0.0"
  Pow:
    url: https://github.com/EmergeTools/Pow
    from: "1.0.0"
  SkyLightWindow:
    url: https://github.com/Lakr233/SkyLightWindow
    from: "1.0.0"
  Sparkle:
    url: https://github.com/sparkle-project/Sparkle
    from: "2.0.0"
  SwiftCollections:
    url: https://github.com/apple/swift-collections.git
    from: "1.1.0"
  SwiftSyntax:
    url: https://github.com/swiftlang/swift-syntax
    from: "600.0.0"
  SwiftUIIntrospect:
    url: https://github.com/siteline/swiftui-introspect
    from: "1.0.0"

settings:
  base:
    SWIFT_VERSION: "5.10"
    CODE_SIGN_STYLE: Automatic
    DEVELOPMENT_TEAM: ""
    MACOSX_DEPLOYMENT_TARGET: "14.0"

targets:
  Niki:
    type: application
    platform: macOS
    sources:
      - path: Sources
    resources:
      - path: Sources/Notch/Assets.xcassets
      - path: Sources/Notch/niki.m4a
      - path: Sources/Notch/boring.m4a  # fallback por si no se renombró
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.niki.app
        PRODUCT_NAME: Niki
        GENERATE_INFOPLIST_FILE: YES
        INFOPLIST_KEY_CFBundleDisplayName: Niki
        INFOPLIST_KEY_LSApplicationCategoryType: public.app-category.productivity
        INFOPLIST_KEY_NSMicrophoneUsageDescription: "Niki uses the microphone to transcribe voice prompts."
        INFOPLIST_KEY_NSPrincipalClass: NSApplication
        CURRENT_PROJECT_VERSION: 1
        MARKETING_VERSION: 1.0
        ENABLE_HARDENED_RUNTIME: NO
        CODE_SIGN_ENTITLEMENTS: Sources/Notch/Niki.entitlements
    dependencies:
      - package: Defaults
      - package: KeyboardShortcuts
      - package: LaunchAtLoginModern
      - package: Lottie
      - package: MacroVisionKit
      - package: Pow
      - package: SkyLightWindow
      - package: Sparkle
        product: Sparkle
      - package: SwiftCollections
      - package: SwiftSyntax
      - package: SwiftUIIntrospect
      - target: NikiXPCHelper
        embed: true
        codeSign: true
    preBuildScripts:
      - name: "Run SwiftGen"
        script: |
          if which swiftgen >/dev/null; then swiftgen; fi

  NikiXPCHelper:
    type: xpc-service
    platform: macOS
    sources:
      - path: NikiXPCHelper
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.niki.NikiXPCHelper
        PRODUCT_NAME: NikiXPCHelper
        GENERATE_INFOPLIST_FILE: YES
        MACOSX_DEPLOYMENT_TARGET: "14.0"
    dependencies:
      - package: AsyncXPCConnection
```

> **Nota:** Los package versions exactos se deben copiar del `Package.resolved` actual en `app/Notch/boringNotch.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`.

- [ ] **Step 2: Instalar xcodegen si no está**

```bash
which xcodegen || brew install xcodegen
```

- [ ] **Step 3: Generar proyecto Xcode**

```bash
cd /Users/estebancanales/Work/agente/app/Niki
xcodegen generate
```

Expected: `Niki.xcodeproj` creado en `app/Niki/`.

- [ ] **Step 4: Verificar que el proyecto compila**

```bash
cd /Users/estebancanales/Work/agente/app/Niki
xcodebuild -scheme Niki -destination 'platform=macOS' build 2>&1 | tail -30
```

Expected: `BUILD SUCCEEDED` o lista de errores de compilación a resolver.

---

## Task 8: Resolver errores de compilación post-merge

**Files:** Varios en `app/Niki/Sources/`

Este task se ejecuta iterativamente: compilar → ver error → arreglar → repetir.

- [ ] **Step 1: Compilar y capturar errores**

```bash
cd /Users/estebancanales/Work/agente/app/Niki
xcodebuild -scheme Niki -destination 'platform=macOS' build 2>&1 | grep "error:" | head -40
```

- [ ] **Step 2: Arreglar ambigüedad @main**

Si aparece `error: 'main' attribute cannot be used in a module that contains top-level code`:

Asegurarse que `app/Niki/Sources/Notch/boringNotchApp.swift` fue eliminado (Task 6, Step 1).

Buscar otros `@main` residuales:

```bash
grep -rn "@main" /Users/estebancanales/Work/agente/app/Niki/Sources --include="*.swift"
```

Expected: solo 1 resultado en `Sources/App/NikiApp.swift`.

- [ ] **Step 3: Arreglar referencias a tipos no encontrados**

Errores comunes esperados:
- `BoringViewModel` residual → verificar que Task 5 Step 1 se ejecutó completo
- `DynamicNotchApp` residual → buscar y eliminar
- `NikiDesktopApp` residual → buscar y eliminar

```bash
grep -rn "DynamicNotchApp\|NikiDesktopApp\|BoringView\|BoringNotch" \
  /Users/estebancanales/Work/agente/app/Niki/Sources --include="*.swift"
```

Para cada hallazgo: editar el archivo y aplicar el renombrado correcto.

- [ ] **Step 4: Arreglar XPC service name en entitlements**

En `app/Niki/Sources/Notch/Niki.entitlements`, actualizar si contiene el servicio XPC antiguo:

```bash
grep -n "boringnotch\|BoringNotch" /Users/estebancanales/Work/agente/app/Niki/Sources/Notch/Niki.entitlements
```

Si hay coincidencias, reemplazar con `com.niki.NikiXPCHelper`.

- [ ] **Step 5: Compilar hasta BUILD SUCCEEDED**

```bash
cd /Users/estebancanales/Work/agente/app/Niki
xcodebuild -scheme Niki -destination 'platform=macOS' build 2>&1 | tail -5
```

Expected: `BUILD SUCCEEDED`

---

## Task 9: Eliminar directorios obsoletos

**Files:**
- Eliminar: `app/Notch/`
- Eliminar: `app/app/`

- [ ] **Step 1: Confirmar que app/Niki/ compila antes de eliminar**

Resultado de Task 8 debe ser `BUILD SUCCEEDED`.

- [ ] **Step 2: Mover directorios obsoletos a Trash**

```bash
osascript -e 'tell application "Finder" to move POSIX file "/Users/estebancanales/Work/agente/app/Notch" to trash'
osascript -e 'tell application "Finder" to move POSIX file "/Users/estebancanales/Work/agente/app/app" to trash'
```

- [ ] **Step 3: Verificar estructura final**

```bash
ls /Users/estebancanales/Work/agente/app/
```

Expected: solo `Niki/` y `backend/`.

- [ ] **Step 4: Commit**

```bash
cd /Users/estebancanales/Work/agente
git add -A
git commit -m "feat: merge NikiNotch + NikiDesktop into single Niki.app, rename Boring→Niki"
```

---

## Task 10: Actualizar README y docs

**Files:**
- Modificar: `README.md`
- Modificar: `docs/ARQUITECTURA.md`

- [ ] **Step 1: Actualizar README.md — sección de estructura**

Reemplazar la sección `## Estructura del proyecto`:

```markdown
## Estructura del proyecto

\`\`\`text
.
├── app/
│   ├── Niki/       # app macOS: ventana principal + overlay del notch
│   └── backend/    # API NestJS
├── docs/           # documentación técnica
└── README.md
\`\`\`
```

Reemplazar en instrucciones de ejecución `macOs-app/` → `app/Niki/` y `NikiNotch/` → (eliminado, integrado en Niki).

- [ ] **Step 2: Actualizar docs/ARQUITECTURA.md**

Reemplazar referencias a `NikiNotch/`, `macOs-app/`, `frontend/` con `app/Niki/` según corresponda.

- [ ] **Step 3: Commit**

```bash
git add README.md docs/ARQUITECTURA.md
git commit -m "docs: update README and architecture for merged Niki app"
```

---

## Task 11: Review de errores en backend

**Files:** `app/backend/src/**`

- [ ] **Step 1: Verificar que el backend compila sin errores TypeScript**

```bash
cd /Users/estebancanales/Work/agente/app/backend
npm run build 2>&1 | tail -30
```

- [ ] **Step 2: Revisar errores en módulos nuevos**

```bash
grep -rn "TODO\|FIXME\|console\.error\|throw new Error" \
  /Users/estebancanales/Work/agente/app/backend/src --include="*.ts" | head -20
```

- [ ] **Step 3: Verificar que los módulos nuevos están registrados**

Confirmar que `computer.module.ts` y `groq-agent.service.ts` están importados en `runtime.module.ts`:

```bash
grep -n "ComputerModule\|GroqAgentService" \
  /Users/estebancanales/Work/agente/app/backend/src/modules/runtime/runtime.module.ts
```

Expected: ambos aparecen como imports/providers.

- [ ] **Step 4: Verificar .env.example tiene todas las variables requeridas**

```bash
cat /Users/estebancanales/Work/agente/app/backend/.env.example
```

Comparar con variables usadas en `src/`:

```bash
grep -rh "process\.env\." /Users/estebancanales/Work/agente/app/backend/src \
  --include="*.ts" | grep -oE 'process\.env\.[A-Z_]+' | sort -u
```

Agregar a `.env.example` cualquier variable que falte.

- [ ] **Step 5: Commit si hay cambios**

```bash
cd /Users/estebancanales/Work/agente
git add app/backend/
git commit -m "fix: backend env vars and module registration"
```

---

## Checklist final

- [ ] `outdate-frontend/` en Trash
- [ ] `app/Niki/` compila con `BUILD SUCCEEDED`
- [ ] 0 referencias a `boring`/`Boring`/`BoringNotch` en `app/Niki/Sources/`
- [ ] Un solo `@main` en `Sources/App/NikiApp.swift`
- [ ] `app/Notch/` y `app/app/` en Trash
- [ ] README y docs actualizados
- [ ] Backend compila sin errores TS
