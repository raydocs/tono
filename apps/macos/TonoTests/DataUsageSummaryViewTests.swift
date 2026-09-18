import XCTest
@testable import Tono

final class DataUsageSummaryViewTests: XCTestCase {
    func testPeriodUsageTotalCalculation() {
        let usage = DataUsageSummaryView.PeriodUsage(upload: 1_000, download: 4_000)
        XCTAssertEqual(usage.upload, 1_000)
        XCTAssertEqual(usage.download, 4_000)
        XCTAssertEqual(usage.total, 5_000)
    }

    func testPeriodUsageNegativeClamping() {
        let usage = DataUsageSummaryView.PeriodUsage(upload: -100, download: -500)
        XCTAssertEqual(usage.upload, 0)
        XCTAssertEqual(usage.download, 0)
        XCTAssertEqual(usage.total, 0)
    }

    func testByteCountFormatterUnits() {
        XCTAssertEqual(DataUsageSummaryView.formatBytes(0), "0 bytes")
        XCTAssertEqual(DataUsageSummaryView.formatBytes(500), "500 bytes")
        XCTAssertEqual(DataUsageSummaryView.formatBytes(1_000), "1 KB")
        XCTAssertEqual(DataUsageSummaryView.formatBytes(1_500_000), "1.5 MB")
        XCTAssertEqual(DataUsageSummaryView.formatBytes(2_500_000_000), "2.5 GB")
        XCTAssertEqual(DataUsageSummaryView.formatBytes(3_000_000_000_000), "3 TB")
    }

    func testConvenienceInitializer() {
        let view = DataUsageSummaryView(
            todayUpload: 100,
            todayDownload: 200,
            monthUpload: 300,
            monthDownload: 400
        )
        XCTAssertEqual(view.today.upload, 100)
        XCTAssertEqual(view.today.download, 200)
        XCTAssertEqual(view.today.total, 300)
        XCTAssertEqual(view.month.upload, 300)
        XCTAssertEqual(view.month.download, 400)
        XCTAssertEqual(view.month.total, 700)
    }
}
