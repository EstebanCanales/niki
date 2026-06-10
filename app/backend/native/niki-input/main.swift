// niki-input — helper nativo de control de entrada para Niki.
//
// Ejecuta eventos de mouse y teclado a nivel de sistema usando CGEvent, además de
// consultar la posición del cursor y la geometría de las pantallas. Recibe un comando
// JSON como primer argumento (o por stdin) y devuelve un resultado JSON por stdout.
//
// Requiere permiso de Accesibilidad para que los eventos sintéticos lleguen al sistema.
//
// Uso:
//   niki-input '{"action":"move","x":100,"y":200}'
//   echo '{"action":"type","text":"hola"}' | niki-input -
//
// Acciones soportadas:
//   move        {x,y}
//   click       {x?,y?,button?(left|right|center),count?}
//   down/up     {x?,y?,button?}
//   drag        {x1,y1,x2,y2,button?,steps?}
//   scroll      {dx?,dy?}
//   type        {text}
//   key         {key, modifiers?:[cmd,shift,alt,ctrl,fn]}
//   cursor      -> {x,y}
//   screens     -> [{index,x,y,width,height,main}]

import Foundation
import CoreGraphics
import AppKit

// MARK: - Salida JSON

func emit(_ obj: [String: Any]) {
    var out = obj
    if out["ok"] == nil { out["ok"] = true }
    if let data = try? JSONSerialization.data(withJSONObject: out, options: []),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    } else {
        print("{\"ok\":false,\"error\":\"serialization failed\"}")
    }
}

func fail(_ message: String) -> Never {
    emit(["ok": false, "error": message])
    exit(1)
}

// MARK: - Lectura de comando

func readCommand() -> [String: Any] {
    let args = CommandLine.arguments
    var raw: String? = nil
    if args.count >= 2 {
        if args[1] == "-" {
            let data = FileHandle.standardInput.readDataToEndOfFile()
            raw = String(data: data, encoding: .utf8)
        } else {
            raw = args[1]
        }
    } else {
        let data = FileHandle.standardInput.readDataToEndOfFile()
        raw = String(data: data, encoding: .utf8)
    }
    guard let text = raw, let data = text.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        fail("invalid or missing JSON command")
    }
    return obj
}

func dbl(_ obj: [String: Any], _ key: String, _ fallback: Double) -> Double {
    if let v = obj[key] as? Double { return v }
    if let v = obj[key] as? Int { return Double(v) }
    if let v = obj[key] as? String, let d = Double(v) { return d }
    return fallback
}

func intval(_ obj: [String: Any], _ key: String, _ fallback: Int) -> Int {
    if let v = obj[key] as? Int { return v }
    if let v = obj[key] as? Double { return Int(v) }
    if let v = obj[key] as? String, let i = Int(v) { return i }
    return fallback
}

// MARK: - Mouse

func mouseButton(_ name: String) -> (CGMouseButton, CGEventType, CGEventType) {
    switch name {
    case "right": return (.right, .rightMouseDown, .rightMouseUp)
    case "center": return (.center, .otherMouseDown, .otherMouseUp)
    default: return (.left, .leftMouseDown, .leftMouseUp)
    }
}

func currentMouse() -> CGPoint {
    let loc = NSEvent.mouseLocation
    // NSEvent usa coordenadas con origen abajo-izquierda; CGEvent usa arriba-izquierda.
    let screenHeight = NSScreen.screens.first(where: { $0.frame.origin == .zero })?.frame.height
        ?? NSScreen.main?.frame.height ?? 0
    return CGPoint(x: loc.x, y: screenHeight - loc.y)
}

func postMouse(_ type: CGEventType, _ point: CGPoint, _ button: CGMouseButton, clickCount: Int = 1) {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button) else { return }
    if clickCount > 1 { event.setIntegerValueField(.mouseEventClickState, value: Int64(clickCount)) }
    event.post(tap: .cghidEventTap)
}

func moveMouse(_ point: CGPoint) {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) else { return }
    event.post(tap: .cghidEventTap)
}

// MARK: - Teclado

// Mapa de nombres -> CGKeyCode (teclado US ANSI).
let keyMap: [String: CGKeyCode] = [
    "a":0,"s":1,"d":2,"f":3,"h":4,"g":5,"z":6,"x":7,"c":8,"v":9,"b":11,"q":12,"w":13,
    "e":14,"r":15,"y":16,"t":17,"1":18,"2":19,"3":20,"4":21,"6":22,"5":23,"=":24,
    "9":25,"7":26,"-":27,"8":28,"0":29,"]":30,"o":31,"u":32,"[":33,"i":34,"p":35,
    "return":36,"enter":36,"l":37,"j":38,"'":39,"k":40,";":41,"\\":42,",":43,"/":44,
    "n":45,"m":46,".":47,"tab":48,"space":49,"`":50,"delete":51,"backspace":51,
    "escape":53,"esc":53,"cmd":55,"command":55,"shift":56,"capslock":57,"option":58,
    "alt":58,"control":59,"ctrl":59,"fn":63,"f1":122,"f2":120,"f3":99,"f4":118,
    "f5":96,"f6":97,"f7":98,"f8":100,"f9":101,"f10":109,"f11":103,"f12":111,
    "left":123,"right":124,"down":125,"up":126,"home":115,"end":119,"pageup":116,
    "pagedown":121,"forwarddelete":117,"help":114,
]

func flags(for modifiers: [String]) -> CGEventFlags {
    var f = CGEventFlags()
    for m in modifiers.map({ $0.lowercased() }) {
        switch m {
        case "cmd","command","meta": f.insert(.maskCommand)
        case "shift": f.insert(.maskShift)
        case "alt","option": f.insert(.maskAlternate)
        case "ctrl","control": f.insert(.maskControl)
        case "fn","function": f.insert(.maskSecondaryFn)
        default: break
        }
    }
    return f
}

func pressKey(_ keyName: String, modifiers: [String]) {
    let name = keyName.lowercased()
    guard let code = keyMap[name] else { fail("unknown key: \(keyName)") }
    let f = flags(for: modifiers)
    if let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true) {
        down.flags = f
        down.post(tap: .cghidEventTap)
    }
    if let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false) {
        up.flags = f
        up.post(tap: .cghidEventTap)
    }
}

func typeText(_ text: String) {
    // Escribe texto unicode arbitrario sin depender del layout del teclado.
    for scalarChunk in text.unicodeScalars.chunked(by: 1) {
        let chars = Array(String(String.UnicodeScalarView(scalarChunk)).utf16)
        if let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true) {
            down.keyboardSetUnicodeString(stringLength: chars.count, unicodeString: chars)
            down.post(tap: .cghidEventTap)
        }
        if let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false) {
            up.keyboardSetUnicodeString(stringLength: chars.count, unicodeString: chars)
            up.post(tap: .cghidEventTap)
        }
    }
}

extension Collection {
    func chunked(by size: Int) -> [[Element]] {
        var result: [[Element]] = []
        var chunk: [Element] = []
        for el in self {
            chunk.append(el)
            if chunk.count == size { result.append(chunk); chunk = [] }
        }
        if !chunk.isEmpty { result.append(chunk) }
        return result
    }
}

// MARK: - Main

let cmd = readCommand()
let action = (cmd["action"] as? String ?? "").lowercased()

switch action {
case "move":
    moveMouse(CGPoint(x: dbl(cmd, "x", 0), y: dbl(cmd, "y", 0)))
    emit(["action": "move"])

case "click":
    let (btn, downT, upT) = mouseButton(cmd["button"] as? String ?? "left")
    let point = (cmd["x"] != nil) ? CGPoint(x: dbl(cmd, "x", 0), y: dbl(cmd, "y", 0)) : currentMouse()
    let count = max(1, intval(cmd, "count", 1))
    moveMouse(point)
    for i in 1...count {
        postMouse(downT, point, btn, clickCount: i)
        postMouse(upT, point, btn, clickCount: i)
    }
    emit(["action": "click", "x": point.x, "y": point.y, "count": count])

case "down":
    let (btn, downT, _) = mouseButton(cmd["button"] as? String ?? "left")
    let point = (cmd["x"] != nil) ? CGPoint(x: dbl(cmd, "x", 0), y: dbl(cmd, "y", 0)) : currentMouse()
    postMouse(downT, point, btn)
    emit(["action": "down"])

case "up":
    let (btn, _, upT) = mouseButton(cmd["button"] as? String ?? "left")
    let point = (cmd["x"] != nil) ? CGPoint(x: dbl(cmd, "x", 0), y: dbl(cmd, "y", 0)) : currentMouse()
    postMouse(upT, point, btn)
    emit(["action": "up"])

case "drag":
    let (btn, downT, upT) = mouseButton(cmd["button"] as? String ?? "left")
    let start = CGPoint(x: dbl(cmd, "x1", 0), y: dbl(cmd, "y1", 0))
    let end = CGPoint(x: dbl(cmd, "x2", 0), y: dbl(cmd, "y2", 0))
    let steps = max(1, intval(cmd, "steps", 20))
    moveMouse(start)
    postMouse(downT, start, btn)
    for s in 1...steps {
        let t = Double(s) / Double(steps)
        let p = CGPoint(x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t)
        postMouse(.leftMouseDragged, p, btn)
    }
    postMouse(upT, end, btn)
    emit(["action": "drag"])

case "scroll":
    let dy = intval(cmd, "dy", 0)
    let dx = intval(cmd, "dx", 0)
    if let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: Int32(dy), wheel2: Int32(dx), wheel3: 0) {
        event.post(tap: .cghidEventTap)
    }
    emit(["action": "scroll", "dx": dx, "dy": dy])

case "type":
    typeText(cmd["text"] as? String ?? "")
    emit(["action": "type"])

case "key":
    let mods = (cmd["modifiers"] as? [String]) ?? []
    pressKey(cmd["key"] as? String ?? "", modifiers: mods)
    emit(["action": "key"])

case "cursor":
    let p = currentMouse()
    emit(["action": "cursor", "x": p.x, "y": p.y])

case "screens":
    var screens: [[String: Any]] = []
    let primaryHeight = NSScreen.screens.first(where: { $0.frame.origin == .zero })?.frame.height ?? 0
    for (i, screen) in NSScreen.screens.enumerated() {
        let f = screen.frame
        screens.append([
            "index": i,
            "x": f.origin.x,
            // Convertir a coordenadas top-left globales.
            "y": primaryHeight - (f.origin.y + f.height),
            "width": f.width,
            "height": f.height,
            "main": screen == NSScreen.main,
        ])
    }
    emit(["action": "screens", "screens": screens])

default:
    fail("unknown action: \(action)")
}
