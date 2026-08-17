import AVFoundation
import SwiftUI

/// Registrar la cara viéndote, en el notch.
///
/// La primera versión hacía las cinco tomas a ciegas desde un panel del escritorio: la
/// cámara se prendía, sacaba las fotos y devolvía un cartel. Si salías cortado, a
/// contraluz o mirando para otro lado, te enterabas al final y sin saber por qué.
///
/// Acá se ve lo que ve la cámara mientras pasa, con el paso en el que va y un aviso
/// cuando la toma no sirvió. Es el mismo lugar donde Niki ya vive, así que el registro
/// pasa donde uno la está mirando.
struct NotchRegistroDeCara: View {
    @EnvironmentObject private var appModel: NikiAppModel
    @ObservedObject private var webcam = WebcamManager.shared

    var body: some View {
        VStack(spacing: 10) {
            HStack(alignment: .top, spacing: 14) {
                espejo

                VStack(alignment: .leading, spacing: 6) {
                    Text(appModel.registroDeCara.titulo)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.9))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(appModel.registroDeCara.detalle)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.white.opacity(0.45))
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)

                    if appModel.registroDeCara.total > 0 {
                        puntos
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if appModel.registroDeCara.terminado {
                Button {
                    appModel.cerrarRegistroDeCara()
                } label: {
                    Text("Listo")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.85))
                        .padding(.horizontal, 18)
                        .frame(height: 28)
                        .background(Capsule().fill(.white.opacity(0.1)))
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// Espejado horizontalmente, como cualquier cámara frontal: uno espera verse como en
    /// un espejo, no como lo ve la cámara.
    private var espejo: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.white.opacity(0.04))

            if let capa = webcam.previewLayer, webcam.isSessionRunning {
                CameraPreviewLayerView(previewLayer: capa)
                    .scaleEffect(x: -1, y: 1)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            } else {
                Image(systemName: "web.camera")
                    .font(.system(size: 22, weight: .light))
                    .foregroundStyle(.white.opacity(0.25))
            }

            // Marco que pulsa en el momento exacto en que se saca la foto: sin eso no hay
            // forma de saber cuándo quedarse quieto.
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(
                    appModel.registroDeCara.sacando ? Color.green.opacity(0.85) : Color.white.opacity(0.10),
                    lineWidth: appModel.registroDeCara.sacando ? 2.5 : 1
                )
                .animation(.easeOut(duration: 0.18), value: appModel.registroDeCara.sacando)
        }
        .frame(width: 116, height: 116)
    }

    /// Un punto por toma: lleno el que ya salió, verde si sirvió.
    private var puntos: some View {
        HStack(spacing: 5) {
            ForEach(0 ..< appModel.registroDeCara.total, id: \.self) { i in
                Circle()
                    .fill(color(paso: i))
                    .frame(width: 6, height: 6)
            }
        }
    }

    private func color(paso: Int) -> Color {
        let r = appModel.registroDeCara
        if paso < r.buenas { return Color.green.opacity(0.75) }
        if paso < r.hechas { return Color.orange.opacity(0.6) }
        return Color.white.opacity(0.16)
    }
}
