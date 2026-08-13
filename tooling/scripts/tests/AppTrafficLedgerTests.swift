// Compiled and run by tooling/scripts/test-app-traffic-ledger.sh.
//
// The ledger exists because Mihomo forgets a connection's bytes the moment it
// closes, so the two things worth testing are that a closed connection's bytes
// survive and that a flow is filed under the path it actually took. Both are
// silent when wrong: the totals still look plausible.
import Foundation

// Minimal stand-ins for the two types the ledger reads. Field-for-field with the
// real ClashAPI models it is compiled against in the app.
struct APIConnectionMetadata: Codable, Sendable {
    let network: String
    let type: String
    let process: String?
    let processPath: String?
    let sourceIP: String?
    let destinationIP: String?
    let sourcePort: String?
    let destinationPort: String?
    let host: String
}

struct APIConnection: Codable, Sendable {
    let id: String
    let metadata: APIConnectionMetadata
    let upload: Int64
    let download: Int64
    let start: String
    let chains: [String]
    let rule: String
    let rulePayload: String?
}

enum ConfigPipeline {
    static let homeResidentialProxyName = "Tono-Home-Residential"
    static let claudeHomeGroupName = "Tono-Claude-Home"
    static let exitGroupName = "Tono-Exit"
    static let directProxyName = "Tono-China-Direct"
    static let webDirectProxyName = "Tono-China-Web-Direct"

    static func isClaudeCodeIdentity(process: String, processPath: String) -> Bool {
        let path = processPath.lowercased()
        if process == "claude" || process == "claude.exe" { return true }
        if path.contains("/.local/share/claude/versions/") { return true }
        if path.contains("/node_modules/@anthropic-ai/claude-code/") { return true }
        return false
    }

    static func isClaudeAppIdentity(process: String, processPath: String) -> Bool {
        let path = processPath.lowercased()
        if path.contains("/claude.app/") { return true }
        if process == "Claude" || process.hasPrefix("Claude Helper") { return true }
        return false
    }
}

func connection(
    _ id: String,
    process: String?,
    up: Int64,
    down: Int64,
    chains: [String],
    rule: String = "Match",
    processPath: String? = nil
) -> APIConnection {
    APIConnection(
        id: id,
        metadata: APIConnectionMetadata(
            network: "tcp", type: "Tun", process: process, processPath: processPath,
            sourceIP: "198.18.0.1", destinationIP: "203.0.113.7",
            sourcePort: "1", destinationPort: "443", host: "example.test"
        ),
        upload: up, download: down, start: "", chains: chains,
        rule: rule, rulePayload: nil
    )
}

@main
struct AppTrafficLedgerTests {
    @MainActor
    static func main() {
        var failures = 0
        func check(_ name: String, _ ok: Bool, _ detail: String = "") {
            print(ok ? "  ok   \(name)" : "  FAIL \(name) \(detail)")
            if !ok { failures += 1 }
        }
        func app(_ ledger: AppTrafficLedger, _ name: String) -> AppTrafficLedger.AppTotals? {
            ledger.apps.first { $0.id == name }
        }

        // --- route classification ---------------------------------------
        let cases: [(String, [String], String, AppTrafficLedger.RouteClass)] = [
            ("direct group", ["Tono-China-Direct", "Tono-China-App"], "Match", .direct),
            ("web direct", ["Tono-China-Web-Direct", "Tono-China-Web"], "Match", .direct),
            ("bare DIRECT", ["DIRECT"], "Match", .direct),
            ("tunnel", ["US-VLESS-Reality", "Tono-Exit"], "Match", .tunnel),
            ("residential", ["Tono-Home-Residential", "Tono-Claude-Home"], "Match", .residential),
            // The residential hop is dialled through the exit, so its chain
            // carries the exit too; the more specific class must win.
            ("residential over exit",
             ["Tono-Home-Residential", "Tono-Exit", "Tono-Claude-Home"], "Match", .residential),
            // homeProxy names a catalog node, not Tono-Home-Residential.
            ("homeProxy node", ["US-Home-Broadband", "Tono-Claude-Home"], "Match", .residential),
            ("homeProxy failed over",
             ["US-VLESS-Reality", "Tono-Exit", "Tono-Claude-Home"], "Match", .tunnel),
            ("reject by rule", ["REJECT"], "REJECT", .blocked),
            ("empty chain", [], "Match", .direct),
        ]
        for (name, chains, rule, expected) in cases {
            let actual = AppTrafficLedger.routeClass(
                for: connection("c", process: "X", up: 1, down: 1, chains: chains, rule: rule)
            )
            check("classify \(name)", actual == expected, "got \(actual)")
        }

        // --- bytes survive a closed connection ---------------------------
        let ledger = AppTrafficLedger()
        ledger.ingest([
            connection("a", process: "WeChat", up: 100, down: 900,
                       chains: ["Tono-China-Direct", "Tono-China-App"]),
        ])
        ledger.ingest([
            connection("a", process: "WeChat", up: 150, down: 1_400,
                       chains: ["Tono-China-Direct", "Tono-China-App"]),
        ])
        check("counters are diffed, not summed",
              app(ledger, "WeChat")?.total == 1_550,
              "got \(app(ledger, "WeChat")?.total ?? -1)")
        ledger.ingest([])                                   // connection closed
        check("closed connection keeps its bytes",
              app(ledger, "WeChat")?.total == 1_550,
              "got \(app(ledger, "WeChat")?.total ?? -1)")
        check("live count drops to zero",
              app(ledger, "WeChat")?.liveConnections == 0)
        // A reused id whose counters restart must not subtract.
        ledger.ingest([
            connection("a", process: "WeChat", up: 10, down: 20,
                       chains: ["Tono-China-Direct"]),
        ])
        check("reused id counts as new, never negative",
              app(ledger, "WeChat")?.total == 1_580,
              "got \(app(ledger, "WeChat")?.total ?? -1)")

        // --- split and ordering ------------------------------------------
        let split = AppTrafficLedger()
        split.ingest([
            connection("d", process: "WeChat", up: 0, down: 800,
                       chains: ["Tono-China-Direct", "Tono-China-App"]),
            connection("t", process: "WeChat", up: 0, down: 200,
                       chains: ["US-VLESS-Reality", "Tono-Exit"]),
            connection("c", process: "Claude", up: 0, down: 5_000,
                       chains: ["Tono-Home-Residential", "Tono-Claude-Home"]),
            connection("u", process: nil, up: 0, down: 7,
                       chains: ["DIRECT"]),
        ])
        check("per-app split is by path",
              app(split, "WeChat")?.split.direct == 800
                  && app(split, "WeChat")?.split.tunnel == 200,
              "got \(String(describing: app(split, "WeChat")?.split))")
        check("residential is its own bucket",
              app(split, "Claude")?.split.residential == 5_000)
        check("no process is named, not dropped",
              app(split, AppTrafficLedger.unattributed)?.total == 7)
        check("overall equals the sum of parts",
              split.overall.total == 6_007, "got \(split.overall.total)")
        check("busiest app sorts first", split.apps.first?.id == "Claude",
              "got \(split.apps.first?.id ?? "nil")")

        let grouped = AppTrafficLedger()
        grouped.ingest([
            connection(
                "v", process: "2.1.225", up: 0, down: 100,
                chains: ["US-Home-Broadband", "Tono-Claude-Home"],
                processPath: "/Users/x/.local/share/claude/versions/2.1.225"
            ),
            connection(
                "h", process: "Claude Helper", up: 0, down: 40,
                chains: ["US-Home-Broadband", "Tono-Claude-Home"],
                processPath: "/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper"
            ),
        ])
        check("versioned Claude Code groups under Claude Code",
              app(grouped, "Claude Code")?.total == 100,
              "got \(app(grouped, "Claude Code")?.total ?? -1)")
        check("desktop helper groups under Claude",
              app(grouped, "Claude")?.total == 40,
              "got \(app(grouped, "Claude")?.total ?? -1)")
        let wechat = AppTrafficLedger()
        wechat.ingest([
            connection(
                "wx", process: "WeChatAppEx", up: 0, down: 70,
                chains: ["Tono-China-Direct", "Tono-China-App"],
                processPath: "/Applications/WeChat.app/Contents/Frameworks/WeChatAppEx.framework/Helpers/WeChatAppEx"
            ),
        ])
        check("WeChat helper groups under WeChat",
              app(wechat, "WeChat")?.total == 70,
              "got \(app(wechat, "WeChat")?.total ?? -1)")
        let codex = AppTrafficLedger()
        codex.ingest([
            connection(
                "cx", process: "codex", up: 0, down: 30,
                chains: ["US-Home-Broadband", "Tono-Claude-Home"],
                processPath: "/Users/x/.local/share/codex/0.1.0/codex"
            ),
        ])
        check("Codex CLI groups under Codex",
              app(codex, "Codex")?.total == 30,
              "got \(app(codex, "Codex")?.total ?? -1)")
        check("homeProxy node bytes are residential",
              app(grouped, "Claude Code")?.split.residential == 100)

        // --- reset --------------------------------------------------------
        split.reset()
        check("reset clears everything",
              split.apps.isEmpty && split.overall.total == 0)

        print(failures == 0 ? "\nall ledger checks passed" : "\n\(failures) FAILED")
        exit(failures == 0 ? 0 : 1)
    }
}
