import Foundation

actor ProviderRuleLoader {
    private static let maximumProviderBytes = 8 * 1_024 * 1_024
    private static let maximumRules = 200_000

    func load(
        providers: [String: APIRuleProvider],
        inlineRules: [APIRule],
        directory: URL
    ) -> [APIRule] {
        var providerProxyMap: [String: String] = [:]
        for rule in inlineRules
            where rule.type == "RuleSet" || rule.type == "RULE-SET"
        {
            providerProxyMap[rule.payload] = rule.proxy
        }

        var allRules: [APIRule] = []
        for (name, provider) in providers.sorted(by: { $0.key < $1.key }) {
            guard name.utf8.count <= 255,
                  !name.contains("/"),
                  !name.contains("\\"),
                  name != ".",
                  name != ".." else { continue }
            let filePath = directory.appendingPathComponent("\(name).yaml")
            guard let values = try? filePath.resourceValues(forKeys: [
                .isRegularFileKey,
                .isSymbolicLinkKey,
                .fileSizeKey,
            ]),
                  values.isRegularFile == true,
                  values.isSymbolicLink != true,
                  let size = values.fileSize,
                  size > 0,
                  size <= Self.maximumProviderBytes,
                  let content = try? String(contentsOf: filePath, encoding: .utf8)
            else { continue }

            let proxyTarget = providerProxyMap[name] ?? name
            let behavior = provider.behavior.lowercased()
            let defaultType = behavior == "ipcidr" ? "IP-CIDR" : "DOMAIN"
            for line in content.components(separatedBy: .newlines) {
                guard allRules.count < Self.maximumRules else { return allRules }
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                guard trimmed.hasPrefix("- ") else { continue }
                let value = String(trimmed.dropFirst(2))
                    .trimmingCharacters(in: CharacterSet(charactersIn: "'\""))
                guard !value.isEmpty else { continue }

                if behavior == "classical" {
                    let parts = value.split(separator: ",", maxSplits: 1)
                    if parts.count == 2 {
                        allRules.append(APIRule(
                            type: String(parts[0]),
                            payload: String(parts[1]),
                            proxy: proxyTarget
                        ))
                    } else {
                        allRules.append(APIRule(
                            type: defaultType,
                            payload: value,
                            proxy: proxyTarget
                        ))
                    }
                } else {
                    let cleanValue = value.hasPrefix("+.")
                        ? String(value.dropFirst(2))
                        : value
                    allRules.append(APIRule(
                        type: defaultType,
                        payload: cleanValue,
                        proxy: proxyTarget
                    ))
                }
            }
        }
        return allRules
    }
}
