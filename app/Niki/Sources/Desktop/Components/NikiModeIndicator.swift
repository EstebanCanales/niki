import SwiftUI

struct NikiModeIndicator: View {
    let mode: NikiActiveMode

    var body: some View {
        if mode != .none {
            HStack(spacing: 6) {
                Circle()
                    .fill(mode == .auto
                        ? Color(red: 0.18, green: 0.86, blue: 0.56)
                        : Color(red: 0.18, green: 0.46, blue: 1))
                    .frame(width: 7, height: 7)
                    .shadow(color: mode == .auto ? .green.opacity(0.9) : .blue.opacity(0.9), radius: 5)

                Text(mode == .auto ? "Auto" : "Call")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.85))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(
                Capsule()
                    .fill(Color.white.opacity(0.08))
                    .overlay(Capsule().stroke(Color.white.opacity(0.12), lineWidth: 1))
            )
            .transition(.scale(scale: 0.85).combined(with: .opacity))
        }
    }
}
