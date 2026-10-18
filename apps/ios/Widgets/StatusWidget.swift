import SwiftUI
import TonoKit
import WidgetKit

struct StatusEntry: TimelineEntry {
    let date: Date
    let reading: StatusReading
}

/// Reads the shared snapshot. The timeline carries the moment the reading turns stale, so the
/// widget changes to "last known" on time even if nothing reloads it.
struct StatusProvider: TimelineProvider {
    func placeholder(in context: Context) -> StatusEntry {
        StatusEntry(date: Date(), reading: .unavailable)
    }

    func getSnapshot(in context: Context, completion: @escaping (StatusEntry) -> Void) {
        completion(StatusEntry(date: Date(), reading: StatusStore.reading()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StatusEntry>) -> Void) {
        let now = Date()
        let snapshot = StatusStore.load()
        var entries = [StatusEntry(date: now, reading: StatusReading.read(snapshot, now: now))]
        if let snapshot, case .fresh = StatusReading.read(snapshot, now: now) {
            let staleAt = StatusReading.staleAt(snapshot).addingTimeInterval(1)
            entries.append(StatusEntry(date: staleAt, reading: StatusReading.read(snapshot, now: staleAt)))
        }
        // The app and the tunnel reload on every change; this is only the fallback refresh.
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(StatusSnapshot.freshFor))))
    }
}

struct StatusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: StatusReload.widgetKind, provider: StatusProvider()) { entry in
            let p = StatusPresentation(entry.reading)
            StatusWidgetEntryView(p: p)
                .widgetURL(URL(string: "tono://home"))
                .containerBackground(for: .widget) { WidgetSky(sunRise: p.sunRise) }
        }
        .configurationDisplayName(Text(L.t("widget_name")))
        .description(Text(L.t("widget_desc")))
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

/// `StatusWidgetView` takes the family explicitly (so the app's gallery can render each one);
/// in the extension it comes from the environment.
struct StatusWidgetEntryView: View {
    @Environment(\.widgetFamily) private var family
    let p: StatusPresentation

    var body: some View { StatusWidgetView(p: p, family: family) }
}
