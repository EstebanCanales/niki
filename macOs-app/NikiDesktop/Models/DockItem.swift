import Foundation

enum DockItem: String, CaseIterable, Identifiable {
    case chat
    case tasks
    case widgets
    case voice
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .chat: return "Chat"
        case .tasks: return "Tasks"
        case .widgets: return "Widgets"
        case .voice: return "Voice"
        case .settings: return "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .chat: return "message"
        case .tasks: return "checklist"
        case .widgets: return "square.grid.2x2"
        case .voice: return "waveform"
        case .settings: return "gearshape.2"
        }
    }
}
