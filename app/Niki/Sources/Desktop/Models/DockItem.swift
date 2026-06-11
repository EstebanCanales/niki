import Foundation

enum DockItem: String, CaseIterable, Identifiable {
    case chat
    case widgets
    case voice
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .chat: return "Chat"
        case .widgets: return "Widgets"
        case .voice: return "Voz"
        case .settings: return "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .chat: return "message"
        case .widgets: return "square.grid.2x2"
        case .voice: return "waveform"
        case .settings: return "gearshape.2"
        }
    }
}
