import Foundation

/// Support code for a QUIC idle drop on the same-node Hysteria2 hop.
///
/// The customer-facing sentence does not ask them to change server or network.
/// Raw core text stays on the annotated diagnostic, not in this sentence.
enum Hy2IdleSupport {
    static let singBoxKeepAlivePeriod = "5s"
    static let supportCode = "TONO_CONNECT_HY2_IDLE"

    static var userMessage: String {
        String(
            localized: "The UDP backup path went idle and the home router likely dropped it. Tono stays on this same route and retries. Support code TONO_CONNECT_HY2_IDLE. Send diagnostics if it keeps happening."
        )
    }

    static func isQuicIdle(_ message: String) -> Bool {
        let lower = message.lowercased()
        return lower.contains("no recent network activity")
            || lower.contains("idletimeout")
            || lower.contains("idle timeout")
    }

    static func annotate(_ message: String) -> String {
        guard isQuicIdle(message), !message.contains(supportCode) else { return message }
        return "\(supportCode): \(message)"
    }
}
