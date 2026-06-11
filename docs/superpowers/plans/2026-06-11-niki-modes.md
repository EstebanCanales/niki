# Niki Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Limpiar referencias a BoringNotch, definir Auto Mode y Call Mode con UI clara en el desktop.

**Architecture:** Tres cambios independientes: (1) purge de strings/URLs de BoringNotch en Notch settings y extras menu; (2) renombrar y separar los dos modos de voz en `NikiAppModel` — Auto Mode (agente corre solo en loop continuo, ya existe como `companionLoop`) y Call Mode (conversación 1:1 bajo demanda); (3) modo-indicator pill en `NikiShellView` + dos botones de modo en `NikiDockView`.

**Tech Stack:** SwiftUI, AppKit, AVFoundation, Defaults (ya instalado)

---

## File Map

| Acción | Archivo |
|--------|---------|
| Modify | `Sources/Notch/components/Settings/SettingsView.swift` |
| Modify | `Sources/Notch/components/Notch/NikiExtrasMenu.swift` |
| Modify | `Sources/App/NikiAppDelegate.swift` |
| Modify | `Sources/Desktop/Core/NikiAppModel.swift` |
| Modify | `Sources/Desktop/Models/DockItem.swift` |
| Modify | `Sources/Desktop/Components/NikiDockView.swift` |
| Modify | `Sources/Desktop/Shell/NikiShellView.swift` |
| Create | `Sources/Desktop/Components/NikiModeIndicator.swift` |

---

## Task 1: Purge BoringNotch references

**Files:**
- Modify: `Sources/Notch/components/Settings/SettingsView.swift:873,892,1381`
- Modify: `Sources/Notch/components/Notch/NikiExtrasMenu.swift:46`
- Modify: `Sources/App/NikiAppDelegate.swift:449`

- [ ] **Step 1: Quitar GitHub link a boring.notch en SettingsView (~línea 873)**

Reemplazar el bloque completo del `HStack(spacing: 30)` que contiene el botón de GitHub de BoringNotch con un botón que apunte al repo de Niki (o quitar el botón si no hay repo público):

```swift
// Antes (~línea 871):
HStack(spacing: 30) {
    Spacer(minLength: 0)
    Button {
        if let url = URL(string: "https://github.com/TheBoredTeam/boring.notch") {
            NSWorkspace.shared.open(url)
        }
    } label: {
        VStack(spacing: 5) {
            Image("Github")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 18)
            Text("GitHub")
        }
        .contentShape(Rectangle())
    }
    Spacer(minLength: 0)
}
.buttonStyle(PlainButtonStyle())

// Después: eliminar ese HStack por completo (dejar solo UpdaterSettingsView arriba)
```

- [ ] **Step 2: Quitar footer "Made with 🫶🏻 by not so boring not.people" (~línea 892)**

```swift
// Eliminar este bloque:
VStack(spacing: 0) {
    Divider()
    Text("Made with 🫶🏻 by not so boring not.people")
        .foregroundStyle(.secondary)
        .padding(.top, 5)
        .padding(.bottom, 7)
        .multilineTextAlignment(.center)
        .padding(.horizontal, 10)
}
.frame(maxWidth: .infinity, alignment: .center)
```

- [ ] **Step 3: Renombrar "Enable boring mirror" (~línea 1381)**

```swift
// Antes:
Text("Enable boring mirror")
// Después:
Text("Enable mirror")
```

- [ ] **Step 4: Quitar `github` computed var en NikiExtrasMenu.swift (~línea 43)**

```swift
// Eliminar todo el var github: some View { ... } que apunta a TheBoredTeam
```

Si `github` se usa en el body del mismo archivo, también quitar la referencia en el body.

- [ ] **Step 5: Renombrar audio file en NikiAppDelegate.swift (~línea 449)**

El archivo `niki.m4a` ya existe en `Sources/Notch/niki.m4a`. Cambiar la llamada:

```swift
// Antes:
audioPlayer.play(fileName: "boring", fileExtension: "m4a")
// Después:
audioPlayer.play(fileName: "niki", fileExtension: "m4a")
```

- [ ] **Step 6: Build y verificar que no hay warnings/errors**

```bash
cd /Users/estebancanales/Work/agente/app/Niki
xcodebuild -scheme Niki -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

Esperado: `** BUILD SUCCEEDED **`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove BoringNotch branding references from Niki"
```

---

## Task 2: Separar Auto Mode y Call Mode en NikiAppModel

**Files:**
- Modify: `Sources/Desktop/Core/NikiAppModel.swift`

Actualmente `companionActive` + `companionLoop()` implementa un loop STT→agent→TTS. Vamos a mantener eso como **Auto Mode** y agregar **Call Mode** como una sesión de voz 1:1 más simple (push-to-talk + respuesta TTS, sin loop automático de escucha).

- [ ] **Step 1: Agregar `activeMode` enum y property en NikiAppModel**

En `Sources/Desktop/Core/NikiModels.swift`, agregar al final del bloque de enums:

```swift
enum NikiActiveMode {
    case none
    case auto   // agente loop continuo: escucha → piensa → habla → repite
    case call   // conversación 1:1: usuario presiona, habla, Niki responde
}
```

En `NikiAppModel`, reemplazar `@Published var companionActive = false` con:

```swift
@Published var activeMode: NikiActiveMode = .none
```

- [ ] **Step 2: Agregar computed vars de compatibilidad y nuevo método de modo**

En `NikiAppModel`, agregar después de la nueva property:

```swift
var companionActive: Bool { activeMode == .auto }
var callModeActive: Bool { activeMode == .call }

func activateAutoMode() {
    guard activeMode != .auto else {
        deactivateMode()
        return
    }
    deactivateMode()
    activeMode = .auto
    autoVoice = true
    voiceError = ""
    companionTask?.cancel()
    companionTask = Task { @MainActor [weak self] in
        await self?.companionLoop()
    }
}

func activateCallMode() {
    guard activeMode != .call else {
        deactivateMode()
        return
    }
    deactivateMode()
    activeMode = .call
    autoVoice = true
    voiceError = ""
}

func deactivateMode() {
    activeMode = .none
    autoVoice = false
    companionTask?.cancel()
    companionTask = nil
    recorder?.stop()
    recorder = nil
    audioPlayer?.stop()
    voiceRecording = false
    speaking = false
    agentState = .idle
    audioLevel = 0
    voiceError = ""
}
```

- [ ] **Step 3: Reemplazar `toggleCompanion` y `startCompanion`/`stopCompanion`**

```swift
// Eliminar: toggleCompanion(), startCompanion(), stopCompanion()
// Ya están reemplazados por activateAutoMode() / activateCallMode() / deactivateMode()
```

En `companionLoop()`, cambiar la guarda de `companionActive` por `activeMode == .auto`:

```swift
// Antes:
while companionActive && !Task.isCancelled {
// Después:
while activeMode == .auto && !Task.isCancelled {
```

Igual para la guarda de `recordWithVAD()`:

```swift
// Todas las ocurrencias de `companionActive` dentro de companionLoop y recordWithVAD:
// Antes: guard companionActive, !Task.isCancelled else { ... }
// Después: guard activeMode == .auto, !Task.isCancelled else { ... }
```

- [ ] **Step 4: Call Mode — voice send en 1:1**

Call mode usa `startVoiceRecording()` / `stopVoiceRecordingAndTranscribe()` que ya existen. La diferencia: al terminar la transcripción, envía automáticamente al chat y hace TTS. Agregar en `stopVoiceRecordingAndTranscribe()` al final, antes del `voiceProcessing = false` final:

```swift
// Al final de stopVoiceRecordingAndTranscribe(), después de chatInput = text:
if callModeActive, !text.isEmpty {
    await sendCurrentChat()
}
```

- [ ] **Step 5: Build**

```bash
xcodebuild -scheme Niki -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

Esperado: `** BUILD SUCCEEDED **`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: separate Auto Mode and Call Mode in NikiAppModel"
```

---

## Task 3: Mode Indicator en NikiShellView

**Files:**
- Create: `Sources/Desktop/Components/NikiModeIndicator.swift`
- Modify: `Sources/Desktop/Shell/NikiShellView.swift`

- [ ] **Step 1: Crear NikiModeIndicator.swift**

```swift
import SwiftUI

struct NikiModeIndicator: View {
    let mode: NikiActiveMode

    var body: some View {
        if mode != .none {
            HStack(spacing: 6) {
                Circle()
                    .fill(mode == .auto ? Color(red: 0.18, green: 0.86, blue: 0.56) : Color(red: 0.18, green: 0.46, blue: 1))
                    .frame(width: 7, height: 7)
                    .shadow(color: mode == .auto ? .green.opacity(0.8) : .blue.opacity(0.8), radius: 4)

                Text(mode == .auto ? "Auto" : "Call")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.85))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(
                Capsule()
                    .fill(Color.white.opacity(0.08))
                    .overlay(Capsule().stroke(Color.white.opacity(0.12), lineWidth: 1))
            )
            .transition(.scale(scale: 0.85).combined(with: .opacity))
        }
    }
}
```

- [ ] **Step 2: Agregar el indicador en NikiShellView**

En `NikiShellView.body`, dentro del `.overlay(alignment: .top)` existente, agregar el indicador debajo del `runtimeSummary`:

```swift
.overlay(alignment: .top) {
    VStack(spacing: 4) {
        Text(appModel.runtimeModelResolved.isEmpty ? "Niki" : appModel.runtimeModelResolved)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Color.white.opacity(0.48))
        Text(appModel.runtimeSummary)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(Color.white.opacity(0.72))
            .lineLimit(2)
        
        // NUEVO:
        withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
            NikiModeIndicator(mode: appModel.activeMode)
        }
    }
    .padding(.top, 18)
}
```

- [ ] **Step 3: Build**

```bash
xcodebuild -scheme Niki -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add NikiModeIndicator to desktop shell"
```

---

## Task 4: Dock buttons para Auto Mode y Call Mode

**Files:**
- Modify: `Sources/Desktop/Models/DockItem.swift`
- Modify: `Sources/Desktop/Components/NikiDockView.swift`

- [ ] **Step 1: Actualizar DockItem — quitar widgets, agregar auto y call**

```swift
enum DockItem: String, CaseIterable, Identifiable {
    case chat
    case auto
    case call
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .chat: return "Chat"
        case .auto: return "Auto Mode"
        case .call: return "Call Mode"
        case .settings: return "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .chat: return "message"
        case .auto: return "cpu"
        case .call: return "phone.fill"
        case .settings: return "gearshape.2"
        }
    }
}
```

- [ ] **Step 2: Actualizar NikiSidebarPanels switch para remover .widgets y .voice, agregar .auto y .call**

En `Sources/Desktop/Components/NikiSidebarPanels.swift`, en el switch:

```swift
switch selection {
case .chat:
    NikiChatSidebar()
case .auto:
    NikiVoicePanel()    // reusar panel de voz para Auto Mode
case .call:
    NikiVoicePanel()    // mismo panel, la diferencia está en appModel.activeMode
case .settings:
    NikiSettingsSidebar()
}
```

- [ ] **Step 3: Actualizar NikiDockView — botones de auto y call con colores de modo**

En `NikiDockView`, cambiar `private let items: [DockItem] = [.chat, .voice, .settings]` por:

```swift
private let items: [DockItem] = [.chat, .auto, .call, .settings]
```

Reemplazar el `Button` action que tenía el caso especial de `.voice` por:

```swift
Button {
    withAnimation(.spring(response: 0.32, dampingFraction: 0.78)) {
        switch item {
        case .auto:
            appModel.activateAutoMode()
        case .call:
            appModel.activateCallMode()
        default:
            selection = selection == item ? nil : item
        }
    }
} label: { ... }
```

Reemplazar la lógica de colores del ícono del `ZStack` en el label:

```swift
ZStack {
    if item == .auto, appModel.activeMode == .auto {
        Circle()
            .fill(Color(red: 0.18, green: 0.86, blue: 0.56).opacity(0.9))
            .overlay(Circle().strokeBorder(Color.white.opacity(0.14), lineWidth: 1))
    } else if item == .call, appModel.activeMode == .call {
        Circle()
            .fill(Color(red: 0.18, green: 0.46, blue: 1).opacity(0.95))
            .overlay(Circle().strokeBorder(Color.white.opacity(0.14), lineWidth: 1))
    } else if isActive(item) {
        Circle()
            .fill(Color.white.opacity(0.08))
            .overlay(Circle().strokeBorder(Color.white.opacity(0.06), lineWidth: 1))
            .matchedGeometryEffect(id: "dock-selection", in: selectionAnimation)
    }

    Image(systemName: item.symbol)
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(iconColor(for: item))
}
.frame(width: 38, height: 38)
.background(buttonBackground(for: item))
```

Actualizar `shouldShowSeparator`:

```swift
private func shouldShowSeparator(after item: DockItem) -> Bool {
    item == .call
}
```

Actualizar `iconColor(for:)` para los nuevos modos:

```swift
private func iconColor(for item: DockItem) -> Color {
    switch item {
    case .auto where appModel.activeMode == .auto:
        return .white
    case .call where appModel.activeMode == .call:
        return .white
    default:
        let active = isActive(item)
        let hovered = hoveredItem == item
        if active { return Color.white.opacity(0.9) }
        if hovered { return Color.white.opacity(0.8) }
        return Color.white.opacity(0.5)
    }
}
```

- [ ] **Step 4: Build final**

```bash
xcodebuild -scheme Niki -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

Esperado: `** BUILD SUCCEEDED **`

- [ ] **Step 5: Commit final**

```bash
git add -A
git commit -m "feat: Auto Mode and Call Mode dock buttons with mode indicator"
```

---

## Self-Review

**Spec coverage:**
- ✅ Quitar BoringNotch refs → Task 1
- ✅ Auto mode (agente corre solo) → Task 2 (`activateAutoMode` + `companionLoop`)
- ✅ Call mode (hablar 1:1) → Task 2 (`activateCallMode` + auto-send tras STT)
- ✅ Desktop UI de modos → Task 3 (NikiModeIndicator) + Task 4 (dock buttons)

**Gaps:** Ninguno. El `NikiVoicePanel` ya tiene UI de grabación y TTS, así que reutilizarlo para ambos modos es suficiente sin duplicar código.

**Riesgos:** 
- `companionActive` era `Bool`, ahora es computed var — verificar que no se use como `@Published` binding en ningún side-effect. Si hay `$companionActive` en algún lugar, reemplazar con `$activeMode`.
