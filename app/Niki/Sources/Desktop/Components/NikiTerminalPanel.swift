import SwiftUI

/// Una línea de la cinta de la terminal: un comando y lo que devolvió.
struct NikiTerminalLinea: Identifiable, Equatable {
    let id = UUID()
    let comando: String
    let salida: String
    let codigo: Int?
    let cwd: String
    /// Por qué se frenó, si el comando es de los catastróficos y falta confirmar.
    let bloqueado: String?
}

/// La terminal que comparten Esteban y Niki.
///
/// No es una terminal nueva: entra a la sesión que la IA ya está usando. El runtime guarda
/// el directorio y el entorno de su sesión en dos archivos del temporal y los relee en cada
/// comando; el backend usa la misma receta sobre los mismos archivos (ver
/// terminal-sesion.ts). Por eso, si Niki hace `cd`, esta terminal aparece ahí.
///
/// Lo que sí y lo que no, medido: el entorno viaja en los dos sentidos, el directorio va
/// solo de ella hacia acá — el runtime usa el que tiene en memoria y recién relee el
/// archivo después de ejecutar. Igualarlo pide tocar el fork y no vale.
///
/// No hay PTY: cada comando es un shell nuevo, igual que para la IA. `vim`, `top` y `ssh`
/// no andan.
struct NikiTerminalPanel: View {
    @EnvironmentObject private var appModel: NikiAppModel
    @State private var entrada = ""
    @State private var lineas: [NikiTerminalLinea] = []
    @State private var estado: NikiTerminalEstado = .vacio
    @State private var corriendo = false
    @State private var error = ""
    /// Historial de lo tipeado, para las flechas. Una terminal sin esto se vuelve tediosa.
    @State private var historial: [String] = []
    @State private var posicionHistorial: Int?
    @FocusState private var enfocado: Bool

    var body: some View {
        SidebarShell(eyebrow: "Terminal", title: "Compartida con Niki") {
            VStack(alignment: .leading, spacing: 10) {
                cabecera

                if lineas.isEmpty {
                    SidebarCard {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("La misma terminal que usa Niki.")
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.62))
                            Text("Si ella cambia de directorio, acá aparecés ahí. Lo que exportes vos, ella lo ve. Programas interactivos como vim o top no andan: cada comando es un shell nuevo.")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.34))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                } else {
                    cinta
                }

                composer
            }
        }
        .task {
            await refrescarEstado()
        }
    }

    private var cabecera: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(estado.compartidaConLaIA ? Color.green.opacity(0.7) : Color.orange.opacity(0.7))
                .frame(width: 6, height: 6)
            Text(estado.compartidaConLaIA ? "En la sesión de Niki" : "Sesión propia — Niki todavía no corrió nada")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.5))
            Spacer(minLength: 8)
            Text(acortar(estado.cwd))
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(Color.white.opacity(0.36))
                .lineLimit(1)
                .truncationMode(.head)
        }
    }

    private var cinta: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(lineas) { linea in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(alignment: .top, spacing: 6) {
                                Text("$")
                                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                                    .foregroundStyle(Color.green.opacity(0.55))
                                Text(linea.comando)
                                    .font(.system(size: 11.5, weight: .medium, design: .monospaced))
                                    .foregroundStyle(Color.white.opacity(0.82))
                                    .textSelection(.enabled)
                                    .fixedSize(horizontal: false, vertical: true)
                            }

                            if let motivo = linea.bloqueado {
                                Text("Frenado: \(motivo). Volvé a mandarlo para confirmar.")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(Color.orange.opacity(0.9))
                                    .fixedSize(horizontal: false, vertical: true)
                            } else if !linea.salida.isEmpty {
                                Text(linea.salida)
                                    .font(.system(size: 11, weight: .regular, design: .monospaced))
                                    .foregroundStyle(Color.white.opacity(linea.codigo == 0 ? 0.6 : 0.75))
                                    .textSelection(.enabled)
                                    .fixedSize(horizontal: false, vertical: true)
                            }

                            if let c = linea.codigo, c != 0 {
                                Text("salió con \(c)")
                                    .font(.system(size: 10, weight: .semibold))
                                    .foregroundStyle(Color.red.opacity(0.7))
                            }
                        }
                        .id(linea.id)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 4)
            }
            .scrollIndicators(.never)
            .onChange(of: lineas.count) { _, _ in
                if let ultima = lineas.last {
                    withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(ultima.id, anchor: .bottom) }
                }
            }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text("$")
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                    .foregroundStyle(Color.green.opacity(0.6))

                TextField("comando", text: $entrada)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(Color.white.opacity(0.86))
                    .focused($enfocado)
                    .disabled(corriendo)
                    .onSubmit { Task { await ejecutar() } }
                    .onKeyPress(.upArrow) { moverHistorial(1); return .handled }
                    .onKeyPress(.downArrow) { moverHistorial(-1); return .handled }

                if corriendo {
                    ProgressView().scaleEffect(0.5).frame(width: 16, height: 16)
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.black.opacity(0.25))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(Color.white.opacity(0.07), lineWidth: 1)
                    )
            )

            if !error.isEmpty {
                Text(error)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.red.opacity(0.8))
            }
        }
    }

    /// Las flechas recorren lo tipeado antes. 1 va hacia atrás en el tiempo, -1 adelante.
    private func moverHistorial(_ direccion: Int) {
        guard !historial.isEmpty else { return }
        let actual = posicionHistorial ?? -1
        let nueva = actual + direccion
        if nueva < 0 {
            posicionHistorial = nil
            entrada = ""
        } else if nueva < historial.count {
            posicionHistorial = nueva
            entrada = historial[nueva]
        }
    }

    private func ejecutar() async {
        let comando = entrada.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !comando.isEmpty, !corriendo else { return }

        // Un comando frenado por peligroso se confirma volviéndolo a mandar igual. Es el
        // mismo gesto que uno hace igual —repetirlo— y evita inventar un diálogo.
        let confirmar = lineas.last?.bloqueado != nil && lineas.last?.comando == comando

        corriendo = true
        error = ""
        entrada = ""
        posicionHistorial = nil
        historial.insert(comando, at: 0)

        do {
            let r = try await appModel.client.terminalEjecutar(comando, confirmar: confirmar)
            lineas.append(NikiTerminalLinea(
                comando: r.comando,
                salida: r.cortadoPorTiempo ? r.salida + "\n[cortado: pasó el tiempo límite]" : r.salida,
                codigo: r.codigo,
                cwd: r.cwd,
                bloqueado: r.bloqueado
            ))
            estado = NikiTerminalEstado(ok: true, cwd: r.cwd, compartidaConLaIA: r.compartidaConLaIA, sesion: estado.sesion)
        } catch {
            self.error = error.localizedDescription
        }
        corriendo = false
        enfocado = true
    }

    private func refrescarEstado() async {
        guard let e = try? await appModel.client.terminalEstado() else { return }
        estado = e
    }

    /// El directorio con `~` en vez del home, como lo escribe cualquier prompt.
    private func acortar(_ ruta: String) -> String {
        let home = NSHomeDirectory()
        return ruta.hasPrefix(home) ? "~" + ruta.dropFirst(home.count) : ruta
    }
}
