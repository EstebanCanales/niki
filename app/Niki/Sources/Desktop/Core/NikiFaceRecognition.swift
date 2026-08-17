import Foundation
import SwiftUI

/// Reconocer a Esteban por la cámara cuando arranca a hablar.
///
/// La cámara se prende al empezar una conversación y se apaga al terminar. No mira todo el
/// día: la luz verde permanente y el consumo no valen lo que agregan, y el momento en que
/// importa saber quién está es justo cuando alguien está hablando.
///
/// El reconocimiento en sí lo hace el backend (ver app/backend/face/verify.py, con YuNet y
/// SFace de OpenCV). Acá solo se saca el cuadro y se pregunta.
///
/// **Falla en abierto y no es un control de seguridad.** Si no hay cámara, si está tapada,
/// si el backend no contesta o si no te reconoce, la conversación sigue exactamente igual;
/// lo único que cambia es que no dice tu nombre. Una webcam 2D se engaña con una foto en
/// un teléfono, así que esto sirve para personalizar y para nada más.
@MainActor
final class NikiFaceRecognition: ObservableObject {
    /// Nil mientras no se miró; true/false una vez que se miró.
    @Published private(set) var teReconocio: Bool?
    @Published private(set) var hayPerfil = false
    @Published private(set) var mirando = false
    @Published private(set) var disponible = false

    private var cliente: NikiAPIClient?
    /// Para no encender la cámara dos veces si llegan dos turnos pegados.
    private var enCurso = false

    func configurar(cliente: NikiAPIClient) {
        self.cliente = cliente
    }

    func cargarEstado() async {
        guard let cliente else { return }
        guard let estado = try? await cliente.caraEstado() else { return }
        disponible = estado.available
        hayPerfil = estado.enrolled
    }

    /// Mira una vez y guarda el veredicto. Silencioso: no interrumpe nada.
    ///
    /// Sin perfil registrado ni se prende la cámara — no habría con qué comparar, y
    /// encender la cámara para nada es justo lo que no se quiere.
    func mirar() async {
        guard let cliente, hayPerfil, !enCurso else { return }
        enCurso = true
        mirando = true
        defer { enCurso = false; mirando = false }

        WebcamManager.shared.startSession()
        defer { WebcamManager.shared.stopSession() }

        guard let cuadro = await cuadroDeLaCamara() else {
            // Cámara ocupada por otra app, o tapada. No es "no sos vos".
            teReconocio = nil
            return
        }

        guard let veredicto = try? await cliente.caraVerificar(cuadro) else {
            teReconocio = nil
            return
        }
        // `faceFound == false` es "miré y no había nadie", que tampoco es no reconocerte.
        teReconocio = veredicto.faceFound == false ? nil : veredicto.match
    }

    func olvidar() async {
        guard let cliente else { return }
        _ = try? await cliente.caraOlvidar()
        hayPerfil = false
        teReconocio = nil
    }

    private func cuadroDeLaCamara() async -> Data? {
        await withCheckedContinuation { continuation in
            WebcamManager.shared.capturarCuadro { datos in
                continuation.resume(returning: datos)
            }
        }
    }

    /// Varias tomas seguidas para registrar, con una pausa entre cada una.
    ///
    /// La pausa es a propósito: cuatro cuadros del mismo segundo son la misma foto cuatro
    /// veces, y el umbral saldría de una sola pose. Con un respiro entre tomas, entra algo
    /// de variación —un gesto, un giro— que es justo lo que hace falta para que después te
    /// reconozca cuando no estás perfectamente de frente.
    func registrar(tomas: Int = 5, entreTomas: TimeInterval = 0.8) async -> String? {
        guard let cliente else { return "No hay conexión con el backend." }
        mirando = true
        defer { mirando = false }

        WebcamManager.shared.startSession()
        defer { WebcamManager.shared.stopSession() }

        var cuadros: [Data] = []
        for i in 0 ..< tomas {
            if i > 0 {
                try? await Task.sleep(nanoseconds: UInt64(entreTomas * 1_000_000_000))
            }
            if let c = await cuadroDeLaCamara() { cuadros.append(c) }
        }

        guard cuadros.count >= 4 else {
            return "Solo se pudieron sacar \(cuadros.count) tomas. ¿La cámara está tapada o en uso por otra app?"
        }

        do {
            let r = try await cliente.caraRegistrar(cuadros)
            if r.ok {
                hayPerfil = true
                return nil
            }
            return r.error ?? "No se pudo registrar la cara."
        } catch {
            return error.localizedDescription
        }
    }
}
