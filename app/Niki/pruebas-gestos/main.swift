// Prueba la geometría del reconocedor de gestos con coordenadas exactas.
//
// No necesita cámara ni mano: arma manos de mentira con las posiciones de los puntos que
// Vision devolvería, y comprueba que la clasificación diga lo que tiene que decir. Es la
// parte que escribimos nosotros —los umbrales, las comparaciones— y la única que puede
// estar mal por culpa nuestra; que Vision encuentre la mano es problema de Apple.
//
// Se llama main.swift porque Swift solo deja código suelto en un archivo con ese nombre.
//
// Uso:
//     swiftc -o /tmp/probar-gestos \
//         Sources/Desktop/Core/NikiGestos.swift pruebas-gestos/main.swift && /tmp/probar-gestos

import Foundation
import Vision

typealias Punto = VNHumanHandPoseObservation.JointName

/// Una mano con la muñeca en el origen y los dedos hacia arriba.
///
/// `estirados` dice qué dedos están extendidos; los cerrados quedan con la punta más cerca
/// de la muñeca que su nudillo, que es exactamente lo que pasa al cerrar el puño.
func mano(
    indice: Bool, medio: Bool, anular: Bool, meñique: Bool,
    pulgar: CGPoint? = nil
) -> [Punto: CGPoint] {
    var p: [Punto: CGPoint] = [.wrist: CGPoint(x: 0.5, y: 0.2)]

    let dedos: [(Bool, Punto, Punto, CGFloat)] = [
        (indice, .indexTip, .indexPIP, 0.44),
        (medio, .middleTip, .middlePIP, 0.50),
        (anular, .ringTip, .ringPIP, 0.56),
        (meñique, .littleTip, .littlePIP, 0.62),
    ]
    for (extendido, punta, nudillo, x) in dedos {
        p[nudillo] = CGPoint(x: x, y: 0.42)          // nudillo, a media distancia
        p[punta] = extendido
            ? CGPoint(x: x, y: 0.62)                  // punta lejos de la muñeca
            : CGPoint(x: x, y: 0.34)                  // punta replegada, más cerca
    }

    if let pulgar {
        p[.thumbTip] = pulgar
        // El nudillo del pulgar, a mitad de camino entre la muñeca y la punta.
        p[.thumbIP] = CGPoint(x: (0.5 + pulgar.x) / 2, y: (0.2 + pulgar.y) / 2)
    }
    return p
}

var fallas = 0

func revisar(_ titulo: String, _ obtenido: NikiGesto?, _ esperado: NikiGesto?) {
    let ok = obtenido == esperado
    let marca = ok ? "ok   " : "FALLA"
    let esp = esperado?.rawValue ?? "nada"
    let obt = obtenido?.rawValue ?? "nada"
    print("  [\(marca)] \(titulo): esperaba \(esp), dio \(obt)")
    if !ok { fallas += 1 }
}

print("Geometría de los gestos")

// Los tres que tienen que salir
revisar("mano abierta",
        NikiGestos.clasificar(mano(indice: true, medio: true, anular: true, meñique: true)),
        .palma)

revisar("puño con pulgar arriba",
        NikiGestos.clasificar(mano(indice: false, medio: false, anular: false, meñique: false,
                                   pulgar: CGPoint(x: 0.42, y: 0.55))),
        .pulgarArriba)

revisar("puño con pulgar abajo",
        NikiGestos.clasificar(mano(indice: false, medio: false, anular: false, meñique: false,
                                   pulgar: CGPoint(x: 0.42, y: -0.18))),
        .pulgarAbajo)

// Lo que NO tiene que salir, que es la mitad que importa: un gesto de más molesta mucho
// más que uno de menos, porque dispara acciones que nadie pidió.
revisar("dos dedos (paz) no es palma",
        NikiGestos.clasificar(mano(indice: true, medio: true, anular: false, meñique: false)),
        nil)

revisar("señalando no es nada",
        NikiGestos.clasificar(mano(indice: true, medio: false, anular: false, meñique: false)),
        nil)

revisar("puño solo, sin pulgar visible",
        NikiGestos.clasificar(mano(indice: false, medio: false, anular: false, meñique: false)),
        nil)

revisar("pulgar pegado al cuerpo de la mano no cuenta",
        NikiGestos.clasificar(mano(indice: false, medio: false, anular: false, meñique: false,
                                   pulgar: CGPoint(x: 0.5, y: 0.26))),
        nil)

revisar("mano abierta con el pulgar arriba sigue siendo palma",
        NikiGestos.clasificar(mano(indice: true, medio: true, anular: true, meñique: true,
                                   pulgar: CGPoint(x: 0.42, y: 0.55))),
        .palma)

// Sin puntos suficientes no se arriesga nada: media mano tapada es la situación normal
// cuando alguien mueve la mano, y adivinar ahí es de donde salen los disparos falsos.
revisar("mano incompleta", NikiGestos.clasificar([.wrist: CGPoint(x: 0.5, y: 0.2)]), nil)
revisar("sin muñeca", NikiGestos.clasificar([.indexTip: CGPoint(x: 0.5, y: 0.6)]), nil)

// El gesto tiene que funcionar con la mano en cualquier ángulo: la gente no la pone
// perfectamente vertical. Se rota la mano abierta 90 grados alrededor de la muñeca.
let abierta = mano(indice: true, medio: true, anular: true, meñique: true)
let centro = abierta[.wrist]!
var rotada: [Punto: CGPoint] = [:]
for (nombre, p) in abierta {
    let dx = p.x - centro.x, dy = p.y - centro.y
    rotada[nombre] = CGPoint(x: centro.x - dy, y: centro.y + dx)
}
revisar("mano abierta de costado sigue siendo palma", NikiGestos.clasificar(rotada), .palma)

print("\n\(fallas) fallas")
exit(fallas == 0 ? 0 : 1)
