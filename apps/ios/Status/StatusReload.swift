import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

/// Asks WidgetKit to re-read the shared status after a write (widgets, Lock Screen accessories and
/// the Control Center control). Cheap and rate-limited by the system.
enum StatusReload {
    static let widgetKind = "TonoStatus"
    static let controlKind = "com.raydocs.tono.ios.control.tunnel"

    static func all() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
        if #available(iOS 18.0, *) {
            ControlCenter.shared.reloadControls(ofKind: controlKind)
        }
        #endif
    }
}
