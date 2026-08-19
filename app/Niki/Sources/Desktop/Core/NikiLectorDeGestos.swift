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

    /// Lo usa la cola de la cámara, igual que `salteoInterno`.
    private nonisolated let gestos = NikiGestos()
    /// Cuántos cuadros se saltean. Vision sobre una mano cuesta unos milisegundos; a
    /// treinta cuadros por segundo eso es trabajo constante para nada. Uno de cada tres
    /// da unos diez por segundo, de sobra para un gesto que se sostiene medio segundo.
    /// Lo lleva la cola de la cámara. `nonisolated(unsafe)` porque solo ese hilo lo toca:
    /// marcarlo así es más honesto que envolverlo en un candado que no hace falta.
    private nonisolated(unsafe) var salteoInterno = 0

    /// Qué hacer con cada gesto. Lo pone quien lo usa, para que esta clase no sepa nada
    /// de conversaciones ni de aprobaciones.
    var alReconocer: ((NikiGesto) -> Void)?

    func empezar() {
        guard !mirando else { return }
        mirando = true

        WebcamManager.shared.retener()

        // El reconocimiento corre EN la cola de la cámara, no en la principal, y por dos
        // motivos que son bugs si se hace al revés:
        //
        // 1. El buffer que entrega AVFoundation solo vale mientras dura la llamada:
        //    después lo recicla para el cuadro siguiente. Mirarlo desde una tarea que
        //    corre más tarde es leer memoria que ya es otra cosa.
        // 2. A treinta cuadros por segundo, crear una tarea por cuadro para saltear dos
        //    de cada tres es treinta saltos al hilo principal por segundo para nada.
        //
        // Lo único que cruza a la principal es el gesto, cuando hay uno: unas pocas veces
        // por conversación en vez de treinta por segundo.
        WebcamManager.shared.observarCuadros { [weak self] buffer in
            guard let self else { return }
            guard self.debeMirar() else { return }
            guard let gesto = self.gestos.mirar(buffer) else { return }
            Task { @MainActor in self.reconocido(gesto) }
        }
    }

    func parar() {
        guard mirando else { return }
        mirando = false
        WebcamManager.shared.dejarDeObservar()
        WebcamManager.shared.soltar()
        ultimo = nil
    }

    /// Uno de cada tres cuadros. Corre en la cola de la cámara, y `salteo` solo lo toca
    /// ella, así que no hace falta sincronizarlo.
    private nonisolated func debeMirar() -> Bool {
        salteoInterno += 1
        return salteoInterno % 3 == 0
    }

    @MainActor
    private func reconocido(_ gesto: NikiGesto) {
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
