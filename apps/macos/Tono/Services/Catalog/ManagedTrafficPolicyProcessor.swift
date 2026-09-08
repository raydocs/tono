import Foundation
import CryptoKit

actor ManagedTrafficPolicyProcessor {
    private var persistedRevision = -1
    private var persistedDigest: String?

    func validate(
        _ cache: ManagedTrafficPolicyCache,
        protectedAddresses: Set<String>
    ) throws -> TonoTrafficPolicy {
        guard cache.revision >= 0,
              cache.json.utf8.count <= 64 * 1024,
              cache.sha256 == Self.digest(cache.json),
              let data = cache.json.data(using: .utf8),
              let policy = try? JSONDecoder().decode(
                TonoTrafficPolicy.self,
                from: data
              ),
              // Forward compatible. Pinning the accepted versions meant a revision
              // this build had not heard of discarded the whole document, so every
              // policy change needed a client release — and a missed release looks
              // exactly like an empty policy. The Windows client sat in that state
              // for days without a symptom anyone could name. A newer revision is
              // read as the newest shape this build knows; fields a declared
              // version does not promise are ignored below rather than required to
              // be absent.
              policy.version >= 1 else {
            throw TonoAPIClient.APIError.invalidResponse
        }
        let verdict = ManagedTrafficPolicySignature.verdict(
            json: cache.json,
            signature: cache.signature
        )
        if verdict == .untrustworthy {
            // Refused whole, unlike an entry this build does not understand. A
            // dropped entry is a document whose author is known and whose
            // contents are partly unsupported; a bad signature is a document
            // whose author is not known at all, and honouring any of it would
            // make the signature decorative.
            LocalTrafficAudit.shared.recordEvent(
                "managed_direct_policy_signature_rejected",
                details: [
                    "revision": String(cache.revision),
                    "policy_version": String(policy.version),
                ]
            )
            throw TonoAPIClient.APIError.invalidResponse
        }
        let trusted = verdict == .trusted
        // Trimmed rather than refused. A published list longer than this build's
        // limit means the limit is stale, and answering that by routing nothing at
        // all is worse than routing the part that fits.
        let declaredWeb = policy.version >= 2 ? Array(policy.webDomains.prefix(32)) : []
        let declaredSuffixes = policy.version >= 3 ? Array(policy.directSuffixes.prefix(64)) : []
        let declaredTCP = policy.version >= 4 ? Array(policy.tcpEndpoints.prefix(64)) : []
        let policyDomains = Array(policy.domains.prefix(32))
        let policyMedia = Array(policy.mediaEndpoints.prefix(64))

        // Dropped, not fatal, from here down. An entry this build will not honour is
        // still not routed — the safety property is unchanged — but it no longer
        // takes every other route in the document with it. Every drop is named in
        // `dropped` and recorded by the caller: replacing "silently discarded
        // everything" with "silently discarded some" would be the same fault.
        var dropped: [String] = []
        var seenHosts = Set<String>()
        let domains = policyDomains.compactMap { entry -> TonoTrafficPolicyDomain? in
            guard let host = try? ConfigPipeline.validatedManagedDirectDomain(entry.host, trusted: trusted),
                  host == entry.host,
                  seenHosts.insert(host).inserted,
                  !entry.ports.isEmpty,
                  Set(entry.ports).count == entry.ports.count,
                  entry.ports.allSatisfy({ $0 == 80 || $0 == 443 }) else {
                dropped.append(entry.host)
                return nil
            }
            return TonoTrafficPolicyDomain(
                host: host,
                ports: entry.ports.sorted()
            )
        }.sorted { $0.host < $1.host }

        var seenAddresses = Set<String>()
        let media = policyMedia.compactMap { entry -> TonoTrafficPolicyMediaEndpoint? in
            guard let address = try? ConfigPipeline.validatedManagedDirectAddress(
                    entry.address,
                    field: "managed media address",
                    trusted: trusted
                  ),
                  address == entry.address,
                  !protectedAddresses.contains(address),
                  seenAddresses.insert(address).inserted,
                  !entry.ports.isEmpty,
                  Set(entry.ports).count == entry.ports.count,
                  entry.ports.allSatisfy({ $0 == 443 || $0 == 8000 }) else {
                dropped.append(entry.address)
                return nil
            }
            return TonoTrafficPolicyMediaEndpoint(
                address: address,
                ports: entry.ports.sorted()
            )
        }.sorted { $0.address < $1.address }

        var seenTCPAddresses = Set<String>()
        let tcp = declaredTCP.compactMap { entry -> TonoTrafficPolicyMediaEndpoint? in
            guard let address = try? ConfigPipeline.validatedManagedDirectAddress(
                    entry.address,
                    field: "managed TCP address",
                    trusted: trusted
                  ),
                  address == entry.address,
                  !protectedAddresses.contains(address),
                  seenTCPAddresses.insert(address).inserted,
                  !entry.ports.isEmpty,
                  Set(entry.ports).count == entry.ports.count,
                  entry.ports.allSatisfy({ $0 == 80 || $0 == 443 }) else {
                dropped.append(entry.address)
                return nil
            }
            return TonoTrafficPolicyMediaEndpoint(
                address: address,
                ports: entry.ports.sorted()
            )
        }.sorted { $0.address < $1.address }

        let webDomains = declaredWeb.compactMap { entry -> TonoTrafficPolicyDomain? in
            guard let host = try? ConfigPipeline.validatedWebDirectDomain(entry.host, trusted: trusted),
                  host == entry.host,
                  seenHosts.insert(host).inserted,
                  entry.ports == [443] else {
                dropped.append(entry.host)
                return nil
            }
            return TonoTrafficPolicyDomain(host: host, ports: [443])
        }.sorted { $0.host < $1.host }

        var seenSuffixes = Set<String>()
        let directSuffixes = declaredSuffixes.compactMap { entry -> TonoTrafficPolicyDomain? in
            guard let host = try? ConfigPipeline.validatedManagedDirectSuffix(entry.host, trusted: trusted),
                  host == entry.host,
                  seenSuffixes.insert(host).inserted,
                  !entry.ports.isEmpty,
                  Set(entry.ports).count == entry.ports.count,
                  entry.ports.allSatisfy({ $0 == 80 || $0 == 443 }) else {
                dropped.append(entry.host)
                return nil
            }
            return TonoTrafficPolicyDomain(
                host: host,
                ports: entry.ports.sorted()
            )
        }.sorted { $0.host < $1.host }

        if !dropped.isEmpty || policy.version > 4 {
            // Recorded because degrading is only an improvement while it is visible.
            // Hosts are named: which entry a build does not understand is the whole
            // diagnostic, and a count alone would have said nothing useful about the
            // Windows client running for days with no policy.
            LocalTrafficAudit.shared.recordEvent(
                "managed_direct_policy_entries_dropped",
                details: [
                    "revision": String(cache.revision),
                    "policy_version": String(policy.version),
                    "dropped": String(dropped.count),
                    // Bounded: a report is a diagnostic, not a copy of the document.
                    "hosts": dropped.sorted().prefix(12).joined(separator: ","),
                    "newer_than_known": String(policy.version > 4),
                    // Which gate did the dropping: an allowlist this build ships,
                    // or this build's own limits. Without it a signed policy whose
                    // new hosts were dropped anyway is indistinguishable from an
                    // unsigned one.
                    "trusted": String(trusted),
                ]
            )
        }
        return TonoTrafficPolicy(
            version: policy.version,
            domains: domains,
            mediaEndpoints: media,
            tcpEndpoints: tcp,
            webDomains: webDomains,
            directSuffixes: directSuffixes,
            trusted: trusted
        )
    }

    func persistIfNewest(_ cache: ManagedTrafficPolicyCache) throws {
        // This actor has no lifetime across launches. Re-check the existing
        // authenticated cache before writing so a late old response cannot
        // replace a newer policy just because the actor's in-memory revision
        // floor was reset to -1.
        // A signature arriving for a revision already on disk is a write worth
        // making, not a no-op. A build predating verification cached this revision
        // without one, and skipping the write here would leave every upgraded
        // install permanently reading it as unsigned — so the first policy that
        // needs a signature would be dropped on exactly those machines.
        var signatureIsNew = false
        if let persisted = ConfigStorage.shared.loadManagedTrafficPolicy() {
            if persisted.revision > cache.revision { return }
            if persisted.revision == cache.revision,
               persisted.sha256 != cache.sha256 {
                throw TonoAPIClient.APIError.invalidResponse
            }
            if persisted.revision == cache.revision {
                switch ManagedTrafficPolicySignature.sameRevisionTransition(
                    from: persisted.signature,
                    to: cache.signature
                ) {
                case .unchanged:
                    break
                case .upgradeToTrusted:
                    signatureIsNew = true
                case .downgradeAttempt:
                    // An unsigned response cannot erase authorship already
                    // established for these exact bytes.
                    return
                case .replacementAttempt:
                    throw TonoAPIClient.APIError.invalidResponse
                }
            }
        }
        if cache.revision < persistedRevision { return }
        if cache.revision == persistedRevision, !signatureIsNew {
            guard persistedDigest == cache.sha256 else {
                throw TonoAPIClient.APIError.invalidResponse
            }
            return
        }
        try ConfigStorage.shared.saveManagedTrafficPolicy(cache)
        persistedRevision = cache.revision
        persistedDigest = cache.sha256
    }

    private static func digest(_ value: String) -> String {
        let digest = Data(SHA256.hash(data: Data(value.utf8)))
            .base64EncodedString()
        return digest
            .replacingOccurrences(of: "=", with: "")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
    }
}
