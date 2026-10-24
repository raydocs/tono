let checks: [(String, ([String: Any]) -> Bool)] = [
    ("DoT/DoQ", { $0["port"] as? [Int] == [853] }),
    ("STUN ports", { $0["port"] as? [Int] == Array(19302...19309) }),
    ("public STUN", { ($0["domain_suffix"] as? [String])?.contains("stun.cloudflare.com") == true && $0["action"] as? String == "reject" }),
    ("overseas IPv4", { ($0["ip_cidr"] as? [String])?.contains("74.125.0.0/16") == true && $0["network"] as? [String] == ["udp", "icmp"] }),
    ("overseas IPv6", { ($0["ip_cidr"] as? [String])?.contains("2001:4860::/32") == true && $0["network"] as? [String] == ["udp", "icmp"] })
]
var failures = 0
for variant in [ThreeTierRoutingContract.Variant.threeTier, .aiHome] {
    let graph = try ThreeTierRoutingContract.graph(home: "Tono-Home-Residential", physicalInterface: "en0", fakeRange: "198.18.128.0/20", variant: variant)
    let rules = (graph["route"] as! [String: Any])["rules"] as! [[String: Any]]
    let dns = rules.lastIndex { $0["action"] as? String == "hijack-dns" }!
    let route = rules.firstIndex { $0["action"] as? String == "route" }!
    for (label, predicate) in checks {
        let index = rules.firstIndex(where: predicate)
        let passed = index.map { $0 > dns && $0 < route && rules[$0]["action"] as? String == "reject" } ?? false
        print("\(passed ? "PASS" : "FAIL") \(variant) \(label) before routing")
        if !passed { failures += 1 }
    }
    let dnsRules = (graph["dns"] as! [String: Any])["rules"] as! [[String: Any]]
    let passed = dnsRules[0]["query_type"] as? [Int] == [65, 64] && dnsRules[0]["action"] as? String == "predefined"
    print("\(passed ? "PASS" : "FAIL") \(variant) HTTPS/SVCB before DNS routing")
    if !passed { failures += 1 }
}
exit(failures == 0 ? 0 : 1)
