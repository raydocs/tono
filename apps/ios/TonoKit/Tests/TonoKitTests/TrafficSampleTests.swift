import XCTest
@testable import TonoKit

final class TrafficSampleTests: XCTestCase {
    func testTrafficMessageAndSampleRoundTripAndRejectWhatIsNotASample() {
        XCTAssertEqual(TunnelMessage.decode(TunnelMessage.traffic.encoded), .traffic)
        XCTAssertLessThan(TunnelMessage.traffic.replyTimeout, TunnelMessage.status.replyTimeout)
        let sample = TrafficSample(down: 2_340_000, up: 81_000)
        XCTAssertEqual(TrafficSample.decode(sample.encoded), sample)
        // An extension from before this message answers "unknown message"; it must read as no sample.
        XCTAssertNil(TrafficSample.decode(Data("unknown message".utf8)))
        XCTAssertNil(TrafficSample.decode(TrafficSample.unavailable))
        XCTAssertNil(TrafficSample.decode(nil))
        XCTAssertNil(TrafficSample.decode(Data(#"{"down":-1,"up":3}"#.utf8)))
        XCTAssertNil(TrafficSample.decode(Data(#"{"down":1.5,"up":3}"#.utf8)))
        XCTAssertNil(TrafficSample.decode(Data(#"{"down":7}"#.utf8)))
    }

    func testExtensionStatisticsClientExpiresFiveSecondsAfterTheLastAsk() {
        var demand = TrafficDemand()
        XCTAssertTrue(demand.expired(at: 100), "never asked")
        demand.asked(at: 100)
        XCTAssertFalse(demand.expired(at: 104.9))
        XCTAssertTrue(demand.expired(at: 105))
        demand.asked(at: 104)
        XCTAssertFalse(demand.expired(at: 108.9))
    }
}
