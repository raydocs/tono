import Foundation

/// A19: the customer timeline's 「换路径」 rows from this Mac, the same
/// `controlPlanePathFail` event the Windows client uploads. One control-plane
/// path failed before any status line and the next path of the same request
/// ran: the two `X-Tono-Path` labels, the failure class and the time that
/// path took. Never an address, URL, host, error text or account value; the
/// local audit's `control_plane_path_failed` keeps the detail on the device.
///
/// The account session opens the timeline only while a verified account is
/// ready and the timeline switch is on. A request takes a ticket when it
/// starts and records only if the timeline is still open on that same
/// ticket, so a failure before sign-in, after sign-out, with the switch off,
/// or from a request started under another account never joins the upload.
nonisolated final class ControlPlanePathTimeline: @unchecked Sendable {
    /// The labels the timeline may carry, the ones the control plane reads in
    /// `X-Tono-Path`. A failure involving any other label is not recorded.
    static let labels: Set<String> = ["pinned", "system_dns", "relay", "doh", "alt_port", "tunnel"]

    private let lock = NSLock()
    private let buffer: ConnectionTelemetryBuffer
    private var open = false
    private var revision: UInt64 = 0

    init(buffer: ConnectionTelemetryBuffer = .shared) {
        self.buffer = buffer
    }

    /// Opens or closes the timeline. Every call retires the tickets taken
    /// before it, whatever the value: an account or consent change in
    /// between means the request no longer speaks for the current one.
    func admit(_ open: Bool) {
        lock.lock()
        defer { lock.unlock() }
        self.open = open
        revision &+= 1
    }

    /// Taken when a request starts; nil while the timeline is closed.
    func ticket() -> UInt64? {
        lock.lock()
        defer { lock.unlock() }
        return open ? revision : nil
    }

    /// `path` failed with `error` and `nextPath` is about to carry the same
    /// request. The last failure of a request has no next path and is never
    /// reported here, as on Windows.
    func record(path: String, nextPath: String, error: any Error, elapsedMs: Int, ticket: UInt64?) {
        guard let ticket, Self.labels.contains(path), Self.labels.contains(nextPath) else { return }
        let reason = Self.failureClass(error)
        // Held while appending, so a close (and the drain that follows it on
        // sign-out or a switch change) cannot be overtaken by this append.
        lock.lock()
        defer { lock.unlock() }
        guard open, revision == ticket else { return }
        buffer.record(
            "controlPlanePathFail",
            elapsedMs: max(0, elapsedMs),
            reason: reason,
            from: path,
            to: nextPath
        )
    }

    /// The Windows transport's classes: `dns`, `connect`, `tls`, `timeout`,
    /// `other`.
    static func failureClass(_ error: any Error) -> String {
        if CertificateClock.isDateFailure(error) || NetworkInterception.isTrustFailure(error) { return "tls" }
        let failure = error as NSError
        switch failure.domain {
        case NSURLErrorDomain:
            switch failure.code {
            case NSURLErrorCannotFindHost, NSURLErrorDNSLookupFailed:
                return "dns"
            case NSURLErrorTimedOut:
                return "timeout"
            case NSURLErrorSecureConnectionFailed,
                 NSURLErrorServerCertificateHasBadDate,
                 NSURLErrorServerCertificateUntrusted,
                 NSURLErrorServerCertificateHasUnknownRoot,
                 NSURLErrorServerCertificateNotYetValid,
                 NSURLErrorClientCertificateRejected,
                 NSURLErrorClientCertificateRequired:
                return "tls"
            case NSURLErrorCannotConnectToHost,
                 NSURLErrorNetworkConnectionLost,
                 NSURLErrorNotConnectedToInternet,
                 NSURLErrorInternationalRoamingOff,
                 NSURLErrorDataNotAllowed,
                 NSURLErrorCallIsActive:
                return "connect"
            default:
                return "other"
            }
        case NSPOSIXErrorDomain:
            return failure.code == Int(ETIMEDOUT) ? "timeout" : "connect"
        default:
            return "other"
        }
    }
}
