import Foundation
import SwiftUI
import TonoKit

/// What a widget, Lock Screen accessory, Live Activity or the Control Center control says for a
/// `StatusReading`. A fresh reading is stated as now; a stale one only as "last known" with its
/// time and no live timer; no reading says so and offers the app, never a guessed "off".
struct StatusPresentation: Equatable {
    enum Tone: Equatable { case on, warn, error, busy, off, unknown }
    typealias Action = StatusWording.Action

    let title: String
    /// Line in use, or the short reason when something is wrong.
    let detail: String?
    /// Freshness: "As of 10:41", "Last known · 10:41", or how to get a status.
    let footnote: String
    let tone: Tone
    /// Session start, only for a fresh "up" reading (drives a system-rendered timer).
    let since: Date?
    let action: Action
    let stale: Bool
    let isOn: Bool

    init(_ reading: StatusReading) {
        guard let s = reading.snapshot else {
            title = L.t("widget_unavailable_title")
            detail = nil
            footnote = L.t("widget_unavailable")
            tone = .unknown
            since = nil
            action = .openApp
            stale = false
            isOn = false
            return
        }
        let fresh: Bool
        if case .fresh = reading { fresh = true } else { fresh = false }
        // Title key, switch and button come from TonoKit's `StatusWording` (tested with the heartbeat).
        let wording = StatusWording(reading)
        stale = !fresh
        isOn = wording.switchOn
        let time = Self.time(s.updatedAt)
        since = fresh && s.state.tunnelUp ? s.since : nil
        let stateTitle = L.t(StatusWording.titleKey(s.state, reason: s.reason))
        let stateTone: Tone
        switch s.state {
        case .on: stateTone = .on
        case .degraded: stateTone = .warn
        case .connecting: stateTone = .busy
        case .off, .signedOut: stateTone = .off
        case .failed: stateTone = .error
        }
        guard fresh else {
            // An old report is never stated as now: the title says the status is unknown and the
            // last known state moves into the small print with its time (as Android does).
            title = L.t("widget_stale_title")
            tone = .unknown
            detail = nil
            footnote = L.t("widget_last_known", stateTitle, time)
            action = .openApp
            return
        }
        title = stateTitle
        tone = stateTone
        footnote = L.t("widget_as_of", time)
        let reasonText = s.reason.flatMap(Self.short)
        switch s.state {
        case .on, .connecting: detail = reasonText ?? s.exit
        case .degraded, .failed: detail = reasonText
        case .off, .signedOut: detail = nil
        }
        // Only a fresh, signed-in reading offers a switch; anything else opens the app first. A
        // failure offers Retry (a rebuild when the tunnel is still up, see `TunnelCommand`).
        action = wording.action
    }

    var tint: Color {
        switch tone {
        case .on: return TonoColor.connected
        case .warn: return TonoColor.warning
        case .error: return TonoColor.error
        case .busy: return TonoColor.sunMid
        case .off, .unknown: return TonoColor.neutral
        }
    }

    /// Sun height for the small horizon drawing (0 night … 1 up), the app's sky in miniature.
    var sunRise: Double {
        if stale { return 0.15 }
        switch tone {
        case .on: return 1
        case .warn: return 0.72
        case .busy: return 0.6
        case .error: return 0.28
        case .off, .unknown: return 0
        }
    }

    var actionTitle: String {
        switch action {
        case .connect: return L.t("action_connect")
        case .retry: return L.t("action_retry")
        case .disconnect: return L.t("action_disconnect")
        case .openApp: return L.t("widget_open")
        }
    }

    /// One sentence for VoiceOver: state, line or reason, freshness.
    var accessibilityLabel: String {
        [title, detail, footnote].compactMap { $0 }.joined(separator: ", ")
    }

    static func time(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: L.isChinese ? "zh-Hans" : "en")
        f.dateStyle = Calendar.current.isDateInToday(date) ? .none : .short
        f.timeStyle = .short
        return f.string(from: date)
    }

    static func short(_ code: String) -> String? {
        let key = "short_\(code)"
        let text = L.t(key)
        return text == key ? nil : text
    }
}
