import Foundation
// Réplica del criterio de NikiAppModel.esMicFisico, contra los dispositivos reales de
// esta máquina más los virtuales típicos.
let virtuales = ["b2 ", "zoom", "blackhole", "loopback", "soundflower", "aggregate",
                 "multi-output", "virtual", "obs", "krisp", "vb-cable", "existential"]
func esFisico(_ n: String) -> Bool {
    let l = n.lowercased()
    if l.contains("bocina") || l.contains("speaker") || l.contains("output") { return false }
    return !virtuales.contains { l.contains($0) }
}
let dispositivos = ["B2 Microphone", "Micrófono de MacBook Pro", "Bocinas de MacBook Pro",
                    "ZoomAudioDevice", "BlackHole 2ch", "AirPods de Esteban"]
var fallos = 0
for d in dispositivos {
    let f = esFisico(d)
    let esperado = ["Micrófono de MacBook Pro", "AirPods de Esteban"].contains(d)
    if f != esperado { fallos += 1 }
    print("  \(f ? "físico  " : "descarta") \(d)\(f == esperado ? "" : "   ✘ inesperado")")
}
let fisicos = dispositivos.filter(esFisico)
let elegido = fisicos.first(where: { $0.lowercased().contains("macbook") }) ?? fisicos.first
print("\n  elegido: \(elegido ?? "(ninguno)")")
if elegido != "Micrófono de MacBook Pro" { fallos += 1 }
print(fallos == 0 ? "\nTODO OK" : "\n\(fallos) FALLOS")
