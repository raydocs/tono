import Darwin
import Dispatch
import Foundation
import dnssd

/// Ordinary system DNS with a prompt, cancellable waiter and an owned DNSServiceRef.
/// DNSServiceGetAddrInfo itself is synchronous: Apple's clientstub can wait 60s
/// for a daemon ACK, in addition to blocking connect/send. We cannot forcibly
/// cancel that C call or deallocate its in-progress ref from another queue.
/// The waiter retires independently; at most one request retains C ownership
/// until eventual same-queue cleanup. Retries fail closed instead of accumulating
/// blocked setup workers. No late setup/callback can grant DNS readiness.
/// Source: apple-oss-distributions/mDNSResponder d4658af3, mDNSShared/dnssd_clientstub.c
/// (DNSSD_CLIENT_TIMEOUT, deliver_request, DNSServiceGetAddrInfoInternal).
nonisolated enum ProtectedSystemResolver {
    static let ownershipQueue = DispatchQueue(label: "net.tono.system-dns", qos: .userInitiated)
    private static let inFlight = InFlight()

    /// Only the three DNS-SD C calls are substituted in tests. Request lifetime,
    /// callback parsing, deadline, cancellation and terminal arbitration stay real.
    nonisolated struct Functions: Sendable {
        let getAddrInfo: @Sendable (
            UnsafeMutablePointer<DNSServiceRef?>, DNSServiceFlags, UInt32,
            DNSServiceProtocol, UnsafePointer<CChar>, @escaping DNSServiceGetAddrInfoReply,
            UnsafeMutableRawPointer
        ) -> DNSServiceErrorType
        let setDispatchQueue: @Sendable (DNSServiceRef, DispatchQueue) -> DNSServiceErrorType
        let deallocate: @Sendable (DNSServiceRef) -> Void

        static let live = Functions(
            getAddrInfo: { DNSServiceGetAddrInfo($0, $1, $2, $3, $4, $5, $6) },
            setDispatchQueue: { DNSServiceSetDispatchQueue($0, $1) },
            deallocate: { DNSServiceRefDeallocate($0) }
        )
    }

    static func query(name: String, timeout: TimeInterval, functions: Functions) async -> [String] {
        guard !Task.isCancelled else { return [] }
        let request = Request(functions: functions, timeout: timeout)
        // Claim before enqueueing ANY C work, including across retries after a
        // timeout. The caller gives up its answer, never the C operation's claim.
        guard inFlight.claim(request) else { return [] }
        let answers = await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                request.begin(name: name, continuation: continuation)
            }
        } onCancel: {
            request.finish([])
        }
        // A successful callback can race the caller's cancellation before its
        // continuation is scheduled. Cancellation never grants DNS readiness.
        return Task.isCancelled ? [] : answers
    }

    /// Also retains the callback context if its waiter has already returned.
    /// Only owner-queue cleanup may release the claim, by request identity.
    nonisolated private final class InFlight: @unchecked Sendable {
        private let lock = NSLock()
        private var request: Request?

        func claim(_ request: Request) -> Bool {
            lock.lock()
            defer { lock.unlock() }
            guard self.request == nil else { return false }
            self.request = request
            return true
        }

        func clear(_ request: Request) {
            lock.lock()
            if self.request === request { self.request = nil }
            lock.unlock()
        }
    }

    /// Waiter state has a short lock, never held over C work. Ref/answer storage
    /// and every C call stay on ownershipQueue, which may itself remain blocked.
    /// dns_sd.h requires deallocation on the installed dispatch queue, with no
    /// concurrent ProcessResult. mDNSResponder's clientstub guarantees no more
    /// callbacks after that deallocation returns; callback sockaddr is borrowed
    /// stack memory, so copy it before leaving the callback.
    nonisolated private final class Request: @unchecked Sendable {
        private let functions: Functions
        private let deadline: DispatchTime
        private let lock = NSLock()
        // Lock-protected waiter state; cancellation can precede begin.
        private var timer: DispatchSourceTimer?
        private var continuation: CheckedContinuation<[String], Never>?
        private var terminal: [String]?
        // Owner-queue-only state. Never read these under the waiter lock.
        private var service: DNSServiceRef?
        private var answers: [String] = []

        init(functions: Functions, timeout: TimeInterval) {
            self.functions = functions
            deadline = .now() + max(0.2, timeout)
        }

        func begin(name: String, continuation: CheckedContinuation<[String], Never>) {
            lock.lock()
            if let terminal {
                lock.unlock()
                continuation.resume(returning: terminal)
                return
            }
            self.continuation = continuation
            // Install BEFORE submitting setup, on a queue that never runs C API
            // work. Neither the timer nor onCancel waits for ownershipQueue.
            let timer = DispatchSource.makeTimerSource(queue: .global(qos: .userInitiated))
            self.timer = timer
            timer.setEventHandler { self.finish([]) }
            timer.schedule(deadline: deadline)
            timer.resume()
            ownershipQueue.async { self.start(name: name) }
            lock.unlock()
        }

        private var isPending: Bool {
            lock.withLock { terminal == nil && DispatchTime.now() < deadline }
        }

        private func start(name: String) {
            dispatchPrecondition(condition: .onQueue(ownershipQueue))
            guard isPending else { finishOnOwner([]); return }
            let status = name.withCString { hostname in
                functions.getAddrInfo(
                    &service, 0, 0, DNSServiceProtocol(kDNSServiceProtocol_IPv4), hostname,
                    { _, flags, _, error, _, address, _, context in
                        guard let context else { return }
                        let request = Unmanaged<Request>.fromOpaque(context).takeUnretainedValue()
                        request.receive(flags: flags, error: error, address: address)
                    },
                    Unmanaged.passUnretained(self).toOpaque()
                )
            }
            // A timed-out/cancelled submission may finally return a ref. Dispose
            // it here, without installing callbacks or reviving its waiter.
            guard status == kDNSServiceErr_NoError, let service, isPending else {
                finishOnOwner([])
                return
            }
            guard functions.setDispatchQueue(service, ownershipQueue) == kDNSServiceErr_NoError,
                  isPending else {
                finishOnOwner([])
                return
            }
        }

        private func receive(flags: DNSServiceFlags, error: DNSServiceErrorType, address: UnsafePointer<sockaddr>?) {
            dispatchPrecondition(condition: .onQueue(ownershipQueue))
            guard isPending else { return }
            guard error == kDNSServiceErr_NoError else {
                finishOnOwner([])
                return
            }
            // Preserve the initial IPv4 batch so a fake-IP is not hidden by an
            // earlier public answer. A removal in that batch must also withdraw
            // its evidence, never leave a stale fake-IP granting DNS readiness.
            guard let address, address.pointee.sa_family == sa_family_t(AF_INET) else { return }
            var ipv4 = address.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee }
            var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            if inet_ntop(AF_INET, &ipv4.sin_addr, &buffer, socklen_t(INET_ADDRSTRLEN)) != nil {
                let answer = String(cString: buffer)
                if flags & DNSServiceFlags(kDNSServiceFlagsAdd) != 0 {
                    if !answers.contains(answer) { answers.append(answer) }
                } else {
                    answers.removeAll { $0 == answer }
                }
            }
            if flags & DNSServiceFlags(kDNSServiceFlagsMoreComing) == 0, !answers.isEmpty {
                finishOnOwner(answers)
            }
        }

        /// Callback/setup completion normally cleans up before returning an
        /// answer, so the next healthy query can claim the owner immediately.
        /// A cancellation/deadline can still win while deallocation is running.
        private func finishOnOwner(_ result: [String]) {
            dispose()
            finish(result)
        }

        private func dispose() {
            dispatchPrecondition(condition: .onQueue(ownershipQueue))
            if let service {
                self.service = nil
                functions.deallocate(service)
            }
            inFlight.clear(self)
        }

        /// Exactly-once waiter arbitration, with no C calls or queue waits.
        /// Timely failure is independent of eventual native resource cleanup.
        func finish(_ result: [String]) {
            lock.lock()
            guard terminal == nil else { lock.unlock(); return }
            // Also enforce the clock at publication if the timer was delayed.
            let result = DispatchTime.now() < deadline ? result : []
            terminal = result
            let timer = self.timer
            self.timer = nil
            let continuation = self.continuation
            self.continuation = nil
            lock.unlock()
            timer?.setEventHandler {}
            timer?.cancel()
            ownershipQueue.async { self.dispose() }
            continuation?.resume(returning: result)
        }
    }
}
