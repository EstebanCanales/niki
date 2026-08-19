//
//  WebcamManager.swift
//  Niki
//
//  Created by Harsh Vardhan  Goswami  on 19/08/24.
//
import AVFoundation
import SwiftUI

class WebcamManager: NSObject, ObservableObject {
    static let shared = WebcamManager()
    
    @Published var previewLayer: AVCaptureVideoPreviewLayer? {
        didSet {
            objectWillChange.send()
        }
    }
    
    private var captureSession: AVCaptureSession?
    @Published var isSessionRunning: Bool = false {
        didSet {
            objectWillChange.send()
        }
    }
    
    @Published var authorizationStatus: AVAuthorizationStatus = .notDetermined {
        didSet {
            objectWillChange.send()
        }
    }
    
    @Published var cameraAvailable: Bool = false {
        didSet {
            objectWillChange.send()
        }
    }

    private let sessionQueue = DispatchQueue(label: "Niki.WebcamManager.SessionQueue", qos: .userInitiated)
    
    private var isCleaningUp: Bool = false
    
    // MARK: - Constants
    
    enum WebcamError: Error, LocalizedError {
        case deviceUnavailable
        case accessDenied
        case configurationFailed(String)
        
        var errorDescription: String? {
            switch self {
            case .deviceUnavailable:
                return "No camera devices available"
            case .accessDenied:
                return "Camera access denied"
            case .configurationFailed(let message):
                return "Camera configuration failed: \(message)"
            }
        }
    }
    
    // MARK: - Properties
    
    private override init() {
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(deviceWasDisconnected), name: .AVCaptureDeviceWasDisconnected, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(deviceWasConnected), name: .AVCaptureDeviceWasConnected, object: nil)
        checkCameraAvailability()
    }
    
    deinit {
        NotificationCenter.default.removeObserver(self)
        
        if let session = captureSession {
            if session.isRunning {
                session.stopRunning()
            }
        }
        captureSession = nil
            
        previewLayer = nil
    }

    // MARK: - Camera Management
    
    /// Checks current authorization status and requests access if needed
    func checkAndRequestVideoAuthorization() {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        DispatchQueue.main.async {
            self.authorizationStatus = status
        }
        
        switch status {
        case .authorized:
            checkCameraAvailability() // Check availability if authorized
        case .notDetermined:
            requestVideoAccess()
        case .denied, .restricted:
            NSLog("Camera access denied or restricted")
        @unknown default:
            NSLog("Unknown authorization status")
        }
    }
    
    /// Requests access to the camera
    private func requestVideoAccess() {
        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
            DispatchQueue.main.async {
                self?.authorizationStatus = granted ? .authorized : .denied
                if granted {
                    self?.checkCameraAvailability() // Check availability if access granted
                }
            }
        }
    }
    
    /// Checks if any camera devices are available and sets up capture session if needed
    func checkCameraAvailability() {
        let availableDevices = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.external, .builtInWideAngleCamera],
            mediaType: .video,
            position: .unspecified
        ).devices
        
        let hasAvailableDevices = !availableDevices.isEmpty
        
        DispatchQueue.main.async {
            self.cameraAvailable = hasAvailableDevices
        }
    }
    
    /// Sets up the capture session with a completion handler
    private func setupCaptureSession(completion: @escaping (Bool) -> Void) {
        sessionQueue.async { [weak self] in
            guard let self = self else { 
                completion(false)
                return 
            }
            
            // Clean up any existing session before creating a new one
            self.cleanupExistingSession()
            
            let session = AVCaptureSession()
            
            do {
                // Get available devices and prefer external camera if available
                let discoverySession = AVCaptureDevice.DiscoverySession(
                    deviceTypes: [.external, .builtInWideAngleCamera],
                    mediaType: .video,
                    position: .unspecified
                )
                
                guard let videoDevice = discoverySession.devices.first else {
                    NSLog("No video devices available")
                    DispatchQueue.main.async {
                        self.isSessionRunning = false
                        self.cameraAvailable = false
                    }
                    completion(false)
                    return
                }
                
                NSLog("Using camera: \(videoDevice.localizedName)")
                
                // Lock device for configuration
                try videoDevice.lockForConfiguration()
                defer { videoDevice.unlockForConfiguration() }
                
                let videoInput = try AVCaptureDeviceInput(device: videoDevice)
                guard session.canAddInput(videoInput) else {
                    throw NSError(domain: "Niki.WebcamManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "Cannot add video input"])
                }
                
                session.beginConfiguration()
                session.sessionPreset = .high
                session.addInput(videoInput)
                
                let videoOutput = AVCaptureVideoDataOutput()
                videoOutput.setSampleBufferDelegate(nil, queue: nil)
                if session.canAddOutput(videoOutput) {
                    session.addOutput(videoOutput)
                }
                session.commitConfiguration()
                
                self.captureSession = session
                
                // Create and set up preview layer on main thread
                DispatchQueue.main.async {
                    self.cameraAvailable = true
                    let previewLayer = AVCaptureVideoPreviewLayer(session: session)
                    previewLayer.videoGravity = .resizeAspectFill
                    self.previewLayer = previewLayer
                    
                    // Setup is complete, let the caller know
                    completion(true)
                }
                
                NSLog("Capture session setup completed successfully")
            } catch {
                NSLog("Failed to setup capture session: \(error.localizedDescription)")
                DispatchQueue.main.async {
                    self.isSessionRunning = false
                    self.cameraAvailable = false
                    self.previewLayer = nil
                }
                completion(false)
            }
        }
    }
    
    /// Cleans up an existing capture session, removing all inputs and outputs
    private func cleanupExistingSession() {
        if let existingSession = self.captureSession {
            // First stop the session if running
            if existingSession.isRunning {
                existingSession.stopRunning()
            }
            
            // Then perform configuration cleanup
            existingSession.beginConfiguration()
            
            // Remove all inputs and outputs
            for input in existingSession.inputs {
                existingSession.removeInput(input)
            }
            for output in existingSession.outputs {
                existingSession.removeOutput(output)
            }
            
            existingSession.commitConfiguration()
            self.captureSession = nil
            
            // Clear preview layer on main thread
            DispatchQueue.main.async {
                self.previewLayer = nil
            }
        }
    }

    @objc private func deviceWasDisconnected(notification: Notification) {
        NSLog("Camera device was disconnected")
        sessionQueue.async { [weak self] in
            guard let self = self else { return }
            self.stopSession()
            DispatchQueue.main.async {
                self.cameraAvailable = false
            }
        }
    }

    @objc private func deviceWasConnected(notification: Notification) {
        NSLog("Camera device was connected")
        sessionQueue.async { [weak self] in
            guard let self = self else { return }
            self.checkCameraAvailability()
        }
    }

    private func updateSessionState() {
        let isRunning = self.captureSession?.isRunning ?? false
        DispatchQueue.main.async {
            self.isSessionRunning = isRunning
        }
    }
    
    func startSession() {
        sessionQueue.async { [weak self] in
            guard let self = self else { return }
            
            // If no session exists, create new session
            if self.captureSession == nil {
                self.setupCaptureSession { success in
                    if success {
                        // Only start the session if setup was successful
                        self.startRunningCaptureSession()
                    }
                }
            } else {
                // Session already exists, just start it
                self.startRunningCaptureSession()
            }
        }
    }
    
    private func startRunningCaptureSession() {
        sessionQueue.async { [weak self] in
            guard let self = self, let session = self.captureSession, !session.isRunning else {
                return
            }
            
            session.startRunning()
            
            // Update state on main thread
            self.updateSessionState()
            
            NSLog("Capture session started successfully")
        }
    }
    
    // ── Un cuadro suelto, para el reconocimiento de cara ──────────────────────
    //
    // La sesión de captura ya existe para el espejo del notch; esto engancha un delegate
    // en su salida de video, se queda con el primer cuadro que pase y se desengancha. No
    // abre una segunda sesión a propósito: dos AVCaptureSession sobre la misma cámara se
    // pelean y una de las dos se queda sin imagen.

    private var pedidoDeCuadro: ((Data?) -> Void)?
    private var cuadrosVistos = 0
    /// Cuándo se empezó a pedir el cuadro, para poder rendirse con el brillo.
    private var desdeCuando = Date()
    /// El cuadro más claro que se vio hasta ahora. Si se acaba el tiempo, se manda ese en
    /// vez del último: si la cámara alcanzó a abrir un instante, esa toma sirve.
    private var mejorCuadro: (brillo: Double, datos: Data)?
    /// Quien quiera mirar todos los cuadros, no uno solo. Lo usa el lector de gestos.
    private var observador: ((CVPixelBuffer) -> Void)?
    private let colaDeCuadro = DispatchQueue(label: "niki.webcam.cuadro")

    /// Cuántos cuadros se descartan de entrada, pase lo que pase.
    ///
    /// Contar cuadros no alcanza y está medido: con ocho descartados, las cinco fotos que
    /// llegaron al backend tenían brillo medio 0-2 sobre 255. Ocho cuadros son un cuarto
    /// de segundo y una webcam de Mac tarda uno o dos en abrir el diafragma. Esto es solo
    /// el piso; lo que decide de verdad es `brilloMinimo`.
    private static let cuadrosADescartar = 4

    /// Debajo de este brillo medio (0-255) el cuadro se considera inservible.
    ///
    /// Es la condición que faltaba: en vez de suponer cuánto tarda la cámara, se mira si
    /// la foto tiene algo. Un cuarto oscuro con la pantalla prendida da bastante más que
    /// esto; las tomas negras que fallaron daban 0 y 2.
    private static let brilloMinimo: Double = 12

    /// Después de este tiempo se acepta el cuadro aunque siga oscuro.
    ///
    /// Sin esta salida, alguien con la cámara tapada o en un cuarto de verdad a oscuras se
    /// quedaría esperando para siempre. Es mejor mandar una foto oscura y que el backend
    /// diga "no vi a nadie" que colgarse.
    private static let esperaPorBrillo: TimeInterval = 2.5

    /// Un JPEG de la cámara, o nil si no se pudo.
    ///
    /// Espera a que la sesión exista y esté corriendo antes de pedir nada: `startSession()`
    /// es asíncrono —crea la sesión en su propia cola— así que en la primera llamada
    /// `captureSession` todavía es nil. Sin esta espera, la primera captura siempre
    /// devolvía nil y el registro de cara fallaba con "solo se pudieron sacar 0 tomas",
    /// que además hace pensar que el problema es la cámara.
    func capturarCuadro(tiempoLimite: TimeInterval = 6, completado: @escaping (Data?) -> Void) {
        let limite = Date().addingTimeInterval(tiempoLimite)

        func intentar() {
            guard let sesion = captureSession,
                  sesion.isRunning,
                  let salida = sesion.outputs.compactMap({ $0 as? AVCaptureVideoDataOutput }).first
            else {
                if Date() >= limite {
                    DispatchQueue.main.async { completado(nil) }
                    return
                }
                colaDeCuadro.asyncAfter(deadline: .now() + 0.15) { intentar() }
                return
            }

            var yaContesto = false
            let contestar: (Data?) -> Void = { datos in
                guard !yaContesto else { return }
                yaContesto = true
                salida.setSampleBufferDelegate(nil, queue: nil)
                self.pedidoDeCuadro = nil
                self.cuadrosVistos = 0
                self.mejorCuadro = nil
                DispatchQueue.main.async { completado(datos) }
            }

            cuadrosVistos = 0
            mejorCuadro = nil
            desdeCuando = Date()
            pedidoDeCuadro = contestar
            salida.setSampleBufferDelegate(self, queue: colaDeCuadro)
            // Lo que quede del tiempo límite, no el total: ya se gastó parte esperando a
            // que la sesión arrancara.
            colaDeCuadro.asyncAfter(deadline: .now() + max(1, limite.timeIntervalSinceNow)) {
                contestar(nil)
            }
        }

        colaDeCuadro.async { intentar() }
    }

    // ── Quién necesita la cámara ──────────────────────────────────────────────
    //
    // Siete lugares la prendían y apagaban, cada uno con su propio "¿ya estaba
    // prendida?". Ese chequeo miente: `isSessionRunning` se actualiza después de que la
    // sesión arranca, así que dos que empiecen a la vez —y al empezar una videollamada
    // arrancan tres— ven ambos "apagada", ambos creen que la prendieron ellos, y el
    // primero que termina la apaga mientras el otro la está usando. De ahí que la cámara
    // "no se prenda del todo".
    //
    // Con conteo de referencias nadie tiene que adivinar: se pide y se suelta, y la
    // sesión vive mientras haya al menos uno que la necesite.

    private var retenciones = 0
    private var espejoRetenido = false
    private let candado = NSLock()

    /// Cuánto se deja la cámara prendida después de que la suelta el último.
    ///
    /// Apagarla en el acto sale caro: `stopSession` destruye la sesión entera, así que la
    /// próxima vez hay que crearla de nuevo y esperar otra vez a que el sensor exponga —
    /// uno o dos segundos. Y en una conversación se pide y se suelta seguido: mirar la
    /// cara, sacar una foto, mirar de nuevo a los quince segundos.
    ///
    /// Cuatro segundos cubren esos huecos sin dejar la luz verde prendida cuando ya nadie
    /// la usa.
    private static let graciaAntesDeApagar: TimeInterval = 4

    private var apagadoPendiente: DispatchWorkItem?

    /// Pide la cámara. Se prende si era el primero.
    func retener() {
        // Si había un apagado en camino, se cancela: quien vuelve a pedirla dentro de la
        // gracia se encuentra la cámara ya despierta.
        apagadoPendiente?.cancel()
        apagadoPendiente = nil

        candado.lock()
        retenciones += 1
        let primero = retenciones == 1
        candado.unlock()
        if primero { startSession() }
    }

    /// La suelta. Se apaga si era el último.
    func soltar() {
        candado.lock()
        // Soltar sin haber pedido no apaga nada. Sin este guardia, una llamada de más
        // —que pasa: el espejo cierra en onDisappear y en el toque— disparaba un apagado
        // aunque la cuenta ya estuviera en cero.
        guard retenciones > 0 else { candado.unlock(); return }
        retenciones -= 1
        let ultimo = retenciones == 0
        candado.unlock()
        guard ultimo else { return }

        let apagar = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.candado.lock()
            let sigueEnCero = self.retenciones == 0
            self.candado.unlock()
            if sigueEnCero { self.stopSession() }
        }
        apagadoPendiente = apagar
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.graciaAntesDeApagar, execute: apagar)
    }

    /// El espejo del notch es un interruptor del usuario, no un préstamo: se prende y se
    /// apaga cuando él quiere, y sus llamadas no vienen de a pares. Con un lugar propio,
    /// idempotente, sus idas y vueltas no pueden descuadrar la cuenta de los demás.
    func alternarEspejo() {
        if espejoRetenido { soltarEspejo() } else { retenerEspejo() }
    }

    func retenerEspejo() {
        guard !espejoRetenido else { return }
        espejoRetenido = true
        retener()
    }

    func soltarEspejo() {
        guard espejoRetenido else { return }
        espejoRetenido = false
        soltar()
    }

    /// La sesión de captura, para quien necesite su propia capa de vista previa.
    ///
    /// `previewLayer` es una sola instancia compartida, y una capa de Core Animation vive
    /// en una vista y nada más: si dos vistas la piden, una queda en negro. Quien quiera
    /// mostrar la cámara en otro lado tiene que armarse la suya con esta sesión.
    var sesion: AVCaptureSession? { captureSession }

    /// Mira todos los cuadros mientras la sesión esté prendida.
    ///
    /// Distinto de `capturarCuadro`, que se queda con uno y se va: los gestos necesitan
    /// ver el movimiento, o sea varios cuadros por segundo. Se entrega el buffer crudo y
    /// no un JPEG porque Vision trabaja directo sobre él — codificar a JPEG diez veces por
    /// segundo para decodificarlo enseguida sería trabajo puro al pedo.
    func observarCuadros(_ observador: @escaping (CVPixelBuffer) -> Void) {
        guard let salida = captureSession?.outputs.compactMap({ $0 as? AVCaptureVideoDataOutput }).first else {
            return
        }
        self.observador = observador
        salida.setSampleBufferDelegate(self, queue: colaDeCuadro)
    }

    func dejarDeObservar() {
        observador = nil
        // El delegate se suelta solo si tampoco hay una captura suelta esperando; si la
        // hay, ella lo suelta cuando termina.
        if pedidoDeCuadro == nil,
           let salida = captureSession?.outputs.compactMap({ $0 as? AVCaptureVideoDataOutput }).first {
            salida.setSampleBufferDelegate(nil, queue: nil)
        }
    }

    func stopSession() {
        sessionQueue.async { [weak self] in
            guard let self = self else { return }
            
            // Update state to indicate we're stopping
            DispatchQueue.main.async {
                self.isSessionRunning = false
            }
            
            self.cleanupExistingSession()
            
            NSLog("Capture session stopped and cleaned up")
        }
    }
}


extension WebcamManager: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput,
                       didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        // Quien mira todos los cuadros (los gestos) los recibe siempre, incluidos los
        // primeros: para detectar una mano no molesta que el cuadro venga algo oscuro.
        observador?(buffer)

        guard let pedido = pedidoDeCuadro else { return }

        // Un piso de cuadros descartados, y después la condición que importa: que la foto
        // tenga algo. Contar cuadros no alcanza — con ocho descartados las cinco tomas que
        // llegaron al backend tenían brillo 0-2 sobre 255.
        cuadrosVistos += 1
        guard cuadrosVistos > Self.cuadrosADescartar else { return }

        let brillo = NikiBrillo.medio(buffer)
        let seAcaboElTiempo = Date().timeIntervalSince(desdeCuando) >= Self.esperaPorBrillo

        guard let datos = Self.jpeg(de: buffer) else { return }

        // Se guarda el más claro visto: si la cámara alcanzó a abrir un instante y después
        // volvió a cerrarse, esa toma es la que sirve.
        if brillo > (mejorCuadro?.brillo ?? -1) {
            mejorCuadro = (brillo, datos)
        }

        if brillo >= Self.brilloMinimo {
            pedido(datos)
            return
        }
        if seAcaboElTiempo {
            // Se manda el mejor igual: mejor una foto oscura, que el backend responderá
            // "no vi a nadie", que dejar al usuario esperando sin respuesta.
            pedido(mejorCuadro?.datos ?? datos)
        }
    }

    private static func jpeg(de buffer: CVPixelBuffer) -> Data? {
        let imagen = CIImage(cvPixelBuffer: buffer)
        // JPEG con calidad media: lo que necesita el reconocedor es la geometría de la
        // cara, no el detalle, y esto viaja por HTTP en cada verificación.
        return CIContext().jpegRepresentation(
            of: imagen,
            colorSpace: CGColorSpaceCreateDeviceRGB(),
            options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.7]
        )
    }
}
