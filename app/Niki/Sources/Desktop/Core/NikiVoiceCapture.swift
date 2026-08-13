import AVFoundation
import Foundation

/// Motor de captura de la conversación.
///
/// Reemplaza al `AVAudioRecorder` por turno que había antes. La diferencia que importa:
/// el dispositivo de CoreAudio se arranca **una sola vez** por llamada en vez de una vez
/// por frase. Arrancar el dispositivo cuesta cientos de ms, y con un micrófono virtual
/// atascado puede no volver nunca — fue lo que congeló la app entera.
///
/// De paso desaparecen tres cosas que también costaban tiempo por turno: el WAV a disco
/// (ahora se arma en RAM), la espera de cierre de archivo, y el sondeo de `updateMeters`
/// cada 80 ms (ahora el nivel sale del propio bloque de audio, cada ~21 ms).
///
/// El tap corre en un hilo de audio de tiempo real. Todo lo que sale de acá va por
/// callbacks que el consumidor salta al MainActor; nada de este objeto es `@MainActor`.
final class NikiVoiceCapture: @unchecked Sendable {

    /// Una frase completa, ya cerrada por el endpointing.
    struct Utterance: @unchecked Sendable {
        /// WAV de 16 kHz mono 16-bit, listo para subir.
        let wav: Data
        /// Momento de la última muestra con voz. Es el instante en que el usuario dejó
        /// de hablar de verdad, no cuando lo detectamos — la referencia para medir la
        /// latencia del turno sin contarnos el cuento.
        let voiceEndedAt: Date
        /// Momento en que el endpointing dio la frase por terminada.
        let cutAt: Date
        let peakDb: Float
        let seconds: Double
    }

    enum Phase {
        /// Nadie habla todavía o estamos entre turnos.
        case idle
        /// Turno del usuario: se corta la frase por silencio.
        case listening
        /// Niki está hablando: el mic sigue abierto, armado para barge-in.
        case speaking
    }

    // MARK: - Ajustes

    /// Piso absoluto del umbral de voz en dBFS. El umbral real nunca baja de acá, pero
    /// sube solo si el ambiente es ruidoso (ver `noiseFloorDb`).
    var voiceThresholdDb: Float = -38.0
    /// Cuánto tiene que destacar la voz sobre el ruido ambiente medido.
    var noiseMarginDb: Float = 12.0
    /// Silencio necesario para dar la frase por terminada en el caso normal.
    /// Tomar aire son 0.3-0.6 s: por debajo de eso la frase se corta a media idea.
    var silenceShort: TimeInterval = 0.90
    /// Ventana estirada, para cuando parece que estás pensando y no terminando.
    var silenceLong: TimeInterval = 1.50
    /// Por debajo de esto la frase se considera demasiado corta para fiarse del corte
    /// rápido: probablemente sea el arranque de una idea, no la idea entera.
    var shortUtteranceSeconds: TimeInterval = 1.2
    /// Un hueco de este tamaño ya es una respiración, no un final de frase.
    var hesitationGapSeconds: TimeInterval = 0.35
    /// Tras detectar que hacés pausas, cuántas frases seguidas se sigue usando la
    /// ventana larga. Quien respira a mitad de frase lo hace varias veces seguidas;
    /// volver a la ventana corta en la siguiente lo cortaría igual.
    var hesitationMemory = 3
    /// Voz acumulada mínima para que algo cuente como frase. Sin esto, un golpe en el
    /// escritorio o una voz de fondo lejana viajaba a STT y volvía como una alucinación
    /// que Niki respondía en serio.
    ///
    /// Ojo con subirlo: "pará" es lo más corto que alguien dice en una conversación y es
    /// justo lo que más urge que pase. Con 0.35 s se descartaba. Los ruidos medidos acá
    /// dan 0.10 s, así que 0.20 s separa bien las dos cosas.
    var minVoicedSeconds: Double = 0.20
    /// Tope duro por frase.
    var maxUtteranceSeconds: Double = 30
    /// Cuánto audio previo a la detección de voz se conserva, para no comerse la primera
    /// sílaba (el defecto clásico de un VAD que empieza a grabar cuando ya oyó).
    var preRollSeconds: Double = 0.5

    /// Margen sobre el eco medido, para barge-in. Ojo con subirlo: dos fuentes de
    /// volumen parecido suman ~3 dB, así que un margen alto vuelve la interrupción
    /// imposible salvo que grites. 6 dB pide que se te oiga por encima de ella sin
    /// exigir un grito.
    var bargeInMarginDb: Float = 5.0
    /// Voz sostenida necesaria para interrumpir a Niki. Evita cortarla con un clic, pero
    /// no puede pasarse: "pará" dura ~0.35 s, así que pedir 0.30 s significaba exigir la
    /// palabra entera antes de reaccionar. Con 0.18 s se corta a mitad de la palabra,
    /// que es exactamente cuando uno espera que se calle.
    var bargeInSustain: TimeInterval = 0.18
    /// Ventana muerta al empezar cada tramo hablado. Entre que `speaking` se pone en true
    /// y que el altavoz suena de verdad pasa un rato: si se midiera el eco ahí, el piso
    /// quedaría en silencio y la primera sílaba de Niki se interrumpiría a sí misma
    /// (pasó exactamente eso: -28.7 dBFS contra un piso de -43.5).
    var bargeInWarmup: TimeInterval = 0.7
    /// Tras interrumpir, no se vuelve a mirar por un momento: la cola del TTS que ya
    /// estaba en el buffer de salida no debe contar como una segunda interrupción.
    var bargeInCooldown: TimeInterval = 1.0

    // MARK: - Salidas

    /// Nivel 0...1 para el orbe, en cada bloque de audio.
    var onLevel: (@Sendable (Float) -> Void)?
    /// Frase cerrada.
    var onUtterance: (@Sendable (Utterance) -> Void)?
    /// El usuario habló encima de Niki.
    var onBargeIn: (@Sendable () -> Void)?
    /// Diagnóstico a niki-stt.log.
    var onLog: (@Sendable (String) -> Void)?

    // MARK: - Estado compartido con el hilo de audio

    private let lock = NSLock()
    private var _phase: Phase = .idle
    private var _muted = false

    var phase: Phase {
        get { lock.lock(); defer { lock.unlock() }; return _phase }
        set {
            lock.lock()
            let changed = _phase != newValue
            _phase = newValue
            lock.unlock()
            if changed { phaseDidChange(newValue) }
        }
    }

    var muted: Bool {
        get { lock.lock(); defer { lock.unlock() }; return _muted }
        set { lock.lock(); _muted = newValue; lock.unlock() }
    }

    // MARK: - Estado privado del hilo de audio

    private let engine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private let targetFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: 16_000,
        channels: 1,
        interleaved: true
    )!
    /// Cancelación de eco del sistema. Se intenta, pero con red: si no entra señal en los
    /// primeros segundos se apaga sola y el motor se reinicia sin ella (ver
    /// `NikiAppModel.startCapture`). El primer intento dejó la llamada muda en las dos
    /// direcciones y solo se supo por el reporte de Esteban, no por un error.
    static var useSystemEchoCancellation = true

    /// Cuánto se espera a que entre la primera señal antes de dar el AEC por roto.
    static let echoCancellationProbeSeconds: TimeInterval = 4

    /// True si el AEC quedó realmente activo en esta sesión.
    private(set) var echoCancellationActive = false

    private var running = false
    /// El sistema está quitando el eco de la salida. Cambia por completo qué se puede
    /// suponer de lo que entra mientras Niki habla.
    private var voiceProcessing = false

    /// Pasa-altos de 90 Hz sobre lo que se graba. Se lleva el rumor del aire, los golpes
    /// en el escritorio y las plosivas — la voz humana no vive ahí abajo, el ruido sí.
    private var highPass = NikiBiquad.highPass(cutoff: 90, sampleRate: 16_000)
    /// Copia pasa-banda (300-3400 Hz) que solo se usa para MEDIR. Un ventilador aporta
    /// energía de banda completa y cruza el umbral; dentro de la banda de voz, no. Esta
    /// señal nunca se envía a STT: es el detector, no el material.
    private var bandLow = NikiBiquad.highPass(cutoff: 300, sampleRate: 16_000)
    private var bandHigh = NikiBiquad.lowPass(cutoff: 3_400, sampleRate: 16_000)

    /// Muestras de la frase en curso (16 kHz mono, little-endian).
    private var utteranceSamples = Data()
    /// Cola circular de pre-roll, en bloques.
    private var preRoll: [Data] = []
    private var preRollSamples = 0

    private var hasVoice = false
    private var voiceStartedAt: Date?
    private var lastVoiceAt = Date()
    private var listeningSince = Date()
    private var sawHesitation = false
    private var peakDb: Float = -160
    /// Segundos de audio realmente por encima del umbral en la frase en curso.
    private var voicedSeconds: Double = 0
    /// Ruido ambiente estimado. Baja rápido y sube despacio, así que se queda en el
    /// silencio real de la sala y no en el nivel de tu voz.
    private var noiseFloorDb: Float = -60
    /// Cuántas frases más conviene seguir usando la ventana larga.
    private var hesitationCredits = 0

    /// Barge-in: envolvente del eco de la propia voz de Niki.
    private var echoFloorDb: Float = -160
    private var speakingSince: Date?
    private var bargeInBlockedUntil: Date?
    private var bargeInAccum: TimeInterval = 0
    /// El último paso a `.listening` viene de una interrupción, no de un turno normal.
    private var interrupted = false
    /// ¿Entró alguna señal desde que arrancó el motor? Es lo que decide si el AEC está
    /// funcionando o dejó el micrófono mudo.
    private(set) var sawAnySignal = false

    /// El orbe no necesita 47 actualizaciones por segundo, y cada una cuesta un salto al
    /// MainActor. ~30 Hz alcanza de sobra para lo que se ve.
    private var lastLevelEmit = Date.distantPast

    // MARK: - Ciclo de vida

    /// Arranca el motor. Lanza si CoreAudio no puede abrir la entrada.
    /// **No llamar desde el MainActor**: `engine.start()` puede bloquear.
    func start() throws {
        guard !running else { return }
        let input = engine.inputNode

        // Cancelación de eco del sistema (la de FaceTime). En teoría es la forma correcta
        // de poder interrumpir a Niki: su voz deja de volver por el micrófono.
        //
        // En la práctica, acá rompió la llamada entera: activarla pone el dispositivo en
        // modo dúplex y en esta máquina se llevó puestas las dos direcciones — ni entraba
        // tu voz ni sonaba la suya. Queda apagada por defecto y el barge-in vuelve a
        // decidirse por nivel. Para volver a intentarlo hay que probarla con el
        // dispositivo real antes de darla por buena, no solo mirar que no tire error.
        if Self.useSystemEchoCancellation {
            do {
                // El primer intento solo tocaba la entrada. El procesado de voz es
                // dúplex: sin preparar también la salida, el dispositivo se lleva puestas
                // las dos direcciones.
                try engine.outputNode.setVoiceProcessingEnabled(true)
                try input.setVoiceProcessingEnabled(true)
                voiceProcessing = true
                echoCancellationActive = true
                onLog?("[STT] cancelación de eco del sistema activa")
            } catch {
                voiceProcessing = false
                echoCancellationActive = false
                onLog?("[STT] sin cancelación de eco (\(error.localizedDescription)) — barge-in por nivel")
            }
        } else {
            voiceProcessing = false
            echoCancellationActive = false
        }

        // El formato se lee DESPUÉS de activar el procesado de voz: lo cambia.
        let inputFormat = input.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0 else {
            throw NSError(domain: "NikiVoiceCapture", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "El dispositivo de entrada no expone un formato válido."
            ])
        }
        converter = AVAudioConverter(from: inputFormat, to: targetFormat)
        guard converter != nil else {
            throw NSError(domain: "NikiVoiceCapture", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "No se pudo convertir \(inputFormat) a 16 kHz mono."
            ])
        }

        resetUtterance()
        hesitationCredits = 0
        noiseFloorDb = -60
        input.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { [weak self] buffer, _ in
            self?.handle(buffer: buffer)
        }
        engine.prepare()
        try engine.start()
        running = true
        onLog?("[STT] motor de captura arriba — entrada \(Int(inputFormat.sampleRate))Hz → 16000Hz mono")
    }

    func stop() {
        guard running else { return }
        running = false
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        resetUtterance()
        onLog?("[STT] motor de captura abajo")
    }

    private func phaseDidChange(_ phase: Phase) {
        switch phase {
        case .speaking:
            // Cada tramo hablado recalibra: el eco depende del volumen y de qué
            // dispositivo esté activo, no es una constante.
            echoFloorDb = -160
            speakingSince = Date()
            bargeInAccum = 0
        case .listening:
            // Tras una interrupción el pre-roll ya contiene el arranque de lo que dijiste
            // encima de Niki. Tirarlo acá era comerse la primera sílaba justo en el caso
            // donde más se nota.
            resetUtterance(keepingPreRoll: interrupted)
            interrupted = false
        case .idle:
            break
        }
    }

    private func resetUtterance(keepingPreRoll: Bool = false) {
        utteranceSamples.removeAll(keepingCapacity: true)
        if !keepingPreRoll {
            preRoll.removeAll(keepingCapacity: true)
            preRollSamples = 0
        }
        hasVoice = false
        voiceStartedAt = nil
        lastVoiceAt = Date()
        listeningSince = Date()
        sawHesitation = false
        peakDb = -160
        voicedSeconds = 0
    }

    /// Umbral efectivo: el piso configurado, o el ruido ambiente más un margen si la
    /// sala es ruidosa. Es lo que evita que un murmullo lejano dispare una frase.
    private var effectiveThresholdDb: Float {
        max(voiceThresholdDb, noiseFloorDb + noiseMarginDb)
    }

    private func trackNoiseFloor(_ db: Float) {
        // Caída rápida hacia el silencio real, subida lenta: si subiera rápido, tu propia
        // voz elevaría el piso y el umbral se te escaparía hacia arriba.
        noiseFloorDb = db < noiseFloorDb ? max(-70, noiseFloorDb - 0.6) : min(-30, noiseFloorDb + 0.02)
    }

    // MARK: - Hilo de audio

    private func handle(buffer: AVAudioPCMBuffer) {
        guard let converter, let raw = Self.convert(buffer, with: converter, to: targetFormat) else { return }
        let frames = raw.count / 2
        guard frames > 0 else { return }
        let blockSeconds = Double(frames) / targetFormat.sampleRate

        // Dos señales del mismo bloque, con propósitos distintos:
        //   `block` es lo que se graba y viaja a STT — solo pasa-altos, para no perder
        //           los agudos que Whisper usa para distinguir consonantes.
        //   `db`    se mide sobre la banda de voz (300-3400 Hz), que es lo que decide si
        //           esto fue alguien hablando o el ventilador arrancando.
        let (block, db) = filterAndMeasure(raw, frames: frames)
        let now = Date()

        lock.lock()
        let phase = _phase
        let muted = _muted
        lock.unlock()

        guard !muted else {
            emitLevel(0, now: now, force: true)
            return
        }

        if db > -55 { sawAnySignal = true }
        emitLevel(Float(max(0, min(1, (Double(db) + 60.0) / 60.0))), now: now, force: false)

        switch phase {
        case .idle:
            break
        case .speaking:
            pushPreRoll(block, frames: frames)
            evaluateBargeIn(db: db, blockSeconds: blockSeconds, now: now)
        case .listening:
            accumulate(block, frames: frames, db: db, blockSeconds: blockSeconds, now: now)
        }
    }

    private func emitLevel(_ level: Float, now: Date, force: Bool) {
        guard force || now.timeIntervalSince(lastLevelEmit) >= 0.033 else { return }
        lastLevelEmit = now
        onLevel?(level)
    }

    private func pushPreRoll(_ block: Data, frames: Int) {
        preRoll.append(block)
        preRollSamples += frames
        let limit = Int(preRollSeconds * targetFormat.sampleRate)
        while preRollSamples > limit, !preRoll.isEmpty {
            preRollSamples -= preRoll.removeFirst().count / 2
        }
    }

    private func accumulate(_ block: Data, frames: Int, db: Float, blockSeconds: Double, now: Date) {
        peakDb = max(peakDb, db)
        let isVoice = db > effectiveThresholdDb
        if !isVoice { trackNoiseFloor(db) }
        if isVoice { voicedSeconds += blockSeconds }

        if !hasVoice {
            pushPreRoll(block, frames: frames)
            guard isVoice else {
                // Sin nada que oír en 8 s el pre-roll se recicla solo; no hay frase que
                // cerrar, así que no se emite nada.
                if now.timeIntervalSince(listeningSince) > 8 { listeningSince = now }
                return
            }
            hasVoice = true
            voiceStartedAt = now
            // El pre-roll entra completo: incluye el arranque de la palabra, que ocurre
            // antes de que el nivel cruce el umbral.
            for chunk in preRoll { utteranceSamples.append(chunk) }
            preRoll.removeAll(keepingCapacity: true)
            preRollSamples = 0
            lastVoiceAt = now
            return
        }

        utteranceSamples.append(block)
        if isVoice {
            if now.timeIntervalSince(lastVoiceAt) >= hesitationGapSeconds { sawHesitation = true }
            lastVoiceAt = now
        }

        let spoken = now.timeIntervalSince(voiceStartedAt ?? now)
        let window = silenceWindow(spokenSeconds: spoken)
        let silence = now.timeIntervalSince(lastVoiceAt)

        if silence >= window || spoken >= maxUtteranceSeconds {
            emitUtterance(cutAt: now)
        }
    }

    /// Ventana de silencio para cerrar la frase. Corta rápido en el caso normal y se
    /// estira cuando hay señales de que todavía estás pensando o respirando.
    private func silenceWindow(spokenSeconds: Double) -> TimeInterval {
        if sawHesitation || hesitationCredits > 0 { return silenceLong }
        return spokenSeconds < shortUtteranceSeconds ? silenceLong : silenceShort
    }

    private func emitUtterance(cutAt: Date) {
        let samples = utteranceSamples
        let voiceEnded = lastVoiceAt
        let peak = peakDb
        let voiced = voicedSeconds
        let hesitated = sawHesitation
        resetUtterance()

        // Quien respira a mitad de frase lo repite; conviene recordarlo unas frases.
        if hesitated {
            hesitationCredits = hesitationMemory
        } else if hesitationCredits > 0 {
            hesitationCredits -= 1
        }

        guard voiced >= minVoicedSeconds else {
            onLog?(String(format: "[STT] descartado: solo %.2fs de voz (umbral %.1f dBFS, ruido %.1f)",
                          voiced, effectiveThresholdDb, noiseFloorDb))
            return
        }

        // Recorte del silencio final: se conserva un colchón corto tras la última muestra
        // con voz en vez de la ventana entera (0.9-1.5 s). Whisper alucina justo sobre el
        // silencio, y un clip más corto además vuelve antes.
        let colchon = Int(Self.tailPaddingSeconds * targetFormat.sampleRate) * 2
        let silencioFinal = Int(cutAt.timeIntervalSince(voiceEnded) * targetFormat.sampleRate) * 2
        let sobra = max(0, silencioFinal - colchon)
        let recortadas = sobra > 0 && sobra < samples.count
            ? samples.prefix(samples.count - sobra)
            : samples[...]

        // Normalización de pico a -3 dBFS. Los picos medidos rondaban -22/-34 dBFS y
        // Whisper rinde peor con entrada floja; es ganancia, no compresión, así que no
        // cambia la forma de la señal.
        let normalizadas = Self.normalize(Data(recortadas), peakTargetDb: Self.peakTargetDb)

        let wav = Self.wav(pcm16: normalizadas, sampleRate: Int(targetFormat.sampleRate))
        onUtterance?(Utterance(wav: wav, voiceEndedAt: voiceEnded, cutAt: cutAt, peakDb: peak,
                               seconds: Double(normalizadas.count / 2) / targetFormat.sampleRate))
    }

    /// Decide si lo que entra es el usuario hablando encima o solo el eco de Niki.
    ///
    /// La envolvente sigue a la propia voz de Niki, así que sus sílabas nunca se separan
    /// del piso; una voz humana encima sí suma energía por arriba. La clave es que la
    /// envolvente **sube despacio** una vez pasada la ventana muerta: si subiera al ritmo
    /// de la señal, absorbería la interrupción antes de que llegue a sostenerse.
    private func evaluateBargeIn(db: Float, blockSeconds: Double, now: Date) {
        guard let speakingSince else { return }

        if voiceProcessing {
            // Con AEC lo que llega es tu voz y nada más: no hay eco al que seguirle el
            // rastro, ni ventana muerta que esperar. Cualquier voz sostenida corta.
            if let blocked = bargeInBlockedUntil, now < blocked { return }
            if db > effectiveThresholdDb {
                bargeInAccum += blockSeconds
                if bargeInAccum >= bargeInSustain {
                    bargeInAccum = 0
                    bargeInBlockedUntil = now.addingTimeInterval(bargeInCooldown)
                    interrupted = true
                    onLog?(String(format: "[STT] barge-in (AEC): %.1f dBFS", db))
                    onBargeIn?()
                }
            } else {
                bargeInAccum = 0
            }
            return
        }

        let warmingUp = now.timeIntervalSince(speakingSince) < bargeInWarmup

        if warmingUp {
            // Ataque libre: acá solo suena Niki, y queremos su nivel real cuanto antes.
            echoFloorDb = max(echoFloorDb, db)
            bargeInAccum = 0
            return
        }

        if let blocked = bargeInBlockedUntil, now < blocked {
            echoFloorDb = max(echoFloorDb, db)
            return
        }

        let floor = echoFloorDb + bargeInMarginDb
        if db > floor {
            bargeInAccum += blockSeconds
            if bargeInAccum >= bargeInSustain {
                bargeInAccum = 0
                bargeInBlockedUntil = now.addingTimeInterval(bargeInCooldown)
                interrupted = true
                onLog?(String(format: "[STT] barge-in: %.1f dBFS sobre piso %.1f", db, floor))
                onBargeIn?()
                return
            }
        } else {
            bargeInAccum = 0
        }

        // Subida limitada (~16 dB/s) y caída muy lenta. Una interrupción real se mantiene
        // por encima del margen el tiempo suficiente; las variaciones de la propia voz de
        // Niki, no.
        echoFloorDb = max(echoFloorDb - 0.01, min(db, echoFloorDb + 0.35))
    }

    // MARK: - Utilidades

    /// Convierte un bloque a 16 kHz mono 16-bit y lo devuelve como bytes crudos.
    private static func convert(
        _ buffer: AVAudioPCMBuffer,
        with converter: AVAudioConverter,
        to format: AVAudioFormat
    ) -> Data? {
        let ratio = format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }

        var consumed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if consumed {
                status.pointee = .noDataNow
                return nil
            }
            consumed = true
            status.pointee = .haveData
            return buffer
        }
        guard error == nil, out.frameLength > 0, let channel = out.int16ChannelData else { return nil }
        return Data(bytes: channel[0], count: Int(out.frameLength) * 2)
    }

    /// Colchón que se deja después de la última muestra con voz. Suficiente para no
    /// cortar la cola de una palabra, muy por debajo de la ventana de silencio entera.
    static let tailPaddingSeconds: Double = 0.25
    /// Pico objetivo tras normalizar. No se llega a 0 para dejar margen y no recortar.
    static let peakTargetDb: Float = -3

    /// Sube el volumen del clip entero hasta que su pico llegue al objetivo. Es ganancia
    /// uniforme: no comprime ni cambia la forma de la señal, solo la pone donde Whisper
    /// la escucha mejor. Si el clip ya está fuerte o es puro silencio, se deja igual.
    static func normalize(_ pcm16: Data, peakTargetDb: Float) -> Data {
        let count = pcm16.count / 2
        guard count > 0 else { return pcm16 }

        var pico: Float = 0
        pcm16.withUnsafeBytes { raw in
            let muestras = raw.bindMemory(to: Int16.self)
            for i in 0..<count { pico = max(pico, abs(Float(muestras[i]) / 32_768.0)) }
        }
        guard pico > 0.0001 else { return pcm16 }

        let objetivo = pow(10, peakTargetDb / 20)
        let ganancia = objetivo / pico
        // Solo se amplifica: bajarle a un clip que ya está fuerte no aporta nada.
        guard ganancia > 1.05 else { return pcm16 }
        // Tope de 30× (~30 dB). Con 12× se quedaba corto — los picos reales rondaban
        // -30 dBFS y necesitan ~24× para llegar al objetivo. El tope existe por si algo
        // casi mudo llega hasta acá; lo que de verdad evita amplificar ruido es que solo
        // se normalizan frases que ya pasaron el VAD y el mínimo de voz.
        let limitada = min(ganancia, 30)

        var salida = Data(count: pcm16.count)
        pcm16.withUnsafeBytes { raw in
            let muestras = raw.bindMemory(to: Int16.self)
            salida.withUnsafeMutableBytes { destino in
                let escritas = destino.bindMemory(to: Int16.self)
                for i in 0..<count {
                    let v = (Float(muestras[i]) / 32_768.0) * limitada
                    escritas[i] = Int16(max(-1, min(1, v)) * 32_767)
                }
            }
        }
        return salida
    }

    /// Filtra el bloque y devuelve (audio a grabar, nivel de la banda de voz en dBFS).
    ///
    /// Se recorren las muestras una sola vez y se sacan las dos señales a la vez: hay que
    /// hacerlo en el hilo de audio, así que cuantas menos pasadas, mejor.
    private func filterAndMeasure(_ pcm16: Data, frames: Int) -> (Data, Float) {
        var salida = Data(count: frames * 2)
        var sumaBanda: Double = 0

        pcm16.withUnsafeBytes { entrada in
            let muestras = entrada.bindMemory(to: Int16.self)
            salida.withUnsafeMutableBytes { destino in
                let escritas = destino.bindMemory(to: Int16.self)
                for i in 0..<frames {
                    let x = Float(muestras[i]) / 32_768.0

                    // Lo que se graba: solo pasa-altos. Recortar los agudos acá le
                    // sacaría a Whisper justo lo que usa para separar consonantes.
                    let limpia = highPass.process(x)
                    let clamped = max(-1, min(1, limpia))
                    escritas[i] = Int16(clamped * 32_767)

                    // Lo que se mide: banda de voz. Esta señal se descarta.
                    let banda = bandHigh.process(bandLow.process(limpia))
                    sumaBanda += Double(banda * banda)
                }
            }
        }

        let rms = (sumaBanda / Double(frames)).squareRoot()
        let db: Float = rms > 0 ? Float(20 * log10(rms)) : -160
        return (salida, db)
    }

    /// RMS del bloque en dBFS.
    private static func dbFS(_ pcm16: Data) -> Float {
        let count = pcm16.count / 2
        guard count > 0 else { return -160 }
        var sum: Double = 0
        pcm16.withUnsafeBytes { raw in
            let samples = raw.bindMemory(to: Int16.self)
            for i in 0..<count {
                let v = Double(samples[i]) / 32_768.0
                sum += v * v
            }
        }
        let rms = (sum / Double(count)).squareRoot()
        guard rms > 0 else { return -160 }
        return Float(20 * log10(rms))
    }

    /// Cabecera RIFF + PCM. El backend ya recibía WAV, así que aguas abajo no cambia nada.
    static func wav(pcm16: Data, sampleRate: Int) -> Data {
        var header = Data()
        func append32(_ value: UInt32) { withUnsafeBytes(of: value.littleEndian) { header.append(contentsOf: $0) } }
        func append16(_ value: UInt16) { withUnsafeBytes(of: value.littleEndian) { header.append(contentsOf: $0) } }

        let byteRate = UInt32(sampleRate * 2)
        header.append(contentsOf: Array("RIFF".utf8))
        append32(UInt32(36 + pcm16.count))
        header.append(contentsOf: Array("WAVE".utf8))
        header.append(contentsOf: Array("fmt ".utf8))
        append32(16)          // tamaño del bloque fmt
        append16(1)           // PCM
        append16(1)           // mono
        append32(UInt32(sampleRate))
        append32(byteRate)
        append16(2)           // block align
        append16(16)          // bits por muestra
        header.append(contentsOf: Array("data".utf8))
        append32(UInt32(pcm16.count))
        return header + pcm16
    }
}
