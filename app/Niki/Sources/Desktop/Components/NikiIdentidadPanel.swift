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
    @State private var errorCara = ""

    var body: some View {
        SidebarShell(eyebrow: "Identidad", title: "Cómo te reconoce") {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
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

                if appModel.registroDeCara.activo {
                    Text("Mirá el notch: ahí se ve la cámara y en qué foto va.")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.6))
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
