import Foundation
import Dispatch

nonisolated struct TerminalProxyIssue: Identifiable, Hashable, Sendable {
    let key: String
    let value: String
    let source: String
    let guidance: String

    var id: String { "\(source)\u{1f}\(key)" }
}

nonisolated struct TerminalProxyReport: Sendable {
    let issues: [TerminalProxyIssue]
    let errors: [String]

    static let empty = TerminalProxyReport(issues: [], errors: [])
    var hasConflict: Bool { !issues.isEmpty }
    var isComplete: Bool { errors.isEmpty }
}

/// Conservative, read-only discovery of persistent proxy variables inherited
/// by terminal tools. Profile/settings files are reported with exact guidance
/// instead of being rewritten: deleting a matching line can corrupt a user's
/// conditionals, functions or unrelated startup commands.
nonisolated enum TerminalProxyDiagnostics {
    private static let proxyKeys = [
        "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
        "http_proxy", "https_proxy", "all_proxy",
    ]
    private static let configuredValue = "<configured>"
    private static let maximumSettingsBytes = 1_048_576

    static func assignments(in contents: String) -> [String: String] {
        let patterns = [
            #"(?i)^(?:export\s+)?(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*(.+)$"#,
            #"(?i)^\$env:(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*(.+)$"#,
            #"(?i)^set\s+"?(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*(.*?)"?$"#,
            #"(?i)(?:^|[;{]\s*)(?:set-item|new-item)\s+(?:(?:-path|-literalpath)\s+)?env:(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s+(?:-value\s+)?("[^"]*"|'[^']*'|[^\s;)}]+)"#,
            #"(?i)(?:^|[;{]\s*)\[(?:System\.)?Environment\]::SetEnvironmentVariable\(\s*['"](HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)['"]\s*,\s*([^,)]+)"#,
            #"(?i)^alias\s+\S+\s*=\s*['"][^'"]*(?:env\s+)?(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*("[^"]+"|'[^']+'|[^\s;'"}]+)"#,
            #"(?i)(?:^|[;{(]\s*|\bthen\s+|\bdo\s+)(?:env\s+)?(?:export\s+)?(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*("[^"]+"|'[^']+'|[^\s;)}]+)"#,
            #"(?i)(?:^|[;{]\s*)\$env:(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*("[^"]+"|'[^']+'|[^;)}]+)"#,
            #"(?i)(?:^|[;&|]\s*)(?:launchctl\s+setenv|setx(?:\.exe)?)\s+['"]?(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)['"]?\s+("[^"]+"|'[^']+'|[^\s;&|]+)"#,
            #"(?i)^SETUVAR(?:\s+--[A-Za-z-]+)*\s+(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY):(.+)$"#,
        ].compactMap { try? NSRegularExpression(pattern: $0) }
        var result: [String: String] = [:]
        for rawLine in contents.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            let lowered = line.lowercased()
            guard !line.isEmpty,
                  !line.hasPrefix("#"),
                  !line.hasPrefix("//"),
                  !line.hasPrefix("::"),
                  lowered != "rem",
                  !lowered.hasPrefix("rem ") else { continue }

            let range = NSRange(line.startIndex..<line.endIndex, in: line)
            var matched = false
            for expression in patterns {
                guard let match = expression.firstMatch(
                    in: line,
                    range: range
                ),
                let keyRange = Range(match.range(at: 1), in: line),
                let valueRange = Range(match.range(at: 2), in: line) else {
                    continue
                }
                if let value = normalizedValue(String(line[valueRange])) {
                    result[String(line[keyRange])] = value
                }
                matched = true
                break
            }
            if matched { continue }

            // fish: `set -gx HTTP_PROXY value`. Query/erase forms do not set
            // the environment and must not become false-positive residue.
            let words = line.split(whereSeparator: { $0.isWhitespace })
                .map(String.init)
            guard words.first?.lowercased() == "set" else { continue }
            var index = 1
            var erases = false
            while index < words.count, words[index].hasPrefix("-") {
                let flag = words[index].lowercased()
                erases = erases || flag == "--erase"
                    || (!flag.hasPrefix("--") && flag.dropFirst().contains("e"))
                index += 1
            }
            guard !erases, index + 1 < words.count,
                  isProxyKey(words[index]),
                  let value = normalizedValue(words[index + 1]) else { continue }
            result[words[index]] = value
        }
        return result
    }

    /// Reads the current user's launchd environment, which can differ from the
    /// environment Tono inherited. For example, setting a proxy after Tono
    /// starts and then launching VS Code would otherwise produce a false Ready
    /// result even though every new GUI terminal inherits the stale proxy.
    static func launchctlAssignments(
        read: (String) -> String = launchctlValue
    ) -> [String: String] {
        var assignments: [String: String] = [:]
        for key in proxyKeys {
            if let value = normalizedValue(read(key)) {
                assignments[key] = value
            }
        }
        return assignments
    }

    static func scan(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser,
        applicationSupportDirectory: URL = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support"),
        managedSettingsDirectory: URL = URL(
            fileURLWithPath: "/Library/Application Support/ClaudeCode",
            isDirectory: true
        ),
        fileManager: FileManager = .default,
        launchctlRead: (String) throws -> String = checkedLaunchctlValue
    ) -> TerminalProxyReport {
        var issues: [TerminalProxyIssue] = []
        var errors: [String] = []
        for key in proxyKeys {
            guard let value = environment[key],
                  normalizedValue(value) != nil else { continue }
            issues.append(TerminalProxyIssue(
                key: key,
                value: configuredValue,
                source: String(localized: "Current Tono GUI process"),
                guidance: String(localized: "Remove the inherited variable from its parent source. Include lowercase proxy names when unsetting it.")
            ))
        }
        var launchctlEnvironment: [String: String] = [:]
        for key in proxyKeys {
            do {
                if let value = normalizedValue(try launchctlRead(key)) {
                    launchctlEnvironment[key] = value
                }
            } catch {
                errors.append("launchctl \(key): \(error.localizedDescription)")
            }
        }
        append(
            launchctlEnvironment,
            source: String(localized: "Current launchctl GUI environment"),
            guidance: String(localized: "Run launchctl unsetenv for this exact proxy key, then fully restart Tono, VS Code, every terminal, Claude Code, and its supervisor."),
            to: &issues
        )

        let shellGuidance = String(localized: "Remove only this proxy assignment; preserve all unrelated profile content. Then restart the terminal and Claude supervisor.")
        for relativePath in [
            ".zshenv", ".zprofile", ".zshrc", ".zlogin",
            ".bashrc", ".bash_profile", ".bash_login", ".profile",
            ".config/fish/config.fish", ".config/fish/fish_variables",
        ] {
            scanTextFile(
                homeDirectory.appendingPathComponent(relativePath),
                source: String(localized: "Shell profile"),
                guidance: shellGuidance,
                fileManager: fileManager,
                issues: &issues,
                errors: &errors
            )
        }
        scanTextDirectory(
            homeDirectory.appendingPathComponent(".config/fish/conf.d"),
            fileExtension: "fish",
            source: String(localized: "Shell profile"),
            guidance: shellGuidance,
            fileManager: fileManager,
            issues: &issues,
            errors: &errors
        )
        if let xdgConfigHome = environment["XDG_CONFIG_HOME"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !xdgConfigHome.isEmpty {
            if xdgConfigHome.hasPrefix("/") {
                let fish = URL(fileURLWithPath: xdgConfigHome)
                    .appendingPathComponent("fish")
                scanTextFile(
                    fish.appendingPathComponent("config.fish"),
                    source: String(localized: "Shell profile"),
                    guidance: shellGuidance,
                    fileManager: fileManager,
                    issues: &issues,
                    errors: &errors
                )
                scanTextFile(
                    fish.appendingPathComponent("fish_variables"),
                    source: String(localized: "Shell profile"),
                    guidance: shellGuidance,
                    fileManager: fileManager,
                    issues: &issues,
                    errors: &errors
                )
                scanTextDirectory(
                    fish.appendingPathComponent("conf.d"),
                    fileExtension: "fish",
                    source: String(localized: "Shell profile"),
                    guidance: shellGuidance,
                    fileManager: fileManager,
                    issues: &issues,
                    errors: &errors
                )
            } else {
                errors.append("XDG_CONFIG_HOME is relative and cannot be inspected safely: \(xdgConfigHome)")
            }
        }
        if let zdotdir = environment["ZDOTDIR"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !zdotdir.isEmpty {
            if zdotdir.hasPrefix("/") {
                for file in [".zshenv", ".zprofile", ".zshrc", ".zlogin"] {
                    scanTextFile(
                        URL(fileURLWithPath: zdotdir).appendingPathComponent(file),
                        source: String(localized: "Shell profile"),
                        guidance: shellGuidance,
                        fileManager: fileManager,
                        issues: &issues,
                        errors: &errors
                    )
                }
            } else {
                errors.append("ZDOTDIR is relative and cannot be inspected safely: \(zdotdir)")
            }
        }
        for path in [
            "/etc/profile", "/etc/zshenv", "/etc/zprofile", "/etc/zshrc",
            "/etc/bashrc", "/etc/bash.bashrc",
        ] {
            scanTextFile(
                URL(fileURLWithPath: path),
                source: String(localized: "Shell profile"),
                guidance: shellGuidance,
                fileManager: fileManager,
                issues: &issues,
                errors: &errors
            )
        }
        scanTextDirectory(
            URL(fileURLWithPath: "/etc/profile.d", isDirectory: true),
            fileExtension: "sh",
            source: String(localized: "Shell profile"),
            guidance: shellGuidance,
            fileManager: fileManager,
            issues: &issues,
            errors: &errors
        )
        for root in ["/etc/fish", "/usr/local/etc/fish", "/opt/homebrew/etc/fish"] {
            let fish = URL(fileURLWithPath: root)
            scanTextFile(
                fish.appendingPathComponent("config.fish"),
                source: String(localized: "Shell profile"),
                guidance: shellGuidance,
                fileManager: fileManager,
                issues: &issues,
                errors: &errors
            )
            scanTextFile(
                fish.appendingPathComponent("fish_variables"),
                source: String(localized: "Shell profile"),
                guidance: shellGuidance,
                fileManager: fileManager,
                issues: &issues,
                errors: &errors
            )
            scanTextDirectory(
                fish.appendingPathComponent("conf.d"),
                fileExtension: "fish",
                source: String(localized: "Shell profile"),
                guidance: shellGuidance,
                fileManager: fileManager,
                issues: &issues,
                errors: &errors
            )
        }
        for relativePath in [
            ".config/powershell/profile.ps1",
            ".config/powershell/Microsoft.PowerShell_profile.ps1",
            ".config/powershell/Microsoft.VSCode_profile.ps1",
        ] {
            scanTextFile(
                homeDirectory.appendingPathComponent(relativePath),
                source: String(localized: "PowerShell Core profile"),
                guidance: shellGuidance,
                fileManager: fileManager,
                issues: &issues,
                errors: &errors
            )
        }
        for root in [
            "/usr/local/microsoft/powershell/7",
            "/opt/microsoft/powershell/7",
            "/opt/homebrew/microsoft/powershell/7",
        ] {
            for file in [
                "profile.ps1",
                "Microsoft.PowerShell_profile.ps1",
                "Microsoft.VSCode_profile.ps1",
            ] {
                scanTextFile(
                    URL(fileURLWithPath: root).appendingPathComponent(file),
                    source: String(localized: "PowerShell Core profile"),
                    guidance: shellGuidance,
                    fileManager: fileManager,
                    issues: &issues,
                    errors: &errors
                )
            }
        }
        scanJSONFile(
            homeDirectory.appendingPathComponent(".claude/settings.json"),
            containerPath: ["env"],
            source: String(localized: "Claude settings"),
            guidance: String(localized: "Remove the proxy key from the env object, then fully restart Claude Code and its supervisor."),
            fileManager: fileManager,
            issues: &issues,
            errors: &errors
        )
        let managedGuidance = String(localized: "Remove the proxy key from the managed Claude settings source, then fully restart Claude Code and its supervisor.")
        scanJSONFile(
            managedSettingsDirectory.appendingPathComponent("managed-settings.json"),
            containerPath: ["env"],
            source: String(localized: "Claude managed settings"),
            guidance: managedGuidance,
            fileManager: fileManager,
            issues: &issues,
            errors: &errors
        )
        scanJSONDirectory(
            managedSettingsDirectory.appendingPathComponent("managed-settings.d"),
            containerPath: ["env"],
            source: String(localized: "Claude managed settings"),
            guidance: managedGuidance,
            fileManager: fileManager,
            issues: &issues,
            errors: &errors
        )
        if let rawEnvironment = UserDefaults(
            suiteName: "com.anthropic.claudecode"
        )?.object(forKey: "env") {
            if let environment = rawEnvironment as? [String: Any] {
                let assignments = environment.reduce(into: [String: String]()) {
                    result, entry in
                    guard isProxyKey(entry.key),
                          let value = entry.value as? String,
                          let value = normalizedValue(value) else { return }
                    result[entry.key] = value
                }
                append(
                    assignments,
                    source: String(localized: "Claude managed preferences"),
                    guidance: managedGuidance,
                    to: &issues
                )
            } else {
                errors.append("Claude managed preferences: env is not a dictionary")
            }
        }

        for product in ["Code", "Code - Insiders"] {
            let userDirectory = applicationSupportDirectory
                .appendingPathComponent(product)
                .appendingPathComponent("User")
            let guidance = String(localized: "Remove the proxy key from terminal.integrated.env.osx, then fully restart VS Code and every integrated terminal.")
            scanJSONFile(
                userDirectory.appendingPathComponent("settings.json"),
                containerPath: ["terminal.integrated.env.osx"],
                source: String(localized: "VS Code user settings"),
                guidance: guidance,
                fileManager: fileManager,
                issues: &issues,
                errors: &errors
            )
            for settings in vscodeProfileSettings(
                userDirectory: userDirectory,
                fileManager: fileManager,
                errors: &errors
            ) {
                scanJSONFile(
                    settings,
                    containerPath: ["terminal.integrated.env.osx"],
                    source: String(localized: "VS Code profile settings"),
                    guidance: guidance,
                    fileManager: fileManager,
                    issues: &issues,
                    errors: &errors
                )
            }
            let workspaces = workspaceDiscovery(
                userDirectory: userDirectory,
                fileManager: fileManager,
                errors: &errors
            )
            for workspace in workspaces.settings {
                let isWorkspaceFile = workspace.pathExtension
                    .caseInsensitiveCompare("code-workspace") == .orderedSame
                scanJSONFile(
                    workspace,
                    containerPath: isWorkspaceFile
                        ? ["settings", "terminal.integrated.env.osx"]
                        : ["terminal.integrated.env.osx"],
                    source: String(localized: "VS Code workspace settings"),
                    guidance: guidance,
                    fileManager: fileManager,
                    issues: &issues,
                    errors: &errors
                )
            }
            for root in workspaces.roots {
                for file in ["settings.json", "settings.local.json"] {
                    scanJSONFile(
                        root.appendingPathComponent(".claude/\(file)"),
                        containerPath: ["env"],
                        source: String(localized: "Claude project settings"),
                        guidance: String(localized: "Remove the proxy key from the project env object, then fully restart Claude Code and its supervisor."),
                        fileManager: fileManager,
                        issues: &issues,
                        errors: &errors
                    )
                }
            }
        }
        return TerminalProxyReport(issues: issues, errors: errors)
    }

    private static func isProxyKey(_ key: String) -> Bool {
        proxyKeys.contains { $0.caseInsensitiveCompare(key) == .orderedSame }
    }

    private static func normalizedValue(_ input: String) -> String? {
        var value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasSuffix(";") {
            value.removeLast()
            value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if value.count >= 2,
           (value.hasPrefix("\"") && value.hasSuffix("\"")
            || value.hasPrefix("'") && value.hasSuffix("'")) {
            value.removeFirst()
            value.removeLast()
        }
        value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty,
              !["$null", "null", "nil"].contains(value.lowercased()) else {
            return nil
        }
        return value
    }

    private static func launchctlValue(_ key: String) -> String {
        (try? checkedLaunchctlValue(key)) ?? ""
    }

    private static func checkedLaunchctlValue(_ key: String) throws -> String {
        let process = Process()
        let output = Pipe()
        let terminated = DispatchSemaphore(value: 0)
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = ["getenv", key]
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        process.terminationHandler = { _ in terminated.signal() }
        try process.run()
        if terminated.wait(timeout: .now() + .seconds(2)) == .timedOut {
            if process.isRunning {
                process.terminate()
                _ = terminated.wait(timeout: .now() + .seconds(1))
            }
            throw LaunchctlReadError.timedOut
        }
        let data = output.fileHandleForReading.readDataToEndOfFile()
        guard process.terminationStatus == 0 else {
            throw LaunchctlReadError.nonzeroExit(process.terminationStatus)
        }
        guard data.count <= 4_096 else {
            throw LaunchctlReadError.outputTooLarge
        }
        guard let value = String(data: data, encoding: .utf8) else {
            throw LaunchctlReadError.invalidUTF8
        }
        return value
    }

    private enum LaunchctlReadError: LocalizedError {
        case nonzeroExit(Int32)
        case timedOut
        case outputTooLarge
        case invalidUTF8

        var errorDescription: String? {
            switch self {
            case let .nonzeroExit(status):
                "launchctl exited with status \(status)"
            case .timedOut:
                "launchctl inspection timed out"
            case .outputTooLarge:
                "launchctl output exceeded the inspection limit"
            case .invalidUTF8:
                "launchctl output was not valid UTF-8"
            }
        }
    }

    private static func read(
        _ url: URL,
        fileManager: FileManager
    ) throws -> String? {
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory),
              !isDirectory.boolValue else { return nil }
        let data = try Data(contentsOf: url, options: [.mappedIfSafe])
        guard data.count <= maximumSettingsBytes else {
            throw ScanError.invalidFile("file is larger than 1 MiB")
        }
        guard let contents = String(data: data, encoding: .utf8) else {
            throw ScanError.invalidFile("file is not UTF-8")
        }
        return contents
    }

    private static func scanTextFile(
        _ url: URL,
        source: String,
        guidance: String,
        fileManager: FileManager,
        issues: inout [TerminalProxyIssue],
        errors: inout [String]
    ) {
        do {
            guard let contents = try read(url, fileManager: fileManager) else {
                return
            }
            append(
                assignments(in: contents),
                source: "\(source): \(url.path)",
                guidance: guidance,
                to: &issues
            )
        } catch {
            errors.append("\(url.path): \(error.localizedDescription)")
        }
    }

    private static func scanTextDirectory(
        _ url: URL,
        fileExtension: String,
        source: String,
        guidance: String,
        fileManager: FileManager,
        issues: inout [TerminalProxyIssue],
        errors: inout [String]
    ) {
        guard fileManager.fileExists(atPath: url.path) else { return }
        do {
            let files = try fileManager.contentsOfDirectory(
                at: url,
                includingPropertiesForKeys: [.isRegularFileKey],
                options: [.skipsHiddenFiles]
            )
            guard files.count <= 256 else {
                throw ScanError.invalidFile("directory has more than 256 entries")
            }
            for file in files
                .filter({ $0.pathExtension.caseInsensitiveCompare(fileExtension) == .orderedSame })
                .sorted(by: { $0.path < $1.path }) {
                scanTextFile(
                    file,
                    source: source,
                    guidance: guidance,
                    fileManager: fileManager,
                    issues: &issues,
                    errors: &errors
                )
            }
        } catch {
            errors.append("\(url.path): \(error.localizedDescription)")
        }
    }

    private static func scanJSONFile(
        _ url: URL,
        containerPath: [String],
        source: String,
        guidance: String,
        fileManager: FileManager,
        issues: inout [TerminalProxyIssue],
        errors: inout [String]
    ) {
        do {
            guard let contents = try read(url, fileManager: fileManager) else {
                return
            }
            append(
                try jsonAssignments(in: contents, containerPath: containerPath),
                source: "\(source): \(url.path)",
                guidance: guidance,
                to: &issues
            )
        } catch {
            errors.append("\(url.path): \(error.localizedDescription)")
        }
    }

    private static func scanJSONDirectory(
        _ url: URL,
        containerPath: [String],
        source: String,
        guidance: String,
        fileManager: FileManager,
        issues: inout [TerminalProxyIssue],
        errors: inout [String]
    ) {
        guard fileManager.fileExists(atPath: url.path) else { return }
        do {
            let files = try fileManager.contentsOfDirectory(
                at: url,
                includingPropertiesForKeys: [.isRegularFileKey],
                options: [.skipsHiddenFiles]
            )
            guard files.count <= 256 else {
                throw ScanError.invalidFile("directory has more than 256 entries")
            }
            for file in files
                .filter({ $0.pathExtension.caseInsensitiveCompare("json") == .orderedSame })
                .sorted(by: { $0.path < $1.path }) {
                scanJSONFile(
                    file,
                    containerPath: containerPath,
                    source: source,
                    guidance: guidance,
                    fileManager: fileManager,
                    issues: &issues,
                    errors: &errors
                )
            }
        } catch {
            errors.append("\(url.path): \(error.localizedDescription)")
        }
    }

    private static func append(
        _ assignments: [String: String],
        source: String,
        guidance: String,
        to issues: inout [TerminalProxyIssue]
    ) {
        for key in assignments.keys.sorted() {
            guard assignments[key] != nil else { continue }
            issues.append(TerminalProxyIssue(
                key: key,
                value: configuredValue,
                source: source,
                guidance: guidance
            ))
        }
    }

    private static func jsonAssignments(
        in contents: String,
        containerPath: [String]
    ) throws -> [String: String] {
        let normalized = normalizeJSONC(contents)
        guard let data = normalized.data(using: .utf8),
              var container = try JSONSerialization.jsonObject(with: data)
                as? [String: Any] else {
            throw ScanError.invalidFile("invalid settings JSON")
        }
        for component in containerPath.dropLast() {
            guard let nested = container[component] as? [String: Any] else {
                return [:]
            }
            container = nested
        }
        if let leaf = containerPath.last {
            guard let nested = container[leaf] as? [String: Any] else {
                return [:]
            }
            container = nested
        }
        var result: [String: String] = [:]
        for (key, rawValue) in container where isProxyKey(key) {
            guard let value = rawValue as? String,
                  let value = normalizedValue(value) else { continue }
            result[key] = value
        }
        return result
    }

    private struct WorkspaceDiscovery {
        var settings: [URL] = []
        var roots: [URL] = []
    }

    private static func vscodeProfileSettings(
        userDirectory: URL,
        fileManager: FileManager,
        errors: inout [String]
    ) -> [URL] {
        let profiles = userDirectory.appendingPathComponent("profiles")
        guard fileManager.fileExists(atPath: profiles.path) else { return [] }
        do {
            let directories = try fileManager.contentsOfDirectory(
                at: profiles,
                includingPropertiesForKeys: [.isDirectoryKey],
                options: [.skipsHiddenFiles]
            )
            guard directories.count <= 128 else {
                throw ScanError.invalidFile("directory has more than 128 entries")
            }
            return try directories.compactMap { directory in
                let values = try directory.resourceValues(forKeys: [.isDirectoryKey])
                guard values.isDirectory == true else { return nil }
                let settings = directory.appendingPathComponent("settings.json")
                return fileManager.fileExists(atPath: settings.path) ? settings : nil
            }.sorted { $0.path < $1.path }
        } catch {
            errors.append("\(profiles.path): \(error.localizedDescription)")
            return []
        }
    }

    private static func workspaceDiscovery(
        userDirectory: URL,
        fileManager: FileManager,
        errors: inout [String]
    ) -> WorkspaceDiscovery {
        let storage = userDirectory.appendingPathComponent("workspaceStorage")
        guard fileManager.fileExists(atPath: storage.path) else {
            return WorkspaceDiscovery()
        }
        do {
            let directories = try fileManager.contentsOfDirectory(
                at: storage,
                includingPropertiesForKeys: [.isDirectoryKey],
                options: [.skipsHiddenFiles]
            )
            var discovery = WorkspaceDiscovery()
            for directory in directories {
                let metadataURL = directory.appendingPathComponent("workspace.json")
                guard let contents = try read(
                    metadataURL,
                    fileManager: fileManager
                ) else { continue }
                let normalized = normalizeJSONC(contents)
                guard let data = normalized.data(using: .utf8),
                      let metadata = try JSONSerialization.jsonObject(with: data)
                        as? [String: Any] else {
                    throw ScanError.invalidFile(
                        "invalid VS Code workspace metadata: \(metadataURL.path)"
                    )
                }
                if let value = metadata["folder"] as? String,
                   let folder = fileURL(value) {
                    discovery.roots.append(folder)
                    let settings = folder.appendingPathComponent(
                        ".vscode/settings.json"
                    )
                    if fileManager.fileExists(atPath: settings.path) {
                        discovery.settings.append(settings)
                    }
                }
                if let value = metadata["workspace"] as? String,
                   let workspace = fileURL(value),
                   fileManager.fileExists(atPath: workspace.path) {
                    discovery.settings.append(workspace)
                    discovery.roots.append(contentsOf: try workspaceRoots(
                        workspace,
                        fileManager: fileManager
                    ))
                }
            }
            discovery.settings = Array(Set(discovery.settings))
                .sorted { $0.path < $1.path }
            discovery.roots = Array(Set(discovery.roots))
                .sorted { $0.path < $1.path }
            return discovery
        } catch {
            errors.append("\(storage.path): \(error.localizedDescription)")
            return WorkspaceDiscovery()
        }
    }

    private static func workspaceRoots(
        _ workspace: URL,
        fileManager: FileManager
    ) throws -> [URL] {
        guard let contents = try read(workspace, fileManager: fileManager),
              let data = normalizeJSONC(contents).data(using: .utf8),
              let root = try JSONSerialization.jsonObject(with: data)
                as? [String: Any] else {
            throw ScanError.invalidFile("invalid VS Code workspace: \(workspace.path)")
        }
        guard let rawFolders = root["folders"] else { return [] }
        guard let folders = rawFolders as? [[String: Any]], folders.count <= 256 else {
            throw ScanError.invalidFile("invalid VS Code workspace folders: \(workspace.path)")
        }
        return try folders.compactMap { folder in
            if let uri = folder["uri"] as? String {
                return fileURL(uri)
            }
            guard let path = folder["path"] as? String,
                  !path.isEmpty,
                  !path.contains("\0") else {
                throw ScanError.invalidFile("invalid VS Code workspace folder: \(workspace.path)")
            }
            if let absolute = fileURL(path) { return absolute }
            return workspace.deletingLastPathComponent()
                .appendingPathComponent(path)
                .standardizedFileURL
        }
    }

    private static func fileURL(_ value: String) -> URL? {
        if let url = URL(string: value), url.isFileURL { return url }
        return value.hasPrefix("/") ? URL(fileURLWithPath: value) : nil
    }

    /// Removes JSONC comments and trailing commas while preserving quoted
    /// strings. VS Code settings are JSONC rather than strict JSON.
    private static func normalizeJSONC(_ contents: String) -> String {
        let characters = Array(contents)
        var stripped: [Character] = []
        var index = 0
        var inString = false
        var escaped = false
        while index < characters.count {
            let character = characters[index]
            if inString {
                stripped.append(character)
                if escaped {
                    escaped = false
                } else if character == "\\" {
                    escaped = true
                } else if character == "\"" {
                    inString = false
                }
                index += 1
                continue
            }
            if character == "\"" {
                inString = true
                stripped.append(character)
                index += 1
            } else if character == "/", index + 1 < characters.count,
                      characters[index + 1] == "/" {
                index += 2
                while index < characters.count, characters[index] != "\n" {
                    index += 1
                }
            } else if character == "/", index + 1 < characters.count,
                      characters[index + 1] == "*" {
                index += 2
                while index + 1 < characters.count,
                      !(characters[index] == "*" && characters[index + 1] == "/") {
                    index += 1
                }
                if index + 1 < characters.count {
                    index += 2
                } else {
                    // Preserve invalid JSONC as invalid so an unreadable
                    // persistent source can never produce a Ready result.
                    stripped.append("\0")
                    index = characters.count
                }
            } else {
                stripped.append(character)
                index += 1
            }
        }

        var normalized: [Character] = []
        index = 0
        inString = false
        escaped = false
        while index < stripped.count {
            let character = stripped[index]
            if inString {
                normalized.append(character)
                if escaped {
                    escaped = false
                } else if character == "\\" {
                    escaped = true
                } else if character == "\"" {
                    inString = false
                }
                index += 1
                continue
            }
            if character == "\"" { inString = true }
            if character == "," {
                var lookahead = index + 1
                while lookahead < stripped.count,
                      stripped[lookahead].isWhitespace {
                    lookahead += 1
                }
                if lookahead < stripped.count,
                   (stripped[lookahead] == "}" || stripped[lookahead] == "]") {
                    index += 1
                    continue
                }
            }
            normalized.append(character)
            index += 1
        }
        return String(normalized)
    }

    private enum ScanError: LocalizedError {
        case invalidFile(String)

        var errorDescription: String? {
            switch self {
            case .invalidFile(let reason): reason
            }
        }
    }
}
