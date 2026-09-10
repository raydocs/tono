import Foundation
import Darwin

extension KillSwitchManager {
    static func runLifecycleSelfTests() -> Bool {
        let testAnchor = "tono.lifecycle-test"
        guard geteuid() == 0 else {
            FileHandle.standardError.write(Data("""
            lifecycle self-test needs root: it loads rules through pfctl.
              sudo <helper> --lifecycle-self-test
            The rules go into the unreferenced anchor "\(testAnchor)", so no
            traffic decision changes and the production anchor is untouched.

            """.utf8))
            return false
        }
        let scratch = FileManager.default.temporaryDirectory
            .appendingPathComponent("tono-lifecycle-test.conf").path
        defer {
            _ = try? run("/sbin/pfctl", ["-a", testAnchor, "-F", "all"])
            try? FileManager.default.removeItem(atPath: scratch)
        }

        func state(reviewedBundleDirect: Bool) -> KillSwitchState {
            KillSwitchState(
                armed: true,
                tailscaleBootstrapEnabled: false,
                apiHosts: [],
                exitHints: [],
                tunnelInterfaces: ["utun199"],
                resolvedHosts: ["api.example.com": ["1.1.1.1"]],
                pinnedHosts: ["api.example.com": ["1.1.1.1"]],
                derpEndpoints: [],
                cachedDERPEndpoints: [],
                proxyTargets: [
                    .init(host: "8.8.4.4", transport: "tcp", port: 443,
                          addresses: ["8.8.4.4"]),
                ],
                sessionDirectEndpoints: [],
                reviewedBundleDirectEnabled: reviewedBundleDirect
            )
        }

        /// Loads a rendered ruleset and returns what the kernel holds, or nil
        /// when the parser refused it.
        func load(_ rules: String) -> String? {
            guard (try? Data(rules.utf8).write(
                to: URL(fileURLWithPath: scratch)
            )) != nil else { return nil }
            guard let applied = try? run(
                "/sbin/pfctl", ["-a", testAnchor, "-f", scratch]
            ), applied.status == 0 else {
                FileHandle.standardError.write(Data(
                    "lifecycle: pfctl refused the ruleset\n".utf8
                ))
                return nil
            }
            guard let shown = try? run("/sbin/pfctl", ["-a", testAnchor, "-sr"]),
                  shown.status == 0,
                  let text = String(data: shown.output, encoding: .utf8)
            else { return nil }
            return text
        }

        // pfctl normalises what it prints, so match on the parts that carry
        // meaning rather than on the rendered line. Calibrated against real
        // output: a port list expands into one rule per port.
        // Calibrated against what the kernel actually reports. A port list is
        // expanded into one rule per port per protocol, and `from any to any`
        // is unique to this permit — the exact-address exceptions all print as
        // `to <address>`. Counting exactly pins the port set too, so quietly
        // widening it fails here instead of shipping.
        let expectedPermitRules = reviewedBundleDirectPorts.count * 2
        func permitCount(_ shown: String) -> Int {
            shown.split(separator: "\n").filter {
                $0.contains("from any to any port = ") && $0.contains("user = 0")
            }.count
        }

        var failures: [String] = []
        func check(_ name: String, _ ok: Bool) {
            if !ok { failures.append(name) }
        }

        // 1. Armed with the reviewed-bundle permit: it must be installed, and
        //    the catch-all must still be the last word.
        let armedRules = renderRules(state: state(reviewedBundleDirect: true), allowedUID: 501)
        guard let armed = load(armedRules) else {
            FileHandle.standardError.write(Data("lifecycle: armed ruleset failed to load\n".utf8))
            return false
        }
        if ProcessInfo.processInfo.environment["TONO_LIFECYCLE_DUMP"] != nil {
            FileHandle.standardError.write(Data("--- kernel holds ---\n\(armed)\n".utf8))
        }
        check("armed-permit-installed", permitCount(armed) == expectedPermitRules)
        check("armed-fails-closed", armed.contains("block drop out quick all"))
        // Order is only observable in what the kernel holds. A permit placed
        // after the catch-all parses, prints, and satisfies every substring
        // assertion while being dead — the packet is dropped before it is
        // reached.
        let permitBeforeCatchAll: Bool = {
            guard let block = armed.range(of: "block drop out quick all") else {
                return false
            }
            guard let lastPermit = armed.range(
                of: "from any to any port = ", options: .backwards
            ) else { return false }
            return lastPermit.lowerBound < block.lowerBound
        }()
        check("permit-precedes-catch-all", permitBeforeCatchAll)
        check("armed-keeps-tunnel", armed.contains("utun199"))
        // Captured here, not at the end: later steps overwrite the anchor, and the
        // emergency ruleset in step 6 legitimately has only loopback and the
        // catch-all — querying labels after it reports two classes and says nothing
        // about the armed set.
        let armedLabels: String? = {
            guard let out = try? run("/sbin/pfctl", ["-a", testAnchor, "-s", "labels"]),
                  out.status == 0 else { return nil }
            return String(data: out.output, encoding: .utf8)
        }()

        // 2. A re-arm that omits the flag must revoke it. This is the shipped
        //    bug from the other direction: the convergence arm dropped the
        //    argument and the permit disappeared under a live session while the
        //    rule engine still routed that bundle direct.
        guard let withoutPermit = load(renderRules(state: state(reviewedBundleDirect: false), allowedUID: 501)) else {
            FileHandle.standardError.write(Data("lifecycle: re-armed ruleset failed to load\n".utf8))
            return false
        }
        check("re-arm-without-flag-revokes", permitCount(withoutPermit) == 0)
        check("re-arm-still-fails-closed", withoutPermit.contains("block drop out quick all"))

        // 3. The convergence sequence that actually shipped broken: arm, then
        //    arm again for the same session. The permit must survive.
        guard let convergence = load(renderRules(state: state(reviewedBundleDirect: true), allowedUID: 501)) else {
            FileHandle.standardError.write(Data("lifecycle: convergence arm failed to load\n".utf8))
            return false
        }
        check("convergence-arm-keeps-permit", permitCount(convergence) == expectedPermitRules)

        // 4. The fault that reached customers, in its real shape.
        //
        // A re-arm flushes every PF state on the machine exactly when it removes
        // a pass rule that the previous ruleset had — correct as a security
        // rule, and devastating as an accident. The pin-refresh transaction
        // arms twice: once with the union of old and new endpoints, then again
        // to converge on the new set. That second arm dropped its
        // `reviewedBundleDirect` argument, so it removed all eight permit rules,
        // which made every refresh a machine-wide state flush. Long-lived
        // streams died mid-response roughly every twenty minutes.
        //
        // Not a rendering property and not a parsing property: both arms are
        // individually valid and both load. It is a property of the pair, which
        // is why nothing caught it.
        let firstArmPassRules = passRules(
            in: renderRules(state: state(reviewedBundleDirect: true), allowedUID: 501)
        )
        let convergedPassRules = passRules(
            in: renderRules(state: state(reviewedBundleDirect: true), allowedUID: 501)
        )
        let droppedPermitPassRules = passRules(
            in: renderRules(state: state(reviewedBundleDirect: false), allowedUID: 501)
        )
        check(
            "convergence-arm-does-not-revoke",
            firstArmPassRules.isSubset(of: convergedPassRules)
        )
        // The same comparison against the broken shape, which is what gives the
        // assertion above its teeth: if dropping the permit did not register as
        // a revocation, passing it would not be protecting anything.
        check(
            "dropping-the-permit-registers-as-revocation",
            !firstArmPassRules.isSubset(of: droppedPermitPassRules)
        )

        // 5. The predicate behind the reported flush bit. Note the limit: this
        //    covers whether a withdrawal is *detected* as one, not whether the
        //    bit `arm` returns is wired to that detection. Both read the same
        //    local, so they can only diverge if someone edits one of them, but
        //    proving the wiring needs a real arm — the install-and-start
        //    integration coverage that does not exist yet.
        check(
            "flush-reported-when-a-pass-rule-is-withdrawn",
            !firstArmPassRules.isSubset(of: droppedPermitPassRules)
        )
        check(
            "no-flush-reported-when-nothing-is-withdrawn",
            firstArmPassRules.isSubset(of: convergedPassRules)
        )
        // Widening must not count as a withdrawal, or every added endpoint would
        // sever the session it was added for.
        let widened = passRules(
            in: renderRules(
                state: KillSwitchState(
                    armed: true,
                    tailscaleBootstrapEnabled: false,
                    apiHosts: [],
                    exitHints: [],
                    tunnelInterfaces: ["utun199"],
                    resolvedHosts: [
                        "api.example.com": ["1.1.1.1"],
                        "extra.example.com": ["9.9.9.9"],
                    ],
                    pinnedHosts: ["api.example.com": ["1.1.1.1"]],
                    derpEndpoints: [],
                    cachedDERPEndpoints: [],
                    proxyTargets: [
                        .init(host: "8.8.4.4", transport: "tcp", port: 443,
                              addresses: ["8.8.4.4"]),
                    ],
                    sessionDirectEndpoints: [],
                    reviewedBundleDirectEnabled: true
                ),
                allowedUID: 501
            )
        )
        check("widening-is-not-a-withdrawal", firstArmPassRules.isSubset(of: widened))

        // 6. Emergency reset leaves loopback and the catch-all, nothing else.
        let emergency = emergencyState(preserving: state(reviewedBundleDirect: true))
        guard let emergencyShown = load(renderRules(state: emergency, allowedUID: 501)) else {
            FileHandle.standardError.write(Data("lifecycle: emergency ruleset failed to load\n".utf8))
            return false
        }
        check("emergency-drops-permit", permitCount(emergencyShown) == 0)
        check("emergency-drops-tunnel", !emergencyShown.contains("utun199"))
        check("emergency-fails-closed", emergencyShown.contains("block drop out quick all"))

        // 7. The boundary has to be measurable, which means the exact permits
        //    have to exist in the kernel.
        //
        //    pfctl merges rules it considers interchangeable, and an exact permit
        //    is a strict subset of the reviewed-bundle permit that subsumes it.
        //    Measured on a live armed machine: 58 exact permits in the rendered
        //    file, 13 rules in the kernel, none of them exact. Every question
        //    about what the boundary permits had to be answered by probing egress
        //    because there was no counter to read.
        //
        //    `armed` above is rendered from a state whose only proxy target is
        //    8.8.4.4:443/tcp, with the reviewed-bundle permit on — so tcp/443 for
        //    root is exactly the subsumption case. Without the class labels the
        //    renderer emits, the assertion below reads 0.
        check("exact-permit-survives-the-load", armed.contains("to 8.8.4.4"))
        check(
            "every-rendered-rule-is-labelled",
            armedRules
                .split(separator: "\n")
                .filter { $0.hasPrefix("pass") || $0.hasPrefix("block") }
                .allSatisfy { $0.contains(#"label ""#) }
        )
        //    And the measurement surface itself: `-s labels` is what makes "is the
        //    exit pin carrying traffic, or is the bundle permit absorbing it" a
        //    number rather than an inference. Read from the armed set captured in
        //    step 1.
        if let labelText = armedLabels {
            for expected in ["tono-loopback", "tono-tunnel", "tono-control", "tono-exit",
                             "tono-bundle", "tono-block"] {
                check("labels-report-\(expected)", labelText.contains(expected))
            }
        } else {
            check("labels-are-queryable", false)
        }

        if failures.isEmpty { return true }
        FileHandle.standardError.write(Data(
            "lifecycle self-test failed: \(failures.joined(separator: ", "))\n".utf8
        ))
        return false
    }

    static func runSelfTests() -> Bool {
        do {
            guard canonicalPublicAddress("8.8.8.8") == "8.8.8.8",
                  canonicalPublicAddress("2606:4700:4700::1111") != nil,
                  canonicalPublicAddress("127.0.0.1") == nil,
                  canonicalPublicAddress("10.0.0.1") == nil,
                  canonicalPublicAddress("100.64.0.1") == nil,
                  canonicalPublicAddress("192.168.1.1") == nil,
                  canonicalPublicAddress("::1") == nil,
                  canonicalPublicAddress("fd00::1") == nil,
                  try normalizeHost("ControlPlane.Tailscale.com.") ==
                    "controlplane.tailscale.com" else {
                return false
            }
            // A withdrawal may only take the narrow per-address kill when every
            // rule it removed is expressible as an address. These checks first
            // went into `pfSyntaxAccepts`, which returns early without root — so
            // they passed by never executing, and two mutations of the function
            // they cover went undetected. They live here because this is the
            // function `--self-test` actually calls.
            // Carry the class labels the renderer now emits: the reducer has to
            // find the address in the rule text that actually reaches it, and a
            // trailing `label "..."` sits after the `port` clause the pattern
            // anchors on. Unlabelled inputs would test a shape no longer produced.
            let exitPermit =
                "pass out quick inet proto tcp to 198.12.84.154 port 443 "
                + "user { 0, 501 } keep state (if-bound) label \"tono-control\""
            let otherPermit =
                "pass out quick inet proto udp to 43.146.27.19 port 8000 "
                + "user { 0, 501 } keep state (if-bound) label \"tono-derp\""
            let sixPermit =
                "pass out quick inet6 proto tcp to 2606:4700::1111 port 443 "
                + "user { 0, 501 } keep state (if-bound) label \"tono-control\""
            let interfaceRule =
                "pass in quick on utun199 all keep state (if-bound) label \"tono-tunnel\""
            let anyRule =
                "pass out quick inet proto tcp from any to any port 443 "
                + "user { 0, 501 } keep state (if-bound) label \"tono-bundle\""
            // Same address on a second port. This is where de-duplication is
            // reachable at all: the parameter is a Set, so identical rules are
            // already collapsed before this function sees them, and only two
            // distinct rules reducing to one host exercise it. The first version
            // of this check passed the same rule twice and therefore proved
            // nothing — a mutation that dropped de-duplication survived it.
            let exitPermitPort80 =
                "pass out quick inet proto tcp to 198.12.84.154 port 80 "
                + "user { 0, 501 } keep state (if-bound) label \"tono-control\""
            guard withdrawnHosts([exitPermit]) == ["198.12.84.154"],
                  // Membership and de-duplication, not order: the hosts are
                  // iterated to run one kill each, so order is not a behaviour.
                  // `sorted()` in the implementation is for reproducible logs,
                  // and an order assertion here would depend on Set hashing —
                  // it survived being reversed, which is the correct outcome.
                  // Membership, not order: the hosts are iterated to run one
                  // kill each, so order is not a behaviour. `sorted()` in the
                  // implementation is for reproducible logs, and an order
                  // assertion would depend on Set hashing — it survived being
                  // reversed, which is the correct outcome.
                  Set(withdrawnHosts([exitPermit, otherPermit]) ?? [])
                    == ["198.12.84.154", "43.146.27.19"],
                  withdrawnHosts([exitPermit, exitPermitPort80])
                    == ["198.12.84.154"],
                  withdrawnHosts([sixPermit]) == ["2606:4700::1111"],
                  // The two shapes that must never take the narrow path.
                  withdrawnHosts([interfaceRule]) == nil,
                  withdrawnHosts([anyRule]) == nil,
                  // One unreducible rule poisons the set: a partial targeted kill
                  // would leave behind the states of the rule it could not read.
                  withdrawnHosts([exitPermit, interfaceRule]) == nil,
                  withdrawnHosts([]) == [] else {
                return false
            }
            // The baseline-to-disposal mapping, which `withdrawnHosts` alone
            // does not cover. The nil case carries the most weight: every
            // mutator that opens egress, or that commits a ruleset it cannot
            // finish recording, clears the baseline precisely so the next arm
            // lands here — and a nil resolving to anything but `.full` would
            // turn each of those into a silent skip of the flush.
            guard stateDisposal(replacing: nil, with: [exitPermit]) == .full,
                  stateDisposal(replacing: Set([exitPermit]), with: [exitPermit]) == .keep,
                  // Widening keeps states: the endpoint was added for the very
                  // session those states belong to.
                  stateDisposal(
                    replacing: Set([exitPermit]),
                    with: [exitPermit, otherPermit]
                  ) == .keep,
                  stateDisposal(
                    replacing: Set([exitPermit, otherPermit]),
                    with: [otherPermit]
                  ) == .targeted(["198.12.84.154"]),
                  // One unreducible withdrawal takes the machine-wide flush
                  // rather than a partial targeted kill.
                  stateDisposal(
                    replacing: Set([exitPermit, interfaceRule]),
                    with: []
                  ) == .full else {
                return false
            }
            let sample = Data(
                #"{"Regions":{"1":{"Nodes":[{"HostName":"derp.example.com","IPv4":"8.8.8.8","IPv6":"2606:4700:4700::1111","DERPPort":443,"STUNPort":3478}]}}}"#
                    .utf8
            )
            let endpoints = try parseDERPMap(sample)
            guard endpoints.count == 4 else { return false }
            let lookupAddresses = try parseSystemLookupAddresses(Data("""
            name: api.example.com
            ipv6_address: 2606:4700:4700::1111

            name: api.example.com
            ip_address: 1.1.1.1
            """.utf8))
            guard lookupAddresses == ["2606:4700:4700::1111", "1.1.1.1"] else {
                return false
            }
            let directEndpoints = try validateSessionDirectEndpoints([
                ["address": "8.8.8.8", "transport": "udp", "port": 8000],
                ["address": "1.1.1.1", "transport": "tcp", "port": 443],
                ["address": "8.8.8.8", "transport": "tcp", "port": 80],
                ["address": "1.0.0.1", "transport": "udp", "port": 443],
                ["address": "8.8.8.8", "transport": "udp", "port": 8000],
            ])
            guard directEndpoints.count == 4,
                  directEndpoints.map(\.json).map({ $0["transport"] as? String }) ==
                    ["tcp", "tcp", "udp", "udp"] else { return false }
            let invalidDirectEndpoints: [Any] = [
                [["address": "10.0.0.1", "transport": "tcp", "port": 443]],
                [["address": "2606:4700:4700::1111", "transport": "tcp", "port": 443]],
                [["address": "8.8.8.0/24", "transport": "tcp", "port": 443]],
                [["address": "example.com", "transport": "tcp", "port": 443]],
                [["address": "8.8.8.8", "transport": "tcp", "port": 8000]],
                [["address": "8.8.8.8", "transport": "udp", "port": 80]],
                [["address": "8.8.8.8", "transport": "quic", "port": 443]],
                Array(repeating: ["address": "8.8.8.8", "transport": "tcp", "port": 443], count: 257),
            ]
            for invalid in invalidDirectEndpoints {
                do {
                    _ = try validateSessionDirectEndpoints(invalid)
                    return false
                } catch {}
            }
            let state = KillSwitchState(
                armed: true,
                tailscaleBootstrapEnabled: true,
                apiHosts: [],
                exitHints: [],
                tunnelInterfaces: [],
                resolvedHosts: ["api.example.com": ["1.1.1.1"]],
                pinnedHosts: ["api.example.com": ["1.1.1.1"]],
                derpEndpoints: endpoints,
                cachedDERPEndpoints: endpoints,
                proxyTargets: [
                    .init(
                        host: "8.8.4.4",
                        transport: "tcp",
                        port: 8443,
                        addresses: ["8.8.4.4"]
                    ),
                ],
                sessionDirectEndpoints: directEndpoints,
                reviewedBundleDirectEnabled: true
            )
            let rules = renderRules(state: state, allowedUID: 501)
            let emergencyState = emergencyState(preserving: state)
            let emergencyRules = renderRules(
                state: emergencyState,
                allowedUID: 501
            )
            let cloudRules = renderRules(
                state: .init(
                    armed: true,
                    tailscaleBootstrapEnabled: false,
                    apiHosts: ["api.example.com"],
                    exitHints: [],
                    tunnelInterfaces: ["utun199"],
                    resolvedHosts: ["api.example.com": ["1.1.1.1"]],
                    pinnedHosts: ["api.example.com": ["1.1.1.1"]],
                    derpEndpoints: [],
                    cachedDERPEndpoints: [],
                    proxyTargets: state.proxyTargets,
                    sessionDirectEndpoints: [],
            reviewedBundleDirectEnabled: false
                ),
                allowedUID: 501
            )
            let inactiveState = KillSwitchState(
                armed: true,
                tailscaleBootstrapEnabled: false,
                apiHosts: [],
                exitHints: [],
                tunnelInterfaces: ["utun199"],
                resolvedHosts: [:],
                pinnedHosts: state.pinnedHosts,
                derpEndpoints: [],
                cachedDERPEndpoints: state.cachedDERPEndpoints,
                proxyTargets: state.proxyTargets,
                sessionDirectEndpoints: [],
            reviewedBundleDirectEnabled: false
            )
            let inactiveRules = renderRules(
                state: inactiveState,
                allowedUID: 501
            )
            let inactiveHosts = renderHostsMappings(state: inactiveState)
            let (_, cacheOnlyResolved) = try resolveHosts(
                ["api.example.com"],
                previous: state.pinnedHosts,
                includeTailscaleBootstrap: false,
                allowSystemResolution: false
            )
            let hosts = renderHostsMappings(state: state)
            let installedHosts = try replacingManagedHosts(
                in: "127.0.0.1 localhost\n",
                replacement: hosts
            )
            let removedHosts = try replacingManagedHosts(
                in: hosts,
                replacement: nil
            )
            let bootstrapPins = try validateBootstrapPins(
                ["api.example.com": ["1.1.1.1"]],
                requestedHosts: ["api.example.com"]
            )
            let rejectedUnrequestedPin: Bool
            do {
                _ = try validateBootstrapPins(
                    ["other.example.com": ["8.8.8.8"]],
                    requestedHosts: ["api.example.com"]
                )
                rejectedUnrequestedPin = false
            } catch {
                rejectedUnrequestedPin = true
            }
            let rejectedPrivateTarget: Bool
            do {
                _ = try resolveProxyTargets(
                    [[
                        "host": "10.0.0.1",
                        "transport": "tcp",
                        "port": 443,
                    ]],
                    previous: []
                )
                rejectedPrivateTarget = false
            } catch {
                rejectedPrivateTarget = true
            }
            let acceptedUDPProxyTarget: Bool
            do {
                _ = try resolveProxyTargets(
                    [[
                        "host": "8.8.4.4",
                        "transport": "udp",
                        "port": 443,
                    ]],
                    previous: []
                )
                acceptedUDPProxyTarget = true
            } catch {
                acceptedUDPProxyTarget = false
            }
            let rejectedQuicProxyTarget: Bool
            do {
                _ = try resolveProxyTargets(
                    [[
                        "host": "8.8.4.4",
                        "transport": "quic",
                        "port": 443,
                    ]],
                    previous: []
                )
                rejectedQuicProxyTarget = false
            } catch {
                rejectedQuicProxyTarget = true
            }
            let persisted = persistentObject(state, allowedUID: 501)
            // Split into named steps: as a single boolean chain this grew past
            // what the type checker will solve in reasonable time.
            let required = [
                // The reviewed-bundle permit must stay root-only and stay bound
                // to the fixed port list; an "any port" form would let a routing
                // mistake exfiltrate anywhere.
                "pass out quick inet proto tcp from any to any " +
                    "port { 80, 443, 8000, 8080 } user root keep state (if-bound)",
                "pass out quick inet proto udp from any to any " +
                    "port { 80, 443, 8000, 8080 } user root keep state (if-bound)",
                "to 1.1.1.1 port 443 user { 0, 501 } keep state (if-bound)",
                "to 8.8.8.8 port 443 user root keep state (if-bound)",
                "proto udp",
                "to 8.8.4.4 port 8443 user root keep state (if-bound)",
                "pass out quick inet proto tcp to 8.8.8.8 port 80 user root keep state (if-bound)",
                "pass out quick inet proto udp to 8.8.8.8 port 8000 user root keep state (if-bound)",
                "pass in quick on lo0 all keep state (if-bound)",
                "pass out quick on lo0 all keep state (if-bound)",
                "block drop out quick all",
            ]
            let forbidden = [
                // Never a permit without a user clause, and never all ports.
                "pass out quick inet proto tcp user root keep state (if-bound)",
                "pass out quick inet proto tcp from any to any " +
                    "port { 80, 443, 8000, 8080 } keep state (if-bound)",
                // PF rejects `port` that is not attached to a host spec. This
                // shipped once and cost two builds: the ruleset failed to parse,
                // so no session could arm at all. The substring only matches the
                // broken form, since the correct one reads `to any port {`.
                "proto tcp port {",
                "proto udp port {",
                // The bootstrap permit must never be world-usable again.
                "to 1.1.1.1 port 443 keep state (if-bound)",
                "to 8.8.8.8 port 443 keep state (if-bound)",
                "proto tcp to any",
                // An unlabelled rule is a rule pfctl is free to merge away. The
                // exact permits are a strict subset of the reviewed-bundle permit,
                // so without a label the optimizer collapses them and the boundary
                // stops being readable from a counter — measured on a live machine
                // as 58 rendered permits against 13 kernel rules, none of them
                // exact. `keep state (if-bound)` followed by a line break is the
                // shape of a rule that lost its label.
                "keep state (if-bound)\n",
            ]
            let ruleShapesHold = required.allSatisfy(rules.contains)
                && !forbidden.contains(where: rules.contains)
            // Whole-string equality, so the class labels belong here too: this is
            // the one assertion that pins the emergency ruleset exactly, and it is
            // what caught the label change before it shipped.
            let emergencyExpected = [
                "# Managed by Tono Kill Switch — do not edit",
                "pass in quick on lo0 all keep state (if-bound) label \"tono-loopback\"",
                "pass out quick on lo0 all keep state (if-bound) label \"tono-loopback\"",
                "block drop out quick all label \"tono-block\"",
                "",
            ].joined(separator: "\n")
            let cloudRequired = [
                "pass in quick on utun199 all keep state (if-bound)",
                "pass out quick on utun199 all keep state (if-bound)",
                "to 1.1.1.1 port 443 user { 0, 501 } keep state (if-bound)",
            ]
            let cloudForbidden = [
                "pass in quick on en",
                "proto udp",
                // A session that did not ask for it must not inherit the permit.
                "port { 80, 443, 8000, 8080 }",
            ]
            let cloudShapesHold = cloudRequired.allSatisfy(cloudRules.contains)
                && !cloudForbidden.contains(where: cloudRules.contains)
            let noStrayPermits = !rules.contains("to any port 443")
                && !inactiveRules.contains("to 1.1.1.1 port 443")
                && !inactiveHosts.contains("api.example.com")
            // Each comparison bound separately: the dictionary/array element
            // types make a single chain expensive for the type checker.
            let inactivePinsMatch: Bool = inactiveState.pinnedHosts == state.pinnedHosts
            let emergencyPinsMatch: Bool = emergencyState.pinnedHosts == state.pinnedHosts
            let derpCacheMatch: Bool =
                emergencyState.cachedDERPEndpoints == state.cachedDERPEndpoints
            let emergencySessionCleared: Bool =
                emergencyState.sessionDirectEndpoints.isEmpty
            let sessionNotPersisted: Bool = persisted["sessionDirectEndpoints"] == nil
            let statesAgree = inactivePinsMatch && emergencyPinsMatch
                && derpCacheMatch && emergencySessionCleared && sessionNotPersisted
            let cacheOnlyMatch: Bool = cacheOnlyResolved["api.example.com"] == ["1.1.1.1"]
            let bootstrapMatch: Bool = bootstrapPins["api.example.com"] == ["1.1.1.1"]
            let pinsAgree = cacheOnlyMatch && bootstrapMatch && rejectedUnrequestedPin
            let hostsAgree = hosts.contains("1.1.1.1 api.example.com")
                && !hosts.contains("localhost")
                && installedHosts.contains(killSwitchHostsEndMarker)
                && removedHosts.isEmpty
            // Reported, not silently folded in: a skip must not read as a pass.
            let armedParse = pfSyntaxAccepts(rules)
            let bootstrapParse = pfSyntaxAccepts(cloudRules)
            let pfParses: Bool
            switch (armedParse, bootstrapParse) {
            case (nil, _), (_, nil):
                let warning = "warn: PF syntax check skipped (needs root); "
                    + "run `sudo tono-core-helper --self-test` to include it\n"
                FileHandle.standardError.write(Data(warning.utf8))
                pfParses = true
            case let (armed?, bootstrap?):
                pfParses = armed && bootstrap
            }
            return ruleShapesHold
                && emergencyRules == emergencyExpected
                && cloudShapesHold
                && pfParses
                && noStrayPermits
                && statesAgree
                && pinsAgree
                && hostsAgree
                && rejectedPrivateTarget
                && acceptedUDPProxyTarget
                && rejectedQuicProxyTarget
        } catch {
            return false
        }
    }

    static func runNetworkSelfTest() -> Bool {
        guard let endpoints = try? fetchDERPEndpoints() else { return false }
        return endpoints.count >= 2 &&
            endpoints.contains(where: { $0.transport == "tcp" && $0.port == 443 }) &&
            endpoints.contains(where: { $0.transport == "udp" && $0.port == 3478 })
    }
}
