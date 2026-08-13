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
                    if !appModel.agentError.isEmpty { error }
                    listos
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
    private var sinCredencial: [NikiAgentProvider] { appModel.agentProviders.filter { !$0.credentialReady } }

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

    private var resto: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("SIN CREDENCIAL (\(sinCredencial.count))")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.3))
                .padding(.leading, 2)
            SidebarCard {
                VStack(alignment: .leading, spacing: 6) {
                    // No se listan los 36 uno por uno: sería una pared. Lo útil es saber
                    // que están y qué variable haría falta.
                    Text(sinCredencial.prefix(8).map(\.name).joined(separator: " · "))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.4))
                        .fixedSize(horizontal: false, vertical: true)
                    if sinCredencial.count > 8 {
                        Text("y \(sinCredencial.count - 8) más")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.28))
                    }
                    Text("Para usar uno, poné su clave en app/backend/.env y reiniciá el backend.")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.3))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
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
