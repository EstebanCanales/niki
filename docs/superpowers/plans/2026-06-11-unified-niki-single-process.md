# Unified Niki Single-Process Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer que el notch use NikiAppModel como única fuente de verdad — mismo chat, misma config, mismo proceso que el desktop.

**Architecture:** `NikiAppDelegate` guarda una referencia weak a `NikiAppModel`. Cada ventana del notch recibe `appModel` como `.environmentObject`. `NikiNotchContentView` pierde sus sistemas duplicados (HTTP client, AVAudioRecorder, config propia) y llama directamente a `appModel`. `NikiNotchFile` desaparece, reemplazado por `NikiChatAttachment` que ya existe en Shared.

**Tech Stack:** SwiftUI, AppKit, NikiAppModel (ya existente), NikiChatAttachment (ya existente)

---

## File Map

| Acción | Archivo |
|--------|---------|
| Modify | `Sources/App/NikiAppDelegate.swift` — add `weak var appModel`, inject into notch windows |
| Modify | `Sources/App/NikiApp.swift` — pass appModel to delegate |
| Modify | `Sources/Notch/NikiNotchContentView.swift` — remove duplicate systems, use appModel |
| Shell | Kill old NikiNotch process + delete `NikiNotch/.derived/` |

---

## Task 1: Wire NikiAppModel into NikiAppDelegate

**Files:**
- Modify: `Sources/App/NikiAppDelegate.swift`
- Modify: `Sources/App/NikiApp.swift`

- [ ] **Step 1: Add `appModel` property to NikiAppDelegate**

En `Sources/App/NikiAppDelegate.swift`, agregar justo después de `var window: NSWindow?`:

```swift
weak var appModel: NikiAppModel?
```

- [ ] **Step 2: Set appModel from NikiApp**

En `Sources/App/NikiApp.swift`, reemplazar el `.onAppear`:

```swift
// Antes:
.onAppear {
    appModel.connectAppDelegate(appDelegate)
    appDelegate.setupNotchWindows()
}

// Después:
.onAppear {
    appModel.connectAppDelegate(appDelegate)
    appDelegate.appModel = appModel
    appDelegate.setupNotchWindows()
}
```

- [ ] **Step 3: Inject appModel into NSHostingView for notch windows**

En `Sources/App/NikiAppDelegate.swift`, función `createNikiNotchWindow(for:with:)` (~línea 210), reemplazar el `NSHostingView`:

```swift
// Antes:
window.contentView = NSHostingView(
    rootView: NikiNotchContentView()
        .environmentObject(viewModel)
)

// Después:
let appModelRef = appModel
window.contentView = NSHostingView(
    rootView: NikiNotchContentView()
        .environmentObject(viewModel)
        .environmentObject(appModelRef ?? NikiAppModel())
)
```

- [ ] **Step 4: Build para verificar que compila**

```bash
cd /Users/estebancanales/Work/agente/app/Niki
xcodebuild -scheme Niki -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

Esperado: `** BUILD SUCCEEDED **`

- [ ] **Step 5: Commit**

```bash
git add Sources/App/NikiAppDelegate.swift Sources/App/NikiApp.swift
git commit -m "feat: wire NikiAppModel into notch window environmentObject"
```

---

## Task 2: Eliminar structs duplicados de NikiNotchContentView

**Files:**
- Modify: `Sources/Notch/NikiNotchContentView.swift`

- [ ] **Step 1: Eliminar los 5 private structs duplicados del top del archivo**

Eliminar líneas 13–48 completas (los structs `NikiNotchRequest`, `NikiNotchBackendConfig`, `NikiNotchResponsePayload`, `NikiNotchVoiceTranscriptionResponse`, `NikiNotchFile`):

```swift
// Eliminar todo este bloque:
private struct NikiNotchRequest: Codable { ... }
private struct NikiNotchBackendConfig: Codable { ... }
private struct NikiNotchResponsePayload: Codable { ... }
private struct NikiNotchVoiceTranscriptionResponse: Codable { ... }
private struct NikiNotchFile: Codable, Hashable, Identifiable { ... }
```

- [ ] **Step 2: Agregar `@EnvironmentObject var appModel: NikiAppModel` y limpiar @State duplicados**

En `NikiNotchContentView`, reemplazar el bloque de properties:

```swift
// Antes:
@EnvironmentObject var vm: NikiNotchViewModel
@ObservedObject private var coordinator = NikiNotchCoordinator.shared
@Namespace private var albumArtNamespace
@FocusState private var promptFocused: Bool
@State private var hoverTask: Task<Void, Never>?
@State private var isHovering = false
@State private var prompt = ""
@State private var submitState = "Ready"
@State private var droppedFiles: [NikiNotchFile] = []
@State private var activeResponseText = ""
@State private var activeResponseState = ""
@State private var activeResponseUpdatedAt = ""
@State private var voiceRecorder: AVAudioRecorder?
@State private var voiceRecordingURL: URL?
@State private var isVoiceRecording = false
@State private var isVoiceProcessing = false

// Después:
@EnvironmentObject var vm: NikiNotchViewModel
@EnvironmentObject var appModel: NikiAppModel
@ObservedObject private var coordinator = NikiNotchCoordinator.shared
@Namespace private var albumArtNamespace
@FocusState private var promptFocused: Bool
@State private var hoverTask: Task<Void, Never>?
@State private var isHovering = false
@State private var prompt = ""
```

- [ ] **Step 3: Reemplazar `hasActiveResponse` y `missionStateLabel` por versiones basadas en appModel**

```swift
// Antes:
private var hasActiveResponse: Bool {
    !activeResponseText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
}

// Eliminar hasActiveResponse por completo.

// Reemplazar missionStateLabel:
// Antes (aprox líneas 88-101):
private var missionStateLabel: String {
    if activeResponseState == "streaming" { return "Streaming" }
    if submitState == "Sent" { return "Sent" }
    ...
    return "Ready"
}

// Después:
private var missionStateLabel: String {
    if appModel.voiceRecording { return "Listening" }
    if appModel.voiceProcessing { return "Transcribing" }
    if appModel.chatBusy { return "Thinking" }
    if !appModel.voiceError.isEmpty { return "Error" }
    return "Ready"
}
```

- [ ] **Step 4: Build para verificar errores restantes**

```bash
xcodebuild -scheme Niki -configuration Debug build 2>&1 | grep "error:" | head -20
```

Esperado: errores sobre `droppedFiles`, `isVoiceRecording`, `activeResponseText`, etc. — eso es normal en este paso. Continuar al siguiente.

---

## Task 3: Rewire body y funciones de NikiNotchContentView

**Files:**
- Modify: `Sources/Notch/NikiNotchContentView.swift`

- [ ] **Step 1: Actualizar el body — eliminar ActiveResponsePanel y simplificar referencias**

Reemplazar el bloque `if vm.notchState == .open` del body:

```swift
// Antes (líneas 115-152):
if vm.notchState == .open {
    VStack(spacing: 9) {
        NotchTopBar(
            state: missionStateLabel,
            fileCount: droppedFiles.count,
            hasResponse: hasActiveResponse,
            voiceActive: isVoiceRecording || isVoiceProcessing
        )

        if hasActiveResponse {
            ActiveResponsePanel(
                text: activeResponseText,
                state: activeResponseState
            )
        }

        tabContent
            .frame(...)
    }
    ...
} else {
    ClosedNotchHandle(
        state: missionStateLabel,
        voiceActive: isVoiceRecording || isVoiceProcessing,
        hasResponse: hasActiveResponse
    )
    ...
}

// Después:
if vm.notchState == .open {
    VStack(spacing: 9) {
        NotchTopBar(
            state: missionStateLabel,
            fileCount: appModel.chatAttachments.count,
            voiceActive: appModel.voiceRecording || appModel.voiceProcessing
        )

        tabContent
            .frame(
                maxWidth: .infinity,
                minHeight: tabContentHeight,
                maxHeight: tabContentHeight,
                alignment: .top
            )
    }
    .padding(.top, 10)
    .padding(.horizontal, 18)
    .padding(.bottom, 10)
    .frame(maxWidth: .infinity, alignment: .top)
    .transition(.opacity.combined(with: .scale(scale: 0.96)))
} else {
    ClosedNotchHandle(
        state: missionStateLabel,
        voiceActive: appModel.voiceRecording || appModel.voiceProcessing
    )
    .padding(.top, 8)
    .transition(.opacity)
}
```

- [ ] **Step 2: Eliminar el `.task { refreshIncomingResponse }` del body**

```swift
// Eliminar estas líneas del body:
.task {
    while !Task.isCancelled {
        await refreshIncomingResponse()
        try? await Task.sleep(for: .milliseconds(350))
    }
}
```

- [ ] **Step 3: Actualizar `tabContent` — reemplazar ChatControls con appModel**

```swift
// Antes (case .home):
case .home:
    HStack(alignment: .top, spacing: 16) {
        OrbPanel()
            .frame(width: 110, height: 154)

        ChatControls(
            prompt: $prompt,
            submitState: submitState,
            droppedFiles: $droppedFiles,
            voiceRecording: isVoiceRecording,
            voiceProcessing: isVoiceProcessing,
            promptFocused: _promptFocused,
            onSubmit: submitPrompt,
            onVoice: {
                Task { await toggleVoiceDictation() }
            },
            onShowUtils: {
                coordinator.currentView = .utils
            },
            onShowShelf: {
                coordinator.currentView = .shelf
            },
            onClear: {
                prompt = ""
                droppedFiles = []
                activeResponseText = ""
                activeResponseState = ""
                activeResponseUpdatedAt = ""
                submitState = "Ready"
            }
        )
        .frame(maxWidth: .infinity, minHeight: tabContentHeight, maxHeight: tabContentHeight, alignment: .top)
    }
    .frame(maxHeight: .infinity, alignment: .top)

// Después:
case .home:
    HStack(alignment: .top, spacing: 16) {
        OrbPanel()
            .frame(width: 110, height: 154)

        ChatControls(
            prompt: $prompt,
            submitState: missionStateLabel,
            droppedFiles: appModel.chatAttachments,
            voiceRecording: appModel.voiceRecording,
            voiceProcessing: appModel.voiceProcessing,
            promptFocused: _promptFocused,
            onSubmit: submitPrompt,
            onVoice: { toggleVoiceDictation() },
            onShowUtils: { coordinator.currentView = .utils },
            onShowShelf: { coordinator.currentView = .shelf },
            onClear: {
                prompt = ""
                appModel.chatAttachments = []
            }
        )
        .frame(maxWidth: .infinity, minHeight: tabContentHeight, maxHeight: tabContentHeight, alignment: .top)
    }
    .frame(maxHeight: .infinity, alignment: .top)
```

- [ ] **Step 4: Reemplazar funciones de submit y voz**

Reemplazar `submitPrompt()`, eliminar `activateNiki()`, `notchRequestPath()`, `notchConfigPath()`, `notchResponsePath()`, `loadBackendConfig()`, `postDebugRequest()`, `refreshIncomingResponse()`, `toggleVoiceDictation()`, `startVoiceDictation()`, `stopVoiceDictationAndTranscribe()`, `transcribeNotchAudio()`:

```swift
private func submitPrompt() {
    let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty || !appModel.chatAttachments.isEmpty else { return }
    appModel.chatInput = text
    prompt = ""
    Task { await appModel.sendCurrentChat() }
}

private func toggleVoiceDictation() {
    if appModel.voiceRecording {
        Task { await appModel.stopVoiceRecordingAndTranscribe() }
    } else {
        Task { await appModel.startVoiceRecording() }
    }
}
```

- [ ] **Step 5: Actualizar `NotchTopBar` — quitar `hasResponse`**

Reemplazar la struct `NotchTopBar` (~línea 579):

```swift
private struct NotchTopBar: View {
    let state: String
    let fileCount: Int
    let voiceActive: Bool

    var body: some View {
        HStack(spacing: 12) {
            TabSelectionView()
                .frame(maxWidth: .infinity, alignment: .leading)

            Spacer(minLength: 8)

            HStack(spacing: 6) {
                if fileCount > 0 {
                    NikiStatusPill(icon: "paperclip", label: "\(fileCount)", tint: Color.white.opacity(0.80))
                }

                NikiStatusPill(
                    icon: voiceActive ? "waveform" : "circle.hexagongrid.fill",
                    label: state,
                    tint: statusTint
                )
            }
        }
        .frame(height: 28)
    }

    private var statusTint: Color {
        if voiceActive { return Color(red: 0.46, green: 0.88, blue: 1) }
        if state == "Thinking" { return Color(red: 0.58, green: 0.77, blue: 1) }
        if state == "Error" { return Color(red: 1, green: 0.42, blue: 0.42) }
        return Color.white.opacity(0.74)
    }
}
```

- [ ] **Step 6: Actualizar `ClosedNotchHandle` — quitar `hasResponse`**

```swift
private struct ClosedNotchHandle: View {
    let state: String
    let voiceActive: Bool

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(indicatorColor)
                .frame(width: 6, height: 6)
                .shadow(color: indicatorColor.opacity(0.8), radius: 8)

            Capsule()
                .fill(Color.white.opacity(0.16))
                .frame(width: 84, height: 6)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Color.white.opacity(0.035), in: Capsule())
        .overlay(Capsule().stroke(Color.white.opacity(0.08), lineWidth: 1))
    }

    private var indicatorColor: Color {
        if voiceActive { return Color(red: 0.46, green: 0.88, blue: 1) }
        return Color.white.opacity(0.56)
    }
}
```

- [ ] **Step 7: Actualizar `ActiveResponsePanel` — ya no se usa, eliminar**

Eliminar la struct `ActiveResponsePanel` completa (~líneas 642–692).

- [ ] **Step 8: Actualizar `ChatControls` — cambiar tipos y drop handler**

Reemplazar la signature de `ChatControls` y sus propiedades:

```swift
private struct ChatControls: View {
    @Binding var prompt: String
    let submitState: String
    let droppedFiles: [NikiChatAttachment]   // era [NikiNotchFile]
    let voiceRecording: Bool
    let voiceProcessing: Bool
    @FocusState var promptFocused: Bool
    @State private var dropTargeted = false
    let onSubmit: () -> Void
    let onVoice: () -> Void
    let onShowUtils: () -> Void
    let onShowShelf: () -> Void
    let onClear: () -> Void
    var onDropFiles: (([NSItemProvider]) -> Void)?
    ...
```

En el `.onDrop` del body de `ChatControls`, reemplazar la llamada:

```swift
.onDrop(
    of: [.fileURL, .url],
    isTargeted: $dropTargeted
) { providers in
    onDropFiles?(providers)
    return true
}
```

Eliminar `attachProviders(_:)` y `appendDroppedItem(_:)` de `ChatControls`.

En la llamada a `ChatControls` desde `tabContent`, agregar el closure:

```swift
onDropFiles: { providers in
    attachProviders(providers)
}
```

- [ ] **Step 9: Mover `attachProviders` y `appendDroppedItem` a `NikiNotchContentView`, usando appModel**

```swift
private func attachProviders(_ providers: [NSItemProvider]) {
    for provider in providers {
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
                appendDroppedItem(item)
            }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
                appendDroppedItem(item)
            }
        }
    }
}

private func appendDroppedItem(_ item: NSSecureCoding?) {
    let url: URL?
    if let u = item as? URL { url = u }
    else if let data = item as? Data, let raw = String(data: data, encoding: .utf8) {
        url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines))
    }
    else if let raw = item as? String {
        url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines))
    }
    else { url = nil }

    guard let url else { return }
    DispatchQueue.main.async {
        appModel.appendAttachment(url: url)
    }
}
```

- [ ] **Step 10: Actualizar `attachedFilesRow` en `ChatControls` para usar `NikiChatAttachment`**

En `ChatControls`, el `attachedFilesRow` iteraba sobre `droppedFiles` usando `.name` y `.kind`. `NikiChatAttachment` tiene los mismos campos (`name`, `kind`, `path`), así que solo cambia el tipo. Verificar que no haya referencias a `.id` como `"\(kind):\(path):\(name)"` — si las hay, cambiar por `attachment.id` (que en `NikiChatAttachment` es un UUID string).

- [ ] **Step 11: Build final**

```bash
xcodebuild -scheme Niki -configuration Debug build 2>&1 | grep -E "error:|BUILD"
```

Esperado: `** BUILD SUCCEEDED **`

- [ ] **Step 12: Commit**

```bash
git add Sources/Notch/NikiNotchContentView.swift
git commit -m "feat: unify NikiNotchContentView with NikiAppModel — remove duplicate HTTP/voice/config"
```

---

## Task 4: Matar proceso viejo y limpiar

**Files:**
- Shell commands

- [ ] **Step 1: Matar el proceso viejo NikiNotch.app**

```bash
pkill -f "NikiNotch.app/Contents/MacOS/NikiNotch" 2>/dev/null; echo "killed"
ps aux | grep -i NikiNotch | grep -v grep
```

Esperado: sin output (proceso muerto).

- [ ] **Step 2: Borrar el directorio `.derived` del proyecto viejo**

```bash
rm -rf /Users/estebancanales/Work/agente/NikiNotch/.derived
echo "deleted"
```

- [ ] **Step 3: Verificar que solo corre un proceso Niki**

Lanzar la app y verificar:

```bash
open /Users/estebancanales/Library/Developer/Xcode/DerivedData/Niki-hkszpwporuqgfdfnxixnalxwuglt/Build/Products/Debug/Niki.app
sleep 3
ps aux | grep -E "Niki.app|NikiNotch" | grep -v grep
```

Esperado: exactamente una línea con `Niki.app/Contents/MacOS/Niki`.

- [ ] **Step 4: Commit final**

```bash
git add -A
git commit -m "chore: kill old NikiNotch process and delete derived artifacts"
```

---

## Self-Review

**Spec coverage:**
- ✅ Un solo proceso → Task 4
- ✅ NikiAppModel como fuente de verdad → Tasks 1, 2, 3
- ✅ Notch input → chat activo del desktop → Task 3, Step 4 (`submitPrompt` usa `appModel.sendCurrentChat`)
- ✅ Shelf → `appModel.appendAttachment` → Task 3, Steps 8-9
- ✅ Config compartida → automático al usar `appModel.backendBaseURL` etc.
- ✅ Voz desde notch → Task 3, Step 4 (`toggleVoiceDictation` usa `appModel`)
- ✅ Sin respuesta mostrada en notch → Task 3, Step 1 (eliminado `ActiveResponsePanel`)
- ✅ `NikiNotchFile` eliminado → Tasks 2, 3

**Riesgos:**
- `ChatControls.attachedFilesRow` usa `.name` y `.kind` — `NikiChatAttachment` tiene los mismos campos, migración directa
- `appModel ?? NikiAppModel()` en Task 1 Step 3 es el fallback de seguridad si `appModel` es nil al crear la ventana; en práctica nunca ocurre porque `connectAppDelegate` y `appDelegate.appModel` se set en `.onAppear`
