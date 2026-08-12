import SwiftUI

/// Native SwiftUI interpretation of the nine semantic states from
/// thinking-orbs. The web project uses a 2D canvas; this keeps the same
/// semantic vocabulary and tuned motion while staying native to the macOS
/// shell and notch.
/// Reference: https://github.com/Jakubantalik/thinking-orbs
enum NikiThinkingOrbState: String, CaseIterable {
    case working
    case searching
    case solving
    case listening
    case connecting
    case weaving
    case composing
    case breathing
    case shaping

    var label: String {
        switch self {
        case .working: return "Trabajando"
        case .searching: return "Buscando"
        case .solving: return "Resolviendo"
        case .listening: return "Escuchando"
        case .connecting: return "Conectando"
        case .weaving: return "Integrando"
        case .composing: return "Hablando"
        case .breathing: return "En espera"
        case .shaping: return "Listo"
        }
    }

    static func from(agentState: NikiAgentVisualState) -> Self {
        switch agentState {
        case .idle: return .breathing
        case .listening: return .listening
        case .thinking: return .solving
        case .acting: return .working
        case .speaking: return .composing
        case .success: return .shaping
        case .warning: return .connecting
        case .error: return .searching
        }
    }
}

/// Reusable native renderer. `size` accepts any value so it can serve the
/// hero orb, inline message indicator, notch and voice panel.
struct NikiThinkingOrbView: View {
    let state: NikiThinkingOrbState
    let size: CGFloat
    let accentHex: String
    var speed: Double = 1
    var paused: Bool = false
    /// Nivel de audio en vivo (0...1) — micrófono del usuario o reproducción de TTS de Niki.
    /// Se suma a la energía propia del estado para que el orbe reaccione al instante a la
    /// voz real, no solo al estado discreto (escuchando/hablando/...), dando sensación de
    /// conversación en vivo en vez de una animación de "modo" estática.
    var liveLevel: Double = 0
    /// Modo sereno: el orbe gira más lento, reacciona a la voz con menos amplitud y
    /// filtra el medidor de audio con más inercia. Es el que se usa en el notch durante
    /// una llamada, donde el orbe está en pantalla minutos enteros y el nerviosismo
    /// cuadro a cuadro cansa.
    var calm: Bool = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// El medidor de audio llega a saltos (un valor por buffer). Pintarlo crudo hace
    /// que el orbe tiemble. Lo pasamos por un filtro de un polo con constantes
    /// distintas para subir y bajar: sube razonablemente rápido para que se sienta
    /// en vivo, y cae despacio para que no parpadee entre sílabas.
    private final class LiveSmoother {
        var value: Double = 0
        var last: Date?
    }
    @State private var smoother = LiveSmoother()

    /// Figura de la que venimos y cuándo empezó el cambio. Mientras la transición está
    /// viva dibujamos la mezcla de ambas, así los puntos se reacomodan en vez de saltar.
    @State private var fromState: NikiThinkingOrbState?
    @State private var transitionStart: Date?

    /// Un poco más larga que un fundido simple: el escalonado reparte las salidas de
    /// los puntos dentro de esta ventana, y se necesita aire para que la ola se lea.
    private static let transitionDuration: Double = 1.15

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { timeline in
            Canvas { context, canvasSize in
                let side = min(canvasSize.width, canvasSize.height)
                let now = timeline.date

                // Filtro del nivel de audio. `smoother` es una clase, no estado de
                // SwiftUI: mutarla acá no invalida la vista (el TimelineView ya repinta).
                let target = min(1, max(0, liveLevel))
                let dt = min(0.25, smoother.last.map { now.timeIntervalSince($0) } ?? (1.0 / 60))
                smoother.last = now
                let rising = target > smoother.value
                let tau = calm ? (rising ? 0.16 : 0.42) : (rising ? 0.05 : 0.14)
                smoother.value += (target - smoother.value) * (1 - exp(-dt / tau))
                let live = smoother.value
                // Cuánto de ese nivel llega a la geometría (vibración del anillo).
                let liveGain = calm ? 0.42 : 1.0

                func frame(for s: NikiThinkingOrbState) -> NikiOrbFrame {
                    let kind = NikiOrbConfig.kind(for: s)
                    var (opts, baseSpeed) = NikiOrbConfig.options(for: kind, size: side)
                    opts.live = live * liveGain
                    let phase = reduceMotion || paused
                        ? 0.72
                        : now.timeIntervalSinceReferenceDate
                            * max(0.1, speed) * baseSpeed * 0.1 * (1 + (calm ? 0.16 : 0.45) * live)
                    return NikiOrbBuilder.build(kind: kind, size: side, time: phase, opts: opts)
                }

                var rendered = frame(for: state)
                if !reduceMotion,
                   let from = fromState,
                   let start = transitionStart,
                   NikiOrbConfig.kind(for: from) != NikiOrbConfig.kind(for: state) {
                    let elapsed = now.timeIntervalSince(start)
                    if elapsed < Self.transitionDuration {
                        // Progreso lineal a propósito: el suavizado va por punto dentro
                        // de `blend`, junto con su retardo. Aplicarlo también acá haría
                        // el cambio pastoso.
                        let raw = max(0, min(1, elapsed / Self.transitionDuration))
                        let center = CGPoint(x: side / 2, y: side / 2)
                        rendered = NikiOrbMath.blend(frame(for: from), rendered, raw, center: center)
                    }
                }
                draw(frame: rendered, context: &context, size: canvasSize, side: side, live: live)
            }
            .accessibilityLabel(state.label)
        }
        .frame(width: size, height: size)
        .drawingGroup()
        .onChange(of: state) { old, new in
            guard NikiOrbConfig.kind(for: old) != NikiOrbConfig.kind(for: new) else {
                // Mismo dibujo con otro nombre de estado: no hay nada que transicionar.
                // Reiniciar acá era lo que hacía titilar el orbe cuando el agente pasaba
                // por varios estados que comparten figura.
                return
            }
            // Si ya había una transición a medias, no se puede simplemente decir "vengo
            // de `old`": los puntos están a mitad de camino. Antes de la mitad seguimos
            // considerando origen la figura original (volver ahí es el camino corto);
            // pasada la mitad, el origen real es la figura a la que casi habíamos
            // llegado. Sin esto el orbe pegaba un salto al encadenar cambios.
            if let start = transitionStart,
               let previousFrom = fromState,
               Date().timeIntervalSince(start) < Self.transitionDuration {
                let progress = Date().timeIntervalSince(start) / Self.transitionDuration
                fromState = progress < 0.5 ? previousFrom : old
            } else {
                fromState = old
            }
            transitionStart = Date()
        }
    }

    /// Dibuja el frame ya proyectado. Conserva la luminancia del original (el campo
    /// `white` es tinta: 0 = brillante) y la tiñe con el acento de Niki.
    private func draw(frame: NikiOrbFrame, context: inout GraphicsContext, size: CGSize, side: CGFloat, live: Double) {
        let accent = Color(hex: accentHex)
        let res = accent.resolve(in: EnvironmentValues())
        let ar = Double(res.red), ag = Double(res.green), ab = Double(res.blue)
        // El builder proyecta en un lienzo de lado `side`; centramos si el canvas no es cuadrado.
        let dx = (size.width - side) / 2
        let dy = (size.height - side) / 2

        for line in frame.lines {
            let b = 1 - min(1, max(0, line.white))
            var path = Path()
            path.move(to: CGPoint(x: line.x1 + dx, y: line.y1 + dy))
            path.addLine(to: CGPoint(x: line.x2 + dx, y: line.y2 + dy))
            context.stroke(path,
                           with: .color(Color(red: b * (0.55 + 0.45 * ar),
                                              green: b * (0.55 + 0.45 * ag),
                                              blue: b * (0.55 + 0.45 * ab)).opacity(line.a)),
                           lineWidth: line.w)
        }

        context.blendMode = .screen
        for dot in frame.dots {
            let b = 1 - min(1, max(0, dot.white))
            let cx = dot.x + dx, cy = dot.y + dy
            let color = Color(red: min(1, b * (0.55 + 0.45 * ar) + 0.12 * b * b),
                              green: min(1, b * (0.62 + 0.38 * ag) + 0.14 * b * b),
                              blue: min(1, b * (0.70 + 0.30 * ab) + 0.18 * b * b))
            // Halo suave en los puntos más brillantes — da el glow del original.
            if b > 0.62 {
                let g = dot.r * 3.0
                context.fill(Path(ellipseIn: CGRect(x: cx - g, y: cy - g, width: g * 2, height: g * 2)),
                             with: .color(color.opacity(dot.a * 0.05 * (b - 0.62) / 0.38)))
            }
            context.fill(Path(ellipseIn: CGRect(x: cx - dot.r, y: cy - dot.r,
                                                width: dot.r * 2, height: dot.r * 2)),
                         with: .color(color.opacity(dot.a)))
        }
    }

}

/// Compatibility wrapper used by the shell and existing surfaces.
struct NikiOrbView: View {
    let state: NikiAgentVisualState
    let accentHex: String
    var size: CGFloat = 840
    var liveLevel: Double = 0

    var body: some View {
        NikiThinkingOrbView(
            state: NikiThinkingOrbState.from(agentState: state),
            size: size,
            accentHex: accentHex,
            liveLevel: liveLevel
        )
    }
}
