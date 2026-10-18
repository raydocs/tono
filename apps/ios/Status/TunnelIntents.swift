#if canImport(AppIntents)
import AppIntents
import Foundation
import TonoKit

/// The one command widgets, the Live Activity and the Control Center control can send: switch the
/// tunnel Tono already configured on or off. As a `LiveActivityIntent` it runs in the app's process
/// (where Network Extension and the Keychain session are), never in the widget extension, and
/// `TunnelCommandGate` refuses a start without an account, the VPN permission or admitted inputs.
@available(iOS 17.0, *)
struct SetTunnelIntent: SetValueIntent, LiveActivityIntent {
    static var title: LocalizedStringResource = "intent_toggle_title"
    static var description = IntentDescription("intent_toggle_desc")
    /// Not offered in Shortcuts or Spotlight: the surface stays the widget, Live Activity and control.
    static var isDiscoverable: Bool = false

    @Parameter(title: "intent_toggle_value")
    var value: Bool

    init() {}

    init(value: Bool) {
        self.value = value
    }

    func perform() async throws -> some IntentResult {
        try await TunnelCommand.set(on: value)
        return .result()
    }
}

/// Why an outside start was refused, in words for Control Center / the widget.
struct TunnelCommandError: Error, CustomLocalizedStringResourceConvertible {
    let refusal: TunnelCommandGate.Refusal

    var localizedStringResource: LocalizedStringResource {
        switch refusal {
        case .signedOut: return "cmd_signed_out"
        case .needsPermission: return "cmd_needs_permission"
        case .needsApp: return "cmd_needs_app"
        }
    }
}
#endif
