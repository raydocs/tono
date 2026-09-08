import Foundation
import CryptoKit

actor ManagedCatalogProcessor {
    private var persistedRevision = -1
    private var persistedDigest: String?
    private var persistedRoutingToken: String?

    func validate(
        _ catalog: ManagedExitCatalogCache,
        customNodes: [ProxyNode]
    ) throws -> [ProxyNode] {
        guard catalog.revision >= 0,
              catalog.yaml.utf8.count <= 1024 * 1024,
              catalog.sha256 == Self.digest(catalog.yaml)
        else {
            throw TonoAPIClient.APIError.invalidResponse
        }

        var nodes = ConfigParser.parseSubscription(catalog.yaml)
        if nodes.isEmpty {
            guard catalog.yaml.trimmingCharacters(
                in: .whitespacesAndNewlines
            ) == "proxies: []" else {
                throw TonoAPIClient.APIError.invalidResponse
            }
        }
        for index in nodes.indices {
            nodes[index].subscriptionId = ManagedCatalogIdentity.sourceID
        }
        nodes = try ConfigPipeline.validatedOwnedNodes(nodes)
        nodes = ConfigPipeline.orderedCloudExits(
            nodes,
            preferredName: AppProfile.defaultCloudExitName
        )
        _ = try ConfigPipeline.validatedOwnedNodes(nodes + customNodes)

        return nodes
    }

    /// Manual refresh and the minute timer may overlap. Preserve monotonic
    /// cache writes even if their validations finish out of order.
    func persistIfNewest(
        _ catalog: ManagedExitCatalogCache,
        routingToken: String
    ) throws {
        if catalog.revision < persistedRevision {
            return
        }
        // The revision is fleet-wide while the body is issued per account, so a
        // matching revision carrying a different digest is the next account's
        // own payload, not a conflicting copy of this one. The routing document
        // is per account too and moves no revision at all, so it carries its
        // own freshness token into the same comparison.
        if catalog.revision == persistedRevision,
           persistedDigest == catalog.sha256,
           persistedRoutingToken == routingToken {
            return
        }
        try ConfigStorage.shared.saveManagedExitCatalog(catalog)
        persistedRevision = catalog.revision
        persistedDigest = catalog.sha256
        persistedRoutingToken = routingToken
    }

    /// Releases the write gate when the cache it describes has been discarded,
    /// so the next account's catalog is not compared against a revision and
    /// digest that no longer exist on disk.
    func reset() {
        persistedRevision = -1
        persistedDigest = nil
        persistedRoutingToken = nil
    }

    private static func digest(_ yaml: String) -> String {
        let digest = Data(SHA256.hash(data: Data(yaml.utf8)))
            .base64EncodedString()
        return digest
            .replacingOccurrences(of: "=", with: "")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
    }
}
