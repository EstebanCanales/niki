import SwiftUI

struct NikiGlassPanel<Content: View>: View {
    let cornerRadius: CGFloat
    let outerBorderOpacity: Double
    let blurBackground: Bool
    let content: Content

    init(
        cornerRadius: CGFloat = 32,
        outerBorderOpacity: Double = 0.12,
        blurBackground: Bool = false,
        @ViewBuilder content: () -> Content
    ) {
        self.cornerRadius = cornerRadius
        self.outerBorderOpacity = outerBorderOpacity
        self.blurBackground = blurBackground
        self.content = content()
    }

    var body: some View {
        content
            .background(glassBody)
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(Color.white.opacity(outerBorderOpacity), lineWidth: 1)
            )
    }

    private var glassBody: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)

        return ZStack {
            if blurBackground {
                shape
                    .fill(.ultraThinMaterial)
            }

            shape
                .fill(Color.black.opacity(blurBackground ? 0.46 : 0.65))
        }
        .shadow(color: Color.black.opacity(0.9), radius: 40, y: 20)
        .shadow(color: Color.black.opacity(0.7), radius: 15, y: 8)
    }
}

struct NikiInnerPanel<Content: View>: View {
    let cornerRadius: CGFloat
    let content: Content

    init(cornerRadius: CGFloat = 27, @ViewBuilder content: () -> Content) {
        self.cornerRadius = cornerRadius
        self.content = content()
    }

    var body: some View {
        content
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.045),
                                Color.white.opacity(0.02)
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .stroke(Color.white.opacity(0.08), lineWidth: 1)
                    )
                    .shadow(color: Color.white.opacity(0.05), radius: 0.5, y: -0.5)
            )
    }
}

struct NikiCardSurface<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.white.opacity(0.03))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(Color.white.opacity(0.08), lineWidth: 1)
                    )
            )
    }
}
