//
//  ContentView.swift
//  Niki
//

import AppKit
import Foundation
import Defaults
import SwiftUI
import UniformTypeIdentifiers


@MainActor
struct NikiNotchContentView: View {
    @EnvironmentObject var vm: NikiNotchViewModel
    @EnvironmentObject var appModel: NikiAppModel
    @ObservedObject private var coordinator = NikiNotchCoordinator.shared
    @Namespace private var albumArtNamespace
    @FocusState private var promptFocused: Bool
    @State private var hoverTask: Task<Void, Never>?
    @State private var isHovering = false
    @State private var prompt = ""

    private let openAnimation = Animation.spring(response: 0.42, dampingFraction: 0.82, blendDuration: 0)
    private let closeAnimation = Animation.spring(response: 0.45, dampingFraction: 1.0, blendDuration: 0)

    /// En llamada el notch pasa a una tarjeta angosta y casi cuadrada: orbe al centro y
    /// controles abajo, sin campo de texto ni tabs.
    private var inCall: Bool { appModel.sttLabActive }

    /// El notch está dedicado a una sola cosa: llamada, registro de cara o de voz.
    ///
    /// En esos tres casos no va la barra de arriba ni las tabs. Faltaba para los dos
    /// registros y por eso la cámara salía cortada: la barra se dibujaba igual, comía
    /// altura, y el cuadrado de 148 más los textos ya llegaban justo al límite.
    private var dedicado: Bool {
        inCall || appModel.registroDeCara.activo || appModel.enrolling
    }

    private var openNotchWidth: CGFloat {
        // Durante el registro de cara el notch se hace cuadrado: lo que hay que mirar es
        // la cámara, y una cámara cuadrada dentro de una barra ancha deja dos huecos
        // negros a los costados que no aportan nada.
        if appModel.registroDeCara.activo { return 260 }
        return inCall ? 300 : openNotchSize.width
    }

    private var tabContentHeight: CGFloat {
        if appModel.registroDeCara.activo { return 248 }
        if appModel.enrolling { return 148 }
        if inCall { return 186 }
        switch coordinator.currentView {
        case .home:
            return 132
        case .utils:
            return 176
        case .shelf:
            return 186
        }
    }

    private var openSurfaceHeight: CGFloat {
        if appModel.registroDeCara.activo { return 262 }
        if appModel.enrolling { return 162 }
        if inCall { return 214 }
        switch coordinator.currentView {
        case .home:
            return 216
        case .utils:
            return 258
        case .shelf:
            return 270
        }
    }

    private var missionStateLabel: String {
        if appModel.speaking { return "Hablando" }
        if appModel.voiceProcessing { return "Transcribiendo" }
        if appModel.voiceRecording { return "Escuchando" }
        if appModel.chatBusy { return "Pensando" }
        if !appModel.voiceError.isEmpty { return "Error" }
        return "Listo"
    }

    private var currentNotchShape: NotchShape {
        NotchShape(
            topCornerRadius: vm.notchState == .open ? cornerRadiusInsets.opened.top : cornerRadiusInsets.closed.top,
            bottomCornerRadius: vm.notchState == .open ? cornerRadiusInsets.opened.bottom : cornerRadiusInsets.closed.bottom
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .top) {
                notchBackground

                if vm.notchState == .open {
                    VStack(spacing: dedicado ? 0 : 8) {
                        // Dedicado: sin barra ni tabs, todo el espacio para lo que importa.
                        if !dedicado {
                            NotchTopBar(
                                state: missionStateLabel,
                                fileCount: appModel.chatAttachments.count,
                                voiceActive: appModel.voiceRecording || appModel.voiceProcessing || appModel.speaking || appModel.sttLabActive
                            )
                        }

                        tabContent
                            .frame(
                                maxWidth: .infinity,
                                minHeight: tabContentHeight,
                                maxHeight: tabContentHeight,
                                alignment: dedicado ? .center : .top
                            )
                    }
                    .padding(.top, dedicado ? 6 : 8)
                    .padding(.horizontal, dedicado ? 12 : 16)
                    .padding(.bottom, dedicado ? 6 : 8)
                    .frame(maxWidth: .infinity, alignment: .top)
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
                } else {
                    ClosedNotchHandle(
                        state: missionStateLabel,
                        voiceActive: appModel.voiceRecording || appModel.voiceProcessing || appModel.speaking || appModel.sttLabActive,
                        cutoutWidth: vm.closedNotchSize.width,
                        inCall: showsClosedCallIndicator,
                        audioLevel: appModel.audioLevel,
                        sideWidth: Self.closedIndicatorWidth
                    )
                    .padding(.top, showsClosedCallIndicator ? 0 : 8)
                    .transition(.opacity)
                }
            }
            .frame(
                width: vm.notchState == .open ? openNotchWidth : closedSurfaceWidth,
                height: vm.notchState == .open ? openSurfaceHeight : max(vm.closedNotchSize.height, 28)
            )
            .clipShape(currentNotchShape)
            .shadow(color: .black.opacity(0.66), radius: 18, y: 10)
            .contentShape(Rectangle())
            .onHover { hovering in
                handleHover(hovering)
            }
            .animation(vm.notchState == .open ? openAnimation : closeAnimation, value: vm.notchState)
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 8)
        .frame(maxWidth: windowSize.width, maxHeight: windowSize.height, alignment: .top)
        .preferredColorScheme(.dark)
        .environmentObject(vm)
    }

    private var notchBackground: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color.black,
                    Color(red: 0.006, green: 0.006, blue: 0.007),
                    Color.black
                ],
                startPoint: .top,
                endPoint: .bottom
            )

            RadialGradient(
                colors: [
                    Color.white.opacity(0.028),
                    Color.clear
                ],
                center: .top,
                startRadius: 6,
                endRadius: 220
            )
        }
    }

    /// Con el notch cerrado y una llamada en curso lo ensanchamos a ambos lados para
    /// poder mostrar el indicador junto a la cámara. Simétrico a propósito: si creciera
    /// solo de un lado, el recorte dejaría de coincidir con la cámara física.
    private var closedSurfaceWidth: CGFloat {
        showsClosedCallIndicator
            ? vm.closedNotchSize.width + 2 * Self.closedIndicatorWidth
            : vm.closedNotchSize.width
    }

    private var showsClosedCallIndicator: Bool {
        vm.notchState == .closed && appModel.sttLabActive
    }

    private static let closedIndicatorWidth: CGFloat = 44

    @ViewBuilder
    private var tabContent: some View {
        if appModel.registroDeCara.activo {
            NotchRegistroDeCara()
        } else if appModel.enrolling {
            NotchRegistroDeVoz()
        } else if inCall {
            callPanel
        } else {
            homeContent
        }
    }

    /// Modo llamada: orbe al centro, controles abajo. Sin input.
    private var callPanel: some View {
        VStack(spacing: 14) {
            OrbPanel(size: 96, calm: true)
                .frame(width: 96, height: 96)

            HStack(spacing: 12) {
                NotchCallButton(
                    symbol: appModel.callMuted ? "mic.slash.fill" : "mic.fill",
                    tint: appModel.callMuted ? Color(red: 1, green: 0.55, blue: 0.45) : .white.opacity(0.9),
                    fill: appModel.callMuted
                        ? Color(red: 1, green: 0.4, blue: 0.3).opacity(0.18)
                        : Color.white.opacity(0.07),
                    help: appModel.callMuted ? "Reactivar micrófono" : "Silenciar micrófono"
                ) { appModel.toggleCallMute() }

                NotchCallButton(
                    symbol: "phone.down.fill",
                    tint: Color(red: 1, green: 0.45, blue: 0.42),
                    fill: Color(red: 1, green: 0.32, blue: 0.32).opacity(0.16),
                    help: "Terminar llamada"
                ) { appModel.endCall() }

                NotchCallButton(
                    symbol: "xmark",
                    tint: .white.opacity(0.66),
                    fill: Color.white.opacity(0.05),
                    help: "Cerrar el notch (la llamada sigue)"
                ) {
                    // Colapsa el notch sin cortar la conversación: el flag suelta el
                    // anclaje y `force` salta la guarda de close().
                    appModel.notchCallDismissed = true
                    vm.close(force: true)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var homeContent: some View {
        switch coordinator.currentView {
        case .home:
            HStack(alignment: .center, spacing: 14) {
                // El orbe se dibuja a 146px; antes vivía en un frame de 110 y quedaba
                // recortado por los costados. Ahora el contenedor lo contiene entero.
                OrbPanel(size: 88)
                    .frame(width: 88, height: 88)

                ChatControls(
                    prompt: $prompt,
                    droppedFiles: appModel.chatAttachments,
                    voiceRecording: appModel.voiceRecording,
                    voiceProcessing: appModel.voiceProcessing,
                    speaking: appModel.speaking,
                    callModeActive: appModel.sttLabActive,
                    callMuted: appModel.callMuted,
                    promptFocused: _promptFocused,
                    onSubmit: submitPrompt,
                    onCall: { toggleAutonomousConversation() },
                    onDropFiles: { providers in
                        attachProviders(providers)
                    }
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            }
            .frame(maxHeight: .infinity, alignment: .center)
        case .utils:
            HStack(alignment: .top, spacing: 18) {
                MusicPlayerView(albumArtNamespace: albumArtNamespace)
                    .frame(maxWidth: .infinity, alignment: .leading)

                CalendarCard()
                    .frame(width: 236)
                    .frame(minHeight: 156)
            }
        case .shelf:
            ShelfView()
                .environmentObject(vm)
                .frame(maxWidth: .infinity, minHeight: 168, alignment: .top)
        }
    }

    private func submitPrompt() {
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty || !appModel.chatAttachments.isEmpty else { return }
        appModel.chatInput = text
        prompt = ""
        Task { await appModel.sendCurrentChat() }
    }

    private func toggleVoiceDictation() {
        if appModel.voiceRecording {
            Task { await appModel.stopVoiceRecordingAndTranscribe() }
        } else {
            Task { await appModel.startVoiceRecording() }
        }
    }

    private func toggleAutonomousConversation() {
        appModel.toggleSttLab()
    }

    private func attachProviders(_ providers: [NSItemProvider]) {
        for provider in providers {
            if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
                    self.appendDroppedItem(item)
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
                    self.appendDroppedItem(item)
                }
            }
        }
    }

    private func appendDroppedItem(_ item: NSSecureCoding?) {
        let url: URL?
        if let u = item as? URL { url = u }
        else if let data = item as? Data, let raw = String(data: data, encoding: .utf8) {
            url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines))
        } else if let raw = item as? String {
            url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines))
        } else { url = nil }

        guard let url else { return }
        DispatchQueue.main.async {
            self.appModel.appendAttachment(url: url)
        }
    }

    private func handleHover(_ hovering: Bool) {
        isHovering = hovering
        hoverTask?.cancel()

        if hovering {
            vm.open()
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(90))
                promptFocused = true
            }
        } else {
            hoverTask = Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(120))
                guard !Task.isCancelled, !isHovering else { return }
                promptFocused = false
                vm.close()
            }
        }
    }
}

private struct ClosedNotchHandle: View {
    let state: String
    let voiceActive: Bool
    /// Ancho del recorte físico. Se reserva en el centro para que el indicador quede
    /// *al lado* de la cámara y no encima (donde sería invisible en una Mac con notch).
    var cutoutWidth: CGFloat = 0
    var inCall: Bool = false
    var audioLevel: Float = 0
    var sideWidth: CGFloat = 44

    var body: some View {
        if inCall {
            // Mismo patrón que InlineHUD: hueco | recorte físico | indicador.
            HStack(spacing: 0) {
                Color.clear.frame(width: sideWidth)
                Color.clear.frame(width: cutoutWidth)
                callIndicator.frame(width: sideWidth)
            }
            .padding(.vertical, 6)
        } else if voiceActive {
            // Invisible when closed — blends with hardware notch (black on black)
            // Show a subtle glow only when voice is active
            Circle()
                .fill(Color(red: 0.46, green: 0.88, blue: 1).opacity(0.72))
                .frame(width: 6, height: 6)
                .shadow(color: Color(red: 0.46, green: 0.88, blue: 1).opacity(0.9), radius: 10)
                .padding(.vertical, 8)
        } else {
            Color.clear
        }
    }

    private var callIndicator: some View {
        let level = Double(max(0, min(1, audioLevel)))
        return HStack(spacing: 5) {
            Image(systemName: "phone.fill")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(Color(red: 0.46, green: 0.88, blue: 1))

            Circle()
                .fill(Color(red: 0.46, green: 0.88, blue: 1))
                .frame(width: 5, height: 5)
                .scaleEffect(1 + 0.55 * level)
                .shadow(color: Color(red: 0.46, green: 0.88, blue: 1).opacity(0.8),
                        radius: 3 + 5 * level)
                .animation(.easeOut(duration: 0.12), value: audioLevel)
        }
    }
}

private struct NotchTopBar: View {
    let state: String
    let fileCount: Int
    let voiceActive: Bool

    var body: some View {
        HStack(spacing: 12) {
            TabSelectionView()
                .frame(maxWidth: .infinity, alignment: .leading)

            Spacer(minLength: 8)

            HStack(spacing: 6) {
                if fileCount > 0 {
                    NikiStatusPill(icon: "paperclip", label: "\(fileCount)", tint: Color.white.opacity(0.80))
                }

                NikiStatusPill(
                    icon: voiceActive ? "waveform" : "circle.hexagongrid.fill",
                    label: state,
                    tint: statusTint
                )
            }
        }
        .frame(height: 28)
    }

    private var statusTint: Color {
        if voiceActive { return Color(red: 0.46, green: 0.88, blue: 1) }
        if state == "Pensando" { return Color(red: 0.58, green: 0.77, blue: 1) }
        if state == "Error" { return Color(red: 1, green: 0.42, blue: 0.42) }
        return Color.white.opacity(0.74)
    }
}

private struct NikiStatusPill: View {
    let icon: String
    let label: String
    let tint: Color

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .bold))
            Text(label)
                .font(.system(size: 10, weight: .semibold, design: .rounded))
        }
        .foregroundStyle(tint)
        .lineLimit(1)
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(Color.white.opacity(0.055), in: Capsule())
        .overlay(Capsule().stroke(tint.opacity(0.18), lineWidth: 1))
    }
}


/// Botón circular de los controles de llamada del notch.
private struct NotchCallButton: View {
    let symbol: String
    let tint: Color
    let fill: Color
    let help: String
    let action: () -> Void

    @State private var hovered = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 36, height: 36)
                .background(
                    Circle()
                        .fill(fill)
                        .overlay(
                            Circle().strokeBorder(
                                Color.white.opacity(hovered ? 0.16 : 0.06), lineWidth: 1)
                        )
                )
                .scaleEffect(hovered ? 1.07 : 1)
        }
        .buttonStyle(.plain)
        .help(help)
        .onHover { inside in
            withAnimation(.easeOut(duration: 0.16)) { hovered = inside }
        }
    }
}

private struct OrbPanel: View {
    @EnvironmentObject private var appModel: NikiAppModel
    /// El orbe se dibuja exactamente a este tamaño. Antes estaba fijo en 146 y el
    /// contenedor lo recortaba; ahora quien lo usa manda el tamaño real.
    var size: CGFloat = 88
    /// En llamada el orbe vive en pantalla todo el rato: gira lento y respira en vez
    /// de vibrar con cada sílaba.
    var calm: Bool = false

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color.white.opacity(0.012))

            NikiThinkingOrbView(
                state: NikiThinkingOrbState.from(agentState: appModel.agentState),
                size: size,
                accentHex: appModel.orbAccentHex,
                speed: calm ? (appModel.speaking ? 0.6 : 0.46) : (appModel.speaking ? 1.2 : 1),
                liveLevel: Double(appModel.audioLevel),
                calm: calm
            )
        }
        .overlay(alignment: .bottomTrailing) { marcaDeReconocido }
        .overlay(alignment: .top) { avisoDeGesto }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Estado de Niki: \(NikiThinkingOrbState.from(agentState: appModel.agentState).label)")
    }

    /// Qué gesto entendió, un segundo y medio.
    ///
    /// Es una confirmación, no un aviso: si no apareciera, uno no sabría si el gesto se
    /// entendió o si la acción pasó por otra cosa.
    @ViewBuilder
    private var avisoDeGesto: some View {
        if let gesto = appModel.gestos.ultimo {
            HStack(spacing: 5) {
                Image(systemName: simboloDeGesto(gesto))
                    .font(.system(size: 10, weight: .bold))
                Text(gesto.descripcion)
                    .font(.system(size: 10, weight: .semibold))
            }
            .foregroundStyle(.white.opacity(0.85))
            .padding(.horizontal, 9)
            .frame(height: 22)
            .background(Capsule().fill(.white.opacity(0.14)))
            .transition(.opacity.combined(with: .scale(scale: 0.9)))
            .animation(.spring(response: 0.3, dampingFraction: 0.8), value: appModel.gestos.ultimo)
        }
    }

    private func simboloDeGesto(_ g: NikiGesto) -> String {
        switch g {
        case .palma: return "hand.raised.fill"
        case .pulgarArriba: return "hand.thumbsup.fill"
        case .pulgarAbajo: return "hand.thumbsdown.fill"
        }
    }

    /// Un punto cuando te reconoció por la cámara.
    ///
    /// Deliberadamente chico y sin texto: es una confirmación, no un aviso. Si no te
    /// reconoció —o no miró, o no hay perfil— no aparece nada; nunca dice "no sos vos",
    /// porque esto falla en abierto y no bloquea nada.
    @ViewBuilder
    private var marcaDeReconocido: some View {
        if appModel.cara.teReconocio == true {
            Image(systemName: "faceid")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(Color.green.opacity(0.75))
                .padding(5)
                .transition(.opacity)
        }
    }
}

private struct ChatControls: View {
    @Binding var prompt: String
    let droppedFiles: [NikiChatAttachment]
    let voiceRecording: Bool
    let voiceProcessing: Bool
    let speaking: Bool
    let callModeActive: Bool
    let callMuted: Bool
    @FocusState var promptFocused: Bool
    @State private var dropTargeted = false
    let onSubmit: () -> Void
    let onCall: () -> Void
    var onDropFiles: (([NSItemProvider]) -> Void)?

    var body: some View {
        // Solo lo esencial: el orbe, el campo de texto, enviar y llamar. Antes había
        // cuatro filas apiladas (barra de estado, tarjeta de conversación, composer y
        // fila de acciones) en muy poca altura y todo quedaba apretado.
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            composerRow
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        // Sin tarjeta de fondo: el campo ya tiene la suya y una segunda caja alrededor
        // solo dejaba un rectángulo vacío enorme. Al arrastrar archivos sí se marca.
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(dropTargeted ? Color.white.opacity(0.06) : Color.clear)
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .stroke(dropTargeted ? Color.white.opacity(0.24) : Color.clear, lineWidth: 1)
                )
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .onDrop(
            of: [.fileURL, .url],
            isTargeted: $dropTargeted
        ) { providers in
            onDropFiles?(providers)
            return true
        }
    }



    private var composerRow: some View {
        HStack(alignment: .center, spacing: 10) {
            HStack(alignment: .center, spacing: 10) {
                TextField("Escribe a Niki…", text: $prompt)
                    .textFieldStyle(.plain)
                    .font(.system(size: 15, weight: .medium, design: .rounded))
                    .foregroundStyle(.white)
                    .focused($promptFocused)
                    .onSubmit { onSubmit() }

                NotchSendButton(canSubmit: canSubmit, action: onSubmit)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(composerBackground)

            // Llamar / colgar, al lado del campo para que no compita por altura.
            Button(action: onCall) {
                Image(systemName: callModeActive ? "phone.down.fill" : "phone.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(callModeActive ? Color(red: 1, green: 0.45, blue: 0.42) : .white.opacity(0.9))
                    .frame(width: 40, height: 40)
                    .background(
                        Circle()
                            .fill(callModeActive
                                ? Color(red: 1, green: 0.32, blue: 0.32).opacity(0.18)
                                : Color.white.opacity(0.07))
                            .overlay(Circle().strokeBorder(Color.white.opacity(0.08), lineWidth: 1))
                    )
            }
            .buttonStyle(.plain)
            .help(callModeActive ? "Terminar llamada" : "Llamar a Niki")
        }
    }



    private var composerBackground: some View {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
            .fill(Color.white.opacity(0.045))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(Color.white.opacity(promptFocused ? 0.16 : 0.07), lineWidth: 1)
            )
    }

    private var canSubmit: Bool {
        !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !droppedFiles.isEmpty
    }








}

private struct NotchSendButton: View {
    let canSubmit: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Text("Enviar")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                Image(systemName: "arrow.up")
                    .font(.system(size: 11, weight: .bold))
            }
            .foregroundStyle(canSubmit ? Color.black.opacity(0.88) : Color.white.opacity(0.36))
            .frame(height: 34)
            .padding(.horizontal, 12)
            .background(sendBackground)
        }
        .buttonStyle(.plain)
        .disabled(!canSubmit)
        .contentShape(Rectangle())
    }

    private var sendBackground: some View {
        Capsule()
            .fill(canSubmit ? Color.white.opacity(0.92) : Color.white.opacity(0.07))
            .overlay(
                Capsule()
                    .stroke(Color.white.opacity(canSubmit ? 0.0 : 0.08), lineWidth: 1)
            )
    }
}

private struct MessageGlyph: View {
    var body: some View {
        ZStack {
            Circle()
                .fill(Color.white.opacity(0.075))
                .frame(width: 34, height: 34)

            Image(systemName: "message.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.72))
        }
    }
}

private struct NotchActionButton: View {
    let icon: String
    let label: String
    var active: Bool = false
    var quiet: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .semibold))
                if !label.isEmpty {
                    Text(label)
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                }
            }
            .foregroundStyle(active ? Color.white : Color.white.opacity(quiet ? 0.42 : 0.76))
            .padding(.horizontal, 9)
            .frame(height: 30)
            .background(
                Capsule()
                    .fill(active ? Color.white.opacity(0.16) : Color.white.opacity(quiet ? 0.035 : 0.07))
                    .overlay(
                        Capsule()
                            .stroke(Color.white.opacity(active ? 0.18 : 0.07), lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
    }
}

private struct NikiFileShareView: View {
    @EnvironmentObject private var vm: NikiNotchViewModel
    @StateObject private var quickShare = QuickShareService.shared
    @Default(.quickShareProvider) private var quickShareProvider: String
    @State private var hostView: NSView?
    @State private var interactionNonce: UUID = .init()
    @State private var isProcessing = false

    private var selectedProvider: QuickShareProvider {
        quickShare.availableProviders.first(where: { $0.id == quickShareProvider }) ??
            QuickShareProvider(id: "System Share Menu", imageData: nil, supportsRawText: true)
    }

    var body: some View {
        dropArea
            .background(NikiNSViewHost(view: $hostView))
            .onDrop(
                of: [.fileURL, .url, .utf8PlainText, .plainText, .data, .image],
                isTargeted: $vm.dropZoneTargeting
            ) { providers in
                interactionNonce = .init()
                vm.dropEvent = true
                Task { await handleDrop(providers) }
                return true
            }
            .onTapGesture {
                Task {
                    await handleClick()
                }
            }
    }

    private var dropArea: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(
                    LinearGradient(
                        colors: [Color.black.opacity(0.35), Color.black.opacity(0.20)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(
                            vm.dropZoneTargeting
                                ? Color.accentColor.opacity(0.9)
                                : Color.white.opacity(0.1),
                            style: StrokeStyle(lineWidth: 3, lineCap: .round, dash: [10])
                        )
                )
                .shadow(color: Color.black.opacity(0.6), radius: 6, x: 0, y: 2)

            VStack(spacing: 5) {
                ZStack {
                    Circle()
                        .fill(Color.white.opacity(vm.dropZoneTargeting ? 0.11 : 0.09))
                        .frame(width: 55, height: 55)

                    Image(systemName: "square.and.arrow.up")
                    Group {
                        if let imgData = selectedProvider.imageData, let nsImg = NSImage(data: imgData) {
                            Image(nsImage: nsImg)
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                        } else {
                            Image(systemName: "square.and.arrow.up")
                        }
                    }
                    .frame(width: 34, height: 34)
                    .foregroundStyle(vm.dropZoneTargeting ? Color.accentColor : Color.gray)
                    .scaleEffect(vm.dropZoneTargeting ? 1.06 : 1.0)
                    .animation(.spring(response: 0.36, dampingFraction: 0.7), value: vm.dropZoneTargeting)
                }

                Text(selectedProvider.id)
                    .font(.system(.headline, design: .rounded))
                    .foregroundColor(.white.opacity(0.8))
            }
            .padding(18)

            if isProcessing || quickShare.isPickerOpen {
                RoundedRectangle(cornerRadius: 12)
                    .fill(.black.opacity(0.3))
                    .overlay(
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            .scaleEffect(0.8)
                    )
            }
        }
        .contentShape(RoundedRectangle(cornerRadius: 12))
    }

    @MainActor
    private func handleClick() async {
        await quickShare.showFilePicker(for: selectedProvider, from: hostView)
    }

    @MainActor
    private func handleDrop(_ providers: [NSItemProvider]) async {
        isProcessing = true
        defer { isProcessing = false }
        await quickShare.shareDroppedFiles(providers, using: selectedProvider, from: hostView)
    }
}


private struct NikiNSViewHost: NSViewRepresentable {
    @Binding var view: NSView?

    func makeNSView(context: Context) -> NSView {
        let nsView = NSView(frame: .zero)
        DispatchQueue.main.async { self.view = nsView }
        return nsView
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async { self.view = nsView }
    }
}

private struct CalendarCard: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(
                    LinearGradient(
                        colors: [Color.black.opacity(0.35), Color.black.opacity(0.20)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.white.opacity(0.13), lineWidth: 1.2)
                )
                .shadow(color: Color.black.opacity(0.6), radius: 6, x: 0, y: 2)

            CalendarView()
                .padding(.top, 14)
                .padding(.trailing, 12)
                .padding(.bottom, 12)
                .padding(.leading, 22)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .scaleEffect(0.94, anchor: .topLeading)
        }
        .contentShape(
            RoundedRectangle(cornerRadius: 12)
        )
        .task {
            await CalendarManager.shared.checkCalendarAuthorization()
            await CalendarManager.shared.updateCurrentDate(Date.now)
        }
    }
}



#Preview {
    NikiNotchContentView()
        .environmentObject(NikiNotchViewModel())
        .environmentObject(NikiAppModel())
}
