import XCTest
@testable import TonoKit

/// The app's question to the tunnel ends at its timeout even when Network Extension never calls
/// the response handler; the first of reply and timer is delivered, once. The timer is fired by
/// hand: no waiting.
final class ProviderReplyTests: XCTestCase {
    private final class Exchange: @unchecked Sendable {
        var delay: TimeInterval?
        var fire: (@Sendable () -> Void)?
        var reply: (@Sendable (Data?) -> Void)?
        var delivered: [Data?] = []

        func ask() {
            ProviderReply.ask(timeout: 5, schedule: { delay, work in self.delay = delay; self.fire = work },
                              send: { self.reply = $0 }, done: { self.delivered.append($0) })
        }
    }

    func testATunnelThatNeverRepliesIsNoAnswerWhenTheTimerFiresAndALateReplyIsDropped() throws {
        let exchange = Exchange()
        exchange.ask()
        XCTAssertEqual(exchange.delay, 5)
        XCTAssertTrue(exchange.delivered.isEmpty)
        try XCTUnwrap(exchange.fire)()
        XCTAssertEqual(exchange.delivered, [nil])
        try XCTUnwrap(exchange.reply)(Data("late".utf8))
        XCTAssertEqual(exchange.delivered, [nil])
    }

    func testAReplyBeforeTheTimerIsDeliveredOnceAndTheTimerThenDoesNothing() throws {
        let exchange = Exchange()
        exchange.ask()
        try XCTUnwrap(exchange.reply)(Data("ok".utf8))
        try XCTUnwrap(exchange.fire)()
        XCTAssertEqual(exchange.delivered, [Data("ok".utf8)])
    }
}
