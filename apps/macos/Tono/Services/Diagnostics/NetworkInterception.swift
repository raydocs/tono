import Foundation
import Network
import os
import Security

/// H21-O-F8: recognise a network that intercepts Tono's encrypted connections.
///
/// Classification only, of errors the system TLS stack already produced for a
/// control-plane exchange. Trust evaluation stays the system default
/// everywhere: the refused certificate is never accepted, and no probe is
/// sent. It names the cause in the error the user reads and adds the
/// `tlsIntercepted` class token to the support report; it changes no route,
/// PF rule or helper state and takes no part in the connect decision.
///
/// macOS offers no public captive-portal signal and Tono has no plain-HTTP
/// probe, so a portal that answers for Tono's host with its own certificate
/// is reported here too; the sentence covers finishing a web sign-in.
nonisolated enum NetworkInterception {
    /// Class token for `TonoSupportReport.virtualAdapters`. Never a host name,
    /// a URL or certificate content.
    static let diagnosticsClass = "tlsIntercepted"

    /// Set on an error whose paths' combined text no longer carries the
    /// refused-certificate error itself.
    static let evidenceKey = "TonoInterceptedCertificate"

    static var userMessage: String {
        String(localized: "This network is intercepting encrypted connections: something between this Mac and Tono replaced Tono's certificate, and Tono will not accept it. If this network has a sign-in page, finish it in a browser; otherwise turn off any proxy or security software that inspects HTTPS, then retry.")
    }

    /// A server certificate the system trust store refused for its issuer,
    /// chain or name. A certificate this Mac's clock cannot date is the
    /// clock's (#588), never interception.
    static func isTrustFailure(_ error: any Error) -> Bool {
        !CertificateClock.isDateFailure(error) && refusedCertificate(error)
    }

    private static func refusedCertificate(_ error: any Error) -> Bool {
        if let error = error as? NWError {
            if case let .tls(status) = error { return trustStatuses.contains(status) }
            return false
        }
        let error = error as NSError
        if error.userInfo[evidenceKey] as? Bool == true { return true }
        if error.domain == NSURLErrorDomain,
           error.code == NSURLErrorServerCertificateUntrusted
            || error.code == NSURLErrorServerCertificateHasUnknownRoot {
            return true
        }
        if error.domain == NSOSStatusErrorDomain, trustStatuses.contains(OSStatus(truncatingIfNeeded: error.code)) {
            return true
        }
        // URLSession carries the Secure Transport status of a failed handshake here.
        if let stream = error.userInfo["_kCFStreamErrorCodeKey"] as? Int,
           trustStatuses.contains(OSStatus(truncatingIfNeeded: stream)) {
            return true
        }
        if let underlying = error.userInfo[NSUnderlyingErrorKey] as? any Error {
            return refusedCertificate(underlying)
        }
        return false
    }

    private static let trustStatuses: Set<OSStatus> = [
        -9807, // errSSLXCertChainInvalid
        -9812, // errSSLUnknownRootCert
        -9813, // errSSLNoRootCert
        -9843, // errSSLHostNameMismatch
        errSecNotTrusted,
        errSecHostNameMismatch,
    ]

    private static let observed = OSAllocatedUnfairLock(initialState: false)

    /// Whether the last control-plane exchange that said anything about the
    /// network met a refused certificate. An answer clears it.
    static var wasObserved: Bool { observed.withLock { $0 } }

    static func record(intercepted: Bool) {
        observed.withLock { $0 = intercepted }
    }
}
