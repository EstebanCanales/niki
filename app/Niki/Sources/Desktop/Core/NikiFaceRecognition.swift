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
    /// nil mientras no se preguntó, true/false después.
    ///
    /// La diferencia importa: con un simple `false` inicial, el panel afirmaba "la cámara
    /// no está instalada en el backend" durante el primer cuarto de segundo, que es un
    /// cartel falso mandando a arreglar algo que no está roto.
    @Published private(set) var disponible: Bool?

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

        WebcamManager.shared.retener()
        defer { WebcamManager.shared.soltar() }

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

    /// Borra el veredicto, no el perfil. Se llama al colgar.
    func olvidarVeredicto() {
        teReconocio = nil
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

    /// Varias tomas seguidas para registrar, informando cada paso.
    ///
    /// La pausa entre tomas es a propósito: cinco cuadros del mismo segundo son la misma
    /// foto cinco veces, y el umbral saldría de una sola pose. Con un respiro entra algo
    /// de variación —un gesto, un giro— que es lo que hace falta para que después te
    /// reconozca cuando no estás perfectamente de frente. Por eso también la vista pide
    /// que te muevas.
    ///
    /// `alCambiar` se llama en cada paso para que el notch pueda mostrar en qué anda.
    /// Antes esto pasaba a ciegas: la cámara se prendía, sacaba cinco fotos y devolvía un
    /// cartel. Si salías cortado o a contraluz te enterabas al final y sin saber por qué.
    /// Siete tomas y no cinco, como hace FaceUnlock.
    ///
    /// El backend descarta las que no coinciden con las demás —un registro real de Esteban
    /// tuvo dos que mostraban algo distinto— y hacen falta cuatro buenas. Con cinco, perder
    /// dos ya obliga a repetir todo; con siete, sobra margen.
    func registrar(
        tomas: Int = 7,
        entreTomas: TimeInterval = 1.0,
        alCambiar: @MainActor (NikiRegistroDeCaraEstado) -> Void = { _ in }
    ) async -> String? {
        guard let cliente else { return "No hay conexión con el backend." }
        mirando = true
        defer { mirando = false }

        var estado = NikiRegistroDeCaraEstado(fase: .despertando, total: tomas)
        alCambiar(estado)

        WebcamManager.shared.retener()
        defer { WebcamManager.shared.soltar() }

        var cuadros: [Data] = []
        for i in 0 ..< tomas {
            if i > 0 {
                try? await Task.sleep(nanoseconds: UInt64(entreTomas * 1_000_000_000))
            }
            estado.fase = .sacando(paso: i + 1)
            alCambiar(estado)

            // Cada toma se verifica en el momento: si no se te ve, se reintenta en vez de
            // gastarla. Medido: mirando hacia abajo el detector no encuentra nada, y al
            // registrarse uno mira la pantalla, no la cámara.
            var cuadro: Data?
            for intento in 0 ..< 3 {
                if intento > 0 { try? await Task.sleep(nanoseconds: 700_000_000) }
                guard let c = await cuadroDeLaCamara() else { continue }
                cuadro = c
                if let d = try? await cliente.caraDiagnostico(c), d.caraEncontrada == true {
                    break
                }
            }
            estado.hechas = i + 1
            if let cuadro {
                cuadros.append(cuadro)
                estado.buenas = cuadros.count
            }
            alCambiar(estado)
        }

        guard cuadros.count >= 4 else {
            let motivo = cuadros.isEmpty
                ? "No se pudo usar la cámara. ¿La está usando otra app?"
                : "Solo salieron \(cuadros.count) de \(tomas) fotos."
            estado.fase = .falló(motivo: motivo)
            alCambiar(estado)
            return motivo
        }

        estado.fase = .procesando
        alCambiar(estado)

        do {
            let r = try await cliente.caraRegistrar(cuadros)
            if r.ok {
                hayPerfil = true
                estado.fase = .listo(umbral: r.threshold)
                alCambiar(estado)
                return nil
            }
            let motivo = r.error ?? "No se pudo registrar la cara."
            estado.fase = .falló(motivo: motivo)
            alCambiar(estado)
            return motivo
        } catch {
            estado.fase = .falló(motivo: error.localizedDescription)
            alCambiar(estado)
            return error.localizedDescription
        }
    }
}
