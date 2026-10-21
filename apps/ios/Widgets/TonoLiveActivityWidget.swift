import ActivityKit
import SwiftUI
import TonoKit
import WidgetKit

/// Lock Screen banner and Dynamic Island for a Tono session. `context.isStale` (the stale date the
/// app sets on each update) turns every presentation into "may be out of date".
struct TonoLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TonoActivityAttributes.self) { context in
            let p = ActivityPresentation(context.state, stale: context.isStale).p
            ActivityLockView(p: p, preview: context.attributes.preview)
                .activityBackgroundTint(TonoColor.night.opacity(0.92))
                .activitySystemActionForegroundColor(TonoColor.textPrimary)
        } dynamicIsland: { context in
            let p = ActivityPresentation(context.state, stale: context.isStale).p
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HorizonGlyph(sunRise: p.sunRise, warn: p.tone == .warn || p.tone == .error, size: 40)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(spacing: 2) {
                        HStack(spacing: 6) {
                            Text(p.title).font(.headline).foregroundStyle(TonoColor.textPrimary)
                            if context.attributes.preview { PreviewTag() }
                        }
                        if let detail = p.detail {
                            Text(detail).font(.subheadline).foregroundStyle(TonoColor.textSecondary).lineLimit(1)
                        }
                        if p.stale {
                            Text(L.t("la_stale")).font(.caption).foregroundStyle(TonoColor.warning).lineLimit(1)
                        }
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let since = p.since {
                        // A counting interval renders as clock digits (47:07) on one line; the
                        // `.timer` style was laid out as "47 minutes" in the island's width cap.
                        Text(timerInterval: since...Date.distantFuture, countsDown: false)
                            .font(.headline.monospacedDigit())
                            .foregroundStyle(TonoColor.textPrimary)
                            .multilineTextAlignment(.trailing)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .frame(maxWidth: 72, alignment: .trailing)
                            .padding(.trailing, 4)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    // The one action, as in the app: stop a running session, or open Tono.
                    if p.action == .disconnect, !context.attributes.preview {
                        Button(intent: SetTunnelIntent(value: false)) {
                            Text(L.t("action_disconnect")).font(.subheadline.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .background(Capsule().strokeBorder(TonoColor.sunMid.opacity(0.6), lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(TonoColor.textPrimary)
                    } else {
                        Link(destination: URL(string: "tono://home")!) {
                            Text(p.action == .disconnect ? L.t("action_disconnect") : L.t("widget_open"))
                                .font(.subheadline.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .background(Capsule().strokeBorder(TonoColor.sunMid.opacity(0.6), lineWidth: 1))
                                .foregroundStyle(TonoColor.textPrimary)
                        }
                    }
                }
            } compactLeading: {
                MarkGlyph(size: 22, label: p.title)
                    .foregroundStyle(TonoColor.sunMid)
            } compactTrailing: {
                if let since = p.since {
                    Text(timerInterval: since...Date.distantFuture, countsDown: false)
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(maxWidth: 52)
                        .foregroundStyle(TonoColor.textPrimary)
                } else {
                    Text(p.stale ? "?" : p.title)
                        .font(.caption2.weight(.semibold))
                        .lineLimit(1)
                        .frame(maxWidth: 64)
                        .foregroundStyle(p.tint)
                }
            } minimal: {
                MarkGlyph(size: 20, label: p.title)
                    .foregroundStyle(TonoColor.sunMid)
            }
            .widgetURL(URL(string: "tono://home"))
            .keylineTint(TonoColor.sunMid)
        }
    }
}
