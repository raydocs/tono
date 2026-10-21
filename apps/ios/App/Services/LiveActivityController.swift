import ActivityKit
import Foundation
import TonoKit

/// Keeps at most one Tono Live Activity in step with the shared reading. Starts it when a session
/// starts (only if the user turned it on and iOS allows Live Activities), updates it on every
/// change, ends it when the tunnel is off or nothing is known. Its stale date is when the reading
/// stops counting (the tunnel's last report for a running tunnel), never "now + 15 minutes" from an
/// app update. A failure stays on the Lock Screen for a few minutes so the user sees why the
/// session ended.
@MainActor
final class LiveActivityController {
    func sync(_ reading: StatusReading, enabled: Bool, preview: Bool = false) {
        guard #available(iOS 16.2, *) else { return }
        let running = Activity<TonoActivityAttributes>.activities
        guard let snapshot = reading.snapshot else {
            // Nothing reported: no activity keeps a claim on the Lock Screen.
            for activity in running { Task { await activity.end(nil, dismissalPolicy: .immediate) } }
            return
        }
        let content = TonoActivityAttributes.ContentState(state: snapshot.state.rawValue, exit: snapshot.exit,
                                                          since: snapshot.since, reason: snapshot.reason)
        let live = snapshot.state == .connecting || snapshot.state.tunnelUp
        guard enabled, live else {
            let dismissal: ActivityUIDismissalPolicy = snapshot.state == .failed && enabled
                ? .after(Date().addingTimeInterval(5 * 60)) : .immediate
            for activity in running {
                Task { await activity.end(ActivityContent(state: content, staleDate: nil), dismissalPolicy: dismissal) }
            }
            return
        }
        // Already past for a stale reading: the views then say "may be out of date".
        let update = ActivityContent(state: content, staleDate: StatusReading.staleAt(snapshot))
        if let activity = running.first {
            Task { await activity.update(update) }
        } else if case .fresh = reading, ActivityAuthorizationInfo().areActivitiesEnabled {
            _ = try? Activity.request(attributes: TonoActivityAttributes(preview: preview), content: update, pushType: nil)
        }
    }
}
