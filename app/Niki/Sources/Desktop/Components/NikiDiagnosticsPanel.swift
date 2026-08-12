import SwiftUI

struct NikiDiagnosticsPanel: View {
    @EnvironmentObject private var appModel: NikiAppModel

    var body: some View {
        SidebarShell(eyebrow: "Diagnostics", title: "Post-write issues") {
            if appModel.diagnostics.isEmpty {
                SidebarCard {
                    Text("No Hermes diagnostics yet.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.62))
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(appModel.diagnostics) { diagnostic in
                            SidebarCard {
                                VStack(alignment: .leading, spacing: 8) {
                                    HStack {
                                        Text(diagnostic.filePath)
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundStyle(.white)
                                        Spacer(minLength: 12)
                                        severityBadge(diagnostic.severity)
                                    }

                                    Text(diagnostic.message)
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(Color.white.opacity(0.66))

                                    Text("Run \(diagnostic.runId)")
                                        .font(.system(size: 11, weight: .medium))
                                        .foregroundStyle(Color.white.opacity(0.38))
                                }
                            }
                        }
                    }
                    .padding(.bottom, 4)
                }
                .scrollIndicators(.never)
            }
        }
    }

    private func severityBadge(_ severity: String) -> some View {
        Text(severity.capitalized)
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(severityColor(severity))
            .padding(.horizontal, 10)
            .frame(height: 26)
            .background(Capsule().fill(severityColor(severity).opacity(0.14)))
    }

    private func severityColor(_ severity: String) -> Color {
        switch severity {
        case "error":
            return Color.red.opacity(0.92)
        case "warning":
            return Color.orange.opacity(0.92)
        default:
            return Color.white.opacity(0.72)
        }
    }
}
