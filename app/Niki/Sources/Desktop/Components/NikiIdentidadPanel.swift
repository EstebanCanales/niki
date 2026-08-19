import SwiftUI

/// Cómo Niki sabe que sos vos: la cara y la voz, juntas.
///
/// Estaban separadas y una escondida: la huella de voz vivía adentro del panel de
/// micrófono, entre los selectores de dispositivo, donde nadie la encontraba — de hecho
/// nunca se registró. Son la misma idea y van en el mismo lugar.
///
/// Las dos **fallan en abierto**: si no te reconocen, si el modelo no está, si la cámara
/// está tapada, todo sigue funcionando igual. Sirven para personalizar, no para dejar a
/// nadie afuera. Una webcam 2D se engaña con una foto en un teléfono, y esto está escrito
/// en la pantalla a propósito para que nadie lo confunda con seguridad.
struct NikiIdentidadPanel: View {
    @EnvironmentObject private var appModel: NikiAppModel
    @State private var registrandoCara = false
    @State private var copiado = false
    @State private var errorCara = ""

    var body: some View {
        SidebarShell(eyebrow: "Identidad", title: "Cómo te reconoce") {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    tarjetaPrueba
                    tarjetaCara
                    NikiSpeakerPanel()

                    Text("Las dos cosas sirven para saber que sos vos y personalizar lo que Niki hace. Ninguna bloquea nada: si no te reconoce —poca luz, cámara tapada, resfrío— todo sigue funcionando igual. Una cámara común se puede engañar con una foto, así que esto no es una cerradura.")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.32))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.bottom, 4)
            }
            .scrollIndicators(.never)
        }
        .task { await appModel.cargarEstadoDeCara() }
    }

    /// Probar todo y ver los números.
    ///
    /// Va primero a propósito. Cuando algo no anda, lo que hace falta no es otro botón de
    /// registrar: es saber qué está pasando. Cada línea de acá dice un número, porque un
    /// "ok" no alcanza para arreglar nada.
    private var tarjetaPrueba: some View {
        SidebarCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    Image(systemName: "stethoscope")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.4))
                    Text("Probar todo")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.82))
                    Spacer(minLength: 8)
                    if appModel.prueba.corriendo {
                        ProgressView().scaleEffect(0.5).frame(width: 16, height: 16)
                    }
                }

                Text("Prende la cámara y el micrófono un segundo y dice qué ve, con números. No registra nada.")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.52))
                    .fixedSize(horizontal: false, vertical: true)

                if !appModel.prueba.lineas.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        ForEach(appModel.prueba.lineas) { linea in
                            HStack(alignment: .top, spacing: 7) {
                                Circle()
                                    .fill(colorDe(linea.estado))
                                    .frame(width: 6, height: 6)
                                    .padding(.top, 4)
                                Text(linea.que)
                                    .font(.system(size: 11.5, weight: .semibold))
                                    .foregroundStyle(Color.white.opacity(0.72))
                                    .frame(width: 108, alignment: .leading)
                                Text(linea.dato)
                                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                                    .foregroundStyle(Color.white.opacity(0.55))
                                    .textSelection(.enabled)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.black.opacity(0.22))
                    )
                }

                HStack(spacing: 10) {
                    boton(appModel.prueba.corriendo ? "Probando…" : "Probar todo") {
                        Task { await appModel.prueba.correr() }
                    }
                    .disabled(appModel.prueba.corriendo)
                    if !appModel.prueba.lineas.isEmpty {
                        boton(copiado ? "Copiado ✓" : "Copiar") {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(appModel.prueba.comoTexto(), forType: .string)
                            copiado = true
                            Task {
                                try? await Task.sleep(nanoseconds: 1_500_000_000)
                                copiado = false
                            }
                        }
                    }
                }
            }
        }
    }

    private func colorDe(_ estado: NikiLineaDePrueba.Estado) -> Color {
        switch estado {
        case .bien: return Color.green.opacity(0.75)
        case .aviso: return Color.orange.opacity(0.75)
        case .mal: return Color.red.opacity(0.8)
        }
    }

    private var tarjetaCara: some View {
        SidebarCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    Image(systemName: iconoCara)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(appModel.cara.hayPerfil ? Color.green.opacity(0.8) : Color.white.opacity(0.3))
                    Text(titulo)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.82))
                    Spacer(minLength: 8)
                    if appModel.cara.mirando {
                        ProgressView().scaleEffect(0.5).frame(width: 16, height: 16)
                    }
                }

                Text(explicacion)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.42))
                    .fixedSize(horizontal: false, vertical: true)

                // El mismo estado que muestra el notch, también acá.
                //
                // No es duplicado por gusto: si el notch no llega a abrirse —tapado por
                // otra ventana, en otra pantalla, o porque falló— el registro pasaba
                // entero sin que se viera nada y quedaba en "no me funciona y no sé por
                // qué". Con esto siempre hay dónde mirar.
                if appModel.registroDeCara.activo {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            if !appModel.registroDeCara.terminado {
                                ProgressView().scaleEffect(0.4).frame(width: 12, height: 12)
                            }
                            Text(appModel.registroDeCara.titulo)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Color.white.opacity(0.8))
                        }
                        if !appModel.registroDeCara.detalle.isEmpty {
                            Text(appModel.registroDeCara.detalle)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.45))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if appModel.registroDeCara.hechas > 0 {
                            Text("\(appModel.registroDeCara.buenas) de \(appModel.registroDeCara.hechas) tomas con cara")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.35))
                        }
                    }
                }
                if !errorCara.isEmpty {
                    Text(errorCara)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.orange.opacity(0.85))
                        .fixedSize(horizontal: false, vertical: true)
                }

                if appModel.cara.disponible == true {
                    HStack(spacing: 10) {
                        boton(appModel.cara.hayPerfil ? "Registrar de nuevo" : "Registrar mi cara — se abre el notch") {
                            Task { await registrar() }
                        }
                        if appModel.cara.hayPerfil {
                            boton("Olvidar") { Task { await appModel.cara.olvidar() } }
                        }
                    }
                    .disabled(registrandoCara)
                    .opacity(registrandoCara ? 0.5 : 1)
                }
            }
        }
    }

    private var iconoCara: String {
        if appModel.cara.disponible == nil { return "person.crop.square" }
        return appModel.cara.hayPerfil ? "faceid" : "person.crop.square.badge.camera"
    }

    private var titulo: String {
        switch appModel.cara.disponible {
        case nil: return "Viendo si está instalada…"
        case false: return "La cámara no está instalada en el backend"
        default: return appModel.cara.hayPerfil ? "Niki reconoce tu cara" : "Tu cara no está registrada"
        }
    }

    private var explicacion: String {
        if appModel.cara.disponible == nil { return "" }
        if appModel.cara.disponible == false {
            return "Falta el entorno con OpenCV o los modelos. Sin eso, esta parte simplemente no corre y nada más deja de andar."
        }
        if appModel.cara.hayPerfil {
            return "La cámara se prende cuando empezás a hablarle y se apaga cuando terminás. No mira el resto del tiempo."
        }
        return "Se sacan cinco fotos con una pausa entre cada una, para que entren distintas poses. La cámara se prende solo durante el registro."
    }

    /// El registro pasa en el notch, no acá.
    ///
    /// Lo que hay que ver es la cámara, y pedirle a alguien que registre su cara sin verse
    /// es como cortarse el pelo sin espejo. El notch se abre solo y muestra el espejo, en
    /// qué foto va y si alguna no sirvió.
    private func registrar() async {
        registrandoCara = true
        errorCara = ""
        defer { registrandoCara = false }
        await appModel.registrarCaraEnElNotch()
        await appModel.cargarEstadoDeCara()
    }

    private func boton(_ titulo: String, accion: @escaping () -> Void) -> some View {
        Button(action: accion) {
            Text(titulo)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.72))
                .padding(.horizontal, 14)
                .frame(height: 30)
                .background(Capsule().fill(Color.white.opacity(0.06)))
        }
        .buttonStyle(.plain)
    }
}
