import CoreGraphics
import Foundation

/// Motor de geometría de los "thinking orbs", portado de la implementación de
/// referencia (https://orbs.jakubantalik.com — bundle `ThinkingOrb`).
///
/// La idea central, que la versión anterior de Niki no tenía: cada estado no es el
/// mismo orbe con otra velocidad, sino una **geometría distinta**. Un globo de
/// latitudes escaneado, órbitas con partículas, una onda que respira, una malla de
/// nodos conectados, trenzas, cintas… Eso es lo que hace que cada estado se lea
/// distinto de un vistazo.
///
/// Mapeo estado → geometría (tabla `wp` del original):
///   working→orbits, searching→globe, solving→rubik, listening→wave,
///   connecting→web, weaving→braid, composing→ribbon, breathing→ring, shaping→morph
enum NikiOrbGeometryKind: String {
    case orbits, globe, rubik, wave, web, braid, ribbon, ring, morph
}

struct NikiOrbDot {
    var x: CGFloat
    var y: CGFloat
    var z: Double
    var r: CGFloat
    /// "Tinta": 0 = máximo brillo, 1 = oscuro. Igual que el original, la luminancia
    /// se deriva de aquí (en tema oscuro el brillo es 1 - white).
    var white: Double
    var a: Double
}

struct NikiOrbLine {
    var x1: CGFloat
    var y1: CGFloat
    var x2: CGFloat
    var y2: CGFloat
    var white: Double
    var a: Double
    var w: CGFloat
}

struct NikiOrbFrame {
    var dots: [NikiOrbDot] = []
    var lines: [NikiOrbLine] = []
}

// MARK: - Helpers compartidos (Bt, Wu, Vt, Qd, ze, ql, Jl, pc del original)

enum NikiOrbMath {
    /// `Bt` — proyección: rota yaw/pitch y proyecta a pantalla. Devuelve (x, y, z).
    static func projector(yaw: Double, pitch: Double, cx: CGFloat, cy: CGFloat, scale: Double)
        -> (Double, Double, Double) -> (CGFloat, CGFloat, Double) {
        let sp = sin(pitch), cp = cos(pitch)
        let sy = sin(yaw), cy2 = cos(yaw)
        return { x, y, z in
            let px = x * cy2 + z * sy
            let pz = -x * sy + z * cy2
            let gy = y * cp - pz * sp
            let wz = y * sp + pz * cp
            return (cx + CGFloat(px * scale), cy - CGFloat(gy * scale), wz)
        }
    }

    /// `Wu` — punto i de N sobre una esfera de Fibonacci.
    static func fibonacci(_ i: Int, _ n: Int) -> (Double, Double, Double) {
        let ga = Double.pi * (3 - sqrt(5.0))
        let y = 1 - 2 * (Double(i) + 0.5) / Double(n)
        let r = sqrt(max(0, 1 - y * y))
        let t = Double(i) * ga
        return (r * cos(t), y, r * sin(t))
    }

    /// `Vt` — escala del radio del punto según el tamaño del orbe.
    static func sizeScale(_ size: CGFloat, _ pow_: Double) -> Double {
        pow(Double(size) / 300.0, pow_)
    }

    /// `Qd` — distancia angular con signo.
    static func angDist(_ a: Double, _ b: Double) -> Double {
        atan2(sin(a - b), cos(a - b))
    }

    /// `ze` — hash determinista 2D.
    static func hash(_ x: Double, _ y: Double) -> Double {
        let v = sin(x * 12.9898 + y * 78.233) * 43758.5453
        return v - floor(v)
    }

    /// `ql` — value noise 2D con suavizado smoothstep.
    static func noise(_ x: Double, _ y: Double) -> Double {
        let xi = floor(x), yi = floor(y)
        var fx = x - xi, fy = y - yi
        fx = fx * fx * (3 - 2 * fx)
        fy = fy * fy * (3 - 2 * fy)
        let a = hash(xi, yi), b = hash(xi + 1, yi)
        let c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1)
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
    }

    static func fract(_ v: Double) -> Double { v - floor(v) }
    static func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }

    /// `Ct` — descarta lo invisible, aplica radio mínimo y ordena por profundidad.
    static func finalize(_ dots: [NikiOrbDot], _ lines: [NikiOrbLine], rMin: Double) -> NikiOrbFrame {
        var kept = dots.filter { $0.a >= 0.02 }
        for i in kept.indices { kept[i].r = max(CGFloat(rMin), kept[i].r) }
        kept.sort { $0.z < $1.z }
        return NikiOrbFrame(dots: kept, lines: lines.filter { $0.a >= 0.02 })
    }

    /// Interpola dos figuras para que los puntos **viajen** de una a otra en vez de
    /// cambiar de golpe.
    ///
    /// El emparejamiento es la parte que hace que se vea bien: si uniéramos punto i con
    /// punto i tal cual, el movimiento sería un revoltijo, porque cada geometría genera
    /// sus puntos en un orden distinto. Ordenamos ambos conjuntos por ángulo alrededor
    /// del centro (y remuestreamos al mismo total), así cada punto viaja hacia un destino
    /// que le queda cerca y el conjunto se reacomoda como un remolino coherente.
    static func blend(_ a: NikiOrbFrame, _ b: NikiOrbFrame, _ t: Double, center: CGPoint) -> NikiOrbFrame {
        if a.dots.isEmpty { return b }
        if b.dots.isEmpty { return a }
        let k = max(0, min(1, t))

        func angleOrder(_ dots: [NikiOrbDot]) -> [Int] {
            dots.indices.sorted {
                atan2(Double(dots[$0].y - center.y), Double(dots[$0].x - center.x))
                    < atan2(Double(dots[$1].y - center.y), Double(dots[$1].x - center.x))
            }
        }
        let oa = angleOrder(a.dots), ob = angleOrder(b.dots)
        let n = max(a.dots.count, b.dots.count)

        // Escalonado: cada punto arranca un poco después que el anterior, siguiendo su
        // posición angular. Si todos salieran y llegaran a la vez el cambio se siente
        // rígido; con el retardo el conjunto se reacomoda como una ola y se ve natural.
        // `stagger` es la fracción del recorrido reservada a repartir esas salidas.
        let stagger = 0.55
        let span = 1 - stagger

        var out: [NikiOrbDot] = []
        out.reserveCapacity(n)
        for i in 0..<n {
            let da = a.dots[oa[i * oa.count / n]]
            let db = b.dots[ob[i * ob.count / n]]
            // Retardo por punto (0…stagger) según su lugar en el barrido angular.
            let delay = stagger * (Double(i) / Double(max(1, n - 1)))
            var p = (k - delay) / span
            p = max(0, min(1, p))
            p = p * p * (3 - 2 * p)  // suaviza la salida y la llegada de cada punto
            out.append(NikiOrbDot(
                x: da.x + (db.x - da.x) * CGFloat(p),
                y: da.y + (db.y - da.y) * CGFloat(p),
                z: lerp(da.z, db.z, p),
                r: da.r + (db.r - da.r) * CGFloat(p),
                white: lerp(da.white, db.white, p),
                a: lerp(da.a, db.a, p)))
        }
        out.sort { $0.z < $1.z }

        // Las aristas (solo las tiene `web`) se desvanecen en vez de interpolarse:
        // no hay correspondencia sensata entre aristas de dos grafos distintos.
        var lines = a.lines.map { l -> NikiOrbLine in var m = l; m.a = l.a * (1 - k); return m }
        lines += b.lines.map { l -> NikiOrbLine in var m = l; m.a = l.a * k; return m }
        return NikiOrbFrame(dots: out, lines: lines.filter { $0.a >= 0.02 })
    }
}

// MARK: - Parámetros por geometría (tabla `gp`) y afinado por tamaño (tabla `kp`)

struct NikiOrbOptions {
    var latRings = 17
    var lonDensity = 44
    var rings = 15
    var lanes = 5
    var segs = 88
    var orbitN = 12
    var ghostN = 40
    var nodeN = 30
    var strandN = 52
    var turns = 3
    var moveCount = 14
    var particles = 3
    var ghostR = 0.9
    var ghostA = 0.5
    var partR = 1.2
    var partRDepth = 1.6
    var rBase = 0.6
    var rDepth = 1.7
    var rBoost = 1.0
    var rActive = 0.3
    var inkFar = 0.62
    var inkSpan = 0.54
    var rsPow = 0.6
    var rMin = 0.3
    var thr = 0.72
    var nodeR = 1.4
    var nodeRDepth = 1.8
    var lineW = 0.8
    var faceOn = false
    var spin = 1.0
    var bandMul = 1.0
    var wobMul = 1.0
    var scanMul = 1.0
    var dimBase = 1.0
    var spread = 1.0
    var rSizeMul = 1.0
    /// Nivel de voz en vivo (0…1). En el anillo se traduce en vibración real: más
    /// ondulación y más radio, para que se vea "hablar" y no solo girar.
    var live = 0.0
}

enum NikiOrbConfig {
    /// Solo usamos dos figuras: el **anillo** como forma en reposo (y durante la
    /// llamada, donde vibra con la voz) y el **rubik** mientras Niki está procesando.
    /// El resto de geometrías del set original quedan implementadas pero sin usar.
    static func kind(for state: NikiThinkingOrbState) -> NikiOrbGeometryKind {
        switch state {
        case .solving, .working, .searching, .weaving:
            return .rubik          // pensando / trabajando
        default:
            return .ring           // reposo, escuchando y hablando
        }
    }

    /// Base de la tabla `gp`, más el afinado por tamaño de `kp`.
    /// El original solo define buckets de 64px y 20px; para el orbe grande de Niki
    /// (140–840px) usamos densidad completa y dejamos que `Vt` escale el radio.
    static func options(for kind: NikiOrbGeometryKind, size: CGFloat) -> (opts: NikiOrbOptions, speed: Double) {
        var o = NikiOrbOptions()
        var speed = 2.0
        // count/size del bucket chico (20px). nil = densidad completa.
        var count: Double? = nil
        var sizeMul: Double = 1

        switch kind {
        case .globe:
            o.latRings = 17; o.lonDensity = 44; o.rBase = 0.6; o.rDepth = 1.7; o.rBoost = 1
            o.inkFar = 0.62; o.inkSpan = 0.54; o.scanMul = 4.08; o.dimBase = 0.45
            speed = 2.015
            if size < 40 { count = 0.105; sizeMul = 1.75; speed = 2.665; o.scanMul = 4.335 }
        case .orbits:
            o.orbitN = 12; o.ghostN = 40; o.ghostR = 0.9; o.ghostA = 0.5
            o.particles = 3; o.partR = 1.2; o.partRDepth = 1.6
            speed = 1.885
            if size < 40 { count = 0.238; sizeMul = 2.4; speed = 3.9 }
        case .rubik:
            o.latRings = 15; o.lonDensity = 40; o.moveCount = 14
            o.rBase = 0.6; o.rDepth = 1.7; o.rActive = 0.3; o.inkFar = 0.62; o.inkSpan = 0.54
            speed = 1.82
            if size < 40 { count = 0.088; sizeMul = 1.9; speed = 1.95 }
        case .wave:
            o.rings = 15; o.lonDensity = 40; o.rBase = 0.6; o.rDepth = 1.7
            speed = 4.388
            if size < 40 { count = 0.105; sizeMul = 1.6; speed = 3.998 }
        case .web:
            o.nodeN = 30; o.thr = 0.72; o.nodeR = 1.4; o.nodeRDepth = 1.8; o.lineW = 0.8
            speed = 3.315
            if size < 40 { count = 0.25; sizeMul = 1.52; speed = 6.63 }
        case .braid:
            o.strandN = 52; o.turns = 3; o.ghostN = 150; o.rBase = 1.2; o.rDepth = 1.8
            speed = 1.625
            if size < 40 { count = 0.1125; sizeMul = 1.36; speed = 2.75 }
        case .ribbon:
            o.lanes = 5; o.segs = 88; o.ghostN = 150; o.rBase = 1.1; o.rDepth = 1.7
            o.spin = 0; o.bandMul = 3.9; o.wobMul = 1
            speed = 2.34
            if size < 40 { count = 0.051; sizeMul = 1.073; speed = 3.12; o.bandMul = 4.94 }
        case .ring:
            o.lanes = 5; o.segs = 88; o.ghostN = 0; o.faceOn = true
            o.rBase = 1.1; o.rDepth = 1.7; o.spin = 0; o.bandMul = 3.627; o.wobMul = 0.368
            speed = 3.24
            if size < 40 { count = 0.028; sizeMul = 1.622; speed = 3.78; o.bandMul = 3.968; o.wobMul = 0.565 }
        case .morph:
            o.rMin = 0.25; o.spread = 1.45
            speed = 2.405
            if size < 40 { sizeMul = 1.011 / 0.395; speed = 2.08 }
        }

        // `vp` — escala de densidad. Las mallas 2D escalan por sqrt en cada eje.
        if let c = count, c != 1 {
            let s = sqrt(c)
            o.latRings = max(3, Int((Double(o.latRings) * s).rounded()))
            o.rings = max(3, Int((Double(o.rings) * s).rounded()))
            o.lanes = max(1, Int((Double(o.lanes) * s).rounded()))
            o.lonDensity = max(4, Int((Double(o.lonDensity) * s).rounded()))
            o.segs = max(8, Int((Double(o.segs) * s).rounded()))
            o.orbitN = max(2, Int((Double(o.orbitN) * c).rounded()))
            o.ghostN = Int((Double(o.ghostN) * c).rounded())
            o.nodeN = max(4, Int((Double(o.nodeN) * c).rounded()))
            o.strandN = max(6, Int((Double(o.strandN) * c).rounded()))
        }
        // `yp` — escala de radio de punto.
        o.rSizeMul = sizeMul
        return (o, speed)
    }
}

// MARK: - Builders

enum NikiOrbBuilder {
    static func build(kind: NikiOrbGeometryKind, size: CGFloat, time: Double, opts: NikiOrbOptions) -> NikiOrbFrame {
        switch kind {
        case .globe:  return globe(size, time, opts)
        case .orbits: return orbits(size, time, opts)
        case .wave:   return wave(size, time, opts)
        case .web:    return web(size, time, opts)
        case .braid:  return braid(size, time, opts)
        case .ribbon, .ring: return ribbon(size, time, opts)
        case .rubik:  return rubik(size, time, opts)
        case .morph:  return morph(size, time, opts)
        }
    }

    // `bd` — globo de latitudes con una banda de escaneo que lo recorre.
    static func globe(_ e: CGFloat, _ t: Double, _ n: NikiOrbOptions) -> NikiOrbFrame {
        let cx = e / 2, cy = e / 2, rad = Double(e) / 2 * 0.82
        let pitch = 0.4 + 0.06 * sin(t * 0.35)
        let proj = NikiOrbMath.projector(yaw: t * 0.5, pitch: pitch, cx: cx, cy: cy, scale: rad)
        let scan = t * (0.5 + (1.7 - 0.5) * n.scanMul)
        let v = NikiOrbMath.sizeScale(e, n.rsPow) * n.rSizeMul
        let dim = n.dimBase
        var dots: [NikiOrbDot] = []
        for w in 0...n.latRings {
            let lat = -Double.pi / 2 + Double(w) / Double(n.latRings) * Double.pi
            let c = cos(lat), s = sin(lat)
            let count = max(1, Int((abs(c) * Double(n.lonDensity)).rounded()))
            for m in 0..<count {
                let lon = Double(m) / Double(count) * 2 * Double.pi
                let (x, y, z) = proj(c * cos(lon), s, c * sin(lon))
                let depth = (z + 1) / 2
                let d = NikiOrbMath.angDist(lon + t * 0.5, scan)
                let glow = exp(-(d * d) / 0.18) * max(0, z)
                dots.append(NikiOrbDot(
                    x: x, y: y, z: z,
                    r: CGFloat((n.rBase + n.rDepth * depth + n.rBoost * glow) * v),
                    white: n.inkFar - n.inkSpan * depth,
                    a: dim + (1 - dim) * min(1, glow)))
            }
        }
        return NikiOrbMath.finalize(dots, [], rMin: n.rMin)
    }

    // `sp` — anillos orbitales fantasma con partículas brillantes recorriéndolos.
    static func orbits(_ e: CGFloat, _ t: Double, _ n: NikiOrbOptions) -> NikiOrbFrame {
        let cx = e / 2, cy = e / 2, rad = Double(e) / 2 * 0.82
        let proj = NikiOrbMath.projector(yaw: t * 0.12, pitch: 0.3, cx: cx, cy: cy, scale: 1)
        let v = NikiOrbMath.sizeScale(e, n.rsPow) * n.rSizeMul
        var dots: [NikiOrbDot] = []
        for p in 0..<n.orbitN {
            let h1 = NikiOrbMath.hash(Double(p), 1.7)
            let h2 = NikiOrbMath.hash(Double(p), 5.2)
            let h3 = NikiOrbMath.hash(Double(p), 8.9)
            let R = rad * (0.45 + 0.52 * h1)
            let theta = h1 * 2 * Double.pi
            let phi = acos(2 * h2 - 1)
            let dx = sin(phi) * cos(theta), dy = cos(phi), dz = sin(phi) * sin(theta)
            var ax = -dy, ay = dx
            let len = max(1e-6, sqrt(ax * ax + ay * ay))
            ax /= len; ay /= len
            let bz0 = 0.0
            let bx = dy * bz0 - dz * ay
            let by = dz * ax - dx * bz0
            let bz = dx * ay - dy * ax
            let spd = (0.25 + 0.55 * h3) * (h3 > 0.5 ? 1 : -1)

            for g in 0..<n.ghostN {
                let a = Double(g) / Double(n.ghostN) * 2 * Double.pi
                let (x, y, z) = proj((ax * cos(a) + bx * sin(a)) * R,
                                     (ay * cos(a) + by * sin(a)) * R,
                                     (bz0 * cos(a) + bz * sin(a)) * R)
                let depth = (z / R + 1) / 2
                dots.append(NikiOrbDot(x: x, y: y, z: z, r: CGFloat(n.ghostR * v),
                                       white: 0.72, a: n.ghostA * (0.4 + 0.6 * depth)))
            }
            for k in 0..<n.particles {
                let a = t * spd + Double(k) / Double(n.particles) * 2 * Double.pi + h2 * 6
                let (x, y, z) = proj((ax * cos(a) + bx * sin(a)) * R,
                                     (ay * cos(a) + by * sin(a)) * R,
                                     (bz0 * cos(a) + bz * sin(a)) * R)
                let depth = (z / R + 1) / 2
                dots.append(NikiOrbDot(x: x, y: y, z: z,
                                       r: CGFloat((n.partR + n.partRDepth * depth) * v),
                                       white: 0.3 - 0.22 * depth, a: 1))
            }
        }
        return NikiOrbMath.finalize(dots, [], rMin: n.rMin)
    }

    // `tp` — anillos que laten hacia dentro y fuera, como una onda de sonido.
    static func wave(_ e: CGFloat, _ t: Double, _ n: NikiOrbOptions) -> NikiOrbFrame {
        let cx = e / 2, cy = e / 2, rad = Double(e) / 2 * 0.874
        let proj = NikiOrbMath.projector(yaw: t * 0.18, pitch: 0.38, cx: cx, cy: cy, scale: 1)
        let v = NikiOrbMath.sizeScale(e, n.rsPow) * n.rSizeMul
        var dots: [NikiOrbDot] = []
        for h in 0...n.rings {
            let lat = -Double.pi / 2 + Double(h) / Double(n.rings) * Double.pi
            let c = cos(lat), s = sin(lat)
            let w = 0.62 * sin(t * 2.1 - Double(h) * 0.52) + 0.38 * sin(t * 1.27 + Double(h) * 0.83)
            let R = rad * (0.88 + 0.105 * w)
            let count = max(1, Int((abs(c) * Double(n.lonDensity)).rounded()))
            for a in 0..<count {
                let lon = Double(a) / Double(count) * 2 * Double.pi
                let (x, y, z) = proj(c * cos(lon) * R, s * R, c * sin(lon) * R)
                let depth = (z / rad + 1) / 2
                let boost = max(0, w)
                dots.append(NikiOrbDot(x: x, y: y, z: z,
                                       r: CGFloat((n.rBase + n.rDepth * depth) * (1 + 0.4 * boost) * v),
                                       white: 0.66 - 0.56 * depth - 0.1 * boost, a: 1))
            }
        }
        return NikiOrbMath.finalize(dots, [], rMin: n.rMin)
    }

    // `ap` — nodos a la deriva unidos por aristas cuando se acercan.
    static func web(_ e: CGFloat, _ t: Double, _ n: NikiOrbOptions) -> NikiOrbFrame {
        let cx = e / 2, cy = e / 2, rad = Double(e) / 2 * 0.8 * n.spread
        let proj = NikiOrbMath.projector(yaw: t * 0.12, pitch: 0.32, cx: cx, cy: cy, scale: rad)
        let v = NikiOrbMath.sizeScale(e, n.rsPow) * n.rSizeMul
        var pts: [(Double, Double, Double)] = []
        for i in 0..<n.nodeN {
            let f = NikiOrbMath.fibonacci(i, n.nodeN)
            let a = f.0 + 0.3 * (NikiOrbMath.noise(Double(i) * 0.31 + 9, t * 0.24) - 0.5) * 2
            let b = f.1 + 0.3 * (NikiOrbMath.noise(Double(i) * 0.53 + 27, t * 0.21) - 0.5) * 2
            let c = f.2 + 0.3 * (NikiOrbMath.noise(Double(i) * 0.77 + 55, t * 0.27) - 0.5) * 2
            let k = max(1e-6, sqrt(a * a + b * b + c * c))
            pts.append((a / k, b / k, c / k))
        }
        var lines: [NikiOrbLine] = []
        var dots: [NikiOrbDot] = []
        for i in 0..<n.nodeN {
            for j in (i + 1)..<n.nodeN {
                let dx = pts[i].0 - pts[j].0, dy = pts[i].1 - pts[j].1, dz = pts[i].2 - pts[j].2
                let dist = sqrt(dx * dx + dy * dy + dz * dz)
                if dist >= n.thr { continue }
                let (x1, y1, z1) = proj(pts[i].0, pts[i].1, pts[i].2)
                let (x2, y2, z2) = proj(pts[j].0, pts[j].1, pts[j].2)
                let depth = ((z1 + z2) / 2 + 1) / 2
                lines.append(NikiOrbLine(x1: x1, y1: y1, x2: x2, y2: y2,
                                         white: 0.42,
                                         a: (1 - dist / n.thr) * (0.3 + 0.55 * depth),
                                         w: CGFloat(max(0.6, n.lineW * v))))
            }
        }
        for i in 0..<n.nodeN {
            let (x, y, z) = proj(pts[i].0, pts[i].1, pts[i].2)
            let depth = (z + 1) / 2
            let pulse = 1 + 0.25 * sin(t * 1.4 + Double(i) * 2.7)
            dots.append(NikiOrbDot(x: x, y: y, z: z,
                                   r: CGFloat((n.nodeR + n.nodeRDepth * depth) * pulse * v),
                                   white: 0.55 - 0.45 * depth, a: 1))
        }
        return NikiOrbMath.finalize(dots, lines, rMin: n.rMin)
    }

    // `Gd` — tres hebras trenzándose sobre una nube fantasma.
    static func braid(_ e: CGFloat, _ t: Double, _ n: NikiOrbOptions) -> NikiOrbFrame {
        let cx = e / 2, cy = e / 2, rad = Double(e) / 2 * 0.76
        let proj = NikiOrbMath.projector(yaw: t * 0.4, pitch: 0.3, cx: cx, cy: cy, scale: 1)
        let v = NikiOrbMath.sizeScale(e, n.rsPow) * n.rSizeMul
        var dots: [NikiOrbDot] = []
        for i in 0..<n.ghostN {
            let f = NikiOrbMath.fibonacci(i, n.ghostN)
            let (x, y, z) = proj(f.0 * rad, f.1 * rad, f.2 * rad)
            let depth = (z / rad + 1) / 2
            dots.append(NikiOrbDot(x: x, y: y, z: z, r: CGFloat(0.8 * v),
                                   white: 0.78, a: 0.1 + 0.22 * depth))
        }
        for p in 0..<3 {
            let phase = Double(p) / 3 * 2 * Double.pi
            for g in 0..<n.strandN {
                let u = (NikiOrbMath.fract(Double(g) / Double(n.strandN) + t * 0.045) * 2 - 1) * 0.96
                let ring = sqrt(max(0, 1 - u * u))
                let fade = min(1, (1 - abs(u)) / 0.1)
                let ang = u * Double.pi * Double(n.turns) + phase
                let bulge = 1 + 0.075 * sin(u * Double.pi * Double(n.turns) * 2 + phase * 2 + t * 0.8)
                let rr = ring * rad * bulge
                let (x, y, z) = proj(cos(ang) * rr, u * rad * bulge, sin(ang) * rr)
                let depth = (z / rad + 1) / 2
                dots.append(NikiOrbDot(x: x, y: y, z: z,
                                       r: CGFloat((n.rBase + n.rDepth * depth) * v),
                                       white: 0.55 - 0.45 * depth,
                                       a: fade * (0.45 + 0.55 * depth)))
            }
        }
        return NikiOrbMath.finalize(dots, [], rMin: n.rMin)
    }

    // `bi` — cinta de carriles ondulando (ribbon) o anillo plano de frente (ring).
    static func ribbon(_ e: CGFloat, _ t: Double, _ n: NikiOrbOptions) -> NikiOrbFrame {
        let cx = e / 2, cy = e / 2, rad = Double(e) / 2 * 0.78
        let spin = n.spin
        let basePitch = 0.3
        let proj = NikiOrbMath.projector(yaw: t * 0.1 * spin, pitch: basePitch, cx: cx, cy: cy, scale: 1)
        let v = NikiOrbMath.sizeScale(e, n.rsPow) * n.rSizeMul
        var dots: [NikiOrbDot] = []
        for i in 0..<n.ghostN {
            let f = NikiOrbMath.fibonacci(i, n.ghostN)
            let (x, y, z) = proj(f.0 * rad, f.1 * rad, f.2 * rad)
            let depth = (z / rad + 1) / 2
            dots.append(NikiOrbDot(x: x, y: y, z: z, r: CGFloat(0.8 * v),
                                   white: 0.78, a: 0.1 + 0.22 * depth))
        }
        let p = t * 0.24 * spin
        let tilt = n.faceOn ? -basePitch : 0.55 + 0.3 * sin(t * 0.18) * spin
        let g = cos(p), w0 = 0.0, c0 = sin(p)
        let cc = -c0 * sin(tilt), aa = cos(tilt), dd = g * sin(tilt)
        let m = w0 * dd - c0 * aa
        let k = c0 * cc - g * dd
        let s2 = g * aa - w0 * cc
        // La voz en vivo amplifica la ondulación y ensancha un poco el anillo:
        // eso es lo que se lee como "está hablando" en vez de solo girar.
        let voice = max(0, min(1, n.live))
        let wobMul = n.wobMul * (1 + 2.2 * voice)
        let wob = 0.23 * wobMul
        let E = (n.faceOn ? rad / (1 + 0.85 * wob) : rad) * (1 + 0.06 * voice)
        let bands = max(1, Int((Double(n.lanes) * n.bandMul).rounded()))
        for i in 0..<bands {
            let off = (Double(i) - Double(bands - 1) / 2) * 0.075
            let edge = abs(Double(i) - Double(bands - 1) / 2) / max(1, Double(bands - 1) / 2)
            for j in 0..<n.segs {
                let a = Double(j) / Double(n.segs) * 2 * Double.pi
                // Componente rápida extra proporcional a la voz — el "temblor".
                let tremor = voice * 0.10 * sin(a * 9 + t * 7.5)
                let wobble = (0.16 * sin(a * 3 - t * 1.7 + Double(i) * 0.22)
                              + 0.07 * sin(a * 5 + t * 1.1)) * wobMul + tremor
                let radMul = n.faceOn ? 1 + wobble : 1
                let lateral = n.faceOn ? off : off + wobble
                let X = g * cos(a) + cc * sin(a) + m * lateral
                let Y = w0 * cos(a) + aa * sin(a) + k * lateral
                let Z = c0 * cos(a) + dd * sin(a) + s2 * lateral
                let len = max(1e-6, sqrt(X * X + Y * Y + Z * Z))
                let R = E * radMul
                let (x, y, z) = proj(X / len * R, Y / len * R, Z / len * R)
                let depth = (z / rad + 1) / 2
                dots.append(NikiOrbDot(x: x, y: y, z: z,
                                       r: CGFloat((n.rBase + n.rDepth * depth) * (1 - 0.25 * edge) * v),
                                       white: 0.52 - 0.44 * depth + 0.18 * edge,
                                       a: 0.4 + 0.6 * depth))
            }
        }
        return NikiOrbMath.finalize(dots, [], rMin: n.rMin)
    }

    // `ep` — globo cuyas rebanadas giran por turnos, como un cubo de Rubik.
    // El original programa los giros con un scheduler (`Zd`/`Jd`); acá reproducimos
    // el mismo comportamiento visible: una rebanada activa a la vez, con easing,
    // resaltada con radio y tinta extra (`rActive`).
    static func rubik(_ e: CGFloat, _ t: Double, _ n: NikiOrbOptions) -> NikiOrbFrame {
        let cx = e / 2, cy = e / 2, rad = Double(e) / 2 * 0.82
        let proj = NikiOrbMath.projector(yaw: t * 0.55, pitch: 0.35 + 0.1 * sin(t * 0.9),
                                         cx: cx, cy: cy, scale: rad)
        let v = NikiOrbMath.sizeScale(e, n.rsPow) * n.rSizeMul

        // Un giro cada `hold`+`turn` segundos; el eje cambia de forma determinista.
        let hold = 0.42, turn = 1.2
        let cycle = hold + turn
        let moveIndex = floor(t / cycle)
        let local = t - moveIndex * cycle
        let raw = max(0, min(1, (local - hold) / turn))
        let eased = raw < 0.5 ? 4 * raw * raw * raw : 1 - pow(-2 * raw + 2, 3) / 2
        let angle = eased * Double.pi / 2
        let axis = Int(NikiOrbMath.hash(moveIndex, 3.1) * 3) % 3
        let sliceSel = NikiOrbMath.hash(moveIndex, 7.7) * 2 - 1

        var dots: [NikiOrbDot] = []
        for w in 0...n.latRings {
            let lat = -Double.pi / 2 + Double(w) / Double(n.latRings) * Double.pi
            let c = cos(lat), s = sin(lat)
            let count = max(1, Int((abs(c) * Double(n.lonDensity)).rounded()))
            for m in 0..<count {
                let lon = Double(m) / Double(count) * 2 * Double.pi
                var px = c * cos(lon), py = s, pz = c * sin(lon)
                // ¿Cae el punto en la rebanada que está girando?
                let coord = axis == 0 ? px : (axis == 1 ? py : pz)
                let active = abs(coord - sliceSel * 0.6) < 0.34
                if active && angle > 0 {
                    let ca = cos(angle), sa = sin(angle)
                    switch axis {
                    case 0: let y2 = py * ca - pz * sa; let z2 = py * sa + pz * ca; py = y2; pz = z2
                    case 1: let x2 = px * ca + pz * sa; let z2 = -px * sa + pz * ca; px = x2; pz = z2
                    default: let x2 = px * ca - py * sa; let y2 = px * sa + py * ca; px = x2; py = y2
                    }
                }
                let (x, y, z) = proj(px, py, pz)
                let depth = (z + 1) / 2
                dots.append(NikiOrbDot(
                    x: x, y: y, z: z,
                    r: CGFloat((n.rBase + n.rDepth * depth + (active ? n.rActive : 0)) * v),
                    white: n.inkFar - n.inkSpan * depth - (active ? 0.14 : 0),
                    a: 1))
            }
        }
        return NikiOrbMath.finalize(dots, [], rMin: n.rMin)
    }

    // `ip` — puntos que se reacomodan entre círculo → triángulo → cuadrado.
    private static let morphShapes: [[(Double, Double)]] = [
        // círculo (muestreado)
        (0..<48).map { i -> (Double, Double) in
            let a = -Double.pi / 2 + Double(i) / 48 * 2 * Double.pi
            return (cos(a) * 0.24, sin(a) * 0.24)
        },
        [(0, -0.26), (0.24, 0.16), (-0.24, 0.16)],
        [(0, -0.2), (0.2, -0.2), (0.2, 0.2), (-0.2, 0.2), (-0.2, -0.2)]
    ]

    /// Muestrea el perímetro de un polígono a distancia uniforme (`hc` del original).
    private static func samplePerimeter(_ pts: [(Double, Double)], _ u: Double) -> (Double, Double) {
        let n = pts.count
        var segLens: [Double] = []
        var total = 0.0
        for i in 0..<n {
            let a = pts[i], b = pts[(i + 1) % n]
            let d = sqrt(pow(b.0 - a.0, 2) + pow(b.1 - a.1, 2))
            segLens.append(d); total += d
        }
        var target = u * total
        var idx = 0
        while idx < n - 1 && target > segLens[idx] { target -= segLens[idx]; idx += 1 }
        let a = pts[idx], b = pts[(idx + 1) % n]
        let f = segLens[idx] > 0 ? min(1, target / segLens[idx]) : 0
        return (a.0 + (b.0 - a.0) * f, a.1 + (b.1 - a.1) * f)
    }

    static func morph(_ e: CGFloat, _ t: Double, _ n: NikiOrbOptions) -> NikiOrbFrame {
        let cx = e / 2, cy = e / 2
        let scale = Double(e) * n.spread
        let v = NikiOrbMath.sizeScale(e, n.rsPow) * n.rSizeMul
        let hold = 1.4, morphT = 0.9, cycle = hold + morphT
        let shapes = morphShapes.count
        let local = t.truncatingRemainder(dividingBy: cycle * Double(shapes))
        let idx = Int(floor(local / cycle))
        let phase = local - Double(idx) * cycle
        var p = max(0, min(1, (phase - hold) / morphT))
        p = p * p * (3 - 2 * p)  // smoothstep
        let from = morphShapes[idx % shapes]
        let to = morphShapes[(idx + 1) % shapes]

        let dotCount = max(6, Int((34 * Double(e) / 64).rounded()))
        var dots: [NikiOrbDot] = []
        for i in 0..<dotCount {
            let u = Double(i) / Double(dotCount)
            let a = samplePerimeter(from, u)
            let b = samplePerimeter(to, u)
            let x = NikiOrbMath.lerp(a.0, b.0, p)
            let y = NikiOrbMath.lerp(a.1, b.1, p)
            dots.append(NikiOrbDot(
                x: cx + CGFloat(x * scale), y: cy + CGFloat(y * scale), z: 0,
                r: CGFloat(max(0.021 * Double(e) * 0.5, 1.0) * v),
                white: 0.15, a: 1))
        }
        return NikiOrbMath.finalize(dots, [], rMin: n.rMin)
    }
}
