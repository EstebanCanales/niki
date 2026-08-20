import AVFoundation
import AppKit
import CoreAudio
import SwiftUI

/// Log robusto a archivo — no depende de stdout, sobrevive a `open Niki.app`.
/// Tail en vivo con:  tail -f ~/niki-stt.log
private let nikiSttLogURL: URL = FileManager.default
    .homeDirectoryForCurrentUser.appendingPathComponent("niki-stt.log")
private let nikiSttLogQueue = DispatchQueue(label: "com.niki.stt.log")

func sttLog(_ message: String) {
    print(message)  // también a consola/Xcode
    nikiSttLogQueue.async {
        let line = "\(Date().timeIntervalSince1970) \(message)\n"
        guard let data = line.data(using: .utf8) else { return }
        if let handle = try? FileHandle(forWritingTo: nikiSttLogURL) {
            defer { try? handle.close() }
            handle.seekToEndOfFile()
            handle.write(data)
        } else {
            try? data.write(to: nikiSttLogURL)
        }
    }
}

@MainActor
final class NikiAppModel: NSObject, ObservableObject, AVAudioRecorderDelegate, @preconcurrency AVAudioPlayerDelegate, @preconcurrency AVSpeechSynthesizerDelegate {
    /// Instancia única de la app. El notch se construye en `applicationDidFinishLaunching`,
    /// que corre ANTES de que SwiftUI monte la escena — si ahí se fabricaba un modelo
    /// suelto, el notch quedaba conectado a un estado distinto del de la ventana (dos
    /// streams SSE, dos pipelines de voz, dos configs). Con una sola instancia compartida
    /// notch y app son literalmente el mismo estado.
    static let shared = NikiAppModel()

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
    @Published var operatorCapabilities = NikiOperatorCapabilities(modules: [:], capabilities: [:])
    @Published var pendingApprovals: [NikiRuntimeApprovalRequest] = []
    @Published var latestApprovalResolution: NikiRuntimeApprovalResolution?
    @Published var approvalActionBusyID: String?
    @Published var approvalActionError: String = ""
    @Published var computerAvailability = NikiComputerAvailability(state: .hidden, reason: nil)
    @Published var computerCapabilities: [NikiComputerCapability] = []
    @Published var computerPermissions: NikiComputerPermissions?
    @Published var computerSurfaceSummary: String = ""
    @Published var computerRecommendedActions: [NikiComputerOperatorAction] = []
    @Published var computerActionDrafts: [String: [String: String]] = [:]
    @Published var computerViewportAutoRefreshEnabled = false
    @Published var computerViewportRefreshing = false
    @Published var computerViewportUpdatedAt: String = ""
    @Published var recentComputerActions: [NikiComputerRecentAction] = []
    @Published var computerActionBusy: Bool = false
    @Published var computerActionError: String = ""
    @Published var latestComputerResult: String = ""
    @Published var latestComputerCapture: NSImage?
    @Published var latestComputerCapturePath: String = ""

    @Published var chatSessions: [NikiChatSession] = []
    @Published var remoteSessions: [NikiRemoteSession] = []
    @Published var remoteProfiles: [NikiRemoteProfile] = []
    @Published var sessionActionBusyID: String?
    @Published var sessionActionError: String = ""
    @Published var latestSessionActionSummary: String = ""
    @Published var mcpServers: [NikiMcpServer] = []
    @Published var mcpActionBusyID: String?
    @Published var mcpActionError: String = ""
    @Published var diagnostics: [NikiRuntimeDiagnostic] = []
    /// Las últimas líneas de la consola de debug, la más nueva primero. Acotado: esto
    /// recibe un evento por cada llamada a herramienta, y una sesión larga son miles.
    @Published var consola: [NikiConsoleEntry] = []
    /// Con la consola en pausa se sigue recibiendo pero no se agrega: sirve para poder
    /// leer algo que pasó sin que el flujo lo empuje fuera de la pantalla.
    @Published var consolaEnPausa = false
    /// Qué se guardó de las conversaciones para entrenar. Se carga al abrir Settings.
    /// Cuánto contexto lleva la conversación abierta y cuándo se va a compactar. Se
    /// refresca al terminar cada turno: es cuando el número cambia.
    @Published var contexto: NikiContextoSesion = .vacio
    /// Reconocer a Esteban por la cámara al empezar a hablar. Falla en abierto: si no
    /// reconoce a nadie, la conversación sigue igual.
    let cara = NikiFaceRecognition()
    /// En qué anda el registro de cara. El notch lo muestra mientras pasa.
    @Published var registroDeCara = NikiRegistroDeCaraEstado()
    /// Gestos con la mano durante la conversación. Ver NikiLectorDeGestos.
    let gestos = NikiLectorDeGestos()
    /// Prueba de punta a punta de cámara, micrófono y servicios. Ver NikiPruebaDeIdentidad.
    let prueba = NikiPruebaDeIdentidad()
    /// La conversación es con la cámara prendida: Niki te ve mientras hablan.
    ///
    /// Es una conversación normal más la cámara, no un modo aparte: la voz, los gestos y
    /// el reconocimiento son los mismos. Lo que cambia es que la cámara queda prendida
    /// todo el rato en vez de mirar una vez al empezar, así que te reconoce aunque te
    /// hayas movido y los gestos andan durante toda la charla.
    @Published var videollamada = false {
        didSet {
            guard oldValue != videollamada, !videollamada else { return }
            // Apagar la cámara sin cortar la conversación: el botón de "apagar cámara"
            // del notch y el del dock hacen esto.
            miradaTask?.cancel()
            miradaTask = nil
            cara.olvidarVeredicto()
        }
    }
    private var miradaTask: Task<Void, Never>?
    @AppStorage("niki.gestos.activos") var gestosActivos = true
    /// Qué hace cuando quien habla no es Esteban. La decisión la toma el backend —un
    /// ajuste que viajara en cada pedido lo podría falsear cualquiera— así que esto es
    /// solo el reflejo local de lo que hay allá.
    @Published var modoAjeno = "sinDatos"
    @Published var dataset: NikiDatasetResumen = .vacio
    @Published var datasetOcupado = false
    @Published var datasetError = ""
    @Published var latestDiagnostic: NikiRuntimeDiagnostic?
    @Published var discoverCapabilities: [NikiDiscoverCapability] = []
    @Published var activeSurface: NikiRuntimeSurface?
    @Published var activeProfileID: String = "default"
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
    @Published var ttsVoice = "Serena"
    /// Mientras es true, el motor de captura pasa a `.speaking` y queda armado para
    /// barge-in en vez de cortar frases por silencio.
    @Published var speaking = false { didSet { if speaking != oldValue { syncCapturePhase() } } }
    @Published var audioLevel: Float = 0

    // STT Lab
    @Published var sttLabActive = false
    @Published var sttLabChunks: [NikiSttChunk] = []
    @Published var sttLabError: String = ""
    @Published var sttLabPeakDb: Float = -160
    @Published var sttLabStatus: String = ""       // estado diagnóstico visible en UI
    @Published var sttMicPermission: String = "?"  // "granted" | "denied" | "?"
    /// Micrófono silenciado durante la conversación. El motor sigue abierto pero descarta
    /// lo que entra — silenciar no debe costar un arranque de dispositivo al reactivar.
    @Published var callMuted = false { didSet { if callMuted != oldValue { syncCapturePhase() } } }
    /// El usuario colapsó el notch con ✕ mientras seguía en llamada. Vive acá y no en
    /// NikiNotchViewModel porque hay un view model por pantalla y el estado tiene que
    /// ser el mismo en todas. Se resetea al colgar.
    @Published var notchCallDismissed = false
    @Published var availableMicDevices: [(id: AudioDeviceID, name: String)] = []
    @Published var selectedMicDeviceID: AudioDeviceID = 0  // 0 = default del sistema
    private var sttLabTask: Task<Void, Never>?
    private var computerViewportTask: Task<Void, Never>?
    private var sttLabChunkIndex = 0
    private var ttsLevelTask: Task<Void, Never>?

    /// Cualquier conversación de voz en curso. El chat de texto se esconde mientras
    /// esto sea true (ver NikiChatSidebar).
    var callModeActive: Bool { sttLabActive }

    /// Cuelga la conversación de voz activa.
    func endCall() {
        if sttLabActive { stopSttLab() }
    }

    var availableDockItems: [DockItem] {
        var items: [DockItem] = [.chat]
        if shouldShowDockModule(.computer) {
            items.append(.computer)
        }
        if shouldShowDockModule(.approvals) {
            items.append(.approvals)
        }
        if shouldShowDockModule(.sessions) {
            items.append(.sessions)
        }
        if shouldShowDockModule(.mcp) {
            items.append(.mcp)
        }
        // Elegir con qué piensa Niki. Siempre visible: no depende de que el runtime
        // esté arriba — de hecho es donde se ve si está caído.
        items.append(.provider)
        if shouldShowDockModule(.diagnostics) {
            items.append(.diagnostics)
        }
        if shouldShowDockModule(.discover) {
            items.append(.discover)
        }
        // Consola y terminal: el backend las da por listas siempre —una muestra el flujo
        // de eventos y la otra la sirve él mismo— pero igual se preguntan, para que
        // apagarlas desde el backend alcance sin tocar la app.
        if shouldShowDockModule(.consola) {
            items.append(.consola)
        }
        if shouldShowDockModule(.terminal) {
            items.append(.terminal)
        }
        // Identidad aparece solo si hay con qué reconocer: sin los entornos de la huella
        // de cara y de voz, el panel serían dos carteles diciendo que no está instalado.
        if shouldShowDockModule(.identidad) {
            items.append(.identidad)
        }
        // Voz + micrófono (+ STT Lab solo si se activa en Settings) + settings.
        items.append(.call)
        // Hablar con la cámara prendida. Solo si hay con qué ver: sin el entorno de la
        // huella de cara el botón prometería algo que no puede cumplir.
        if cara.disponible == true {
            items.append(.verme)
        }
        items.append(.mic)
        if sttLabEnabled {
            items.append(.sttLab)
        }
        items.append(.settings)
        return items
    }

    @Published var personaProfile: NikiPersonaProfile = .default
    @Published var settingsSaved = false
    @Published var settingsError: String = ""
    @Published var notchBridgeStatus: String = ""
    @Published var notchVisible = true
    @Published var orbAccentHex: String = "#5ea2ff"
    @Published var sttLabEnabled = false {  // panel detallado de STT; off por default
        didSet { UserDefaults.standard.set(sttLabEnabled, forKey: "niki.sttLabEnabled") }
    }
    // Abrir el shell de Niki con doble toque de un modificador (Option por defecto).
    @Published var doubleTapToOpenEnabled = true {
        didSet { UserDefaults.standard.set(doubleTapToOpenEnabled, forKey: "niki.doubleTapEnabled") }
    }
    @Published var doubleTapModifier = "option" {   // option | command | control | shift
        didSet { UserDefaults.standard.set(doubleTapModifier, forKey: "niki.doubleTapModifier") }
    }

    private var recorder: AVAudioRecorder?
    // MARK: - Huella de voz
    /// nil mientras no se preguntó. Igual que en la cara: sin la distinción, el panel
    /// afirma "no está instalada" antes de haber preguntado.
    @Published var speakerAvailable: Bool?
    @Published var speakerEnrolled = false
    @Published var speakerThreshold: Double?
    @Published var speakerSamples = 0
    /// Cuántas tomas se grabaron en el registro en curso.
    @Published var enrollProgress = 0
    @Published var enrollTotal = 5
    /// Cómo terminó el registro de voz, para poder mostrarlo antes de bajar el notch.
    ///
    /// Hace falta un estado aparte de `speakerStatusText` porque la vista del notch solo
    /// existe mientras `enrolling` es true: si se apagaba al terminar, el mensaje final
    /// —salió bien, o por qué no— se desmontaba en el mismo instante en que se sabía.
    @Published var enrollResultado: String?
    @Published var enrolling = false
    @Published var speakerStatusText = ""

    /// Deja el reconocedor de cara listo y le pregunta al backend si hay perfil.
    /// Registra la cara mostrando el proceso en el notch.
    ///
    /// Abre el notch a propósito: lo que hay que ver es la cámara, y pedirle a alguien que
    /// se registre sin verse es como cortarse el pelo sin espejo.
    func registrarCaraEnElNotch() async {
        guard !registroDeCara.activo else { return }
        registroDeCara = NikiRegistroDeCaraEstado(fase: .despertando, total: 7)
        appDelegate?.openNotch()

        _ = await cara.registrar { [weak self] estado in
            self?.registroDeCara = estado
        }

        // El resultado queda en pantalla unos segundos y se va solo: si falló, el motivo
        // se puede leer; si salió bien, nadie quiere apretar un botón para eso.
        try? await Task.sleep(nanoseconds: 4_000_000_000)
        if registroDeCara.terminado { cerrarRegistroDeCara() }
    }

    func cerrarRegistroDeCara() {
        registroDeCara = NikiRegistroDeCaraEstado()
    }

    /// Qué hace cada gesto.
    ///
    /// Los tres resuelven cosas en las que la voz falla justo cuando más falta hacen:
    /// callarla exige hablarle encima de lo que está diciendo, y aprobar un borrado exige
    /// ir a buscar el botón. Un gesto no compite con nada.
    private func empezarAEscucharGestos() {
        gestos.alReconocer = { [weak self] gesto in
            guard let self else { return }
            switch gesto {
            case .palma:
                self.interruptCurrentReply()
            case .pulgarArriba, .pulgarAbajo:
                // Solo si hay algo esperando permiso: un pulgar al aire no aprueba nada.
                guard let pendiente = self.pendingApprovals.first else { return }
                let eleccion = gesto == .pulgarArriba ? "once" : "deny"
                Task { await self.respondToApproval(pendiente, choice: eleccion) }
            }
        }
        gestos.empezar()
    }

    func guardarModoAjeno(_ modo: String) async {
        _ = try? await client.identidadModo(modo)
    }

    func cargarEstadoDeCara() async {
        cara.configurar(cliente: client)
        prueba.configurar(cliente: client)
        if let ident = try? await client.identidadActual() { modoAjeno = ident.salud.modo }
        await cara.cargarEstado()
    }

    func loadSpeakerStatus() async {
        guard let s = try? await client.speakerStatus() else { return }
        speakerAvailable = s.available
        speakerEnrolled = s.enrolled
        speakerThreshold = s.threshold
        speakerSamples = s.samples ?? 0
    }

    /// Graba las tomas de registro, una por una, y las manda juntas.
    ///
    /// Se graban seguidas y no de a una con confirmación porque el umbral sale de cuánto
    /// varía la voz entre tomas: si se hacen muy separadas o leyendo la misma frase con
    /// la misma entonación, la dispersión es artificialmente baja y el umbral queda
    /// demasiado estricto para el uso real.
    /// Registra la voz mostrando el proceso en el notch.
    ///
    /// Se abre el notch por lo mismo que con la cara: grabar cinco frases mirando un
    /// cartel no dice si te está escuchando. Con el nivel en vivo, un micrófono mudo se
    /// nota en la primera toma y no al final.
    func enrollSpeaker() async {
        guard !enrolling else { return }
        appDelegate?.openNotch()
        enrolling = true
        enrollProgress = 0
        enrollResultado = nil
        speakerStatusText = ""
        // El notch se queda cuatro segundos mostrando cómo terminó, igual que el registro
        // de cara, y recién ahí baja.
        defer {
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.enrollResultado = self.speakerStatusText.isEmpty
                    ? "Listo." : self.speakerStatusText
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                self.enrolling = false
                self.enrollResultado = nil
            }
        }

        var tomas: [Data] = []
        for i in 0..<enrollTotal {
            speakerStatusText = "Hablá normal… (\(i + 1) de \(enrollTotal))"
            guard let (audio, _) = await recordChunkFixed(duration: 3.0), audio.count > 4096 else {
                speakerStatusText = "No se pudo grabar. Revisá el micrófono."
                return
            }
            tomas.append(audio)
            enrollProgress = i + 1
            // Un respiro entre tomas: si van pegadas se graba la misma entonación.
            try? await Task.sleep(nanoseconds: 700_000_000)
        }

        speakerStatusText = "Procesando…"
        do {
            let r = try await client.enrollSpeaker(samples: tomas)
            if r.ok {
                speakerStatusText = "Listo. Niki ya reconoce tu voz."
                await loadSpeakerStatus()
            } else {
                speakerStatusText = r.error ?? "No se pudo registrar la voz."
            }
        } catch {
            speakerStatusText = error.localizedDescription
        }
    }

    // MARK: - Proveedor del agente
    @Published var agentProviders: [NikiAgentProvider] = []
    @Published var agentSelection: NikiAgentModelSelection?
    @Published var agentRuntimeState: String = "?"
    @Published var agentSwitching = false
    @Published var agentError = ""
    /// Se está pidiendo la lista de proveedores.
    ///
    /// Hace falta porque la consulta tarda unos cuatro segundos —el backend levanta un
    /// Python para preguntarle al runtime— y mientras tanto la lista está vacía. Sin
    /// distinguir "vacía porque no cargó" de "vacía porque no hay", el panel afirmaba
    /// "Ningún proveedor tiene credencial. Definí su clave en .env" con cuatro
    /// proveedores conectados. Un cartel que dice algo falso y manda a editar un archivo
    /// es peor que no decir nada.
    @Published var agentProvidersCargando = false

    /// Carga proveedores y estado del runtime.
    func loadAgentProviders() async {
        // Solo la primera vez muestra "cargando": al refrescar ya hay una lista en
        // pantalla y vaciarla para volver a llenarla es un parpadeo sin sentido.
        agentProvidersCargando = agentProviders.isEmpty
        defer { agentProvidersCargando = false }
        do {
            let r = try await client.agentProviders()
            agentProviders = r.providers
            agentSelection = r.current
            agentError = ""
        } catch {
            agentError = error.localizedDescription
        }
        await refreshAgentStatus()
        await refreshLoginStatus()
    }

    func refreshAgentStatus() async {
        guard let s = try? await client.agentStatus() else { return }
        agentRuntimeState = s.state
        if let m = s.model { agentSelection = m }
    }

    /// Inicio de sesión en curso: la URL y el código que hay que abrir.
    @Published var pendingLogin: NikiProviderLogin?
    /// Qué proveedor está arrancando su login. Es el id y no un bool: con un bool
    /// compartido, tocar "conectar" en uno cambiaba el botón de todos.
    @Published var loginStartingFor: String?
    /// Sesión iniciada, por proveedor. Cada fila muestra lo suyo.
    @Published var loginConnected: [String: Bool] = [:]
    /// Cuál está esperando la aprobación en el navegador.
    @Published var loginWaitingFor: String?

    /// Consulta el estado de sesión de los proveedores que van por suscripción.
    func refreshLoginStatus() async {
        let porSuscripcion = agentProviders.filter { !$0.credentialReady && $0.authType != "api_key" }
        for p in porSuscripcion {
            if let r = try? await client.providerLoginStatus(p.id) {
                loginConnected[p.id] = r.loggedIn
            }
        }
    }

    /// Arranca el inicio de sesión de UN proveedor y espera a que se complete.
    ///
    /// El proceso del runtime queda esperando la aprobación del otro lado; acá se
    /// sondea hasta que la sesión aparece, para poder confirmarlo en pantalla en vez de
    /// dejar al usuario adivinando si funcionó.
    func startProviderLogin(_ p: NikiAgentProvider) async {
        guard loginStartingFor == nil else { return }
        loginStartingFor = p.id
        agentError = ""
        pendingLogin = nil
        do {
            pendingLogin = try await client.startProviderLogin(p.id)
            loginWaitingFor = p.id
        } catch {
            agentError = error.localizedDescription
            loginStartingFor = nil
            return
        }
        loginStartingFor = nil

        // Hasta 5 minutos: es lo que suele durar un código de dispositivo.
        for _ in 0..<100 {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard loginWaitingFor == p.id else { return }   // lo cerró a mano
            if let r = try? await client.providerLoginStatus(p.id), r.loggedIn {
                loginConnected[p.id] = true
                loginWaitingFor = nil
                pendingLogin = nil
                agentError = "Listo: \(p.name) quedó conectado."
                await loadAgentProviders()
                return
            }
        }
        loginWaitingFor = nil
        agentError = "No llegó la confirmación de \(p.name). Si aprobaste en el navegador, recargá el panel."
    }

    func dismissLogin() {
        pendingLogin = nil
        loginWaitingFor = nil
    }

    /// Cambia el proveedor y espera a que el runtime vuelva a estar listo.
    ///
    /// Se sondea en vez de asumir: el backend mata y relevanta el proceso, y sin esperar
    /// el siguiente turno saldría contra un runtime a medio arrancar.
    func switchAgentProvider(_ provider: NikiAgentProvider, model: String) async {
        guard !agentSwitching else { return }
        agentSwitching = true
        agentError = ""
        defer { agentSwitching = false }
        do {
            try await client.setAgentModel(provider: provider.id, model: model,
                                           baseUrl: provider.baseUrl)
            for _ in 0..<40 {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                await refreshAgentStatus()
                if agentRuntimeState == "ready" { return }
            }
            agentError = "El runtime no volvió a estar listo. Mirá el panel de diagnóstico."
        } catch {
            agentError = error.localizedDescription
        }
    }

    /// Motor de captura de la llamada. Vive lo que dura la conversación entera.
    private var capture: NikiVoiceCapture?
    /// Frase que quedó a medias esperando su continuación. Ver NikiTurnAssembler.
    /// Se pone en true en cuanto entra algo por el mic. Ver `armarPruebaDeVida`.
    private var micRecibioSenal = false
    private var micLivenessTask: Task<Void, Never>?
    private var pendingTurnText = ""
    private var pendingTurnAt = Date.distantPast
    /// Más allá de esto, lo que llegue ya no es la continuación de nada: es otro tema.
    /// Retomar tras respirar toma uno o dos segundos; cuatro deja margen de sobra sin
    /// llegar a pegar dos ideas distintas.
    private static let continuationWindow: TimeInterval = 4
    private var utteranceIterator: AsyncStream<NikiVoiceCapture.Utterance>.AsyncIterator?
    private var utteranceContinuation: AsyncStream<NikiVoiceCapture.Utterance>.Continuation?
    private var recordedFileURL: URL?
    private var audioPlayer: AVAudioPlayer?
    private var currentTtsFileURL: URL?
    /// Voz nativa del sistema — instantánea, sin ida y vuelta al backend. Se usa durante
    /// llamadas en vivo (autoVoice) para que la conversación se sienta en tiempo real; el
    /// backend Qwen3-TTS (más lento, voz personalizada) se reserva para reproducir un
    /// mensaje puntual desde el botón "Voz" del chat, donde la latencia importa menos.
    private let speechSynthesizer = AVSpeechSynthesizer()
    /// Utterances encoladas/sonando de la respuesta actual — 0 significa que Niki terminó
    /// de hablar del todo. Con TTS por oración, cada respuesta puede encolar varias.
    private var pendingSpeechCount = 0
    /// Cuántos caracteres del texto acumulado de la respuesta actual ya se mandaron a
    /// hablar — evita repetir oraciones ya encoladas a medida que llegan más tokens.
    private var speechWatermark = 0
    /// Utterances que todavía consideramos parte de la respuesta en curso. Sirve para
    /// descartar callbacks tardíos de una respuesta ya cancelada (ver stopAllSpeech).
    private var ownedUtterances = Set<ObjectIdentifier>()
    /// Pestillo de silencio: mientras esté puesto, nada se encola aunque sigan llegando
    /// tokens de la respuesta que se canceló.
    private var speechSuppressed = false
    /// Lo que Niki alcanzó a decir antes de que la cortaran. Es lo que permite retomar
    /// con "seguí" sin repetir desde el principio.
    private var interruptedReply = ""
    private var runtimeEventsTask: Task<Void, Never>?
    private var activeChatTask: Task<Void, Never>?
    private var titleGenerationTasks: [String: Task<Void, Never>] = [:]
    // Umbral de voz del modo conversación. Bajalo (más negativo) si tu mic es bajo.
    // Las ventanas de silencio viven en NikiVoiceCapture (silenceShort/silenceLong):
    // son adaptativas y el motor las decide frase a frase.
    private let sttSilenceThreshold: Float = -38.0   // dBFS

    /// Reloj de un turno de conversación. Cada etapa se marca donde ocurre y al cerrar el
    /// turno se vuelca una sola línea `[TURN]`. Sin esto cualquier "quedó más rápido" es
    /// una impresión: lo que importa es `total`, de que dejás de hablar a que Niki suena.
    struct TurnClock {
        var voiceEnded: Date?
        var chunkCut: Date?
        /// Cuándo el bucle recogió la frase. Puede ser mucho después del corte si el
        /// turno anterior seguía en curso — el motor captura sin parar, así que sin
        /// separar esto la métrica de subida mentía (7 s que en realidad eran cola).
        var pickedUp: Date?
        var uploadStart: Date?
        var sttDone: Date?
        var firstToken: Date?
        var firstAudio: Date?

        static func ms(_ from: Date?, _ to: Date?) -> String {
            guard let from, let to else { return "-" }
            return String(Int(to.timeIntervalSince(from) * 1000))
        }

        var line: String {
            "[TURN] endpoint=\(Self.ms(voiceEnded, chunkCut)) queued=\(Self.ms(chunkCut, pickedUp))"
                + " upload=\(Self.ms(pickedUp, uploadStart))"
                + " stt=\(Self.ms(uploadStart, sttDone)) ttft=\(Self.ms(sttDone, firstToken))"
                + " first_audio=\(Self.ms(sttDone, firstAudio)) total=\(Self.ms(voiceEnded, firstAudio))"
        }
    }
    private var turn = TurnClock()

    private let configKey = "niki.native.config"
    private let sessionKey = "niki.native.session"
    private weak var appDelegate: NikiAppDelegate?

    override init() {
        super.init()
        speechSynthesizer.delegate = self
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

    func moduleAvailability(for moduleID: NikiModuleID) -> NikiModuleAvailability {
        if let availability = operatorCapabilities.modules[moduleID.rawValue] {
            return availability
        }
        if NikiFeatureRegistry.alwaysVisibleModules.contains(moduleID) {
            return NikiModuleAvailability(state: .ready, reason: nil)
        }
        return NikiModuleAvailability(state: .hidden, reason: nil)
    }

    func shouldShowDockModule(_ moduleID: NikiModuleID) -> Bool {
        switch moduleAvailability(for: moduleID).state {
        case .ready, .beta, .flagged:
            return true
        case .hidden, .disabled:
            return false
        }
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

    func sendCurrentChat(channel: String = "niki-agent") async {
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
                attachments: attachments,
                channel: channel
            )
        }
    }

    func cancelCurrentChat() {
        guard chatBusy else { return }
        activeChatTask?.cancel()
        activeChatTask = nil
        stopAllSpeech()
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

    /// Botón "Voz" de un mensaje del chat. Usa la misma voz que la conversación
    /// (nativa, arranca al instante) en vez del TTS del backend, que tardaba 7-23s
    /// en devolver el audio. Además habla por oraciones, así empieza a sonar de
    /// inmediato en lugar de esperar a sintetizar el mensaje entero.
    func speakMessage(_ message: NikiChatMessage) async {
        let text = message.content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            voiceError = "Todavía no hay una respuesta de Niki para reproducir."
            return
        }
        speakStreaming(text)
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
        attachments: [NikiChatAttachment],
        channel: String = "niki-agent"
    ) async {
        if autoVoice {
            stopAllSpeech()
        }
        // Después de limpiar la respuesta anterior, esta sí puede hablar.
        allowSpeech()
        do {
            let final = try await client.streamChat(
                sessionID: sessionID,
                input: modelInput,
                messages: requestMessages,
                channel: channel,
                imagen: await cuadroParaElModelo()
            ) { [weak self] visible in
                guard let self else { return }
                if self.turn.firstToken == nil { self.turn.firstToken = Date() }
                self.replaceAssistantMessage(id: assistantID, in: sessionID, content: visible)
                self.agentState = .speaking
                self.runtimeSummary = visible
                if self.autoVoice {
                    self.speakNewSentences(from: visible)
                }
            }
            guard !Task.isCancelled else {
                finishCancelledChat(sessionID: sessionID, assistantID: assistantID)
                return
            }
            replaceAssistantMessage(id: assistantID, in: sessionID, content: final)
            finalizeSession(sessionID: sessionID, summaryText: final.isEmpty ? visibleText : final)
            agentState = .success
            if autoVoice, !final.isEmpty {
                speakRemainder(of: final)
            }
            scheduleReturnToIdle()
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
        // El contexto solo cambia cuando termina un turno: se relee acá y no en un timer.
        Task { await cargarContexto() }
    }

    func setActiveSession(_ id: String) {
        activeSessionID = id
        // Cada conversación tiene su propio contexto; el número anterior no vale más.
        contexto = .vacio
        Task { await cargarContexto() }
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
            voiceError = "No se concedió permiso para usar el micrófono."
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
                voiceError = "No se pudo iniciar la grabación del micrófono."
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
                voiceError = "No detecté voz. Inténtalo de nuevo."
                voiceProcessing = false
                return
            }
            let response = try await client.transcribeAudio(data: data, language: "es")
            guard response.ok, let text = response.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
                voiceError = response.error ?? "No pude transcribir lo que dijiste."
                voiceProcessing = false
                return
            }
            voiceTranscript = text
            chatInput = text
            agentState = .idle
            runtimeSummary = text
            recordedFileURL = nil
            if callModeActive {
                await sendCurrentChat(channel: "niki-voice")
            }
        } catch {
            voiceError = error.localizedDescription
        }
        voiceProcessing = false
    }

    func speakLastAssistantReply() async {
        guard let text = activeMessages.reversed().first(where: { $0.role == .assistant })?.content,
              !text.isEmpty else {
            voiceError = "Todavía no hay una respuesta de Niki para reproducir."
            return
        }
        speakStreaming(text)
    }

    func testVoiceSample() async {
        speakStreaming("Hola, soy Niki. ¿En qué puedo ayudarte hoy?")
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
        await refreshRuntimeCapabilities()
        await refreshComputerCapabilities()
        await refreshComputerRecent()
        await refreshRemoteSessions()
        await refreshRemoteProfiles()
        await refreshMcpServers()
        await refreshDiscoverCapabilities()
        await refreshSettingsData()
        // Las dos huellas, al arrancar. Antes el estado de la cara se cargaba solo al
        // abrir el panel de Identidad: si Esteban nunca lo abría, `hayPerfil` quedaba en
        // false y la verificación no corría nunca — con la cara registrada y todo.
        await cargarEstadoDeCara()
        await loadSpeakerStatus()
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
            pendingApprovals = status.approvals?.pending ?? []
        } catch {
            runtimeConnected = false
            runtimeSummary = error.localizedDescription
            agentState = .error
        }
    }

    func refreshRuntimeCapabilities() async {
        do {
            let response = try await client.runtimeCapabilities()
            operatorCapabilities = response.capabilities
            computerAvailability = computerAvailabilityFromCapabilities(response.capabilities)
            if moduleAvailability(for: .mcp).state == .hidden {
                mcpServers = []
            }
            if moduleAvailability(for: .diagnostics).state == .hidden {
                diagnostics = []
                latestDiagnostic = nil
            }
            if moduleAvailability(for: .discover).state == .hidden {
                discoverCapabilities = []
            }
            sanitizeSelectionForCapabilities()
        } catch {
            settingsError = error.localizedDescription
            mcpServers = []
            diagnostics = []
            latestDiagnostic = nil
            discoverCapabilities = []
            sanitizeSelectionForCapabilities()
        }
    }

    func respondToApproval(_ approval: NikiRuntimeApprovalRequest, choice: String, resolveAll: Bool = false) async {
        guard approvalActionBusyID == nil else { return }
        approvalActionBusyID = approval.id
        approvalActionError = ""
        do {
            try await client.respondToApproval(runID: approval.runId, choice: choice, resolveAll: resolveAll)
        } catch {
            approvalActionError = error.localizedDescription
        }
        approvalActionBusyID = nil
    }

    func refreshComputerRecent() async {
        do {
            let response = try await client.computerRecent(limit: 12)
            recentComputerActions = response.recent
        } catch {
            recentComputerActions = []
        }
    }

    func refreshComputerCapabilities() async {
        do {
            let response = try await client.computerCapabilities()
            computerCapabilities = response.capabilities
            computerPermissions = response.permissions
            computerSurfaceSummary = response.surface?.summary ?? ""
            computerRecommendedActions = response.surface?.recommendedActions ?? []
        } catch {
            computerCapabilities = []
            computerPermissions = nil
            computerSurfaceSummary = ""
            computerRecommendedActions = []
        }
    }

    func runComputerAction(_ action: String, params: [String: Any] = [:]) async {
        guard !computerActionBusy else { return }
        computerActionBusy = true
        computerActionError = ""
        latestComputerResult = ""
        do {
            let response = try await client.computerAction(action: action, params: params)
            if response.ok {
                absorbComputerActionArtifacts(response)
                latestComputerResult = summarizeComputerActionResult(response)
                await refreshComputerRecent()
            } else {
                computerActionError = response.error ?? "Computer action failed."
            }
        } catch {
            computerActionError = error.localizedDescription
        }
        computerActionBusy = false
    }

    func refreshComputerViewport() async {
        guard !computerViewportRefreshing else { return }
        computerViewportRefreshing = true
        defer { computerViewportRefreshing = false }
        do {
            let response = try await client.computerAction(action: "screen_capture")
            if response.ok {
                absorbComputerActionArtifacts(response)
                computerViewportUpdatedAt = timestampLabel()
            } else {
                computerActionError = response.error ?? "Viewport refresh failed."
            }
        } catch {
            computerActionError = error.localizedDescription
        }
    }

    func setComputerViewportAutoRefresh(_ enabled: Bool) {
        computerViewportAutoRefreshEnabled = enabled
        if enabled {
            startComputerViewportLoop()
        } else {
            stopComputerViewportLoop()
        }
    }

    func stopComputerViewportLoop() {
        computerViewportTask?.cancel()
        computerViewportTask = nil
        computerViewportRefreshing = false
    }

    func maintainComputerViewportLoop() {
        guard computerViewportAutoRefreshEnabled else {
            stopComputerViewportLoop()
            return
        }
        if selection == .computer {
            startComputerViewportLoop()
        } else {
            stopComputerViewportLoop()
        }
    }

    func computerDraftValue(actionID: String, key: String) -> String {
        computerActionDrafts[actionID]?[key] ?? ""
    }

    func setComputerDraftValue(actionID: String, key: String, value: String) {
        var current = computerActionDrafts[actionID] ?? [:]
        current[key] = value
        computerActionDrafts[actionID] = current
    }

    func runComputerOperatorAction(_ action: NikiComputerOperatorAction) async {
        var params: [String: Any] = [:]
        if let base = action.params {
            for (key, value) in base {
                params[key] = value
            }
        }
        if let inputs = action.inputs {
            for input in inputs {
                let value = computerDraftValue(actionID: action.id, key: input.key)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !value.isEmpty {
                    params[input.key] = value
                }
            }
        }
        await runComputerAction(action.capability, params: params)
    }

    func canRunComputerOperatorAction(_ action: NikiComputerOperatorAction) -> Bool {
        guard action.state == "ready" else { return false }
        guard let inputs = action.inputs, !inputs.isEmpty else { return true }
        return inputs.allSatisfy { input in
            !computerDraftValue(actionID: action.id, key: input.key)
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .isEmpty
        }
    }

    func refreshRemoteSessions() async {
        do {
            sessionActionError = ""
            let response = try await client.runtimeSessions()
            remoteSessions = response.sessions
            reconcileActiveProfile(fromProfiles: remoteProfiles, sessions: response.sessions)
        } catch {
            sessionActionError = error.localizedDescription
            remoteSessions = []
        }
    }

    func refreshRemoteProfiles() async {
        do {
            let response = try await client.runtimeProfiles()
            remoteProfiles = response.profiles
            reconcileActiveProfile(fromProfiles: response.profiles, sessions: remoteSessions)
        } catch {
            remoteProfiles = []
        }
    }

    // ── Dataset ──────────────────────────────────────────────────────────────
    //
    // Lo que se guarda de las conversaciones para poder entrenar un modelo propio. Todo
    // pasa por el backend; acá solo se muestra y se decide.

    // ── Consola de debug ─────────────────────────────────────────────────────

    /// Cuántas líneas se guardan. Con cincuenta herramientas y una sesión de una hora,
    /// sin tope esto crece hasta que la lista de SwiftUI se arrastra.
    static let consolaMaximo = 500

    private func registrarEnConsola(_ entrada: NikiConsoleEntry) {
        guard !consolaEnPausa else { return }
        consola.insert(entrada, at: 0)
        if consola.count > Self.consolaMaximo {
            consola = Array(consola.prefix(Self.consolaMaximo))
        }
    }

    func limpiarConsola() {
        consola = []
    }

    /// Todo lo que hay en la consola como texto, para pegarlo en otro lado. Es la razón
    /// principal por la que uno mira una consola: llevarse el error a algún lugar donde
    /// pueda hacer algo con él.
    func consolaComoTexto() -> String {
        let formato = DateFormatter()
        formato.dateFormat = "HH:mm:ss"
        // Se invierte para que quede en orden cronológico: al leerlo fuera de la app, lo
        // de arriba primero es lo que uno espera.
        return consola.reversed().map { e in
            let cabeza = "[\(formato.string(from: e.at))] \(e.level.uppercased()) \(e.source)/\(e.type)"
            let cuerpo = e.summary.isEmpty ? e.title : "\(e.title) — \(e.summary)"
            return e.detail.map { "\(cabeza)\n  \(cuerpo)\n  \($0)" } ?? "\(cabeza)\n  \(cuerpo)"
        }.joined(separator: "\n")
    }

    /// Relee el contexto de la sesión abierta. Silencioso: si falla, el indicador no se
    /// muestra, pero no se le avisa a nadie — no es un error que le importe al usuario.
    func cargarContexto() async {
        let sesion = activeSessionID
        guard let medido = try? await client.agentContexto(sessionID: sesion) else { return }
        // La sesión pudo cambiar mientras se medía; pisar el indicador con el número de
        // otra conversación sería peor que no tenerlo.
        guard sesion == activeSessionID else { return }
        contexto = medido
    }

    func cargarDataset() async {
        do {
            datasetError = ""
            dataset = try await client.datasetResumen()
        } catch {
            datasetError = error.localizedDescription
        }
    }

    func cambiarCapturaDataset(_ encendida: Bool) async {
        guard !datasetOcupado else { return }
        datasetOcupado = true
        defer { datasetOcupado = false }
        do {
            datasetError = ""
            dataset = try await client.datasetCaptura(encendida: encendida)
        } catch {
            datasetError = error.localizedDescription
        }
    }

    /// Borra todo lo capturado. No se puede deshacer: la confirmación la pide la vista.
    func borrarDataset() async {
        guard !datasetOcupado else { return }
        datasetOcupado = true
        defer { datasetOcupado = false }
        do {
            datasetError = ""
            dataset = try await client.datasetBorrar()
        } catch {
            datasetError = error.localizedDescription
        }
    }

    func refreshMcpServers() async {
        do {
            mcpActionError = ""
            let response = try await client.runtimeMcpServers()
            mcpServers = response.servers
        } catch {
            mcpActionError = error.localizedDescription
            mcpServers = []
        }
    }

    func setRuntimeMcpServer(_ server: NikiMcpServer, enabled: Bool) async {
        guard mcpActionBusyID == nil else { return }
        mcpActionBusyID = server.id
        mcpActionError = ""
        do {
            let response = try await client.updateRuntimeMcpServer(id: server.id, enabled: enabled)
            mcpServers = response.servers
        } catch {
            mcpActionError = error.localizedDescription
        }
        mcpActionBusyID = nil
    }

    func refreshDiscoverCapabilities() async {
        do {
            let response = try await client.runtimeDiscoverCapabilities(profileID: activeProfileID)
            activeProfileID = response.profileId
            discoverCapabilities = response.capabilities
        } catch {
            discoverCapabilities = []
        }
    }

    func useRemoteProfile(_ profileID: String) async {
        let normalized = profileID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty else { return }
        activeProfileID = normalized
        await refreshDiscoverCapabilities()
    }

    func requestSessionHandoff(_ session: NikiRemoteSession, to platform: String) async {
        guard sessionActionBusyID == nil else { return }
        sessionActionBusyID = session.id
        sessionActionError = ""
        latestSessionActionSummary = ""
        do {
            let response = try await client.requestSessionHandoff(sessionID: session.id, platform: platform)
            latestSessionActionSummary = "Handoff requested to \(response.platform ?? platform)."
            await refreshRemoteSessions()
        } catch {
            sessionActionError = error.localizedDescription
        }
        sessionActionBusyID = nil
    }

    func requestSessionUndo(_ session: NikiRemoteSession) async {
        guard sessionActionBusyID == nil else { return }
        sessionActionBusyID = session.id
        sessionActionError = ""
        latestSessionActionSummary = ""
        do {
            let response = try await client.requestSessionUndo(sessionID: session.id)
            if let preview = response.preview, !preview.isEmpty {
                latestSessionActionSummary = "Undid last exchange: \(preview)"
            } else {
                latestSessionActionSummary = "Last Hermes exchange removed."
            }
            await refreshRemoteSessions()
        } catch {
            sessionActionError = error.localizedDescription
        }
        sessionActionBusyID = nil
    }

    private func startTitleGenerationIfNeeded(sessionID: String, firstPrompt: String) {
        guard titleGenerationTasks[sessionID] == nil else { return }
        guard let session = chatSessions.first(where: { $0.id == sessionID }) else { return }
        let currentTitle = session.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard currentTitle.isEmpty || currentTitle == "New chat" || currentTitle == "Chat" else { return }

        titleGenerationTasks[sessionID] = Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.titleGenerationTasks[sessionID] = nil }
            // El título sale del MISMO modelo remoto que la respuesta. Lanzarlo en paralelo
            // durante una conversación de voz le compite recursos al turno que el usuario
            // está esperando escuchar, así que esperamos a que la respuesta termine.
            // En chat de texto no molesta, pero el título tampoco corre prisa: en ambos
            // casos lo dejamos para cuando la conversación esté en reposo.
            while self.chatBusy || self.speaking {
                try? await Task.sleep(nanoseconds: 200_000_000)
                if Task.isCancelled { return }
            }
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
        runtimeEventsTask = client.streamRuntimeEvents { [weak self] envelope in
            guard let self else { return }
            switch envelope.kind {
            case "partial":
                guard let patch = envelope.patch else { return }
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
            case "capabilities":
                if let payload = envelope.payload {
                    self.operatorCapabilities = payload
                    self.computerAvailability = self.computerAvailabilityFromCapabilities(payload)
                    self.sanitizeSelectionForCapabilities()
                    Task { await self.refreshComputerCapabilities() }
                    Task { await self.refreshComputerRecent() }
                    Task { await self.refreshDiscoverCapabilities() }
                }
            case "sessions_snapshot":
                if let snapshot = envelope.sessionsSnapshot {
                    self.remoteSessions = snapshot.sessions
                    self.reconcileActiveProfile(fromProfiles: self.remoteProfiles, sessions: snapshot.sessions)
                }
            case "mcp_snapshot":
                if let snapshot = envelope.mcpSnapshot {
                    self.mcpServers = snapshot.servers
                    self.mcpActionBusyID = nil
                }
            case "profiles_snapshot":
                if let snapshot = envelope.profilesSnapshot {
                    self.remoteProfiles = snapshot.profiles
                    self.reconcileActiveProfile(fromProfiles: snapshot.profiles, sessions: self.remoteSessions)
                }
            case "session_action":
                if let action = envelope.sessionAction {
                    self.latestSessionActionSummary = action.summary
                    self.sessionActionError = action.status == "error" ? (action.detail ?? action.summary) : ""
                    self.sessionActionBusyID = nil
                }
            case "approval_request":
                if let data = envelope.approvalRequest {
                    self.pendingApprovals.removeAll { $0.id == data.id }
                    self.pendingApprovals.insert(data, at: 0)
                    self.approvalActionBusyID = nil
                    if self.selection == nil {
                        self.selection = .approvals
                    }
                }
            case "approval_resolved":
                if let data = envelope.approvalResolution {
                    self.latestApprovalResolution = data
                    self.approvalActionBusyID = nil
                    self.pendingApprovals.removeAll { $0.id == data.id }
                }
            case "event":
                // El backend manda esto desde siempre y la app lo tiraba: no había caso.
                // Es cada llamada a herramienta, cada error del runtime, cada turno.
                if let data = envelope.event {
                    self.registrarEnConsola(NikiConsoleEntry(from: data))
                }
            case "diagnostics":
                if let data = envelope.diagnostic {
                    self.latestDiagnostic = data
                    self.diagnostics.removeAll { $0.id == data.id }
                    self.diagnostics.insert(data, at: 0)
                    if self.diagnostics.count > 25 {
                        self.diagnostics = Array(self.diagnostics.prefix(25))
                    }
                }
            case "surface":
                if let data = envelope.surface {
                    withAnimation(.spring(response: 0.55, dampingFraction: 0.82)) {
                        self.activeSurface = data
                    }
                }
            case "surface_clear":
                withAnimation(.spring(response: 0.45, dampingFraction: 0.86)) {
                    self.activeSurface = nil
                }
            default:
                break
            }
        }
    }

    func dismissActiveSurface() {
        withAnimation(.spring(response: 0.45, dampingFraction: 0.86)) {
            activeSurface = nil
        }
        Task {
            try? await client.clearSurface()
        }
    }

    private func computerAvailabilityFromCapabilities(_ capabilities: NikiOperatorCapabilities) -> NikiComputerAvailability {
        let availability = capabilities.modules[NikiModuleID.computer.rawValue]
        return NikiComputerAvailability(
            state: availability?.state ?? .hidden,
            reason: availability?.reason
        )
    }

    private func sanitizeSelectionForCapabilities() {
        guard let selection else { return }
        switch selection {
        case .computer where !shouldShowDockModule(.computer):
            stopComputerViewportLoop()
            self.selection = .chat
        case .approvals where !shouldShowDockModule(.approvals):
            self.selection = .chat
        case .sessions where !shouldShowDockModule(.sessions):
            self.selection = .chat
        case .mcp where !shouldShowDockModule(.mcp):
            self.selection = .chat
        case .diagnostics where !shouldShowDockModule(.diagnostics):
            self.selection = .chat
        case .discover where !shouldShowDockModule(.discover):
            self.selection = .chat
        default:
            break
        }
    }

    private func startComputerViewportLoop() {
        guard selection == .computer else { return }
        if computerViewportTask != nil { return }
        computerViewportTask = Task { @MainActor [weak self] in
            guard let self else { return }
            while !Task.isCancelled && self.computerViewportAutoRefreshEnabled && self.selection == .computer {
                await self.refreshComputerViewport()
                try? await Task.sleep(for: .seconds(3))
            }
            self.computerViewportTask = nil
            self.computerViewportRefreshing = false
        }
    }

    private func timestampLabel() -> String {
        let formatter = DateFormatter()
        formatter.timeStyle = .medium
        formatter.dateStyle = .none
        return formatter.string(from: Date())
    }

    private func reconcileActiveProfile(fromProfiles profiles: [NikiRemoteProfile], sessions: [NikiRemoteSession]) {
        let current = activeProfileID.trimmingCharacters(in: .whitespacesAndNewlines)
        if !current.isEmpty {
            let stillInProfiles = profiles.contains(where: { $0.id == current })
            let stillInSessions = sessions.contains(where: { $0.profileId == current })
            if stillInProfiles || stillInSessions {
                return
            }
        }

        if let firstProfile = profiles.first?.id, !firstProfile.isEmpty {
            activeProfileID = firstProfile
            return
        }
        if let firstSessionProfile = sessions.first?.profileId, !firstSessionProfile.isEmpty {
            activeProfileID = firstSessionProfile
            return
        }
        activeProfileID = "default"
    }

    private func summarizeComputerActionResult(_ response: NikiComputerActionResponse) -> String {
        if let text = response.text, !text.isEmpty {
            return text
        }
        if let result = response.result, !result.isEmpty {
            return result
        }
        if let stdout = response.stdout, !stdout.isEmpty {
            return stdout
        }
        if let path = response.path, !path.isEmpty {
            if let bytes = response.bytes {
                return "Saved to \(path) (\(bytes) bytes)."
            }
            return "Saved to \(path)."
        }
        if let raw = response.raw, !raw.isEmpty {
            return raw
        }
        return "Computer action completed."
    }

    private func absorbComputerActionArtifacts(_ response: NikiComputerActionResponse) {
        if let imageBase64 = response.imageBase64,
           let data = Data(base64Encoded: imageBase64),
           let image = NSImage(data: data) {
            latestComputerCapture = image
        }
        if let path = response.path, !path.isEmpty {
            latestComputerCapturePath = path
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
                voiceError = response.error ?? "No pude generar la voz de Niki."
                speaking = false
                return
            }
            let ext = audioFileExtension(format: response.format, mime: response.mime)
            let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent("niki-tts-\(UUID().uuidString).\(ext)")
            try data.write(to: fileURL, options: .atomic)
            currentTtsFileURL = fileURL
            audioPlayer = try AVAudioPlayer(contentsOf: fileURL)
            audioPlayer?.delegate = self
            audioPlayer?.isMeteringEnabled = true
            audioPlayer?.prepareToPlay()
            audioPlayer?.play()
            agentState = .speaking
            startTtsLevelMonitor()
        } catch {
            voiceError = "No pude generar la voz de Niki. Revisa que Qwen3-TTS esté configurado."
            speaking = false
            stopTtsLevelMonitor()
            if agentState == .speaking {
                agentState = .idle
            }
        }
    }

    /// Síntesis nativa de macOS — arranca a hablar al instante (sin red, sin carga de
    /// modelo), para que la llamada en vivo se sienta como una conversación real.
    private func speakNative(text: String) {
        stopAllSpeech()
        enqueueSpeech(text)
    }

    /// Lee un texto ya completo pero **por oraciones**: encola la primera y sigue con
    /// el resto, en vez de mandar todo el bloque como una sola utterance. Empieza a
    /// sonar igual de rápido y se puede cortar limpio a mitad de camino.
    func speakStreaming(_ text: String) {
        stopAllSpeech()
        allowSpeech()
        let clean = sanitizeForTts(text)
        let (sentences, endIndex) = Self.extractCompleteSentences(from: clean, startingAt: clean.startIndex)
        for sentence in sentences { enqueueSpeech(sentence) }
        let tail = String(clean[endIndex...]).trimmingCharacters(in: .whitespacesAndNewlines)
        if !tail.isEmpty { enqueueSpeech(tail) }
    }

    /// Corta cualquier reproducción en curso (botón "Voz" de otro mensaje, o el usuario
    /// que quiere silencio).
    func stopSpeaking() {
        stopAllSpeech()
        finishNativeSpeech()
    }

    /// Corta toda la cola de habla (utterance actual + encoladas) y resetea el
    /// seguimiento de la respuesta en curso. Se usa al empezar una respuesta nueva o
    /// al cancelar el turno actual — nunca queremos que Niki siga hablando algo viejo.
    ///
    /// Ojo: `stopSpeaking` dispara `didCancel` de forma ASÍNCRONA para cada utterance
    /// encolada. Al vaciar `ownedUtterances` acá, esos callbacks tardíos ya no
    /// encuentran su utterance y se ignoran — si no, llegarían después de que la
    /// respuesta siguiente ya arrancó y apagarían `speaking` mientras Niki todavía
    /// habla (y el loop de conversación se pondría a grabar encima de su propia voz).
    private func stopAllSpeech() {
        ownedUtterances.removeAll()
        if speechSynthesizer.isSpeaking {
            speechSynthesizer.stopSpeaking(at: .immediate)
        }
        pendingSpeechCount = 0
        speechWatermark = 0
        // Callar la cola no alcanzaba. El stream del modelo sigue llegando y, con el
        // watermark en 0, la siguiente tanda de tokens hacía que Niki empezara a hablar
        // la respuesta OTRA VEZ desde el principio — que es exactamente lo que se veía
        // al pedirle que parara. El pestillo dura hasta que arranca una respuesta nueva.
        speechSuppressed = true
    }

    /// Habilita de nuevo la voz. Solo lo llama el arranque de una respuesta nueva.
    private func allowSpeech() {
        speechSuppressed = false
    }

    /// Encola una oración (o el texto que sea) para hablar. Si ya hay algo sonando,
    /// se suma a la cola de AVSpeechSynthesizer en vez de interrumpirlo — así una
    /// respuesta puede hablarse oración por oración a medida que llega, en vez de
    /// esperar a que el LLM termine de generar todo el texto.
    private func enqueueSpeech(_ text: String) {
        guard !speechSuppressed else { return }
        let trimmed = sanitizeForTts(text).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        voiceError = ""
        if turn.firstAudio == nil { turn.firstAudio = Date() }
        if pendingSpeechCount == 0 {
            speaking = true
            agentState = .speaking
            startNativeTtsLevelAnimation()
        }
        pendingSpeechCount += 1
        let utterance = AVSpeechUtterance(string: trimmed)
        utterance.voice = AVSpeechSynthesisVoice(language: "es-ES") ?? AVSpeechSynthesisVoice(language: "es-US")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        utterance.pitchMultiplier = 1.02
        ownedUtterances.insert(ObjectIdentifier(utterance))
        sttLog("[TTS] encolando (\(pendingSpeechCount)): \"\(trimmed.prefix(50))\"")
        speechSynthesizer.speak(utterance)
    }

    /// Revisa el texto acumulado de la respuesta en curso desde el último watermark y
    /// encola cualquier oración completa nueva (termina en . ! ? …) — el resto (una
    /// oración a medio escribir) queda para la próxima llamada o para speakRemainder.
    private func speakNewSentences(from visible: String) {
        let count = visible.count
        guard speechWatermark < count else { return }
        let startIndex = visible.index(visible.startIndex, offsetBy: speechWatermark)
        var (sentences, newIndex) = Self.extractCompleteSentences(from: visible, startingAt: startIndex)

        // Arranque temprano: para la PRIMERA frase de la respuesta no esperamos al punto
        // final — cortamos en la primera pausa natural (coma, punto y coma, guion) una vez
        // que hay material suficiente. El modelo tarda ~3,5s en el primer token, así que
        // este atajo adelanta casi un segundo el momento en que Niki empieza a sonar.
        // A partir de la segunda ya vamos por oraciones completas, que suenan mejor.
        if sentences.isEmpty, speechWatermark == 0, pendingSpeechCount == 0 {
            if let opener = Self.earlyClause(in: visible, minLength: 28) {
                sentences = [String(visible[..<opener]).trimmingCharacters(in: .whitespacesAndNewlines)]
                newIndex = opener
            }
        }

        guard !sentences.isEmpty else { return }
        speechWatermark = visible.distance(from: visible.startIndex, to: newIndex)
        for sentence in sentences {
            enqueueSpeech(sentence)
        }
    }

    /// Al terminar el stream, habla lo que haya quedado sin puntuación de cierre (la
    /// cola de la respuesta), o la respuesta completa si nunca se encoló nada (p.ej.
    /// una respuesta corta de una sola frase sin punto final).
    private func speakRemainder(of finalText: String) {
        let count = finalText.count
        if speechWatermark < count {
            let startIndex = finalText.index(finalText.startIndex, offsetBy: speechWatermark)
            let remainder = String(finalText[startIndex...])
            speechWatermark = count
            enqueueSpeech(remainder)
        } else if pendingSpeechCount == 0 {
            enqueueSpeech(finalText)
        }
    }

    /// Corta en oraciones completas a partir de startingAt. No es un parser perfecto —
    /// cubre los finales comunes (. ! ? … ¡ ¿ en pares) y evita cortar en decimales
    /// tipo "3.14". Devuelve las oraciones encontradas y hasta dónde se procesó.
    /// Primera pausa natural (`,` `;` `:` `—`) pasada `minLength`, para poder empezar a
    /// hablar antes de que llegue el punto final. Devuelve el índice justo después de la
    /// pausa, o nil si todavía no hay material suficiente.
    private static func earlyClause(in text: String, minLength: Int) -> String.Index? {
        guard text.count >= minLength else { return nil }
        let breakers: Set<Character> = [",", ";", ":", "—", "–"]
        var i = text.index(text.startIndex, offsetBy: minLength)
        while i < text.endIndex {
            if breakers.contains(text[i]) { return text.index(after: i) }
            i = text.index(after: i)
        }
        return nil
    }

    private static func extractCompleteSentences(from text: String, startingAt start: String.Index) -> (sentences: [String], newIndex: String.Index) {
        var sentences: [String] = []
        var lastBreak = start
        var i = start
        let enders: Set<Character> = [".", "!", "?", "…"]
        let closers: Set<Character> = ["\"", "”", "’", "'", ")"]

        while i < text.endIndex {
            let c = text[i]
            if enders.contains(c) {
                let isDecimalPoint = c == "."
                    && i > text.startIndex
                    && text[text.index(before: i)].isNumber
                    && text.index(after: i) < text.endIndex
                    && text[text.index(after: i)].isNumber
                if !isDecimalPoint {
                    var end = text.index(after: i)
                    while end < text.endIndex, closers.contains(text[end]) {
                        end = text.index(after: end)
                    }
                    let sentence = String(text[lastBreak..<end]).trimmingCharacters(in: .whitespacesAndNewlines)
                    if !sentence.isEmpty {
                        sentences.append(sentence)
                    }
                    lastBreak = end
                    i = end
                    continue
                }
            }
            i = text.index(after: i)
        }
        return (sentences, lastBreak)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            self?.decrementPendingSpeech(id)
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            self?.decrementPendingSpeech(id)
        }
    }

    /// Solo cuenta utterances que seguimos considerando "nuestras". Un callback de una
    /// respuesta ya cancelada llega tarde y debe ignorarse (ver stopAllSpeech).
    private func decrementPendingSpeech(_ id: ObjectIdentifier) {
        guard ownedUtterances.remove(id) != nil else { return }
        pendingSpeechCount = max(0, pendingSpeechCount - 1)
        if pendingSpeechCount == 0 {
            sttLog("[TTS] terminó de hablar")
            finishNativeSpeech()
        }
    }

    private func finishNativeSpeech() {
        speaking = false
        stopTtsLevelMonitor()
        // Volver solo a la forma de reposo. Antes solo se reseteaba desde `.speaking`,
        // pero al terminar un turno el estado ya es `.success` (se setea antes de hablar),
        // así que el orbe se quedaba clavado en esa figura hasta el turno siguiente.
        if agentState == .speaking || agentState == .success {
            agentState = .idle
        }
    }

    /// Como AVSpeechSynthesizer no expone amplitud real, animamos audioLevel con un pulso
    /// suave mientras habla — el orbe se sigue sintiendo vivo aunque no sea metering exacto.
    private func startNativeTtsLevelAnimation() {
        ttsLevelTask?.cancel()
        ttsLevelTask = Task { @MainActor [weak self] in
            var t: Double = 0
            while let self, self.speechSynthesizer.isSpeaking, !Task.isCancelled {
                t += 0.06
                self.audioLevel = Float(0.35 + 0.28 * abs(sin(t * 3.4)))
                try? await Task.sleep(nanoseconds: 60_000_000)
            }
            self?.audioLevel = 0
        }
    }

    /// Alimenta audioLevel con el volumen de la voz de Niki mientras suena el TTS,
    /// para que el orbe reaccione cuando Niki habla (igual que reacciona a tu voz al grabar).
    private func startTtsLevelMonitor() {
        ttsLevelTask?.cancel()
        ttsLevelTask = Task { @MainActor [weak self] in
            while let self, self.audioPlayer?.isPlaying == true, !Task.isCancelled {
                self.audioPlayer?.updateMeters()
                let power = self.audioPlayer?.averagePower(forChannel: 0) ?? -160
                self.audioLevel = Float(max(0, min(1, (power + 50.0) / 50.0)))
                try? await Task.sleep(nanoseconds: 60_000_000)  // ~16 fps
            }
            self?.audioLevel = 0
        }
    }

    private func stopTtsLevelMonitor() {
        ttsLevelTask?.cancel()
        ttsLevelTask = nil
        audioLevel = 0
    }

    // MARK: - Mic device enumeration (CoreAudio)

    func refreshMicDevices() {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var dataSize: UInt32 = 0
        AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &dataSize)
        let count = Int(dataSize) / MemoryLayout<AudioDeviceID>.size
        var ids = [AudioDeviceID](repeating: 0, count: count)
        AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &dataSize, &ids)

        var found: [(id: AudioDeviceID, name: String)] = []
        for deviceID in ids {
            var inputAddr = AudioObjectPropertyAddress(
                mSelector: kAudioDevicePropertyStreamConfiguration,
                mScope: kAudioDevicePropertyScopeInput,
                mElement: kAudioObjectPropertyElementMain
            )
            var sz: UInt32 = 0
            AudioObjectGetPropertyDataSize(deviceID, &inputAddr, 0, nil, &sz)
            guard sz > 0 else { continue }

            var nameAddr = AudioObjectPropertyAddress(
                mSelector: kAudioObjectPropertyName,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            var nameRef: CFString = "" as CFString
            var nameSz = UInt32(MemoryLayout<CFString>.size)
            AudioObjectGetPropertyData(deviceID, &nameAddr, 0, nil, &nameSz, &nameRef)
            found.append((id: deviceID, name: nameRef as String))
        }
        sttLog("[STT] mics disponibles: \(found.map { "\($0.name)(id=\($0.id))" }.joined(separator: ", "))")
        availableMicDevices = found
    }

    /// Entradas virtuales conocidas. No son micrófonos: son ruteadores de audio de otras
    /// apps. Una de ellas ("B2 Microphone") colgó CoreAudio y congeló la app entera —
    /// `AVAudioRecorder.record()` se quedó esperando un mutex para siempre.
    private static let micsVirtuales = [
        "b2 ", "zoom", "blackhole", "loopback", "soundflower", "aggregate",
        "multi-output", "virtual", "obs", "krisp", "vb-cable", "existential",
    ]

    /// ¿Este dispositivo parece una entrada física de verdad?
    static func esMicFisico(_ nombre: String) -> Bool {
        let n = nombre.lowercased()
        // Las salidas también aparecen enumeradas; no sirven para grabar.
        if n.contains("bocina") || n.contains("speaker") || n.contains("output") { return false }
        return !micsVirtuales.contains { n.contains($0) }
    }

    /// Elige el mejor micrófono disponible: prefiere el interno del Mac, después
    /// cualquier entrada física, y solo cae en una virtual si no hay otra cosa.
    func elegirMicrofono() {
        let fisicos = availableMicDevices.filter { Self.esMicFisico($0.name) }
        let elegido = fisicos.first(where: { $0.name.lowercased().contains("macbook") })
            ?? fisicos.first
            ?? availableMicDevices.first

        guard let elegido else {
            sttLabStatus = "⚠️ No hay ningún micrófono disponible"
            sttLog("[STT] sin micrófonos")
            return
        }
        if !Self.esMicFisico(elegido.name) {
            sttLog("[STT] ⚠️ solo hay entradas virtuales; usando \(elegido.name)")
        }
        sttLog("[STT] mic elegido: \(elegido.name) (id=\(elegido.id))"
               + " — descartados: \(availableMicDevices.filter { !Self.esMicFisico($0.name) }.map(\.name).joined(separator: ", "))")
        selectMicDevice(elegido.id)
    }

    private func nativeMicSampleRate() -> Double {
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var deviceID: AudioDeviceID = kAudioObjectUnknown
        var sz = UInt32(MemoryLayout<AudioDeviceID>.size)
        AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &sz, &deviceID)

        if deviceID == kAudioObjectUnknown { return 44_100 }

        var rateAddr = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyNominalSampleRate,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var rate: Float64 = 44_100
        var rateSz = UInt32(MemoryLayout<Float64>.size)
        AudioObjectGetPropertyData(deviceID, &rateAddr, 0, nil, &rateSz, &rate)
        return rate > 0 ? rate : 44_100
    }

    func selectMicDevice(_ deviceID: AudioDeviceID) {
        selectedMicDeviceID = deviceID
        sttLog("[STT] mic seleccionado: id=\(deviceID) name=\(availableMicDevices.first(where: { $0.id == deviceID })?.name ?? "?")")
        if deviceID == 0 { return }
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var mutableID = deviceID
        let status = AudioObjectSetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil,
            UInt32(MemoryLayout<AudioDeviceID>.size), &mutableID
        )
        sttLog("[STT] setDefaultInputDevice status=\(status)")
    }

    // MARK: - STT Lab (chunked real-time testing)

    func toggleSttLab() {
        if sttLabActive {
            stopSttLab()
        } else {
            startSttLab()
        }
    }

    /// Silencia/reactiva tu micrófono durante la conversación (Niki deja de escucharte).
    func toggleCallMute() {
        callMuted.toggle()
        if callMuted {
            sttLabStatus = "Micrófono silenciado"
        }
    }

    /// Crea una sesión de chat nueva y deja el shell en el panel de chat.
    func startFreshChatSession() {
        createChatSession(seedText: nil)
        selection = .chat
    }

    /// Empieza a hablar con la cámara prendida.
    /// Lo que ve la cámara, para que el modelo lo vea también — solo en videollamada.
    ///
    /// Faltaba esto entero. El cuadro se sacaba, se mandaba a reconocer la cara, y ahí
    /// moría: al modelo no le llegaba nunca un píxel. Por eso a "¿me ves?" contestaba que
    /// no tenía acceso a la cámara — era verdad. Reconocer quién sos y ver qué hay
    /// delante son dos cosas distintas, y solo estaba la primera.
    ///
    /// Fuera de la videollamada devuelve nil: la cámara está apagada y prenderla para
    /// mirar de prepo, en cada mensaje, es exactamente lo que no queremos.
    private func cuadroParaElModelo() async -> String? {
        guard videollamada else { return nil }
        // La cámara ya está retenida por `empezarAMirarSeguido` mientras dura la
        // videollamada, así que esto no la prende ni la apaga: le pide un cuadro y listo.
        let datos: Data? = await withCheckedContinuation { cont in
            WebcamManager.shared.capturarCuadro(tiempoLimite: 3) { cont.resume(returning: $0) }
        }
        guard let datos else {
            sttLog("[verme] no se pudo sacar el cuadro — va sin imagen")
            return nil
        }
        return "data:image/jpeg;base64,\(datos.base64EncodedString())"
    }

    func startVideollamada() {
        guard !sttLabActive else {
            // Ya está hablando: se le prende la cámara sin cortar nada.
            videollamada = true
            empezarAMirarSeguido()
            return
        }
        videollamada = true
        startSttLab()
    }

    /// Mira cada tanto mientras dure la videollamada.
    ///
    /// Cada quince segundos y no todo el tiempo: reconocer una cara cuesta, y quién está
    /// sentado no cambia entre un cuadro y el siguiente. Alcanza para que el veredicto no
    /// se venza —vale cinco minutos— y para notar si se levantó y vino otra persona.
    private func empezarAMirarSeguido() {
        miradaTask?.cancel()
        // La cámara queda prendida toda la videollamada, no se apaga entre miradas: el
        // punto es que se vea la imagen en el notch, y prenderla y apagarla cada quince
        // segundos daría un parpadeo además de tardar en exponer cada vez.
        WebcamManager.shared.retener()
        miradaTask = Task { @MainActor [weak self] in
            defer { WebcamManager.shared.soltar() }
            while !Task.isCancelled, self?.videollamada == true, self?.sttLabActive == true {
                await self?.cara.mirar()
                try? await Task.sleep(nanoseconds: 15_000_000_000)
            }
        }
    }

    func startSttLab() {
        guard !sttLabActive else { return }
        refreshMicDevices()
        elegirMicrofono()
        sttLabStatus = "Escuchando…"
        sttMicPermission = "?"
        sttLog("[STT] ▶ startSttLab (modo conversación)  mic=\(selectedMicDeviceID)")
        sttLabActive = true
        sttLabChunks = []
        sttLabError = ""
        sttLabChunkIndex = 0
        callMuted = false
        autoVoice = true  // Niki responde por voz en la conversación
        // Arrancar una llamada limpia cualquier resto del turno anterior. Sin esto, una
        // llamada que terminó con Niki callada a la fuerza empezaría muda.
        speechSuppressed = false
        micRecibioSenal = false
        pendingTurnText = ""
        interruptedReply = ""
        // La cámara se prende acá y se apaga sola: el momento en que importa saber quién
        // está es justo cuando alguien empieza a hablar. Va en su propia tarea para no
        // demorar ni un milisegundo el arranque de la escucha.
        Task { @MainActor [weak self] in await self?.cara.mirar() }
        if gestosActivos { empezarAEscucharGestos() }
        if videollamada { empezarAMirarSeguido() }
        sttLabTask = Task { @MainActor [weak self] in
            guard let self else { return }
            guard await self.startCapture() else { return }
            await self.sttLabLoop()
        }
    }

    /// Levanta el motor de captura para toda la llamada. Devuelve false si no hay
    /// permiso o si CoreAudio no puede abrir la entrada.
    private func startCapture() async -> Bool {
        // Una sola vez por llamada. Antes se pedía en cada frase: un XPC por turno para
        // preguntar algo que no cambia.
        let granted = await AVCaptureDevice.requestAccess(for: .audio)
        sttMicPermission = granted ? "granted" : "denied"
        guard granted else {
            sttLabStatus = "⚠️ Micrófono denegado — Ajustes del Sistema > Privacidad > Micrófono"
            sttLog("[STT] mic DENEGADO")
            sttLabActive = false
            return false
        }
        guard sttLabActive, !Task.isCancelled else { return false }

        let engine = NikiVoiceCapture()
        engine.voiceThresholdDb = sttSilenceThreshold

        let (stream, continuation) = AsyncStream<NikiVoiceCapture.Utterance>.makeStream(
            bufferingPolicy: .bufferingNewest(2)
        )
        utteranceContinuation = continuation
        utteranceIterator = stream.makeAsyncIterator()

        engine.onUtterance = { [weak self] utterance in
            continuation.yield(utterance)
            Task { @MainActor in self?.noteIncomingSpeech() }
        }
        engine.onLevel = { [weak self] level in
            Task { @MainActor in
                guard let self else { return }
                // Un solo dueño del nivel a la vez. Mientras Niki habla manda la
                // animación del TTS; el mic sigue abierto para barge-in y estaría
                // publicando el eco de su propia voz, y los dos escribiendo el mismo
                // valor a 30 y 16 Hz es lo que hacía saltar el orbe.
                guard !self.speaking else { return }
                if level > 0.02 { self.micRecibioSenal = true }
                self.audioLevel = level
            }
        }
        engine.onLog = { line in sttLog(line) }
        engine.onBargeIn = { [weak self] in
            Task { @MainActor in self?.handleBargeIn() }
        }

        // `engine.start()` puede bloquear arrancando el dispositivo — nunca en el MainActor.
        let started = await Task.detached(priority: .userInitiated) { () -> String? in
            do {
                try engine.start()
                return nil
            } catch {
                return error.localizedDescription
            }
        }.value

        if let started {
            sttLabStatus = "⚠️ No se pudo abrir el micrófono: \(started)"
            sttLog("[STT] motor de captura falló: \(started)")
            sttLabError = started
            sttLabActive = false
            return false
        }

        capture = engine
        voiceRecording = true
        syncCapturePhase()

        // Red del AEC: si quedó activo pero no entra ninguna señal, se apaga y se
        // rearma el motor sin él. El primer intento de cancelación de eco dejó la
        // llamada muda en las dos direcciones y no tiró ningún error — solo se supo
        // porque Esteban lo dijo. Que no vuelva a depender de eso.
        if engine.echoCancellationActive {
            let engineRef = engine
            Task { @MainActor [weak self] in
                let espera = NikiVoiceCapture.echoCancellationProbeSeconds
                try? await Task.sleep(nanoseconds: UInt64(espera * 1_000_000_000))
                guard let self, self.sttLabActive, self.capture === engineRef else { return }
                guard !engineRef.sawAnySignal else {
                    sttLog("[STT] AEC verificado: entra señal")
                    return
                }
                sttLog("[STT] ⚠️ AEC activo pero sin señal en \(Int(espera))s — apagándolo y reintentando")
                NikiVoiceCapture.useSystemEchoCancellation = false
                await self.reiniciarCapturaSinAEC()
            }
        }

        armarPruebaDeVida()
        return true
    }

    /// Rearma el motor de captura con la cancelación de eco apagada. Solo lo llama la
    /// red de seguridad del AEC.
    private func reiniciarCapturaSinAEC() async {
        let viejo = capture
        capture = nil
        utteranceContinuation?.finish()
        utteranceContinuation = nil
        utteranceIterator = nil
        if let viejo {
            await Task.detached(priority: .userInitiated) { viejo.stop() }.value
        }
        guard sttLabActive else { return }
        micRecibioSenal = false
        _ = await startCapture()
    }

    /// Si en unos segundos no entró NADA por el micrófono, decirlo en la UI.
    ///
    /// El fallo de un micrófono muerto es silencioso: la app se ve perfecta, el orbe
    /// respira, y parece que Niki simplemente no te escucha. Pasó con un dispositivo
    /// virtual y costó una sesión entera de confusión averiguar por qué.
    private func armarPruebaDeVida() {
        micLivenessTask?.cancel()
        micLivenessTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            guard let self, self.sttLabActive, !Task.isCancelled else { return }
            guard !self.micRecibioSenal else { return }
            let nombre = self.availableMicDevices.first(where: { $0.id == self.selectedMicDeviceID })?.name ?? "el micrófono"
            self.sttLabStatus = "⚠️ No entra audio por \(nombre). Revisá el micrófono en Ajustes del Sistema."
            sttLog("[STT] prueba de vida: 6s sin señal en \(nombre)")
        }
    }

    /// El motor necesita saber de quién es el turno: en `.listening` corta frases por
    /// silencio, en `.speaking` queda armado para barge-in.
    private func syncCapturePhase() {
        guard let capture else { return }
        capture.muted = callMuted
        capture.phase = speaking ? .speaking : (sttLabActive ? .listening : .idle)
    }

    /// Corta la respuesta en curso y se queda con lo que Niki alcanzó a decir. Ese texto
    /// es lo que hace posible retomar con "seguí" desde donde iba, en vez de que el
    /// modelo reciba la misma petición y repita el discurso entero.
    private func interruptCurrentReply() {
        let saidSoFar = activeMessages.last(where: { $0.role == .assistant })?.content
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !saidSoFar.isEmpty { interruptedReply = saidSoFar }

        // Que la hayas cortado dice que esa respuesta no servía: larga, equivocada o
        // fuera de tono. Es la señal de calidad más honesta que produce la app, y se
        // moría acá adentro. Va al backend sin esperar: cortar tiene que ser instantáneo.
        let sesion = activeSessionID
        let cliente = client
        Task { await cliente.reportarInterrupcion(sessionID: sesion, dicho: saidSoFar) }
        if chatBusy {
            cancelCurrentChat()
        } else {
            stopAllSpeech()
            finishNativeSpeech()
        }
    }

    /// Llegó una frase nueva mientras el turno anterior seguía vivo. Si lo anterior había
    /// quedado a medias, esto es su continuación: cortar ya lo que Niki esté pensando o
    /// diciendo evita que conteste medio pregunta y deja al bucle recogerla y unirla.
    /// Sin esto había que esperar a que terminara la respuesta equivocada.
    private func noteIncomingSpeech() {
        guard sttLabActive, chatBusy || speaking else { return }
        guard !pendingTurnText.isEmpty,
              Date().timeIntervalSince(pendingTurnAt) < Self.continuationWindow else { return }
        sttLog("[STT] llegó continuación — cortando la respuesta a medias")
        interruptCurrentReply()
    }

    /// El usuario habló encima de Niki. Se corta lo que esté diciendo y lo que quede
    /// del turno; la frase nueva ya viene capturada desde su primera sílaba porque el
    /// motor guarda medio segundo de pre-roll.
    private func handleBargeIn() {
        guard sttLabActive, speaking || chatBusy else { return }
        sttLog("[STT] barge-in — cortando a Niki")
        interruptCurrentReply()
    }

    func stopSttLab() {
        sttLog("[STT] ■ stopSttLab")
        sttLabActive = false
        // El punto de "te reconocí" vale para esta conversación. Si queda encendido, la
        // próxima vez el notch lo muestra antes de haber mirado a nadie.
        cara.olvidarVeredicto()
        gestos.parar()
        videollamada = false
        miradaTask?.cancel()
        miradaTask = nil
        notchCallDismissed = false
        autoVoice = false
        sttLabTask?.cancel()
        sttLabTask = nil
        micLivenessTask?.cancel()
        micLivenessTask = nil
        let engine = capture
        capture = nil
        utteranceContinuation?.finish()
        utteranceContinuation = nil
        utteranceIterator = nil
        // Igual que al arrancar: parar el dispositivo puede bloquear, así que no acá.
        if let engine {
            Task.detached(priority: .utility) { engine.stop() }
        }
        recorder?.stop()
        recorder = nil
        voiceRecording = false
        audioLevel = 0
        sttLabStatus = ""
        if audioPlayer?.isPlaying == true { audioPlayer?.stop() }
        stopTtsLevelMonitor()
        speaking = false
    }

    private static let whisperHallucinations: Set<String> = [
        ".", "..", "...", "♪", "♫", "[música]", "[music]", "[silencio]", "[silence]",
        "subtítulos realizados por la comunidad de amara.org",
        "subtitles by the amara.org community", ".", "..", "...",
        "♪", "♫", "[música]", "[music]", "[silencio]", "[silence]",
    ]

    private func sttLabLoop() async {
        sttLog("[STT] loop conversación start")
        while sttLabActive, !Task.isCancelled {
            // Silenciado: no grabamos hasta que se reactive el micrófono.
            if callMuted {
                sttLabStatus = "🔇 Silenciado — reactivá para hablar"
                agentState = .idle
                audioLevel = 0
                try? await Task.sleep(nanoseconds: 200_000_000)
                continue
            }
            // --- 1. Escuchar hasta que te calles (VAD) ---
            turn = TurnClock()
            sttLabStatus = "Escuchando…"
            agentState = .listening
            syncCapturePhase()
            guard let utterance = await nextUtterance() else { break }
            guard sttLabActive, !Task.isCancelled else { break }
            turn.voiceEnded = utterance.voiceEndedAt
            turn.chunkCut = utterance.cutAt
            turn.pickedUp = Date()
            sttLog(String(format: "[STT] frase: %d bytes  %.1fs  peak=%.1f dBFS",
                          utterance.wav.count, utterance.seconds, utterance.peakDb))
            let audio = utterance.wav
            guard audio.count > 2048 else { continue }

            // --- 2. Transcribir ---
            sttLabStatus = "Transcribiendo…"
            agentState = .thinking
            let idx = sttLabChunkIndex
            let t0 = Date()
            turn.uploadStart = t0
            var userText: String
            do {
                let res = try await client.transcribeAudio(data: audio, language: "es", prompt: sttVocabulary())
                turn.sttDone = Date()
                let ms = Int(Date().timeIntervalSince(t0) * 1000)
                guard sttLabActive, !Task.isCancelled else { break }
                // El backend devuelve HTTP 200 incluso al fallar (ok:false) — validarlo
                // o el error queda invisible y se ve como silencio.
                guard res.ok else {
                    let err = res.error ?? "el backend falló sin mensaje"
                    sttLabStatus = "⚠️ Error: \(err)"
                    sttLabError = err
                    sttLog("[STT] backend ok:false error=\(err)")
                    try? await Task.sleep(nanoseconds: 800_000_000)
                    continue
                }
                // whisper devuelve el texto segmentado en líneas. Sin aplanarlo, el
                // ensamblador ve un salto de línea como último carácter y la
                // puntuación de cierre se le escapa.
                let text = (res.text ?? "")
                    .components(separatedBy: .whitespacesAndNewlines)
                    .filter { !$0.isEmpty }
                    .joined(separator: " ")
                sttLog("[STT] dijiste: \"\(text)\" \(ms)ms provider=\(res.provider ?? "?")")

                // Puerta de locutor, como atajo. La garantía está en el backend, que es
                // donde se escribe la memoria y el dataset (ver `decidirTurno`): esto solo
                // evita el viaje de ida y vuelta cuando ya se sabe que no es él. Si esta
                // línea desapareciera, el sistema seguiría siendo correcto — más lento
                // para el caso raro, y nada más.
                //
                // Sigue fallando en abierto: sin perfil, o con la huella caída, el turno
                // pasa igual. Fallar cerrado acá convertiría cualquier problema de esa
                // pieza en "Niki no me escucha".
                if let v = res.speaker, v.enrolled, !v.match {
                    // Se anota y se sigue. **No se descarta el turno acá**: quién decide
                    // qué hacer cuando la voz no coincide es el backend, según el ajuste
                    // que eligió Esteban —contestar sin sus datos, no contestar, o
                    // contestar normal—.
                    //
                    // Descartarlo acá era un bug con una consecuencia fea: el sistema
                    // rechazó a Esteban con su propia voz (0.51 contra un umbral de 0.55)
                    // y Niki se quedó muda, sin que él pudiera saber por qué. Un
                    // reconocimiento que se equivoca tiene que degradar la respuesta, no
                    // hacerla desaparecer.
                    sttLog(String(format: "[STT] la voz no coincide (%.2f < %.2f) — decide el backend",
                                  v.score ?? 0, v.threshold ?? 0))
                }
                if text.isEmpty || Self.whisperHallucinations.contains(text.lowercased()) {
                    sttLabStatus = "No te entendí, hablá de nuevo…"
                    continue
                }
                // Orden de callarse: se ejecuta acá, sin pasar por el modelo. Mandarla a
                // Hermes significaba que la respuesta llegaba cuando Niki ya había
                // terminado de decir aquello que le pediste que dejara de decir.
                if NikiTurnAssembler.isStopCommand(text) {
                    sttLog("[STT] orden de parar: \"\(text)\"")
                    interruptCurrentReply()
                    pendingTurnText = ""
                    sttLabStatus = "Te escucho…"
                    agentState = .listening
                    continue
                }

                // "Seguí" retoma lo cortado. Sin esto el modelo recibía una petición
                // idéntica a la de antes y volvía a empezar el mismo discurso.
                if NikiTurnAssembler.isResumeCommand(text), !interruptedReply.isEmpty {
                    sttLog("[STT] retomando lo interrumpido (\(interruptedReply.count) chars de contexto)")
                    // El prompt de retomar se arma acá y ya está redactado: pulirlo sería
                    // corregirle el texto a nuestro propio código.
                    userText = NikiTurnAssembler.resumePrompt(interrupted: interruptedReply)
                    interruptedReply = ""
                    pendingTurnText = ""
                } else {
                    // Armado del turno: si lo anterior quedó a medias, esto es su
                    // continuación y va como una sola frase. Lo que el modelo recibe es
                    // la idea entera, no el pedazo que sobrevivió al silencio.
                    let continuable = !pendingTurnText.isEmpty
                        && Date().timeIntervalSince(pendingTurnAt) < Self.continuationWindow
                    if continuable {
                        let merged = NikiTurnAssembler.merge(pendingTurnText, text)
                        sttLog("[STT] turno unido: \"\(merged)\"")
                        interruptCurrentReply()
                        userText = merged
                    } else {
                        userText = text
                    }
                    // Se pule antes de guardarlo como pendiente, para que si esto se une
                    // con la continuación no se arrastren dos muletillas.
                    userText = NikiTurnAssembler.polish(userText)
                    pendingTurnText = NikiTurnAssembler.looksUnfinished(userText) ? userText : ""
                    pendingTurnAt = Date()
                }
                voiceTranscript = text
                sttLabChunkIndex += 1
                sttLabChunks.append(NikiSttChunk(text: voiceTranscript, latencyMs: ms, provider: "tú", index: idx))
            } catch {
                sttLabStatus = "Error STT: \(error.localizedDescription)"
                sttLog("[STT] error STT: \(error.localizedDescription)")
                try? await Task.sleep(nanoseconds: 700_000_000)
                continue
            }

            // --- 3. Esperar si el chat anterior sigue ocupado ---
            while chatBusy, sttLabActive, !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 100_000_000)
            }
            guard sttLabActive, !Task.isCancelled else { break }

            // --- 4. Enviar a Niki (canal de voz: respuestas habladas cortas) ---
            sttLabStatus = "Niki está pensando…"
            chatInput = userText
            await sendCurrentChat(channel: "niki-voice")

            // --- 5. Esperar respuesta completa (LLM + voz) ---
            while (chatBusy || speaking), sttLabActive, !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 100_000_000)
            }
            guard sttLabActive, !Task.isCancelled else { break }

            // --- 6. Mostrar la respuesta de Niki en el panel ---
            if let reply = activeMessages.last(where: { $0.role == .assistant })?.content
                .trimmingCharacters(in: .whitespacesAndNewlines), !reply.isEmpty {
                sttLabChunks.append(NikiSttChunk(text: reply, latencyMs: 0, provider: "niki", index: sttLabChunkIndex))
                sttLabChunkIndex += 1
                sttLog("[STT] niki: \"\(reply.prefix(60))\"")
            }
            sttLog(turn.line)

            // Antes había una pausa de 400 ms acá para que el mic no captara la cola de
            // su propia voz. Ya no hace falta: el motor sabe cuándo habla Niki y en esa
            // fase no cierra frases, solo vigila barge-in.
            sttLabStatus = "Escuchando…"
            agentState = .listening
        }
        sttLabStatus = ""
        sttLog("[STT] loop conversación end")
    }

    /// Siguiente frase del motor. El iterador se guarda entre llamadas para no perder
    /// las frases que llegan mientras el turno anterior todavía se procesa.
    /// Vocabulario que se le pasa a Whisper para que no destroce los nombres propios.
    /// Incluye lo último que se dijo: el contexto reciente ayuda más que una lista fija.
    private func sttVocabulary() -> String {
        var partes = ["Niki", "Esteban"]
        if let ultimo = activeMessages.last(where: { $0.role == .user })?.content
            .trimmingCharacters(in: .whitespacesAndNewlines), !ultimo.isEmpty {
            partes.append(String(ultimo.prefix(200)))
        }
        return partes.joined(separator: ". ")
    }

    private func nextUtterance() async -> NikiVoiceCapture.Utterance? {
        guard var iterator = utteranceIterator else { return nil }
        let value = await iterator.next()
        utteranceIterator = iterator
        return value
    }

    /// Graba un tramo fijo de audio.
    ///
    /// Solo lo usa el registro de la huella de voz. Tenía dos `guard sttLabActive` —
    /// heredados de cuando este código servía al bucle de la llamada— que lo volvían
    /// imposible de usar: el botón de registrar se deshabilita mientras hay llamada, y
    /// esto exigía que hubiera una. O sea que el registro devolvía nil siempre y el panel
    /// decía "No se pudo grabar. Revisá el micrófono" con el micrófono impecable. Es la
    /// razón por la que la huella de voz nunca llegó a registrarse.
    private func recordChunkFixed(duration: TimeInterval) async -> (Data, Bool)? {
        let granted = await AVCaptureDevice.requestAccess(for: .audio)
        sttMicPermission = granted ? "granted" : "denied"
        sttLog("[STT] mic permission: \(granted ? "granted" : "DENIED")")
        guard granted else {
            let aviso = "Micrófono denegado. Ajustes del Sistema → Privacidad → Micrófono."
            sttLabStatus = aviso
            // También en el panel de identidad: el estado del STT Lab no se ve desde ahí,
            // así que sin esto el registro fallaba sin decir por qué.
            speakerStatusText = aviso
            return nil
        }
        guard !Task.isCancelled else { return nil }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("niki-lab-\(UUID().uuidString).wav")

        // Usar la tasa nativa del dispositivo — 16kHz puede fallar en macs con hw a 48kHz
        let nativeSampleRate = nativeMicSampleRate()
        sttLog("[STT] nativeSampleRate=\(Int(nativeSampleRate))")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatLinearPCM),
            AVSampleRateKey: nativeSampleRate,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsFloatKey: false
        ]

        do {
            let rec = try AVAudioRecorder(url: url, settings: settings)
            rec.isMeteringEnabled = true
            let prepared = rec.prepareToRecord()
            sttLog("[STT] prepareToRecord=\(prepared)")
            guard rec.record() else {
                sttLabStatus = "⚠️ AVAudioRecorder.record() = false (sampleRate=\(Int(nativeSampleRate)))"
                sttLog("[STT] ⚠️ rec.record() failed  sampleRate=\(Int(nativeSampleRate))")
                return nil
            }
            sttLog("[STT] grabando en \(url.lastPathComponent)  rate=\(Int(nativeSampleRate))")
            recorder = rec
            voiceRecording = true
            audioLevel = 0

            var peakPower: Float = -160
            let steps = Int(duration / 0.05)
            for _ in 0..<steps {
                try? await Task.sleep(nanoseconds: 50_000_000)
                guard !Task.isCancelled else {
                    rec.stop()
                    recorder = nil
                    voiceRecording = false
                    return nil
                }
                rec.updateMeters()
                let power = rec.averagePower(forChannel: 0)
                peakPower = max(peakPower, power)
                audioLevel = Float(max(0, min(1, (power + 60.0) / 60.0)))
            }
            sttLabPeakDb = peakPower

            rec.stop()
            recorder = nil
            voiceRecording = false
            audioLevel = 0
            try? await Task.sleep(nanoseconds: 80_000_000)

            guard let data = try? Data(contentsOf: url) else {
                sttLog("[STT] ⚠️ no se pudo leer el WAV de \(url.lastPathComponent)")
                return nil
            }
            sttLog("[STT] WAV listo: \(data.count) bytes  peakPower=\(String(format: "%.1f", peakPower)) dBFS")
            return (data, true)
        } catch {
            sttLabStatus = "⚠️ AVAudioRecorder error: \(error.localizedDescription)"
            sttLog("[STT] ⚠️ AVAudioRecorder catch: \(error.localizedDescription)")
            voiceRecording = false
            audioLevel = 0
            return nil
        }
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        speaking = false
        stopTtsLevelMonitor()
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
            .replacingOccurrences(of: #"```[\s\S]*?```"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"https?://\S+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"^\s{0,3}#{1,6}\s*"#, with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"^\s*[-*+]\s+"#, with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"^\s*\d+[.)]\s+"#, with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"(\*\*|__)(.+?)\1"#, with: "$2", options: .regularExpression)
            .replacingOccurrences(of: #"(\*|_)(.+?)\1"#, with: "$2", options: .regularExpression)
            .replacingOccurrences(of: #"`([^`]+)`"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"\[\[[^\]]+\]\]"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\[([^\]]+)\]\([^\)]+\)"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
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

    /// Devuelve el orbe a su forma de reposo. Espera a que termine lo que esté en curso
    /// (grabando / hablando / respondiendo) en vez de rendirse al primer intento — antes
    /// bastaba con que el TTS siguiera sonando para que el orbe no volviera nunca.
    private func scheduleReturnToIdle(delay: Double = 0.7) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            var waited: Double = 0
            while self.voiceRecording || self.speaking || self.chatBusy {
                if Task.isCancelled || waited > 60 { return }
                try? await Task.sleep(nanoseconds: 200_000_000)
                waited += 0.2
            }
            // Si mientras tanto arrancó otro turno, ese turno se encarga de su propio estado.
            guard self.agentState != .thinking, self.agentState != .acting else { return }
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
            // Migrate the previous Piper voice ID to Qwen3-TTS's built-in
            // Spanish-capable voice without invalidating saved preferences.
            ttsVoice = config.ttsVoice.hasPrefix("es_") ? "Serena" : config.ttsVoice
            autoVoice = config.autoVoice
            orbAccentHex = config.orbAccentHex
            if let personaProfile = config.personaProfile {
                self.personaProfile = personaProfile
            }
        }
        sttLabEnabled = UserDefaults.standard.bool(forKey: "niki.sttLabEnabled")
        if UserDefaults.standard.object(forKey: "niki.doubleTapEnabled") != nil {
            doubleTapToOpenEnabled = UserDefaults.standard.bool(forKey: "niki.doubleTapEnabled")
        }
        if let mod = UserDefaults.standard.string(forKey: "niki.doubleTapModifier"), !mod.isEmpty {
            doubleTapModifier = mod
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
