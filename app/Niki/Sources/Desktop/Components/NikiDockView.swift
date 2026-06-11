import SwiftUI

struct NikiDockView: View {
    @EnvironmentObject private var appModel: NikiAppModel
    @Binding var selection: DockItem?
    @State private var hoveredItem: DockItem?
    @Namespace private var selectionAnimation

    private let items: [DockItem] = [.chat, .auto, .call, .settings]

    var body: some View {
        NikiGlassPanel(cornerRadius: 999, outerBorderOpacity: 0.12, blurBackground: true) {
            HStack(spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
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
                        .onHover { inside in
                            withAnimation(.easeOut(duration: 0.18)) {
                                hoveredItem = inside ? item : (hoveredItem == item ? nil : hoveredItem)
                            }
                        }

                        if shouldShowSeparator(after: item) {
                            Rectangle()
                                .fill(Color.white.opacity(0.06))
                                .frame(width: 1, height: 18)
                                .padding(.horizontal, 7)
                        }
                    }
                }
            }
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

    private func handleTap(_ item: DockItem) {
        switch item {
        case .auto:
            appModel.activateAutoMode()
            selection = appModel.activeMode == .auto ? item : nil
        case .call:
            appModel.activateCallMode()
            selection = appModel.activeMode == .call ? item : nil
        default:
            selection = selection == item ? nil : item
        }
    }

    @ViewBuilder
    private func modeBackground(for item: DockItem) -> some View {
        if item == .auto, appModel.activeMode == .auto {
            Circle()
                .fill(Color(red: 0.18, green: 0.86, blue: 0.56).opacity(0.9))
                .overlay(Circle().strokeBorder(Color.white.opacity(0.14), lineWidth: 1))
        } else if item == .call, appModel.activeMode == .call {
            Circle()
                .fill(Color(red: 0.18, green: 0.46, blue: 1).opacity(0.95))
                .overlay(Circle().strokeBorder(Color.white.opacity(0.14), lineWidth: 1))
        } else if isActive(item) {
            Circle()
                .fill(Color.white.opacity(0.08))
                .overlay(Circle().strokeBorder(Color.white.opacity(0.06), lineWidth: 1))
                .matchedGeometryEffect(id: "dock-selection", in: selectionAnimation)
        }
    }

    private func shouldShowSeparator(after item: DockItem) -> Bool {
        item == .call
    }

    private func buttonBackground(for item: DockItem) -> some View {
        let isModeButton = item == .auto || item == .call
        let modeActive = (item == .auto && appModel.activeMode == .auto) || (item == .call && appModel.activeMode == .call)
        let active = isModeButton ? false : isActive(item)
        let hovered = hoveredItem == item

        return Circle()
            .fill(backgroundColor(active: active, hovered: hovered))
            .overlay(
                Circle()
                    .strokeBorder((active || modeActive) ? Color.white.opacity(0.06) : Color.clear, lineWidth: 1)
            )
            .opacity((active || modeActive) ? 0.001 : 1)
    }

    private func backgroundColor(active: Bool, hovered: Bool) -> Color {
        if active { return Color.white.opacity(0.08) }
        if hovered { return Color.white.opacity(0.04) }
        return .clear
    }

    private func iconColor(for item: DockItem) -> Color {
        switch item {
        case .auto where appModel.activeMode == .auto:
            return .white
        case .call where appModel.activeMode == .call:
            return .white
        default:
            let active = isActive(item)
            let hovered = hoveredItem == item
            if active { return Color.white.opacity(0.9) }
            if hovered { return Color.white.opacity(0.8) }
            return Color.white.opacity(0.5)
        }
    }

    private func isActive(_ item: DockItem) -> Bool {
        return selection == item
    }
}
