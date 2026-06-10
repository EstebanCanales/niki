//
//  ContentView.swift
//  boringNotchApp
//

import AppKit
import AVFoundation
import Foundation
import Defaults
import SwiftUI
import UniformTypeIdentifiers

private struct NikiNotchRequest: Codable {
    let text: String
    let files: [NikiNotchFile]
    let createdAt: String
}

private struct NikiNotchBackendConfig: Codable {
    let baseUrl: String
    let apiKey: String
    let userId: String
}

private struct NikiNotchResponsePayload: Codable {
    let text: String
    let state: String
    let sessionId: String
    let updatedAt: String
}

private struct NikiNotchVoiceTranscriptionResponse: Codable {
    let ok: Bool
    let text: String?
    let error: String?
    let language: String?
    let duration: Int?
}

private struct NikiNotchFile: Codable, Hashable, Identifiable {
    let name: String
    let path: String
    let kind: String

    var id: String {
        "\(kind):\(path):\(name)"
    }
}

@MainActor
struct ContentView: View {
    @EnvironmentObject var vm: BoringViewModel
    @ObservedObject private var coordinator = BoringViewCoordinator.shared
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

    private let openAnimation = Animation.spring(response: 0.42, dampingFraction: 0.82, blendDuration: 0)
    private let closeAnimation = Animation.spring(response: 0.45, dampingFraction: 1.0, blendDuration: 0)

    private var hasActiveResponse: Bool {
        !activeResponseText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var tabContentHeight: CGFloat {
        switch coordinator.currentView {
        case .home:
            return 186
        case .utils:
            return 176
        case .shelf:
            return 186
        }
    }

    private var openSurfaceHeight: CGFloat {
        let baseHeight: CGFloat = coordinator.currentView == .utils ? 258 : 270
        return hasActiveResponse ? openNotchSize.height : baseHeight
    }

    private var missionStateLabel: String {
        if isVoiceProcessing { return "Transcribing" }
        if isVoiceRecording { return "Listening" }
        if activeResponseState == "streaming" { return "Streaming" }
        if submitState == "Sent" { return "Sent" }
        if submitState == "Error" || submitState == "Voice error" || submitState == "Mic denied" {
            return submitState
        }
        return "Ready"
    }

    private var currentNotchShape: NotchShape {
        NotchShape(
            topCornerRadius: vm.notchState == .open ? cornerRadiusInsets.opened.top : cornerRadiusInsets.closed.top,
            bottomCornerRadius: vm.notchState == .open ? cornerRadiusInsets.opened.bottom : cornerRadiusInsets.closed.bottom
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .top) {
                notchBackground

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
                        voiceActive: isVoiceRecording || isVoiceProcessing,
                        hasResponse: hasActiveResponse
                    )
                    .padding(.top, 8)
                    .transition(.opacity)
                }
            }
            .frame(
                width: vm.notchState == .open ? openNotchSize.width : vm.closedNotchSize.width,
                height: vm.notchState == .open ? openSurfaceHeight : max(vm.closedNotchSize.height, 28)
            )
            .clipShape(currentNotchShape)
            .shadow(color: .black.opacity(0.66), radius: 18, y: 10)
            .contentShape(Rectangle())
            .onHover { hovering in
                handleHover(hovering)
            }
            .animation(vm.notchState == .open ? openAnimation : closeAnimation, value: vm.notchState)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 8)
        .frame(maxWidth: windowSize.width, maxHeight: windowSize.height, alignment: .top)
        .preferredColorScheme(.dark)
        .environmentObject(vm)
        .onAppear {
            notchDebugLog("content appeared")
        }
        .task {
            while !Task.isCancelled {
                await refreshIncomingResponse()
                try? await Task.sleep(for: .milliseconds(350))
            }
        }
    }

    private var notchBackground: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color.black,
                    Color(red: 0.006, green: 0.006, blue: 0.007),
                    Color.black
                ],
                startPoint: .top,
                endPoint: .bottom
            )

            RadialGradient(
                colors: [
                    Color.white.opacity(0.028),
                    Color.clear
                ],
                center: .top,
                startRadius: 6,
                endRadius: 220
            )
        }
    }

    @ViewBuilder
    private var tabContent: some View {
        switch coordinator.currentView {
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
        case .utils:
            HStack(alignment: .top, spacing: 18) {
                MusicPlayerView(albumArtNamespace: albumArtNamespace)
                    .frame(maxWidth: .infinity, alignment: .leading)

                CalendarCard()
                    .frame(width: 236)
                    .frame(minHeight: 156)
            }
        case .shelf:
            ShelfView()
                .environmentObject(vm)
                .frame(maxWidth: .infinity, minHeight: 168, alignment: .top)
        }
    }

    private func submitPrompt() {
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty || !droppedFiles.isEmpty else { return }
        notchDebugLog("submit requested textChars=\(text.count) files=\(droppedFiles.count)")

        do {
            let path = try notchRequestPath()
            try FileManager.default.createDirectory(
                at: path.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let request = NikiNotchRequest(
                text: text,
                files: droppedFiles,
                createdAt: ISO8601DateFormatter().string(from: Date())
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let data = try encoder.encode(request)
            try data.write(to: path, options: .atomic)
            notchDebugLog("wrote request path=\(path.path) bytes=\(data.count)")
            Task {
                await postDebugRequest(request)
            }
            activeResponseText = ""
            activeResponseState = ""
            activeResponseUpdatedAt = ""
            prompt = ""
            droppedFiles = []
            submitState = "Sent"
            activateNiki()

            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(1200))
                submitState = "Ready"
            }
        } catch {
            notchDebugLog("submit error \(error.localizedDescription)")
            submitState = "Error"
        }
    }

    private func activateNiki() {
        if let app = NSRunningApplication.runningApplications(withBundleIdentifier: "com.niki.desktop").first {
            app.activate(options: [.activateAllWindows])
        }
    }

    private func notchRequestPath() throws -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".niki/notch-request.json")
    }

    private func notchConfigPath() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".niki/notch-config.json")
    }

    private func notchResponsePath() -> URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".niki/notch-response.json")
    }

    private func loadBackendConfig() -> NikiNotchBackendConfig {
        let fallback = NikiNotchBackendConfig(
            baseUrl: "http://127.0.0.1:8000",
            apiKey: "",
            userId: "user-demo"
        )

        do {
            let data = try Data(contentsOf: notchConfigPath())
            let decoded = try JSONDecoder().decode(NikiNotchBackendConfig.self, from: data)
            let normalizedBaseUrl = decoded.baseUrl.trimmingCharacters(in: .whitespacesAndNewlines)
            let normalizedUserId = decoded.userId.trimmingCharacters(in: .whitespacesAndNewlines)
            notchDebugLog("loaded backend config baseUrl=\(normalizedBaseUrl) apiKeyChars=\(decoded.apiKey.count) userId=\(normalizedUserId)")
            return NikiNotchBackendConfig(
                baseUrl: normalizedBaseUrl.isEmpty ? fallback.baseUrl : normalizedBaseUrl,
                apiKey: decoded.apiKey,
                userId: normalizedUserId.isEmpty ? fallback.userId : normalizedUserId
            )
        } catch {
            notchDebugLog("backend config fallback \(error.localizedDescription)")
            return fallback
        }
    }

    private func postDebugRequest(_ request: NikiNotchRequest) async {
        let config = loadBackendConfig()
        let baseUrl = config.baseUrl.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        guard let url = URL(string: "\(baseUrl)/notch/debug") else {
            notchDebugLog("debug post invalid url baseUrl=\(config.baseUrl)")
            return
        }

        do {
            var urlRequest = URLRequest(url: url)
            urlRequest.httpMethod = "POST"
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if !config.apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                urlRequest.setValue(config.apiKey, forHTTPHeaderField: "x-niki-api-key")
            }
            if !config.userId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                urlRequest.setValue(config.userId, forHTTPHeaderField: "x-niki-user-id")
            }
            let data = try JSONEncoder().encode(request)
            urlRequest.httpBody = data
            notchDebugLog("posting debug request url=\(url.absoluteString) textChars=\(request.text.count) files=\(request.files.count) userId=\(config.userId)")
            let (responseData, response) = try await URLSession.shared.data(for: urlRequest)
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            let body = String(data: responseData, encoding: .utf8) ?? ""
            notchDebugLog("debug response status=\(status) body=\(String(body.prefix(220)))")
        } catch {
            notchDebugLog("debug post error \(error.localizedDescription)")
        }
    }

    private func toggleVoiceDictation() async {
        if isVoiceProcessing { return }
        if isVoiceRecording {
            await stopVoiceDictationAndTranscribe()
        } else {
            await startVoiceDictation()
        }
    }

    private func startVoiceDictation() async {
        notchDebugLog("voice dictation start requested")
        let granted = await AVCaptureDevice.requestAccess(for: .audio)
        guard granted else {
            submitState = "Mic denied"
            notchDebugLog("voice dictation microphone denied")
            return
        }

        do {
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("niki-notch-\(UUID().uuidString).wav")
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatLinearPCM),
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsFloatKey: false
            ]
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.prepareToRecord()
            recorder.record()
            voiceRecorder = recorder
            voiceRecordingURL = url
            isVoiceRecording = true
            submitState = "Listening"
            notchDebugLog("voice dictation recording url=\(url.path)")
        } catch {
            submitState = "Voice error"
            notchDebugLog("voice dictation start error \(error.localizedDescription)")
        }
    }

    private func stopVoiceDictationAndTranscribe() async {
        notchDebugLog("voice dictation stop requested")
        voiceRecorder?.stop()
        voiceRecorder = nil
        isVoiceRecording = false
        isVoiceProcessing = true
        submitState = "Transcribing"
        try? await Task.sleep(for: .milliseconds(220))

        defer {
            isVoiceProcessing = false
        }

        guard let url = voiceRecordingURL else {
            submitState = "Ready"
            notchDebugLog("voice dictation missing file")
            return
        }

        do {
            let data = try Data(contentsOf: url)
            let response = try await transcribeNotchAudio(data)
            try? FileManager.default.removeItem(at: url)
            voiceRecordingURL = nil

            guard response.ok,
                  let text = response.text?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !text.isEmpty else {
                submitState = "Voice error"
                notchDebugLog("voice dictation failed \(response.error ?? "empty transcript")")
                return
            }

            if prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                prompt = text
            } else {
                prompt += " \(text)"
            }
            submitState = "Ready"
            promptFocused = true
            notchDebugLog("voice dictation transcript chars=\(text.count)")
        } catch {
            submitState = "Voice error"
            notchDebugLog("voice dictation transcribe error \(error.localizedDescription)")
        }
    }

    private func transcribeNotchAudio(_ data: Data) async throws -> NikiNotchVoiceTranscriptionResponse {
        let config = loadBackendConfig()
        let baseUrl = config.baseUrl.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
        guard let url = URL(string: "\(baseUrl)/voice/transcribe") else {
            throw URLError(.badURL)
        }

        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.timeoutInterval = 120
        let boundary = "NikiNotchBoundary-\(UUID().uuidString)"
        urlRequest.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if !config.apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            urlRequest.setValue(config.apiKey, forHTTPHeaderField: "x-niki-api-key")
        }
        if !config.userId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            urlRequest.setValue(config.userId, forHTTPHeaderField: "x-niki-user-id")
        }
        var body = Data()
        body.appendMultipartField(name: "language", value: "es", boundary: boundary)
        body.appendMultipartFile(
            name: "audio",
            filename: "niki-notch.wav",
            mimeType: "audio/wav",
            data: data,
            boundary: boundary
        )
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        urlRequest.httpBody = body

        notchDebugLog("voice transcribe post bytes=\(data.count) url=\(url.absoluteString)")
        let (responseData, response) = try await URLSession.shared.data(for: urlRequest)
        let status = (response as? HTTPURLResponse)?.statusCode ?? -1
        notchDebugLog("voice transcribe response status=\(status)")
        guard (200 ..< 300).contains(status) else {
            let body = String(data: responseData, encoding: .utf8) ?? ""
            throw NSError(domain: "NikiNotchVoice", code: status, userInfo: [NSLocalizedDescriptionKey: body])
        }
        return try JSONDecoder().decode(NikiNotchVoiceTranscriptionResponse.self, from: responseData)
    }

    private func refreshIncomingResponse() async {
        let path = notchResponsePath()
        guard FileManager.default.fileExists(atPath: path.path) else { return }

        do {
            let data = try Data(contentsOf: path)
            let payload = try JSONDecoder().decode(NikiNotchResponsePayload.self, from: data)
            guard payload.updatedAt != activeResponseUpdatedAt else { return }
            activeResponseUpdatedAt = payload.updatedAt
            activeResponseText = payload.text
            activeResponseState = payload.state
            notchDebugLog("response refreshed state=\(payload.state) chars=\(payload.text.count)")
            if !payload.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                vm.open()
            }
        } catch {
            notchDebugLog("response refresh error \(error.localizedDescription)")
        }
    }

    private func handleHover(_ hovering: Bool) {
        isHovering = hovering
        hoverTask?.cancel()

        if hovering {
            notchDebugLog("hover open")
            vm.open()
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(90))
                promptFocused = true
            }
        } else {
            hoverTask = Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(120))
                guard !Task.isCancelled, !isHovering else { return }
                notchDebugLog("hover close")
                promptFocused = false
                vm.close()
            }
        }
    }
}

private struct ClosedNotchHandle: View {
    let state: String
    let voiceActive: Bool
    let hasResponse: Bool

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(indicatorColor)
                .frame(width: 6, height: 6)
                .shadow(color: indicatorColor.opacity(0.8), radius: 8)

            Capsule()
                .fill(Color.white.opacity(0.16))
                .frame(width: hasResponse ? 116 : 84, height: 6)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(Color.white.opacity(0.035), in: Capsule())
        .overlay(Capsule().stroke(Color.white.opacity(0.08), lineWidth: 1))
    }

    private var indicatorColor: Color {
        if voiceActive { return Color(red: 0.46, green: 0.88, blue: 1) }
        if state == "Streaming" || hasResponse { return Color(red: 0.68, green: 0.82, blue: 1) }
        return Color.white.opacity(0.56)
    }
}

private struct NotchTopBar: View {
    let state: String
    let fileCount: Int
    let hasResponse: Bool
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

                if hasResponse {
                    NikiStatusPill(icon: "text.bubble.fill", label: "Reply", tint: Color(red: 0.58, green: 0.77, blue: 1))
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
        if state == "Streaming" { return Color(red: 0.58, green: 0.77, blue: 1) }
        if state == "Error" || state == "Voice error" || state == "Mic denied" {
            return Color(red: 1, green: 0.42, blue: 0.42)
        }
        return Color.white.opacity(0.74)
    }
}

private struct NikiStatusPill: View {
    let icon: String
    let label: String
    let tint: Color

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .bold))
            Text(label)
                .font(.system(size: 10, weight: .semibold, design: .rounded))
        }
        .foregroundStyle(tint)
        .lineLimit(1)
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(Color.white.opacity(0.055), in: Capsule())
        .overlay(Capsule().stroke(tint.opacity(0.18), lineWidth: 1))
    }
}

private struct ActiveResponsePanel: View {
    let text: String
    let state: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle()
                    .fill(Color(red: 0.48, green: 0.74, blue: 1).opacity(0.13))
                    .frame(width: 34, height: 34)

                Image(systemName: state == "streaming" ? "ellipsis.message.fill" : "checkmark.message.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.78))
            }

            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Text(state == "streaming" ? "Writing" : "Reply ready")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(Color.white.opacity(0.52))

                    if state == "streaming" {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white.opacity(0.42)))
                            .scaleEffect(0.58)
                    }
                }

                Text(text)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.84))
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 18)
                .fill(Color.white.opacity(0.04))
                .overlay(
                    RoundedRectangle(cornerRadius: 18)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
        )
    }
}

private struct NotchOrbDot {
    let x: Double
    let y: Double
    let z: Double
    let lon: Double
    let lat: Double
    let seed: Double
    let seed2: Double
}

private struct NotchRenderedDot {
    let x: CGFloat
    let y: CGFloat
    let z: Double
    let scale: Double
    let alpha: Double
    let size: Double
    let glow: Double
}

private struct OrbPanel: View {
    private let dotCount = 520
    private let camera = 620.0

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color.white.opacity(0.012))

            TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
                let loop = timeline.date.timeIntervalSinceReferenceDate / 18.5
                let t = loop * Double.pi * 2

                ZStack {
                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    Color(red: 0.34, green: 0.58, blue: 1.0).opacity(0.26),
                                    Color(red: 0.48, green: 0.36, blue: 0.95).opacity(0.08),
                                    Color.clear
                                ],
                                center: .center,
                                startRadius: 6,
                                endRadius: 86
                            )
                        )
                        .blur(radius: 18)

                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    Color(red: 0.55, green: 0.9, blue: 1.0).opacity(0.20),
                                    Color.clear
                                ],
                                center: .center,
                                startRadius: 4,
                                endRadius: 68
                            )
                        )
                        .blur(radius: 8)

                    Canvas { context, size in
                        let side = min(size.width, size.height)
                        let radius = Double(side) * 0.31
                        let center = CGPoint(x: size.width / 2, y: size.height / 2)
                        let dots = buildDots(radius: radius)
                        let rotY = t * 0.58
                        let rotX = 0.14 * sin(t * 0.45)

                        var rendered: [NotchRenderedDot] = []
                        rendered.reserveCapacity(dots.count)

                        for dot in dots {
                            var point = rotateY(x: dot.x, y: dot.y, z: dot.z, angle: rotY)
                            point = rotateX(x: point.x, y: point.y, z: point.z, angle: rotX)

                            let scale = camera / (camera - point.z)
                            let x = center.x + CGFloat(point.x * scale)
                            let y = center.y + CGFloat(point.y * scale)
                            let depth = (point.z + radius) / (2 * radius)
                            let waveA = 1 - min(1, abs(sin(2.0 * dot.lon - t + dot.seed * 0.8)) / 0.16)
                            let waveB = 1 - min(1, abs(sin(1.2 * dot.lat + 1.3 * dot.lon + t * 1.2)) / 0.22)
                            let glow = pow(max(waveA, waveB), 1.15)
                            let flicker = 0.78 + 0.22 * sin(t * 1.9 + dot.seed2 * Double.pi * 2)

                            rendered.append(
                                NotchRenderedDot(
                                    x: x,
                                    y: y,
                                    z: point.z,
                                    scale: scale,
                                    alpha: min(1, (0.16 + depth * 0.70) * flicker + glow * 0.18),
                                    size: 0.75 + depth * 1.85 + glow * 1.05,
                                    glow: glow
                                )
                            )
                        }

                        rendered.sort { $0.z < $1.z }
                        context.blendMode = .screen

                        for dot in rendered {
                            let radius = CGFloat(dot.size * dot.scale)
                            if dot.glow > 0.08 {
                                context.fill(
                                    Path(ellipseIn: CGRect(
                                        x: dot.x - radius * 2.2,
                                        y: dot.y - radius * 2.2,
                                        width: radius * 4.4,
                                        height: radius * 4.4
                                    )),
                                    with: .color(Color(red: 0.55, green: 0.9, blue: 1.0).opacity(0.06 * dot.glow))
                                )
                            }

                            let color = Color(
                                red: min(1, 0.36 + 0.10 * dot.glow + 0.04 * dot.alpha),
                                green: min(1, 0.62 + 0.11 * dot.alpha + 0.06 * dot.glow),
                                blue: min(1, 0.94 + 0.14 * dot.glow)
                            )
                            context.fill(
                                Path(ellipseIn: CGRect(
                                    x: dot.x - radius,
                                    y: dot.y - radius,
                                    width: radius * 2,
                                    height: radius * 2
                                )),
                                with: .color(color.opacity(dot.alpha))
                            )
                        }
                    }
                }
                .padding(8)
            }
        }
    }

    private func buildDots(radius: Double) -> [NotchOrbDot] {
        (0..<dotCount).map { index in
            let u = Double(index) / Double(dotCount)
            let y = 1 - 2 * u
            let ring = sqrt(max(0, 1 - y * y))
            let theta = Double.pi * (3 - sqrt(5)) * Double(index)
            let x = cos(theta) * ring
            let z = sin(theta) * ring

            return NotchOrbDot(
                x: x * radius,
                y: y * radius,
                z: z * radius,
                lon: atan2(z, x),
                lat: asin(y),
                seed: fract(sin(Double(index) * 91.173) * 43758.5453123),
                seed2: fract(sin(Double(index + 17) * 51.931) * 24634.63451)
            )
        }
    }

    private func rotateY(x: Double, y: Double, z: Double, angle: Double) -> (x: Double, y: Double, z: Double) {
        let c = cos(angle)
        let s = sin(angle)
        return (x * c + z * s, y, -x * s + z * c)
    }

    private func rotateX(x: Double, y: Double, z: Double, angle: Double) -> (x: Double, y: Double, z: Double) {
        let c = cos(angle)
        let s = sin(angle)
        return (x, y * c - z * s, y * s + z * c)
    }

    private func fract(_ value: Double) -> Double {
        value - floor(value)
    }
}

private struct ChatControls: View {
    @Binding var prompt: String
    let submitState: String
    @Binding var droppedFiles: [NikiNotchFile]
    let voiceRecording: Bool
    let voiceProcessing: Bool
    @FocusState var promptFocused: Bool
    @State private var dropTargeted = false
    let onSubmit: () -> Void
    let onVoice: () -> Void
    let onShowUtils: () -> Void
    let onShowShelf: () -> Void
    let onClear: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            captureTopBar
            composerRow
            actionRow

            if !droppedFiles.isEmpty {
                attachedFilesRow
            }

            Spacer(minLength: 0)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(dropTargeted ? Color.white.opacity(0.07) : Color.white.opacity(0.022))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .stroke(dropTargeted ? Color.white.opacity(0.24) : Color.white.opacity(0.06), lineWidth: 1)
                )
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .onDrop(
            of: [.fileURL, .url],
            isTargeted: $dropTargeted
        ) { providers in
            attachProviders(providers)
            return true
        }
    }

    private var captureTopBar: some View {
        HStack(spacing: 7) {
            NikiStatusPill(icon: "command", label: "Capture", tint: Color.white.opacity(0.78))

            if !droppedFiles.isEmpty {
                NikiStatusPill(
                    icon: "doc.fill",
                    label: "\(droppedFiles.count) file\(droppedFiles.count == 1 ? "" : "s")",
                    tint: Color(red: 0.58, green: 0.77, blue: 1)
                )
            }

            Spacer(minLength: 8)

            Text(stateCopy)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(stateTint)
        }
    }

    private var composerRow: some View {
        HStack(alignment: .center, spacing: 10) {
            MessageGlyph()

            TextField("Ask anything", text: $prompt)
                .textFieldStyle(.plain)
                .font(.system(size: 16, weight: .medium, design: .rounded))
                .foregroundStyle(.white)
                .focused($promptFocused)
                .onSubmit {
                    notchDebugLog("textfield submit chars=\(prompt.trimmingCharacters(in: .whitespacesAndNewlines).count)")
                    onSubmit()
                }
                .onChange(of: prompt) { _, newValue in
                    if newValue.count == 1 || newValue.isEmpty {
                        notchDebugLog("textfield changed chars=\(newValue.count)")
                    }
                }

            NotchSendButton(canSubmit: canSubmit) {
                notchDebugLog("send button tapped chars=\(prompt.trimmingCharacters(in: .whitespacesAndNewlines).count)")
                onSubmit()
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(composerBackground)
    }

    private var actionRow: some View {
        HStack(spacing: 7) {
            NotchActionButton(
                icon: voiceIcon,
                label: voiceRecording ? "Stop" : voiceProcessing ? "Voice" : "Mic",
                active: voiceRecording || voiceProcessing,
                action: onVoice
            )
            NotchActionButton(icon: "square.grid.2x2.fill", label: "Shelf", action: onShowShelf)
            NotchActionButton(icon: "sparkles", label: "Utils", action: onShowUtils)

            Spacer(minLength: 8)

            NotchActionButton(icon: "xmark", label: "Clear", quiet: true, action: onClear)
        }
    }

    private var attachedFilesRow: some View {
        HStack(spacing: 8) {
            Image(systemName: "paperclip")
                .font(.system(size: 11, weight: .semibold))
            Text(attachedFileSummary)
                .lineLimit(1)
            if droppedFiles.count > 2 {
                Text("+\(droppedFiles.count - 2)")
            }
        }
        .font(.system(size: 11, weight: .medium, design: .rounded))
        .foregroundStyle(Color.white.opacity(0.48))
        .padding(.horizontal, 10)
    }

    private var composerBackground: some View {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
            .fill(Color.white.opacity(0.045))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(Color.white.opacity(promptFocused ? 0.16 : 0.07), lineWidth: 1)
            )
    }

    private var canSubmit: Bool {
        !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !droppedFiles.isEmpty
    }

    private var attachedFileSummary: String {
        droppedFiles.prefix(2).map(\.name).joined(separator: ", ")
    }

    private var voiceIcon: String {
        if voiceProcessing { return "waveform" }
        return voiceRecording ? "stop.fill" : "mic.fill"
    }

    private var stateCopy: String {
        if voiceProcessing { return "Transcribing" }
        if voiceRecording { return "Listening" }
        return submitState
    }

    private var stateTint: Color {
        if voiceRecording || voiceProcessing {
            return Color(red: 0.46, green: 0.88, blue: 1)
        }
        if submitState == "Error" || submitState == "Voice error" || submitState == "Mic denied" {
            return Color(red: 1, green: 0.42, blue: 0.42)
        }
        return Color.white.opacity(0.46)
    }

    private func attachProviders(_ providers: [NSItemProvider]) {
        notchDebugLog("capture drop providers=\(providers.count)")

        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, error in
                    if let error {
                        notchDebugLog("capture file drop error \(error.localizedDescription)")
                        return
                    }
                    appendDroppedItem(item)
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, error in
                    if let error {
                        notchDebugLog("capture url drop error \(error.localizedDescription)")
                        return
                    }
                    appendDroppedItem(item)
                }
            }
        }
    }

    private func appendDroppedItem(_ item: NSSecureCoding?) {
        let url: URL?
        if let item = item as? URL {
            url = item
        } else if let data = item as? Data,
                  let raw = String(data: data, encoding: .utf8) {
            url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines))
        } else if let raw = item as? String {
            url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines))
        } else {
            url = nil
        }

        guard let url else { return }
        let file = NikiNotchFile(url: url)

        DispatchQueue.main.async {
            guard !droppedFiles.contains(file) else { return }
            droppedFiles.append(file)
            notchDebugLog("capture attached \(file.kind)=\(file.name)")
        }
    }
}

private struct NotchSendButton: View {
    let canSubmit: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Text("Send")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                Image(systemName: "arrow.up")
                    .font(.system(size: 11, weight: .bold))
            }
            .foregroundStyle(canSubmit ? Color.black.opacity(0.88) : Color.white.opacity(0.36))
            .frame(height: 34)
            .padding(.horizontal, 12)
            .background(sendBackground)
        }
        .buttonStyle(.plain)
        .disabled(!canSubmit)
        .contentShape(Rectangle())
    }

    private var sendBackground: some View {
        Capsule()
            .fill(canSubmit ? Color.white.opacity(0.92) : Color.white.opacity(0.07))
            .overlay(
                Capsule()
                    .stroke(Color.white.opacity(canSubmit ? 0.0 : 0.08), lineWidth: 1)
            )
    }
}

private struct MessageGlyph: View {
    var body: some View {
        ZStack {
            Circle()
                .fill(Color.white.opacity(0.075))
                .frame(width: 34, height: 34)

            Image(systemName: "message.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.72))
        }
    }
}

private struct NotchActionButton: View {
    let icon: String
    let label: String
    var active: Bool = false
    var quiet: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .semibold))
                Text(label)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
            }
            .foregroundStyle(active ? Color.white : Color.white.opacity(quiet ? 0.42 : 0.76))
            .padding(.horizontal, 9)
            .frame(height: 30)
            .background(
                Capsule()
                    .fill(active ? Color.white.opacity(0.16) : Color.white.opacity(quiet ? 0.035 : 0.07))
                    .overlay(
                        Capsule()
                            .stroke(Color.white.opacity(active ? 0.18 : 0.07), lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
    }
}

private struct NikiFileShareView: View {
    @EnvironmentObject private var vm: BoringViewModel
    @StateObject private var quickShare = QuickShareService.shared
    @Default(.quickShareProvider) private var quickShareProvider: String
    @Binding var droppedFiles: [NikiNotchFile]
    @Binding var submitState: String
    @State private var hostView: NSView?
    @State private var interactionNonce: UUID = .init()
    @State private var isProcessing = false

    private var selectedProvider: QuickShareProvider {
        quickShare.availableProviders.first(where: { $0.id == quickShareProvider }) ??
            QuickShareProvider(id: "System Share Menu", imageData: nil, supportsRawText: true)
    }

    var body: some View {
        dropArea
            .background(NikiNSViewHost(view: $hostView))
            .onDrop(
                of: [.fileURL, .url, .utf8PlainText, .plainText, .data, .image],
                isTargeted: $vm.dropZoneTargeting
            ) { providers in
                interactionNonce = .init()
                vm.dropEvent = true
                Task { await handleDrop(providers) }
                return true
            }
            .onTapGesture {
                Task {
                    await handleClick()
                }
            }
    }

    private var dropArea: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(
                    LinearGradient(
                        colors: [Color.black.opacity(0.35), Color.black.opacity(0.20)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(
                            vm.dropZoneTargeting
                                ? Color.accentColor.opacity(0.9)
                                : Color.white.opacity(0.1),
                            style: StrokeStyle(lineWidth: 3, lineCap: .round, dash: [10])
                        )
                )
                .shadow(color: Color.black.opacity(0.6), radius: 6, x: 0, y: 2)

            VStack(spacing: 5) {
                ZStack {
                    Circle()
                        .fill(Color.white.opacity(vm.dropZoneTargeting ? 0.11 : 0.09))
                        .frame(width: 55, height: 55)

                    Image(systemName: "square.and.arrow.up")
                    Group {
                        if let imgData = selectedProvider.imageData, let nsImg = NSImage(data: imgData) {
                            Image(nsImage: nsImg)
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                        } else {
                            Image(systemName: "square.and.arrow.up")
                        }
                    }
                    .frame(width: 34, height: 34)
                    .foregroundStyle(vm.dropZoneTargeting ? Color.accentColor : Color.gray)
                    .scaleEffect(vm.dropZoneTargeting ? 1.06 : 1.0)
                    .animation(.spring(response: 0.36, dampingFraction: 0.7), value: vm.dropZoneTargeting)
                }

                Text(selectedProvider.id)
                    .font(.system(.headline, design: .rounded))
                    .foregroundColor(.white.opacity(0.8))
            }
            .padding(18)

            if isProcessing || quickShare.isPickerOpen {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.black.opacity(0.3))
                    .overlay(
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            .scaleEffect(0.8)
                    )
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: 12))
    }

    @MainActor
    private func handleClick() async {
        notchDebugLog("quick share picker open provider=\(selectedProvider.id)")
        await quickShare.showFilePicker(for: selectedProvider, from: hostView)
    }

    @MainActor
    private func handleDrop(_ providers: [NSItemProvider]) async {
        isProcessing = true
        defer { isProcessing = false }
        notchDebugLog("drop received providers=\(providers.count)")
        await quickShare.shareDroppedFiles(providers, using: selectedProvider, from: hostView)
        droppedFiles = []
        submitState = "Ready"
        notchDebugLog("quick share drop handled provider=\(selectedProvider.id)")
    }
}

private extension NikiNotchFile {
    init(url: URL) {
        self.init(
            name: url.lastPathComponent.isEmpty ? url.absoluteString : url.lastPathComponent,
            path: url.isFileURL ? url.path : url.absoluteString,
            kind: url.isFileURL ? "file" : "url"
        )
    }
}

private struct NikiNSViewHost: NSViewRepresentable {
    @Binding var view: NSView?

    func makeNSView(context: Context) -> NSView {
        let nsView = NSView(frame: .zero)
        DispatchQueue.main.async { self.view = nsView }
        return nsView
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async { self.view = nsView }
    }
}

private struct CalendarCard: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(
                    LinearGradient(
                        colors: [Color.black.opacity(0.35), Color.black.opacity(0.20)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.white.opacity(0.13), lineWidth: 1.2)
                )
                .shadow(color: Color.black.opacity(0.6), radius: 6, x: 0, y: 2)

            CalendarView()
                .padding(.top, 14)
                .padding(.trailing, 12)
                .padding(.bottom, 12)
                .padding(.leading, 22)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .scaleEffect(0.94, anchor: .topLeading)
        }
        .contentShape(
            RoundedRectangle(cornerRadius: 12)
        )
        .task {
            await CalendarManager.shared.checkCalendarAuthorization()
            await CalendarManager.shared.updateCurrentDate(Date.now)
        }
    }
}

private func notchDebugLog(_ message: String) {
    let line = "\(ISO8601DateFormatter().string(from: Date())) [swift] \(message)\n"
    print("[niki-notch] \(message)")

    let fileManager = FileManager.default
    let path = fileManager.homeDirectoryForCurrentUser
        .appendingPathComponent(".niki/notch-debug.log")

    do {
        try fileManager.createDirectory(
            at: path.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        if !fileManager.fileExists(atPath: path.path) {
            try line.write(to: path, atomically: true, encoding: .utf8)
            return
        }

        let handle = try FileHandle(forWritingTo: path)
        defer { try? handle.close() }
        try handle.seekToEnd()
        if let data = line.data(using: .utf8) {
            try handle.write(contentsOf: data)
        }
    } catch {
        print("[niki-notch] debug log write failed \(error.localizedDescription)")
    }
}

private extension Data {
    mutating func appendMultipartField(name: String, value: String, boundary: String) {
        append("--\(boundary)\r\n".data(using: .utf8)!)
        append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
        append("\(value)\r\n".data(using: .utf8)!)
    }

    mutating func appendMultipartFile(name: String, filename: String, mimeType: String, data: Data, boundary: String) {
        append("--\(boundary)\r\n".data(using: .utf8)!)
        append("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        append(data)
        append("\r\n".data(using: .utf8)!)
    }
}

#Preview {
    ContentView()
        .environmentObject(BoringViewModel())
}
