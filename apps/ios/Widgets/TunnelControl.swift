import AppIntents
import SwiftUI
import TonoKit
import WidgetKit

/// Control Center / Lock Screen / Action button switch (iOS 18). The value comes from the shared
/// snapshot: only a fresh reading shows "on"; a stale or missing one shows off with its own label,
/// so the switch never claims a tunnel it cannot vouch for. Toggling runs `SetTunnelIntent`.
@available(iOS 18.0, *)
struct TunnelControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: StatusReload.controlKind, provider: Provider()) { value in
            ControlWidgetToggle(value.label, isOn: value.isOn, action: SetTunnelIntent()) { isOn in
                // The desktop state glyphs as custom symbols: filled sun = on, open arch = no claim.
                Label(isOn ? L.t("widget_on_short") : value.offLabel, image: isOn ? "tono.sun.on" : "tono.sun.off")
            }
            .tint(TonoColor.sunMid)
        }
        .displayName(LocalizedStringResource("control_name"))
        .description(LocalizedStringResource("control_desc"))
    }

    struct Value {
        var isOn: Bool
        var label: String
        var offLabel: String
    }

    struct Provider: ControlValueProvider {
        var previewValue: Value { Value(isOn: false, label: "Tono", offLabel: L.t("widget_off_short")) }

        func currentValue() async throws -> Value {
            let reading = StatusStore.reading()
            switch reading {
            case .unavailable:
                return Value(isOn: false, label: "Tono", offLabel: L.t("widget_unknown_short"))
            case .stale:
                return Value(isOn: false, label: "Tono", offLabel: L.t("widget_unknown_short"))
            case .fresh(let s):
                // "Routes stopped" while the tunnel runs without a graph; turning it on asks for a rebuild.
                // Up but not confirmed by the tunnel: neither on nor off.
                let off = s.state == .failed ? L.t(StatusWording.titleKey(s.state, reason: s.reason))
                    : s.reason == "UNCONFIRMED" ? L.t("widget_unknown_short") : L.t("widget_off_short")
                return Value(isOn: StatusWording(reading).switchOn, label: "Tono", offLabel: off)
            }
        }
    }
}
