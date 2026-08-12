import SwiftUI

struct NikiMcpPanel: View {
    @EnvironmentObject private var appModel: NikiAppModel

    private var availability: NikiModuleAvailability {
        appModel.moduleAvailability(for: .mcp)
    }

    var body: some View {
        SidebarShell(eyebrow: "MCP", title: "Servers and tools") {
            if availability.state == .disabled {
                ContentUnavailableView("MCP setup required", systemImage: "shippingbox")
            } else if appModel.mcpServers.isEmpty {
                SidebarCard {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("No MCP servers configured.")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white)
                        Text("Add `mcp_servers` to `~/.hermes/config.yaml` to expose integrations here.")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.6))
                    }
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        if availability.state == .flagged, let reason = availability.reason, !reason.isEmpty {
                            SidebarCard {
                                Text(reason)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Color.white.opacity(0.62))
                            }
                        }
                        if !appModel.mcpActionError.isEmpty {
                            SidebarCard {
                                Text(appModel.mcpActionError)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Color.red.opacity(0.82))
                            }
                        }

                        ForEach(appModel.mcpServers) { server in
                            serverCard(server)
                        }
                    }
                    .padding(.bottom, 4)
                }
                .scrollIndicators(.never)
            }
        }
        .task {
            await appModel.refreshMcpServers()
        }
    }

    private func serverCard(_ server: NikiMcpServer) -> some View {
        SidebarCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(server.name)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                        Text(identityLine(for: server))
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.58))
                    }
                    Spacer(minLength: 12)
                    statusBadge(server.status)
                }

                HStack(spacing: 8) {
                    featurePill(server.enabled ? "Enabled" : "Disabled")
                    if server.supportsParallelToolCalls {
                        featurePill("Parallel")
                    }
                    featurePill(server.resourcesEnabled ? "Resources" : "No Resources")
                    featurePill(server.promptsEnabled ? "Prompts" : "No Prompts")
                }

                Button {
                    Task {
                        await appModel.setRuntimeMcpServer(server, enabled: !server.enabled)
                    }
                } label: {
                    Text(buttonLabel(for: server))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .frame(height: 28)
                        .background(Capsule().fill(Color.white.opacity(0.08)))
                }
                .buttonStyle(.plain)
                .disabled(appModel.mcpActionBusyID == server.id)
                .opacity(appModel.mcpActionBusyID == server.id ? 0.55 : 1)

                if server.includeCount > 0 || server.excludeCount > 0 {
                    Text("Filters · include \(server.includeCount) · exclude \(server.excludeCount)")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.42))
                }

                if let reason = server.reason, !reason.isEmpty {
                    Text(reason)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(statusColor(server.status).opacity(0.82))
                }
            }
        }
    }

    private func identityLine(for server: NikiMcpServer) -> String {
        let transport = server.transport?.uppercased() ?? "UNKNOWN"
        let auth = server.authType?.uppercased() ?? "NO AUTH"
        return "\(transport) · \(auth)"
    }

    private func featurePill(_ label: String) -> some View {
        Text(label)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Color.white.opacity(0.84))
            .padding(.horizontal, 9)
            .frame(height: 24)
            .background(Capsule().fill(Color.white.opacity(0.08)))
    }

    private func statusBadge(_ status: String) -> some View {
        Text(status.capitalized)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(statusColor(status))
            .padding(.horizontal, 10)
            .frame(height: 26)
            .background(Capsule().fill(statusColor(status).opacity(0.14)))
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "ready":
            return Color.green.opacity(0.9)
        case "disabled":
            return Color.white.opacity(0.58)
        default:
            return Color.orange.opacity(0.9)
        }
    }

    private func buttonLabel(for server: NikiMcpServer) -> String {
        if appModel.mcpActionBusyID == server.id {
            return "Updating..."
        }
        return server.enabled ? "Disable Server" : "Enable Server"
    }
}
