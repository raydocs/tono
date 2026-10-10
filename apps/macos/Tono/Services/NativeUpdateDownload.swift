import Foundation
import CryptoKit

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
        let downloader = NativePackageDownload(url: url, size: Int64(target.artifactSizeBytes))
        return try await downloader.download()
    }

    static func failure(_ message: String) -> NSError {
        NSError(domain: "Tono.NativeUpdate", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}

/// URLSession spools the one actual package to disk and cancels oversized
/// transfers. The helper independently copies and hashes this exact file.
nonisolated private final class NativePackageDownload: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
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
        let value = result ?? .failure(error ?? NativeUpdateDownload.failure("Update download did not complete."))
        lock.unlock()
        completion?.resume(with: value)
        session.finishTasksAndInvalidate()
    }
}
