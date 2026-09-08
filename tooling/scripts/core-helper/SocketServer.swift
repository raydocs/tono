import Foundation
import Darwin
import CryptoKit
import IOKit
import IOKit.pwr_mgt

final class SocketServer {
    private let allowedUID: uid_t
    private let allowedGID: gid_t
    private let authorizer: TonoPeerAuthorizer
    private let core: CoreManager
    private let killSwitch: KillSwitchManager
    private let protectedDNS: ProtectedDNSManager
    private let transitionGate: PowerTransitionGate
    private let powerMonitor: HelperPowerMonitor
    private var serverFD: Int32 = -1

    init() throws {
        guard geteuid() == 0 else {
            throw HelperFailure.invalid("The helper must run as root.")
        }
        allowedUID = try readAllowedUID()
        allowedGID = try allowedGroup(for: allowedUID)
        authorizer = try TonoPeerAuthorizer(allowedUID: allowedUID)
        try ensureRootDirectory(socketDirectory, permissions: 0o755)
        core = try CoreManager(allowedUID: allowedUID)
        killSwitch = try KillSwitchManager(allowedUID: allowedUID)
        protectedDNS = try ProtectedDNSManager()
        transitionGate = PowerTransitionGate()
        powerMonitor = HelperPowerMonitor(
            killSwitch: killSwitch,
            core: core,
            transitionGate: transitionGate
        )
        try setupSocket()
        try powerMonitor.start()
    }

    deinit {
        if serverFD >= 0 { close(serverFD) }
    }

    private func setupSocket() throws {
        try removeIfPresent(socketPath, requiredType: mode_t(S_IFSOCK), allowedOwner: allowedUID)
        serverFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard serverFD >= 0 else { throw HelperFailure.system("Could not create helper socket.") }
        _ = fcntl(serverFD, F_SETFD, FD_CLOEXEC)

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let copied = socketPath.withCString { source in
            withUnsafeMutablePointer(to: &address.sun_path) { tuple in
                tuple.withMemoryRebound(to: CChar.self, capacity: 104) {
                    strlcpy($0, source, 104)
                }
            }
        }
        guard copied < 104 else { throw HelperFailure.invalid("Helper socket path is too long.") }
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(serverFD, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bound == 0,
              chown(socketPath, allowedUID, allowedGID) == 0,
              chmod(socketPath, 0o600) == 0,
              listen(serverFD, 8) == 0 else {
            throw HelperFailure.system("Could not secure helper socket.")
        }
    }

    func run() {
        while helperShutdownRequested == 0 {
            var descriptor = pollfd(
                fd: serverFD,
                events: Int16(POLLIN),
                revents: 0
            )
            // IPC wakes poll immediately. A one-second timeout exists only to
            // observe the signal flag and avoids four idle helper wakeups/sec.
            let ready = poll(&descriptor, 1, 1_000)
            if ready == 0 { continue }
            if ready < 0 {
                if errno == EINTR { continue }
                usleep(100_000)
                continue
            }
            guard descriptor.revents & Int16(POLLIN) != 0 else { continue }
            let client = accept(serverFD, nil, nil)
            if client < 0 {
                if errno == EINTR { continue }
                usleep(100_000)
                continue
            }
            handle(client)
            close(client)
        }
        // launchd replacement/bootout is a normal lifecycle event. Reap the
        // owned child before this helper exits so the next version never races
        // an orphaned controller or TUN.
        try? core.stop()
    }

    private func handle(_ client: Int32) {
        _ = fcntl(client, F_SETFD, FD_CLOEXEC)
        var timeout = timeval(tv_sec: 3, tv_usec: 0)
        _ = withUnsafePointer(to: &timeout) {
            setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, $0, socklen_t(MemoryLayout<timeval>.size))
        }
        _ = withUnsafePointer(to: &timeout) {
            setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, $0, socklen_t(MemoryLayout<timeval>.size))
        }

        guard authorizer.accepts(socket: client) else {
            sendResponse(client, status: 403, object: ["ok": false, "error": "Forbidden."])
            return
        }

        do {
            let request = try readRequest(client)
            switch (request.method, request.path) {
            case ("GET", "/version"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                sendResponse(client, status: 200, object: ["ok": true, "version": helperVersion])
            case ("GET", "/core/status"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                let status = core.status()
                var object: [String: Any] = ["ok": true, "running": status.running]
                if let pid = status.pid { object["pid"] = Int(pid) }
                if let lastError = status.lastError {
                    object["lastError"] = String(lastError.prefix(600))
                }
                sendResponse(client, status: 200, object: object)
            case ("POST", "/core/start"):
                let object = try jsonObject(request.body)
                guard object.count == 2,
                      let directory = object["configDir"] as? String,
                      let digest = object["configSHA256"] as? String else {
                    throw HelperFailure.invalid("Invalid start request.")
                }
                try core.start(
                    configDirectory: directory,
                    configSHA256: digest,
                    startAllowed: { transitionGate.isAwake() }
                )
                sendResponse(client, status: 200, object: ["ok": true])
            case ("POST", "/core/sync"):
                let object = try jsonObject(request.body)
                guard object.count == 2,
                      let directory = object["configDir"] as? String,
                      let digest = object["configSHA256"] as? String else {
                    throw HelperFailure.invalid("Invalid sync request.")
                }
                let path = try core.sync(
                    configDirectory: directory,
                    configSHA256: digest
                )
                sendResponse(client, status: 200, object: ["ok": true, "configPath": path])
            case ("DELETE", "/core/stop"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                try core.stop()
                sendResponse(client, status: 200, object: ["ok": true])
            case ("GET", "/killswitch/status"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                sendResponse(client, status: 200, object: killSwitch.status())
            case ("POST", "/killswitch/arm"):
                let object = try jsonObject(request.body)
                try validateKillSwitchArmFields(object)
                let response = try killSwitch.arm(
                    object,
                    commitAllowed: { transitionGate.isAwake() }
                )
                sendResponse(client, status: 200, object: response)
            case ("POST", "/killswitch/disarm"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                let response = try transitionGate.whileAwake {
                    try killSwitch.disarm()
                }
                sendResponse(client, status: 200, object: response)
            case ("GET", "/dns/status"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                sendResponse(client, status: 200, object: protectedDNS.status())
            case ("POST", "/dns/enable"):
                let object = try jsonObject(request.body)
                guard object.count == 1,
                      let service = object["service"] as? String else {
                    throw HelperFailure.invalid("Invalid protected DNS request.")
                }
                sendResponse(
                    client,
                    status: 200,
                    object: try protectedDNS.enable(service: service)
                )
            case ("POST", "/dns/restore"):
                guard request.body.isEmpty else { throw HelperFailure.invalid("Unexpected request body.") }
                sendResponse(client, status: 200, object: try protectedDNS.restore())
            default:
                sendResponse(client, status: 404, object: ["ok": false, "error": "Not found."])
            }
        } catch let failure as HelperFailure {
            let status = failure.code == "CORE_ALREADY_RUNNING" ? 409 : 400
            var body: [String: Any] = ["ok": false, "error": failure.message]
            if let code = failure.code { body["code"] = code }
            sendResponse(client, status: status, object: body)
        } catch {
            sendResponse(client, status: 500, object: ["ok": false, "error": "Internal helper error."])
        }
    }
}
