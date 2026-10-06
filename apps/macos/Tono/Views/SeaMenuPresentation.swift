import Foundation

enum SeaMenuPresentation {
    enum QuickRouteAction {
        case reviewRecommendation(RouteRecommendation)
        case selectManualNode(String)
    }

    static func action(for node: ProxyNode, recommendation: RouteRecommendation?) -> QuickRouteAction {
        if let recommendation, recommendation.name == node.name {
            return .reviewRecommendation(recommendation)
        }
        return .selectManualNode(node.name)
    }

    /// At most two existing catalog identities: recommendation, then favorites.
    static func quickRoutes(catalog: [ProxyNode], recommended: String?, favorites: Set<String>, selected: String?) -> [ProxyNode] {
        let eligible = catalog.filter { !ProxyNode.hy2UdpIsVendorBlocked($0.name) }
        let recommendedNode = eligible.first { $0.name == recommended }
        let favorites = eligible.filter { favorites.contains(ProxyNode.catalogBaseName(for: $0.name)) }
        var seen = Set<String>()
        if let selected { seen.insert(ProxyNode.catalogBaseName(for: selected)) }
        var result: [ProxyNode] = []
        for node in (recommendedNode.map { [$0] } ?? []) + favorites {
            guard seen.insert(ProxyNode.catalogBaseName(for: node.name)).inserted else { continue }
            result.append(node)
            if result.count == 2 { break }
        }
        return result
    }
}
