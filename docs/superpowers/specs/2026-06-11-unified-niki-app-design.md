# Unified Niki App Design

**Date:** 2026-06-11  
**Status:** Approved

## Goal

Eliminate the duplicate NikiNotch process and state systems. Make the notch a thin UI over `NikiAppModel` — the same single source of truth the desktop uses. One binary, one process, one config.

---

## Problem Statement

Currently `NikiNotchContentView` contains its own:
- HTTP client + Codable structs (`NikiNotchBackendConfig`, `NikiNotchRequest`, `NikiNotchResponsePayload`)
- `AVAudioRecorder` for voice
- Chat prompt state independent from NikiAppModel
- Config read from a separate UserDefaults key

Additionally, the old `NikiNotch.app` (from `NikiNotch/.derived/`) runs as a separate process (PID ~86325) and should be permanently killed/removed.

---

## Architecture

```
NikiApp (@main)
├── NikiAppModel (@StateObject)  ← single source of truth
├── WindowGroup "Niki"           ← desktop (already has appModel via env)
└── NikiAppDelegate
    └── NikiNotchWindow(s)
        └── NikiNotchContentView
              .environmentObject(appModel)   ← NEW
```

### Key wiring

1. `NikiAppDelegate` gains `weak var appModel: NikiAppModel?`
2. `NikiApp.connectAppDelegate(_:)` also calls `delegate.appModel = self` (via a new setter)
3. Every `createNikiNotchWindow(for:with:)` call injects `.environmentObject(appModel)` into the `NSHostingView`

---

## Notch Sections

### 1. Chat Input (primary)

- Text field bound to `appModel.chatInput`
- Send button calls `appModel.sendCurrentChat()`
- **No response shown in notch** — response lives in desktop chat sidebar
- Mode indicator: `NikiModeIndicator(mode: appModel.activeMode)` shown when active
- Agent state dot: reflects `appModel.agentState` (thinking/listening/speaking)

### 2. Music + Calendar

- `MusicManager` stays unchanged — it's already independent of NikiAppModel
- Calendar widget reads system calendar directly — no NikiAppModel dependency
- These sections are unchanged architecturally

### 3. Shelf

- Drag & drop files onto shelf → `appModel.appendAttachment(url: url)`
- Attached files appear in the desktop composer as pending attachments
- AirDrop via `NSSharingService` remains independent (no NikiAppModel needed)

### 4. Voice in notch

- Microphone button visible only when `appModel.activeMode == .call`
- Calls `appModel.startVoiceRecording()` / `appModel.stopVoiceRecordingAndTranscribe()`
- Same recorder, same STT, same TTS pipeline as desktop — zero duplication

---

## Config

`NikiAppModel` persists all config in `UserDefaults` key `niki.native.config`. The notch reads `appModel.backendBaseURL`, `appModel.backendAPIKey`, `appModel.accessToken` etc. directly — no separate config struct or second UserDefaults key needed.

**Deleted from notch:**
- `NikiNotchBackendConfig`
- `NikiNotchRequest`
- `NikiNotchResponsePayload`
- `NikiNotchVoiceTranscriptionResponse`
- `NikiNotchFile` (replaced by `NikiChatAttachment` from Shared models)
- All `URLSession` calls inside `NikiNotchContentView`
- All `AVAudioRecorder` state inside `NikiNotchContentView`

---

## Process Cleanup

1. Kill PID of old `NikiNotch.app` on startup (guard in `NikiAppDelegate.applicationDidFinishLaunching`)
2. The `NikiNotch/` project directory is not compiled — it's outside `app/Niki/` and has no target in `project.yml`
3. `NikiNotch/.derived/` can be deleted to free disk space and prevent accidental launches

---

## File Changes

| Action | File |
|--------|------|
| Modify | `Sources/App/NikiAppDelegate.swift` — add `appModel` property, inject into notch windows |
| Modify | `Sources/App/NikiApp.swift` — pass `appModel` to delegate |
| Modify | `Sources/Notch/NikiNotchContentView.swift` — remove duplicate systems, use appModel |
| Delete | `NikiNotch/.derived/` directory |

---

## What Stays Unchanged

- `NikiNotchViewModel` — controls open/close animation, notch sizing, drag detection
- `NikiNotchCoordinator` — screen selection, multi-display logic
- `MusicManager` — media playback, independent
- All notch animations, hover detection, sizing logic
- All desktop views (NikiShellView, NikiDockView, NikiChatSidebar, etc.)

---

## Success Criteria

- `ps aux | grep Niki` shows exactly one process
- Typing in the notch prompt and sending appears in the active desktop chat session
- Dragging a file onto the notch shelf adds it to `appModel.chatAttachments` (visible in desktop composer)
- Config changes in desktop Settings are reflected immediately in notch behavior
- No `NikiNotchBackendConfig` or duplicate HTTP calls in notch code
