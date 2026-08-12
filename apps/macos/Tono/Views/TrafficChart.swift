import Charts
import SwiftUI

struct TrafficSample: Identifiable {
    let id: Int
    let up: Int64
    let down: Int64
}

/// Rolling throughput history owned by the view layer. AppState publishes only
/// the latest sample, and a chart needs a series, so the window is kept here
/// rather than adding another stored property to AppState.
@Observable
final class TrafficHistory {
    private(set) var samples: [TrafficSample] = []
    private var sequence = 0
    private let capacity: Int

    init(capacity: Int = 60) {
        self.capacity = capacity
        samples.reserveCapacity(capacity + 1)
    }

    var peak: Int64 {
        samples.reduce(0) { max($0, max($1.up, $1.down)) }
    }

    func record(up: Int64, down: Int64) {
        sequence += 1
        samples.append(TrafficSample(id: sequence, up: up, down: down))
        if samples.count > capacity {
            samples.removeFirst(samples.count - capacity)
        }
    }
}

struct TrafficSparkline: View {
    let history: TrafficHistory
    let isLive: Bool

    private static let uploadColor = Color(hex: "64D2FF")
    private static let downloadColor = Color(hex: "2ED573")

    var body: some View {
        Chart {
            ForEach(history.samples) { sample in
                AreaMark(
                    x: .value("Sample", sample.id),
                    y: .value("Bytes per second", sample.down),
                    series: .value("Direction", "down")
                )
                .foregroundStyle(
                    .linearGradient(
                        colors: [
                            Self.downloadColor.opacity(0.28),
                            Self.downloadColor.opacity(0.02),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .interpolationMethod(.monotone)

                LineMark(
                    x: .value("Sample", sample.id),
                    y: .value("Bytes per second", sample.down),
                    series: .value("Direction", "down")
                )
                .foregroundStyle(Self.downloadColor)
                .lineStyle(StrokeStyle(lineWidth: 1.4))
                .interpolationMethod(.monotone)

                LineMark(
                    x: .value("Sample", sample.id),
                    y: .value("Bytes per second", sample.up),
                    series: .value("Direction", "up")
                )
                .foregroundStyle(Self.uploadColor)
                .lineStyle(StrokeStyle(lineWidth: 1.2, dash: [2.5, 2]))
                .interpolationMethod(.monotone)
            }
        }
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .chartLegend(.hidden)
        .chartYScale(domain: 0...yUpperBound)
        .chartPlotStyle { plot in
            plot.background(.clear)
        }
        .frame(width: 116, height: 26)
        .opacity(isLive ? 1 : 0.45)
        .overlay {
            if history.samples.count < 2 {
                Rectangle()
                    .fill(.secondary.opacity(0.22))
                    .frame(height: 1)
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Throughput over the last minute")
        .accessibilityValue(accessibilityValue)
    }

    /// Headroom keeps a busy series off the top edge, and the floor stops idle
    /// noise from being amplified into a dramatic-looking spike.
    private var yUpperBound: Double {
        let floor: Double = 64 * 1024
        return max(floor, Double(history.peak) * 1.25)
    }

    private var accessibilityValue: Text {
        guard let latest = history.samples.last else {
            return Text("No samples yet")
        }
        return Text(
            "Download \(formatted(latest.down)), upload \(formatted(latest.up))"
        )
    }

    private func formatted(_ bytesPerSecond: Int64) -> String {
        Self.rateFormatter.string(fromByteCount: bytesPerSecond) + "/s"
    }

    private static let rateFormatter: ByteCountFormatter = {
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useKB, .useMB, .useGB]
        formatter.countStyle = .binary
        formatter.allowsNonnumericFormatting = false
        return formatter
    }()
}
