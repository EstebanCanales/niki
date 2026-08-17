import Foundation

enum DockItem: String, CaseIterable, Identifiable {
    case chat
    case computer
    case approvals
    case sessions
    case mcp
    case provider    // Con qué modelo/proveedor piensa Niki
    case diagnostics
    case consola     // Consola de debug: qué hace Niki por dentro
    case terminal    // La misma terminal que usa la IA
    case discover
    case call        // Voz: inicia/detiene la conversación con Niki
    case mic         // Selector de micrófonos
    case sttLab      // Panel detallado de STT (oculto salvo que se active en Settings)
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .chat: return "Chat"
        case .computer: return "Computer"
        case .approvals: return "Approvals"
        case .sessions: return "Sessions"
        case .mcp: return "MCP"
        case .provider: return "Modelo"
        case .diagnostics: return "Diagnostics"
        case .consola: return "Consola"
        case .terminal: return "Terminal"
        case .discover: return "Discover"
        case .call: return "Voz"
        case .mic: return "Micrófono"
        case .sttLab: return "STT Lab"
        case .settings: return "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .chat: return "message"
        case .computer: return "desktopcomputer"
        case .approvals: return "checklist"
        case .sessions: return "rectangle.stack"
        case .mcp: return "shippingbox"
        case .provider: return "brain"
        case .diagnostics: return "stethoscope"
        case .consola: return "list.bullet.rectangle"
        case .terminal: return "terminal"
        case .discover: return "sparkles"
        case .call: return "waveform"
        case .mic: return "mic.fill"
        case .sttLab: return "waveform.badge.magnifyingglass"
        case .settings: return "gearshape.2"
        }
    }
}
