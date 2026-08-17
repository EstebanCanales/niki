import CoreVideo
import Foundation
import Vision

/// Qué gestos entiende Niki.
///
/// Son pocos a propósito. Un catálogo grande de gestos parecidos se confunde entre sí y
/// termina disparando cosas que nadie pidió, que en una app que puede borrar archivos es
/// peor que no tener gestos. Estos tres se distinguen por la cantidad de dedos estirados
/// y hacia dónde apunta el pulgar, que es la señal más robusta que da una webcam.
enum NikiGesto: String, Equatable {
    /// Mano abierta, palma al frente. Callar a Niki.
    case palma
    /// Pulgar arriba. Aprobar lo que esté esperando.
    case pulgarArriba
    /// Pulgar abajo. Rechazar.
    case pulgarAbajo

    var descripcion: String {
        switch self {
        case .palma: return "palma abierta"
        case .pulgarArriba: return "pulgar arriba"
        case .pulgarAbajo: return "pulgar abajo"
        }
    }
}

/// Reconoce gestos de la mano en los cuadros de la cámara.
///
/// Usa `VNDetectHumanHandPoseRequest`, que viene en macOS desde Big Sur: no hace falta
/// modelo ni dependencia nueva, y corre en el proceso de la app sin ida y vuelta al
/// backend — cosa que importa porque esto mira varios cuadros por segundo, no uno.
///
/// La parte difícil de un reconocedor de gestos no es reconocer: es **no** reconocer. Una
/// mano que pasa buscando el mate no puede callar a Niki. Por eso un gesto solo cuenta
/// cuando se sostiene varios cuadros seguidos y hay que soltarlo antes de que vuelva a
/// contar.
final class NikiGestos {
    /// Cuántos cuadros seguidos hay que sostener el gesto. A ~10 cuadros por segundo,
    /// cinco son medio segundo: suficiente para que un movimiento al pasar no dispare, y
    /// poco para que sostener la mano no se sienta una espera.
    static let cuadrosParaConfirmar = 5

    /// Confianza mínima por punto. Vision devuelve puntos con poca confianza cuando la
    /// mano está medio tapada, y sobre eso cualquier conclusión es una moneda al aire.
    static let confianzaMinima: Float = 0.6

    private let pedido: VNDetectHumanHandPoseRequest = {
        let p = VNDetectHumanHandPoseRequest()
        // Una sola mano: con dos, Vision reparte el tiempo y ninguna sale bien. Además el
        // gesto lo hace una.
        p.maximumHandCount = 1
        return p
    }()

    private var candidato: NikiGesto?
    private var cuadrosSostenido = 0
    /// El último gesto que ya se informó. Hasta que la mano no cambie, no se repite.
    private var yaInformado: NikiGesto?

    /// Mira un cuadro y devuelve un gesto solo cuando recién se confirma.
    ///
    /// Devuelve nil en la enorme mayoría de los cuadros: no hay mano, el gesto no está
    /// claro, o es el mismo que ya se informó y todavía no se soltó.
    func mirar(_ buffer: CVPixelBuffer) -> NikiGesto? {
        let gesto = reconocer(buffer)

        guard let gesto else {
            // Sin mano se suelta todo: así el gesto siguiente puede volver a contar.
            candidato = nil
            cuadrosSostenido = 0
            yaInformado = nil
            return nil
        }

        if gesto == candidato {
            cuadrosSostenido += 1
        } else {
            candidato = gesto
            cuadrosSostenido = 1
        }

        guard cuadrosSostenido >= Self.cuadrosParaConfirmar, yaInformado != gesto else {
            return nil
        }
        yaInformado = gesto
        return gesto
    }

    private func reconocer(_ buffer: CVPixelBuffer) -> NikiGesto? {
        let handler = VNImageRequestHandler(cvPixelBuffer: buffer, orientation: .up)
        try? handler.perform([pedido])
        guard let mano = pedido.results?.first else { return nil }

        guard let crudos = try? mano.recognizedPoints(.all) else { return nil }

        // Se filtra por confianza acá y no adentro de la clasificación: así la parte que
        // decide qué gesto es trabaja con coordenadas y nada más, y se puede probar sin
        // cámara ni Vision (ver probar-gestos.swift).
        var puntos: [VNHumanHandPoseObservation.JointName: CGPoint] = [:]
        for (nombre, p) in crudos where p.confidence >= Self.confianzaMinima {
            puntos[nombre] = p.location
        }
        return Self.clasificar(puntos)
    }

    /// Qué gesto es, a partir de las posiciones de los puntos de la mano.
    ///
    /// Pura a propósito: entra un diccionario de coordenadas, sale un gesto. Es la parte
    /// que escribimos nosotros —los umbrales, las comparaciones— y la única que puede
    /// estar mal por nuestra culpa, así que tiene que poder probarse con coordenadas
    /// exactas en vez de con una mano frente a la cámara.
    static func clasificar(_ puntos: [VNHumanHandPoseObservation.JointName: CGPoint]) -> NikiGesto? {
        func punto(_ nombre: VNHumanHandPoseObservation.JointName) -> CGPoint? {
            puntos[nombre]
        }

        // Un dedo está estirado cuando la punta queda más lejos de la muñeca que su nudillo
        // medio. Compararlo así —y no por la altura en pantalla— hace que funcione con la
        // mano en cualquier ángulo, que es como la gente hace los gestos de verdad.
        guard let muñeca = punto(.wrist) else { return nil }

        func estirado(punta: VNHumanHandPoseObservation.JointName,
                      medio: VNHumanHandPoseObservation.JointName) -> Bool? {
            guard let p = punto(punta), let m = punto(medio) else { return nil }
            return distancia(muñeca, p) > distancia(muñeca, m) * 1.15
        }

        let dedos = [
            estirado(punta: .indexTip, medio: .indexPIP),
            estirado(punta: .middleTip, medio: .middlePIP),
            estirado(punta: .ringTip, medio: .ringPIP),
            estirado(punta: .littleTip, medio: .littlePIP),
        ]
        // Si no se ven los cuatro dedos con confianza, no se arriesga nada.
        guard dedos.allSatisfy({ $0 != nil }) else { return nil }
        let estirados = dedos.compactMap { $0 }.filter { $0 }.count

        if estirados == 4 { return .palma }

        // Pulgar: cuenta hacia dónde apunta respecto de la muñeca, y solo con el resto de
        // los dedos cerrados — si no, una mano abierta de costado sería "pulgar arriba".
        guard estirados == 0,
              let pulgar = punto(.thumbTip),
              let nudillo = punto(.thumbIP) else { return nil }

        let alto = pulgar.y - muñeca.y
        let separado = distancia(muñeca, pulgar) > distancia(muñeca, nudillo) * 1.15
        guard separado, abs(alto) > 0.12 else { return nil }
        return alto > 0 ? .pulgarArriba : .pulgarAbajo
    }

    private static func distancia(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
        hypot(a.x - b.x, a.y - b.y)
    }
}
