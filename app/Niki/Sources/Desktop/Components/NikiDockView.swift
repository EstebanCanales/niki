import SwiftUI

struct NikiDockView: View {
    @EnvironmentObject private var appModel: NikiAppModel
    @Binding var selection: DockItem?
    @State private var hoveredItem: DockItem?
    @State private var showMicPopover = false
    @Namespace private var selectionAnimation

    var body: some View {
        NikiGlassPanel(cornerRadius: 999, outerBorderOpacity: 0.12, blurBackground: true) {
            HStack(spacing: 0) {
                ForEach(Array(appModel.availableDockItems.enumerated()), id: \.element.id) { index, item in
                    HStack(spacing: 0) {
                        Button {
                            withAnimation(.spring(response: 0.32, dampingFraction: 0.78)) {
                                handleTap(item)
                            }
                        } label: {
                            ZStack {
                                modeBackground(for: item)
                                Image(systemName: item.symbol)
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(iconColor(for: item))
                            }
                            .frame(width: 38, height: 38)
                            .background(buttonBackground(for: item))
                        }
                        .buttonStyle(.plain)
                        .help(item.title)
                        // Un botón que solo tiene un símbolo no le dice nada a VoiceOver:
                        // el dock entero era once botones sin nombre. Con esto además se
                        // puede comprobar desde afuera qué paneles están llegando de
                        // verdad, que es como se descubrió que tres estaban invisibles.
                        .accessibilityIdentifier("dock-\(item.rawValue)")
                        .accessibilityLabel(item.title)
                        .accessibilityAddTraits(selection == item ? [.isButton, .isSelected] : .isButton)
                        .onHover { inside in
                            withAnimation(.easeOut(duration: 0.18)) {
                                hoveredItem = inside ? item : (hoveredItem == item ? nil : hoveredItem)
                            }
                        }
                        .popover(
                            isPresented: Binding(
                                get: { item == .mic && showMicPopover },
                                set: { showMicPopover = $0 }
                            ),
                            arrowEdge: .top
                        ) {
                            MicPopover()
                                .environmentObject(appModel)
                        }

                        if shouldShowSeparator(after: item) {
                            Rectangle()
                                .fill(Color.white.opacity(0.06))
                                .frame(width: 1, height: 18)
                                .padding(.horizontal, 7)
                        }
                    }
                }

                // Controles de llamada: viven acá, junto al resto de controles, y solo
                // aparecen mientras hay una conversación de voz en curso.
                if appModel.callModeActive {
                    callControls
                        .transition(.asymmetric(
                            insertion: .scale(scale: 0.6).combined(with: .opacity),
                            removal: .scale(scale: 0.8).combined(with: .opacity)))
                }
            }
            .animation(.spring(response: 0.34, dampingFraction: 0.8), value: appModel.callModeActive)
            .padding(.horizontal, 8)
            .padding(.vertical, 8)
            .background(
                Capsule(style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.045),
                                Color.white.opacity(0.02)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .overlay(
                        Capsule(style: .continuous)
                            .stroke(Color.white.opacity(0.08), lineWidth: 1)
                    )
                    .shadow(color: Color.white.opacity(0.05), radius: 0.5, y: -0.5)
            )
            .padding(3)
        }
    }

    /// Silenciar y colgar, con el mismo tamaño, hover y separador que el resto del dock.
    @ViewBuilder
    private var callControls: some View {
        Rectangle()
            .fill(Color.white.opacity(0.06))
            .frame(width: 1, height: 18)
            .padding(.horizontal, 7)

        CallActionButton(
            symbol: appModel.callMuted ? "mic.slash.fill" : "mic.fill",
            tint: appModel.callMuted ? Self.mutedTint : Color.white.opacity(0.9),
            fill: appModel.callMuted ? Self.mutedTint.opacity(0.16) : Color.white.opacity(0.05),
            help: appModel.callMuted ? "Reactivar micrófono" : "Silenciar micrófono",
            action: { appModel.toggleCallMute() }
        )

        CallActionButton(
            symbol: "phone.down.fill",
            tint: Self.hangupTint,
            fill: Self.hangupTint.opacity(0.15),
            help: "Terminar llamada",
            action: { appModel.endCall() }
        )
    }

    private static let mutedTint = Color(red: 1, green: 0.55, blue: 0.45)
    private static let hangupTint = Color(red: 1, green: 0.45, blue: 0.42)

    private func handleTap(_ item: DockItem) {
        if item == .call {
            // El botón de voz inicia/detiene la conversación; no abre panel lateral.
            // El protagonista visual es el orbe central.
            appModel.toggleSttLab()
            return
        }
        if item == .verme {
            // Hablar con la cámara prendida. Si ya está andando, la apaga y la
            // conversación sigue: apretarlo de nuevo no debería colgar.
            if appModel.videollamada {
                appModel.videollamada = false
            } else {
                appModel.startVideollamada()
            }
            return
        }
        if item == .mic {
            // El micrófono sale como menú pequeño hacia arriba, no como sidebar.
            appModel.refreshMicDevices()
            showMicPopover.toggle()
            return
        }
        selection = selection == item ? nil : item
    }

    @ViewBuilder
    private func modeBackground(for item: DockItem) -> some View {
        if item == .verme, appModel.videollamada {
            // Mismo tratamiento que el botón de voz cuando está activo: se ve encendido.
            Circle().fill(Color.green.opacity(0.18))
        } else if item == .call {
            // Call mode activo: fondo de acento propio (no comparte matchedGeometry con la
            // selección, así nunca colapsa el botón cuando hay un panel abierto a la vez).
            if appModel.sttLabActive {
                ZStack {
                    // Halo que late con la voz — deja ver de un vistazo que la llamada
                    // sigue viva, incluso con la ventana de fondo.
                    Circle()
                        .fill(Color(red: 0.18, green: 0.46, blue: 1))
                        .opacity(0.20 + 0.30 * Double(appModel.audioLevel))
                        .scaleEffect(1.18 + 0.22 * Double(appModel.audioLevel))
                        .blur(radius: 5)
                    Circle()
                        .fill(Color(red: 0.18, green: 0.46, blue: 1).opacity(0.9))
                        .overlay(Circle().strokeBorder(Color.white.opacity(0.35), lineWidth: 1))
                }
                .animation(.easeOut(duration: 0.12), value: appModel.audioLevel)
            }
        } else if selection == item {
            Circle()
                .fill(Color.white.opacity(0.08))
                .overlay(Circle().strokeBorder(Color.white.opacity(0.06), lineWidth: 1))
                .matchedGeometryEffect(id: "dock-selection", in: selectionAnimation)
        }
    }

    private func shouldShowSeparator(after item: DockItem) -> Bool {
        // Separadores: entre módulos y voz (tras discover), y antes de Settings.
        item == .discover || (item == .mic && !appModel.sttLabEnabled) || item == .sttLab
    }

    private func buttonBackground(for item: DockItem) -> some View {
        let active = isActive(item)
        let hovered = hoveredItem == item

        return Circle()
            .fill(backgroundColor(active: active, hovered: hovered))
            .overlay(
                Circle()
                    .strokeBorder(active ? Color.white.opacity(0.06) : Color.clear, lineWidth: 1)
            )
            .opacity(active ? 0.001 : 1)
    }

    private func backgroundColor(active: Bool, hovered: Bool) -> Color {
        if active { return Color.white.opacity(0.08) }
        if hovered { return Color.white.opacity(0.04) }
        return .clear
    }

    private func iconColor(for item: DockItem) -> Color {
        let active = isActive(item)
        let hovered = hoveredItem == item
        if active { return Color.white.opacity(0.9) }
        if hovered { return Color.white.opacity(0.8) }
        return Color.white.opacity(0.5)
    }

    private func isActive(_ item: DockItem) -> Bool {
        // El botón de voz se ilumina mientras la conversación está activa, no por selección.
        if item == .call { return appModel.sttLabActive }
        return selection == item
    }
}

/// Botón de acción de llamada del dock. Mismo tamaño y comportamiento de hover que
/// los íconos de módulo, pero con su propio tinte (silenciar / colgar).
private struct CallActionButton: View {
    let symbol: String
    let tint: Color
    let fill: Color
    let help: String
    let action: () -> Void

    @State private var hovered = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 38, height: 38)
                .background(
                    Circle()
                        .fill(fill)
                        .overlay(
                            Circle().strokeBorder(
                                Color.white.opacity(hovered ? 0.14 : 0.05), lineWidth: 1)
                        )
                )
                .scaleEffect(hovered ? 1.06 : 1)
        }
        .buttonStyle(.plain)
        .help(help)
        .onHover { inside in
            withAnimation(.easeOut(duration: 0.16)) { hovered = inside }
        }
    }
}

/// Menú compacto de micrófonos que sale hacia arriba desde el botón del dock.
struct MicPopover: View {
    @EnvironmentObject private var appModel: NikiAppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("MICRÓFONO")
                .font(.system(size: 9, weight: .bold))
                .tracking(1.5)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .padding(.bottom, 4)

            micRow(id: 0, name: "Sistema (predeterminado)")
            ForEach(appModel.availableMicDevices, id: \.id) { dev in
                micRow(id: dev.id, name: dev.name)
            }

            if appModel.sttLabActive {
                Divider().padding(.vertical, 4)
                HStack(spacing: 6) {
                    Image(systemName: "waveform")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                    Text(String(format: "Nivel: %.0f dBFS", appModel.sttLabPeakDb))
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 6)
            }
        }
        .padding(.bottom, 6)
        .frame(width: 250)
    }

    private func micRow(id: UInt32, name: String) -> some View {
        let active = appModel.selectedMicDeviceID == id
        return Button {
            appModel.selectMicDevice(id)
        } label: {
            HStack(spacing: 9) {
                Image(systemName: active ? "checkmark.circle.fill" : "mic")
                    .font(.system(size: 12))
                    .foregroundStyle(active ? Color.accentColor : .secondary)
                    .frame(width: 16)
                Text(name)
                    .font(.system(size: 12, weight: active ? .semibold : .regular))
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
        }
        .buttonStyle(.plain)
    }
}
