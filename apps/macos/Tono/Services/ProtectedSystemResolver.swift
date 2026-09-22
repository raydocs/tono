import Darwin
import Dispatch
import Foundation
import dnssd

/// Ordinary system DNS, with an owned, cancellable DNSServiceRef instead of a
/// blocking getaddrinfo worker that structured task cancellation cannot drain.
nonisolated enum ProtectedSystemResolver {
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
        let request = Request(functions: functions)
        let answers = await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                request.queue.async {
                    request.start(name: name, timeout: timeout, continuation: continuation)
                }
            }
        } onCancel: {
            request.queue.async { request.finish([]) }
        }
        // A successful callback can race the caller's cancellation before its
        // continuation is scheduled. Cancellation never grants DNS readiness.
        return Task.isCancelled ? [] : answers
    }

    /// All mutable fields and C operations are confined to this serial queue.
    /// dns_sd.h requires deallocation on the installed dispatch queue, with no
    /// concurrent ProcessResult. mDNSResponder's clientstub guarantees no more
    /// callbacks after that deallocation returns; callback sockaddr is borrowed
    /// stack memory, so copy it before leaving the callback.
    nonisolated private final class Request: @unchecked Sendable {
        let queue = DispatchQueue(label: "net.tono.system-dns", qos: .userInitiated)
        private let functions: Functions
        private var service: DNSServiceRef?
        private var timer: DispatchSourceTimer?
        private var continuation: CheckedContinuation<[String], Never>?
        private var terminal: [String]?
        private var answers: [String] = []

        init(functions: Functions) { self.functions = functions }

        func start(name: String, timeout: TimeInterval, continuation: CheckedContinuation<[String], Never>) {
            dispatchPrecondition(condition: .onQueue(queue))
            // onCancel may be enqueued before start, even for a task cancelled
            // before it enters withTaskCancellationHandler. Don't create a ref.
            if let terminal {
                continuation.resume(returning: terminal)
                return
            }
            self.continuation = continuation
            let deadline = DispatchTime.now() + max(0.2, timeout)
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
            guard status == kDNSServiceErr_NoError, let service else {
                finish([])
                return
            }
            guard functions.setDispatchQueue(service, queue) == kDNSServiceErr_NoError else {
                finish([])
                return
            }
            // The timer and query's cancellation handler retain the request
            // through deallocation. finish clears the timer's retain cycle.
            let timer = DispatchSource.makeTimerSource(queue: queue)
            self.timer = timer
            timer.setEventHandler { self.finish([]) }
            timer.schedule(deadline: deadline)
            timer.resume()
        }

        private func receive(flags: DNSServiceFlags, error: DNSServiceErrorType, address: UnsafePointer<sockaddr>?) {
            dispatchPrecondition(condition: .onQueue(queue))
            guard terminal == nil else { return }
            guard error == kDNSServiceErr_NoError else {
                finish([])
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
                finish(answers)
            }
        }

        func finish(_ result: [String]) {
            dispatchPrecondition(condition: .onQueue(queue))
            guard terminal == nil else { return }
            terminal = result
            if let service {
                self.service = nil
                functions.deallocate(service)
            }
            timer?.setEventHandler {}
            timer?.cancel()
            timer = nil
            let continuation = self.continuation
            self.continuation = nil
            continuation?.resume(returning: result)
        }
    }
}
