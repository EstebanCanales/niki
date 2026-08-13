import SwiftUI

/// Con qué piensa Niki.
///
/// El runtime del agente sabe hablar con 38 proveedores; hasta ahora elegir uno era
/// editar un YAML y reiniciar a mano. Acá se ve cuál está activo, cuáles tienen
/// credencial lista, y se cambia sin tocar nada más.
///
/// No tiene nada que ver con la voz: la conversación hablada va por otro camino.
struct NikiProviderPanel: View {
    @EnvironmentObject private var appModel: NikiAppModel
    @State private var modeloEditado = ""
    @State private var seleccionado: String?

    var body: some View {
        SidebarShell(eyebrow: "Modelo", title: "Con qué piensa Niki") {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    activo
                    if let login = appModel.pendingLogin { tarjetaLogin(login) }
                    if !appModel.agentError.isEmpty { error }
                    listos
                    if !porSuscripcion.isEmpty { suscripciones }
                    if !sinCredencial.isEmpty { resto }
                }
            }
        }
        .task {
            await appModel.loadAgentProviders()
            modeloEditado = appModel.agentSelection?.model ?? ""
            seleccionado = appModel.agentSelection?.provider
        }
    }

    private var conCredencial: [NikiAgentProvider] { appModel.agentProviders.filter(\.credentialReady) }
    /// Por suscripción: no llevan clave, se entra con la cuenta (ChatGPT/Codex, Nous,
    /// Qwen, Grok, Gemini, MiniMax, Copilot). Van aparte porque la acción es distinta:
    /// iniciar sesión, no pegar una variable en un archivo.
    private var porSuscripcion: [NikiAgentProvider] {
        appModel.agentProviders.filter { !$0.credentialReady && $0.authType != "api_key" }
    }
    private var sinCredencial: [NikiAgentProvider] {
        appModel.agentProviders.filter { !$0.credentialReady && $0.authType == "api_key" }
    }

    // MARK: - Secciones

    private var activo: some View {
        SidebarCard {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Circle()
                        .fill(colorEstado)
                        .frame(width: 7, height: 7)
                    Text(textoEstado)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.55))
                    if appModel.agentSwitching {
                        ProgressView().controlSize(.small).scaleEffect(0.6)
                    }
                }
                Text(appModel.agentSelection?.model ?? "—")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.9))
                Text(appModel.agentSelection?.provider ?? "sin proveedor")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.45))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var error: some View {
        SidebarCard {
            Text(appModel.agentError)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.orange.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var listos: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("LISTOS PARA USAR")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.3))
                .padding(.leading, 2)

            if conCredencial.isEmpty {
                SidebarCard {
                    Text("Ningún proveedor tiene credencial. Definí su clave en app/backend/.env.")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.45))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            ForEach(conCredencial) { p in
                fila(p)
            }
        }
    }

    private func fila(_ p: NikiAgentProvider) -> some View {
        let esActivo = appModel.agentSelection?.provider == p.id
        let abierto = seleccionado == p.id

        return SidebarCard {
            VStack(alignment: .leading, spacing: 10) {
                Button {
                    seleccionado = abierto ? nil : p.id
                    if !abierto, esActivo { modeloEditado = appModel.agentSelection?.model ?? "" }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: esActivo ? "largecircle.fill.circle" : "circle")
                            .font(.system(size: 13))
                            .foregroundStyle(esActivo ? Color.green.opacity(0.8) : Color.white.opacity(0.3))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(p.name)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Color.white.opacity(0.85))
                            Text(p.credentialFrom ?? "")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.35))
                        }
                        Spacer()
                        Image(systemName: abierto ? "chevron.up" : "chevron.down")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.3))
                    }
                }
                .buttonStyle(.plain)

                if abierto {
                    // El modelo se escribe a mano: cada proveedor tiene su catálogo y
                    // pedirlo sería un round-trip por proveedor para una lista que
                    // cambia sola. El backend rechaza lo que no exista.
                    TextField("nombre del modelo", text: $modeloEditado)
                        .textFieldStyle(.plain)
                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                        .padding(8)
                        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 7))
                        .foregroundStyle(Color.white.opacity(0.8))

                    Button {
                        let modelo = modeloEditado.trimmingCharacters(in: .whitespaces)
                        guard !modelo.isEmpty else { return }
                        Task { await appModel.switchAgentProvider(p, model: modelo) }
                    } label: {
                        Text(appModel.agentSwitching ? "Cambiando…" : "Usar este")
                            .font(.system(size: 12, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 7)
                            .background(Color.white.opacity(0.09), in: RoundedRectangle(cornerRadius: 7))
                            .foregroundStyle(Color.white.opacity(0.85))
                    }
                    .buttonStyle(.plain)
                    .disabled(appModel.agentSwitching || modeloEditado.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    /// Lo que hay que abrir y tipear para completar el inicio de sesión.
    /// Se muestra acá y no en una Terminal: mandar a otro lado a copiar un código es
    /// justo lo que la app puede evitar.
    private func tarjetaLogin(_ login: NikiProviderLogin) -> some View {
        SidebarCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("INICIAR SESIÓN\(login.provider.map { " · \($0)" } ?? "")")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Color.white.opacity(0.4))
                    Spacer()
                    Button { appModel.dismissLogin() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(Color.white.opacity(0.35))
                    }
                    .buttonStyle(.plain)
                }

                Text("1. Abrí este link")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.5))
                Button {
                    if let u = URL(string: login.url) { NSWorkspace.shared.open(u) }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "safari")
                        Text(login.url)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .font(.system(size: 11, weight: .medium))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 7)
                    .background(Color.blue.opacity(0.18), in: RoundedRectangle(cornerRadius: 7))
                    .foregroundStyle(Color.blue.opacity(0.95))
                }
                .buttonStyle(.plain)

                if let code = login.code {
                    Text("2. Poné este código")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.5))
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(code, forType: .string)
                    } label: {
                        HStack {
                            Text(code)
                                .font(.system(size: 18, weight: .bold, design: .monospaced))
                                .foregroundStyle(Color.white.opacity(0.92))
                            Spacer()
                            Image(systemName: "doc.on.doc")
                                .font(.system(size: 11))
                                .foregroundStyle(Color.white.opacity(0.35))
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 9)
                        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 7))
                    }
                    .buttonStyle(.plain)
                    Text("Tocá el código para copiarlo.")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.28))
                }

                Text("Cuando apruebes en el navegador, la sesión queda guardada sola. Después recargá este panel.")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.35))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var suscripciones: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("POR SUSCRIPCIÓN (\(porSuscripcion.count))")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.3))
                .padding(.leading, 2)
            Text("Se entra con tu cuenta, sin clave.")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.3))
                .padding(.leading, 2)

            ForEach(porSuscripcion) { p in
                SidebarCard {
                    HStack(spacing: 8) {
                        Image(systemName: "person.crop.circle.badge.questionmark")
                            .font(.system(size: 13))
                            .foregroundStyle(Color.white.opacity(0.28))
                        Text(p.name)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.62))
                        Spacer()
                        Button {
                            Task { await appModel.startProviderLogin(p) }
                        } label: {
                            Text(appModel.loginStarting ? "Abriendo…" : "Iniciar sesión")
                                .font(.system(size: 11, weight: .semibold))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(Color.white.opacity(0.09), in: RoundedRectangle(cornerRadius: 6))
                                .foregroundStyle(Color.white.opacity(0.8))
                        }
                        .buttonStyle(.plain)
                        .disabled(appModel.loginStarting)
                    }
                }
            }
        }
    }

    private var resto: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("SIN CREDENCIAL (\(sinCredencial.count))")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.3))
                .padding(.leading, 2)

            // Cada proveedor es su propia fila. Antes iban todos juntos en un párrafo,
            // y así no servían para nada: no se podía ver cuál es cuál ni qué le falta.
            ForEach(sinCredencial) { p in
                filaSinCredencial(p)
            }
        }
    }

    /// Fila de un proveedor que todavía no se puede usar. Se despliega igual que los
    /// otros, pero en vez del campo de modelo muestra exactamente qué variable poner.
    private func filaSinCredencial(_ p: NikiAgentProvider) -> some View {
        let abierto = seleccionado == p.id
        return SidebarCard {
            VStack(alignment: .leading, spacing: 10) {
                Button {
                    seleccionado = abierto ? nil : p.id
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "circle.dotted")
                            .font(.system(size: 13))
                            .foregroundStyle(Color.white.opacity(0.22))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(p.name)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.55))
                            Text(etiquetaAuth(p))
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.28))
                        }
                        Spacer()
                        Image(systemName: abierto ? "chevron.up" : "chevron.down")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.22))
                    }
                }
                .buttonStyle(.plain)

                if abierto {
                    VStack(alignment: .leading, spacing: 6) {
                        if p.apiKeyEnvVars.isEmpty {
                            Text("Se autentica con \(p.authType). Configuralo desde el runtime del agente.")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.45))
                                .fixedSize(horizontal: false, vertical: true)
                        } else {
                            Text("Poné en app/backend/.env:")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.4))
                            ForEach(p.apiKeyEnvVars, id: \.self) { v in
                                Text("\(v)=…")
                                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                                    .foregroundStyle(Color.white.opacity(0.6))
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 4)
                                    .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 5))
                            }
                            Text("Cualquiera de esas sirve. Después reiniciá el backend.")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.3))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if !p.baseUrl.isEmpty {
                            Text(p.baseUrl)
                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                .foregroundStyle(Color.white.opacity(0.25))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }

    /// Cómo se autentica, en cristiano. "api_key" no le dice nada a nadie.
    private func etiquetaAuth(_ p: NikiAgentProvider) -> String {
        switch p.authType {
        case "api_key": return p.apiKeyEnvVars.first ?? "clave de API"
        case "oauth_device_code", "oauth_external", "oauth_minimax": return "requiere iniciar sesión"
        case "aws_sdk": return "credenciales de AWS"
        case "external_process": return "proceso externo"
        default: return p.authType
        }
    }

    private var colorEstado: Color {
        switch appModel.agentRuntimeState {
        case "ready": return .green.opacity(0.8)
        case "starting", "restarting": return .yellow.opacity(0.8)
        case "failed": return .red.opacity(0.8)
        default: return .white.opacity(0.3)
        }
    }

    private var textoEstado: String {
        switch appModel.agentRuntimeState {
        case "ready": return "RUNTIME LISTO"
        case "starting": return "ARRANCANDO"
        case "restarting": return "REINICIANDO"
        case "failed": return "FALLÓ"
        case "disabled": return "APAGADO"
        default: return "—"
        }
    }
}
