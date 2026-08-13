import Foundation

/// Filtro biquad de segundo orden, forma directa I transpuesta.
///
/// Es el ladrillo del filtrado de audio de la captura. Se implementa a mano en vez de
/// traer una dependencia porque son veinte líneas, corre en el hilo de audio (donde no
/// se quiere nada que asigne memoria) y así queda a la vista qué hace exactamente.
///
/// Coeficientes según el Audio EQ Cookbook de Robert Bristow-Johnson, que es la
/// referencia estándar para esta familia de filtros.
struct NikiBiquad {
    private var b0: Float = 1, b1: Float = 0, b2: Float = 0
    private var a1: Float = 0, a2: Float = 0
    /// Estado entre bloques. Sin esto, cada bloque arrancaría el filtro de cero y se
    /// oiría un clic en cada frontera.
    private var z1: Float = 0, z2: Float = 0

    /// Q de Butterworth: la respuesta más plana posible en la banda de paso, sin realce
    /// alrededor del corte. Para limpiar, no para dar color.
    private static let butterworthQ: Float = 0.7071

    static func highPass(cutoff: Float, sampleRate: Float, q: Float = butterworthQ) -> NikiBiquad {
        var f = NikiBiquad()
        let w0 = 2 * Float.pi * cutoff / sampleRate
        let cosW0 = cos(w0), alpha = sin(w0) / (2 * q)
        let a0 = 1 + alpha
        f.b0 = ((1 + cosW0) / 2) / a0
        f.b1 = (-(1 + cosW0)) / a0
        f.b2 = ((1 + cosW0) / 2) / a0
        f.a1 = (-2 * cosW0) / a0
        f.a2 = (1 - alpha) / a0
        return f
    }

    static func lowPass(cutoff: Float, sampleRate: Float, q: Float = butterworthQ) -> NikiBiquad {
        var f = NikiBiquad()
        let w0 = 2 * Float.pi * cutoff / sampleRate
        let cosW0 = cos(w0), alpha = sin(w0) / (2 * q)
        let a0 = 1 + alpha
        f.b0 = ((1 - cosW0) / 2) / a0
        f.b1 = (1 - cosW0) / a0
        f.b2 = ((1 - cosW0) / 2) / a0
        f.a1 = (-2 * cosW0) / a0
        f.a2 = (1 - alpha) / a0
        return f
    }

    mutating func process(_ x: Float) -> Float {
        let y = b0 * x + z1
        z1 = b1 * x - a1 * y + z2
        z2 = b2 * x - a2 * y
        return y
    }

    mutating func reset() {
        z1 = 0
        z2 = 0
    }
}
