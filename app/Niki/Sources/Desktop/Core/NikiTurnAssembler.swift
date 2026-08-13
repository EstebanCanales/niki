import Foundation

/// Capa entre el STT y Hermes.
///
/// El VAD corta por silencio, y el silencio no sabe de gramática: si tomás aire a mitad
/// de una idea, corta igual. Mandar ese pedazo al modelo tal cual es lo que hacía que
/// Niki respondiera media pregunta y perdiera el hilo. Acá se decide, con el texto ya
/// transcrito, si lo que llegó es un turno completo, la continuación del anterior, o una
/// orden de callarse.
///
/// Todo es determinista y sin red a propósito: esta decisión ocurre en el camino crítico
/// del turno, y meterle una llamada a un modelo para saber si el usuario terminó de
/// hablar costaría más de lo que ahorra.
enum NikiTurnAssembler {

    /// Órdenes de callarse. No van al modelo: se ejecutan y punto.
    ///
    /// Antes "pará" viajaba a Hermes como cualquier frase, y para cuando volvía la
    /// respuesta Niki ya había terminado de decir lo que le pediste que dejara de decir.
    private static let stopCommands: Set<String> = [
        "para", "pará", "parate", "párate", "pare", "basta", "ya", "ya está", "ya esta",
        "callate", "cállate", "calla", "silencio", "shh", "sh", "stop", "espera",
        "esperá", "espérate", "esperate", "suficiente", "corta", "cortá", "no sigas",
        "detente", "quieto", "para para", "pará pará", "para para para", "pará pará pará",
    ]

    /// "Seguí" no es un turno nuevo: es pedir que retome lo que estaba diciendo. Mandarlo
    /// crudo al modelo hacía que arrancara el mismo texto desde cero, porque para él era
    /// una petición idéntica a la anterior.
    private static let resumeCommands: Set<String> = [
        "sigue", "seguí", "segui", "seguime", "continúa", "continua", "continuá",
        "continuar", "dale", "dale seguí", "sigue por favor", "seguí contando",
        "sigue contando", "seguí con eso", "y seguí", "podés seguir", "puedes seguir",
    ]

    /// Palabras con las que nadie termina una idea. Si la frase muere en una de estas,
    /// es una pausa, no un final.
    private static let danglingWords: Set<String> = [
        "y", "o", "u", "e", "pero", "que", "qué", "de", "del", "a", "al", "en", "con",
        "para", "por", "porque", "como", "cómo", "cuando", "cuándo", "donde", "dónde",
        "si", "sí", "el", "la", "los", "las", "un", "una", "unos", "unas", "lo", "le",
        "me", "te", "se", "mi", "tu", "su", "más", "muy", "sin", "sobre", "entre",
        "desde", "hasta", "tipo", "osea", "o sea", "entonces", "también", "aunque",
        "mientras", "pues", "este", "esta", "estos", "estas", "ese", "esa", "eso",
    ]

    private static func normalize(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: ".,;:!¡?¿…\"'()"))
            .lowercased()
    }

    /// ¿Es solo una orden de callarse? Se exige que la frase sea *nada más* que eso:
    /// "pará" corta, "pará de hablar del clima y contame otra cosa" es un turno normal.
    static func isStopCommand(_ text: String) -> Bool {
        let clean = normalize(text)
        guard !clean.isEmpty else { return false }
        if stopCommands.contains(clean) { return true }
        // "para, para, para" y variantes con repetición.
        let words = clean.split(whereSeparator: { " ,.".contains($0) }).map(String.init)
        guard !words.isEmpty, words.count <= 4 else { return false }
        return words.allSatisfy { stopCommands.contains($0) }
    }

    /// ¿Es un "seguí" pelado? Igual que con las órdenes de parar, se exige que la frase
    /// no diga nada más: "seguí" retoma, "seguí pero contame de otra cosa" es un turno.
    static func isResumeCommand(_ text: String) -> Bool {
        let clean = normalize(text)
        guard !clean.isEmpty else { return false }
        return resumeCommands.contains(clean)
    }

    /// Turno que se le manda al modelo para retomar. No repite la petición original: le
    /// da lo último que alcanzó a decir y le pide que siga a partir de ahí, que es lo
    /// que hace la diferencia entre continuar y empezar de nuevo.
    static func resumePrompt(interrupted: String) -> String {
        let tail = interrupted.trimmingCharacters(in: .whitespacesAndNewlines).suffix(400)
        guard !tail.isEmpty else {
            return "Seguí con lo que estabas diciendo."
        }
        return """
        Te interrumpí a mitad de tu respuesta. Esto es lo último que alcanzaste a decirme:

        «\(tail)»

        Continuá exactamente desde ahí, sin repetir nada de lo anterior y sin volver a \
        presentar el tema. Si ya habías terminado la idea, cerrala en una frase.
        """
    }

    /// ¿La frase quedó a medias? Si es así, lo que llegue después es su continuación y
    /// no un turno nuevo.
    static func looksUnfinished(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }

        // Cerrada con punto, signo o cierre de interrogación: se da por terminada.
        if let last = trimmed.last, ".!?…".contains(last) { return false }

        // Coma o dos puntos al final: te cortaron respirando.
        if let last = trimmed.last, ",;:".contains(last) { return true }

        let words = normalize(trimmed).split(separator: " ").map(String.init)
        guard let lastWord = words.last else { return false }
        if danglingWords.contains(lastWord) { return true }

        // Sin ningún signo de cierre. Es la señal más fuerte que hay: whisper cierra con
        // punto o con interrogación las frases que suenan completas, y deja el texto
        // abierto justo cuando te cortaron respirando. Equivocarse acá es barato — a lo
        // sumo se une con lo siguiente si llega enseguida (ver `continuationWindow`);
        // equivocarse al revés parte tu idea en dos y Niki responde a la mitad.
        return true
    }

    /// Muletillas que no aportan nada al modelo y sí ocupan lugar. Solo se quitan cuando
    /// están sueltas entre comas o al principio: "o sea" dentro de una frase puede estar
    /// haciendo trabajo real, y borrarlo cambiaría lo que dijiste.
    private static let muletillas = [
        "eh", "ehh", "este", "esteee", "mmm", "mm", "ehm", "em",
        "o sea", "osea", "digamos", "viste", "nada",
    ]

    /// Deja el texto transcrito listo para el modelo.
    ///
    /// Conservador a propósito: ante la duda no toca. Pasarse de listo acá significa
    /// cambiar lo que el usuario dijo, que es peor que mandar un "eh" de más.
    static func polish(_ text: String) -> String {
        var t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return t }

        // Muletilla al principio: "Eh, contame..." → "contame..."
        for m in muletillas {
            let patrones = ["^\(m),\\s+", "^\(m)\\s+"]
            for p in patrones {
                if let r = t.range(of: p, options: [.regularExpression, .caseInsensitive]) {
                    t = String(t[r.upperBound...])
                    break
                }
            }
        }

        // Muletilla aislada entre comas: "quiero, o sea, que busques" → "quiero, que busques"
        for m in muletillas {
            t = t.replacingOccurrences(
                of: ",\\s*\(m)\\s*,", with: ",",
                options: [.regularExpression, .caseInsensitive]
            )
        }

        // Tartamudeo: "la la casa" → "la casa". Solo palabras cortas repetidas pegadas;
        // con palabras largas es más probable que sea énfasis de verdad.
        t = t.replacingOccurrences(
            of: "\\b(\\w{1,4})\\s+\\1\\b", with: "$1",
            options: [.regularExpression, .caseInsensitive]
        )

        // Espacios y puntuación duplicada que deja el STT al unir segmentos.
        t = t.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        t = t.replacingOccurrences(of: "\\s+([,.;:!?])", with: "$1", options: .regularExpression)
        t = t.replacingOccurrences(of: "([,.;:])\\1+", with: "$1", options: .regularExpression)
        t = t.trimmingCharacters(in: .whitespaces)

        // Mayúscula inicial, que se pierde al sacar una muletilla del principio.
        if let f = t.first, f.isLowercase {
            t = f.uppercased() + t.dropFirst()
        }
        return t
    }

    /// Une la parte anterior con lo que siguió, sin duplicar puntuación ni repetir el
    /// fragmento si el STT ya lo incluyó.
    static func merge(_ previous: String, _ next: String) -> String {
        let a = previous.trimmingCharacters(in: .whitespacesAndNewlines)
        let b = next.trimmingCharacters(in: .whitespacesAndNewlines)
        if a.isEmpty { return b }
        if b.isEmpty { return a }
        if b.lowercased().hasPrefix(a.lowercased()) { return b }

        var head = a
        // Una coma colgada al final del fragmento sobra al pegarlo con lo que sigue.
        while let last = head.last, ",;:".contains(last) {
            head.removeLast()
        }
        // La continuación casi nunca empieza en mayúscula de verdad; el STT la pone por
        // ser inicio de audio, no de oración.
        let tail = b.count > 1 && b.first!.isUppercase && !b.hasPrefix("¿") && !b.hasPrefix("¡")
            ? b.prefix(1).lowercased() + b.dropFirst()
            : b
        return "\(head) \(tail)"
    }
}
