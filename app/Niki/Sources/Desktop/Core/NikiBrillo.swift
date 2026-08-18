import CoreVideo

/// Qué tan claro es un cuadro de la cámara, de 0 a 255.
///
/// Existe por un fallo concreto: el registro de cara mandaba cinco fotos y el detector no
/// encontraba nada. Al guardarlas y mirarlas, las cinco tenían brillo medio 0-2 sobre 255
/// — la cámara todavía no había abierto el diafragma. Se descartaban ocho cuadros antes de
/// sacar la foto, que son un cuarto de segundo, y una webcam de Mac tarda uno o dos.
///
/// La lección: contar cuadros es suponer cuánto tarda la cámara. Medir el brillo es
/// preguntarle a la foto si se ve algo, que es lo que uno realmente quiere saber.
public enum NikiBrillo {
    /// Uno de cada cuántas filas y columnas se miran.
    ///
    /// Un cuadro de 1920x1080 son dos millones de píxeles y esto corre en cada uno: con
    /// un dieciseisavo alcanza de sobra para distinguir "negro" de "hay algo", que es la
    /// única pregunta que se le hace.
    public static let salto = 16

    /// Brillo medio de un buffer de la cámara.
    ///
    /// En los formatos planares (YUV) el plano 0 es la luminancia, que es exactamente lo
    /// que se quiere medir. En los empaquetados (BGRA) se leen los bytes de color sueltos
    /// y el promedio sirve igual para esta pregunta.
    public static func medio(_ buffer: CVPixelBuffer) -> Double {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }

        let ancho = CVPixelBufferGetWidth(buffer)
        let alto = CVPixelBufferGetHeight(buffer)
        guard ancho > 0, alto > 0 else { return 0 }

        let planar = CVPixelBufferGetPlaneCount(buffer) > 0
        guard let base = planar
                ? CVPixelBufferGetBaseAddressOfPlane(buffer, 0)
                : CVPixelBufferGetBaseAddress(buffer) else { return 0 }
        let bytesPorFila = planar
            ? CVPixelBufferGetBytesPerRowOfPlane(buffer, 0)
            : CVPixelBufferGetBytesPerRow(buffer)
        let porPixel = planar ? 1 : 4

        let bytes = base.assumingMemoryBound(to: UInt8.self)
        var suma = 0
        var cuenta = 0
        for y in stride(from: 0, to: alto, by: salto) {
            let fila = y * bytesPorFila
            for x in stride(from: 0, to: ancho, by: salto) {
                let i = fila + x * porPixel
                // Un buffer con filas más cortas de lo que dice su ancho existe: mejor
                // saltear el píxel que leer fuera de la memoria del buffer.
                guard i < bytesPorFila * alto else { continue }
                suma += Int(bytes[i])
                cuenta += 1
            }
        }
        return cuenta > 0 ? Double(suma) / Double(cuenta) : 0
    }
}
