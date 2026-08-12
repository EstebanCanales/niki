import Foundation

enum NikiModuleAvailabilityState: String, Codable {
    case hidden
    case disabled
    case flagged
    case beta
    case ready
}

struct NikiModuleAvailability: Codable {
    let state: NikiModuleAvailabilityState
    let reason: String?
}

struct NikiCapabilityAvailability: Codable {
    let available: Bool
    let enabled: Bool
    let requiresSetup: Bool
}

struct NikiOperatorCapabilities: Codable {
    let modules: [String: NikiModuleAvailability]
    let capabilities: [String: NikiCapabilityAvailability]
}
