// Prueba el conteo de quién necesita la cámara, sin cámara.
//
// Existe por el bug que lo motivó: siete lugares la prendían y apagaban, cada uno con su
// propio "¿ya estaba prendida?". Ese chequeo miente porque el estado se actualiza después,
// así que dos que empiecen a la vez —y al abrir una videollamada arrancan tres— creen los
// dos que la prendieron ellos, y el primero que termina la apaga mientras el otro la usa.
//
// Uso:
//     swiftc -o /tmp/probar-camara pruebas-camara/main.swift && /tmp/probar-camara

import Foundation

/// El mismo conteo que WebcamManager, sin AVFoundation para poder probarlo.
final class Conteo {
    private var retenciones = 0
    private var espejoRetenido = false
    private let candado = NSLock()
    private(set) var prendidas = 0
    private(set) var apagadas = 0
    var prendida: Bool { prendidas > apagadas }

    func retener() {
        candado.lock(); retenciones += 1; let primero = retenciones == 1; candado.unlock()
        if primero { prendidas += 1 }
    }
    func soltar() {
        candado.lock()
        guard retenciones > 0 else { candado.unlock(); return }
        retenciones -= 1; let ultimo = retenciones == 0; candado.unlock()
        if ultimo { apagadas += 1 }
    }
    func retenerEspejo() {
        guard !espejoRetenido else { return }
        espejoRetenido = true; retener()
    }
    func soltarEspejo() {
        guard espejoRetenido else { return }
        espejoRetenido = false; soltar()
    }
}

var fallas = 0
func revisar(_ titulo: String, _ ok: Bool, _ detalle: String) {
    print("  [\(ok ? "ok   " : "FALLA")] \(titulo): \(detalle)")
    if !ok { fallas += 1 }
}

print("Quién necesita la cámara")

// El caso que rompía: tres arrancan juntos al abrir una videollamada.
do {
    let c = Conteo()
    c.retener()   // mirar la cara
    c.retener()   // los gestos
    c.retener()   // la mirada periódica
    revisar("se prende una sola vez con tres pidiéndola", c.prendidas == 1, "\(c.prendidas)")
    c.soltar()    // la cara termina de mirar
    revisar("sigue prendida cuando uno suelta", c.prendida, "quedan 2")
    c.soltar()
    revisar("sigue prendida con uno solo", c.prendida, "queda 1")
    c.soltar()
    revisar("se apaga cuando la suelta el último", !c.prendida, "quedan 0")
}

// Soltar de más no puede dejar la cuenta en negativo: el próximo retener tiene que
// prenderla, no creer que ya está.
do {
    let c = Conteo()
    c.soltar(); c.soltar()
    c.retener()
    revisar("soltar de más no descuadra la cuenta", c.prendida, "se prendió igual")
}

// El espejo del notch: un interruptor, con llamadas que no vienen de a pares.
do {
    let c = Conteo()
    c.retener()          // los gestos están usando la cámara
    c.retenerEspejo()    // el usuario abre el espejo
    c.soltarEspejo()
    c.soltarEspejo()     // cerrar dos veces (onDisappear + toque)
    revisar("el espejo no apaga lo que usan los demás", c.prendida, "sigue prendida")
    c.soltar()
    revisar("y al soltar el último sí se apaga", !c.prendida, "apagada")
}

do {
    let c = Conteo()
    c.retenerEspejo()
    c.retenerEspejo()    // abrir dos veces
    c.soltarEspejo()
    revisar("abrir el espejo dos veces y cerrarlo una lo apaga", !c.prendida, "apagada")
}

// Un ciclo completo, como una conversación entera.
do {
    let c = Conteo()
    for _ in 0 ..< 20 { c.retener(); c.soltar() }
    revisar("veinte ciclos no dejan la cámara colgada", !c.prendida && c.prendidas == 20,
            "\(c.prendidas) encendidos, \(c.apagadas) apagados")
}

print("\n\(fallas) fallas")
exit(fallas == 0 ? 0 : 1)
