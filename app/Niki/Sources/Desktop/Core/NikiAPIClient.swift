import Foundation

enum NikiAPIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case http(Int, String)
    case missingStream

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid backend URL."
        case .invalidResponse:
            return "Invalid server response."
        case let .http(code, body):
            return body.isEmpty ? "HTTP \(code)" : body
        case .missingStream:
            return "Missing response stream."
        }
    }
}

struct NikiAPIClient {
    var baseURL: String
    var apiKey: String
    var accessToken: String?
    var userID: String?

    private let decoder = JSONDecoder()

    private func url(_ path: String) throws -> URL {
        let base = baseURL.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: "\(base)\(path.hasPrefix("/") ? path : "/\(path)")") else {
            throw NikiAPIError.invalidURL
        }
        return url
    }

    private func request(
        _ path: String,
        method: String = "GET",
        body: Data? = nil,
        contentType: String? = "application/json",
        includeAuth: Bool = true
    ) throws -> URLRequest {
        var request = URLRequest(url: try url(path))
        request.httpMethod = method
        request.timeoutInterval = 120
        if !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            request.setValue(apiKey, forHTTPHeaderField: "x-niki-api-key")
        }
        if includeAuth, let accessToken, !accessToken.isEmpty {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        if includeAuth, let userID, !userID.isEmpty {
            request.setValue(userID, forHTTPHeaderField: "x-niki-user-id")
        }
        if let contentType {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        request.httpBody = body
        return request
    }

    private func decodeResponse<T: Decodable>(_ type: T.Type, from request: URLRequest) async throws -> T {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw NikiAPIError.invalidResponse
        }
        guard (200 ..< 300).contains(http.statusCode) else {
            throw NikiAPIError.http(http.statusCode, String(data: data, encoding: .utf8) ?? "")
        }
        return try decoder.decode(T.self, from: data)
    }

    func healthz() async throws -> NikiHealthResponse {
        try await decodeResponse(NikiHealthResponse.self, from: try request("/healthz", includeAuth: false))
    }

    func login(email: String, password: String) async throws -> NikiLoginResponse {
        let body = try JSONSerialization.data(withJSONObject: [
            "email": email,
            "password": password,
        ])
        return try await decodeResponse(
            NikiLoginResponse.self,
            from: try request("/v1/auth/login", method: "POST", body: body, includeAuth: false)
        )
    }

    func verifyMfa(challengeId: String, code: String) async throws -> NikiVerifyMfaResponse {
        let body = try JSONSerialization.data(withJSONObject: [
            "challengeId": challengeId,
            "code": code,
        ])
        return try await decodeResponse(
            NikiVerifyMfaResponse.self,
            from: try request("/v1/auth/mfa/verify", method: "POST", body: body, includeAuth: false)
        )
    }

    func me() async throws -> NikiMeResponse {
        try await decodeResponse(NikiMeResponse.self, from: try request("/v1/me"))
    }

    func runtimeStatus() async throws -> NikiRuntimeStatusResponse {
        try await decodeResponse(NikiRuntimeStatusResponse.self, from: try request("/runtime/status"))
    }

    func runtimeConfig() async throws -> NikiRuntimeConfigResponse {
        try await decodeResponse(NikiRuntimeConfigResponse.self, from: try request("/runtime/config"))
    }

    func runtimeCapabilities() async throws -> NikiRuntimeCapabilitiesResponse {
        try await decodeResponse(NikiRuntimeCapabilitiesResponse.self, from: try request("/runtime/capabilities"))
    }

    func computerCapabilities() async throws -> NikiComputerCapabilitiesResponse {
        try await decodeResponse(NikiComputerCapabilitiesResponse.self, from: try request("/computer/capabilities"))
    }

    func respondToApproval(runID: String, choice: String, resolveAll: Bool = false) async throws {
        let body = try JSONSerialization.data(withJSONObject: [
            "runId": runID,
            "choice": choice,
            "all": resolveAll,
        ])
        _ = try await decodeResponse(
            NikiRuntimeCapabilitiesResponsePlaceholder.self,
            from: try request("/runtime/approvals/respond", method: "POST", body: body)
        )
    }

    func clearSurface() async throws {
        _ = try await decodeResponse(
            NikiRuntimeCapabilitiesResponsePlaceholder.self,
            from: try request("/runtime/surface/clear", method: "POST")
        )
    }

    func computerRecent(limit: Int = 10) async throws -> NikiComputerRecentResponse {
        try await decodeResponse(NikiComputerRecentResponse.self, from: try request("/computer/recent?limit=\(limit)"))
    }

    func computerAction(action: String, params: [String: Any] = [:]) async throws -> NikiComputerActionResponse {
        let body = try JSONSerialization.data(withJSONObject: [
            "action": action,
            "params": params,
        ])
        return try await decodeResponse(
            NikiComputerActionResponse.self,
            from: try request("/computer/action", method: "POST", body: body)
        )
    }

    func runtimeSessions() async throws -> NikiRemoteSessionsResponse {
        try await decodeResponse(NikiRemoteSessionsResponse.self, from: try request("/runtime/sessions"))
    }

    func runtimeProfiles() async throws -> NikiRemoteProfilesResponse {
        try await decodeResponse(NikiRemoteProfilesResponse.self, from: try request("/runtime/profiles"))
    }

    func requestSessionHandoff(sessionID: String, platform: String) async throws -> NikiSessionHandoffResponse {
        let body = try JSONSerialization.data(withJSONObject: [
            "sessionId": sessionID,
            "platform": platform,
        ])
        return try await decodeResponse(
            NikiSessionHandoffResponse.self,
            from: try request("/runtime/sessions/handoff", method: "POST", body: body)
        )
    }

    func requestSessionUndo(sessionID: String) async throws -> NikiSessionUndoResponse {
        let body = try JSONSerialization.data(withJSONObject: [
            "sessionId": sessionID,
        ])
        return try await decodeResponse(
            NikiSessionUndoResponse.self,
            from: try request("/runtime/sessions/undo", method: "POST", body: body)
        )
    }

    func runtimeMcpServers() async throws -> NikiMcpServersResponse {
        try await decodeResponse(NikiMcpServersResponse.self, from: try request("/runtime/mcp"))
    }

    func updateRuntimeMcpServer(id: String, enabled: Bool) async throws -> NikiMcpServersResponse {
        let body = try JSONSerialization.data(withJSONObject: [
            "id": id,
            "enabled": enabled,
        ])
        return try await decodeResponse(
            NikiMcpServersResponse.self,
            from: try request("/runtime/mcp/server", method: "POST", body: body)
        )
    }

    func runtimeDiscoverCapabilities(profileID: String) async throws -> NikiDiscoverCapabilitiesResponse {
        try await decodeResponse(
            NikiDiscoverCapabilitiesResponse.self,
            from: try request("/runtime/discover?profileId=\(profileID)")
        )
    }

    func updateRuntimeConfig(
        apiServerURL: String,
        runtimeAPIKey: String,
        model: String,
        contextLengthOverride: Int?,
        compatibilityMode: NikiRuntimeCompatibilityMode,
        diagnosticsEnabled: Bool
    ) async throws -> NikiRuntimeConfigResponse {
        var payload: [String: Any] = [
            "apiServerUrl": apiServerURL,
            "apiKey": runtimeAPIKey,
            "model": model,
            "compatibilityMode": compatibilityMode.rawValue,
            "diagnosticsEnabled": diagnosticsEnabled,
        ]
        payload["contextLengthOverride"] = contextLengthOverride ?? NSNull()
        let body = try JSONSerialization.data(withJSONObject: payload)
        return try await decodeResponse(
            NikiRuntimeConfigResponse.self,
            from: try request("/runtime/config", method: "POST", body: body)
        )
    }

    /// - Parameter prompt: vocabulario para sesgar a Whisper. Sin esto los nombres
    ///   propios salían destrozados ("Nicky", "Niqui", "Nicunés").
    func transcribeAudio(data: Data, language: String, prompt: String? = nil) async throws -> NikiVoiceTranscriptionResponse {
        let boundary = "NikiBoundary-\(UUID().uuidString)"
        var body = Data()
        body.appendMultipartField(name: "language", value: language, boundary: boundary)
        if let prompt, !prompt.isEmpty {
            body.appendMultipartField(name: "prompt", value: prompt, boundary: boundary)
        }
        body.appendMultipartFile(
            name: "audio",
            filename: "niki-recording.wav",
            mimeType: "audio/wav",
            data: data,
            boundary: boundary
        )
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        return try await decodeResponse(
            NikiVoiceTranscriptionResponse.self,
            from: try request(
                "/voice/transcribe",
                method: "POST",
                body: body,
                contentType: "multipart/form-data; boundary=\(boundary)"
            )
        )
    }

    func synthesize(text: String, language: String, voice: String) async throws -> NikiVoiceSynthesisResponse {
        let payload = try JSONSerialization.data(withJSONObject: [
            "text": text,
            "language": language,
            "voice": voice,
        ])
        return try await decodeResponse(
            NikiVoiceSynthesisResponse.self,
            from: try request("/voice/synthesize", method: "POST", body: payload)
        )
    }

    func streamChat(
        sessionID: String,
        input: String,
        messages: [NikiHermesMessage],
        channel: String = "niki-agent",
        onToken: @escaping @MainActor (String) -> Void
    ) async throws -> String {
        let body = try JSONSerialization.data(withJSONObject: [
            "input": input,
            "sessionId": sessionID,
            "channel": channel,
            "messages": messages.map { ["role": $0.role, "content": $0.content] },
        ])
        let request = try request("/chat/stream", method: "POST", body: body)
        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else {
            throw NikiAPIError.invalidResponse
        }

        var full = ""
        for try await line in bytes.lines {
            guard line.hasPrefix("data: ") else { continue }
            let payload = String(line.dropFirst(6)).trimmingCharacters(in: .whitespacesAndNewlines)
            if payload == "[DONE]" { continue }
            guard let data = payload.data(using: .utf8) else { continue }
            guard let chunk = try? decoder.decode(NikiChatStreamChunk.self, from: data) else { continue }
            let token = chunk.choices?.first?.delta?.content ?? ""
            if token.isEmpty { continue }
            full += token
            await onToken(stripControlMarkers(from: full))
        }

        return stripControlMarkers(from: full)
    }

    func streamRuntimeEvents(
        onEvent: @escaping @MainActor (NikiRuntimeEventEnvelope) -> Void
    ) -> Task<Void, Never> {
        Task {
            do {
                let request = try request("/runtime/events", contentType: nil)
                let (bytes, response) = try await URLSession.shared.bytes(for: request)
                guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else {
                    return
                }

                for try await line in bytes.lines {
                    guard line.hasPrefix("data: ") else { continue }
                    let payload = String(line.dropFirst(6)).trimmingCharacters(in: .whitespacesAndNewlines)
                    guard let data = payload.data(using: .utf8),
                          let envelope = try? decoder.decode(NikiRuntimeEventEnvelope.self, from: data) else {
                        continue
                    }
                    await onEvent(envelope)
                }
            } catch {
                return
            }
        }
    }

    private func stripControlMarkers(from text: String) -> String {
        var clean = text.replacingOccurrences(
            of: #"\[\[[^\]]+\]\]"#,
            with: "",
            options: .regularExpression
        )
        clean = clean.replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
        return clean.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private struct NikiRuntimeCapabilitiesResponsePlaceholder: Codable {
    let ok: Bool
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

// MARK: - Huella de voz

extension NikiAPIClient {
    func speakerStatus() async throws -> NikiSpeakerStatus {
        try await decodeResponse(NikiSpeakerStatus.self, from: try request("/voice/speaker"))
    }

    /// Registra la voz con varias tomas. El backend saca el umbral de cuánto varían
    /// entre sí, así que mandar pocas o muy parecidas empeora el resultado.
    func enrollSpeaker(samples: [Data]) async throws -> NikiSpeakerEnrollResponse {
        let payload = try JSONSerialization.data(withJSONObject: [
            "samples": samples.map { $0.base64EncodedString() },
        ])
        return try await decodeResponse(
            NikiSpeakerEnrollResponse.self,
            from: try request("/voice/speaker/enroll", method: "POST",
                              body: payload, contentType: "application/json")
        )
    }
}

// MARK: - Proveedor del agente

extension NikiAPIClient {
    func agentStatus() async throws -> NikiAgentStatus {
        try await decodeResponse(NikiAgentStatus.self, from: try request("/agent/status"))
    }

    func agentProviders() async throws -> NikiAgentProvidersResponse {
        try await decodeResponse(NikiAgentProvidersResponse.self, from: try request("/agent/providers"))
    }

    /// Abre el flujo de inicio de sesión de un proveedor por suscripción.
    func startProviderLogin(_ providerID: String) async throws {
        _ = try await request("/agent/providers/\(providerID)/login", method: "POST")
    }

    /// Cambia con qué piensa Niki. El backend reinicia el runtime, así que después de
    /// esto hay que sondear `agentStatus()` hasta que vuelva a estar `ready`.
    func setAgentModel(provider: String, model: String, baseUrl: String?) async throws {
        var payload: [String: String] = ["provider": provider, "model": model]
        if let baseUrl, !baseUrl.isEmpty { payload["baseUrl"] = baseUrl }
        _ = try await request(
            "/agent/model",
            method: "PUT",
            body: try JSONSerialization.data(withJSONObject: payload),
            contentType: "application/json"
        )
    }
}
