import SwiftUI

enum AppPage: String, CaseIterable, Identifiable {
    case dashboard = "Dashboard"
    case proxies   = "Nodes"
    case rules     = "Rules"
    case activity  = "Activity"
    case logs      = "Logs"
    case support   = "Support"
    case settings  = "Settings"

    var id: String { rawValue }

    var displayName: LocalizedStringKey {
        LocalizedStringKey(rawValue)
    }

    var icon: String {
        switch self {
        case .dashboard: return "house"
        case .proxies:   return "globe"
        case .rules:     return "list.bullet"
        case .activity:  return "arrow.up.arrow.down"
        case .logs:      return "doc.text"
        case .support:   return "lifepreserver"
        case .settings:  return "gearshape"
        }
    }

    var iconColor: Color {
        switch self {
        case .dashboard: return Color(hex: "007AFF")
        case .proxies:   return Color(hex: "32ADE6")
        case .rules:     return Color(hex: "5856D6")
        case .activity:  return Color(hex: "007AFF")
        case .logs:      return Color(hex: "8E8E93")
        case .support:   return Color(hex: "32ADE6")
        case .settings:  return Color(hex: "8E8E93")
        }
    }
}
