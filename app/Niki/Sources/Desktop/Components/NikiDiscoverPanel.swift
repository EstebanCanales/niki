import SwiftUI

struct NikiDiscoverPanel: View {
    @EnvironmentObject private var appModel: NikiAppModel

    var body: some View {
        SidebarShell(eyebrow: "Discover", title: "Remote media tools") {
            SidebarCard {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Profile \(appModel.activeProfileID)")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)
                    Text("Capability-driven exposure for remote search and generation.")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.6))
                    if !appModel.remoteProfiles.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(appModel.remoteProfiles) { profile in
                                    Button {
                                        Task {
                                            await appModel.useRemoteProfile(profile.id)
                                        }
                                    } label: {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(profile.label)
                                                .font(.system(size: 11, weight: .semibold))
                                            Text("\(profile.sessionCount) session\(profile.sessionCount == 1 ? "" : "s")")
                                                .font(.system(size: 10, weight: .medium))
                                                .foregroundStyle(Color.white.opacity(0.58))
                                        }
                                        .foregroundStyle(.white)
                                        .padding(.horizontal, 10)
                                        .padding(.vertical, 7)
                                        .background(
                                            Capsule().fill(
                                                Color.white.opacity(appModel.activeProfileID == profile.id ? 0.18 : 0.08)
                                            )
                                        )
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    }
                }
            }

            if appModel.discoverCapabilities.isEmpty {
                SidebarCard {
                    Text("No discover/media capabilities available.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.62))
                }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(appModel.discoverCapabilities) { capability in
                            SidebarCard {
                                VStack(alignment: .leading, spacing: 10) {
                                    HStack {
                                        Text(capability.title)
                                            .font(.system(size: 14, weight: .semibold))
                                            .foregroundStyle(.white)
                                        Spacer(minLength: 12)
                                        availabilityBadge(capability.available)
                                    }

                                    if let reason = capability.reason, !reason.isEmpty {
                                        Text(reason)
                                            .font(.system(size: 12, weight: .medium))
                                            .foregroundStyle(Color.white.opacity(0.58))
                                    } else {
                                        Text("Available for this Hermes profile.")
                                            .font(.system(size: 12, weight: .medium))
                                            .foregroundStyle(Color.white.opacity(0.58))
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
        .task {
            await appModel.refreshDiscoverCapabilities()
        }
    }

    private func availabilityBadge(_ available: Bool) -> some View {
        Text(available ? "Ready" : "Unavailable")
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(available ? Color.green.opacity(0.9) : Color.white.opacity(0.7))
            .padding(.horizontal, 10)
            .frame(height: 26)
            .background(
                Capsule().fill((available ? Color.green : Color.white).opacity(0.14))
            )
    }
}
