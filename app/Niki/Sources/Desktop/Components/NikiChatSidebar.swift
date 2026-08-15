import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct NikiChatSidebar: View {
    @EnvironmentObject private var appModel: NikiAppModel
    @State private var importingFiles = false
    @State private var previewAttachment: NikiAttachmentPreviewPayload?
    private let assistantBubbleWidth: CGFloat = 386
    private let userBubbleWidth: CGFloat = 330

    var body: some View {
        // El chat se mantiene visible también durante la llamada; los controles de voz
        // (silenciar / colgar) viven en el dock, junto al resto de controles.
        chatPanel
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .fileImporter(
            isPresented: $importingFiles,
            allowedContentTypes: [.item],
            allowsMultipleSelection: true
        ) { result in
            if case let .success(urls) = result {
                for url in urls {
                    appModel.appendAttachment(url: url)
                }
            }
        }
        .sheet(item: $previewAttachment) { payload in
            NikiAttachmentPreviewSheet(payload: payload)
        }
        .onExitCommand {
            if appModel.chatBusy {
                appModel.cancelCurrentChat()
            }
        }
    }

    private var chatPanel: some View {
        NikiGlassPanel(
            cornerRadius: NikiSidebarLayout.cornerRadius,
            outerBorderOpacity: 0.12,
            blurBackground: true
        ) {
            NikiInnerPanel(cornerRadius: NikiSidebarLayout.innerCornerRadius) {
                VStack(spacing: 0) {
                    chatTitleBar

                    chatThread
                        .layoutPriority(1)

                    composer
                }
            }
            .padding(3)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Cuánto falta para que la conversación se compacte.
    ///
    /// La compactación era invisible: cuando llegaba, resumía la mitad de la charla sin
    /// que nadie se enterara, y cuando fallaba —que estuvo rota— tampoco. Es un arco que
    /// se llena; recién cuando pasa el setenta por ciento dice el número, porque hasta ahí
    /// no hay nada que hacer con el dato.
    ///
    /// Se mide contra el umbral de compactación y no contra el contexto total: a la mitad
    /// del contexto la conversación se resume, no se corta.
    @ViewBuilder
    private var indicadorDeContexto: some View {
        let ctx = appModel.contexto
        if ctx.existe, ctx.umbral != nil, ctx.fraccionHastaCompactar > 0.01 {
            let fraccion = ctx.fraccionHastaCompactar
            HStack(spacing: 6) {
                ZStack {
                    Circle()
                        .stroke(Color.white.opacity(0.12), lineWidth: 2)
                    Circle()
                        .trim(from: 0, to: fraccion)
                        .stroke(colorDeContexto(fraccion), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                }
                .frame(width: 14, height: 14)

                if fraccion > 0.7 {
                    Text("\(Int(fraccion * 100))%")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(colorDeContexto(fraccion))
                }
            }
            .help("\(ctx.tokens) de \(ctx.umbral ?? 0) tokens; al llegar, resume lo viejo y sigue")
            .frame(height: 30)
        }
    }

    private func colorDeContexto(_ fraccion: Double) -> Color {
        if fraccion > 0.9 { return Color.orange.opacity(0.9) }
        if fraccion > 0.7 { return Color.yellow.opacity(0.75) }
        return Color.white.opacity(0.4)
    }

    private var chatTitleBar: some View {
        HStack(spacing: 10) {
            Text(appModel.activeChatTitle)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.86))
                .lineLimit(1)

            Spacer()

            indicadorDeContexto

            Button {
                appModel.createChatSession()
            } label: {
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.56))
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(Color.white.opacity(0.030)))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, NikiSidebarLayout.contentPadding)
        .padding(.top, 15)
        .padding(.bottom, 8)
    }

    private var chatThread: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 10) {
                    if appModel.activeMessages.isEmpty {
                        emptyThread
                            .padding(.top, 24)
                    } else {
                        ForEach(appModel.activeMessages) { message in
                            switch message.role {
                            case .user:
                                userMessageRow(message)
                                    .id(message.id)
                            case .assistant, .system:
                                assistantMessageRow(message)
                                    .id(message.id)
                            }
                        }
                    }

                    Color.clear
                        .frame(height: 1)
                        .id("chat-bottom")
                }
                .padding(.horizontal, NikiSidebarLayout.contentPadding)
                .padding(.top, 18)
                .padding(.bottom, 14)
            }
            .scrollIndicators(.never)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .onAppear {
                scrollToBottom(proxy)
            }
            .onChange(of: appModel.activeMessages.count) { _, _ in
                scrollToBottom(proxy, animated: true)
            }
            .onChange(of: appModel.activeMessages.last?.content) { _, _ in
                scrollToBottom(proxy, animated: true)
            }
            .onChange(of: appModel.chatBusy) { _, _ in
                scrollToBottom(proxy, animated: true)
            }
        }
    }

    private var emptyThread: some View {
        NikiThinkingOrbView(state: .breathing, size: 34, accentHex: appModel.orbAccentHex, speed: 1.15)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            .padding(.top, 90)
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool = false) {
        DispatchQueue.main.async {
            if animated {
                withAnimation(.easeOut(duration: 0.18)) {
                    proxy.scrollTo("chat-bottom", anchor: .bottom)
                }
            } else {
                proxy.scrollTo("chat-bottom", anchor: .bottom)
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 10) {
            if let diagnostic = appModel.latestDiagnostic {
                diagnosticBanner(diagnostic)
            }

            if !appModel.chatAttachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(appModel.chatAttachments) { attachment in
                            attachmentCard(attachment, removable: true)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }

            HStack(spacing: 8) {
                HStack(spacing: 7) {
                    composerIconButton("paperclip") {
                        importingFiles = true
                    }

                    ZStack(alignment: .leading) {
                        NikiComposerTextView(
                            text: $appModel.chatInput,
                            isEditable: !appModel.chatBusy,
                            onSubmit: {
                                Task { await appModel.sendCurrentChat() }
                            }
                        )
                        .frame(height: 34)

                        if appModel.chatInput.isEmpty {
                            Text("Habla con Niki...")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.24))
                                .padding(.leading, 1)
                                .allowsHitTesting(false)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 34)
                }
                .padding(.leading, 9)
                .padding(.trailing, 13)
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                .background(inputSurface)

                Button {
                    Task {
                        await runPrimaryInputAction()
                    }
                } label: {
                    Image(systemName: inputActionIcon)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 48, height: 48)
                        .background(sendButtonBackground)
                }
                .buttonStyle(.plain)
                .disabled(inputActionDisabled)
                .opacity(inputActionDisabled ? 0.44 : 1)
            }

            if !appModel.chatError.isEmpty || !appModel.voiceError.isEmpty {
                Text(!appModel.chatError.isEmpty ? appModel.chatError : appModel.voiceError)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.red.opacity(0.78))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, NikiSidebarLayout.contentPadding)
        .padding(.top, 12)
        .padding(.bottom, 14)
        .background(composerBackground)
    }

    private func diagnosticBanner(_ diagnostic: NikiRuntimeDiagnostic) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: diagnostic.severity == "error" ? "xmark.octagon.fill" : "exclamationmark.triangle.fill")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(diagnostic.severity == "error" ? Color.red.opacity(0.92) : Color.orange.opacity(0.92))

            VStack(alignment: .leading, spacing: 4) {
                Text(diagnostic.message)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                Text(diagnostic.filePath)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.48))
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.white.opacity(0.04))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
        )
    }

    private func assistantMessageRow(_ message: NikiChatMessage) -> some View {
        HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: 7) {
                messageBubble(message, isUser: false)

                if shouldShowAssistantActions(for: message) {
                    assistantActions(for: message)
                }
            }
            Spacer(minLength: 44)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func userMessageRow(_ message: NikiChatMessage) -> some View {
        HStack(alignment: .top, spacing: 0) {
            Spacer(minLength: 44)

            messageBubble(message, isUser: true)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private func messageBubble(_ message: NikiChatMessage, isUser: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            NikiMessageContentView(message: message)
                .frame(maxWidth: .infinity, alignment: .leading)

            if !message.attachments.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 112), spacing: 10)], spacing: 10) {
                    ForEach(message.attachments) { attachment in
                        attachmentCard(attachment, removable: false)
                    }
                }
            }
        }
        .padding(.horizontal, isUser ? 13 : 0)
        .padding(.vertical, isUser ? 11 : 2)
        .background(
            RoundedRectangle(cornerRadius: 17, style: .continuous)
                .fill(isUser ? AnyShapeStyle(userBubbleFill) : AnyShapeStyle(Color.clear))
                .overlay(
                    RoundedRectangle(cornerRadius: 17, style: .continuous)
                        .stroke(isUser ? Color.white.opacity(0.07) : Color.clear, lineWidth: 1)
                )
        )
        .frame(maxWidth: isUser ? userBubbleWidth : assistantBubbleWidth, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var inputSurface: some View {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
            .fill(Color.white.opacity(0.030))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Color.white.opacity(0.060), lineWidth: 1)
            )
    }

    private func composerIconButton(_ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.54))
                .frame(width: 28, height: 28)
                .background(Circle().fill(Color.white.opacity(0.028)))
        }
        .buttonStyle(.plain)
    }

    private var sendButtonBackground: some View {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        Color(hex: appModel.orbAccentHex).opacity(0.92),
                        Color(red: 0.35, green: 0.78, blue: 1.0).opacity(0.82)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .shadow(color: Color(hex: appModel.orbAccentHex).opacity(0.24), radius: 12, y: 5)
    }

    private var composerBackground: some View {
        LinearGradient(
            colors: [
                Color.black.opacity(0),
                Color.black.opacity(0.18)
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private var userBubbleFill: LinearGradient {
        LinearGradient(
            colors: [
                Color(hex: appModel.orbAccentHex).opacity(0.18),
                Color.white.opacity(0.055)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    private func attachmentCard(_ attachment: NikiChatAttachment, removable: Bool) -> some View {
        ZStack(alignment: .topTrailing) {
            VStack(alignment: .leading, spacing: 10) {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.white.opacity(0.04))
                    .overlay(
                        VStack(spacing: 6) {
                            fileIcon(for: attachment)
                                .frame(width: 28, height: 28)
                            Text(formatBadge(for: attachment))
                                .font(.system(size: 10, weight: .bold))
                                .tracking(1.4)
                                .foregroundStyle(Color.white.opacity(0.45))
                        }
                    )
                    .frame(height: 74)

                VStack(alignment: .leading, spacing: 4) {
                    Text(attachment.name)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.86))
                        .lineLimit(2)
                    Text(attachment.kind.uppercased())
                        .font(.system(size: 10, weight: .bold))
                        .tracking(1.2)
                        .foregroundStyle(Color.white.opacity(0.36))
                }
            }
            .padding(12)
            .frame(width: 118, height: 132, alignment: .topLeading)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(Color.white.opacity(0.03))
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .stroke(Color.white.opacity(0.08), lineWidth: 1)
                    )
            )
            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .onTapGesture {
                previewAttachment = NikiAttachmentPreviewLoader.load(for: attachment)
            }

            if removable {
                Button {
                    appModel.removeAttachment(attachment)
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Color.white.opacity(0.72))
                        .frame(width: 22, height: 22)
                        .background(Circle().fill(Color.black.opacity(0.5)))
                }
                .buttonStyle(.plain)
                .padding(8)
            }
        }
    }

    private func symbol(for attachment: NikiChatAttachment) -> String {
        switch attachment.kind.lowercased() {
        case "png", "jpg", "jpeg", "gif", "webp", "heic", "tiff":
            return "photo"
        case "json":
            return "curlybraces"
        case "js", "ts", "tsx", "swift", "py", "rb", "go", "rs", "html", "css", "md", "txt", "yml", "yaml":
            return "doc.text"
        case "pdf":
            return "doc.richtext"
        default:
            return "doc"
        }
    }

    private func formatBadge(for attachment: NikiChatAttachment) -> String {
        let kind = attachment.kind.uppercased()
        return kind.count > 5 ? String(kind.prefix(5)) : kind
    }

    private var showSendButton: Bool {
        !appModel.chatInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !appModel.chatAttachments.isEmpty
    }

    private var inputActionIcon: String {
        if appModel.chatBusy {
            return "hourglass"
        }
        if appModel.voiceProcessing {
            return "waveform"
        }
        if appModel.voiceRecording {
            return "stop.fill"
        }
        if showSendButton {
            return "arrow.up"
        }
        return "mic.fill"
    }

    private var inputActionDisabled: Bool {
        appModel.chatBusy || appModel.voiceProcessing
    }

    private func runPrimaryInputAction() async {
        if appModel.voiceRecording {
            await appModel.stopVoiceRecordingAndTranscribe()
        } else if showSendButton {
            await appModel.sendCurrentChat()
        } else {
            await appModel.startVoiceRecording()
        }
    }

    private func shouldShowAssistantActions(for message: NikiChatMessage) -> Bool {
        message.role == .assistant && !message.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func assistantActions(for message: NikiChatMessage) -> some View {
        HStack(spacing: 6) {
            assistantActionButton("doc.on.doc", "Copiar") {
                appModel.copyMessage(message)
            }
            assistantActionButton("arrow.clockwise", "Reintentar") {
                Task { await appModel.retryAssistantMessage(message) }
            }
            // Mientras suena, el mismo botón corta la reproducción.
            assistantActionButton(
                appModel.speaking ? "stop.fill" : "speaker.wave.2",
                appModel.speaking ? "Detener" : "Voz"
            ) {
                if appModel.speaking {
                    appModel.stopSpeaking()
                } else {
                    Task { await appModel.speakMessage(message) }
                }
            }
        }
        .padding(.leading, 1)
    }

    private func assistantActionButton(_ symbol: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: symbol)
                    .font(.system(size: 10, weight: .semibold))
                Text(label)
                    .font(.system(size: 11, weight: .semibold))
            }
            .foregroundStyle(Color.white.opacity(0.48))
            .padding(.horizontal, 9)
            .frame(height: 26)
            .background(
                Capsule()
                    .fill(Color.white.opacity(0.025))
                    .overlay(Capsule().stroke(Color.white.opacity(0.055), lineWidth: 1))
            )
        }
        .buttonStyle(.plain)
    }

    private func fileIcon(for attachment: NikiChatAttachment) -> some View {
        let icon: NSImage
        if FileManager.default.fileExists(atPath: attachment.path) {
            icon = NSWorkspace.shared.icon(forFile: attachment.path)
        } else if let type = UTType(filenameExtension: attachment.kind.lowercased()) {
            icon = NSWorkspace.shared.icon(for: type)
        } else {
            icon = NSWorkspace.shared.icon(for: .data)
        }

        return Image(nsImage: icon)
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
}

private struct NikiAttachmentPreviewSheet: View {
    let payload: NikiAttachmentPreviewPayload

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch payload {
            case let .image(attachment, image):
                VStack(alignment: .leading, spacing: 16) {
                    previewHeader(attachment)
                    Image(nsImage: image)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .padding(24)
            case let .text(attachment, content):
                VStack(alignment: .leading, spacing: 16) {
                    previewHeader(attachment)
                    ScrollView {
                        Text(content)
                            .font(.system(size: 13, weight: .regular, design: .monospaced))
                            .foregroundStyle(Color.white.opacity(0.86))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(18)
                    .background(
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .fill(Color.white.opacity(0.03))
                            .overlay(
                                RoundedRectangle(cornerRadius: 22, style: .continuous)
                                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
                            )
                    )
                }
                .padding(24)
            case let .file(attachment):
                VStack(alignment: .leading, spacing: 16) {
                    previewHeader(attachment)
                    VStack(alignment: .leading, spacing: 12) {
                        previewLine("Name", attachment.name)
                        previewLine("Type", attachment.kind)
                        previewLine("Path", attachment.path)
                    }
                    .padding(18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .fill(Color.white.opacity(0.03))
                            .overlay(
                                RoundedRectangle(cornerRadius: 22, style: .continuous)
                                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
                            )
                    )
                    Spacer()
                }
                .padding(24)
            }
        }
        .frame(minWidth: 620, minHeight: 460)
    }

    private func previewHeader(_ attachment: NikiChatAttachment) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(attachment.name)
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(.white)
            Text(attachment.kind.uppercased())
                .font(.system(size: 11, weight: .bold))
                .tracking(1.6)
                .foregroundStyle(Color.white.opacity(0.36))
        }
    }

    private func previewLine(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .bold))
                .tracking(1.6)
                .foregroundStyle(Color.white.opacity(0.36))
            Text(value)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.82))
                .textSelection(.enabled)
        }
    }
}
