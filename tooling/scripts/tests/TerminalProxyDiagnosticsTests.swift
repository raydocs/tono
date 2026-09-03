import Foundation

private struct TestFailure: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

@main
private struct TerminalProxyDiagnosticsTests {
    static func main() throws {
        let text = """
        # export HTTP_PROXY=http://comment.example
        export HTTP_PROXY=http://127.0.0.1:7890
        $env:https_proxy = 'http://localhost:8080'
        set -gx ALL_PROXY socks5://127.0.0.1:1080
        set --export HTTPS_PROXY http://代理.example:8080
        unset all_proxy
        $env:all_proxy = $null
        """
        let assignments = TerminalProxyDiagnostics.assignments(in: text)
        guard assignments["HTTP_PROXY"] == "http://127.0.0.1:7890",
              assignments["https_proxy"] == "http://localhost:8080",
              assignments["ALL_PROXY"] == "socks5://127.0.0.1:1080",
              assignments["HTTPS_PROXY"] == "http://代理.example:8080",
              assignments.count == 4 else {
            throw TestFailure("shell/PowerShell assignment detection was not exact")
        }

        let reinfecting = TerminalProxyDiagnostics.assignments(in: """
        if command -v claude >/dev/null; then export HTTP_PROXY=http://conditional.example:8080; fi
        function Invoke-Claude { $env:HTTPS_PROXY = 'http://powershell-function.example:8080'; claude }
        launchctl setenv ALL_PROXY socks5://launchd.example:1080
        setx http_proxy http://future-shells.example:3128
        alias claude='env https_proxy=http://alias.example:8080 claude'
        SETUVAR --export ALL_PROXY:socks5\\x3a//fish-universal.example\\x3a1080
        """)
        guard reinfecting["HTTP_PROXY"] == "http://conditional.example:8080",
              reinfecting["HTTPS_PROXY"] == "http://powershell-function.example:8080",
              reinfecting["https_proxy"] == "http://alias.example:8080",
              reinfecting["ALL_PROXY"] == "socks5\\x3a//fish-universal.example\\x3a1080",
              reinfecting["http_proxy"] == "http://future-shells.example:3128" else {
            throw TestFailure("conditional or reinfecting proxy commands were missed")
        }

        let itemCommands = TerminalProxyDiagnostics.assignments(in: """
        function Set-ClaudeProxy { New-Item -LiteralPath Env:ALL_PROXY -Value 'socks5://powershell-item.example:1080' }
        """)
        guard itemCommands["ALL_PROXY"] == "socks5://powershell-item.example:1080" else {
            throw TestFailure("PowerShell environment item assignment was missed")
        }

        let launchctl = TerminalProxyDiagnostics.launchctlAssignments(
            read: { key in
                key == "http_proxy" ? "http://gui-parent.example:7890\n" : ""
            }
        )
        guard launchctl == ["http_proxy": "http://gui-parent.example:7890"] else {
            throw TestFailure("launchctl proxy environment was not inspected")
        }

        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-terminal-proxy-\(UUID().uuidString)")
        let home = root.appendingPathComponent("home")
        let appSupport = root.appendingPathComponent("Application Support")
        let managedSettings = root.appendingPathComponent("managed ClaudeCode")
        let workspace = root.appendingPathComponent("workspace with spaces")
        defer { try? FileManager.default.removeItem(at: root) }
        for directory in [
            home,
            home.appendingPathComponent(".config/fish/conf.d"),
            home.appendingPathComponent(".config/powershell"),
            home.appendingPathComponent(".claude"),
            managedSettings.appendingPathComponent("managed-settings.d"),
            appSupport.appendingPathComponent("Code/User/workspaceStorage/one"),
            appSupport.appendingPathComponent("Code/User/profiles/work"),
            workspace.appendingPathComponent(".claude"),
            workspace.appendingPathComponent(".vscode"),
        ] {
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true
            )
        }
        try "export http_proxy=http://shell.example".write(
            to: home.appendingPathComponent(".zshrc"),
            atomically: true,
            encoding: .utf8
        )
        try "export HTTPS_PROXY=http://bash-login.example".write(
            to: home.appendingPathComponent(".bash_login"),
            atomically: true,
            encoding: .utf8
        )
        try "set -gx all_proxy socks5://fish-conf-d.example".write(
            to: home.appendingPathComponent(".config/fish/conf.d/proxy.fish"),
            atomically: true,
            encoding: .utf8
        )
        try "SETUVAR --export HTTP_PROXY:http\\x3a//fish-universal.example".write(
            to: home.appendingPathComponent(".config/fish/fish_variables"),
            atomically: true,
            encoding: .utf8
        )
        try "$env:HTTPS_PROXY = 'http://powershell.example'".write(
            to: home.appendingPathComponent(
                ".config/powershell/Microsoft.PowerShell_profile.ps1"
            ),
            atomically: true,
            encoding: .utf8
        )
        try #"{"env":{"ALL_PROXY":"socks5://claude.example"}}"#.write(
            to: home.appendingPathComponent(".claude/settings.json"),
            atomically: true,
            encoding: .utf8
        )
        try #"{"env":{"HTTPS_PROXY":"http://managed.example"}}"#.write(
            to: managedSettings.appendingPathComponent("managed-settings.json"),
            atomically: true,
            encoding: .utf8
        )
        try #"{"env":{"http_proxy":"http://managed-dropin.example"}}"#.write(
            to: managedSettings.appendingPathComponent("managed-settings.d/20-network.json"),
            atomically: true,
            encoding: .utf8
        )
        try """
        {
          // JSONC is the normal VS Code format.
          "terminal.integrated.env.osx": {
            "HTTP_PROXY": "http://vscode-user.example",
          },
        }
        """.write(
            to: appSupport.appendingPathComponent("Code/User/settings.json"),
            atomically: true,
            encoding: .utf8
        )
        let workspaceMetadata = "{\"folder\":\"\(workspace.absoluteString)\"}"
        try workspaceMetadata.write(
            to: appSupport.appendingPathComponent(
                "Code/User/workspaceStorage/one/workspace.json"
            ),
            atomically: true,
            encoding: .utf8
        )
        try #"{"terminal.integrated.env.osx":{"all_proxy":"socks5://workspace.example"}}"#.write(
            to: workspace.appendingPathComponent(".vscode/settings.json"),
            atomically: true,
            encoding: .utf8
        )
        try #"{"terminal.integrated.env.osx":{"HTTP_PROXY":"http://vscode-profile.example"}}"#.write(
            to: appSupport.appendingPathComponent(
                "Code/User/profiles/work/settings.json"
            ),
            atomically: true,
            encoding: .utf8
        )
        try #"{"env":{"HTTP_PROXY":"http://project-claude.example"}}"#.write(
            to: workspace.appendingPathComponent(".claude/settings.local.json"),
            atomically: true,
            encoding: .utf8
        )

        let report = TerminalProxyDiagnostics.scan(
            environment: [:],
            homeDirectory: home,
            applicationSupportDirectory: appSupport,
            managedSettingsDirectory: managedSettings
        )
        guard report.isComplete else {
            throw TestFailure("fixture scan unexpectedly failed: \(report.errors)")
        }
        let sources = report.issues.map(\.source).joined(separator: "\n")
        for required in [
            "Shell profile",
            "PowerShell Core profile",
            "Claude settings",
            "Claude managed settings",
            "VS Code user settings",
            "VS Code workspace settings",
        ] where !sources.contains(required) {
            throw TestFailure("missing terminal proxy source: \(required)")
        }
        guard report.issues.contains(where: { $0.source.hasSuffix("/.bash_login") }) else {
            throw TestFailure("the bash login profile was not inspected")
        }
        guard report.issues.contains(where: { $0.source.hasSuffix("/fish/conf.d/proxy.fish") }) else {
            throw TestFailure("fish conf.d startup files were not inspected")
        }
        guard report.issues.contains(where: { $0.source.hasSuffix("/fish/fish_variables") }) else {
            throw TestFailure("fish universal variables were not inspected")
        }
        guard report.issues.contains(where: {
            $0.source.contains("VS Code profile settings")
                && $0.source.hasSuffix("/profiles/work/settings.json")
        }) else {
            throw TestFailure("VS Code Settings Profiles were not inspected")
        }
        guard report.issues.contains(where: {
            $0.source.contains("Claude project settings")
                && $0.source.hasSuffix("/.claude/settings.local.json")
        }) else {
            throw TestFailure("recent-workspace Claude project settings were not inspected")
        }

        let launchctlUnavailable = TerminalProxyDiagnostics.scan(
            environment: [:],
            homeDirectory: home,
            applicationSupportDirectory: appSupport,
            managedSettingsDirectory: managedSettings,
            launchctlRead: { _ in
                throw TestFailure("launchctl unavailable")
            }
        )
        guard !launchctlUnavailable.isComplete else {
            throw TestFailure("a failed launchctl inspection must not report Ready")
        }

        try "{\"env\":{\"HTTP_PROXY\":\"http://broken.example\"}} /* unfinished".write(
            to: home.appendingPathComponent(".claude/settings.json"),
            atomically: true,
            encoding: .utf8
        )
        let malformed = TerminalProxyDiagnostics.scan(
            environment: [:],
            homeDirectory: home,
            applicationSupportDirectory: appSupport,
            managedSettingsDirectory: managedSettings
        )
        guard !malformed.isComplete else {
            throw TestFailure("malformed proxy-bearing JSON must not report Ready")
        }

        print("terminal proxy diagnostics passed")
    }
}
