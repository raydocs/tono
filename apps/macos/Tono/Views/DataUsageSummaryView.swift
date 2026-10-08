import SwiftUI

/// Upload / download / total for the current connection. The core's counters
/// start at zero on connect and are cleared on disconnect, so there is no
/// honest "today" or "this month" to show here.
public struct DataUsageSummaryView: View {
    @Environment(\.colorScheme) private var colorScheme

    public struct PeriodUsage: Equatable, Sendable {
        public var upload: Int64
        public var download: Int64
        public var total: Int64 { upload + download }

        public init(upload: Int64 = 0, download: Int64 = 0) {
            self.upload = max(0, upload)
            self.download = max(0, download)
        }
    }

    public let session: PeriodUsage
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
        session: PeriodUsage = PeriodUsage(),
        title: LocalizedStringKey? = "This connection",
        isCard: Bool = true
    ) {
        self.session = session
        self.title = title
        self.isCard = isCard
    }

    public init(
        upload: Int64,
        download: Int64,
        title: LocalizedStringKey? = "This connection",
        isCard: Bool = true
    ) {
        self.init(session: PeriodUsage(upload: upload, download: download), title: title, isCard: isCard)
    }

    init(
        appState: AppState,
        title: LocalizedStringKey? = "This connection",
        isCard: Bool = true
    ) {
        self.init(
            upload: appState.trafficStats.totalUpload,
            download: appState.trafficStats.totalDownload,
            title: title,
            isCard: isCard
        )
    }

    public var body: some View {
        let content = VStack(alignment: .leading, spacing: 10) {
            if let title {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.primary)
            }

            gridLayout

            Text("Resets when you disconnect.")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
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
                HStack(spacing: 6) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(TonoTraffic.upload)
                    Text("Upload")
                        .font(.system(size: 12, weight: .medium))
                }

                Text(Self.formatBytes(session.upload))
                    .font(.system(size: 12, weight: .regular)).monospacedDigit()
                    .foregroundStyle(.primary)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }

            GridRow {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.down")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(TonoTraffic.download)
                    Text("Download")
                        .font(.system(size: 12, weight: .medium))
                }

                Text(Self.formatBytes(session.download))
                    .font(.system(size: 12, weight: .regular)).monospacedDigit()
                    .foregroundStyle(.primary)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }

            Divider()
                .gridCellColumns(2)

            GridRow {
                HStack(spacing: 6) {
                    Image(systemName: "sum")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(TonoBrand.accent)
                    Text("Total")
                        .font(.system(size: 12, weight: .semibold))
                }

                Text(Self.formatBytes(session.total))
                    .font(.system(size: 12, weight: .semibold)).monospacedDigit()
                    .foregroundStyle(TonoBrand.accent)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }
}

#Preview {
    DataUsageSummaryView(upload: 125_000_000, download: 1_420_000_000)
        .padding()
        .frame(width: 320)
}
