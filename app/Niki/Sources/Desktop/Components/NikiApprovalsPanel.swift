import SwiftUI

struct NikiApprovalsPanel: View {
    @EnvironmentObject private var appModel: NikiAppModel

    var body: some View {
        SidebarShell(eyebrow: "Approvals", title: "Pending reviews") {
            if let latest = appModel.latestApprovalResolution {
                SidebarCard {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Last decision")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white)
                        Text("\(latest.decision.capitalized) on \(latest.runId)")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.62))
                        if latest.resolved > 1 {
                            Text("Resolved \(latest.resolved) pending requests in that run.")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.46))
                        }
                    }
                }
            }

            if !appModel.approvalActionError.isEmpty {
                SidebarCard {
                    Text(appModel.approvalActionError)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.red.opacity(0.82))
                }
            }

            if appModel.pendingApprovals.isEmpty {
                SidebarCard {
                    Text("No pending approvals.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.62))
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(appModel.pendingApprovals) { approval in
                            approvalCard(approval)
                        }
                    }
                    .padding(.bottom, 4)
                }
                .scrollIndicators(.never)
            }
        }
    }

    private func approvalCard(_ approval: NikiRuntimeApprovalRequest) -> some View {
        SidebarCard {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(approval.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                    Text(approval.detail)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.62))
                    Text("Run: \(approval.runId)")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.white.opacity(0.34))
                }

                HStack(spacing: 8) {
                    ForEach(approval.choices, id: \.self) { choice in
                        Button {
                            Task {
                                await appModel.respondToApproval(approval, choice: choice)
                            }
                        } label: {
                            Text(choiceLabel(choice))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 10)
                                .frame(height: 30)
                                .background(Capsule().fill(buttonColor(choice)))
                        }
                        .buttonStyle(.plain)
                        .disabled(appModel.approvalActionBusyID == approval.id)
                        .opacity(appModel.approvalActionBusyID == approval.id ? 0.55 : 1)
                    }
                }

                if approval.choices.contains("session") || approval.choices.contains("always") {
                    Button {
                        Task {
                            let scope = approval.choices.contains("session") ? "session" : "always"
                            await appModel.respondToApproval(approval, choice: scope, resolveAll: true)
                        }
                    } label: {
                        Text(appModel.approvalActionBusyID == approval.id ? "Applying..." : "Apply Scope To Remaining Requests")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 10)
                            .frame(height: 28)
                            .background(Capsule().fill(Color.white.opacity(0.08)))
                    }
                    .buttonStyle(.plain)
                    .disabled(appModel.approvalActionBusyID == approval.id)
                    .opacity(appModel.approvalActionBusyID == approval.id ? 0.55 : 1)
                }
            }
        }
    }

    private func choiceLabel(_ choice: String) -> String {
        switch choice {
        case "once":
            return "Allow Once"
        case "session":
            return "This Session"
        case "always":
            return "Always"
        case "deny":
            return "Deny"
        default:
            return choice.capitalized
        }
    }

    private func buttonColor(_ choice: String) -> Color {
        switch choice {
        case "deny":
            return Color.red.opacity(0.65)
        case "always":
            return Color.orange.opacity(0.65)
        default:
            return Color.white.opacity(0.12)
        }
    }
}
