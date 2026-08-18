// Prueba la medición de brillo con buffers armados a mano.
//
// Existe por el fallo que la motivó: cinco fotos negras que el detector rechazó, y nadie
// se enteró de por qué hasta guardarlas y mirarlas. Esta medición es la que decide si un
// cuadro sirve, así que tiene que estar bien.
//
// Uso:
//     swiftc -o /tmp/probar-brillo \
//         Sources/Desktop/Core/NikiBrillo.swift pruebas-brillo/main.swift && /tmp/probar-brillo

import CoreVideo
import Foundation

/// Un buffer BGRA con todos los píxeles del mismo valor.
func buffer(ancho: Int, alto: Int, valor: UInt8) -> CVPixelBuffer {
    var b: CVPixelBuffer?
    CVPixelBufferCreate(kCFAllocatorDefault, ancho, alto, kCVPixelFormatType_32BGRA, nil, &b)
    let buf = b!
    CVPixelBufferLockBaseAddress(buf, [])
    let base = CVPixelBufferGetBaseAddress(buf)!.assumingMemoryBound(to: UInt8.self)
    let porFila = CVPixelBufferGetBytesPerRow(buf)
    for y in 0 ..< alto {
        for x in 0 ..< (porFila) {
            base[y * porFila + x] = valor
        }
    }
    CVPixelBufferUnlockBaseAddress(buf, [])
    return buf
}

var fallas = 0
func revisar(_ titulo: String, _ ok: Bool, _ detalle: String) {
    print("  [\(ok ? "ok   " : "FALLA")] \(titulo): \(detalle)")
    if !ok { fallas += 1 }
}

print("Brillo de un cuadro")

let negro = NikiBrillo.medio(buffer(ancho: 1920, alto: 1080, valor: 0))
revisar("un cuadro negro da cero", negro == 0, "\(negro)")

// Es el caso real que falló: las cinco tomas del registro tenían brillo medio 0-2.
let casiNegro = NikiBrillo.medio(buffer(ancho: 1920, alto: 1080, valor: 2))
revisar("el caso que falló queda por debajo del piso de 12", casiNegro < 12, "\(casiNegro)")

let normal = NikiBrillo.medio(buffer(ancho: 1920, alto: 1080, valor: 120))
revisar("una imagen normal pasa el piso", normal >= 12, "\(normal)")

let apenas = NikiBrillo.medio(buffer(ancho: 1920, alto: 1080, valor: 20))
revisar("un cuarto en penumbra también pasa", apenas >= 12, "\(apenas)")

// Muestrear no puede cambiar la respuesta: con valor uniforme el promedio es exacto.
revisar("muestrear no falsea el promedio", abs(normal - 120) < 0.001, "\(normal) contra 120")

// Tamaños raros: una cámara puede entregar cualquier resolución.
let chico = NikiBrillo.medio(buffer(ancho: 7, alto: 5, valor: 200))
revisar("un cuadro más chico que el salto no divide por cero", chico == 200, "\(chico)")

let unPixel = NikiBrillo.medio(buffer(ancho: 1, alto: 1, valor: 77))
revisar("un solo píxel se mide igual", unPixel == 77, "\(unPixel)")

print("\n\(fallas) fallas")
exit(fallas == 0 ? 0 : 1)
