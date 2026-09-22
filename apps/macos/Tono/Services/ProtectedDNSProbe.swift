import Darwin
import Foundation
import Network

/// In-process fake-IP checks for the protected DNS preflight.
///
/// Local listener proof talks UDP to 127.0.0.1:53. System-resolver proof uses
/// the cancellable macOS system resolver after `networksetup`, not an explicit
/// listener query. Neither path launches `dig`.
nonisolated enum ProtectedDNSProbe {
    static let name = "www.gstatic.com"
    static let fakeIPPrefix = "198.19."

    static func isFakeIP(_ value: String) -> Bool {
        value.hasPrefix(fakeIPPrefix)
    }

    static func containsFakeIP(_ answers: [String]) -> Bool {
        answers.contains(where: isFakeIP)
    }

    static func firstFakeIP(in answers: [String]) -> String? {
        answers.first(where: isFakeIP)
    }

    /// Listener returned a fake-IP, but the system resolver produced a public
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
        name: String = ProtectedDNSProbe.name,
        makeConnection: @Sendable (NWEndpoint.Host, NWEndpoint.Port) -> NWConnection = {
            NWConnection(host: $0, port: $1, using: .udp)
        }
    ) async -> [String] {
        guard !Task.isCancelled else { return [] }
        let packet = encodeQuery(name: name, id: UInt16.random(in: .min ... .max))
        let host = NWEndpoint.Host(server)
        guard let nwPort = NWEndpoint.Port(rawValue: UInt16(clamping: max(1, port))) else {
            return []
        }
        // Create, but do not start, the connection before installing cancellation.
        // If creation races cancellation, onCancel still retires this owned request
        // before begin can start it; there is no empty registration slot to miss.
        let request = DNSListenerRequest(connection: makeConnection(host, nwPort), timeout: timeout)
        let answers = await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                request.begin(packet: packet, continuation: continuation)
            }
        } onCancel: {
            request.finish([])
        }
        // Dispatch callbacks do not execute inside the originating Swift task.
        // Recheck here if cancellation raced a successful continuation resume.
        return Task.isCancelled ? [] : answers
    }

    static func querySystemResolver(
        timeout: TimeInterval,
        resolver: ProtectedSystemResolver.Functions = .live
    ) async -> [String] {
        await ProtectedSystemResolver.query(name: name, timeout: timeout, functions: resolver)
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

    static func decodeAnswers(
        _ data: Data,
        query: Data = ProtectedDNSProbe.encodeQuery(name: ProtectedDNSProbe.name)
    ) -> [String] {
        // Normalize slice indices and match the actual request, not a hard-coded ID.
        let packet = Array(data)
        let query = Array(query)
        guard packet.count >= 12, query.count >= 12,
              packet[0] == query[0], packet[1] == query[1],
              packet[2] & 0xFA == 0x80, // response, standard opcode, not truncated
              packet[3] & 0x0F == 0,   // NOERROR
              packet[4] == 0, packet[5] == 1,
              query[4] == 0, query[5] == 1 else { return [] }
        var offset = 12
        var queryOffset = 12
        guard let question = readName(packet, offset: &offset),
              let expected = readName(query, offset: &queryOffset), question == expected,
              offset + 4 <= packet.count, queryOffset + 4 == query.count,
              Array(packet[offset..<offset + 4]) == [0, 1, 0, 1],
              Array(query[queryOffset..<queryOffset + 4]) == [0, 1, 0, 1] else { return [] }
        offset += 4
        let ancount = Int(packet[6]) << 8 | Int(packet[7])
        let nscount = Int(packet[8]) << 8 | Int(packet[9])
        let arcount = Int(packet[10]) << 8 | Int(packet[11])
        var addresses: [Data: [String]] = [:]
        var aliases: [Data: Data] = [:]
        // A malformed later record invalidates the WHOLE datagram, even if an
        // earlier record contained a fake-IP. Authority/additional A records
        // are not answers to our question, but their framing must also be valid.
        for index in 0..<(ancount + nscount + arcount) {
            guard let owner = readName(packet, offset: &offset),
                  offset + 10 <= packet.count else { return [] }
            let type = Int(packet[offset]) << 8 | Int(packet[offset + 1])
            let recordClass = Int(packet[offset + 2]) << 8 | Int(packet[offset + 3])
            let rdlength = Int(packet[offset + 8]) << 8 | Int(packet[offset + 9])
            offset += 10
            let end = offset + rdlength
            guard end <= packet.count else { return [] }
            if type == 1, recordClass == 1 {
                guard rdlength == 4 else { return [] }
                if index < ancount {
                    addresses[owner, default: []].append(
                        "\(packet[offset]).\(packet[offset + 1]).\(packet[offset + 2]).\(packet[offset + 3])"
                    )
                }
            } else if type == 5, recordClass == 1 {
                var nameOffset = offset
                guard let target = readName(packet, offset: &nameOffset), nameOffset == end else { return [] }
                if index < ancount {
                    guard aliases[owner] == nil || aliases[owner] == target else { return [] }
                    aliases[owner] = target
                }
            }
            offset = end
        }
        guard offset == packet.count else { return [] }
        // Follow only the question's CNAME chain, never an unrelated A record
        // that happens to contain a fake-IP. Cycles and conflicting A/CNAME fail.
        var owner = question
        var visited = Set<Data>()
        while visited.insert(owner).inserted {
            if let answers = addresses[owner] {
                return aliases[owner] == nil ? answers : []
            }
            guard let target = aliases[owner] else { return [] }
            owner = target
        }
        return []
    }

    /// RFC 1035 labels, with ASCII case folding and bounded backward compression.
    /// Keep label lengths in the key: a dot inside a label is not a name separator.
    private static func readName(_ packet: [UInt8], offset: inout Int) -> Data? {
        var jumps = 0
        var cursor = offset
        var advancedPastName = false
        var name = Data()
        while cursor < packet.count {
            let length = Int(packet[cursor])
            if length == 0 {
                cursor += 1
                if !advancedPastName {
                    offset = cursor
                }
                name.append(0)
                return name
            }
            if length & 0xC0 == 0xC0 {
                guard cursor + 1 < packet.count else { return nil }
                let target = (length & 0x3F) << 8 | Int(packet[cursor + 1])
                guard target >= 12, target < cursor else { return nil }
                if !advancedPastName {
                    offset = cursor + 2
                    advancedPastName = true
                }
                cursor = target
                jumps += 1
                if jumps > 8 { return nil }
                continue
            }
            guard length <= 63, cursor + 1 + length <= packet.count,
                  name.count + 1 + length < 255 else { return nil }
            name.append(UInt8(length))
            name.append(contentsOf: packet[(cursor + 1)..<(cursor + 1 + length)].map {
                (65...90).contains($0) ? $0 + 32 : $0
            })
            cursor += length + 1
        }
        return nil
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
    /// Bounded diagnostic codes only: never include paths, browser JSON or
    /// policy values in a connection failure or telemetry event.
    enum FailureReason: String, Sendable {
        case unreadableFile, symbolicLink, oversizedFile
        case changedDuringRead, invalidDocument, invalidSettings, unsupportedMode
    }
    struct BrowserResult: Sendable {
        let outcome: Outcome
        let source: Source
        let preferenceStoreCount: Int
        var failureReason: FailureReason? = nil
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
        var diagnosticDetail: String {
            let results = [("chrome", chrome), ("edge", edge)].map { name, result in
                "\(name)=\(result.outcome.rawValue)/\(result.source.rawValue)/\(result.failureReason?.rawValue ?? "none")"
            }
            return "browser Secure DNS scan \(outcome.rawValue); " + results.joined(separator: "; ")
        }
        var failureMessage: String {
            switch outcome {
            case .incomplete:
                return String(localized: "Tono could not verify Chrome or Edge's Secure DNS configuration. This does not mean Secure DNS is enabled. Fully quit both browsers and tap Retry Now. If it persists, copy the failure details for support; do not delete browser data. Choose Restore internet to end protection and restore normal Internet.")
            case .blocking:
                return String(localized: "Chrome or Microsoft Edge may bypass Tono's protected DNS. Turn off Secure DNS in Chrome and Edge for all profiles, fully restart the browsers, then reconnect.")
            case .clear:
                return ""
            }
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
            preferenceStoreCount: results.reduce(0) { $0 + $1.preferenceStoreCount },
            failureReason: selected?.failureReason
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
            let object: Any
            switch read(url, format: .plist) {
            case .success(let value): object = value
            case .failure(let reason):
                return BrowserResult(
                    outcome: .incomplete,
                    source: source,
                    preferenceStoreCount: 0,
                    failureReason: reason
                )
            }
            guard let dictionary = object as? [String: Any] else {
                return BrowserResult(
                    outcome: .incomplete, source: source,
                    preferenceStoreCount: 0, failureReason: .invalidDocument
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
                    preferenceStoreCount: 0,
                    failureReason: .invalidSettings
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
            // No Local State means this browser has never persisted
            // preferences here. Chromium keeps `dns_over_https` in Local State
            // and writes that file within seconds of first launch, so a missing
            // file (fresh install, a support directory left behind by an
            // uninstalled browser, or a wiped profile) cannot carry an enabled
            // Secure DNS setting: the next launch starts from defaults. Managed
            // policy is the only other authority and was resolved above.
            // Build 72 treated a directory without Local State as "unknown" and
            // failed closed on machines that had never run the browser (#17,
            // #42) while adding nothing over the absent-directory case, which
            // already returned the managed outcome; a custom --user-data-dir
            // is invisible to both.
            let managedOutcome = classify(mode: managedMode, templates: managedTemplates)
            return BrowserResult(
                outcome: managedOutcome,
                source: managedSource ?? .none,
                preferenceStoreCount: 0,
                failureReason: managedOutcome == .incomplete ? .unsupportedMode : nil
            )
        }
        let object: Any
        switch read(localState, format: .json) {
        case .success(let value): object = value
        case .failure(let reason):
            return BrowserResult(
                outcome: .incomplete,
                source: .localState,
                preferenceStoreCount: 1,
                failureReason: reason
            )
        }
        guard let dictionary = object as? [String: Any] else {
            return BrowserResult(
                outcome: .incomplete, source: .localState,
                preferenceStoreCount: 1, failureReason: .invalidDocument
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
                    preferenceStoreCount: 1,
                    failureReason: .invalidSettings
                )
            }
            localMode = setting.mode
            localTemplates = setting.templates
        }
        let outcome = classify(
            mode: managedMode ?? localMode,
            templates: managedTemplates ?? localTemplates
        )
        return BrowserResult(
            outcome: outcome,
            source: managedSource ?? .localState,
            preferenceStoreCount: 1,
            failureReason: outcome == .incomplete ? .unsupportedMode : nil
        )
    }

    private enum Format { case json, plist }
    private enum ReadResult { case success(Any), failure(FailureReason) }
    private static func read(_ url: URL, format: Format) -> ReadResult {
        guard !isSymbolicLink(url) else { return .failure(.symbolicLink) }
        guard let before = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = before[.size] as? NSNumber else {
            return .failure(.unreadableFile)
        }
        guard size.intValue <= maximumFileBytes else { return .failure(.oversizedFile) }
        guard let data = try? Data(contentsOf: url, options: [.mappedIfSafe]) else {
            return .failure(.unreadableFile)
        }
        guard data.count <= maximumFileBytes else { return .failure(.oversizedFile) }
        guard let after = try? FileManager.default.attributesOfItem(atPath: url.path) else {
            return .failure(.unreadableFile)
        }
        guard before[.size] as? NSNumber == after[.size] as? NSNumber,
              before[.modificationDate] as? Date == after[.modificationDate] as? Date else {
            return .failure(.changedDuringRead)
        }
        let object: Any?
        switch format {
        case .json: object = try? JSONSerialization.jsonObject(with: data)
        case .plist: object = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil)
        }
        return object.map(ReadResult.success) ?? .failure(.invalidDocument)
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

/// One terminal decision owns the waiter, timer and connection cleanup. Cancel
/// can precede continuation installation and never waits for a Network callback.
nonisolated private final class DNSListenerRequest: @unchecked Sendable {
    private let lock = NSLock()
    private let queue = DispatchQueue(label: "net.tono.listener-dns", qos: .userInitiated)
    private let connection: NWConnection
    private let deadline: DispatchTime
    private var continuation: CheckedContinuation<[String], Never>?
    private var terminal: [String]?
    private var timer: DispatchSourceTimer?

    init(connection: NWConnection, timeout: TimeInterval) {
        self.connection = connection
        deadline = .now() + max(0.2, timeout)
    }

    private var isPending: Bool {
        lock.withLock { terminal == nil && DispatchTime.now() < deadline }
    }

    func begin(packet: Data, continuation: CheckedContinuation<[String], Never>) {
        lock.lock()
        if let terminal {
            lock.unlock()
            continuation.resume(returning: terminal)
            return
        }
        self.continuation = continuation
        let timer = DispatchSource.makeTimerSource(queue: .global(qos: .userInitiated))
        self.timer = timer
        timer.setEventHandler { self.finish([]) }
        timer.schedule(deadline: deadline)
        timer.resume()
        lock.unlock()
        queue.async { self.start(packet: packet) }
    }

    private func start(packet: Data) {
        guard isPending else { return }
        connection.stateUpdateHandler = { [weak self] state in
            guard let self, self.isPending else { return }
            switch state {
            case .ready:
                self.connection.send(content: packet, completion: .contentProcessed { [weak self] error in
                    guard let self, self.isPending else { return }
                    guard error == nil else { self.finish([]); return }
                    self.connection.receiveMessage { [weak self] data, _, _, error in
                        guard let self else { return }
                        self.finish(error == nil
                            ? ProtectedDNSProbe.decodeAnswers(data ?? Data(), query: packet)
                            : [])
                    }
                })
            case .failed, .cancelled:
                self.finish([])
            default:
                break
            }
        }
        connection.start(queue: queue)
    }

    func finish(_ answers: [String]) {
        lock.lock()
        guard terminal == nil else { lock.unlock(); return }
        let answers = DispatchTime.now() < deadline ? answers : []
        terminal = answers
        let continuation = self.continuation
        self.continuation = nil
        let timer = self.timer
        self.timer = nil
        lock.unlock()
        timer?.setEventHandler {}
        timer?.cancel()
        queue.async {
            self.connection.stateUpdateHandler = nil
            self.connection.cancel()
        }
        continuation?.resume(returning: answers)
    }
}
