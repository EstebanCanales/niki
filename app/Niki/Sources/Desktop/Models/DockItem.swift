import Foundation

enum DockItem: String, CaseIterable, Identifiable {
    case chat
    case auto
    case call
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .chat: return "Chat"
        case .auto: return "Auto Mode"
        case .call: return "Call Mode"
        case .settings: return "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .chat: return "message"
        case .auto: return "cpu"
        case .call: return "phone.fill"
        case .settings: return "gearshape.2"
        }
    }
}
