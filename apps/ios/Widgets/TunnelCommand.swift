import Foundation
import TonoKit

/// The widget extension never switches the tunnel itself: `SetTunnelIntent` is a Live Activity
/// intent, which iOS performs in the app's process. If iOS ever ran it here, refuse and send the
/// user to the app rather than touch Network Extension from a process without the session.
enum TunnelCommand {
    static func set(on: Bool) async throws {
        throw TunnelCommandError(refusal: .needsApp)
    }
}
