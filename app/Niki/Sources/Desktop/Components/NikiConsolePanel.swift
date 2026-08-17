import SwiftUI

/// La consola de debug: qué está haciendo Niki por dentro, en vivo.
///
/// Los eventos que muestra el backend los venía mandando desde siempre —cada llamada a
/// una herramienta, cada error del runtime, cada turno— y la app los tiraba: no había un
/// caso para ellos en el manejador del stream. Esto no inventa telemetría nueva, muestra
/// la que ya viajaba.
///
/// Por qué importa: la compactación de contexto estuvo rota semanas y desde la app no
/// había forma de notarlo. El error estaba, pero solo en un archivo de log que hay que
/// saber que existe y dónde está.
struct NikiConsolePanel: View {
    @EnvironmentObject private var appModel: NikiAppModel
    @State private var nivel: String = "todos"
    @State private var busqueda: String = ""
    @State private var expandidas: Set<UUID> = []
    @State private var copiado = false

    private let niveles = ["todos", "error", "warning", "info", "success"]

    private var entradas: [NikiConsoleEntry] {
        appModel.consola.filter { e in
            let pasaNivel = nivel == "todos" || e.level == nivel
            guard pasaNivel else { return false }
            guard !busqueda.isEmpty else { return true }
            let aguja = busqueda.lowercased()
            return e.title.lowercased().contains(aguja)
                || e.summary.lowercased().contains(aguja)
                || e.type.lowercased().contains(aguja)
                || (e.detail?.lowercased().contains(aguja) ?? false)
        }
    }

    var body: some View {
        SidebarShell(eyebrow: "Debug", title: "Consola") {
            VStack(alignment: .leading, spacing: 10) {
                controles

                if appModel.consola.isEmpty {
                    SidebarCard {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Todavía no pasó nada.")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.62))
                            Text("Acá aparece lo que Niki hace por dentro: cada herramienta que usa, cada error del runtime, cada turno. Escribile algo y mirá.")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.34))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                } else if entradas.isEmpty {
                    SidebarCard {
                        Text("Nada coincide con el filtro.")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.4))
                    }
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 6) {
                            ForEach(entradas) { entrada in
                                fila(entrada)
                            }
                        }
                        .padding(.bottom, 4)
                    }
                    .scrollIndicators(.never)
                }
            }
        }
    }

    private var controles: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Nivel", selection: $nivel) {
                ForEach(niveles, id: \.self) { n in
                    Text(n == "todos" ? "Todos" : n.capitalized).tag(n)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.3))
                TextField("Buscar", text: $busqueda)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.white.opacity(0.8))
            }
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.white.opacity(0.035))
            )

            HStack(spacing: 8) {
                // Pausar no desconecta nada: se sigue recibiendo, no se agrega. Sin esto,
                // leer algo que acaba de pasar es imposible porque el flujo lo empuja.
                botonChico(appModel.consolaEnPausa ? "Reanudar" : "Pausar",
                           icono: appModel.consolaEnPausa ? "play.fill" : "pause.fill") {
                    appModel.consolaEnPausa.toggle()
                }
                botonChico(copiado ? "Copiado ✓" : "Copiar", icono: "doc.on.doc") {
                    let texto = appModel.consolaComoTexto()
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(texto, forType: .string)
                    copiado = true
                    Task {
                        try? await Task.sleep(nanoseconds: 1_500_000_000)
                        copiado = false
                    }
                }
                botonChico("Limpiar", icono: "trash") { appModel.limpiarConsola() }

                Spacer()

                Text("\(entradas.count)")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.3))
            }
        }
    }

    private func botonChico(_ titulo: String, icono: String, accion: @escaping () -> Void) -> some View {
        Button(action: accion) {
            HStack(spacing: 5) {
                Image(systemName: icono).font(.system(size: 9, weight: .bold))
                Text(titulo).font(.system(size: 11, weight: .semibold))
            }
            .foregroundStyle(Color.white.opacity(0.62))
            .padding(.horizontal, 10)
            .frame(height: 26)
            .background(Capsule().fill(Color.white.opacity(0.05)))
        }
        .buttonStyle(.plain)
    }

    private func fila(_ entrada: NikiConsoleEntry) -> some View {
        let abierta = expandidas.contains(entrada.id)
        return VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .top, spacing: 8) {
                Circle()
                    .fill(colorDeNivel(entrada.level))
                    .frame(width: 6, height: 6)
                    .padding(.top, 5)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(entrada.title)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.82))
                            .lineLimit(1)
                        Spacer(minLength: 6)
                        Text(hora(entrada.at))
                            .font(.system(size: 10, weight: .medium).monospacedDigit())
                            .foregroundStyle(Color.white.opacity(0.26))
                    }

                    if !entrada.summary.isEmpty {
                        Text(entrada.summary)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.5))
                            .lineLimit(abierta ? nil : 2)
                            .fixedSize(horizontal: false, vertical: abierta)
                    }

                    Text("\(entrada.source) · \(entrada.type)")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.26))
                }
            }

            if abierta, let detalle = entrada.detail {
                Text(detalle)
                    .font(.system(size: 10.5, weight: .regular, design: .monospaced))
                    .foregroundStyle(Color.white.opacity(0.55))
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(Color.black.opacity(0.22))
                    )
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.white.opacity(entrada.level == "error" ? 0.05 : 0.028))
        )
        .contentShape(Rectangle())
        .onTapGesture {
            guard entrada.detail != nil else { return }
            if abierta { expandidas.remove(entrada.id) } else { expandidas.insert(entrada.id) }
        }
    }

    private func hora(_ fecha: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f.string(from: fecha)
    }

    private func colorDeNivel(_ nivel: String) -> Color {
        switch nivel {
        case "error": return Color.red.opacity(0.85)
        case "warning": return Color.orange.opacity(0.85)
        case "success": return Color.green.opacity(0.7)
        default: return Color.white.opacity(0.3)
        }
    }
}
