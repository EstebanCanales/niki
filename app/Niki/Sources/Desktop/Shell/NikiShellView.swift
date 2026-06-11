import SwiftUI

struct NikiShellView: View {
    @EnvironmentObject private var appModel: NikiAppModel
    @State private var dockVisible = false

    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()

            NikiOrbView(state: appModel.agentState, accentHex: appModel.orbAccentHex)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .offset(y: -6)

            if appModel.selection != nil {
                Color.clear
                    .contentShape(Rectangle())
                    .ignoresSafeArea()
                    .onTapGesture {
                        withAnimation(.easeOut(duration: 0.18)) {
                            appModel.selection = nil
                        }
                    }
            }

            HStack(spacing: 0) {
                if let selection = appModel.selection {
                    NikiSidebarPanels(selection: selection)
                        .frame(width: NikiSidebarLayout.width)
                        .padding(.leading, NikiSidebarLayout.horizontalInset)
                        .padding(.top, NikiSidebarLayout.verticalInset)
                        .padding(.bottom, NikiSidebarLayout.verticalInset)
                        .transition(.move(edge: .leading).combined(with: .opacity))
                }

                Spacer()
            }

            VStack {
                Spacer()
                HStack {
                    Spacer()
                    NikiDockView(
                        selection: Binding(
                            get: { appModel.selection },
                            set: { appModel.selection = $0 }
                        )
                    )
                }
                .padding(.trailing, 14)
                .padding(.bottom, 10)
                .offset(x: dockVisible ? 0 : 28, y: dockVisible ? 0 : 20)
                .scaleEffect(dockVisible ? 1 : 0.94, anchor: .bottomTrailing)
                .opacity(dockVisible ? 1 : 0)
            }
        }
        .overlay(alignment: .top) {
            VStack(spacing: 4) {
                Text(appModel.runtimeModelResolved.isEmpty ? "Niki" : appModel.runtimeModelResolved)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.48))
                Text(appModel.runtimeSummary)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.72))
                    .lineLimit(2)

                NikiModeIndicator(mode: appModel.activeMode)
                    .animation(.spring(response: 0.35, dampingFraction: 0.8), value: appModel.activeMode == .none)
            }
            .padding(.top, 18)
        }
        .onAppear {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.84).delay(0.04)) {
                dockVisible = true
            }
        }
    }
}
