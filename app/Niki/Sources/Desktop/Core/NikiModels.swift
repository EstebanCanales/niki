import Foundation

enum NikiBootStage {
    case loading
    case setup
    case login
    case mfa
    case shell
}

enum NikiChatRole: String, Codable {
    case user
    case assistant
    case system
}

enum NikiSessionStatus: String, Codable {
    case live
    case paused
    case complete
}

enum NikiWorkItemStatus: String, Codable {
    case open
    case done
    case archived
}

enum NikiWorkItemPriority: String, Codable {
    case low
    case medium
    case high
}

enum NikiWorkItemProposalStatus: String, Codable {
    case none
    case proposed
}

enum NikiTonePreference: String, Codable, CaseIterable {
    case grounded
    case warm
    case direct
}

enum NikiBrevityPreference: String, Codable, CaseIterable {
    case concise
    case balanced
    case detailed
}

enum NikiResponseStylePreference: String, Codable, CaseIterable {
    case operational
    case friendly
    case briefStatus = "brief_status"
}

enum NikiRuntimeCompatibilityMode: String, Codable, CaseIterable {
    case standard
    case hermesAgent = "hermes_agent"
}

enum NikiAgentVisualState: String, Codable {
    case idle
    case listening
    case thinking
    case acting
    case speaking
    case success
    case warning
    case error
}

struct NikiUser: Codable {
    let id: String
    let email: String
    let displayName: String
}

struct NikiMfaChallenge: Codable {
    let required: Bool
    let challengeId: String
    let method: String
}

struct NikiLoginResponse: Codable {
    let ok: Bool
    let user: NikiUser
    let mfa: NikiMfaChallenge
}

struct NikiVerifyMfaResponse: Codable {
    let ok: Bool
    let user: NikiUser
    let accessToken: String
    let tokenType: String
}

struct NikiCompliance: Codable {
    let kycStatus: String?
    let screeningStatus: String?
    let jurisdictionAllowed: Bool?
    let riskTier: String?
}

struct NikiMeResponse: Codable {
    let ok: Bool
    let user: NikiUser
    let compliance: NikiCompliance?
}

struct NikiRuntimeStatusResponse: Codable {
    let ok: Bool
    let apiServerUrl: String
    let resolvedModel: String
    let state: String
    let health: String
    let detail: String?
}

struct NikiRuntimeConfigResponse: Codable {
    let ok: Bool
    let apiServerUrl: String
    let apiKey: String?
    let hasApiKey: Bool
    let model: String
    let contextLengthOverride: Int?
    let compatibilityMode: String?
    let diagnosticsEnabled: Bool?
}

struct NikiHealthResponse: Codable {
    let ok: Bool
    let status: String
    let gatewayUrl: String?
    let defaultModel: String?
}

struct NikiChatSession: Identifiable, Codable {
    let id: String
    var title: String
    var summary: String
    var status: NikiSessionStatus
    var updatedAt: String
}

struct NikiChatAttachment: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let path: String
    let kind: String
}

struct NikiChatMessage: Identifiable, Codable, Hashable {
    let id: String
    let role: NikiChatRole
    var content: String
    let createdAt: String
    var attachments: [NikiChatAttachment]
}

struct NikiHermesMessage: Codable {
    let role: String
    let content: String
}

struct NikiSseChoiceDelta: Codable {
    let content: String?
}

struct NikiSseChoice: Codable {
    let delta: NikiSseChoiceDelta?
}

struct NikiChatStreamChunk: Codable {
    let choices: [NikiSseChoice]?
}

struct NikiWorkItemSubtask: Identifiable, Codable, Hashable {
    let id: String
    var title: String
    var done: Bool
}

struct NikiWorkItem: Identifiable, Codable, Hashable {
    let id: String
    var kind: String
    var title: String
    var notes: String?
    var category: String
    var status: NikiWorkItemStatus
    var priority: NikiWorkItemPriority
    var dueAt: String?
    var subtasks: [NikiWorkItemSubtask]
    var proposalStatus: NikiWorkItemProposalStatus
    var createdAt: String
    var updatedAt: String
    var sourceSessionId: String?
    var source: String
}

struct NikiWorkItemsResponse: Codable {
    let items: [NikiWorkItem]?
}

struct NikiWorkItemResponse: Codable {
    let item: NikiWorkItem?
}

struct NikiMemoryEntry: Identifiable, Codable {
    var id: String { key }
    let key: String
    let value: String
    let ttl: Int?
    let updatedAt: String
}

struct NikiMemoryResponse: Codable {
    let ok: Bool
    let entries: [NikiMemoryEntry]
}

struct NikiPersonaProfile: Codable {
    var assistantName: String
    var tone: NikiTonePreference
    var brevity: NikiBrevityPreference
    var operationalRules: String
    var forbiddenBehaviors: String
    var responseStyle: NikiResponseStylePreference
    var updatedAt: String
}

struct NikiVoiceTranscriptionResponse: Codable {
    let ok: Bool
    let text: String?
    let error: String?
    let language: String?
    let duration: Int?
}

struct NikiVoiceSynthesisResponse: Codable {
    let ok: Bool
    let audio: String?
    let format: String?
    let mime: String?
    let error: String?
    let duration: Int?
}

struct NikiRuntimeConnectionPatch: Codable {
    let state: String?
    let endpoint: String?
    let latencyMs: Int?
    let operatorMode: String?
    let runtimeVersion: String?
}

struct NikiRuntimeAgentPatch: Codable {
    let state: NikiAgentVisualState?
    let model: String?
    let channel: String?
    let currentTask: String?
    let summary: String?
}

struct NikiRuntimePatch: Codable {
    let connection: NikiRuntimeConnectionPatch?
    let agent: NikiRuntimeAgentPatch?
}

struct NikiRuntimeEventEnvelope: Codable {
    let kind: String
    let patch: NikiRuntimePatch?
}

struct NikiStoredConfig: Codable {
    var backendBaseURL: String
    var backendAPIKey: String
    var runtimeAPIURL: String
    var runtimeAPIKey: String
    var runtimeModel: String
    var runtimeContextLengthOverride: String
    var runtimeCompatibilityMode: NikiRuntimeCompatibilityMode
    var runtimeDiagnosticsEnabled: Bool
    var ttsVoice: String
    var autoVoice: Bool
    var orbAccentHex: String
    var personaProfile: NikiPersonaProfile?
}

struct NikiNotchBridgeConfig: Codable {
    var baseUrl: String
    var apiKey: String
    var userId: String
}

struct NikiStoredSession: Codable {
    var accessToken: String
    var userID: String
    var displayName: String
    var email: String
}

extension NikiPersonaProfile {
    static let `default` = NikiPersonaProfile(
        assistantName: "Niki",
        tone: .grounded,
        brevity: .concise,
        operationalRules: "Be concise, practical, and action-oriented. Confirm only what actually changed.",
        forbiddenBehaviors: "Do not pretend completed work if it was only planned. Do not present yourself as Hermes.",
        responseStyle: .operational,
        updatedAt: ""
    )
}

extension NikiChatAttachment {
    init(url: URL) {
        self.id = UUID().uuidString
        self.name = url.lastPathComponent
        self.path = url.path
        self.kind = url.pathExtension.isEmpty ? "file" : url.pathExtension
    }
}
