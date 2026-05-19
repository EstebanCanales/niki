import SwiftUI

private enum NikiShellSection: String, CaseIterable, Identifiable {
    case home
    case chat

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .home:
            return "circle.grid.2x2.fill"
        case .chat:
            return "message.fill"
        }
    }

    var label: String {
        switch self {
        case .home:
            return "Home"
        case .chat:
            return "Chat"
        }
    }
}

private struct NikiShellMessage: Identifiable {
    let id: UUID = UUID()
    let role: String
    let text: String
    let time: String
}

private let shellMessages: [NikiShellMessage] = [
    .init(role: "Niki", text: "I can help you organize work, review context, and keep the desktop flow focused.", time: "14:36"),
    .init(role: "You", text: "Show me the new mac shell.", time: "14:37"),
    .init(role: "Niki", text: "This first pass keeps the orb, dock, and a single chat sidebar without runtime logic.", time: "14:37"),
]

struct NikiShellView: View {
    @State private var activeSection: NikiShellSection = .home
    @State private var isChatSidebarOpen = false
    @State private var chatTitle = "New chat"
    @State private var composerText = ""

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            NikiCanvasBackdrop()
                .ignoresSafeArea()

            HStack(spacing: 18) {
                shellCanvasPane

                if isChatSidebarOpen {
                    shellChatSidebar
                        .transition(.move(edge: .trailing).combined(with: .opacity))
                }
            }
            .padding(.horizontal, 22)
            .padding(.top, 22)
            .padding(.bottom, 104)

            VStack {
                Spacer()
                shellDock
            }
            .padding(.bottom, 24)
        }
        .preferredColorScheme(.dark)
        .animation(.spring(response: 0.36, dampingFraction: 0.84), value: isChatSidebarOpen)
    }

    private var shellCanvasPane: some View {
        ZStack(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: 34, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0.045),
                            Color.white.opacity(0.015)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 34, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.5), radius: 32, y: 22)

            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Niki")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .tracking(2.6)
                        .foregroundStyle(Color.white.opacity(0.5))
                    Text("macOS shell")
                        .font(.system(size: 42, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.96))
                    Text("Orb in the background, dock as navigation, and a chat sidebar as the first native surface.")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.62))
                        .frame(maxWidth: 480, alignment: .leading)
                }

                Spacer()

                HStack(alignment: .bottom, spacing: 24) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 30, style: .continuous)
                            .fill(Color.white.opacity(0.03))
                            .frame(width: 340, height: 340)
                        NikiOrbHero()
                            .frame(width: 280, height: 280)
                    }

                    VStack(alignment: .leading, spacing: 14) {
                        shellInfoCard(
                            title: "Canvas Orb",
                            body: "Ambient background identity for the native shell."
                        )
                        shellInfoCard(
                            title: "Dock",
                            body: "Compact bottom navigation with Home and Chat."
                        )
                        shellInfoCard(
                            title: "Sidebar",
                            body: "Static chat-only surface for the first native pass."
                        )
                    }
                }
            }
            .padding(30)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func shellInfoCard(title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white.opacity(0.9))
            Text(body)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white.opacity(0.55))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(width: 260, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color.white.opacity(0.035))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
        )
    }

    private var shellChatSidebar: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 14) {
                Text("Chat")
                    .font(.system(size: 12, weight: .semibold, design: .rounded))
                    .tracking(2.4)
                    .foregroundStyle(Color.white.opacity(0.5))

                TextField("New chat", text: $chatTitle)
                    .textFieldStyle(.plain)
                    .font(.system(size: 24, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.94))
            }
            .padding(.horizontal, 24)
            .padding(.top, 24)
            .padding(.bottom, 18)

            Divider().overlay(Color.white.opacity(0.08))

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(shellMessages) { message in
                        VStack(alignment: message.role == "You" ? .trailing : .leading, spacing: 6) {
                            Text(message.role)
                                .font(.system(size: 11, weight: .semibold, design: .rounded))
                                .tracking(1.6)
                                .foregroundStyle(Color.white.opacity(0.42))

                            Text(message.text)
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(.white.opacity(0.86))
                                .padding(.horizontal, 14)
                                .padding(.vertical, 12)
                                .background(
                                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                                        .fill(message.role == "You" ? Color.white.opacity(0.09) : Color.white.opacity(0.045))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                                .stroke(Color.white.opacity(0.08), lineWidth: 1)
                                        )
                                )

                            Text(message.time)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.34))
                        }
                        .frame(maxWidth: .infinity, alignment: message.role == "You" ? .trailing : .leading)
                    }
                }
                .padding(24)
            }

            Divider().overlay(Color.white.opacity(0.08))

            VStack(spacing: 12) {
                HStack(spacing: 10) {
                    shellComposerIcon("plus")

                    TextField("Talk to Niki", text: $composerText)
                        .textFieldStyle(.plain)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white.opacity(0.9))

                    shellComposerIcon("mic.fill")
                    shellComposerIcon("paperclip")
                    shellComposerIcon("sparkles")
                }
                .padding(.horizontal, 16)
                .frame(height: 52)
                .background(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(Color.white.opacity(0.04))
                        .overlay(
                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                .stroke(Color.white.opacity(0.08), lineWidth: 1)
                        )
                )
            }
            .padding(18)
        }
        .frame(width: 430)
        .background(
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .fill(Color.black.opacity(0.72))
                .overlay(
                    RoundedRectangle(cornerRadius: 30, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.6), radius: 30, y: 20)
        )
    }

    private func shellComposerIcon(_ name: String) -> some View {
        ZStack {
            Circle()
                .fill(Color.white.opacity(0.08))
                .frame(width: 30, height: 30)
            Image(systemName: name)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white.opacity(0.74))
        }
    }

    private var shellDock: some View {
        HStack(spacing: 6) {
            ForEach(NikiShellSection.allCases) { item in
                Button {
                    activeSection = item
                    if item == .chat {
                        isChatSidebarOpen = true
                    } else {
                        isChatSidebarOpen = false
                    }
                } label: {
                    ZStack {
                        Circle()
                            .fill(activeSection == item ? Color.white.opacity(0.08) : Color.clear)
                            .frame(width: 40, height: 40)
                        Image(systemName: item.icon)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(activeSection == item ? .white.opacity(0.92) : .white.opacity(0.52))
                    }
                }
                .buttonStyle(.plain)
                .help(item.label)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            ZStack(alignment: .top) {
                Capsule(style: .continuous)
                    .fill(Color.black.opacity(0.68))
                Capsule(style: .continuous)
                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
                Capsule(style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [Color.white.opacity(0.08), Color.clear],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .padding(1)
                    .mask(
                        Rectangle()
                            .frame(height: 30)
                            .offset(y: -8)
                    )
            }
        )
        .shadow(color: .black.opacity(0.55), radius: 24, y: 14)
    }
}

private struct NikiCanvasBackdrop: View {
    var body: some View {
        ZStack {
            RadialGradient(
                colors: [
                    Color(red: 0.06, green: 0.14, blue: 0.24).opacity(0.65),
                    Color.clear
                ],
                center: .topLeading,
                startRadius: 40,
                endRadius: 640
            )

            RadialGradient(
                colors: [
                    Color(red: 0.12, green: 0.22, blue: 0.38).opacity(0.42),
                    Color.clear
                ],
                center: .bottomTrailing,
                startRadius: 40,
                endRadius: 760
            )

            NikiOrbHero()
                .frame(width: 620, height: 620)
                .blur(radius: 18)
                .opacity(0.46)
                .offset(x: -220, y: -40)
        }
    }
}

private struct NikiOrbHero: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate * 0.65

            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color(red: 0.35, green: 0.62, blue: 1.0).opacity(0.34),
                                Color(red: 0.05, green: 0.09, blue: 0.16).opacity(0.0)
                            ],
                            center: .center,
                            startRadius: 6,
                            endRadius: 180
                        )
                    )
                    .blur(radius: 20)

                Canvas { context, size in
                    let center = CGPoint(x: size.width / 2, y: size.height / 2)
                    let base = min(size.width, size.height) * 0.24

                    let pointCount = 240
                    for i in 0..<pointCount {
                        let p = Double(i) / Double(pointCount)
                        let a = p * .pi * 2
                        let rose = 0.58 + 0.16 * sin(4 * a + t * 1.8) + 0.1 * cos(7 * a - t * 1.2)
                        let swirl = sin(3 * a + t * 1.35)
                        let x = center.x + CGFloat(cos(a + t * 0.42) * base * rose)
                        let y = center.y + CGFloat(sin(a * 1.18 - t * 0.37) * base * rose * 0.88 + swirl * 5.5)
                        let dotSize = 1.7 + 1.9 * max(0, sin(a * 6 - t * 2.4))
                        let rect = CGRect(x: x, y: y, width: dotSize, height: dotSize)
                        context.fill(
                            Path(ellipseIn: rect),
                            with: .color(
                                Color(red: 0.62, green: 0.82, blue: 1.0)
                                    .opacity(0.36 + 0.44 * max(0, sin(a * 5 + t * 1.8)))
                            )
                        )
                    }

                    var contour = Path()
                    let contourSteps = 180
                    for step in 0...contourSteps {
                        let p = Double(step) / Double(contourSteps)
                        let a = p * .pi * 2
                        let radius = base * (
                            0.72
                            + 0.09 * sin(5 * a + t * 1.25)
                            + 0.07 * cos(8 * a - t * 0.9)
                        )
                        let x = center.x + CGFloat(cos(a + t * 0.24) * radius)
                        let y = center.y + CGFloat(sin(a - t * 0.21) * radius * 0.9)
                        if step == 0 {
                            contour.move(to: CGPoint(x: x, y: y))
                        } else {
                            contour.addLine(to: CGPoint(x: x, y: y))
                        }
                    }
                    context.stroke(contour, with: .color(Color.white.opacity(0.14)), lineWidth: 1.05)
                }
            }
            .padding(22)
        }
    }
}

