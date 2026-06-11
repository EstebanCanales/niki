import AVFoundation
import AppKit
import SwiftUI

@MainActor
final class NikiAppModel: NSObject, ObservableObject, AVAudioRecorderDelegate, @preconcurrency AVAudioPlayerDelegate {
    @Published var bootStage: NikiBootStage = .loading
    @Published var selection: DockItem? = nil

    @Published var backendBaseURL: String = "http://127.0.0.1:8000"
    @Published var backendAPIKey: String = ""
    @Published var runtimeAPIURL: String = ""
    @Published var runtimeAPIKey: String = ""
    @Published var runtimeModel: String = ""
    @Published var runtimeContextLengthOverride: String = ""
    @Published var runtimeCompatibilityMode: NikiRuntimeCompatibilityMode = .standard
    @Published var runtimeDiagnosticsEnabled = false

    @Published var email: String = "operator@niki.com"
    @Published var password: String = "demo-password"
    @Published var mfaCode: String = "123456"
    @Published var challengeID: String = ""
    @Published var authError: String = ""
    @Published var setupError: String = ""
    @Published var authBusy = false
    @Published var checkingConnection = false

    @Published var accessToken: String = ""
    @Published var userID: String = "user-demo"
    @Published var displayName: String = "Esteban"
    @Published var userEmail: String = ""

    @Published var runtimeConnected = false
    @Published var runtimeSummary: String = "Ready."
    @Published var runtimeModelResolved: String = ""
    @Published var agentState: NikiAgentVisualState = .idle

    @Published var chatSessions: [NikiChatSession] = []
    @Published var activeSessionID: String = ""
    @Published var chatMessages: [String: [NikiChatMessage]] = [:]
    @Published var chatInput: String = ""
    @Published var chatAttachments: [NikiChatAttachment] = []
    @Published var chatBusy = false
    @Published var chatError: String = ""

    @Published var voiceRecording = false
    @Published var voiceProcessing = false
    @Published var voiceError: String = ""
    @Published var voiceTranscript: String = ""
    @Published var autoVoice = false
    @Published var ttsVoice = "es_AR-daniela"
    @Published var speaking = false
    @Published var activeMode: NikiActiveMode = .none
    @Published var audioLevel: Float = 0

    var companionActive: Bool { activeMode == .auto }
    var callModeActive: Bool { activeMode == .call }

    @Published var personaProfile: NikiPersonaProfile = .default
    @Published var settingsSaved = false
    @Published var settingsError: String = ""
    @Published var notchBridgeStatus: String = ""
    @Published var notchVisible = true
    @Published var orbAccentHex: String = "#5ea2ff"

    private var recorder: AVAudioRecorder?
    private var recordedFileURL: URL?
    private var audioPlayer: AVAudioPlayer?
    private var currentTtsFileURL: URL?
    private var runtimeEventsTask: Task<Void, Never>?
    private var activeChatTask: Task<Void, Never>?
    private var titleGenerationTasks: [String: Task<Void, Never>] = [:]
    private var companionTask: Task<Void, Never>?
    private let silenceDuration: TimeInterval = 1.5
    private let silenceThreshold: Float = -28.0  // dBFS

    private let configKey = "niki.native.config"
    private let sessionKey = "niki.native.session"
    private weak var appDelegate: NikiAppDelegate?

    override init() {
        super.init()
        loadPersistedState()
        ensureSeedSession()
        Task { await bootstrap() }
    }

    deinit {
        runtimeEventsTask?.cancel()
        activeChatTask?.cancel()
        titleGenerationTasks.values.forEach { $0.cancel() }
    }

    var activeMessages: [NikiChatMessage] {
        chatMessages[activeSessionID] ?? []
    }

    var activeChatTitle: String {
        guard let session = chatSessions.first(where: { $0.id == activeSessionID }) else {
            return "Chat"
        }
        let title = session.title.trimmingCharacters(in: .whitespacesAndNewlines)
        return title.isEmpty || title == "New chat" ? "Chat" : title
    }

    var client: NikiAPIClient {
        NikiAPIClient(
            baseURL: backendBaseURL,
            apiKey: backendAPIKey,
            accessToken: accessToken.isEmpty ? nil : accessToken,
            userID: userID.isEmpty ? nil : userID
        )
    }

    func bootstrap() async {
        if accessToken.isEmpty {
            bootStage = .login
            return
        }

        do {
            _ = try await client.me()
            bootStage = .shell
            selection = selection ?? .chat
            await loadShellData()
        } catch {
            clearSession()
            bootStage = .login
        }
    }

    func saveBackendConfigAndContinue() async {
        checkingConnection = true
        setupError = ""
        do {
            let health = try await client.healthz()
            runtimeSummary = health.status
            persistConfig()
            bootStage = .login
        } catch {
            setupError = error.localizedDescription
        }
        checkingConnection = false
    }

    func login() async {
        authBusy = true
        authError = ""
        do {
            let response = try await client.login(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
            challengeID = response.mfa.challengeId
            userID = response.user.id
            displayName = response.user.displayName
            userEmail = response.user.email
            bootStage = .mfa
        } catch {
            authError = error.localizedDescription
        }
        authBusy = false
    }

    func verifyMfa() async {
        authBusy = true
        authError = ""
        do {
            let response = try await client.verifyMfa(challengeId: challengeID, code: mfaCode)
            accessToken = response.accessToken
            userID = response.user.id
            displayName = response.user.displayName
            userEmail = response.user.email
            persistSession()
            bootStage = .shell
            selection = .chat
            await loadShellData()
        } catch {
            authError = error.localizedDescription
        }
        authBusy = false
    }

    func logout() {
        clearSession()
        runtimeEventsTask?.cancel()
        runtimeConnected = false
        selection = nil
        authError = ""
        bootStage = .login
    }

    func selectDockItem(_ item: DockItem?) {
        selection = selection == item ? nil : item
    }

    func toggleAutoVoice() {
        autoVoice.toggle()
        persistConfig()
    }

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

    func createChatSession(seedText: String? = nil) {
        let session = NikiChatSession(
            id: UUID().uuidString,
            title: "New chat",
            summary: seedText?.isEmpty == false ? summarizePreview(seedText!) : "Niki session ready.",
            status: .live,
            updatedAt: isoNow()
        )
        chatSessions.insert(session, at: 0)
        chatMessages[session.id] = []
        activeSessionID = session.id
    }

    func sendCurrentChat() async {
        guard !chatBusy else { return }
        let prompt = chatInput.trimmingCharacters(in: .whitespacesAndNewlines)
        if prompt.isEmpty && chatAttachments.isEmpty { return }
        if activeSessionID.isEmpty { createChatSession(seedText: prompt) }

        let sessionID = activeSessionID
        let visibleText = prompt.isEmpty ? "Attached \(chatAttachments.count) file(s)." : prompt
        let userMessage = NikiChatMessage(
            id: UUID().uuidString,
            role: .user,
            content: visibleText,
            createdAt: isoNow(),
            attachments: chatAttachments
        )
        chatMessages[sessionID, default: []].append(userMessage)
        let assistantID = UUID().uuidString
        chatMessages[sessionID, default: []].append(
            NikiChatMessage(id: assistantID, role: .assistant, content: "", createdAt: isoNow(), attachments: [])
        )
        chatBusy = true
        chatError = ""
        agentState = .thinking
        runtimeSummary = visibleText

        let modelInput = buildModelInput(prompt: prompt, attachments: chatAttachments)
        let requestMessages = buildHermesMessages(for: sessionID, overridingLatestUserWith: modelInput)
        let attachments = chatAttachments
        chatInput = ""
        chatAttachments = []

        startTitleGenerationIfNeeded(sessionID: sessionID, firstPrompt: visibleText)
        activeChatTask?.cancel()
        activeChatTask = Task { @MainActor [weak self] in
            await self?.runChatStream(
                sessionID: sessionID,
                assistantID: assistantID,
                visibleText: visibleText,
                modelInput: modelInput,
                requestMessages: requestMessages,
                attachments: attachments
            )
        }
    }

    func cancelCurrentChat() {
        guard chatBusy else { return }
        activeChatTask?.cancel()
        activeChatTask = nil
        finishCancelledChat()
    }

    func retryAssistantMessage(_ message: NikiChatMessage) async {
        guard !chatBusy else { return }
        let messages = activeMessages
        guard let index = messages.firstIndex(where: { $0.id == message.id }) else { return }
        let previousUser = messages[..<index].reversed().first(where: { $0.role == .user })
        guard let previousUser else { return }
        chatMessages[activeSessionID] = messages.filter { $0.id != message.id }
        chatInput = previousUser.content
        chatAttachments = previousUser.attachments
        await sendCurrentChat()
    }

    func speakMessage(_ message: NikiChatMessage) async {
        let text = message.content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            voiceError = "No assistant reply yet."
            return
        }
        await speak(text: text)
    }

    func copyMessage(_ message: NikiChatMessage) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(sanitizeForTts(message.content), forType: .string)
    }

    private func runChatStream(
        sessionID: String,
        assistantID: String,
        visibleText: String,
        modelInput: String,
        requestMessages: [NikiHermesMessage],
        attachments: [NikiChatAttachment]
    ) async {
        do {
            let final = try await client.streamChat(
                sessionID: sessionID,
                input: modelInput,
                messages: requestMessages
            ) { [weak self] visible in
                self?.replaceAssistantMessage(id: assistantID, in: sessionID, content: visible)
                self?.agentState = .speaking
                self?.runtimeSummary = visible
            }
            guard !Task.isCancelled else {
                finishCancelledChat(sessionID: sessionID, assistantID: assistantID)
                return
            }
            replaceAssistantMessage(id: assistantID, in: sessionID, content: final)
            finalizeSession(sessionID: sessionID, summaryText: final.isEmpty ? visibleText : final)
            agentState = .success
            if autoVoice, !final.isEmpty {
                await speak(text: final)
            } else {
                scheduleReturnToIdle()
            }
        } catch {
            if error is CancellationError || Task.isCancelled {
                finishCancelledChat(sessionID: sessionID, assistantID: assistantID)
                return
            }
            let fallback = error.localizedDescription
            replaceAssistantMessage(id: assistantID, in: sessionID, content: fallback)
            chatError = fallback
            updateSessionStatus(sessionID: sessionID, status: .paused, summary: fallback)
            agentState = .error
            chatMessages[sessionID, default: []] = dedupeMessages(chatMessages[sessionID, default: []], attachmentsForLatestUser: attachments)
            scheduleReturnToIdle()
        }

        chatBusy = false
        activeChatTask = nil
    }

    func setActiveSession(_ id: String) {
        activeSessionID = id
    }

    func appendAttachment(url: URL) {
        chatAttachments.append(NikiChatAttachment(url: url))
    }

    func removeAttachment(_ attachment: NikiChatAttachment) {
        chatAttachments.removeAll { $0.id == attachment.id }
    }

    func startVoiceRecording() async {
        voiceError = ""
        let granted = await AVCaptureDevice.requestAccess(for: .audio)
        guard granted else {
            voiceError = "Microphone permission denied."
            return
        }
        do {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("niki-\(UUID().uuidString).wav")
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatLinearPCM),
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsFloatKey: false
            ]
            recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder?.delegate = self
            recorder?.prepareToRecord()
            guard recorder?.record() == true else {
                voiceError = "Could not start microphone recording."
                recorder = nil
                recordedFileURL = nil
                return
            }
            recordedFileURL = url
            voiceRecording = true
            agentState = .listening
            runtimeSummary = "Listening..."
        } catch {
            voiceError = error.localizedDescription
        }
    }

    func stopVoiceRecordingAndTranscribe() async {
        recorder?.stop()
        recorder = nil
        voiceRecording = false
        try? await Task.sleep(nanoseconds: 220_000_000)
        guard let fileURL = recordedFileURL else { return }
        do {
            voiceError = ""
            voiceProcessing = true
            let data = try Data(contentsOf: fileURL)
            guard data.count > 256 else {
                voiceError = "Recording was empty."
                voiceProcessing = false
                return
            }
            let response = try await client.transcribeAudio(data: data, language: "es")
            guard response.ok, let text = response.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
                voiceError = response.error ?? "Transcription failed."
                voiceProcessing = false
                return
            }
            voiceTranscript = text
            chatInput = text
            agentState = .idle
            runtimeSummary = text
            recordedFileURL = nil
            if callModeActive {
                await sendCurrentChat()
            }
        } catch {
            voiceError = error.localizedDescription
        }
        voiceProcessing = false
    }

    func speakLastAssistantReply() async {
        guard let text = activeMessages.reversed().first(where: { $0.role == .assistant })?.content,
              !text.isEmpty else {
            voiceError = "No assistant reply yet."
            return
        }
        await speak(text: text)
    }

    func testVoiceSample() async {
        let sample = ttsVoice.hasPrefix("es")
            ? "Hola, soy Niki. En que puedo ayudarte hoy."
            : "Hello, I am Niki. How can I help you today."
        await speak(text: sample)
    }

    func saveSettings() async {
        settingsError = ""
        do {
            _ = try await client.updateRuntimeConfig(
                apiServerURL: runtimeAPIURL,
                runtimeAPIKey: runtimeAPIKey,
                model: runtimeModel,
                contextLengthOverride: Int(runtimeContextLengthOverride.trimmingCharacters(in: .whitespacesAndNewlines)),
                compatibilityMode: runtimeCompatibilityMode,
                diagnosticsEnabled: runtimeDiagnosticsEnabled
            )
            personaProfile = NikiPersonaProfile(
                assistantName: personaProfile.assistantName,
                tone: personaProfile.tone,
                brevity: personaProfile.brevity,
                operationalRules: personaProfile.operationalRules,
                forbiddenBehaviors: personaProfile.forbiddenBehaviors,
                responseStyle: personaProfile.responseStyle,
                updatedAt: isoNow()
            )
            persistConfig()
            persistSession()
            settingsSaved = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.1) { [weak self] in
                self?.settingsSaved = false
            }
        } catch {
            settingsError = error.localizedDescription
        }
    }

    func refreshSettingsData() async {
        do {
            let runtimeConfig = try await client.runtimeConfig()
            runtimeAPIURL = runtimeConfig.apiServerUrl
            runtimeAPIKey = runtimeConfig.apiKey ?? runtimeAPIKey
            runtimeModel = runtimeConfig.model
            runtimeContextLengthOverride = runtimeConfig.contextLengthOverride.map(String.init) ?? ""
            runtimeCompatibilityMode = runtimeConfig.compatibilityMode == NikiRuntimeCompatibilityMode.hermesAgent.rawValue ? .hermesAgent : .standard
            runtimeDiagnosticsEnabled = runtimeConfig.diagnosticsEnabled ?? false
        } catch {
            settingsError = error.localizedDescription
        }
    }

    func loadShellData() async {
        await refreshRuntimeStatus()
        await refreshSettingsData()
        connectRuntimeEvents()
    }

    func refreshRuntimeStatus() async {
        do {
            let status = try await client.runtimeStatus()
            runtimeConnected = status.state == "ready"
            runtimeSummary = status.detail ?? "Connected."
            runtimeModelResolved = status.resolvedModel
            runtimeAPIURL = status.apiServerUrl
            runtimeModel = status.resolvedModel
            agentState = runtimeConnected ? .idle : .warning
        } catch {
            runtimeConnected = false
            runtimeSummary = error.localizedDescription
            agentState = .error
        }
    }

    private func startTitleGenerationIfNeeded(sessionID: String, firstPrompt: String) {
        guard titleGenerationTasks[sessionID] == nil else { return }
        guard let session = chatSessions.first(where: { $0.id == sessionID }) else { return }
        let currentTitle = session.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard currentTitle.isEmpty || currentTitle == "New chat" || currentTitle == "Chat" else { return }

        titleGenerationTasks[sessionID] = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.titleGenerationTasks[sessionID] = nil }
            do {
                let title = try await self.generateChatTitle(sessionID: sessionID, prompt: firstPrompt)
                guard !Task.isCancelled, !title.isEmpty else { return }
                self.applyGeneratedTitle(title, to: sessionID)
            } catch {
                return
            }
        }
    }

    private func generateChatTitle(sessionID: String, prompt: String) async throws -> String {
        let titlePrompt = """
        Generate one concise chat title for this user request.
        Rules: 3 to 5 words, same language as the user, no quotes, no markdown, no trailing period.

        User request:
        \(prompt)
        """
        let messages = [
            NikiHermesMessage(role: "system", content: "You only write concise conversation titles."),
            NikiHermesMessage(role: "user", content: titlePrompt)
        ]
        let raw = try await client.streamChat(
            sessionID: "\(sessionID)-title",
            input: titlePrompt,
            messages: messages,
            channel: "niki-title"
        ) { _ in }
        return sanitizeGeneratedTitle(raw)
    }

    private func sanitizeGeneratedTitle(_ raw: String) -> String {
        var title = raw
            .replacingOccurrences(of: #"\[\[[^\]]+\]\]"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"[\"“”]"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        while title.last == "." || title.last == ":" || title.last == "-" {
            title.removeLast()
            title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if title.count > 56 {
            title = String(title.prefix(56)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return title
    }

    private func applyGeneratedTitle(_ title: String, to sessionID: String) {
        guard let index = chatSessions.firstIndex(where: { $0.id == sessionID }) else { return }
        chatSessions[index].title = title
        chatSessions[index].updatedAt = isoNow()
    }

    private func finishCancelledChat(sessionID: String? = nil, assistantID: String? = nil) {
        let targetSessionID = sessionID ?? activeSessionID
        if let assistantID {
            ensureAssistantCancelText(sessionID: targetSessionID, assistantID: assistantID)
        } else if let assistant = chatMessages[targetSessionID]?.last(where: { $0.role == .assistant }) {
            ensureAssistantCancelText(sessionID: targetSessionID, assistantID: assistant.id)
        }
        updateSessionStatus(sessionID: targetSessionID, status: .paused, summary: "Canceled.")
        chatBusy = false
        activeChatTask = nil
        runtimeSummary = "Canceled."
        agentState = .idle
    }

    private func ensureAssistantCancelText(sessionID: String, assistantID: String) {
        guard let message = chatMessages[sessionID]?.first(where: { $0.id == assistantID }) else { return }
        if message.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            replaceAssistantMessage(id: assistantID, in: sessionID, content: "Cancelado.")
        }
    }

    private func connectRuntimeEvents() {
        runtimeEventsTask?.cancel()
        runtimeEventsTask = client.streamRuntimeEvents { [weak self] patch in
            guard let self else { return }
            if let connection = patch.connection {
                self.runtimeConnected = connection.state == "ready"
                if let endpoint = connection.endpoint, !endpoint.isEmpty {
                    self.runtimeAPIURL = endpoint
                }
                if let version = connection.runtimeVersion, !version.isEmpty {
                    self.runtimeModelResolved = version
                }
            }
            if let agent = patch.agent {
                if let state = agent.state {
                    self.agentState = state
                }
                if let summary = agent.summary, !summary.isEmpty {
                    self.runtimeSummary = summary
                }
                if let model = agent.model, !model.isEmpty {
                    self.runtimeModelResolved = model
                }
            }
        }
    }

    private func speak(text: String) async {
        do {
            voiceError = ""
            speaking = true
            if audioPlayer?.isPlaying == true {
                audioPlayer?.stop()
            }
            let response = try await client.synthesize(text: sanitizeForTts(text), language: "es-ES", voice: ttsVoice)
            guard response.ok, let audio = response.audio, let data = Data(base64Encoded: audio) else {
                voiceError = response.error ?? "TTS failed."
                speaking = false
                return
            }
            let ext = audioFileExtension(format: response.format, mime: response.mime)
            let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent("niki-tts-\(UUID().uuidString).\(ext)")
            try data.write(to: fileURL, options: .atomic)
            currentTtsFileURL = fileURL
            audioPlayer = try AVAudioPlayer(contentsOf: fileURL)
            audioPlayer?.delegate = self
            audioPlayer?.prepareToPlay()
            audioPlayer?.play()
            agentState = .speaking
        } catch {
            voiceError = error.localizedDescription
            speaking = false
            if agentState == .speaking {
                agentState = .idle
            }
        }
    }

    // MARK: - Companion mode

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

    // Loop principal: escucha → STT → agente → TTS → escucha
    private func companionLoop() async {
        while activeMode == .auto && !Task.isCancelled {
            // --- Fase 1: Escuchar con VAD ---
            let audioData = await recordWithVAD()
            guard activeMode == .auto, !Task.isCancelled else { break }
            guard let data = audioData else {
                // Sin audio suficiente (silencio puro) → volver a escuchar
                continue
            }

            // --- Fase 2: STT ---
            agentState = .thinking
            runtimeSummary = "Procesando voz…"
            voiceProcessing = true
            let transcription: String
            do {
                let response = try await client.transcribeAudio(data: data, language: "es")
                voiceProcessing = false
                guard response.ok, let text = response.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
                    continue
                }
                transcription = text
            } catch {
                voiceProcessing = false
                voiceError = "STT: \(error.localizedDescription)"
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                continue
            }

            guard activeMode == .auto, !Task.isCancelled else { break }
            voiceTranscript = transcription
            runtimeSummary = transcription

            // --- Fase 3: Chat (async, no esperamos su tarea interna) ---
            chatInput = transcription
            await sendCurrentChat()

            // --- Fase 4: Esperar que Niki hable (autoVoice = true) ---
            // Esperamos hasta que speaking=true (TTS comenzó) y luego hasta que termina
            var waited = 0
            while waited < 120 && activeMode == .auto && !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 100_000_000)  // 100ms
                waited += 1
                if speaking { break }  // TTS comenzó
            }
            // Ahora esperar que speaking=false (TTS terminó)
            while speaking && activeMode == .auto && !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 100_000_000)
            }

            // Pausa mínima antes de escuchar de nuevo
            try? await Task.sleep(nanoseconds: 400_000_000)
        }
    }

    // Graba audio hasta detectar silencio (VAD). Retorna nil si no hay voz real.
    private func recordWithVAD() async -> Data? {
        voiceError = ""
        let granted = await AVCaptureDevice.requestAccess(for: .audio)
        guard granted else {
            voiceError = "Permiso de micrófono denegado."
            activeMode = .none
            return nil
        }
        guard activeMode == .auto, !Task.isCancelled else { return nil }

        let url = FileManager.default.temporaryDirectory.appendingPathComponent("niki-\(UUID().uuidString).wav")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsFloatKey: false
        ]

        do {
            let rec = try AVAudioRecorder(url: url, settings: settings)
            rec.isMeteringEnabled = true
            rec.prepareToRecord()
            guard rec.record() else {
                voiceError = "No se pudo iniciar el micrófono."
                return nil
            }
            recorder = rec
            recordedFileURL = url
            voiceRecording = true
            agentState = .listening
            runtimeSummary = "Escuchando…"
            audioLevel = 0
        } catch {
            voiceError = error.localizedDescription
            return nil
        }

        // VAD: polling con sleep corto — fiable en cualquier run loop mode
        var lastSoundTime = Date()
        var hasHeardVoice = false

        while voiceRecording, activeMode == .auto, !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 100_000_000)  // 100ms

            guard let rec = recorder else { break }
            rec.updateMeters()
            let power = rec.averagePower(forChannel: 0)
            let level = Float(max(0, min(1, (power + 60.0) / 60.0)))
            audioLevel = level

            if power > silenceThreshold {
                lastSoundTime = Date()
                hasHeardVoice = true
            }

            // Para después de silenceDuration de silencio, pero solo si oyó algo real
            if hasHeardVoice, Date().timeIntervalSince(lastSoundTime) >= silenceDuration {
                break
            }

            // Tiempo máximo de grabación: 30s
            if rec.currentTime > 30 { break }
        }

        // Detener grabación
        recorder?.stop()
        recorder = nil
        voiceRecording = false
        audioLevel = 0
        try? await Task.sleep(nanoseconds: 150_000_000)  // buffer de cierre

        guard hasHeardVoice else { return nil }
        guard let fileURL = recordedFileURL else { return nil }
        let data = try? Data(contentsOf: fileURL)
        recordedFileURL = nil
        guard let d = data, d.count > 1024 else { return nil }
        return d
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        speaking = false
        scheduleReturnToIdle(delay: 0.18)
        if let currentTtsFileURL {
            try? FileManager.default.removeItem(at: currentTtsFileURL)
            self.currentTtsFileURL = nil
        }
    }

    private func buildModelInput(prompt: String, attachments: [NikiChatAttachment]) -> String {
        guard !attachments.isEmpty else { return prompt }
        let fileContext = attachments.map { "- \($0.name): \($0.path) (\($0.kind))" }.joined(separator: "\n")
        if prompt.isEmpty {
            return "Attached file context:\n\(fileContext)"
        }
        return "\(prompt)\n\nAttached file context:\n\(fileContext)"
    }

    private func buildHermesMessages(for sessionID: String, overridingLatestUserWith content: String) -> [NikiHermesMessage] {
        var messages = chatMessages[sessionID, default: []].map {
            NikiHermesMessage(role: $0.role.rawValue, content: $0.content)
        }
        if let index = messages.lastIndex(where: { $0.role == "user" }) {
            messages[index] = NikiHermesMessage(role: "user", content: content)
        }
        return messages.filter { !$0.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    private func replaceAssistantMessage(id: String, in sessionID: String, content: String) {
        guard var messages = chatMessages[sessionID] else { return }
        guard let index = messages.firstIndex(where: { $0.id == id }) else { return }
        messages[index].content = content
        chatMessages[sessionID] = messages
    }

    private func finalizeSession(sessionID: String, summaryText: String) {
        updateSessionStatus(sessionID: sessionID, status: .complete, summary: summaryText)
    }

    private func updateSessionStatus(sessionID: String, status: NikiSessionStatus, summary: String) {
        guard let index = chatSessions.firstIndex(where: { $0.id == sessionID }) else { return }
        chatSessions[index].status = status
        chatSessions[index].summary = summarizePreview(summary)
        chatSessions[index].updatedAt = isoNow()
    }

    private func dedupeMessages(_ messages: [NikiChatMessage], attachmentsForLatestUser: [NikiChatAttachment]) -> [NikiChatMessage] {
        var seen = Set<String>()
        return messages.filter {
            if seen.contains($0.id) { return false }
            seen.insert($0.id)
            return true
        }
    }

    private func ensureSeedSession() {
        if chatSessions.isEmpty {
            createChatSession()
        }
        if activeSessionID.isEmpty {
            activeSessionID = chatSessions.first?.id ?? ""
        }
    }

    private func summarizeTitle(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "New chat" }
        return trimmed.count > 44 ? String(trimmed.prefix(44)) + "..." : trimmed
    }

    private func summarizePreview(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "Niki session ready." }
        return trimmed.count > 120 ? String(trimmed.prefix(120)) + "..." : trimmed
    }

    private func sanitizeForTts(_ text: String) -> String {
        text
            .replacingOccurrences(of: #"(\*\*|__)(.+?)\1"#, with: "$2", options: .regularExpression)
            .replacingOccurrences(of: #"(\*|_)(.+?)\1"#, with: "$2", options: .regularExpression)
            .replacingOccurrences(of: #"`([^`]+)`"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"\[\[[^\]]+\]\]"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func audioFileExtension(format: String?, mime: String?) -> String {
        if let format, !format.isEmpty { return format.lowercased() }
        if let mime {
            if mime.contains("wav") { return "wav" }
            if mime.contains("mpeg") || mime.contains("mp3") { return "mp3" }
            if mime.contains("m4a") || mime.contains("mp4") { return "m4a" }
        }
        return "wav"
    }

    private func scheduleReturnToIdle(delay: Double = 0.7) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !self.voiceRecording, !self.speaking, !self.chatBusy else { return }
            self.agentState = .idle
        }
    }

    private func isoNow() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    private func persistConfig() {
        let config = NikiStoredConfig(
            backendBaseURL: backendBaseURL,
            backendAPIKey: backendAPIKey,
            runtimeAPIURL: runtimeAPIURL,
            runtimeAPIKey: runtimeAPIKey,
            runtimeModel: runtimeModel,
            runtimeContextLengthOverride: runtimeContextLengthOverride,
            runtimeCompatibilityMode: runtimeCompatibilityMode,
            runtimeDiagnosticsEnabled: runtimeDiagnosticsEnabled,
            ttsVoice: ttsVoice,
            autoVoice: autoVoice,
            orbAccentHex: orbAccentHex,
            personaProfile: personaProfile
        )
        if let data = try? JSONEncoder().encode(config) {
            UserDefaults.standard.set(data, forKey: configKey)
        }
    }

    private func persistSession() {
        let session = NikiStoredSession(
            accessToken: accessToken,
            userID: userID,
            displayName: displayName,
            email: userEmail
        )
        if let data = try? JSONEncoder().encode(session) {
            UserDefaults.standard.set(data, forKey: sessionKey)
        }
    }

    private func loadPersistedState() {
        if let data = UserDefaults.standard.data(forKey: configKey),
           let config = try? JSONDecoder().decode(NikiStoredConfig.self, from: data) {
            backendBaseURL = config.backendBaseURL
            backendAPIKey = config.backendAPIKey
            runtimeAPIURL = config.runtimeAPIURL
            runtimeAPIKey = config.runtimeAPIKey
            runtimeModel = config.runtimeModel
            runtimeContextLengthOverride = config.runtimeContextLengthOverride
            runtimeCompatibilityMode = config.runtimeCompatibilityMode
            runtimeDiagnosticsEnabled = config.runtimeDiagnosticsEnabled
            ttsVoice = config.ttsVoice
            autoVoice = config.autoVoice
            orbAccentHex = config.orbAccentHex
            if let personaProfile = config.personaProfile {
                self.personaProfile = personaProfile
            }
        }
        if let data = UserDefaults.standard.data(forKey: sessionKey),
           let session = try? JSONDecoder().decode(NikiStoredSession.self, from: data) {
            accessToken = session.accessToken
            userID = session.userID
            displayName = session.displayName
            userEmail = session.email
        }
    }

    private func clearSession() {
        accessToken = ""
        challengeID = ""
        UserDefaults.standard.removeObject(forKey: sessionKey)
    }

}
