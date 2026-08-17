import SwiftUI

/// Registrar la voz viendo lo que Niki escucha, en el notch.
///
/// Hermano de NotchRegistroDeCara y por el mismo motivo: grabar cinco frases mirando un
/// cartel que dice "Hablá normal (2 de 5)" no te dice si te está escuchando. Con el nivel
/// en vivo se ve, y si el micrófono está mudo o apuntando a otro lado se nota en la
/// primera toma en vez de al final.
struct NotchRegistroDeVoz: View {
    @EnvironmentObject private var appModel: NikiAppModel

    var body: some View {
        VStack(spacing: 12) {
            Text(titulo)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white.opacity(0.9))
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            Text(detalle)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.45))
                .lineLimit(2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            barras

            if appModel.enrollTotal > 0 {
                HStack(spacing: 5) {
                    ForEach(0 ..< appModel.enrollTotal, id: \.self) { i in
                        Circle()
                            .fill(i < appModel.enrollProgress ? Color.green.opacity(0.75) : Color.white.opacity(0.16))
                            .frame(width: 6, height: 6)
                    }
                }
            }
        }
        .padding(.horizontal, 8)
    }

    private var titulo: String {
        if !appModel.enrolling {
            return appModel.speakerStatusText.isEmpty ? "Voz registrada" : appModel.speakerStatusText
        }
        return "Frase \(min(appModel.enrollProgress + 1, appModel.enrollTotal)) de \(appModel.enrollTotal)"
    }

    private var detalle: String {
        guard appModel.enrolling else { return "" }
        // Pedir variedad no es capricho: el umbral sale de cuánto se diferencian las tomas
        // entre sí. Cinco veces la misma frase con la misma entonación da un umbral tan
        // estrecho que después no lo pasa ni el dueño.
        return "Decí algo distinto en cada una, con tu tono de siempre."
    }

    /// Nivel del micrófono en vivo. Es lo único que prueba que te está escuchando.
    private var barras: some View {
        HStack(spacing: 3) {
            ForEach(0 ..< 24, id: \.self) { i in
                let umbral = Double(i) / 24.0
                let encendida = Double(appModel.audioLevel) > umbral
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(encendida ? Color.green.opacity(0.7) : Color.white.opacity(0.12))
                    .frame(width: 3, height: encendida ? 14 : 5)
            }
        }
        .frame(height: 16)
        .animation(.easeOut(duration: 0.08), value: appModel.audioLevel)
    }
}
