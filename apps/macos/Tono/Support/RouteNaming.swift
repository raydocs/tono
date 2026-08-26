import Foundation

/// The user-facing name for a rule's target.
///
/// The rules table used to print `rule.proxy` verbatim, so a consumer reading
/// their own routing saw `DIRECT`, `REJECT`, and `Tono-Home-Residential` —
/// mihomo's vocabulary, not the product's. Everywhere else in the app these
/// same routes are already called 直连 / 已拒绝 / 家宽, so this returns those.
func ruleTargetTitle(_ target: String) -> String {
    switch target {
    case "DIRECT":
        return String(localized: "Direct")
    case "REJECT", "REJECT-DROP":
        return String(localized: "Rejected")
    case ConfigPipeline.exitGroupName:
        return String(localized: "Proxied")
    case ConfigPipeline.homeResidentialProxyName, ConfigPipeline.claudeHomeGroupName:
        return String(localized: "Home")
    case ConfigPipeline.directProxyName, ConfigPipeline.webDirectProxyName:
        return String(localized: "Direct")
    default:
        // A catalog node: show the localized city the rest of the app shows.
        return nodeCityTitle(ProxyNode.displayName(for: target))
    }
}
