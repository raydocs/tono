import XCTest
@testable import Tono

final class ExitHealTests: XCTestCase {
    private func candidate(
        _ name: String,
        _ region: String,
        _ transport: ExitHeal.Transport,
        port: UInt16 = 443,
        rtt: UInt64? = nil
    ) -> ExitHeal.Candidate {
        ExitHeal.Candidate(
            name: name,
            region: region,
            server: "203.0.113.10",
            port: port,
            sni: "www.example.com",
            transport: transport,
            udpVendorBlocked: false,
            rttMs: rtt
        )
    }

    private func pool() -> [ExitHeal.Candidate] {
        [
            candidate("Buffalo · Niagara", "us", .tcp, rtt: 180),
            candidate("Buffalo · Niagara · hy2", "us", .hy2, rtt: 140),
            candidate("Buffalo · Other", "us", .tcp, rtt: 90),
            candidate("Los Angeles · Harbor", "us", .tcp, rtt: 40),
            candidate("Tokyo · Sakura", "jp", .tcp, rtt: 30),
            candidate("Tokyo · Sakura · hy2", "jp", .hy2, rtt: 20),
        ]
    }

    func testFailoverRetriesTheSameNodeBeforeThePool() {
        var session = ExitHeal.Session.forPreferred("Buffalo · Niagara", residentialId: "socks5:198.51.100.8:1080")
        let first = ExitHeal.observe(&session, failure: .tcp, candidates: pool(), stance: .ordinary, nowMs: 0)
        XCTAssertEqual(
            first,
            .dialBeforeArm(name: "Buffalo · Niagara · hy2", change: .transport, dialerChanged: false)
        )
        let second = ExitHeal.observe(&session, failure: .quicHandshake, candidates: pool(), stance: .ordinary, nowMs: 0)
        XCTAssertEqual(
            second,
            .dialBeforeArm(name: "Los Angeles · Harbor", change: .sameRegion, dialerChanged: true)
        )
        XCTAssertEqual(session.residentialId, "socks5:198.51.100.8:1080")
    }

    func testStickinessKeepsTheConfiguredServer() {
        var session = ExitHeal.Session.forPreferred("Buffalo · Niagara", residentialId: "none")
        session.dial = "Buffalo · Other"
        session.backupSinceMs = 0
        let effect = ExitHeal.observe(&session, failure: nil, candidates: pool(), stance: .ordinary, nowMs: 1_000)
        XCTAssertEqual(effect, .untouched)
        XCTAssertEqual(session.preferred, "Buffalo · Niagara")
        XCTAssertEqual(session.dial, "Buffalo · Other")
    }

    func testHysteresisHoldsUntilBothWindowsElapse() {
        var session = ExitHeal.Session.forPreferred("Buffalo · Niagara", residentialId: "none")
        session.dial = "Buffalo · Other"
        session.backupSinceMs = 0
        ExitHeal.noteHealth(&session, name: "Buffalo · Niagara", ok: true, nowMs: 0)
        let early = ExitHeal.observe(
            &session,
            failure: nil,
            candidates: pool(),
            stance: .ordinary,
            nowMs: ExitHeal.hysteresisMs - 1
        )
        XCTAssertEqual(early, .untouched)
        let ready = ExitHeal.observe(
            &session,
            failure: nil,
            candidates: pool(),
            stance: .ordinary,
            nowMs: ExitHeal.hysteresisMs
        )
        XCTAssertEqual(ready, .dialBeforeArm(name: "Buffalo · Niagara", change: .returnPreferred, dialerChanged: false))
    }

    func testArmedOrdinaryFailureFailsOpenWithoutDialingUnderTheBarrier() {
        var session = ExitHeal.Session.forPreferred("Buffalo · Niagara", residentialId: "socks5:198.51.100.8:1080")
        session.protectionArmed = true
        let effect = ExitHeal.observe(&session, failure: .tls, candidates: pool(), stance: .ordinary, nowMs: 0)
        XCTAssertEqual(effect, .failOpen(remember: "Buffalo · Niagara · hy2", dialerChanged: false))
        XCTAssertEqual(session.dial, "Buffalo · Niagara")
        ExitHeal.noteProtection(&session, armedAndVerified: false, nowMs: 10)
        XCTAssertEqual(session.dial, "Buffalo · Niagara · hy2")
        XCTAssertFalse(session.protectionArmed)
    }

    func testArmedStrictFailureHoldsTheSameNode() {
        var session = ExitHeal.Session.forPreferred("Buffalo · Niagara", residentialId: "none")
        session.protectionArmed = true
        let effect = ExitHeal.observe(&session, failure: .tcp, candidates: pool(), stance: .strict, nowMs: 0)
        XCTAssertEqual(effect, .holdClosed)
        XCTAssertEqual(session.dial, "Buffalo · Niagara")
    }

    func testDeadTcpBudgetAndTokyoHy2() {
        XCTAssertEqual(ExitHeal.tcpFailFastMs, 2_500)
        XCTAssertTrue(ExitHeal.udpVendorBlocked("Tokyo · Sakura · hy2"))
        var session = ExitHeal.Session.forPreferred("Tokyo · Sakura", residentialId: "socks5:198.51.100.8:1080")
        let effect = ExitHeal.observe(&session, failure: .tcp, candidates: pool(), stance: .ordinary, nowMs: 0)
        XCTAssertEqual(effect, .untouched)
        XCTAssertEqual(session.residentialId, "socks5:198.51.100.8:1080")
    }
}
