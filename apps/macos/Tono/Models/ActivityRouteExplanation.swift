import Foundation

nonisolated struct ActivityRouteExplanation: Codable {
    enum Path: String, Codable { case cloud, residential, direct, blocked, unknown }
    let path: Path
    let rule: String
    let chain: [String]

    init(connection: APIConnection, catalog: [ProxyNode], residentialTerminal: String?) {
        rule = String(connection.rule.prefix(100))
        chain = Array(connection.chains.prefix(16)).map { String($0.prefix(200)) }
        // The controller orders chains terminal-first. A selector alone, a
        // matched rule or the selected exit cannot prove where this flow went.
        guard let terminal = connection.chains.first else { path = .unknown; return }
        if terminal.uppercased().hasPrefix("REJECT") { path = .blocked }
        else if terminal == residentialTerminal { path = .residential }
        else if ["DIRECT", ConfigPipeline.directProxyName, ConfigPipeline.webDirectProxyName].contains(terminal) { path = .direct }
        else if catalog.contains(where: { $0.name == terminal }) { path = .cloud }
        else { path = .unknown }
    }

    var summary: String {
        switch path {
        case .cloud: String(localized: "This flow used a Tono cloud exit.")
        case .residential: String(localized: "This flow used the configured residential terminal, not just the cloud selector.")
        case .direct: String(localized: "This flow used a managed direct path. It did not use the cloud exit; this does not mean all protection is off.")
        case .blocked: String(localized: "The reported terminal blocked this flow.")
        case .unknown: String(localized: "The terminal route is unknown. A rule or selector name alone cannot prove the egress.")
        }
    }

    var ruleExplanation: String {
        let upper = rule.uppercased()
        if upper.contains("PROCESS") { return String(localized: "Tono matched an application rule for this flow.") }
        if upper.contains("DOMAIN") { return String(localized: "Tono matched a domain rule for this destination, not every connection from the application.") }
        if upper.contains("IP") { return String(localized: "Tono matched an address rule for this destination.") }
        if upper == "MATCH" || upper == "FINAL" { return String(localized: "No earlier rule matched; Tono used the default rule.") }
        return String(localized: "The controller reported the rule below. Its matching reason is not available.")
    }
}
