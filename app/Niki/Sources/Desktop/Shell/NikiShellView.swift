import SwiftUI

struct NikiShellView: View {
    @EnvironmentObject private var appModel: NikiAppModel
    @State private var dockVisible = false

    /// Cuando hay una surface activa, el chat se cierra del todo y el orbe se va
    /// a la esquina junto a los controles del dock — no se superponen.
    private var orbDocked: Bool { appModel.activeSurface != nil }

    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()

            if let surface = appModel.activeSurface {
                NikiSurfacePanel(surface: surface, onDismiss: appModel.dismissActiveSurface)
                    .padding(24)
                    .padding(.bottom, 86)
                    .transition(.opacity.combined(with: .scale(scale: 0.97)))
            } else {
                NikiOrbView(state: appModel.agentState, accentHex: appModel.orbAccentHex, size: 840)
                    .offset(y: -6)
                    .transition(.opacity.combined(with: .scale(scale: 0.9)))
            }

            if !orbDocked, appModel.selection != nil {
                Color.clear
                    .contentShape(Rectangle())
                    .ignoresSafeArea()
                    .onTapGesture {
                        withAnimation(.easeOut(duration: 0.18)) {
                            appModel.selection = nil
                        }
                    }

                HStack(spacing: 0) {
                    NikiSidebarPanels(selection: appModel.selection!)
                        .frame(width: NikiSidebarLayout.width)
                        .padding(.leading, NikiSidebarLayout.horizontalInset)
                        .padding(.top, NikiSidebarLayout.verticalInset)
                        .padding(.bottom, NikiSidebarLayout.verticalInset)
                        .transition(.move(edge: .leading).combined(with: .opacity))

                    Spacer()
                }
            }

            VStack {
                Spacer()
                HStack(spacing: 10) {
                    Spacer()
                    if orbDocked {
                        NikiOrbView(state: appModel.agentState, accentHex: appModel.orbAccentHex, size: 64)
                            .transition(.scale.combined(with: .opacity))
                    }
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
        .animation(.spring(response: 0.5, dampingFraction: 0.85), value: orbDocked)
        .overlay(alignment: .top) {
            // Solo el indicador de llamada. El nombre del modelo y el estado del runtime
            // eran información de diagnóstico, no algo que aporte al usar la app.
            NikiModeIndicator(active: appModel.sttLabActive)
                .animation(.spring(response: 0.35, dampingFraction: 0.8), value: appModel.sttLabActive)
                .padding(.top, 18)
        }
        .onAppear {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.84).delay(0.04)) {
                dockVisible = true
            }
        }
    }
}
