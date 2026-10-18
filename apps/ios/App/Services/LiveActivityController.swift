import ActivityKit
import Foundation
import TonoKit

/// Keeps at most one Tono Live Activity in step with the shared status. Starts it when a session
/// starts (only if the user turned it on and iOS allows Live Activities), updates it with a stale
/// date on every change, ends it when the tunnel is off. A failure stays on the Lock Screen for a
/// few minutes so the user sees why the session ended.
@MainActor
final class LiveActivityController {
    private var lastContent: TonoActivityAttributes.ContentState?

    func sync(_ snapshot: StatusSnapshot, enabled: Bool, preview: Bool = false) {
        guard #available(iOS 16.2, *) else { return }
        let content = TonoActivityAttributes.ContentState(state: snapshot.state.rawValue, exit: snapshot.exit,
                                                          since: snapshot.since, reason: snapshot.reason)
        let running = Activity<TonoActivityAttributes>.activities
        let live = snapshot.state == .connecting || snapshot.state.tunnelUp
        guard enabled, live else {
            lastContent = nil
            let dismissal: ActivityUIDismissalPolicy = snapshot.state == .failed && enabled
                ? .after(Date().addingTimeInterval(5 * 60)) : .immediate
            for activity in running {
                Task { await activity.end(ActivityContent(state: content, staleDate: nil), dismissalPolicy: dismissal) }
            }
            return
        }
        let update = ActivityContent(state: content, staleDate: Date().addingTimeInterval(TonoActivityTiming.staleAfter))
        if let activity = running.first {
            // Re-send even an unchanged state now and then: it moves the stale date forward.
            Task { await activity.update(update) }
        } else if ActivityAuthorizationInfo().areActivitiesEnabled {
            _ = try? Activity.request(attributes: TonoActivityAttributes(preview: preview), content: update, pushType: nil)
        }
        lastContent = content
    }
}
