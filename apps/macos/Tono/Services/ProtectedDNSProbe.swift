import Darwin
import Foundation
import Network

/// In-process fake-IP checks for the protected DNS preflight.
///
/// Local listener proof talks UDP to 127.0.0.1:53. System-resolver proof uses
/// `getaddrinfo` so it sees the same path as an ordinary app after
/// `networksetup`. Neither path launches `dig`.
nonisolated enum ProtectedDNSProbe {
    static let name = "www.gstatic.com"
    static let fakeIPPrefix = "198.18."

    static func isFakeIP(_ value: String) -> Bool {
        value.hasPrefix(fakeIPPrefix)
    }

    static func containsFakeIP(_ answers: [String]) -> Bool {
        answers.contains(where: isFakeIP)
    }

    static func firstFakeIP(in answers: [String]) -> String? {
        answers.first(where: isFakeIP)
    }

    /// Listener returned a fake-IP, but getaddrinfo still produced a public
    /// address. Encrypted DNS, iCloud Private Relay, or a stale resolver cache
    /// is ignoring 127.0.0.1:53.
    static func systemResolverBypassesProtectedListener(
        listenerAnswers: [String],
        systemAnswers: [String]
    ) -> Bool {
        containsFakeIP(listenerAnswers)
            && !systemAnswers.isEmpty
            && !containsFakeIP(systemAnswers)
    }

    static func queryListener(
        server: String,
        port: Int,
        timeout: TimeInterval,
        name: String = ProtectedDNSProbe.name
    ) async -> [String] {
        let packet = encodeQuery(name: name)
        let host = NWEndpoint.Host(server)
        guard let nwPort = NWEndpoint.Port(rawValue: UInt16(clamping: max(1, port))) else {
            return []
        }
        let holder = ConnectionHolder()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                let connection = NWConnection(host: host, port: nwPort, using: .udp)
                holder.connection = connection
                let once = OnceResume<[String]>()
                let finish: ([String]) -> Void = { answers in
                    if once.take(answers) {
                        connection.cancel()
                        continuation.resume(returning: answers)
                    }
                }
                connection.stateUpdateHandler = { state in
                    switch state {
                    case .ready:
                        connection.send(
                            content: packet,
                            completion: .contentProcessed { error in
                                if error != nil {
                                    finish([])
                                    return
                                }
                                connection.receiveMessage { data, _, _, error in
                                    if error != nil || Task.isCancelled {
                                        finish([])
                                        return
                                    }
                                    finish(decodeAnswers(data ?? Data()))
                                }
                            }
                        )
                    case .failed, .cancelled:
                        finish([])
                    default:
                        break
                    }
                }
                connection.start(queue: DispatchQueue.global(qos: .userInitiated))
                DispatchQueue.global(qos: .userInitiated).asyncAfter(
                    deadline: .now() + max(0.2, timeout)
                ) {
                    finish([])
                }
            }
        } onCancel: {
            holder.connection?.cancel()
        }
    }

    static func querySystemResolver(timeout: TimeInterval) async -> [String] {
        await withTaskGroup(of: [String].self) { group in
            group.addTask {
                await withCheckedContinuation { continuation in
                    DispatchQueue.global(qos: .userInitiated).async {
                        continuation.resume(returning: systemLookup(name))
                    }
                }
            }
            group.addTask {
                try? await Task.sleep(for: .seconds(max(0.2, timeout)))
                return []
            }
            let first = await group.next() ?? []
            group.cancelAll()
            return first
        }
    }

    static func encodeQuery(name: String, id: UInt16 = 0x544E) -> Data {
        var packet = Data()
        packet.append(contentsOf: [
            UInt8(id >> 8), UInt8(id & 0xFF),
            0x01, 0x00,
            0x00, 0x01,
            0x00, 0x00,
            0x00, 0x00,
            0x00, 0x00,
        ])
        for label in name.split(separator: ".") {
            let bytes = Array(label.utf8)
            packet.append(UInt8(min(bytes.count, 63)))
            packet.append(contentsOf: bytes.prefix(63))
        }
        packet.append(0)
        packet.append(contentsOf: [0x00, 0x01, 0x00, 0x01])
        return packet
    }

    static func decodeAnswers(_ packet: Data) -> [String] {
        guard packet.count >= 12 else { return [] }
        let qdcount = Int(packet[4]) << 8 | Int(packet[5])
        let ancount = Int(packet[6]) << 8 | Int(packet[7])
        var offset = 12
        for _ in 0..<qdcount {
            guard skipName(packet, offset: &offset) else { return [] }
            offset += 4
            guard offset <= packet.count else { return [] }
        }
        var answers: [String] = []
        for _ in 0..<ancount {
            guard skipName(packet, offset: &offset) else { break }
            guard offset + 10 <= packet.count else { break }
            let type = Int(packet[offset]) << 8 | Int(packet[offset + 1])
            let rdlength = Int(packet[offset + 8]) << 8 | Int(packet[offset + 9])
            offset += 10
            guard offset + rdlength <= packet.count else { break }
            if type == 1, rdlength == 4 {
                answers.append(
                    "\(packet[offset]).\(packet[offset + 1]).\(packet[offset + 2]).\(packet[offset + 3])"
                )
            }
            offset += rdlength
        }
        return answers
    }

    private static func skipName(_ packet: Data, offset: inout Int) -> Bool {
        var jumps = 0
        var cursor = offset
        var advancedPastName = false
        while cursor < packet.count {
            let length = Int(packet[cursor])
            if length == 0 {
                cursor += 1
                if !advancedPastName {
                    offset = cursor
                }
                return true
            }
            if length & 0xC0 == 0xC0 {
                guard cursor + 1 < packet.count else { return false }
                if !advancedPastName {
                    offset = cursor + 2
                    advancedPastName = true
                }
                cursor = (length & 0x3F) << 8 | Int(packet[cursor + 1])
                jumps += 1
                if jumps > 8 { return false }
                continue
            }
            cursor += 1 + length
            if cursor > packet.count { return false }
        }
        return false
    }

    private static func systemLookup(_ name: String) -> [String] {
        var hints = addrinfo()
        hints.ai_family = AF_INET
        hints.ai_socktype = SOCK_STREAM
        var result: UnsafeMutablePointer<addrinfo>?
        let status = getaddrinfo(name, nil, &hints, &result)
        defer {
            if let result {
                freeaddrinfo(result)
            }
        }
        guard status == 0 else { return [] }
        var answers: [String] = []
        var current = result
        while let info = current {
            if info.pointee.ai_family == AF_INET, let addr = info.pointee.ai_addr {
                var ipv4 = addr.withMemoryRebound(to: sockaddr_in.self, capacity: 1) {
                    $0.pointee
                }
                var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
                _ = inet_ntop(AF_INET, &ipv4.sin_addr, &buffer, socklen_t(INET_ADDRSTRLEN))
                answers.append(String(cString: buffer))
            }
            current = info.pointee.ai_next
        }
        return answers
    }
}

/// Read-only Chromium Secure DNS policy and browser-wide Local State
/// inspection. Results contain only bounded counters and enums; preference
/// paths and DoH templates never leave this scanner.
nonisolated enum BrowserDNSDiagnostics {
    static let maximumFileBytes = 4 * 1_048_576

    enum Outcome: String, Sendable { case clear, blocking, incomplete }
    enum Source: String, Sendable {
        case none, localState, userManaged, machineManaged
    }
    struct BrowserResult: Sendable {
        let outcome: Outcome
        let source: Source
        let preferenceStoreCount: Int
    }
    struct Report: Sendable {
        let chrome: BrowserResult
        let edge: BrowserResult
        var outcome: Outcome {
            if chrome.outcome == .incomplete || edge.outcome == .incomplete { return .incomplete }
            if chrome.outcome == .blocking || edge.outcome == .blocking { return .blocking }
            return .clear
        }
        var inspectedPreferenceStoreCount: Int {
            chrome.preferenceStoreCount + edge.preferenceStoreCount
        }
    }

    static func classify(mode: String?, templates: String?) -> Outcome {
        let normalized = mode?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let hasTemplates = templates?.trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty == false
        switch normalized {
        case nil, "": return hasTemplates ? .blocking : .clear
        case "off": return .clear
        case "automatic":
            return hasTemplates ? .blocking : .clear
        case "secure": return .blocking
        default: return .incomplete
        }
    }

    static func scan(homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser) -> Report {
        let support = homeDirectory.appendingPathComponent("Library/Application Support")
        let homePolicies = homeDirectory.appendingPathComponent("Library/Managed Preferences")
        let managedPolicies = URL(fileURLWithPath: "/Library/Managed Preferences")
        let managedUserPolicies = managedPolicies.appendingPathComponent(
            homeDirectory.lastPathComponent,
            isDirectory: true
        )
        return Report(
            chrome: scanBrowserChannels([
                ("Google/Chrome", "com.google.Chrome"),
                ("Google/Chrome Beta", "com.google.Chrome.beta"),
                ("Google/Chrome Dev", "com.google.Chrome.dev"),
                ("Google/Chrome Canary", "com.google.Chrome.canary"),
            ].map { path, domain in (
                support.appendingPathComponent("\(path)/Local State"),
                [
                    managedUserPolicies.appendingPathComponent("\(domain).plist"),
                    homePolicies.appendingPathComponent("\(domain).plist"),
                ],
                managedPolicies.appendingPathComponent("\(domain).plist")
            ) }),
            edge: scanBrowserChannels([
                ("Microsoft Edge", "com.microsoft.Edge"),
                ("Microsoft Edge Beta", "com.microsoft.Edge.Beta"),
                ("Microsoft Edge Dev", "com.microsoft.Edge.Dev"),
                ("Microsoft Edge Canary", "com.microsoft.Edge.Canary"),
            ].map { path, domain in (
                support.appendingPathComponent("\(path)/Local State"),
                [
                    managedUserPolicies.appendingPathComponent("\(domain).plist"),
                    homePolicies.appendingPathComponent("\(domain).plist"),
                ],
                managedPolicies.appendingPathComponent("\(domain).plist")
            ) })
        )
    }

    static func scanBrowserChannels(_ channels: [(URL, [URL], URL?)]) -> BrowserResult {
        let results = channels.map { localState, userPolicies, machinePolicy in
            scanBrowserWithUserPolicies(
                localState: localState, userPolicies: userPolicies, machinePolicy: machinePolicy
            )
        }
        let selected = results.first { $0.outcome == .incomplete }
            ?? results.first { $0.outcome == .blocking }
            ?? results.first { $0.preferenceStoreCount > 0 }
            ?? results.first
        return BrowserResult(
            outcome: selected?.outcome ?? .clear,
            source: selected?.source ?? .none,
            preferenceStoreCount: results.reduce(0) { $0 + $1.preferenceStoreCount }
        )
    }

    static func scanBrowser(
        localState: URL, userPolicy: URL?, machinePolicy: URL?
    ) -> BrowserResult {
        scanBrowserWithUserPolicies(
            localState: localState,
            userPolicies: userPolicy.map { [$0] } ?? [],
            machinePolicy: machinePolicy
        )
    }

    private static func scanBrowserWithUserPolicies(
        localState: URL, userPolicies: [URL], machinePolicy: URL?
    ) -> BrowserResult {
        var managedMode: String?
        var managedTemplates: String?
        var managedSource: Source?
        let policies = [(machinePolicy, Source.machineManaged)]
            + userPolicies.map { (Optional($0), Source.userManaged) }
        for (url, source) in policies {
            guard let url, candidateExists(url) else { continue }
            guard case .success(let object) = read(url, format: .plist),
                  let dictionary = object as? [String: Any] else {
                return BrowserResult(
                    outcome: .incomplete,
                    source: source,
                    preferenceStoreCount: 0
                )
            }
            guard let policy = settings(
                dictionary,
                modeKey: "DnsOverHttpsMode",
                templatesKey: "DnsOverHttpsTemplates"
            ) else {
                return BrowserResult(
                    outcome: .incomplete,
                    source: source,
                    preferenceStoreCount: 0
                )
            }
            var contributed = false
            if managedMode == nil, let mode = policy.mode {
                managedMode = mode
                contributed = true
            }
            if managedTemplates == nil, let templates = policy.templates {
                managedTemplates = templates
                contributed = true
            }
            if contributed, managedSource == nil { managedSource = source }
        }

        guard candidateExists(localState) else {
            let browserRoot = localState.deletingLastPathComponent()
            let managedOutcome = classify(
                mode: managedMode,
                templates: managedTemplates
            )
            if candidateExists(browserRoot), managedOutcome != .blocking,
               managedMode?.trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased() != "off" {
                return BrowserResult(
                    outcome: .incomplete,
                    source: managedSource ?? .localState,
                    preferenceStoreCount: 0
                )
            }
            return BrowserResult(
                outcome: managedOutcome,
                source: managedSource ?? .none,
                preferenceStoreCount: 0
            )
        }
        guard case .success(let object) = read(localState, format: .json),
              let dictionary = object as? [String: Any] else {
            return BrowserResult(
                outcome: .incomplete,
                source: .localState,
                preferenceStoreCount: 1
            )
        }
        var localMode: String?
        var localTemplates: String?
        if let rawDoH = dictionary["dns_over_https"] {
            guard let doh = rawDoH as? [String: Any],
                  let setting = settings(
                    doh,
                    modeKey: "mode",
                    templatesKey: "templates"
                  ) else {
                return BrowserResult(
                    outcome: .incomplete,
                    source: .localState,
                    preferenceStoreCount: 1
                )
            }
            localMode = setting.mode
            localTemplates = setting.templates
        }
        return BrowserResult(
            outcome: classify(
                mode: managedMode ?? localMode,
                templates: managedTemplates ?? localTemplates
            ),
            source: managedSource ?? .localState,
            preferenceStoreCount: 1
        )
    }

    private enum Format { case json, plist }
    private enum ReadResult { case success(Any), failure }
    private static func read(_ url: URL, format: Format) -> ReadResult {
        guard !isSymbolicLink(url),
              let before = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = before[.size] as? NSNumber,
              size.intValue <= maximumFileBytes,
              let data = try? Data(contentsOf: url, options: [.mappedIfSafe]),
              data.count <= maximumFileBytes,
              let after = try? FileManager.default.attributesOfItem(atPath: url.path),
              before[.size] as? NSNumber == after[.size] as? NSNumber,
              before[.modificationDate] as? Date == after[.modificationDate] as? Date else {
            return .failure
        }
        let object: Any?
        switch format {
        case .json: object = try? JSONSerialization.jsonObject(with: data)
        case .plist: object = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil)
        }
        return object.map(ReadResult.success) ?? .failure
    }

    private static func settings(
        _ dictionary: [String: Any], modeKey: String, templatesKey: String
    ) -> (mode: String?, templates: String?)? {
        let modeValue = dictionary[modeKey]
        let templateValue = dictionary[templatesKey]
        guard modeValue == nil || modeValue is String,
              templateValue == nil || templateValue is String else { return nil }
        return (modeValue as? String, templateValue as? String)
    }

    private static func candidateExists(_ url: URL) -> Bool {
        FileManager.default.fileExists(atPath: url.path)
    }

    private static func isSymbolicLink(_ url: URL) -> Bool {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path) else {
            return false
        }
        return attributes[.type] as? FileAttributeType == .typeSymbolicLink
    }
}

private final class ConnectionHolder: @unchecked Sendable {
    private let lock = NSLock()
    private nonisolated(unsafe) var _connection: NWConnection?

    nonisolated init() {}

    nonisolated var connection: NWConnection? {
        get {
            lock.lock()
            defer { lock.unlock() }
            return _connection
        }
        set {
            lock.lock()
            defer { lock.unlock() }
            _connection = newValue
        }
    }
}

private final class OnceResume<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private nonisolated(unsafe) var value: Value?

    nonisolated init() {}

    nonisolated func take(_ next: Value) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard value == nil else { return false }
        value = next
        return true
    }
}
