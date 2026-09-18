import SwiftUI

/// Clean, compact Today vs. This Month upload/download/total data usage grid view.
public struct DataUsageSummaryView: View {
    @Environment(\.colorScheme) private var colorScheme

    /// Data usage metrics for a specific time period.
    public struct PeriodUsage: Equatable, Sendable {
        public var upload: Int64
        public var download: Int64
        public var total: Int64 { upload + download }

        public init(upload: Int64 = 0, download: Int64 = 0) {
            self.upload = max(0, upload)
            self.download = max(0, download)
        }
    }

    public let today: PeriodUsage
    public let month: PeriodUsage
    public var title: LocalizedStringKey?
    public var isCard: Bool

    /// Standard adaptive decimal ByteCountFormatter supporting KB, MB, GB, and TB.
    public static let byteFormatter: ByteCountFormatter = {
        let formatter = ByteCountFormatter()
        formatter.allowedUnits = [.useBytes, .useKB, .useMB, .useGB, .useTB]
        formatter.countStyle = .decimal
        formatter.isAdaptive = true
        formatter.allowsNonnumericFormatting = false
        return formatter
    }()

    /// Format byte count into an adaptive decimal string representation.
    public static func formatBytes(_ bytes: Int64) -> String {
        byteFormatter.string(fromByteCount: max(0, bytes))
    }

    public init(
        today: PeriodUsage = PeriodUsage(),
        month: PeriodUsage = PeriodUsage(),
        title: LocalizedStringKey? = "DATA USAGE",
        isCard: Bool = true
    ) {
        self.today = today
        self.month = month
        self.title = title
        self.isCard = isCard
    }

    public init(
        todayUpload: Int64,
        todayDownload: Int64,
        monthUpload: Int64,
        monthDownload: Int64,
        title: LocalizedStringKey? = "DATA USAGE",
        isCard: Bool = true
    ) {
        self.today = PeriodUsage(upload: todayUpload, download: todayDownload)
        self.month = PeriodUsage(upload: monthUpload, download: monthDownload)
        self.title = title
        self.isCard = isCard
    }

    public init(
        appState: AppState,
        title: LocalizedStringKey? = "DATA USAGE",
        isCard: Bool = true
    ) {
        let todayUp = appState.trafficStats.totalUpload
        let todayDown = appState.trafficStats.totalDownload
        let ledgerTotal = appState.appTrafficLedger.overall.total
        let monthUp = max(todayUp, ledgerTotal > 0 ? ledgerTotal : todayUp)
        let monthDown = max(todayDown, appState.trafficStats.totalDownload)
        self.today = PeriodUsage(upload: todayUp, download: todayDown)
        self.month = PeriodUsage(upload: monthUp, download: monthDown)
        self.title = title
        self.isCard = isCard
    }

    public var body: some View {
        let content = VStack(alignment: .leading, spacing: 10) {
            if let title {
                Text(title)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .kerning(0.6)
                    .textCase(.uppercase)
            }

            gridLayout
        }

        if isCard {
            content
                .padding(14)
                .background(
                    .white.opacity(colorScheme == .dark ? 0.06 : 0.62),
                    in: RoundedRectangle(cornerRadius: 14)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 14).strokeBorder(
                        .white.opacity(colorScheme == .dark ? 0.10 : 0.75),
                        lineWidth: 0.5
                    )
                )
        } else {
            content
        }
    }

    private var gridLayout: some View {
        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 9) {
            GridRow {
                Text("DIRECTION")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .kerning(0.5)
                    .textCase(.uppercase)

                Text("TODAY")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .kerning(0.5)
                    .textCase(.uppercase)
                    .gridColumnAlignment(.trailing)

                Text("THIS MONTH")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .kerning(0.5)
                    .textCase(.uppercase)
                    .gridColumnAlignment(.trailing)
            }

            Divider()
                .gridCellColumns(3)

            GridRow {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(TonoTraffic.upload)
                    Text("Upload")
                        .font(.system(size: 12, weight: .medium))
                }

                Text(Self.formatBytes(today.upload))
                    .font(.system(size: 12, weight: .regular, design: .monospaced))
                    .foregroundStyle(.primary)

                Text(Self.formatBytes(month.upload))
                    .font(.system(size: 12, weight: .regular, design: .monospaced))
                    .foregroundStyle(.primary)
            }

            GridRow {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.down")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(TonoTraffic.download)
                    Text("Download")
                        .font(.system(size: 12, weight: .medium))
                }

                Text(Self.formatBytes(today.download))
                    .font(.system(size: 12, weight: .regular, design: .monospaced))
                    .foregroundStyle(.primary)

                Text(Self.formatBytes(month.download))
                    .font(.system(size: 12, weight: .regular, design: .monospaced))
                    .foregroundStyle(.primary)
            }

            Divider()
                .gridCellColumns(3)

            GridRow {
                HStack(spacing: 6) {
                    Image(systemName: "sum")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(TonoBrand.accent)
                    Text("Total")
                        .font(.system(size: 12, weight: .semibold))
                }

                Text(Self.formatBytes(today.total))
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundStyle(TonoBrand.accent)

                Text(Self.formatBytes(month.total))
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundStyle(TonoBrand.accent)
            }
        }
    }
}

#Preview {
    DataUsageSummaryView(
        todayUpload: 125_000_000,
        todayDownload: 1_420_000_000,
        monthUpload: 3_500_000_000,
        monthDownload: 42_800_000_000
    )
    .padding()
    .frame(width: 360)
}
