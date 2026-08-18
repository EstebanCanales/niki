import SwiftUI

/// Registrar la voz viendo lo que Niki escucha, en el notch.
///
/// Hermano de NotchRegistroDeCara y con la misma idea: el registro pasa donde uno lo está
/// mirando. Grabar cinco frases contra un cartel que dice "Hablá normal (2 de 5)" no te
/// dice si te está escuchando; con el nivel moviéndose, un micrófono mudo o apuntando a
/// otro lado se nota en la primera toma en vez de al final.
struct NotchRegistroDeVoz: View {
    @EnvironmentObject private var appModel: NikiAppModel

    var body: some View {
        VStack(spacing: 12) {
            onda

            VStack(spacing: 3) {
                Text(titulo)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.92))
                    .lineLimit(1)

                Text(detalle)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(.white.opacity(0.42))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            puntos
        }
        .frame(maxWidth: .infinity)
    }

    /// El nivel del micrófono, simétrico desde el centro.
    ///
    /// Simétrico y no una fila de barras que crece de izquierda a derecha porque esto es
    /// una forma de onda, no un medidor de progreso: lo que dice es "cuánto sonido entra
    /// ahora", y esa lectura es inmediata cuando crece para los dos lados.
    private var onda: some View {
        // Con el registro terminado el nivel queda quieto en cero; la onda plana ahí es
        // correcta, no un error.
        let nivel = appModel.enrollResultado == nil ? Double(appModel.audioLevel) : 0
        return HStack(spacing: 3) {
            ForEach(0 ..< 21, id: \.self) { i in
                // Las del centro reaccionan más que las de las puntas: da la forma de onda
                // en vez de un bloque que sube y baja entero.
                let desdeElCentro = abs(Double(i - 10)) / 10.0
                let peso = 1.0 - desdeElCentro * 0.75
                let alto = 4 + nivel * 34 * peso
                RoundedRectangle(cornerRadius: 2)
                    .fill(color(nivel: nivel))
                    .frame(width: 3.5, height: max(4, alto))
            }
        }
        .frame(height: 42)
        .animation(.easeOut(duration: 0.07), value: appModel.audioLevel)
    }

    /// Verde cuando entra sonido suficiente, apagado cuando no.
    ///
    /// Es el aviso que faltaba: si el micrófono está mudo, las barras quedan grises y
    /// chatas, y eso se entiende sin leer nada.
    private func color(nivel: Double) -> Color {
        if nivel < 0.06 { return .white.opacity(0.16) }
        if nivel > 0.85 { return Color.orange.opacity(0.8) }  // saturando
        return Color.green.opacity(0.7)
    }

    private var titulo: String {
        if let resultado = appModel.enrollResultado { return resultado }
        return "Frase \(min(appModel.enrollProgress + 1, appModel.enrollTotal)) de \(appModel.enrollTotal)"
    }

    private var detalle: String {
        // Terminado: el título ya dice todo, y una segunda línea sería ruido.
        if appModel.enrollResultado != nil { return "" }
        if Double(appModel.audioLevel) < 0.06 {
            return "No entra sonido. ¿Está mudo el micrófono?"
        }
        // Pedir variedad no es capricho: el umbral sale de cuánto se diferencian las tomas
        // entre sí. Cinco veces la misma frase con la misma entonación da un umbral tan
        // estrecho que después no lo pasa ni el dueño.
        return "Decí algo distinto en cada una, con tu tono de siempre."
    }

    /// Un punto por frase, igual que en el registro de cara.
    private var puntos: some View {
        HStack(spacing: 6) {
            ForEach(0 ..< max(appModel.enrollTotal, 1), id: \.self) { i in
                Circle()
                    .fill(i < appModel.enrollProgress ? Color.green.opacity(0.8) : Color.white.opacity(0.18))
                    .frame(width: 7, height: 7)
            }
        }
    }
}
