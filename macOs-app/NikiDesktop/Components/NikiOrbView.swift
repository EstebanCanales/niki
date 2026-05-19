import SwiftUI

private struct SphereDot {
    let x: Double
    let y: Double
    let z: Double
    let lon: Double
    let lat: Double
    let seed: Double
    let seed2: Double
}

private struct RenderedDot {
    let x: CGFloat
    let y: CGFloat
    let z: Double
    let scale: Double
    let alpha: Double
    let size: Double
    let glow: Double
}

struct NikiOrbView: View {
    let state: NikiAgentVisualState
    let accentHex: String

    @State private var motionLevel: Double = 0
    @State private var breathingLevel: Double = 0.08

    private let dotCount = 1350
    private let camera = 860.0

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
            let loop = timeline.date.timeIntervalSinceReferenceDate / 18.5
            let t = loop * Double.pi * 2
            let palette = orbPalette

            ZStack {
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                palette.core.opacity(0.28),
                                palette.accent.opacity(0.13),
                                Color.black.opacity(0.0)
                            ],
                            center: .center,
                            startRadius: 30,
                            endRadius: 360
                        )
                    )
                    .blur(radius: 54)

                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                palette.highlight.opacity(0.26),
                                palette.core.opacity(0.08),
                                Color.black.opacity(0.0)
                            ],
                            center: .center,
                            startRadius: 8,
                            endRadius: 260
                        )
                    )
                    .blur(radius: 26)

                Canvas { context, size in
                    let side = min(size.width, size.height)
                    let radius = Double(side) * 0.275
                    let center = CGPoint(x: size.width / 2, y: size.height / 2)
                    let dots = buildDots(radius: radius)
                    let rotY = t * 0.58
                    let rotX = 0.14 * sin(t * 0.45)

                    var rendered: [RenderedDot] = []
                    rendered.reserveCapacity(dots.count)

                    for dot in dots {
                        let burst = burstFactor(for: dot, time: t)
                        let radial = 1 + burst + breathingLevel * 0.02
                        var point = rotateY(x: dot.x * radial, y: dot.y * radial, z: dot.z * radial, angle: rotY)
                        point = rotateX(x: point.x, y: point.y, z: point.z, angle: rotX)

                        let scale = camera / (camera - point.z)
                        let x = center.x + CGFloat(point.x * scale)
                        let y = center.y + CGFloat(point.y * scale)
                        let depth = (point.z + radius) / (2 * radius)
                        let baseAlpha = 0.18 + depth * 0.72
                        let baseSize = 0.8 + depth * 2.45
                        let waveA = 1 - min(1, abs(sin(2.0 * dot.lon - t + dot.seed * 0.8)) / 0.16)
                        let waveB = 1 - min(1, abs(sin(1.2 * dot.lat + 1.3 * dot.lon + t * 1.2)) / 0.22)
                        let coreGlow = pow(max(waveA, waveB), 1.15)
                        let flicker = 0.76 + 0.24 * sin(t * 1.9 + dot.seed2 * Double.pi * 2)
                        let totalGlow = coreGlow + burst * 3.6

                        rendered.append(
                            RenderedDot(
                                x: x,
                                y: y,
                                z: point.z,
                                scale: scale,
                                alpha: min(1, baseAlpha * flicker + totalGlow * 0.22),
                                size: baseSize + totalGlow * 1.85,
                                glow: totalGlow
                            )
                        )
                    }

                    rendered.sort { $0.z < $1.z }
                    context.blendMode = .screen

                    for dot in rendered {
                        let radius = CGFloat(dot.size * dot.scale)
                        if dot.glow > 0.08 {
                            context.fill(
                                Path(ellipseIn: CGRect(
                                    x: dot.x - radius * 2.4,
                                    y: dot.y - radius * 2.4,
                                    width: radius * 4.8,
                                    height: radius * 4.8
                                )),
                                with: .color(palette.highlight.opacity(0.075 * dot.glow))
                            )
                        }

                        let dotColor = Color(
                            red: min(1, palette.dotRed + 0.12 * dot.glow + 0.04 * dot.alpha),
                            green: min(1, palette.dotGreen + 0.12 * dot.alpha + 0.07 * dot.glow),
                            blue: min(1, palette.dotBlue + 0.18 * dot.glow)
                        )

                        context.fill(
                            Path(ellipseIn: CGRect(
                                x: dot.x - radius,
                                y: dot.y - radius,
                                width: radius * 2,
                                height: radius * 2
                            )),
                            with: .color(dotColor.opacity(dot.alpha))
                        )
                    }
                }
            }
            .padding(10)
        }
        .frame(width: 840, height: 840)
        .onAppear {
            motionLevel = targetMotionLevel
            breathingLevel = targetBreathingLevel
        }
        .onChange(of: state) { _, _ in
            withAnimation(.easeInOut(duration: 0.65)) {
                motionLevel = targetMotionLevel
                breathingLevel = targetBreathingLevel
            }
        }
    }

    private var orbPalette: (core: Color, highlight: Color, accent: Color, dotRed: Double, dotGreen: Double, dotBlue: Double) {
        let accent = Color(hex: accentHex)
        return (accent.opacity(0.92), Color(red: 0.55, green: 0.9, blue: 1), Color(red: 0.7, green: 0.6, blue: 1), 0.36, 0.62, 0.94)
    }

    private var targetMotionLevel: Double {
        switch state {
        case .speaking:
            return 1
        case .thinking, .acting:
            return 0.42
        case .listening:
            return 0.58
        default:
            return 0
        }
    }

    private var targetBreathingLevel: Double {
        switch state {
        case .idle, .success:
            return 0.08
        case .thinking, .acting:
            return 0.12
        case .listening:
            return 0.15
        case .speaking:
            return 0.2
        case .warning, .error:
            return 0.06
        }
    }

    private func burstFactor(for dot: SphereDot, time: Double) -> Double {
        let gate = 1 - min(1, abs(sin(time * 0.95 + dot.seed * 9.0)) / 0.14)

        switch state {
        case .speaking:
            return motionLevel * (0.008 + 0.05 * pow(gate, 1.55))
        case .thinking, .acting:
            return motionLevel * (0.004 + 0.012 * (0.5 + 0.5 * sin(time * 0.7 + dot.seed2 * 6)))
        case .listening:
            return motionLevel * (0.006 + 0.016 * max(0, sin(time * 1.3 + dot.seed * 8.0)))
        default:
            return motionLevel * 0.002 * (0.5 + 0.5 * sin(time * 0.45 + dot.seed))
        }
    }

    private func buildDots(radius: Double) -> [SphereDot] {
        (0..<dotCount).map { index in
            let u = Double(index) / Double(dotCount)
            let y = 1 - 2 * u
            let ring = sqrt(max(0, 1 - y * y))
            let theta = Double.pi * (3 - sqrt(5)) * Double(index)
            let x = cos(theta) * ring
            let z = sin(theta) * ring

            return SphereDot(
                x: x * radius,
                y: y * radius,
                z: z * radius,
                lon: atan2(z, x),
                lat: asin(y),
                seed: fract(sin(Double(index) * 91.173) * 43758.5453123),
                seed2: fract(sin(Double(index + 17) * 51.931) * 24634.63451)
            )
        }
    }

    private func rotateY(x: Double, y: Double, z: Double, angle: Double) -> (x: Double, y: Double, z: Double) {
        let c = cos(angle)
        let s = sin(angle)
        return (x * c + z * s, y, -x * s + z * c)
    }

    private func rotateX(x: Double, y: Double, z: Double, angle: Double) -> (x: Double, y: Double, z: Double) {
        let c = cos(angle)
        let s = sin(angle)
        return (x, y * c - z * s, y * s + z * c)
    }

    private func fract(_ value: Double) -> Double {
        value - floor(value)
    }
}
