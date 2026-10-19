import Foundation
import TonoKit
enum L { static func t(_ k: String, _ a: CVarArg...) -> String { k }; static var isChinese = false }
enum ModeText { static func name(_ m: RoutingMode) -> String { "" }; static func line(_ m: RoutingMode) -> String { "" } }
enum UIAccessibility { struct Notification { static let announcement = Notification() }; static func post(notification: Notification, argument: Any?) {} }
@MainActor final class LiveActivityController { init() {}; func update(_ a: Any...) {}; func end() {}; func sync(_ a: Any...) {}; func sync(_ a: Any?, enabled: Bool, preview: Bool = false, force: Bool = false) {} }
