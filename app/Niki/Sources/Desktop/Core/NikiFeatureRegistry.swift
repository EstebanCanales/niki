import Foundation

enum NikiModuleID: String, CaseIterable, Codable {
    case chat
    case computer
    case approvals
    case sessions
    case mcp
    case provider
    case discover
    case diagnostics
    case settings
}

struct NikiFeatureRegistry {
    static let alwaysVisibleModules: Set<NikiModuleID> = [.chat, .settings]
}
