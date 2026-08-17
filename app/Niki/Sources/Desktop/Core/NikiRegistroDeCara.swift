import Foundation

/// En qué anda el registro de la cara, para poder mostrarlo mientras pasa.
///
/// Vive aparte del reconocedor porque son dos cosas distintas: uno hace el trabajo, esto
/// es lo que se muestra. Sin separarlo, la vista del notch tendría que espiar variables
/// internas del reconocedor para saber en qué paso va.
struct NikiRegistroDeCaraEstado: Equatable {
    enum Fase: Equatable {
        case inactivo
        /// Prendiendo la cámara y esperando a que el sensor se acomode.
        case despertando
        /// Sacando la toma número N.
        case sacando(paso: Int)
        /// Mandando las tomas al backend.
        case procesando
        case listo(umbral: Double?)
        case falló(motivo: String)
    }

    var fase: Fase = .inactivo
    var total = 0
    /// Cuántas tomas se intentaron.
    var hechas = 0
    /// Cuántas sirvieron. Puede ser menos que `hechas`: en una salís mirando para el
    /// costado y el detector no encuentra cara.
    var buenas = 0

    var activo: Bool { fase != .inactivo }
    var terminado: Bool {
        if case .listo = fase { return true }
        if case .falló = fase { return true }
        return false
    }
    var sacando: Bool {
        if case .sacando = fase { return true }
        return false
    }

    var titulo: String {
        switch fase {
        case .inactivo: return ""
        case .despertando: return "Prendiendo la cámara…"
        case .sacando(let paso): return "Foto \(paso) de \(total)"
        case .procesando: return "Guardando tu cara…"
        case .listo: return "Listo, Niki ya te reconoce"
        case .falló(let motivo): return motivo
        }
    }

    var detalle: String {
        switch fase {
        case .despertando:
            return "Poné la cara en el recuadro."
        case .sacando:
            // Pedir movimiento es lo que hace que después te reconozca de costado: si las
            // cinco tomas son la misma pose, el umbral sale de una sola cara.
            return "Movete un poco entre foto y foto: girá la cabeza, sonreí."
        case .procesando:
            return "Comparando las tomas entre sí para saber cuánto varía tu cara."
        case .listo(let umbral):
            guard let umbral else { return "Se prende solo cuando le hablás." }
            return String(format: "Umbral %.2f. Se prende solo cuando le hablás.", umbral)
        case .falló:
            return "Probá con más luz y de frente."
        case .inactivo:
            return ""
        }
    }
}
