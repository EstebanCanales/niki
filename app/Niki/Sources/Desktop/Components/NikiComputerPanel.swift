import SwiftUI

struct NikiComputerPanel: View {
    @EnvironmentObject private var appModel: NikiAppModel

    var body: some View {
        SidebarShell(eyebrow: "Computer", title: "Desktop control") {
            SidebarCard {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 9) {
                        Circle()
                            .fill(availabilityColor)
                            .frame(width: 9, height: 9)
                            .shadow(color: availabilityColor.opacity(0.6), radius: 4)
                        Text(appModel.computerAvailability.state.rawValue.capitalized)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                        Spacer()
                        HStack(spacing: 5) {
                            Circle()
                                .fill(appModel.runtimeConnected ? Color.green.opacity(0.85) : Color.white.opacity(0.3))
                                .frame(width: 6, height: 6)
                            Text(appModel.runtimeConnected ? "Hermes" : "Offline")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(appModel.runtimeConnected ? Color.green.opacity(0.8) : Color.white.opacity(0.4))
                        }
                    }
                    if let reason = appModel.computerAvailability.reason, !reason.isEmpty {
                        Text(reason)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.58))
                    }
                    if let helper = appModel.computerPermissions?.inputHelper {
                        statusRow("Input helper", value: helper.available == true ? "Ready" : "Unavailable")
                    }
                }
            }

            SidebarCard {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Operator surface")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                    Text(appModel.computerSurfaceSummary.isEmpty ? "Adaptable controls driven by backend capabilities." : appModel.computerSurfaceSummary)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.62))
                }
            }

            if appModel.latestComputerCapture == nil {
                SidebarCard {
                    VStack(spacing: 12) {
                        Image(systemName: "macwindow.on.rectangle")
                            .font(.system(size: 28, weight: .light))
                            .foregroundStyle(Color.white.opacity(0.3))
                        Text("Sin captura de pantalla")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.7))
                        actionButton(appModel.computerViewportRefreshing ? "Capturando..." : "Capturar pantalla") {
                            await appModel.refreshComputerViewport()
                        }
                        .disabled(appModel.computerViewportRefreshing)
                        .frame(maxWidth: 200)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                }
            }

            if let image = appModel.latestComputerCapture {
                SidebarCard {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Text("Viewport")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(.white)
                            Spacer()
                            if !appModel.computerViewportUpdatedAt.isEmpty {
                                Text(appModel.computerViewportUpdatedAt)
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundStyle(Color.white.opacity(0.38))
                            }
                        }
                        Image(nsImage: image)
                            .resizable()
                            .scaledToFit()
                            .frame(maxWidth: .infinity)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                        HStack(spacing: 8) {
                            actionButton(appModel.computerViewportRefreshing ? "Refreshing..." : "Refresh View") {
                                await appModel.refreshComputerViewport()
                            }
                            .disabled(appModel.computerViewportRefreshing)
                            .opacity(appModel.computerViewportRefreshing ? 0.55 : 1)
                            Button {
                                appModel.setComputerViewportAutoRefresh(!appModel.computerViewportAutoRefreshEnabled)
                            } label: {
                                Text(appModel.computerViewportAutoRefreshEnabled ? "Stop Live" : "Start Live")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 10)
                                    .frame(height: 32)
                                    .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.08)))
                            }
                            .buttonStyle(.plain)
                        }
                        if !appModel.latestComputerCapturePath.isEmpty {
                            Text(appModel.latestComputerCapturePath)
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.42))
                                .textSelection(.enabled)
                        }
                    }
                }
            }

            if !appModel.computerActionError.isEmpty {
                SidebarCard {
                    Text(appModel.computerActionError)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.red.opacity(0.82))
                }
            }

            SidebarCard {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Quick actions")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                    if appModel.computerRecommendedActions.isEmpty {
                        Text("No safe quick actions available for the current computer capability set.")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.58))
                    } else {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(appModel.computerRecommendedActions) { action in
                                VStack(alignment: .leading, spacing: 8) {
                                    if let inputs = action.inputs, !inputs.isEmpty {
                                        VStack(alignment: .leading, spacing: 8) {
                                            ForEach(inputs) { input in
                                                VStack(alignment: .leading, spacing: 6) {
                                                    Text(input.label)
                                                        .font(.system(size: 10, weight: .semibold))
                                                        .foregroundStyle(Color.white.opacity(0.42))
                                                    TextField(
                                                        input.placeholder,
                                                        text: Binding(
                                                            get: { appModel.computerDraftValue(actionID: action.id, key: input.key) },
                                                            set: { appModel.setComputerDraftValue(actionID: action.id, key: input.key, value: $0) }
                                                        )
                                                    )
                                                    .textFieldStyle(.plain)
                                                    .font(.system(size: 12, weight: .medium))
                                                    .foregroundStyle(.white)
                                                    .padding(.horizontal, 12)
                                                    .frame(height: 34)
                                                    .background(
                                                        RoundedRectangle(cornerRadius: 10)
                                                            .fill(Color.white.opacity(0.05))
                                                    )
                                                }
                                            }
                                        }
                                    }
                                    HStack(alignment: .center, spacing: 8) {
                                        actionButton(action.title) {
                                            await appModel.runComputerOperatorAction(action)
                                        }
                                        .disabled(appModel.computerActionBusy || !appModel.canRunComputerOperatorAction(action))
                                        .opacity(appModel.computerActionBusy || !appModel.canRunComputerOperatorAction(action) ? 0.55 : 1)
                                        riskBadge(action.risk)
                                    }
                                    Text(action.subtitle)
                                        .font(.system(size: 11, weight: .medium))
                                        .foregroundStyle(Color.white.opacity(0.58))
                                    if let reason = action.reason, !reason.isEmpty {
                                        Text(reason)
                                            .font(.system(size: 11, weight: .medium))
                                            .foregroundStyle(Color.orange.opacity(0.82))
                                    }
                                }
                            }
                        }
                    }
                    if !appModel.latestComputerResult.isEmpty {
                        Text(appModel.latestComputerResult)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.58))
                            .textSelection(.enabled)
                    }
                }
            }

            SidebarCard {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Backend capabilities")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                    if appModel.computerCapabilities.isEmpty {
                        Text("No computer capabilities reported.")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.58))
                    } else {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(appModel.computerCapabilities.prefix(6)) { capability in
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text(capability.name)
                                            .font(.system(size: 12, weight: .semibold))
                                            .foregroundStyle(.white)
                                        Spacer()
                                        riskBadge(capability.risk)
                                    }
                                    Text(capability.description)
                                        .font(.system(size: 11, weight: .medium))
                                        .foregroundStyle(Color.white.opacity(0.58))
                                }
                            }
                        }
                    }
                }
            }

            SidebarCard {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Recent actions")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                    if appModel.recentComputerActions.isEmpty {
                        Text("No recent desktop actions.")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.58))
                    } else {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(appModel.recentComputerActions.prefix(5)) { action in
                                HStack {
                                    Text(action.name)
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundStyle(.white)
                                    Spacer()
                                    Text("\(action.durationMs)ms")
                                        .font(.system(size: 11, weight: .medium))
                                        .foregroundStyle(Color.white.opacity(0.4))
                                }
                            }
                        }
                    }
                }
            }
        }
        .task {
            await appModel.refreshComputerCapabilities()
            await appModel.refreshComputerRecent()
            if appModel.latestComputerCapture == nil {
                await appModel.refreshComputerViewport()
            }
            appModel.maintainComputerViewportLoop()
        }
        .onDisappear {
            appModel.stopComputerViewportLoop()
        }
    }

    private func statusRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.42))
            Spacer()
            Text(value)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.82))
        }
    }

    private func actionButton(_ title: String, perform: @escaping () async -> Void) -> some View {
        Button {
            Task { await perform() }
        } label: {
            Text(appModel.computerActionBusy ? "Running..." : title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 32)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.08)))
        }
        .buttonStyle(.plain)
    }

    private func riskBadge(_ risk: String) -> some View {
        Text(risk.capitalized)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(riskColor(risk))
            .padding(.horizontal, 8)
            .frame(height: 22)
            .background(Capsule().fill(riskColor(risk).opacity(0.14)))
    }

    private func riskColor(_ risk: String) -> Color {
        switch risk {
        case "high":
            return Color.red.opacity(0.9)
        case "medium":
            return Color.orange.opacity(0.9)
        default:
            return Color.green.opacity(0.9)
        }
    }

    private var availabilityColor: Color {
        switch appModel.computerAvailability.state.rawValue.lowercased() {
        case "ready", "beta", "flagged":
            return Color.green.opacity(0.9)
        case "disabled":
            return Color.orange.opacity(0.9)
        default:
            return Color.white.opacity(0.35)
        }
    }
}
