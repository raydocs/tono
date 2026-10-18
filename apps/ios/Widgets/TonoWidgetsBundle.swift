import SwiftUI
import WidgetKit

/// Tono's widget extension: the status widget (Home Screen + Lock Screen), the Live Activity
/// (Lock Screen + Dynamic Island) and, on iOS 18, the Control Center switch. All of them read
/// `StatusStore` (App Group) and switch only through `SetTunnelIntent`, performed in the app.
@main
struct TonoWidgetsBundle: WidgetBundle {
    var body: some Widget {
        StatusWidget()
        TonoLiveActivityWidget()
        if #available(iOS 18.0, *) {
            TunnelControl()
        }
    }
}
