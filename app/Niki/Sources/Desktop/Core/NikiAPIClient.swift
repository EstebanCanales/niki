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

    func listMemory() async throws -> NikiMemoryResponse {
        try await decodeResponse(NikiMemoryResponse.self, from: try request("/v1/memory"))
    }

    func setMemory(key: String, value: String, ttl: Int? = nil) async throws {
        var payload: [String: Any] = ["key": key, "value": value]
        if let ttl {
            payload["ttl"] = ttl
        }
        let body = try JSONSerialization.data(withJSONObject: payload)
        _ = try await decodeResponse(NikiHealthResponse.self, from: try request("/v1/memory", method: "POST", body: body))
    }

    func listWorkItems() async throws -> [NikiWorkItem] {
        let response = try await decodeResponse(NikiWorkItemsResponse.self, from: try request("/v1/work-items"))
        return response.items ?? []
    }

    func createWorkItem(title: String, category: String = "Suggested") async throws -> NikiWorkItem {
        let body = try JSONSerialization.data(withJSONObject: [
            "kind": "task",
            "title": title,
            "category": category,
            "priority": "medium",
            "source": "manual",
        ])
        let response = try await decodeResponse(NikiWorkItemResponse.self, from: try request("/v1/work-items", method: "POST", body: body))
        guard let item = response.item else { throw NikiAPIError.invalidResponse }
        return item
    }

    func updateWorkItem(_ item: NikiWorkItem) async throws -> NikiWorkItem {
        let subtasks = item.subtasks.map {
            ["id": $0.id, "title": $0.title, "done": $0.done] as [String: Any]
        }
        let body = try JSONSerialization.data(withJSONObject: [
            "title": item.title,
            "notes": item.notes ?? "",
            "category": item.category,
            "status": item.status.rawValue,
            "priority": item.priority.rawValue,
            "dueAt": item.dueAt ?? "",
            "subtasks": subtasks,
            "proposalStatus": item.proposalStatus.rawValue,
        ])
        let response = try await decodeResponse(
            NikiWorkItemResponse.self,
            from: try request("/v1/work-items/\(item.id)", method: "PATCH", body: body)
        )
        guard let updated = response.item else { throw NikiAPIError.invalidResponse }
        return updated
    }

    func deleteWorkItem(id: String) async throws {
        let request = try request("/v1/work-items/\(id)", method: "DELETE", contentType: nil)
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else {
            throw NikiAPIError.invalidResponse
        }
    }

    func transcribeAudio(data: Data, language: String) async throws -> NikiVoiceTranscriptionResponse {
        let boundary = "NikiBoundary-\(UUID().uuidString)"
        var body = Data()
        body.appendMultipartField(name: "language", value: language, boundary: boundary)
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
        onPatch: @escaping @MainActor (NikiRuntimePatch) -> Void
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
                          let envelope = try? decoder.decode(NikiRuntimeEventEnvelope.self, from: data),
                          envelope.kind == "partial",
                          let patch = envelope.patch else {
                        continue
                    }
                    await onPatch(patch)
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
