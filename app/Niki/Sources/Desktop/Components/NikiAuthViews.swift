import SwiftUI

struct NikiAuthRootView: View {
    @EnvironmentObject private var appModel: NikiAppModel

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            HStack(spacing: 0) {
                futureAnimationStage

                ZStack {
                    Color.black.opacity(0.96)

                    switch appModel.bootStage {
                    case .loading:
                        ProgressView()
                            .tint(.white)
                    case .setup, .login:
                        NikiLoginView()
                    case .mfa:
                        NikiMfaView()
                    case .shell:
                        EmptyView()
                    }
                }
                .frame(width: 480)
            }
        }
    }

    private var futureAnimationStage: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color.black,
                    Color.black.opacity(0.98),
                    Color(red: 0.02, green: 0.03, blue: 0.05)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            VStack(spacing: 18) {
                Spacer()

                Circle()
                    .fill(Color.white.opacity(0.03))
                    .frame(width: 110, height: 110)
                    .overlay(
                        Circle()
                            .stroke(Color.white.opacity(0.06), lineWidth: 1)
                    )

                VStack(spacing: 8) {
                    Text("Niki")
                        .font(.system(size: 42, weight: .bold))
                        .foregroundStyle(Color.white.opacity(0.92))
                    Text("Animation surface reserved")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.32))
                }

                Spacer()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct AuthShell<Content: View>: View {
    let eyebrow: String
    let title: String
    let content: Content

    init(eyebrow: String, title: String, @ViewBuilder content: () -> Content) {
        self.eyebrow = eyebrow
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            VStack(alignment: .leading, spacing: 10) {
                Text(eyebrow.uppercased())
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(2.8)
                    .foregroundStyle(Color.white.opacity(0.3))
                Text(title)
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(.white)
                Text("Native access to Hermes through Niki.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.4))
            }

            content
        }
        .frame(width: 320)
        .padding(.vertical, 48)
    }
}

private struct FieldRow: View {
    let title: String
    let placeholder: String
    @Binding var value: String
    var secure = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .tracking(2)
                .foregroundStyle(Color.white.opacity(0.28))

            Group {
                if secure {
                    SecureField(placeholder, text: $value)
                } else {
                    TextField(placeholder, text: $value)
                }
            }
            .textFieldStyle(.plain)
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 14)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color.white.opacity(0.028))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(Color.white.opacity(0.08), lineWidth: 1)
                    )
            )
        }
    }
}

private struct NikiLoginView: View {
    @EnvironmentObject private var appModel: NikiAppModel

    var body: some View {
        AuthShell(eyebrow: "Secure access", title: "Sign in") {
            VStack(alignment: .leading, spacing: 14) {
                FieldRow(title: "Email", placeholder: "operator@niki.com", value: $appModel.email)
                FieldRow(title: "Password", placeholder: "••••••••••", value: $appModel.password, secure: true)
            }

            if !appModel.authError.isEmpty {
                Text(appModel.authError)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.red.opacity(0.82))
            }

            Button {
                Task { await appModel.login() }
            } label: {
                HStack {
                    if appModel.authBusy {
                        ProgressView().tint(.white)
                    }
                    Text(appModel.authBusy ? "Signing in..." : "Enter")
                        .font(.system(size: 14, weight: .semibold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
            }
            .buttonStyle(.plain)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(Color.white.opacity(0.08))
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .stroke(Color.white.opacity(0.12), lineWidth: 1)
                    )
            )
            .disabled(appModel.authBusy)
        }
    }
}

private struct NikiMfaView: View {
    @EnvironmentObject private var appModel: NikiAppModel

    var body: some View {
        AuthShell(eyebrow: "Verification", title: "Enter MFA code") {
            FieldRow(title: "Code", placeholder: "123456", value: $appModel.mfaCode)

            if !appModel.authError.isEmpty {
                Text(appModel.authError)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.red.opacity(0.82))
            }

            Button {
                Task { await appModel.verifyMfa() }
            } label: {
                HStack {
                    if appModel.authBusy {
                        ProgressView().tint(.white)
                    }
                    Text(appModel.authBusy ? "Verifying..." : "Enter")
                        .font(.system(size: 14, weight: .semibold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
            }
            .buttonStyle(.plain)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(Color.white.opacity(0.08))
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .stroke(Color.white.opacity(0.12), lineWidth: 1)
                    )
            )
            .disabled(appModel.authBusy)
        }
    }
}
