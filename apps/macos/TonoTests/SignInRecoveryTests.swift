import XCTest
@testable import Tono

nonisolated private final class RelayAnswers: @unchecked Sendable {
    private let lock = NSLock()
    private var answering = false
    private var calls = 0
    func answer() { lock.lock(); answering = true; lock.unlock() }
    var count: Int { lock.lock(); defer { lock.unlock() }; return calls }
    func exchange() throws -> ControlPlaneAnswer {
        lock.lock()
        calls += 1
        let answering = answering
        lock.unlock()
        guard answering else { throw URLError(.cannotConnectToHost) }
        return ControlPlaneAnswer(
            status: 202,
            body: Data(#"{"challengeId":"c-093","expiresIn":600,"message":"sent"}"#.utf8),
            bodyFailure: nil
        )
    }
}

nonisolated private final class DisarmCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var value = 0
    func record() { lock.lock(); value += 1; lock.unlock() }
    var count: Int { lock.lock(); defer { lock.unlock() }; return value }
}

/// Decision 093: the sign-in screen's recovery outcome is the request's own
/// end, bound to the request, and separate from protection.
@MainActor
final class SignInRecoveryTests: XCTestCase {
    private func relayOnlyAccount(_ relay: RelayAnswers, disarms: DisarmCounter) -> (AccountSession, () -> Void) {
        let host = "\(UUID().uuidString.lowercased()).invalid"
        let keychain = KeychainStore(
            service: "app.tono.tests.sign-in-recovery.\(host)",
            suppressionDirectory: FileManager.default.temporaryDirectory
                .appendingPathComponent("tono-credential-suppression-\(host)")
        )
        let grants = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-offline-sign-in-recovery-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: grants, withIntermediateDirectories: true)
        let api = TonoAPIClient(
            baseURL: URL(string: "https://\(host)")!, keychain: keychain,
            offlineGate: OfflineGrantGate(directory: grants),
            pinnedPath: ControlPlanePath(label: "pinned") { _, _ in
                XCTFail("decision 091: no direct path without a tunnel")
                throw URLError(.cannotConnectToHost)
            },
            relayPath: ControlPlanePath(label: "relay") { _, _ in try relay.exchange() },
            relayOnly: { true }
        )
        let account = AccountSession(
            api: api, keychain: keychain, sidecar: TonoSidecarService(),
            descriptorConsumer: { _ in },
            killSwitchDisarmConsumer: { disarms.record() },
            gateProtectionHoldConsumer: { .blocking }
        )
        account.state = .signedOut
        return (account, {
            AppProfile.defaults.removeObject(forKey: TonoAPIClient.preferredPathKey(forHost: host))
            try? keychain.remove(.refreshToken)
            try? FileManager.default.removeItem(at: grants)
        })
    }

    /// Every relay failed on both of the client's attempts: the request ends
    /// with only the user's actions left, as relays-unreachable, and
    /// protection is not touched.
    func testASignInWhoseRelaysAllFailedEndsForTheUserToActAndKeepsProtection() async {
        let relay = RelayAnswers()
        let disarms = DisarmCounter()
        let (account, cleanUp) = relayOnlyAccount(relay, disarms: disarms)
        defer { cleanUp() }

        await account.requestEmailCode(email: "relays@example.test", deviceName: "Test Mac")

        XCTAssertEqual(account.signInRecovery?.phase, .userAction)
        XCTAssertEqual(account.signInRecovery?.cause, .relaysUnreachable)
        XCTAssertEqual(account.signInRecovery?.step, .sendCode)
        XCTAssertGreaterThan(relay.count, 0)
        XCTAssertEqual(disarms.count, 0, "a failed sign-in never turns protection off")
    }

    /// A retry that gets the code sent clears the earlier outcome; waiting
    /// for the email is not a failure.
    func testASuccessfulRetryClearsTheEarlierOutcome() async {
        let relay = RelayAnswers()
        let (account, cleanUp) = relayOnlyAccount(relay, disarms: DisarmCounter())
        defer { cleanUp() }
        await account.requestEmailCode(email: "retry@example.test", deviceName: "Test Mac")
        XCTAssertEqual(account.signInRecovery?.phase, .userAction)

        relay.answer()
        await account.requestEmailCode(email: "retry@example.test", deviceName: "Test Mac")

        XCTAssertNil(account.signInRecovery)
        XCTAssertEqual(account.emailChallenge?.challengeId, "c-093")
    }

    /// The background account runtime failing (the protection side's own
    /// recovery) leaves the sign-in outcome as the request ended it.
    func testARuntimeFailureLeavesTheSignInOutcome() async {
        let relay = RelayAnswers()
        let disarms = DisarmCounter()
        let (account, cleanUp) = relayOnlyAccount(relay, disarms: disarms)
        defer { cleanUp() }
        await account.requestEmailCode(email: "runtime@example.test", deviceName: "Test Mac")
        let ended = account.signInRecovery
        XCTAssertEqual(ended?.phase, .userAction)

        await account.fail(TonoAPIClient.APIError.transport("runtime"))

        XCTAssertEqual(account.signInRecovery, ended)
        XCTAssertEqual(disarms.count, 0)
    }

    /// The end of a request that a newer request or a dismissal (another
    /// email, sign-out) replaced does not land.
    func testAnOlderRequestEndingLateDoesNotLand() {
        var ledger = SignInRecoveryLedger()
        let older = ledger.begin(.sendCode)
        let newer = ledger.begin(.sendCode)
        XCTAssertFalse(ledger.finish(older, cause: .relaysUnreachable))
        XCTAssertEqual(ledger.current?.operation, newer)
        XCTAssertEqual(ledger.current?.phase, .automatic)

        ledger.dismiss()
        XCTAssertFalse(ledger.finish(newer, cause: .relaysUnreachable))
        XCTAssertNil(ledger.current)
    }

    /// A cancelled request is not a recovery failure: it ends with nothing
    /// for the screen to show.
    func testACancelledRequestClearsTheOutcome() {
        var ledger = SignInRecoveryLedger()
        let operation = ledger.begin(.verifyCode)
        XCTAssertTrue(ledger.finish(operation, cause: SignInRecovery.cause(of: CancellationError())))
        XCTAssertNil(ledger.current)
    }
}
