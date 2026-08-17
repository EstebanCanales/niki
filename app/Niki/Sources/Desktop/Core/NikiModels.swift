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
    let approvals: NikiRuntimeApprovalsSnapshot?
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
    let provider: String?
    /// Veredicto de la huella de voz. Nil si el backend no la tiene instalada.
    let speaker: NikiSpeakerVerdict?
}

struct NikiSttChunk: Identifiable {
    let id = UUID()
    let text: String
    let latencyMs: Int
    let provider: String
    let index: Int
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
    let payload: NikiOperatorCapabilities?
    let sessionsSnapshot: NikiRuntimeSessionsSnapshot?
    let mcpSnapshot: NikiRuntimeMcpSnapshot?
    let profilesSnapshot: NikiRuntimeProfilesSnapshot?
    let sessionAction: NikiRuntimeSessionAction?
    let event: NikiRuntimeStreamEvent?
    let approvalRequest: NikiRuntimeApprovalRequest?
    let approvalResolution: NikiRuntimeApprovalResolution?
    let diagnostic: NikiRuntimeDiagnostic?
    let surface: NikiRuntimeSurface?

    enum CodingKeys: String, CodingKey {
        case kind
        case patch
        case payload
        case event
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        kind = try container.decode(String.self, forKey: .kind)
        patch = try container.decodeIfPresent(NikiRuntimePatch.self, forKey: .patch)
        event = try container.decodeIfPresent(NikiRuntimeStreamEvent.self, forKey: .event)

        var payload: NikiOperatorCapabilities?
        var sessionsSnapshot: NikiRuntimeSessionsSnapshot?
        var mcpSnapshot: NikiRuntimeMcpSnapshot?
        var profilesSnapshot: NikiRuntimeProfilesSnapshot?
        var sessionAction: NikiRuntimeSessionAction?
        var approvalRequest: NikiRuntimeApprovalRequest?
        var approvalResolution: NikiRuntimeApprovalResolution?
        var diagnostic: NikiRuntimeDiagnostic?
        var surface: NikiRuntimeSurface?

        switch kind {
        case "capabilities":
            payload = try container.decodeIfPresent(NikiOperatorCapabilities.self, forKey: .payload)
        case "sessions_snapshot":
            sessionsSnapshot = try container.decodeIfPresent(NikiRuntimeSessionsSnapshot.self, forKey: .payload)
        case "mcp_snapshot":
            mcpSnapshot = try container.decodeIfPresent(NikiRuntimeMcpSnapshot.self, forKey: .payload)
        case "profiles_snapshot":
            profilesSnapshot = try container.decodeIfPresent(NikiRuntimeProfilesSnapshot.self, forKey: .payload)
        case "session_action":
            sessionAction = try container.decodeIfPresent(NikiRuntimeSessionAction.self, forKey: .payload)
        case "approval_request":
            approvalRequest = try container.decodeIfPresent(NikiRuntimeApprovalRequest.self, forKey: .payload)
        case "approval_resolved":
            approvalResolution = try container.decodeIfPresent(NikiRuntimeApprovalResolution.self, forKey: .payload)
        case "diagnostics":
            diagnostic = try container.decodeIfPresent(NikiRuntimeDiagnostic.self, forKey: .payload)
        case "surface":
            surface = try container.decodeIfPresent(NikiRuntimeSurface.self, forKey: .payload)
        case "surface_clear":
            break
        default:
            break
        }

        self.payload = payload
        self.sessionsSnapshot = sessionsSnapshot
        self.mcpSnapshot = mcpSnapshot
        self.profilesSnapshot = profilesSnapshot
        self.sessionAction = sessionAction
        self.approvalRequest = approvalRequest
        self.approvalResolution = approvalResolution
        self.diagnostic = diagnostic
        self.surface = surface
    }
}

struct NikiRuntimeCapabilitiesResponse: Codable {
    let ok: Bool
    let capabilities: NikiOperatorCapabilities
}

struct NikiRuntimeApprovalRequest: Identifiable, Codable, Hashable {
    let id: String
    let runId: String
    let title: String
    let toolName: String
    let detail: String
    let choices: [String]
}

struct NikiRuntimeApprovalResolution: Codable, Hashable {
    let id: String
    let runId: String
    let decision: String
    let resolved: Int
}

enum NikiRuntimeSurfaceKind: String, Codable, Hashable {
    case search
    case map
    case model3d
}

struct NikiRuntimeSurfaceLocation: Codable, Hashable {
    let label: String
    let lat: Double?
    let lng: Double?
    let address: String?
}

struct NikiRuntimeSurface: Identifiable, Codable, Hashable {
    let id: String
    let kind: NikiRuntimeSurfaceKind
    let title: String
    let subtitle: String?
    let query: String?
    let url: String?
    let location: NikiRuntimeSurfaceLocation?
    let modelUrl: String?
    let createdAt: String
}

struct NikiRuntimeApprovalsSnapshot: Codable {
    let pending: [NikiRuntimeApprovalRequest]
}

struct NikiRuntimeSessionAction: Codable, Hashable {
    let sessionId: String
    let action: String
    let status: String
    let summary: String
    let detail: String?
    let platform: String?
    let removed: Int?
}

struct NikiComputerAvailability: Codable, Hashable {
    let state: NikiModuleAvailabilityState
    let reason: String?
}

struct NikiComputerCapability: Identifiable, Codable, Hashable {
    let name: String
    let description: String
    let risk: String

    var id: String { name }

    enum CodingKeys: String, CodingKey {
        case name
        case description
        case risk
    }
}

struct NikiComputerPermissionStatus: Codable, Hashable {
    let required: Bool?
    let note: String?
}

struct NikiComputerInputHelperStatus: Codable, Hashable {
    let available: Bool?
    let path: String?
    let reason: String?
}

struct NikiComputerPermissions: Codable, Hashable {
    let ok: Bool?
    let accessibility: NikiComputerPermissionStatus?
    let screenRecording: NikiComputerPermissionStatus?
    let inputHelper: NikiComputerInputHelperStatus?
}

struct NikiComputerCapabilitiesResponse: Codable {
    let ok: Bool
    let permissions: NikiComputerPermissions?
    let capabilities: [NikiComputerCapability]
    let surface: NikiComputerOperatorSurface?
}

struct NikiComputerOperatorAction: Identifiable, Codable, Hashable {
    let id: String
    let capability: String
    let title: String
    let subtitle: String
    let risk: String
    let state: String
    let reason: String?
    let params: [String: String]?
    let inputs: [NikiComputerOperatorInput]?
}

struct NikiComputerOperatorInput: Identifiable, Codable, Hashable {
    var id: String { key }
    let key: String
    let label: String
    let placeholder: String
    let kind: String
}

struct NikiComputerOperatorSurface: Codable, Hashable {
    let summary: String
    let recommendedActions: [NikiComputerOperatorAction]
}

struct NikiComputerRecentAction: Identifiable, Codable, Hashable {
    var id: String { "\(name)-\(at)" }
    let name: String
    let risk: String
    let ok: Bool
    let durationMs: Int
    let source: String
    let userId: String
    let at: String
}

struct NikiComputerRecentResponse: Codable {
    let ok: Bool
    let recent: [NikiComputerRecentAction]
}

struct NikiComputerActionResponse: Codable {
    let ok: Bool
    let error: String?
    let result: String?
    let text: String?
    let stdout: String?
    let stderr: String?
    let path: String?
    let bytes: Int?
    let mime: String?
    let imageBase64: String?
    let raw: String?
}

struct NikiRemoteSession: Identifiable, Codable, Hashable {
    let id: String
    let title: String
    let profileId: String
    let model: String?
    let provider: String?
    let resumable: Bool
    let canUndo: Bool
    let canUndoReason: String?
    let canHandoff: Bool
    let canHandoffReason: String?
    let handoffTargets: [String]?
    let updatedAt: String?
    let platform: String?
    let source: String?
    let messageCount: Int?
    let apiCallCount: Int?
    let suspended: Bool?
    let resumePending: Bool?
    let resumeReason: String?
    let handoffState: String?
    let handoffPlatform: String?
    let handoffError: String?
    let endedAt: String?
}

struct NikiRemoteSessionsResponse: Codable {
    let ok: Bool
    let sessions: [NikiRemoteSession]
}

struct NikiRuntimeSessionsSnapshot: Codable {
    let sessions: [NikiRemoteSession]
}

struct NikiRemoteProfile: Identifiable, Codable, Hashable {
    let id: String
    let label: String
    let sessionCount: Int
    let lastSeenAt: String?
    let providers: [String]
    let models: [String]
}

struct NikiRemoteProfilesResponse: Codable {
    let ok: Bool
    let profiles: [NikiRemoteProfile]
}

struct NikiRuntimeProfilesSnapshot: Codable {
    let profiles: [NikiRemoteProfile]
}

struct NikiSessionHandoffResponse: Codable {
    let ok: Bool
    let sessionId: String
    let state: String?
    let platform: String?
    let error: String?
}

struct NikiSessionUndoResponse: Codable {
    let ok: Bool
    let sessionId: String
    let removed: Int
    let preview: String?
    let error: String?
}

struct NikiMcpServer: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let status: String
    let enabled: Bool
    let transport: String?
    let authType: String?
    let supportsParallelToolCalls: Bool
    let resourcesEnabled: Bool
    let promptsEnabled: Bool
    let includeCount: Int
    let excludeCount: Int
    let reason: String?
}

struct NikiMcpServersResponse: Codable {
    let ok: Bool
    let servers: [NikiMcpServer]
}

struct NikiRuntimeMcpSnapshot: Codable {
    let servers: [NikiMcpServer]
}

/// Un día de conversaciones guardadas.
struct NikiDatasetDia: Codable, Identifiable {
    let dia: String
    let turnos: Int
    let senales: Int
    let bytes: Int

    var id: String { dia }
}

/// Qué hay guardado para entrenar. Cuenta y pesa; no trae las conversaciones.
struct NikiDatasetResumen: Codable {
    let capturando: Bool
    let carpeta: String
    let dias: [NikiDatasetDia]
    let turnos: Int
    let senales: Int
    let bytes: Int

    static let vacio = NikiDatasetResumen(
        capturando: true, carpeta: "", dias: [], turnos: 0, senales: 0, bytes: 0
    )
}

struct NikiDiscoverCapability: Identifiable, Codable, Hashable {
    let id: String
    let title: String
    let available: Bool
    let reason: String?
}

struct NikiDiscoverCapabilitiesResponse: Codable {
    let ok: Bool
    let profileId: String
    let capabilities: [NikiDiscoverCapability]
}

struct NikiRuntimeDiagnostic: Identifiable, Codable, Hashable {
    let id: String
    let runId: String
    let sessionId: String?
    let filePath: String
    let severity: String
    let message: String
}

struct NikiRuntimeStreamEvent: Codable {
    let id: String?
    let ts: String?
    let level: String?
    let source: String?
    let type: String?
    let title: String?
    let summary: String?
    let detail: String?
}

/// Una línea de la consola de debug.
///
/// El backend viene mandando estos eventos desde siempre —cada llamada a una herramienta,
/// cada error del runtime— y la app los tiraba: no había `case "event"` en el manejador
/// del stream. Esto es ese evento con lo mínimo para poder mostrarlo y filtrarlo.
///
/// El id lo pone la app y no el backend: allá se arma como `tipo-milisegundos`, y dos
/// eventos del mismo tipo en el mismo milisegundo —que pasa— comparten id y rompen la
/// lista.
struct NikiConsoleEntry: Identifiable, Equatable {
    let id = UUID()
    let at: Date
    let level: String
    let source: String
    let type: String
    let title: String
    let summary: String
    let detail: String?

    init(from event: NikiRuntimeStreamEvent) {
        at = Date()
        level = event.level ?? "info"
        source = event.source ?? "runtime"
        type = event.type ?? ""
        title = event.title ?? event.type ?? "(sin título)"
        summary = event.summary ?? ""
        detail = (event.detail?.isEmpty == false) ? event.detail : nil
    }
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


/// Resultado de la huella de voz para un turno.
struct NikiSpeakerVerdict: Codable {
    /// Hay un perfil registrado. Si es false, `match` viene siempre en true.
    let enrolled: Bool
    let match: Bool
    let score: Double?
    let threshold: Double?
}

// MARK: - Proveedor del agente

/// Un proveedor de inferencia que el runtime del agente sabe usar.
struct NikiAgentProvider: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let authType: String
    let baseUrl: String
    let apiKeyEnvVars: [String]
    let baseUrlEnvVar: String
    /// Si hay credencial en el entorno. El valor nunca se expone.
    let credentialReady: Bool
    let credentialFrom: String?
    /// Sesión OAuth iniciada. Un proveedor puede estar listo por clave o por sesión.
    let loggedIn: Bool?
    /// Modelos que ofrece, del catálogo del runtime. Evita tener que adivinar el nombre.
    let models: [String]?
}

/// Con qué está pensando Niki ahora.
struct NikiAgentModelSelection: Codable, Hashable {
    let provider: String
    let model: String
    let baseUrl: String
}

struct NikiAgentProvidersResponse: Codable {
    let providers: [NikiAgentProvider]
    let current: NikiAgentModelSelection
}

/// Estado del runtime del agente, para poder decir en la UI si está listo o reiniciando
/// en vez de que parezca que Niki no responde.
struct NikiAgentStatus: Codable {
    let state: String
    let baseUrl: String
    let pid: Int?
    let restarts: Int
    let lastError: String?
    let model: NikiAgentModelSelection?
}


/// Cuánto contexto lleva una sesión y cuándo se va a compactar.
///
/// `tokens` incluye el prompt de sistema, los mensajes y el esquema de las herramientas
/// —que con cincuenta herramientas pesan más que la conversación—. El umbral tiene un
/// piso de 64.000 que no baja por configuración.
struct NikiContextoSesion: Codable {
    let ok: Bool
    let sessionId: String
    let existe: Bool
    let tokens: Int
    let modelo: String?
    let mensajes: Int?
    let herramientas: Int?
    let contexto: Int?
    let umbral: Int?
    let compactaHabilitada: Bool?

    static let vacio = NikiContextoSesion(
        ok: false, sessionId: "", existe: false, tokens: 0, modelo: nil,
        mensajes: nil, herramientas: nil, contexto: nil, umbral: nil, compactaHabilitada: nil
    )

    /// Qué fracción del umbral de compactación lleva usada. Se mide contra el umbral y no
    /// contra el contexto total porque el umbral es lo que pasa de verdad: a la mitad del
    /// contexto la conversación se resume, no se corta.
    var fraccionHastaCompactar: Double {
        guard let umbral, umbral > 0 else { return 0 }
        return min(1, Double(tokens) / Double(umbral))
    }
}

/// El resultado de un comando en la terminal compartida.
struct NikiTerminalResultado: Codable {
    let ok: Bool
    let comando: String
    let salida: String
    let codigo: Int?
    let cwd: String
    let compartidaConLaIA: Bool
    let cortadoPorTiempo: Bool
    /// Por qué se frenó, cuando el comando es de los catastróficos y falta confirmar.
    let bloqueado: String?
}

/// Dónde está parada la terminal y con quién se comparte.
struct NikiTerminalEstado: Codable {
    let ok: Bool
    let cwd: String
    let compartidaConLaIA: Bool
    let sesion: String

    static let vacio = NikiTerminalEstado(ok: false, cwd: "", compartidaConLaIA: false, sesion: "")
}

/// Estado de la huella de voz.
struct NikiSpeakerStatus: Codable {
    let available: Bool
    let enrolled: Bool
    let threshold: Double?
    let samples: Int?
}

struct NikiSpeakerEnrollResponse: Codable {
    let ok: Bool
    let error: String?
    let threshold: Double?
    let samples: Int?
}


/// Lo que hay que abrir para completar el inicio de sesión de un proveedor.
struct NikiProviderLogin: Codable {
    let ok: Bool
    let provider: String?
    let url: String
    let code: String?
    let waiting: Bool
}


/// Si la sesión de un proveedor ya está iniciada, y por qué no si no lo está.
struct NikiProviderLoginStatus: Codable {
    let loggedIn: Bool
    let detail: String?
}
