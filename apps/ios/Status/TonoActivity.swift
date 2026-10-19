#if canImport(ActivityKit)
import ActivityKit
import Foundation

/// Live Activity (Lock Screen + Dynamic Island) for a Tono session. The app starts it when the
/// tunnel starts (only when the user turned it on in Settings), updates it on every state change,
/// and ends it when the tunnel stops. Content and stale date come from the shared reading
/// (`SharedStatus.reading`), so the stale date is when the tunnel's own last report stops counting;
/// an app update never moves it. When the tunnel dropped while the app was suspended, the stale
/// date passes and the views say "may be out of date" instead of keeping a false "connected".
@available(iOS 16.1, *)
struct TonoActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// `StatusSnapshot.State` raw value.
        var state: String
        var exit: String?
        var since: Date?
        var reason: String?
    }

    /// True only for the DEBUG design preview: every view then carries a "Preview" tag, so a
    /// fixture can never pass for the real tunnel state.
    var preview: Bool
}
#endif
