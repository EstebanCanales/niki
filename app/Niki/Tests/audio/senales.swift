import Foundation

// Banco de audio sintético: señales con propiedades conocidas, para poder afirmar qué
// pasa el filtro y qué no. Se probaba a oído hasta ahora, que es como no probar.
func tono(_ hz: Double, _ segs: Double, amp: Double = 0.3, sr: Double = 16000) -> Data {
    var d = Data()
    for i in 0..<Int(segs*sr) {
        let v = Int16(amp * 32767 * sin(2 * .pi * hz * Double(i) / sr))
        withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) }
    }
    return d
}
func ruido(_ segs: Double, amp: Double = 0.05, sr: Double = 16000) -> Data {
    var d = Data(); var x: UInt64 = 12345
    for _ in 0..<Int(segs*sr) {
        x = x &* 6364136223846793005 &+ 1442695040888963407
        let r = Double(Int32(truncatingIfNeeded: x >> 33)) / Double(Int32.max)
        let v = Int16(max(-1, min(1, amp * r)) * 32767)
        withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) }
    }
    return d
}
func dbfs(_ pcm: Data) -> Double {
    let n = pcm.count/2; guard n > 0 else { return -160 }
    var s = 0.0
    pcm.withUnsafeBytes { r in
        let m = r.bindMemory(to: Int16.self)
        for i in 0..<n { let v = Double(m[i])/32768; s += v*v }
    }
    let rms = (s/Double(n)).squareRoot()
    return rms > 0 ? 20*log10(rms) : -160
}
func pico(_ pcm: Data) -> Double {
    let n = pcm.count/2; var p = 0.0
    pcm.withUnsafeBytes { r in
        let m = r.bindMemory(to: Int16.self)
        for i in 0..<n { p = max(p, abs(Double(m[i])/32768)) }
    }
    return p > 0 ? 20*log10(p) : -160
}
