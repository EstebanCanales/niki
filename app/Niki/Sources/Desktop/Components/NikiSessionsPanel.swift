import SwiftUI

struct NikiSessionsPanel: View {
    @EnvironmentObject private var appModel: NikiAppModel

    var body: some View {
        SidebarShell(eyebrow: "Sessions", title: "Remote sessions") {
            if appModel.remoteSessions.isEmpty {
                SidebarCard {
                    VStack(spacing: 12) {
                        Image(systemName: "rectangle.stack.badge.person.crop")
                            .font(.system(size: 30, weight: .light))
                            .foregroundStyle(Color.white.opacity(0.28))
                        Text("Sin sesiones remotas")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.72))
                        Text("Cuando Hermes tenga sesiones activas en otras plataformas, aparecerán acá para reanudar, deshacer o transferir.")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.42))
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        if !appModel.latestSessionActionSummary.isEmpty {
                            SidebarCard {
                                Text(appModel.latestSessionActionSummary)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Color.green.opacity(0.82))
                            }
                        }
                        if !appModel.sessionActionError.isEmpty {
                            SidebarCard {
                                Text(appModel.sessionActionError)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Color.red.opacity(0.82))
                            }
                        }
                        ForEach(appModel.remoteSessions) { session in
                            SidebarCard {
                                VStack(alignment: .leading, spacing: 10) {
                                    HStack(spacing: 9) {
                                        Image(systemName: platformIcon(for: session))
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundStyle(Color.white.opacity(0.7))
                                            .frame(width: 26, height: 26)
                                            .background(Circle().fill(Color.white.opacity(0.07)))
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(session.title)
                                                .font(.system(size: 14, weight: .semibold))
                                                .foregroundStyle(.white)
                                                .lineLimit(1)
                                            Text(identityLine(for: session))
                                                .font(.system(size: 11, weight: .medium))
                                                .foregroundStyle(Color.white.opacity(0.5))
                                                .lineLimit(1)
                                        }
                                        Spacer(minLength: 0)
                                        if appModel.activeProfileID == session.profileId {
                                            Circle()
                                                .fill(Color.green.opacity(0.85))
                                                .frame(width: 7, height: 7)
                                        }
                                    }
                                    HStack(spacing: 8) {
                                        if session.resumable {
                                            statusPill(session.resumePending == true ? "Pendiente" : "Reanudable",
                                                       color: session.resumePending == true ? Color.orange : Color.green)
                                        } else {
                                            statusPill("Suspendida", color: Color.white.opacity(0.5))
                                        }
                                        if session.canUndo { statusPill("Undo", color: Color(red: 0.4, green: 0.7, blue: 1)) }
                                        if session.canHandoff { statusPill("Handoff", color: Color(red: 0.7, green: 0.55, blue: 1)) }
                                    }
                                    Button {
                                        Task {
                                            await appModel.useRemoteProfile(session.profileId)
                                        }
                                    } label: {
                                        Text(appModel.activeProfileID == session.profileId ? "Profile Active" : "Use Profile")
                                            .font(.system(size: 11, weight: .semibold))
                                            .foregroundStyle(.white)
                                            .padding(.horizontal, 10)
                                            .frame(height: 28)
                                            .background(Capsule().fill(Color.white.opacity(appModel.activeProfileID == session.profileId ? 0.18 : 0.1)))
                                    }
                                    .buttonStyle(.plain)
                                    Button {
                                        Task {
                                            await appModel.requestSessionUndo(session)
                                        }
                                    } label: {
                                        Text(appModel.sessionActionBusyID == session.id ? "Undoing..." : "Undo Last Exchange")
                                            .font(.system(size: 11, weight: .semibold))
                                            .foregroundStyle(.white)
                                            .padding(.horizontal, 10)
                                            .frame(height: 28)
                                            .background(Capsule().fill(Color.white.opacity(0.08)))
                                    }
                                    .buttonStyle(.plain)
                                    .disabled(!session.canUndo || appModel.sessionActionBusyID == session.id)
                                    .opacity((!session.canUndo || appModel.sessionActionBusyID == session.id) ? 0.55 : 1)
                                    if let targets = session.handoffTargets, !targets.isEmpty {
                                        VStack(alignment: .leading, spacing: 6) {
                                            Text("Handoff targets")
                                                .font(.system(size: 11, weight: .semibold))
                                                .foregroundStyle(Color.white.opacity(0.5))
                                            HStack(spacing: 8) {
                                                ForEach(targets, id: \.self) { target in
                                                    Button {
                                                        Task {
                                                            await appModel.requestSessionHandoff(session, to: target)
                                                        }
                                                    } label: {
                                                        Text(buttonLabel(for: target, session: session))
                                                            .font(.system(size: 11, weight: .semibold))
                                                            .foregroundStyle(.white)
                                                            .padding(.horizontal, 10)
                                                            .frame(height: 28)
                                                            .background(Capsule().fill(Color.white.opacity(0.08)))
                                                    }
                                                    .buttonStyle(.plain)
                                                    .disabled(!session.canHandoff || appModel.sessionActionBusyID == session.id)
                                                    .opacity((!session.canHandoff || appModel.sessionActionBusyID == session.id) ? 0.55 : 1)
                                                }
                                            }
                                        }
                                    } else if let reason = session.canHandoffReason, !reason.isEmpty {
                                        Text(reason)
                                            .font(.system(size: 11, weight: .medium))
                                            .foregroundStyle(Color.white.opacity(0.4))
                                    }
                                    if let counts = countsLine(for: session) {
                                        Text(counts)
                                            .font(.system(size: 11, weight: .medium))
                                            .foregroundStyle(Color.white.opacity(0.42))
                                    }
                                    if let handoff = handoffLine(for: session) {
                                        Text(handoff)
                                            .font(.system(size: 11, weight: .medium))
                                            .foregroundStyle(Color.white.opacity(0.42))
                                    }
                                    if let resumeReason = session.resumeReason, session.resumePending == true, !resumeReason.isEmpty {
                                        Text(resumeReason)
                                            .font(.system(size: 11, weight: .medium))
                                            .foregroundStyle(Color.orange.opacity(0.78))
                                    }
                                    if let reason = session.canUndoReason, !session.canUndo, !reason.isEmpty {
                                        Text(reason)
                                            .font(.system(size: 11, weight: .medium))
                                            .foregroundStyle(Color.white.opacity(0.4))
                                    }
                                    if let error = session.handoffError, !error.isEmpty {
                                        Text(error)
                                            .font(.system(size: 11, weight: .medium))
                                            .foregroundStyle(Color.red.opacity(0.78))
                                    }
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

    private func statusPill(_ label: String, color: Color = Color.white.opacity(0.84)) -> some View {
        Text(label)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 9)
            .frame(height: 24)
            .background(Capsule().fill(color.opacity(0.16)))
            .overlay(Capsule().strokeBorder(color.opacity(0.22), lineWidth: 1))
    }

    private func platformIcon(for session: NikiRemoteSession) -> String {
        let p = (session.platform ?? session.source ?? "").lowercased()
        if p.contains("whats") { return "message.fill" }
        if p.contains("telegram") { return "paperplane.fill" }
        if p.contains("slack") { return "number" }
        if p.contains("discord") { return "bubble.left.and.bubble.right.fill" }
        if p.contains("web") || p.contains("browser") { return "globe" }
        if p.contains("cli") || p.contains("terminal") { return "terminal.fill" }
        return "rectangle.stack.fill"
    }

    private func identityLine(for session: NikiRemoteSession) -> String {
        let source = session.source ?? session.platform ?? "Hermes"
        let provider = session.provider ?? "provider?"
        let model = session.model ?? "model?"
        return "\(source) · profile \(session.profileId) · \(provider) · \(model)"
    }

    private func countsLine(for session: NikiRemoteSession) -> String? {
        guard session.messageCount != nil || session.apiCallCount != nil else { return nil }
        return "Messages \(session.messageCount ?? 0) · Calls \(session.apiCallCount ?? 0)"
    }

    private func handoffLine(for session: NikiRemoteSession) -> String? {
        guard let state = session.handoffState, !state.isEmpty else { return nil }
        if let platform = session.handoffPlatform, !platform.isEmpty {
            return "Handoff \(state) -> \(platform)"
        }
        return "Handoff \(state)"
    }

    private func buttonLabel(for platform: String, session: NikiRemoteSession) -> String {
        if appModel.sessionActionBusyID == session.id {
            return "Requesting..."
        }
        return "Send to \(platform.capitalized)"
    }
}
