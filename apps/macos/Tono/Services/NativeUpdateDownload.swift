import Foundation
import CryptoKit
import Network

nonisolated enum NativeUpdateDownload {
    static let origin = "https://releases.afk.ccwu.cc/desktop/v1/"

    struct Offer: Sendable {
        let bytes: Data
        let signature: Data
        let manifest: UpdateContractV1.ReleaseManifest
        let directory: URL
    }

    static func discover() async throws -> Offer {
        let bytes = try await bounded(URL(string: origin + "latest/manifest.json")!, maximum: UpdateContractV1.maxBytes)
        let manifest = try UpdateContractV1.ReleaseManifest.decode(bytes)
        let hash = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        let directory = URL(string: origin + hash + "/")!
        let signature = try await bounded(directory.appendingPathComponent("manifest.macos-arm64.sig"), maximum: 4096)
        return .init(bytes: bytes, signature: signature, manifest: manifest, directory: directory)
    }

    /// One metadata GET. The system resolver first; when it fails before any
    /// response, the same GET goes over `fallbacks` in order (by default
    /// `fallbacks(for:)`). Whatever path carries it, the bytes are checked
    /// the same way here, and root verifies the manifest signature.
    static func bounded(
        _ url: URL, maximum: Int, timeoutInterval: TimeInterval = 30, fallbacks: [ControlPlanePath]? = nil
    ) async throws -> Data {
        let configuration = URLSessionConfiguration.ephemeral
        // The request timeout resets on every received byte. Bound the whole
        // metadata transfer too, so a trickling response cannot hold the updater.
        configuration.timeoutIntervalForResource = timeoutInterval
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let stream: URLSession.AsyncBytes
        let response: URLResponse
        do {
            (stream, response) = try await session.bytes(for: URLRequest(url: url, timeoutInterval: timeoutInterval))
        } catch {
            // No response arrived. A GET is safe to send again elsewhere.
            return try await fetch(url, maximum: maximum, after: error, over: fallbacks ?? Self.fallbacks(for: url))
        }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200, http.url == url,
              response.expectedContentLength <= maximum else { throw failure("Update discovery metadata is unavailable or invalid.") }
        var data = Data()
        for try await byte in stream {
            guard data.count < maximum else { throw failure("Update metadata exceeds its size limit.") }
            data.append(byte)
        }
        return data
    }

    /// The paths after the system resolver, in the control plane's order
    /// (`TonoAPIClient.exchangeOverPaths`): the host's pinned addresses, then
    /// the Tono relays (decision 077). Only the API host has pins, so the
    /// release host goes straight to the relays, as the Windows updater does.
    /// The relays are not in the PF bootstrap permit; while protection is
    /// armed they are blocked like any other address.
    static func fallbacks(for url: URL) -> [ControlPlanePath] {
        [ControlPlanePath.pinnedAddresses(for: url), ControlPlanePath.relays(for: url)].compactMap { $0 }
    }

    /// `url` over each path in turn until one answers. A status line is the
    /// answer, held to the direct path's rules; a path that fails without one
    /// hands the GET to the next. TLS on these paths names the URL's host and
    /// uses the default certificate evaluation (`PinnedControlPlaneExchange`).
    private static func fetch(
        _ url: URL, maximum: Int, after directError: any Error, over paths: [ControlPlanePath]
    ) async throws -> Data {
        guard !paths.isEmpty, !isCancellation(directError) else { throw directError }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        var failures = ["system_dns[\(directError.localizedDescription)]"]
        for path in paths {
            try Task.checkCancellation()
            let answer: ControlPlaneAnswer
            do {
                answer = try await path.exchange(request, maximum)
            } catch is ControlPlaneExchangeError {
                // Over the cap or not HTTP: an answer, never re-sent.
                throw failure("Update discovery metadata is unavailable or invalid.")
            } catch {
                if isCancellation(error) { throw error }
                failures.append("\(path.label)[\(error.localizedDescription)]")
                continue
            }
            guard answer.status == 200, answer.bodyFailure == nil, answer.body.count <= maximum else {
                throw failure("Update discovery metadata is unavailable or invalid.")
            }
            return answer.body
        }
        throw failure("Update discovery metadata is unreachable: " + failures.joined(separator: "; "))
    }

    private static func isCancellation(_ error: any Error) -> Bool {
        error is CancellationError || (error as? URLError)?.code == .cancelled
    }

    static func package(for offer: Offer) async throws -> URL {
        let target = try offer.manifest.target(.macosArm64)
        let url = offer.directory.appendingPathComponent("package.macos-arm64.zip")
        return try await package(at: url, size: Int64(target.artifactSizeBytes))
    }

    /// The package GET. Direct first; when it fails before any response
    /// (the metadata rule above), the same GET goes over `relays` in order
    /// (by default `packageRelays(for:)`), streamed to disk under the same
    /// signed size. Whatever path carries it, root copies and hashes this
    /// exact file against the signed manifest before installing.
    static func package(at url: URL, size: Int64, relays: [PackagePath]? = nil) async throws -> URL {
        do {
            return try await NativePackageDownload(url: url, size: size).download()
        } catch let undelivered as NativePackageDownload.Undelivered {
            return try await relayedPackage(
                url, size: size, after: undelivered.error, over: relays ?? packageRelays(for: url)
            )
        }
    }

    /// One path per Tono relay for the release host (decision 077), in
    /// `ControlPlanePath.apiRelays` order; none for any other host. The relays
    /// are not in the PF bootstrap permit: while protection is armed they are
    /// blocked like any other address.
    static func packageRelays(for url: URL) -> [PackagePath] {
        guard let relay = ControlPlanePath.relayEndpoints(for: url) else { return [] }
        let host = relay.host
        return relay.endpoints.map { endpoint in
            PackagePath(label: "relay \(endpoint.description)") { url, sink in
                guard let message = PinnedControlPlaneExchange.requestBytes(
                    URLRequest(url: url), host: host, userAgent: ControlPlanePath.userAgent
                ) else { throw URLError(.cannotConnectToHost) }
                try await RelayPackageConnection(endpoint: endpoint, host: host, message: message, sink: sink)
                    .run(connectBudget: PinnedControlPlaneExchange.relayConnectBudget)
            }
        }
    }

    /// The package over each relay in turn into one private file. A path
    /// that fails before a status line hands the GET to the next; once a
    /// status line arrives it is the answer and is never sent again. On any
    /// failure the file and its directory are removed.
    private static func relayedPackage(
        _ url: URL, size: Int64, after directError: any Error, over paths: [PackagePath]
    ) async throws -> URL {
        guard !paths.isEmpty, !isCancellation(directError) else { throw directError }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("tono-update-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
                                                attributes: [.posixPermissions: 0o700])
        let destination = directory.appendingPathComponent("package.zip")
        do {
            guard FileManager.default.createFile(atPath: destination.path, contents: nil,
                                                 attributes: [.posixPermissions: 0o600]) else {
                throw failure("The update package could not be saved.")
            }
            let file = try FileHandle(forWritingTo: destination)
            defer { try? file.close() }
            var failures = ["direct[\(directError.localizedDescription)]"]
            for path in paths {
                try Task.checkCancellation()
                try file.truncate(atOffset: 0)
                let sink = PackageResponseSink(size: size, file: file, destination: destination)
                do {
                    try await path.stream(url, sink)
                } catch {
                    if sink.answered || isCancellation(error) { throw error }
                    failures.append("\(path.label)[\(error.localizedDescription)]")
                    continue
                }
                guard sink.isComplete else { throw failure("Downloaded update package size or origin differs.") }
                try file.synchronize()
                return destination
            }
            throw failure("The update package is unreachable: " + failures.joined(separator: "; "))
        } catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
    }

    static func failure(_ message: String) -> NSError {
        NSError(domain: "Tono.NativeUpdate", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}

/// URLSession spools the one actual package to disk and cancels oversized
/// transfers. The helper independently copies and hashes this exact file.
nonisolated private final class NativePackageDownload: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    /// The direct GET failed before any response.
    nonisolated struct Undelivered: Error {
        let error: any Error
    }

    private let url: URL
    private let size: Int64
    private let lock = NSLock()
    private var continuation: CheckedContinuation<URL, Error>?
    private var result: Result<URL, Error>?

    init(url: URL, size: Int64) { self.url = url; self.size = size }

    func download() async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let config = URLSessionConfiguration.ephemeral
            config.timeoutIntervalForResource = 900
            let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
            session.downloadTask(with: url).resume()
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        if totalBytesWritten > size || totalBytesExpectedToWrite > size { downloadTask.cancel() }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil) // Immutable transport never follows publisher-selected URLs.
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let saved: Result<URL, Error> = Result {
            guard let response = downloadTask.response as? HTTPURLResponse, response.statusCode == 200,
                  response.url == url,
                  (try FileManager.default.attributesOfItem(atPath: location.path)[.size] as? NSNumber)?.int64Value == size else {
                throw NativeUpdateDownload.failure("Downloaded update package size or origin differs.")
            }
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("tono-update-" + UUID().uuidString)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
                                                    attributes: [.posixPermissions: 0o700])
            let destination = directory.appendingPathComponent("package.zip")
            do {
                try FileManager.default.moveItem(at: location, to: destination)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
                return destination
            } catch { try? FileManager.default.removeItem(at: directory); throw error }
        }
        lock.lock(); result = saved; lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let completion = continuation
        continuation = nil
        let value: Result<URL, Error>
        if let result {
            value = result
        } else if let error, task.response == nil {
            // No response arrived: the GET may go to the relays.
            value = .failure(Undelivered(error: error))
        } else {
            value = .failure(error ?? NativeUpdateDownload.failure("Update download did not complete."))
        }
        lock.unlock()
        completion?.resume(with: value)
        session.finishTasksAndInvalidate()
    }
}

/// One way to carry the package GET once the direct path is undelivered.
nonisolated struct PackagePath: Sendable {
    /// Named in the failure message.
    let label: String
    /// Sends the GET for the URL and hands each piece of the response, in
    /// order, to the sink until it reports the package complete. A thrown
    /// error ends this path; the sink says whether a status line had arrived.
    let stream: @Sendable (URL, PackageResponseSink) async throws -> Void
}

/// Reads one relayed package response and writes its body to the file as it
/// arrives: no more than the response head and one received piece is held in
/// memory. Only a 200 whose `Content-Length` is the signed size is accepted
/// (the release Worker always sends it, from the R2 object); any other answer,
/// and a body past that size, is an error. A redirect is such an answer.
nonisolated final class PackageResponseSink: @unchecked Sendable {
    let size: Int64
    /// Where the body is written. The caller owns it and removes it on failure.
    let destination: URL
    private let file: FileHandle
    private let lock = NSLock()
    // Guarded by `lock`.
    private var status: Int?
    private var headRead = false
    private var pending = Data()
    private var written: Int64 = 0

    init(size: Int64, file: FileHandle, destination: URL) {
        self.size = size
        self.file = file
        self.destination = destination
    }

    /// A final status line arrived: the server's answer, never sent again.
    var answered: Bool {
        lock.lock(); defer { lock.unlock() }
        return status != nil
    }

    /// The whole package is on disk.
    var isComplete: Bool {
        lock.lock(); defer { lock.unlock() }
        return headRead && written == size
    }

    /// Takes the next piece of the response. True once the whole package is
    /// on disk; a thrown error ends the transfer.
    func receive(_ data: Data) throws -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard headRead else {
            pending.append(data)
            return try readHead()
        }
        return try write(data)
    }

    private func readHead() throws -> Bool {
        let invalid = NativeUpdateDownload.failure("Downloaded update package size or origin differs.")
        while true {
            let bytes = [UInt8](pending)
            guard let lineEnd = PinnedResponse.find([13, 10], in: bytes, from: 0) else {
                guard bytes.count <= PinnedResponse.headLimit else { throw invalid }
                return false
            }
            guard let code = PinnedResponse.parseStatusLine(bytes[0..<lineEnd]) else { throw invalid }
            // An interim response such as 103 is not the answer; the final one follows it.
            let interim = (100..<200).contains(code)
            if !interim { status = code }
            guard let headEnd = PinnedResponse.find([13, 10, 13, 10], in: bytes, from: lineEnd) else {
                guard bytes.count <= PinnedResponse.headLimit else { throw invalid }
                return false
            }
            guard headEnd <= PinnedResponse.headLimit,
                  let headers = PinnedResponse.parseHeaders(bytes[min(lineEnd + 2, headEnd)..<headEnd]) else {
                throw invalid
            }
            let rest = Data(bytes[(headEnd + 4)...])
            if interim {
                guard code != 101 else { throw invalid }
                pending = rest
                continue
            }
            guard code == 200 else { throw NativeUpdateDownload.failure("The update package is unavailable.") }
            guard headers["transfer-encoding"] == nil,
                  let declared = headers["content-length"].flatMap({ Int64($0) }), declared == size else {
                throw invalid
            }
            headRead = true
            pending = Data()
            return try write(rest)
        }
    }

    private func write(_ data: Data) throws -> Bool {
        guard Int64(data.count) <= size - written else {
            throw NativeUpdateDownload.failure("Downloaded update package size or origin differs.")
        }
        if !data.isEmpty { try file.write(contentsOf: data) }
        written += Int64(data.count)
        return written == size
    }
}

/// The package GET over one relay (decision 077). TLS is `PinnedTLS`: the
/// release host as SNI, the default certificate evaluation against it, no
/// proxy. One request, no redirects. The body goes to the sink piece by
/// piece as it arrives. The budgets are the direct download's: 60 s without
/// a byte (`URLSession`'s request timeout), 900 s for the whole transfer.
nonisolated final class RelayPackageConnection: @unchecked Sendable {
    static let idleBudget: TimeInterval = 60
    static let transferBudget: TimeInterval = 900

    private let connection: NWConnection
    private let label: String
    private let message: Data
    private let sink: PackageResponseSink
    private let queue = DispatchQueue(label: "app.tono.update.package-relay")
    private let lock = NSLock()
    // Guarded by `lock`.
    private var outcome: Result<Void, any Error>?
    private var continuation: CheckedContinuation<Void, any Error>?
    // Touched only on `queue`.
    private var connected = false
    private var lastWaiting: String?
    private var lastActivity: TimeInterval = 0

    init(endpoint: ControlPlaneEndpoint, host: String, message: Data, sink: PackageResponseSink) {
        connection = PinnedTLS.connection(to: endpoint, host: host)
        label = "relay \(endpoint.description)"
        self.message = message
        self.sink = sink
    }

    func run(connectBudget: TimeInterval) async throws {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
                self.start(continuation, connectBudget: connectBudget)
            }
        } onCancel: {
            self.queue.async { self.finish(.failure(CancellationError())) }
        }
    }

    private func start(_ continuation: CheckedContinuation<Void, any Error>, connectBudget: TimeInterval) {
        lock.lock()
        if let early = outcome {
            // Cancelled before it started.
            lock.unlock()
            continuation.resume(with: early)
            return
        }
        self.continuation = continuation
        lock.unlock()
        connection.stateUpdateHandler = { [self] state in handle(state) }
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + connectBudget) { [weak self] in
            guard let self, !connected else { return }
            finish(.failure(URLError(.cannotConnectToHost, userInfo: [
                NSLocalizedDescriptionKey: lastWaiting ?? "no TLS connection within \(Int(connectBudget.rounded(.up))) s",
            ])))
        }
        queue.asyncAfter(deadline: .now() + Self.transferBudget) { [weak self] in
            self?.finish(.failure(URLError(.timedOut)))
        }
    }

    private var isFinished: Bool {
        lock.lock(); defer { lock.unlock() }
        return outcome != nil
    }

    private func finish(_ result: Result<Void, any Error>) {
        lock.lock()
        guard outcome == nil else {
            lock.unlock()
            return
        }
        outcome = result
        let waiting = continuation
        continuation = nil
        lock.unlock()
        connection.cancel()
        waiting?.resume(with: result)
    }

    private func handle(_ state: NWConnection.State) {
        switch state {
        case .ready:
            guard !isFinished, !connected else { return }
            connected = true
            lastActivity = ProcessInfo.processInfo.systemUptime
            watchIdle(after: Self.idleBudget)
            connection.send(content: message, completion: .contentProcessed { [self] error in
                if let error {
                    finish(.failure(URLError(.networkConnectionLost, userInfo: [
                        NSLocalizedDescriptionKey: "\(label) send: \(error)",
                    ])))
                    return
                }
                receive()
            })
        case let .waiting(error):
            // Still trying; the connect budget decides.
            lastWaiting = "\(error)"
        case let .failed(error):
            finish(.failure(URLError(connected ? .networkConnectionLost : .cannotConnectToHost, userInfo: [
                NSLocalizedDescriptionKey: "\(label): \(error)",
            ])))
        case .cancelled:
            connection.stateUpdateHandler = nil
        default:
            break
        }
    }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [self] data, _, isComplete, error in
            guard !isFinished else { return }
            if let data, !data.isEmpty {
                lastActivity = ProcessInfo.processInfo.systemUptime
                do {
                    if try sink.receive(data) {
                        finish(.success(()))
                        return
                    }
                } catch {
                    finish(.failure(error))
                    return
                }
            }
            guard !isComplete, error == nil else {
                finish(.failure(URLError(.networkConnectionLost, userInfo: [
                    NSLocalizedDescriptionKey: "\(label): the connection closed before the whole package"
                        + (error.map { " (\($0))" } ?? ""),
                ])))
                return
            }
            receive()
        }
    }

    /// Ends the transfer once no byte has arrived for `idleBudget`.
    private func watchIdle(after delay: TimeInterval) {
        queue.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self, !isFinished else { return }
            let quiet = ProcessInfo.processInfo.systemUptime - lastActivity
            guard quiet >= Self.idleBudget else {
                watchIdle(after: Self.idleBudget - quiet)
                return
            }
            finish(.failure(URLError(.timedOut)))
        }
    }
}
