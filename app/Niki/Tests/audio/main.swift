import Foundation
var fallos = 0
func check(_ ok: Bool, _ q: String, _ detalle: String = "") {
    print((ok ? "✔ " : "✘ ") + q + (detalle.isEmpty ? "" : "  [\(detalle)]"))
    if !ok { fallos += 1 }
}

func filtrar(_ pcm: Data) -> (Data, Double) {
    var hp = NikiBiquad.highPass(cutoff: 90, sampleRate: 16000)
    var bl = NikiBiquad.highPass(cutoff: 300, sampleRate: 16000)
    var bh = NikiBiquad.lowPass(cutoff: 3400, sampleRate: 16000)
    let n = pcm.count/2
    var out = Data(count: pcm.count); var suma = 0.0
    pcm.withUnsafeBytes { r in
        let m = r.bindMemory(to: Int16.self)
        out.withUnsafeMutableBytes { w in
            let e = w.bindMemory(to: Int16.self)
            for i in 0..<n {
                let x = Float(m[i])/32768
                let limpia = hp.process(x)
                e[i] = Int16(max(-1,min(1,limpia))*32767)
                let banda = bh.process(bl.process(limpia))
                suma += Double(banda*banda)
            }
        }
    }
    let rms = (suma/Double(n)).squareRoot()
    return (out, rms > 0 ? 20*log10(rms) : -160)
}

print("── pasa-altos: qué deja pasar y qué no ──")
let rumor = tono(45, 1.0, amp: 0.3)      // aire acondicionado / golpe de mesa
let voz   = tono(900, 1.0, amp: 0.3)     // dentro de la banda de voz
let (rumorF, rumorDb) = filtrar(rumor)
let (vozF, vozDb) = filtrar(voz)
// Un biquad de 2º orden da 12 dB/octava, y 45 Hz está exactamente una octava debajo
// del corte de 90 Hz. Pedir más que eso sería pedirle al filtro algo que no es.
check(dbfs(rumorF) < dbfs(rumor) - 10, "rumor de 45 Hz atenuado >10 dB en lo que se graba",
      String(format:"%.1f → %.1f dBFS", dbfs(rumor), dbfs(rumorF)))
check(abs(dbfs(vozF) - dbfs(voz)) < 3, "voz de 900 Hz pasa casi intacta",
      String(format:"%.1f → %.1f dBFS", dbfs(voz), dbfs(vozF)))

print("\n── banda de voz: el detector ignora lo que no es voz ──")
check(rumorDb < -40, "rumor de 45 Hz no dispara el VAD", String(format:"%.1f dBFS en banda", rumorDb))
check(vozDb > -25, "voz de 900 Hz sí lo dispara", String(format:"%.1f dBFS en banda", vozDb))
let (_, agudoDb) = filtrar(tono(7000, 1.0, amp: 0.3))
check(agudoDb < -25, "siseo de 7 kHz fuera de banda no dispara", String(format:"%.1f dBFS", agudoDb))
let (_, ruidoDb) = filtrar(ruido(1.0, amp: 0.05))
check(ruidoDb < -35, "ruido de fondo suave no dispara", String(format:"%.1f dBFS", ruidoDb))

print("\n── normalización a -3 dBFS ──")
let flojo = tono(500, 1.0, amp: 0.03)    // ~-33 dBFS, como los picos medidos
let norm = NikiVoiceCapture.normalize(flojo, peakTargetDb: -3)
check(abs(pico(norm) - (-3)) < 1.0, "un clip flojo sube a -3 dBFS de pico",
      String(format:"%.1f → %.1f dBFS", pico(flojo), pico(norm)))
let fuerte = tono(500, 1.0, amp: 0.7)
check(pico(NikiVoiceCapture.normalize(fuerte, peakTargetDb: -3)) <= pico(fuerte) + 0.1,
      "un clip ya fuerte no se toca", String(format:"%.1f dBFS", pico(fuerte)))
let silencio = Data(count: 16000*2)
check(NikiVoiceCapture.normalize(silencio, peakTargetDb: -3) == silencio,
      "el silencio no se amplifica (si no, subiría el ruido 40 dB)")

print(fallos == 0 ? "\nTODO OK" : "\n\(fallos) FALLOS")
