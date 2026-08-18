import AVFoundation
import SwiftUI

/// La cámara, con su propia capa de vista previa.
///
/// No reusa `WebcamManager.previewLayer` a propósito: esa es una sola instancia
/// compartida, y una capa de Core Animation vive en una vista y nada más. Si el espejo del
/// notch ya la tiene montada, la segunda vista que la pida queda en negro — que es
/// exactamente lo que pasaba acá. Cada vista se arma la suya con la misma sesión.
struct VistaDeCamara: NSViewRepresentable {
    let sesion: AVCaptureSession
    var radio: CGFloat = 18

    func makeNSView(context: Context) -> NSView {
        let vista = NSView()
        vista.wantsLayer = true

        let capa = AVCaptureVideoPreviewLayer(session: sesion)
        capa.videoGravity = .resizeAspectFill

        // Espejado y esquinas redondeadas se hacen ACÁ, en la capa, y no con
        // `.scaleEffect` y `.clipShape` de SwiftUI. SwiftUI no puede transformar de verdad
        // una capa de vídeo en vivo: la compone aparte y de ahí salen los bordes sucios y
        // las sombras raras que se veían. AVFoundation tiene su propio espejado.
        if let conexion = capa.connection, conexion.isVideoMirroringSupported {
            conexion.automaticallyAdjustsVideoMirroring = false
            conexion.isVideoMirrored = true
        }
        capa.cornerRadius = radio
        capa.masksToBounds = true
        // Sin esto, el fondo de la capa asoma en las esquinas redondeadas como un halo.
        capa.backgroundColor = NSColor.black.cgColor

        capa.frame = vista.bounds
        vista.layer = capa
        return vista
    }

    func updateNSView(_ vista: NSView, context: Context) {
        // Sin desactivar las acciones implícitas, cada cambio de tamaño anima la capa y se
        // ve un salto elástico cada vez que el notch se acomoda.
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        vista.layer?.frame = vista.bounds
        (vista.layer as? AVCaptureVideoPreviewLayer)?.cornerRadius = radio
        CATransaction.commit()
    }
}

/// Registrar la cara viéndote, en el notch.
///
/// Todo el espacio va a la cámara: es lo único que hay que mirar mientras pasa. El texto
/// va abajo, corto, y los puntos al pie. La primera versión ponía la cámara chica al
/// costado del texto y no se entendía qué era lo importante.
struct NotchRegistroDeCara: View {
    @EnvironmentObject private var appModel: NikiAppModel
    @ObservedObject private var webcam = WebcamManager.shared

    var body: some View {
        VStack(spacing: 10) {
            espejo

            VStack(spacing: 3) {
                Text(appModel.registroDeCara.titulo)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.92))
                    .lineLimit(1)

                Text(appModel.registroDeCara.detalle)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(.white.opacity(0.42))
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if appModel.registroDeCara.total > 0 {
                puntos
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// Cuadrado y espejado, como cualquier cámara frontal: uno espera verse como en un
    /// espejo, no como lo ve la cámara.
    private var espejo: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color.white.opacity(0.05))

            if let sesion = webcam.sesion, webcam.isSessionRunning {
                VistaDeCamara(sesion: sesion, radio: 18)
            } else {
                VStack(spacing: 6) {
                    Image(systemName: "web.camera")
                        .font(.system(size: 26, weight: .light))
                    Text("prendiendo…")
                        .font(.system(size: 10, weight: .medium))
                }
                .foregroundStyle(.white.opacity(0.28))
            }

            // El marco pulsa en el momento exacto de la foto: sin eso no hay forma de
            // saber cuándo quedarse quieto.
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(
                    appModel.registroDeCara.sacando ? Color.green.opacity(0.9) : Color.white.opacity(0.10),
                    lineWidth: appModel.registroDeCara.sacando ? 3 : 1
                )
                .animation(.easeOut(duration: 0.16), value: appModel.registroDeCara.sacando)
        }
        .frame(width: 148, height: 148)
    }

    /// Un punto por toma: verde si sirvió, naranja si no se encontró cara.
    private var puntos: some View {
        HStack(spacing: 6) {
            ForEach(0 ..< appModel.registroDeCara.total, id: \.self) { i in
                Circle()
                    .fill(color(paso: i))
                    .frame(width: 7, height: 7)
            }
        }
    }

    private func color(paso: Int) -> Color {
        let r = appModel.registroDeCara
        if paso < r.buenas { return Color.green.opacity(0.8) }
        if paso < r.hechas { return Color.orange.opacity(0.65) }
        return Color.white.opacity(0.18)
    }
}
