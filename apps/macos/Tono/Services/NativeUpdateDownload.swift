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

    static func bounded(_ url: URL, maximum: Int) async throws -> Data {
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let (stream, response) = try await session.bytes(for: URLRequest(url: url, timeoutInterval: 30))
        guard let http = response as? HTTPURLResponse, http.statusCode == 200, http.url == url,
              response.expectedContentLength <= maximum else { throw failure("Update discovery metadata is unavailable or invalid.") }
        var data = Data()
        for try await byte in stream {
            guard data.count < maximum else { throw failure("Update metadata exceeds its size limit.") }
            data.append(byte)
        }
        return data
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
