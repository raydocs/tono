import CryptoKit
import Foundation

/// Verifies that a managed traffic policy was authored by the holder of the
/// offline policy signing key.
///
/// The trust model is the one the app updater already uses: a private key that
/// never leaves the operator's machine, a public key compiled into the client.
/// The client checks *who wrote* the document rather than *what it contains*,
/// which is what allows the compiled-in host allowlist to be bypassed and makes
/// adding a domain a change to the server alone.
///
/// The control plane never holds the private key. If it did, taking the control
/// plane would be enough to publish a policy pulling arbitrary hosts out of every
/// tunnel, and the allowlist exists to prevent exactly that.
nonisolated enum ManagedTrafficPolicySignature {
    /// Public half of the production signing key, standard base64, 32 bytes.
    /// Mirrors TRAFFIC_POLICY_PUBLIC_KEY in services/control-plane/wrangler.jsonc.
    static let publicKeyBase64 = "Sf2burVHXZWzYikU0FlC+N64BeRZJxJe8XaneblmTkM="

    /// Prefixed to the signed bytes. Mirrors TRAFFIC_POLICY_SIGNATURE_CONTEXT in
    /// services/control-plane/src/crypto.ts. Domain separation: a signature this
    /// key made over some other document must not be presentable as a policy
    /// signature, and a key that only signs policies today does not stay that
    /// way. All implementations must prefix identically or nothing verifies.
    static let context = "tono-traffic-policy-v1\n"

    enum Verdict: Equatable {
        /// No signature. Validate against the compiled-in allowlist, which is
        /// what every build did before signing existed.
        case unsigned
        /// Signed by the expected key over exactly these bytes.
        case trusted
        /// A signature is present and does not verify. Not the same as unsigned:
        /// somebody attached a signature to this document, so its authorship is
        /// in question and the whole revision is refused rather than quietly
        /// falling back to the allowlist — a fallback would let anyone strip
        /// trust by corrupting one field.
        case untrustworthy
    }

    /// `publicKeyBase64` is a parameter with the production key as its default so
    /// the verification logic can be exercised against a throwaway keypair. Every
    /// caller in the app uses the default; passing another key does not weaken
    /// anything, because a caller that could choose the key could equally skip
    /// the check.
    static func verdict(
        json: String,
        signature: String?,
        publicKeyBase64: String = Self.publicKeyBase64
    ) -> Verdict {
        guard let signature, !signature.isEmpty else { return .unsigned }
        guard let keyData = Data(base64Encoded: publicKeyBase64),
              let signatureData = Data(base64Encoded: signature),
              signatureData.count == 64,
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: keyData),
              let message = (context + json).data(using: .utf8) else {
            return .untrustworthy
        }
        return key.isValidSignature(signatureData, for: message) ? .trusted : .untrustworthy
    }
}
