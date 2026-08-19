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

private final class ConnectionHolder: @unchecked Sendable {
    var connection: NWConnection?
}

private final class OnceResume<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value?

    func take(_ next: Value) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard value == nil else { return false }
        value = next
        return true
    }
}
