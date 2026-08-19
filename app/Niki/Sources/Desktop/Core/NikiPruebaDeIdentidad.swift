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

    private func probarCamara(_ cliente: NikiAPIClient) async {
        let yaEstaba = WebcamManager.shared.isSessionRunning
        if !yaEstaba { WebcamManager.shared.startSession() }
        defer { if !yaEstaba { WebcamManager.shared.stopSession() } }

        let empezo = Date()
        let cuadro = await withCheckedContinuation { c in
            WebcamManager.shared.capturarCuadro { c.resume(returning: $0) }
        }
        let tardo = Date().timeIntervalSince(empezo)

        guard let cuadro else {
            agregar("Cámara", .mal,
                    String(format: "no entregó ningún cuadro en %.1f s — ¿la usa otra app?", tardo))
            return
        }
        agregar("Cámara", .bien, String(format: "cuadro en %.1f s, %d KB", tardo, cuadro.count / 1024))

        guard let d = try? await cliente.caraDiagnostico(cuadro) else {
            agregar("Qué se ve", .mal, "el backend no pudo analizar el cuadro")
            return
        }
        let resolucion = "\(d.ancho ?? 0)x\(d.alto ?? 0)"
        let brillo = d.brillo ?? 0

        // El brillo es el número que resolvió el caso real: las tomas que fallaban daban
        // 0 y 2 sobre 255.
        agregar("Brillo", brillo >= 12 ? .bien : .mal,
                String(format: "%.0f de 255 en %@%@", brillo, resolucion,
                       brillo < 12 ? "  ← casi negro, la cámara no expuso" : ""))

        if d.caraEncontrada == true {
            let orientacion = (d.orientacion ?? 0) == 0 ? "derecha" : "girada \(d.orientacion ?? 0)°"
            agregar("Tu cara", .bien,
                    String(format: "encontrada con confianza %.2f, %@", d.confianza ?? 0, orientacion))
        } else {
            agregar("Tu cara", .mal, d.motivo ?? "no se encontró ninguna cara")
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
