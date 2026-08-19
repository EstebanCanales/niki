import AVFoundation
import Foundation

/// Una línea del informe: qué se probó, si anduvo, y el número que lo respalda.
struct NikiLineaDePrueba: Identifiable {
    enum Estado { case bien, mal, aviso }
    let id = UUID()
    let que: String
    let estado: Estado
    /// Siempre un número o un dato concreto. "ok" no sirve para arreglar nada.
    let dato: String
}

/// Prueba de punta a punta de la cámara, el micrófono y los servicios.
///
/// Existe por cómo veníamos trabajando: varias rondas de arreglar a ciegas, "sigue sin
/// funcionar", y adivinar de nuevo. La única vez que hubo datos —las cinco fotos
/// guardadas, con brillo 0 y 2 sobre 255— la causa apareció en dos minutos.
///
/// Esto no registra nada ni cambia nada. Ejerce el mismo camino que el registro y
/// devuelve los números de cada paso, para copiar y pegar.
@MainActor
final class NikiPruebaDeIdentidad: ObservableObject {
    @Published private(set) var lineas: [NikiLineaDePrueba] = []
    @Published private(set) var corriendo = false

    private var cliente: NikiAPIClient?

    func configurar(cliente: NikiAPIClient) {
        self.cliente = cliente
    }

    /// Todo el informe como texto, para pegarlo en un mensaje.
    func comoTexto() -> String {
        lineas.map { l in
            let marca = switch l.estado {
            case .bien: "ok  "
            case .aviso: "ojo "
            case .mal: "FALLA"
            }
            return "[\(marca)] \(l.que): \(l.dato)"
        }.joined(separator: "\n")
    }

    func correr() async {
        guard !corriendo, let cliente else { return }
        corriendo = true
        lineas = []
        defer { corriendo = false }

        await probarServicios(cliente)
        await probarCamara(cliente)
        await probarMicrofono()
    }

    private func agregar(_ que: String, _ estado: NikiLineaDePrueba.Estado, _ dato: String) {
        lineas.append(NikiLineaDePrueba(que: que, estado: estado, dato: dato))
    }

    private func probarServicios(_ cliente: NikiAPIClient) async {
        if let salud = try? await cliente.healthz() {
            agregar("Backend", .bien, salud.gatewayUrl ?? "responde")
        } else {
            // Sin backend nada de lo demás puede andar, y decirlo primero evita perseguir
            // la cámara cuando el problema es que no hay a quién mandarle la foto.
            agregar("Backend", .mal, "no responde — ¿está corriendo npm start?")
            return
        }

        if let cara = try? await cliente.caraEstado() {
            agregar("Huella de cara", cara.available ? .bien : .mal,
                    cara.available
                        ? (cara.enrolled ? "instalada, con tu cara registrada" : "instalada, sin registrar")
                        : "falta el entorno o los modelos")
        }
        if let voz = try? await cliente.speakerStatus() {
            agregar("Huella de voz", voz.available ? .bien : .mal,
                    voz.available
                        ? (voz.enrolled ? "instalada, con tu voz registrada" : "instalada, sin registrar")
                        : "falta el entorno")
        }
    }

    /// Cuántos cuadros mira, separados en el tiempo.
    ///
    /// Uno solo no alcanza y está medido: mirando hacia abajo el detector no encuentra
    /// nada, y justo cuando uno aprieta el botón está mirando el botón, no la cámara.
    /// Tres tomas repartidas en tres segundos dan tiempo a levantar la vista.
    private static let tomasDePrueba = 3

    private func probarCamara(_ cliente: NikiAPIClient) async {
        let yaEstaba = WebcamManager.shared.isSessionRunning
        if !yaEstaba { WebcamManager.shared.startSession() }
        defer { if !yaEstaba { WebcamManager.shared.stopSession() } }

        agregar("Mirá la cámara", .aviso, "sacando \(Self.tomasDePrueba) fotos…")

        let empezo = Date()
        var mejor: (NikiCaraDiagnostico, Data)?
        var conCara = 0

        for i in 0 ..< Self.tomasDePrueba {
            if i > 0 { try? await Task.sleep(nanoseconds: 1_200_000_000) }
            guard let cuadro = await withCheckedContinuation({ c in
                WebcamManager.shared.capturarCuadro { c.resume(returning: $0) }
            }) else { continue }
            guard let d = try? await cliente.caraDiagnostico(cuadro) else { continue }
            if d.caraEncontrada == true { conCara += 1 }
            // Se queda con la mejor: la que encontró cara, y entre esas la de más
            // confianza. Si ninguna encontró, la más clara, que dice más del encuadre.
            let mejorHastaAhora = mejor?.0
            let mejora = mejorHastaAhora == nil
                || (d.caraEncontrada == true && mejorHastaAhora?.caraEncontrada != true)
                || (d.caraEncontrada == true && (d.confianza ?? 0) > (mejorHastaAhora?.confianza ?? 0))
                || (mejorHastaAhora?.caraEncontrada != true && (d.brillo ?? 0) > (mejorHastaAhora?.brillo ?? 0))
            if mejora { mejor = (d, cuadro) }
        }
        let tardo = Date().timeIntervalSince(empezo)

        lineas.removeAll { $0.que == "Mirá la cámara" }

        guard let (d, cuadro) = mejor else {
            agregar("Cámara", .mal,
                    String(format: "no entregó ningún cuadro en %.1f s — ¿la usa otra app?", tardo))
            return
        }
        agregar("Cámara", .bien,
                String(format: "%d fotos en %.1f s, la mejor de %d KB",
                       Self.tomasDePrueba, tardo, cuadro.count / 1024))

        let brillo = d.brillo ?? 0
        agregar("Brillo", brillo >= 12 ? .bien : .mal,
                String(format: "%.0f de 255 en %d x %d%@", brillo, d.ancho ?? 0, d.alto ?? 0,
                       brillo < 12 ? "  ← casi negro, la cámara no expuso" : ""))

        if d.caraEncontrada == true {
            let orientacion = (d.orientacion ?? 0) == 0 ? "derecha" : "girada \(d.orientacion ?? 0)°"
            agregar("Tu cara", .bien,
                    String(format: "%d de %d fotos, confianza %.2f, %@, ocupa %.1f%% del cuadro",
                           conCara, Self.tomasDePrueba, d.confianza ?? 0, orientacion, d.tamañoCara ?? 0))
        } else {
            agregar("Tu cara", .mal, d.motivo ?? "no se encontró ninguna cara")
            agregar("La foto quedó en", .aviso, "app/backend/face/diagnostico/")
        }
    }

    private func probarMicrofono() async {
        let permiso = await AVCaptureDevice.requestAccess(for: .audio)
        guard permiso else {
            agregar("Micrófono", .mal, "permiso denegado — Ajustes del Sistema › Privacidad › Micrófono")
            return
        }
        agregar("Micrófono", .bien, "con permiso")
    }
}
