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
    /// Quien quiera mirar todos los cuadros, no uno solo. Lo usa el lector de gestos.
    private var observador: ((CVPixelBuffer) -> Void)?
    private let colaDeCuadro = DispatchQueue(label: "niki.webcam.cuadro")

    /// Cuántos cuadros se descartan antes de quedarse con uno.
    ///
    /// Los primeros que entrega una cámara recién prendida vienen oscuros: el ajuste
    /// automático de exposición todavía no convergió. Un detector de caras sobre un cuadro
    /// negro no encuentra nada, y el usuario ve "no se pudo sacar la foto" cuando estaba
    /// perfectamente sentado frente a la cámara.
    private static let cuadrosADescartar = 8

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
                DispatchQueue.main.async { completado(datos) }
            }

            cuadrosVistos = 0
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

        // Para quedarse con UNO, en cambio, sí importa: los primeros de una cámara recién
        // prendida vienen sin exposición y un detector de caras no encuentra nada ahí.
        cuadrosVistos += 1
        guard cuadrosVistos > Self.cuadrosADescartar else { return }

        let imagen = CIImage(cvPixelBuffer: buffer)
        let contexto = CIContext()
        // JPEG con calidad media: lo que necesita el reconocedor es la geometría de la
        // cara, no el detalle, y esto viaja por HTTP en cada verificación.
        let datos = contexto.jpegRepresentation(
            of: imagen,
            colorSpace: CGColorSpaceCreateDeviceRGB(),
            options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.7]
        )
        pedido(datos)
    }
}
