import CoreVideo
import Foundation
import SwiftUI

/// Los gestos con la mano, mientras hablás.
///
/// Qué hace cada uno:
///
///   ✋ palma abierta   la callás
///   👍 pulgar arriba   aprobás lo que esté esperando permiso
///   👎 pulgar abajo    lo rechazás
///
/// Los tres son cosas que ya se podían hacer, y en las que la voz falla justo cuando más
/// falta hacen: para callarla hay que hablarle encima de lo que está diciendo, y para
/// aprobar un borrado hay que ir a buscar el botón. Un gesto no compite con nada.
///
/// La cámara se prende con la conversación y se apaga con ella, igual que el
/// reconocimiento de cara. Fuera de la conversación esto no corre.
@MainActor
final class NikiLectorDeGestos: ObservableObject {
    /// El último gesto reconocido, para que la interfaz pueda mostrarlo un momento.
    @Published private(set) var ultimo: NikiGesto?
    @Published private(set) var mirando = false

    private let gestos = NikiGestos()
    /// Cuántos cuadros se saltean. Vision sobre una mano cuesta unos milisegundos; a
    /// treinta cuadros por segundo eso es trabajo constante para nada. Uno de cada tres
    /// da unos diez por segundo, de sobra para un gesto que se sostiene medio segundo.
    private var salteo = 0

    /// Qué hacer con cada gesto. Lo pone quien lo usa, para que esta clase no sepa nada
    /// de conversaciones ni de aprobaciones.
    var alReconocer: ((NikiGesto) -> Void)?

    func empezar() {
        guard !mirando else { return }
        mirando = true

        WebcamManager.shared.retener()

        WebcamManager.shared.observarCuadros { [weak self] buffer in
            // Llega en la cola de la cámara, no en la principal.
            guard let self else { return }
            Task { @MainActor in self.procesar(buffer) }
        }
    }

    func parar() {
        guard mirando else { return }
        mirando = false
        WebcamManager.shared.dejarDeObservar()
        WebcamManager.shared.soltar()
        ultimo = nil
    }

    private func procesar(_ buffer: CVPixelBuffer) {
        salteo += 1
        guard salteo % 3 == 0 else { return }
        guard let gesto = gestos.mirar(buffer) else { return }
        ultimo = gesto
        alReconocer?(gesto)
        // El aviso en pantalla dura poco: es una confirmación de que se entendió, no algo
        // que haya que leer.
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            if self.ultimo == gesto { self.ultimo = nil }
        }
    }
}
