import Darwin
import Dispatch
import XCTest
import dnssd
@testable import Tono

@MainActor
final class ProtectedSystemResolverTests: XCTestCase {
    func testSystemDNSDeadlineReturnsWhileSetupIsHeldAndRefusesStackedSetup() async {
        let held = HeldDNSService(holdSetup: true)
        let next = HeldDNSService()
        defer { held.openSetup(); held.releaseContext(); next.releaseContext() }
        let returned = expectation(description: "deadline returns while C setup is still blocked")
        returned.assertForOverFulfill = true
        var result: [String]?
        let started = ContinuousClock.now
        let first = Task {
            result = await ProtectedDNSProbe.querySystemResolver(timeout: 0.2, resolver: held.functions)
            returned.fulfill()
        }
        await fulfillment(of: [held.setupEntered, returned], timeout: 1)
        XCTAssertEqual(result, [])
        XCTAssertEqual(held.setupCalls, 1)
        XCTAssertEqual(held.queueInstallations, 0)
        XCTAssertEqual(held.deallocations, 0, "never deallocate a concurrently executing API ref")
        print("G1 controlled SYSTEM DNS setup deadline: \(started.duration(to: .now)); C call still held")

        let refused = await ProtectedDNSProbe.querySystemResolver(timeout: 0.2, resolver: next.functions)
        XCTAssertEqual(refused, [])
        XCTAssertEqual(next.setupCalls, 0, "timeout cannot release the outstanding C work claim")
        held.openSetup()
        await fulfillment(of: [held.disposed], timeout: 1)
        await held.drainOwnerQueue()
        await first.value
        XCTAssertEqual(held.deallocations, 1)
        XCTAssertEqual(held.queueInstallations, 0, "late setup must not subscribe after its caller retired")
        XCTAssertEqual(result, [])

        var nextResult: [String]?
        let second = Task {
            nextResult = await ProtectedDNSProbe.querySystemResolver(timeout: 2, resolver: next.functions)
        }
        await fulfillment(of: [next.started], timeout: 1)
        await held.send("198.19.9.9")
        XCTAssertNil(nextResult, "late old fake-IP cannot grant a newer request readiness")
        await next.send("203.0.113.8")
        await second.value
        XCTAssertEqual(nextResult, ["203.0.113.8"])
        XCTAssertFalse(ProtectedDNSProbe.containsFakeIP(nextResult ?? []))
        XCTAssertEqual(held.deallocations, 1, "late callback cannot release the old ref twice")
        XCTAssertEqual(next.deallocations, 1)
    }

    func testSystemDNSCancellationDrainsDisconnectWhileSetupIsHeld() async {
        let held = HeldDNSService(holdSetup: true)
        let retry = HeldDNSService()
        defer { held.openSetup(); held.releaseContext(); retry.releaseContext() }
        let coordinator = ConnectionCoordinator()
        var result: [String]?
        let pending = Task {
            result = await ProtectedDNSProbe.querySystemResolver(timeout: 30, resolver: held.functions)
        }
        await fulfillment(of: [held.setupEntered], timeout: 1)
        let released = expectation(description: "real Disconnect drains the waiter, not blocked C setup")
        released.assertForOverFulfill = true
        let cancelledAt = ContinuousClock.now
        pending.cancel()
        coordinator.enqueueDisconnect(waitingFor: [pending]) { _ in released.fulfill() }
        await fulfillment(of: [released], timeout: 1)
        XCTAssertEqual(result, [])
        XCTAssertEqual(held.deallocations, 0)
        XCTAssertEqual(held.queueInstallations, 0)
        print("G1 controlled SYSTEM DNS setup cancel/drain: \(cancelledAt.duration(to: .now)); C call still held")

        let refused = await ProtectedDNSProbe.querySystemResolver(timeout: 0.2, resolver: retry.functions)
        XCTAssertEqual(refused, [])
        XCTAssertEqual(retry.setupCalls, 0, "Disconnect must not stack a second blocked C call")
        held.openSetup()
        await fulfillment(of: [held.disposed], timeout: 1)
        await held.drainOwnerQueue()
        await pending.value
        await held.send("198.19.5.6")
        XCTAssertEqual(result, [])
        XCTAssertEqual(held.deallocations, 1)
        XCTAssertEqual(held.queueInstallations, 0)
    }

    func testSystemDNSDeadlineDeallocatesOnceAndLateCallbackCannotCompleteNextRequest() async {
        let old = HeldDNSService()
        let next = HeldDNSService()
        defer { old.releaseContext(); next.releaseContext() }
        let timedOut = expectation(description: "deadline resumes without resolver callback")
        let started = ContinuousClock.now
        let first = Task {
            let result = await ProtectedDNSProbe.querySystemResolver(timeout: 0.2, resolver: old.functions)
            timedOut.fulfill()
            return result
        }
        await fulfillment(of: [old.started, timedOut], timeout: 1)
        await fulfillment(of: [old.disposed], timeout: 1)
        XCTAssertEqual(old.deallocations, 1)
        print("G1 controlled SYSTEM DNS deadline: \(started.duration(to: .now)); callback still withheld")
        // If the deadline regression returns, release the fixture after the
        // bounded assertion so the test reports failure instead of hanging CI.
        await old.send(nil, error: DNSServiceErrorType(kDNSServiceErr_Timeout))
        let firstResult = await first.value
        XCTAssertEqual(firstResult, [])

        var secondResult: [String]?
        let second = Task {
            secondResult = await ProtectedDNSProbe.querySystemResolver(timeout: 2, resolver: next.functions)
        }
        await fulfillment(of: [next.started], timeout: 1)
        // Deliberately stronger than DNS-SD's no-callback-after-deallocate
        // contract: fixture retains the context to safely deliver a late reply.
        await old.send("198.19.9.9")
        first.cancel()
        XCTAssertEqual(old.deallocations, 1)
        XCTAssertNil(secondResult)
        XCTAssertEqual(next.deallocations, 0)
        await next.send("203.0.113.8")
        await second.value
        XCTAssertEqual(secondResult, ["203.0.113.8"], "old fake-IP cannot prove the new SYSTEM request")
        XCTAssertFalse(ProtectedDNSProbe.containsFakeIP(secondResult ?? []))
        XCTAssertEqual(next.deallocations, 1)
    }

    func testSystemDNSCancellationDrainsDisconnectWithoutCallbackOrDeadline() async {
        let resolver = HeldDNSService()
        defer { resolver.releaseContext() }
        let coordinator = ConnectionCoordinator()
        var result: [String]?
        let pending = Task {
            result = await ProtectedDNSProbe.querySystemResolver(timeout: 30, resolver: resolver.functions)
        }
        await fulfillment(of: [resolver.started], timeout: 1)
        let released = expectation(description: "real disconnect queue drains cancelled DNS caller")
        let cancelledAt = ContinuousClock.now
        pending.cancel()
        coordinator.enqueueDisconnect(waitingFor: [pending]) { _ in released.fulfill() }
        await fulfillment(of: [released, resolver.disposed], timeout: 1)
        XCTAssertEqual(result, [])
        XCTAssertEqual(resolver.deallocations, 1)
        print("G1 controlled SYSTEM DNS cancel/drain: \(cancelledAt.duration(to: .now)); 30s deadline/callback not awaited")
        await resolver.send("198.19.5.6")
        await pending.value
        XCTAssertEqual(result, [])
        XCTAssertEqual(resolver.deallocations, 1)
    }

    func testSystemDNSCopiesIPv4AnswerBatchBeforeDeallocation() async {
        let resolver = HeldDNSService()
        defer { resolver.releaseContext() }
        let query = Task { await ProtectedDNSProbe.querySystemResolver(timeout: 2, resolver: resolver.functions) }
        await fulfillment(of: [resolver.started], timeout: 1)
        // An IPv6 answer or a removal must not finish the IPv4 proof; and the
        // first public A in a batch must not hide the later fake-IP A.
        await resolver.send("2001:db8::1")
        await resolver.send("198.19.99.99", flags: DNSServiceFlags(kDNSServiceFlagsAdd | kDNSServiceFlagsMoreComing))
        await resolver.send("198.19.99.99", flags: 0)
        await resolver.send("203.0.113.2", flags: DNSServiceFlags(kDNSServiceFlagsAdd | kDNSServiceFlagsMoreComing))
        XCTAssertEqual(resolver.deallocations, 0)
        await resolver.send("198.19.1.2")
        let answers = await query.value
        XCTAssertEqual(answers, ["203.0.113.2", "198.19.1.2"])
        XCTAssertTrue(ProtectedDNSProbe.containsFakeIP(answers))
        XCTAssertEqual(resolver.deallocations, 1)
        await resolver.send("198.19.88.88")
        XCTAssertEqual(resolver.deallocations, 1)
    }

    func testSystemDNSQueueInstallationFailureReleasesCreatedRef() async {
        let resolver = HeldDNSService(queueError: DNSServiceErrorType(kDNSServiceErr_NoMemory))
        defer { resolver.releaseContext() }
        let answers = await ProtectedDNSProbe.querySystemResolver(timeout: 30, resolver: resolver.functions)
        XCTAssertEqual(answers, [])
        XCTAssertEqual(resolver.deallocations, 1)
        await resolver.send(nil, error: DNSServiceErrorType(kDNSServiceErr_ServiceNotRunning))
        XCTAssertEqual(resolver.deallocations, 1)
    }
}

/// Replaces only the C API calls, using the production callback and context.
/// The fake ref is never passed to libdns_sd. Same-queue deallocation is asserted
/// even before dispatch registration. Setup can be held inside getAddrInfo,
/// not merely after it returns. Timers, task cancellation, the process-wide
/// claim and exactly-once completion/cleanup are all production methods.
nonisolated private final class HeldDNSService: @unchecked Sendable {
    let started = XCTestExpectation(description: "DNSServiceRef scheduled")
    let setupEntered = XCTestExpectation(description: "inside synchronous DNSServiceGetAddrInfo")
    let disposed = XCTestExpectation(description: "DNSServiceRef disposed on its owner queue")
    private let lock = NSLock()
    private let reference = DNSServiceRef(bitPattern: 1)!
    private let queueError: DNSServiceErrorType
    private let holdSetup: Bool
    private let setupPermit = DispatchSemaphore(value: 0)
    private var callback: DNSServiceGetAddrInfoReply?
    private var context: UnsafeMutableRawPointer?
    private var queue: DispatchQueue?
    private var count = 0
    private var setupCount = 0
    private var queueCount = 0

    init(queueError: DNSServiceErrorType = 0, holdSetup: Bool = false) {
        self.queueError = queueError
        self.holdSetup = holdSetup
    }
    var deallocations: Int { lock.withLock { count } }
    var setupCalls: Int { lock.withLock { setupCount } }
    var queueInstallations: Int { lock.withLock { queueCount } }

    var functions: ProtectedSystemResolver.Functions {
        .init(
            getAddrInfo: { [self] output, flags, index, proto, hostname, callback, context in
                dispatchPrecondition(condition: .onQueue(ProtectedSystemResolver.ownershipQueue))
                XCTAssertEqual(flags, 0, "no multicast/local-only/expired-answer override")
                XCTAssertEqual(index, 0, "system chooses configured resolver/interface")
                XCTAssertEqual(proto, DNSServiceProtocol(kDNSServiceProtocol_IPv4))
                XCTAssertEqual(String(cString: hostname), "www.gstatic.com")
                lock.withLock {
                    setupCount += 1
                    self.callback = callback
                    self.context = context
                    self.queue = ProtectedSystemResolver.ownershipQueue
                    _ = Unmanaged<AnyObject>.fromOpaque(context).retain()
                }
                // ConnectToServer fills the ref before deliver_request waits for
                // the daemon ACK. Expose it before blocking, just like that path.
                output.pointee = reference
                setupEntered.fulfill()
                // A bounded fixture escape prevents a regression from parking CI.
                // Tests release only AFTER asserting the caller/drain has returned.
                if holdSetup {
                    XCTAssertEqual(setupPermit.wait(timeout: .now() + 5), .success, "test must release C setup")
                }
                return DNSServiceErrorType(kDNSServiceErr_NoError)
            },
            setDispatchQueue: { [self] reference, queue in
                XCTAssertEqual(reference, self.reference)
                XCTAssertTrue(queue === ProtectedSystemResolver.ownershipQueue)
                dispatchPrecondition(condition: .onQueue(queue))
                lock.withLock { queueCount += 1 }
                started.fulfill()
                return queueError
            },
            deallocate: { [self] reference in
                XCTAssertEqual(reference, self.reference)
                dispatchPrecondition(condition: .onQueue(ProtectedSystemResolver.ownershipQueue))
                if let queue = lock.withLock({ self.queue }) {
                    dispatchPrecondition(condition: .onQueue(queue))
                } else { XCTFail("deallocated without the owned queue") }
                lock.withLock { count += 1 }
                disposed.fulfill()
            }
        )
    }

    func openSetup() { setupPermit.signal() }

    func drainOwnerQueue() async {
        await withCheckedContinuation { continuation in
            ProtectedSystemResolver.ownershipQueue.async { continuation.resume() }
        }
    }

    func send(_ address: String?, flags: DNSServiceFlags = DNSServiceFlags(kDNSServiceFlagsAdd), error: DNSServiceErrorType = 0) async {
        guard let queue = lock.withLock({ self.queue }) else { return XCTFail("no callback queue") }
        await withCheckedContinuation { continuation in
            queue.async { [self] in
                let (callback, context) = lock.withLock { (self.callback, self.context) }
                if let address, address.contains(":") {
                    var ipv6 = sockaddr_in6()
                    ipv6.sin6_len = UInt8(MemoryLayout<sockaddr_in6>.size)
                    ipv6.sin6_family = sa_family_t(AF_INET6)
                    _ = address.withCString { inet_pton(AF_INET6, $0, &ipv6.sin6_addr) }
                    withUnsafePointer(to: &ipv6) { pointer in
                        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                            callback?(reference, flags, 0, error, nil, $0, 60, context)
                        }
                    }
                } else if let address {
                    var ipv4 = sockaddr_in()
                    ipv4.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
                    ipv4.sin_family = sa_family_t(AF_INET)
                    _ = address.withCString { inet_pton(AF_INET, $0, &ipv4.sin_addr) }
                    withUnsafePointer(to: &ipv4) { pointer in
                        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                            callback?(reference, flags, 0, error, nil, $0, 60, context)
                        }
                    }
                } else {
                    callback?(reference, flags, 0, error, nil, nil, 0, context)
                }
                continuation.resume()
            }
        }
    }

    func releaseContext() {
        let context = lock.withLock {
            let value = self.context
            self.context = nil
            return value
        }
        if let context { Unmanaged<AnyObject>.fromOpaque(context).release() }
    }
}
