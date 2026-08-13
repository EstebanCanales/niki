import SwiftUI

enum NikiSidebarLayout {
    static let width: CGFloat = 600
    static let horizontalInset: CGFloat = 14
    static let verticalInset: CGFloat = 10
    static let contentPadding: CGFloat = 18
    static let cornerRadius: CGFloat = 32
    static let innerCornerRadius: CGFloat = 27
}

private let nikiGridColorPresets: [(label: String, value: String)] = [
    ("Blue", "#5ea2ff"),
    ("Ice", "#91c4ff"),
    ("Cyan", "#63d7ff"),
    ("Mint", "#67e0be"),
    ("Rose", "#f08aa8"),
    ("Gold", "#f2c56f"),
]

struct NikiSidebarPanels: View {
    let selection: DockItem

    var body: some View {
        Group {
            switch selection {
            case .chat:
                NikiChatSidebar()
            case .computer:
                NikiComputerPanel()
            case .approvals:
                NikiApprovalsPanel()
            case .sessions:
                NikiSessionsPanel()
            case .mcp:
                NikiMcpPanel()
            case .provider:
                NikiProviderPanel()
            case .diagnostics:
                NikiDiagnosticsPanel()
            case .discover:
                NikiDiscoverPanel()
            case .call:
                // El botón de voz no abre panel (controla la conversación). Fallback inocuo.
                NikiMicPanel()
            case .mic:
                NikiMicPanel()
            case .sttLab:
                NikiVoicePanel()
            case .settings:
                NikiSettingsSidebar()
            }
        }
    }
}

struct SidebarShell<Content: View>: View {
    let eyebrow: String
    let title: String
    let content: Content

    init(eyebrow: String, title: String, @ViewBuilder content: () -> Content) {
        self.eyebrow = eyebrow
        self.title = title
        self.content = content()
    }

    var body: some View {
        NikiGlassPanel(
            cornerRadius: NikiSidebarLayout.cornerRadius,
            outerBorderOpacity: 0.12,
            blurBackground: true
        ) {
            NikiInnerPanel(cornerRadius: NikiSidebarLayout.innerCornerRadius) {
                VStack(spacing: 0) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(eyebrow)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.72))
                        Text(title)
                            .font(.system(size: 28, weight: .bold))
                            .foregroundStyle(.white)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, NikiSidebarLayout.contentPadding)
                    .padding(.top, NikiSidebarLayout.contentPadding)
                    .padding(.bottom, 12)

                    Rectangle()
                        .fill(Color.white.opacity(0.08))
                        .frame(height: 1)

                    VStack(alignment: .leading, spacing: 16) {
                        content
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .padding(NikiSidebarLayout.contentPadding)
                }
            }
            .padding(3)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct SidebarCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(14)
            .background {
                NikiCardSurface {
                    Color.clear
                }
            }
    }
}

#if false
private struct NikiTasksSidebar: View {
    @EnvironmentObject private var appModel: NikiAppModel
    @State private var selectedDayKey: String = ""

    private var visibleItems: [NikiWorkItem] {
        guard !selectedDayKey.isEmpty else { return appModel.tasks }
        let filtered = appModel.tasks.filter { dayKey($0.dueAt) == selectedDayKey || $0.dueAt == nil }
        return filtered.isEmpty ? appModel.tasks : filtered
    }

    private var todayItems: [NikiWorkItem] {
        visibleItems.filter { $0.status == .open && isToday($0.dueAt) }
    }

    private var upcomingItems: [NikiWorkItem] {
        visibleItems.filter { $0.status == .open && !isToday($0.dueAt) }
    }

    private var doneItems: [NikiWorkItem] {
        visibleItems.filter { $0.status != .open }
    }

    private var calendarBuckets: [(key: String, count: Int)] {
        let grouped = Dictionary(grouping: appModel.tasks.filter { dayKey($0.dueAt) != "" }, by: { dayKey($0.dueAt) })
        return grouped.map { ($0.key, $0.value.count) }.sorted { $0.key < $1.key }
    }

    var body: some View {
        SidebarShell(eyebrow: "Tasks", title: "Work queue") {
            VStack(spacing: 14) {
                taskMetrics
                createTaskBar
                filterBar

                if !appModel.taskError.isEmpty {
                    errorBanner(appModel.taskError)
                }

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if appModel.tasksLoading {
                            loadingCard
                        }

                        if !todayItems.isEmpty {
                            taskSection("Today", items: todayItems, symbol: "sun.max")
                        }
                        if !upcomingItems.isEmpty {
                            taskSection("Upcoming", items: upcomingItems, symbol: "calendar")
                        }
                        if !doneItems.isEmpty {
                            taskSection("Done", items: doneItems, symbol: "checkmark.seal")
                        }
                        if visibleItems.isEmpty && !appModel.tasksLoading {
                            emptyTasks
                        }
                    }
                    .padding(.bottom, 4)
                }
                .scrollIndicators(.never)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .task {
            await appModel.refreshTasks()
        }
    }

    private var taskMetrics: some View {
        HStack(spacing: 10) {
            metricCard("Open", value: "\(appModel.tasks.filter { $0.status == .open }.count)", color: Color.white.opacity(0.78))
            metricCard("Today", value: "\(todayItems.count)", color: Color.orange.opacity(0.88))
            metricCard("Soon", value: "\(upcomingItems.count)", color: Color.cyan.opacity(0.84))
            metricCard("Done", value: "\(doneItems.count)", color: Color.green.opacity(0.84))
        }
    }

    private func metricCard(_ label: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(color)
            Text(label)
                .font(.system(size: 10, weight: .bold))
                .tracking(1.4)
                .foregroundStyle(Color.white.opacity(0.34))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.white.opacity(0.035))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.075), lineWidth: 1)
                )
        )
    }

    private var createTaskBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "plus")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.36))

            TextField("Create task...", text: $appModel.taskDraft)
                .textFieldStyle(.plain)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white)
                .onSubmit {
                    Task { await appModel.createTask() }
                }

            Button {
                Task { await appModel.createTask() }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color.white.opacity(0.82))
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(Color.white.opacity(0.085)))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .frame(height: 48)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Color.white.opacity(0.03))
                .overlay(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
        )
    }

    @ViewBuilder
    private var filterBar: some View {
        if !calendarBuckets.isEmpty || !appModel.tasks.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    calendarChip("All", count: appModel.tasks.count, selected: selectedDayKey.isEmpty) {
                        selectedDayKey = ""
                    }
                    ForEach(calendarBuckets, id: \.key) { bucket in
                        calendarChip(shortDate(bucket.key), count: bucket.count, selected: selectedDayKey == bucket.key) {
                            selectedDayKey = bucket.key
                        }
                    }
                }
            }
        }
    }

    private func calendarChip(_ label: String, count: Int, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text("\(label) · \(count)")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.76))
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    Capsule(style: .continuous)
                        .fill(selected ? Color.white.opacity(0.08) : Color.white.opacity(0.03))
                        .overlay(
                            Capsule(style: .continuous)
                                .stroke(Color.white.opacity(0.08), lineWidth: 1)
                        )
                )
        }
        .buttonStyle(.plain)
    }

    private func taskSection(_ title: String, items: [NikiWorkItem], symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Color.white.opacity(0.38))
                Text(title)
                    .font(.system(size: 12, weight: .bold))
                    .tracking(1.6)
                    .foregroundStyle(Color.white.opacity(0.46))
                Text("\(items.count)")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Color.white.opacity(0.30))
                Spacer()
            }

            VStack(spacing: 10) {
                ForEach(items) { item in
                    taskCard(item)
                }
            }
        }
    }

    private func taskCard(_ item: NikiWorkItem) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Button {
                    Task { await appModel.toggleTask(item) }
                } label: {
                    Image(systemName: item.status == .open ? "circle" : "checkmark.circle.fill")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(item.status == .open ? Color.white.opacity(0.34) : Color.green.opacity(0.9))
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 8) {
                    Text(item.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(item.status == .open ? Color.white.opacity(0.92) : Color.white.opacity(0.56))
                        .lineLimit(3)
                        .strikethrough(item.status != .open, color: Color.white.opacity(0.28))

                    HStack(spacing: 8) {
                        tag(item.category, symbol: "folder", color: Color.white.opacity(0.42))
                        tag(item.priority.rawValue.capitalized, symbol: "flag", color: priorityColor(item.priority))
                        if let due = formatDue(item.dueAt) {
                            tag(due, symbol: "calendar", color: Color.cyan.opacity(0.72))
                        }
                    }
                }

                Spacer(minLength: 8)

                HStack(spacing: 6) {
                    if item.proposalStatus == .proposed {
                        taskIconButton("checkmark.seal", tint: Color.green.opacity(0.82)) {
                            Task { await appModel.approveTask(item) }
                        }
                        taskIconButton("xmark", tint: Color.orange.opacity(0.82)) {
                            Task { await appModel.deleteTask(item) }
                        }
                    } else {
                        taskIconButton(item.status == .open ? "checkmark" : "arrow.uturn.backward", tint: Color.white.opacity(0.76)) {
                            Task { await appModel.toggleTask(item) }
                        }
                    }
                    taskIconButton("trash", tint: Color.red.opacity(0.72)) {
                        Task { await appModel.deleteTask(item) }
                    }
                }
            }

            if let notes = item.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !notes.isEmpty {
                Text(notes)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.45))
                    .lineLimit(2)
                    .padding(.leading, 40)
            }

            if !item.subtasks.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(item.subtasks) { subtask in
                        Button {
                            Task { await appModel.toggleSubtask(item: item, subtask: subtask) }
                        } label: {
                            HStack(spacing: 9) {
                                Image(systemName: subtask.done ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(subtask.done ? Color.green.opacity(0.78) : Color.white.opacity(0.30))
                                Text(subtask.title)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Color.white.opacity(subtask.done ? 0.42 : 0.70))
                                    .strikethrough(subtask.done, color: Color.white.opacity(0.24))
                                Spacer()
                            }
                            .padding(.leading, 40)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color.white.opacity(item.status == .open ? 0.035 : 0.022))
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(Color.white.opacity(item.proposalStatus == .proposed ? 0.16 : 0.075), lineWidth: 1)
                )
        )
    }

    private func tag(_ label: String, symbol: String, color: Color) -> some View {
        HStack(spacing: 5) {
            Image(systemName: symbol)
                .font(.system(size: 9, weight: .bold))
            Text(label)
                .font(.system(size: 10, weight: .bold))
                .lineLimit(1)
        }
        .foregroundStyle(color)
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(Capsule(style: .continuous).fill(Color.white.opacity(0.045)))
    }

    private func taskIconButton(_ symbol: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(tint)
                .frame(width: 30, height: 30)
                .background(
                    Circle()
                        .fill(Color.white.opacity(0.052))
                        .overlay(Circle().stroke(Color.white.opacity(0.065), lineWidth: 1))
                )
        }
        .buttonStyle(.plain)
    }

    private func errorBanner(_ message: String) -> some View {
        Text(message)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Color.red.opacity(0.78))
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.red.opacity(0.08))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(Color.red.opacity(0.12), lineWidth: 1)
                    )
            )
    }

    private var loadingCard: some View {
        HStack(spacing: 10) {
            ProgressView()
                .controlSize(.small)
                .tint(Color.white.opacity(0.64))
            Text("Loading tasks...")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.54))
            Spacer()
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color.white.opacity(0.03))
        )
    }

private var emptyTasks: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("No tasks yet.")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.72))
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color.white.opacity(0.03))
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(Color.white.opacity(0.075), lineWidth: 1)
                )
        )
    }

    private func priorityColor(_ priority: NikiWorkItemPriority) -> Color {
        switch priority {
        case .high:
            return Color.red.opacity(0.78)
        case .medium:
            return Color.orange.opacity(0.76)
        case .low:
            return Color.green.opacity(0.72)
        }
    }

    private func isToday(_ iso: String?) -> Bool {
        guard let iso else { return false }
        guard let date = ISO8601DateFormatter().date(from: iso) else { return false }
        return Calendar.current.isDateInToday(date)
    }

    private func dayKey(_ iso: String?) -> String {
        guard let iso, let date = ISO8601DateFormatter().date(from: iso) else { return "" }
        let components = Calendar.current.dateComponents([.year, .month, .day], from: date)
        guard let year = components.year, let month = components.month, let day = components.day else { return "" }
        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    private func formatDue(_ iso: String?) -> String? {
        guard let iso, let date = ISO8601DateFormatter().date(from: iso) else { return nil }
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    private func shortDate(_ key: String) -> String {
        key.replacingOccurrences(of: "-", with: "/")
    }
}
#endif

// MARK: - Mic Panel (selector de micrófono + control de llamada)

/// Huella de voz: que Niki responda solo a vos.
///
/// Vive junto al micrófono porque es la misma conversación — qué escucha y a quién le
/// hace caso.
struct NikiSpeakerPanel: View {
    @EnvironmentObject private var appModel: NikiAppModel

    var body: some View {
        SidebarCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Image(systemName: appModel.speakerEnrolled ? "person.crop.circle.badge.checkmark" : "person.crop.circle.dashed")
                        .font(.system(size: 14))
                        .foregroundStyle(appModel.speakerEnrolled ? Color.green.opacity(0.8) : Color.white.opacity(0.3))
                    Text(appModel.speakerEnrolled ? "Niki reconoce tu voz" : "Tu voz no está registrada")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.85))
                }

                if !appModel.speakerAvailable {
                    Text("La huella de voz no está instalada en el backend.")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.4))
                        .fixedSize(horizontal: false, vertical: true)
                } else if appModel.speakerEnrolled {
                    Text("Registrada con \(appModel.speakerSamples) tomas. Las voces que no coincidan se descartan; si no coincidiera la tuya, volvé a registrarla.")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.42))
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("Mientras no la registres, Niki le responde a cualquiera. Registrarla toma unos segundos: se graban \(appModel.enrollTotal) frases cortas.")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.42))
                        .fixedSize(horizontal: false, vertical: true)
                }

                if appModel.enrolling {
                    VStack(alignment: .leading, spacing: 6) {
                        ProgressView(value: Double(appModel.enrollProgress), total: Double(appModel.enrollTotal))
                            .tint(Color.white.opacity(0.6))
                        Text(appModel.speakerStatusText)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.6))
                    }
                } else if !appModel.speakerStatusText.isEmpty {
                    Text(appModel.speakerStatusText)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.55))
                        .fixedSize(horizontal: false, vertical: true)
                }

                if appModel.speakerAvailable {
                    Button {
                        Task { await appModel.enrollSpeaker() }
                    } label: {
                        Text(appModel.speakerEnrolled ? "Volver a registrar" : "Registrar mi voz")
                            .font(.system(size: 12, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(Color.white.opacity(0.09), in: RoundedRectangle(cornerRadius: 8))
                            .foregroundStyle(Color.white.opacity(0.85))
                    }
                    .buttonStyle(.plain)
                    .disabled(appModel.enrolling || appModel.sttLabActive)
                    if appModel.sttLabActive {
                        Text("Cortá la llamada para poder registrar la voz — el micrófono está ocupado.")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(Color.orange.opacity(0.7))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .task { await appModel.loadSpeakerStatus() }
    }
}

struct NikiMicPanel: View {
    @EnvironmentObject private var appModel: NikiAppModel

    var body: some View {
        SidebarShell(eyebrow: "Voz", title: "Micrófono") {
            VStack(alignment: .leading, spacing: 12) {
            NikiSpeakerPanel()
            SidebarCard {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Elegí qué micrófono usa Niki para escucharte.")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.white.opacity(0.5))
                        .frame(maxWidth: .infinity, alignment: .leading)

                    if !appModel.availableMicDevices.isEmpty {
                        MicPicker(
                            devices: appModel.availableMicDevices,
                            selectedID: appModel.selectedMicDeviceID
                        ) { id in
                            appModel.selectMicDevice(id)
                        }
                    } else {
                        Text("Buscando micrófonos…")
                            .font(.system(size: 12))
                            .foregroundStyle(Color.white.opacity(0.4))
                    }

                    // Nivel en vivo del micrófono mientras hay llamada (para confirmar que capta).
                    if appModel.sttLabActive {
                        HStack(spacing: 6) {
                            Text("Nivel:")
                                .font(.system(size: 10))
                                .foregroundStyle(Color.white.opacity(0.3))
                            Text(String(format: "%.1f dBFS", appModel.sttLabPeakDb))
                                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                .foregroundStyle(appModel.sttLabPeakDb > -40
                                    ? Color(red: 0.2, green: 0.9, blue: 0.5)
                                    : Color(red: 1, green: 0.5, blue: 0.2))
                        }
                        SttWaveform(level: CGFloat(appModel.audioLevel))
                            .frame(height: 28)
                    }
                }
            }
            }
        }
        .task { appModel.refreshMicDevices() }
    }
}

// MARK: - STT Lab + Call Panel

struct NikiVoicePanel: View {
    @EnvironmentObject private var appModel: NikiAppModel
    @Namespace private var scroll

    var body: some View {
        SidebarShell(eyebrow: "Voz", title: "Conversación") {

            // --- STT Lab control ---
            SidebarCard {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Conversación con Niki")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(.white)
                            Text(appModel.sttLabActive
                                ? "Hablá normal — cuando te callés, Niki responde"
                                : "Activa una conversación manos libres con Niki")
                                .font(.system(size: 11))
                                .foregroundStyle(Color.white.opacity(0.45))
                        }
                        Spacer()
                        Button { appModel.toggleSttLab() } label: {
                            HStack(spacing: 6) {
                                if appModel.sttLabActive {
                                    RecordingPulse()
                                }
                                Text(appModel.sttLabActive ? "Terminar" : "Llamar")
                                    .font(.system(size: 12, weight: .semibold))
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 14)
                            .frame(height: 32)
                            .background(
                                Capsule().fill(appModel.sttLabActive
                                    ? Color(red: 1, green: 0.3, blue: 0.3).opacity(0.8)
                                    : Color(red: 0.18, green: 0.46, blue: 1).opacity(0.75))
                            )
                        }
                        .buttonStyle(.plain)
                    }

                    // Mic picker
                    if !appModel.availableMicDevices.isEmpty {
                        MicPicker(
                            devices: appModel.availableMicDevices,
                            selectedID: appModel.selectedMicDeviceID
                        ) { id in
                            appModel.selectMicDevice(id)
                        }
                    }

                    // Voice orb + waveform — reacciona a tu voz (verde) y a la de Niki (azul)
                    if appModel.sttLabActive {
                        VoiceOrb(
                            level: CGFloat(appModel.audioLevel),
                            peakDb: appModel.sttLabPeakDb,
                            isNiki: appModel.speaking
                        )
                            .frame(maxWidth: .infinity)
                            .frame(height: 140)
                            .transition(.opacity.combined(with: .scale(scale: 0.85)))

                        SttWaveform(level: CGFloat(appModel.audioLevel))
                            .frame(height: 28)
                            .transition(.opacity)
                    }

                    // Estado diagnóstico en tiempo real
                    if !appModel.sttLabStatus.isEmpty {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(appModel.sttMicPermission == "denied"
                                    ? Color(red: 1, green: 0.3, blue: 0.3)
                                    : Color(red: 0.2, green: 0.85, blue: 0.5))
                                .frame(width: 6, height: 6)
                            Text(appModel.sttLabStatus)
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(Color.white.opacity(0.55))
                                .lineLimit(2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    if !appModel.sttLabError.isEmpty {
                        Text(appModel.sttLabError)
                            .font(.system(size: 11))
                            .foregroundStyle(Color(red: 1, green: 0.4, blue: 0.4))
                    }
                }
            }

            // --- Chunk results ---
            if !appModel.sttLabChunks.isEmpty {
                SidebarCard {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Turnos de conversación")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(Color.white.opacity(0.35))
                            Spacer()
                            Button {
                                appModel.sttLabChunks = []
                            } label: {
                                Text("Limpiar")
                                    .font(.system(size: 10))
                                    .foregroundStyle(Color.white.opacity(0.3))
                            }
                            .buttonStyle(.plain)
                        }

                        ForEach(appModel.sttLabChunks.reversed()) { chunk in
                            SttChunkRow(chunk: chunk)
                        }
                    }
                }
            } else if appModel.sttLabActive {
                SidebarCard {
                    HStack(spacing: 8) {
                        ProgressView()
                            .controlSize(.small)
                            .tint(Color.white.opacity(0.5))
                        Text("Hablá cuando quieras…")
                            .font(.system(size: 12))
                            .foregroundStyle(Color.white.opacity(0.4))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .task { appModel.refreshMicDevices() }
    }

}

private struct SttChunkRow: View {
    let chunk: NikiSttChunk

    private var isNiki: Bool { chunk.provider.lowercased() == "niki" }

    var body: some View {
        HStack {
            if isNiki { bubble; Spacer(minLength: 24) }
            else { Spacer(minLength: 24); bubble }
        }
    }

    private var bubble: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(isNiki ? "NIKI" : "TÚ")
                .font(.system(size: 8, weight: .bold))
                .tracking(1.2)
                .foregroundStyle(accent)
            Text(chunk.text)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.92))
                .fixedSize(horizontal: false, vertical: true)
            if chunk.latencyMs > 0 {
                Text("\(chunk.latencyMs)ms")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.3))
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 11)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(accent.opacity(0.14))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(accent.opacity(0.22), lineWidth: 1)
                )
        )
    }

    private var accent: Color {
        isNiki
            ? Color(red: 0.3, green: 0.6, blue: 1.0)
            : Color(red: 0.2, green: 0.85, blue: 0.5)
    }
}

private struct MicPicker: View {
    let devices: [(id: UInt32, name: String)]
    let selectedID: UInt32
    let onSelect: (UInt32) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("MICRÓFONO")
                .font(.system(size: 9, weight: .semibold))
                .tracking(1.8)
                .foregroundStyle(Color.white.opacity(0.28))

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    micChip(id: 0, name: "Sistema")
                    ForEach(devices, id: \.id) { dev in
                        micChip(id: dev.id, name: dev.name)
                    }
                }
            }
        }
    }

    private func micChip(id: UInt32, name: String) -> some View {
        let active = selectedID == id
        return Button {
            onSelect(id)
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "mic.fill")
                    .font(.system(size: 9, weight: .bold))
                Text(name)
                    .font(.system(size: 11, weight: .semibold))
                    .lineLimit(1)
            }
            .foregroundStyle(active ? .white : Color.white.opacity(0.5))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                Capsule().fill(active
                    ? Color(red: 0.18, green: 0.46, blue: 1).opacity(0.7)
                    : Color.white.opacity(0.06))
                .overlay(Capsule().stroke(Color.white.opacity(active ? 0.0 : 0.08), lineWidth: 1))
            )
        }
        .buttonStyle(.plain)
    }
}

private struct VoiceOrb: View {
    let level: CGFloat
    let peakDb: Float
    var isNiki: Bool = false

    var body: some View {
        VStack(spacing: 6) {
            NikiThinkingOrbView(
                state: isNiki ? .composing : .listening,
                size: 120,
                accentHex: isNiki ? "#70c9ff" : "#7dffb2",
                speed: 0.82 + Double(min(1, max(0, level))) * 1.35
            )

            Text(isNiki ? "NIKI · hablando" : "TÚ · \(String(format: "%.0f dBFS", peakDb))")
                .font(.system(size: 9, weight: .semibold, design: .rounded))
                .foregroundStyle(Color.white.opacity(0.42))
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(isNiki ? "Niki está hablando" : "Micrófono activo")
    }
}

private struct SttWaveform: View {
    let level: CGFloat
    private let barCount = 24

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<barCount, id: \.self) { i in
                WaveBar(index: i, level: level, total: barCount)
            }
        }
    }
}

private struct WaveBar: View {
    let index: Int
    let level: CGFloat
    let total: Int
    @State private var animOffset: CGFloat = 0

    var body: some View {
        let base = 0.15 + level * 0.85
        let position = CGFloat(index) / CGFloat(total)
        let envelope = 1.0 - abs(position - 0.5) * 1.2
        let h = max(3, base * envelope * 32 + animOffset)

        Capsule()
            .fill(
                LinearGradient(
                    colors: [Color(red: 0.18, green: 0.6, blue: 1), Color(red: 0.46, green: 0.88, blue: 1)],
                    startPoint: .bottom,
                    endPoint: .top
                )
            )
            .frame(width: 3, height: h)
            .animation(.easeOut(duration: 0.08), value: level)
            .onAppear {
                let delay = Double(index) * 0.03
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                    withAnimation(.easeInOut(duration: 0.4 + Double(index % 5) * 0.08).repeatForever(autoreverses: true)) {
                        animOffset = CGFloat.random(in: -3...3)
                    }
                }
            }
    }
}

private struct AudioLevelBar: View {
    let level: CGFloat

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.08))
                Capsule()
                    .fill(
                        LinearGradient(
                            colors: [Color(red: 0.2, green: 0.85, blue: 0.55), Color(red: 0.15, green: 0.65, blue: 1)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: max(8, geo.size.width * level))
                    .animation(.easeOut(duration: 0.08), value: level)
            }
        }
    }
}

private struct RecordingPulse: View {
    @State private var pulse = false

    var body: some View {
        Circle()
            .fill(Color(red: 1, green: 0.3, blue: 0.3))
            .frame(width: 8, height: 8)
            .opacity(pulse ? 0.2 : 1)
            .animation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true), value: pulse)
            .onAppear { pulse = true }
    }
}

private struct NikiWidgetsSidebar: View {
    var body: some View {
        SidebarShell(eyebrow: "Widgets", title: "Inactive") {
            SidebarCard {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Widgets stay off until a widget maps to real app behavior already used in Niki.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.8))
                    Text("Spotify and notch-specific surfaces are out for this phase.")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.45))
                }
            }
        }
    }
}

private struct NikiSettingsSidebar: View {
    @EnvironmentObject private var appModel: NikiAppModel
    @State private var healthStatus: String = "idle"
    @State private var healthMessage: String = ""
    @State private var modelInfo: String = ""

    var body: some View {
        SidebarShell(eyebrow: "Settings", title: "Preferences") {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    settingsSection("Profile") {
                        field("Display name", text: $appModel.displayName)
                    }

                    settingsSection("Voz") {
                        VStack(alignment: .leading, spacing: 10) {
                            toggleRow("Mostrar STT Lab", isOn: $appModel.sttLabEnabled)
                            Text("El STT Lab muestra el panel detallado de transcripción (chunks, latencias, diagnóstico). Apagado por defecto; al activarlo aparece su botón en el dock.")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.34))
                                .fixedSize(horizontal: false, vertical: true)
                            Text("La voz de Niki se genera localmente con Qwen3-TTS cuando el entorno de voz está configurado.")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.34))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    settingsSection("Atajo de teclado") {
                        VStack(alignment: .leading, spacing: 12) {
                            toggleRow("Abrir Niki con doble toque", isOn: $appModel.doubleTapToOpenEnabled)
                            if appModel.doubleTapToOpenEnabled {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text("Modificador (tocar dos veces)")
                                        .font(.system(size: 11, weight: .semibold))
                                        .tracking(1.6)
                                        .foregroundStyle(Color.white.opacity(0.36))
                                    Picker("Modificador", selection: $appModel.doubleTapModifier) {
                                        Text("Option ⌥").tag("option")
                                        Text("Command ⌘").tag("command")
                                        Text("Control ⌃").tag("control")
                                        Text("Shift ⇧").tag("shift")
                                    }
                                    .pickerStyle(.segmented)
                                    .labelsHidden()
                                }
                            }
                            Text("Tocá dos veces seguidas la tecla elegida para abrir la ventana de Niki desde cualquier app. Requiere permiso de Accesibilidad.")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.34))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    settingsSection("Niki persona") {
                        VStack(spacing: 12) {
                            field("Assistant name", text: $appModel.personaProfile.assistantName)
                            dualRow(
                                picker("Tone", selection: $appModel.personaProfile.tone),
                                picker("Brevity", selection: $appModel.personaProfile.brevity)
                            )
                            picker("Response style", selection: $appModel.personaProfile.responseStyle)
                            textArea("Operational rules", text: $appModel.personaProfile.operationalRules, height: 88)
                            textArea("Forbidden behaviors", text: $appModel.personaProfile.forbiddenBehaviors, height: 88)
                        }
                    }

                    settingsSection("Backend · HTTP") {
                        VStack(spacing: 12) {
                            field("Base URL", text: $appModel.backendBaseURL)
                            field("API Key", text: $appModel.backendAPIKey, secure: true)
                            HStack(spacing: 10) {
                                actionButton(healthStatus == "checking" ? "Checking..." : "Test connection") {
                                    Task { await checkConnection() }
                                }
                                actionButton(appModel.settingsSaved ? "Saved ✓" : "Save") {
                                    Task { await appModel.saveSettings() }
                                }
                            }
                            if healthStatus != "idle" {
                                statusLine
                            }
                        }
                    }

                    settingsSection("Niki Notch bridge") {
                        VStack(alignment: .leading, spacing: 12) {
                            HStack(spacing: 10) {
                                bridgeStatusDot
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(appModel.notchBridgeStatus.isEmpty ? "Ready to sync with NikiNotch." : appModel.notchBridgeStatus)
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(Color.white.opacity(0.76))
                                        .lineLimit(2)
                                    Text("Desktop writes backend URL, API key, and user id into the notch config.")
                                        .font(.system(size: 11, weight: .medium))
                                        .foregroundStyle(Color.white.opacity(0.34))
                                        .lineLimit(2)
                                }
                            }
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                RoundedRectangle(cornerRadius: 16, style: .continuous)
                                    .fill(Color.white.opacity(0.035))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                                            .stroke(Color.white.opacity(0.07), lineWidth: 1)
                                    )
                            )

                            infoPill("Config file", value: "~/.niki/notch-config.json")
                            dualRow(
                                infoPill("Backend", value: appModel.backendBaseURL.isEmpty ? "http://127.0.0.1:8000" : appModel.backendBaseURL),
                                infoPill("User", value: appModel.userID.isEmpty ? "user-demo" : appModel.userID)
                            )
                            toggleRow(
                                "Show / close notch",
                                isOn: Binding(
                                    get: { appModel.notchVisible },
                                    set: { appModel.setNotchVisible($0) }
                                )
                            )
                            HStack(spacing: 8) {
                                actionButton("Open Settings") {
                                    appModel.openNotchSettings()
                                }
                                actionButton("Restart Notch", secondary: true) {
                                    appModel.restartNotchApp()
                                }
                            }
                        }
                    }

                    settingsSection("Grid cells") {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Cell color")
                                .font(.system(size: 11, weight: .semibold))
                                .tracking(1.6)
                                .foregroundStyle(Color.white.opacity(0.36))
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                ForEach(nikiGridColorPresets, id: \.value) { preset in
                                    let active = appModel.orbAccentHex.lowercased() == preset.value.lowercased()
                                    Button {
                                        appModel.orbAccentHex = preset.value
                                    } label: {
                                        HStack(spacing: 8) {
                                            Circle()
                                                .fill(Color(hex: preset.value))
                                                .frame(width: 12, height: 12)
                                            Text(preset.label)
                                                .font(.system(size: 12, weight: .semibold))
                                                .foregroundStyle(Color.white.opacity(0.76))
                                            Spacer()
                                        }
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 10)
                                        .background(
                                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                                .fill(active ? Color.white.opacity(0.08) : Color.white.opacity(0.04))
                                                .overlay(
                                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                                        .stroke(Color.white.opacity(active ? 0.14 : 0.08), lineWidth: 1)
                                                )
                                        )
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }

                    settingsSection("Runtime · Hermes") {
                        VStack(spacing: 12) {
                            field("API Server URL", text: $appModel.runtimeAPIURL)
                            field("Runtime API Key", text: $appModel.runtimeAPIKey, secure: true)
                            field("Model", text: $appModel.runtimeModel)
                            field("Context override", text: $appModel.runtimeContextLengthOverride)
                            picker("Compatibility mode", selection: $appModel.runtimeCompatibilityMode)
                            toggleRow("Diagnostics mode", isOn: $appModel.runtimeDiagnosticsEnabled)
                            infoPill("Runtime source", value: "Hermes via backend")
                            infoPill("Config file", value: "~/.hermes/config.yaml")
                            infoPill("Live runtime", value: appModel.runtimeConnected ? "Connected" : "Offline")
                        }
                    }

                    if !appModel.settingsError.isEmpty {
                        Text(appModel.settingsError)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.red.opacity(0.78))
                    }

                    actionButton("Logout", secondary: true) {
                        appModel.logout()
                    }
                }
            }
        }
        .task {
            await appModel.refreshSettingsData()
        }
    }

    private var statusLine: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(healthStatus == "ready" ? "Connected" : healthMessage)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(healthStatus == "ready" ? Color.green.opacity(0.82) : Color.red.opacity(0.82))
            if !modelInfo.isEmpty {
                Text(modelInfo)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.34))
            }
        }
    }

    private var bridgeStatusDot: some View {
        Circle()
            .fill(appModel.notchBridgeStatus.lowercased().contains("failed") || appModel.notchBridgeStatus.lowercased().contains("not found") ? Color.orange.opacity(0.9) : Color.green.opacity(0.82))
            .frame(width: 9, height: 9)
            .shadow(color: Color.white.opacity(0.12), radius: 5)
    }

    private func checkConnection() async {
        healthStatus = "checking"
        healthMessage = ""
        modelInfo = ""
        do {
            let health = try await appModel.client.healthz()
            let runtime = try await appModel.client.runtimeStatus()
            healthStatus = "ready"
            healthMessage = "chat: on · runtime: \(runtime.state)"
            modelInfo = "model: \(runtime.resolvedModel.isEmpty ? (health.defaultModel ?? "n/a") : runtime.resolvedModel) · provider: Hermes"
        } catch {
            healthStatus = "down"
            healthMessage = error.localizedDescription
        }
    }

    private func settingsSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        SidebarCard {
            VStack(alignment: .leading, spacing: 14) {
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .tracking(1.8)
                    .foregroundStyle(Color.white.opacity(0.5))
                content()
            }
        }
    }

    private func field(_ title: String, text: Binding<String>, secure: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .tracking(1.6)
                .foregroundStyle(Color.white.opacity(0.36))
            Group {
                if secure {
                    SecureField("", text: text)
                } else {
                    TextField("", text: text)
                }
            }
            .textFieldStyle(.plain)
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.white.opacity(0.04))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(Color.white.opacity(0.08), lineWidth: 1)
                    )
            )
        }
    }

    private func textArea(_ title: String, text: Binding<String>, height: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .tracking(1.6)
                .foregroundStyle(Color.white.opacity(0.36))
            TextEditor(text: text)
                .scrollContentBackground(.hidden)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white)
                .frame(height: height)
                .padding(8)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color.white.opacity(0.04))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(Color.white.opacity(0.08), lineWidth: 1)
                        )
                )
        }
    }

    private func picker<T: Hashable & CaseIterable & RawRepresentable>(_ title: String, selection: Binding<T>) -> some View where T.RawValue == String {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .tracking(1.6)
                .foregroundStyle(Color.white.opacity(0.36))
            Picker(title, selection: selection) {
                ForEach(Array(T.allCases), id: \.self) { value in
                    Text(value.rawValue.replacingOccurrences(of: "_", with: " ").capitalized).tag(value)
                }
            }
            .pickerStyle(.segmented)
        }
    }

    private func toggleRow(_ title: String, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.76))
        }
        .toggleStyle(.switch)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.white.opacity(0.04))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
        )
    }

    private func infoPill(_ label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .tracking(1.6)
                .foregroundStyle(Color.white.opacity(0.36))
            Text(value)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.76))
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color.white.opacity(0.04))
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(Color.white.opacity(0.08), lineWidth: 1)
                        )
                )
        }
    }

    private func dualRow<Left: View, Right: View>(_ left: Left, _ right: Right) -> some View {
        HStack(alignment: .top, spacing: 12) {
            left
            right
        }
    }

    private func actionButton(_ title: String, secondary: Bool = false, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .buttonStyle(.plain)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Color.white.opacity(0.82))
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                Capsule(style: .continuous)
                    .fill(Color.white.opacity(secondary ? 0.05 : 0.08))
                    .overlay(
                        Capsule(style: .continuous)
                            .stroke(Color.white.opacity(0.08), lineWidth: 1)
                    )
            )
    }
}
