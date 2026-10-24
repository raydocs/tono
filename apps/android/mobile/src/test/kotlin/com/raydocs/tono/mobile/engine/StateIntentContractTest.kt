package com.raydocs.tono.mobile.engine

import com.raydocs.tono.routing.Json
import com.raydocs.tono.routing.RoutingMode
import com.raydocs.tono.routing.asArray
import com.raydocs.tono.routing.asObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The shared state-intent table. The fixture is the contract; [problems] is the rules.
 * A product probe that still disagrees is `expected-failure`: it fails once the product matches,
 * until that row's enforcement flips to `enabled`. `todo` is not a pass.
 */
class StateIntentContractTest {
    private val tokyo = "Tokyo · Dawn"
    private val la = "Los Angeles · Grove"
    private val base = EngineSnapshot(
        phase = Phase.IDLE,
        nodes = listOf(NodeView(tokyo, "Tokyo", "Dawn"), NodeView(la, "Los Angeles", "Grove")),
        selectedNode = tokyo,
        mode = RoutingMode.THREE_TIER,
        session = "engine-a",
    )
    private val ok = ExitProbe(ProbeState.OK, "JP")
    private val homeOk = ExitProbe(ProbeState.OK, "US")

    private fun connected(ledger: TunnelLedger): EngineSnapshot {
        val preparing = ledger.begin(base, Phase.PREPARING)
        val gen = ledger.attempt
        val started = ledger.started(
            preparing.copy(phase = Phase.CONNECTING), gen, tunEstablished = true,
            node = tokyo, mode = RoutingMode.THREE_TIER, sinceMs = 1_000,
        )!!
        return ledger.probed(started, gen, ok, homeOk)!!
    }

    @Test fun fixtureMatchesTheRulesAndTheDecision() {
        val fixture = loadFixture()
        assertEquals(1, fixture.version)
        assertEquals("429e23427", fixture.accountContractHead)
        assertEquals("https://github.com/raydocs/tono/pull/1738", fixture.accountContractPr)
        val decision = File(repoRoot(), fixture.decision).readText()
        assertTrue(decision.contains("134-2026-10-24-state-intent-rule"))
        assertTrue(decision.contains("429e23427"))
        assertTrue(decision.contains("LibboxStub"))
        val covered = mutableSetOf<Int>()
        val ids = mutableSetOf<String>()
        assertEquals(18, fixture.scenarios.size)
        for (scenario in fixture.scenarios) {
            assertTrue(scenario.id, ids.add(scenario.id))
            covered.addAll(scenario.rules)
            assertEquals(scenario.id, 4, scenario.platforms.size)
            for (name in listOf("ios", "android", "macos", "windows")) {
                val row = scenario.platforms[name] ?: error(scenario.id)
                assertTrue(scenario.id, row.enforcement in setOf("enabled", "expected-failure", "todo"))
                assertTrue(scenario.id, row.note.isNotEmpty())
                assertTrue(scenario.id, row.owner.isNotEmpty())
            }
            val found = problems(scenario)
            assertTrue(found.joinToString("\n"), found.isEmpty())
            assertTrue(scenario.id, decision.contains(scenario.id))
        }
        assertEquals((1..7).toSet(), covered)
    }

    @Test fun productProbesAgreeOrAreMarked() {
        assertFalse(TonoVpnService.isSessionEnded(ApiException(403, "PLAN_EXPIRED", "")))
        assertFalse(TonoVpnService.isSessionEnded(ApiException(403, "QUOTA_EXHAUSTED", "")))
        assertFalse(TonoVpnService.isSessionEnded(ApiException(403, "DEVICE_REAUTH_REQUIRED", "")))
        assertFalse(TonoVpnService.isSessionEnded(ApiException(429, "RATE_LIMITED", "")))
        assertTrue(TonoVpnService.isSessionEnded(ApiException(401, "UNAUTHORIZED", "")))
        assertTrue(TonoVpnService.isSessionEnded(ApiException(401, "INVALID_REFRESH_TOKEN", "")))

        val fixture = loadFixture()
        for (scenario in fixture.scenarios) {
            val row = scenario.platforms["android"] ?: error(scenario.id)
            val actual = observed(scenario.id)
            if (actual != null) {
                assertNotEquals(scenario.id, "todo", row.enforcement)
                when (row.enforcement) {
                    "enabled" -> assertEquals(scenario.id, scenario.expect.display, actual)
                    "expected-failure" -> assertNotEquals(
                        "${scenario.id} now matches the contract ($actual); set android enforcement to enabled",
                        scenario.expect.display,
                        actual,
                    )
                    else -> error("no probe path for ${row.enforcement} ${scenario.id}")
                }
            } else {
                assertEquals(scenario.id, "todo", row.enforcement)
            }
        }
    }

    @Test fun internalCodesAreNotRenderedUnlessAllowlisted() {
        scanErrorCodes("android", repoRoot())
    }

    private fun observed(id: String): String? = when (id) {
        "user-disconnect" -> {
            val ledger = TunnelLedger()
            val stopping = ledger.begin(connected(ledger), Phase.DISCONNECTING)
            observedPhase(ledger.end(stopping, Phase.IDLE, null))
        }
        "system-revoke" -> {
            val ledger = TunnelLedger()
            observedPhase(ledger.end(connected(ledger), Phase.NEEDS_PERMISSION, "REVOKED"))
        }
        "core-crash" -> {
            val ledger = TunnelLedger()
            observedPhase(ledger.end(connected(ledger), Phase.FAILED, "CORE_STOPPED"))
        }
        "plan-expired" -> accountDisplay(403, "PLAN_EXPIRED")
        "quota-exhausted" -> accountDisplay(403, "QUOTA_EXHAUSTED")
        "device-reauth-required" -> accountDisplay(403, "DEVICE_REAUTH_REQUIRED")
        "explicit-credential-revoke" -> accountDisplay(401, "UNAUTHORIZED")
        "rate-limited" -> accountDisplay(429, "RATE_LIMITED")
        "cancel-then-late-start" -> {
            val ledger = TunnelLedger()
            val preparing = ledger.begin(base, Phase.PREPARING)
            val earlier = ledger.attempt
            val stopped = ledger.end(ledger.begin(preparing, Phase.DISCONNECTING), Phase.IDLE, null)
            assertNull(ledger.started(stopped, earlier, tunEstablished = true, node = tokyo, mode = RoutingMode.THREE_TIER, sinceMs = 1_000))
            observedPhase(stopped)
        }
        "recheck-while-connected" -> {
            val ledger = TunnelLedger()
            val checking = ledger.rechecking(connected(ledger))!!
            if (checking.phase == Phase.CONNECTED || checking.phase == Phase.DEGRADED) "connected" else "connecting"
        }
        "optional-rollback-failed" -> {
            val ledger = TunnelLedger()
            val reloading = ledger.begin(connected(ledger), Phase.CONNECTING)
            val failed = ledger.end(reloading, Phase.FAILED, "CORE_START")
            if (TunnelAuthority.confirmed(failed)) "connected" else observedPhase(failed)
        }
        else -> null
    }

    private fun accountDisplay(status: Int, code: String): String {
        if (TonoVpnService.isSessionEnded(ApiException(status, code, ""))) return "signed-out"
        val ledger = TunnelLedger()
        val ended = ledger.end(connected(ledger), Phase.FAILED, code)
        return observedPhase(ended)
    }

    private fun observedPhase(s: EngineSnapshot): String = when {
        s.phase == Phase.FAILED && s.reasonCode == "RATE_LIMITED" -> "limited"
        s.phase == Phase.IDLE -> "off"
        s.phase == Phase.SIGNED_OUT -> "signed-out"
        s.phase == Phase.NEEDS_PERMISSION -> "needs-permission"
        s.phase == Phase.FAILED -> "failed"
        s.phase == Phase.CONNECTING || s.phase == Phase.PREPARING || s.phase == Phase.DISCONNECTING -> "connecting"
        s.phase == Phase.CONNECTED || s.phase == Phase.DEGRADED -> "connected"
        else -> "other"
    }
}

private data class StateIntentFixture(
    val version: Int,
    val decision: String,
    val accountContractPr: String,
    val accountContractHead: String,
    val scenarios: List<StateIntentScenario>,
)

private data class StateIntentScenario(
    val id: String,
    val rules: List<Int>,
    val expect: StateIntentExpect,
    val platforms: Map<String, StateIntentPlatform>,
)

private data class StateIntentExpect(
    val display: String,
    val notification: String,
    val button: String,
    val failureWritten: Boolean,
    val keepsSession: Boolean,
    val keepsVpnProfile: Boolean,
    val revokesNetworkGrant: Boolean,
    val autoConnect: Boolean,
    val silentNoOp: Boolean,
    val source: String,
    val http: Int,
    val code: String,
    val deletesReports: Boolean,
    val lateStartApplied: Boolean,
    val connectBlocked: Boolean,
    val failureCleared: Boolean,
    val baselineUpdated: Boolean,
    val shownConnected: Boolean,
)

private data class StateIntentPlatform(val enforcement: String, val owner: String, val note: String)

private fun loadFixture(): StateIntentFixture {
    val root = Json.parse(File(repoRoot(), "docs/contracts/state-intent-scenarios.json").readText()).asObject()
    val scenarios = root["scenarios"].asArray().map { raw ->
        val scenario = raw.asObject()
        val expect = scenario["expect"].asObject()
        val platforms = scenario["platforms"].asObject().mapValues { (_, value) ->
            val row = value.asObject()
            StateIntentPlatform(row["enforcement"] as String, row["owner"] as String, row["note"] as String)
        }
        StateIntentScenario(
            scenario["id"] as String,
            scenario["rules"].asArray().map { (it as Number).toInt() },
            StateIntentExpect(
                display = expect["display"] as String,
                notification = expect["notification"] as String,
                button = expect["button"] as String,
                failureWritten = expect["failure_written"] as Boolean,
                keepsSession = expect["keeps_session"] as Boolean,
                keepsVpnProfile = expect["keeps_vpn_profile"] as Boolean,
                revokesNetworkGrant = expect["revokes_network_grant"] as Boolean,
                autoConnect = expect["auto_connect"] as Boolean,
                silentNoOp = expect["silent_no_op"] as Boolean,
                source = expect["source"] as String,
                http = (expect["http"] as Number).toInt(),
                code = expect["code"] as String,
                deletesReports = expect["deletes_reports"] as Boolean,
                lateStartApplied = expect["late_start_applied"] as Boolean,
                connectBlocked = expect["connect_blocked"] as Boolean,
                failureCleared = expect["failure_cleared"] as Boolean,
                baselineUpdated = expect["baseline_updated"] as Boolean,
                shownConnected = expect["shown_connected"] as Boolean,
            ),
            platforms,
        )
    }
    return StateIntentFixture(
        (root["version"] as Number).toInt(),
        root["decision"] as String,
        root["account_contract_pr"] as String,
        root["account_contract_head"] as String,
        scenarios,
    )
}

private fun repoRoot(): File {
    var dir = File(System.getProperty("user.dir"))
    while (true) {
        if (File(dir, "docs/contracts/state-intent-scenarios.json").isFile) return dir
        dir = dir.parentFile ?: error("state-intent fixture not found from ${System.getProperty("user.dir")}")
    }
}

private fun problems(scenario: StateIntentScenario): List<String> {
    val e = scenario.expect
    val id = scenario.id
    val p = mutableListOf<String>()
    fun want(name: String, got: String, exp: String) {
        if (got != exp) p.add("$id $name=$got want $exp")
    }
    fun flag(name: String, got: Boolean, exp: Boolean) {
        if (got != exp) p.add("$id $name=$got want $exp")
    }
    if (e.silentNoOp) p.add("$id silent no-op")
    when (id) {
        "user-disconnect" -> {
            want("display", e.display, "off")
            want("notification", e.notification, "none")
            want("button", e.button, "connect")
            flag("failure", e.failureWritten, false)
            flag("session", e.keepsSession, true)
            flag("shown", e.shownConnected, false)
        }
        "system-revoke" -> {
            want("display", e.display, "needs-permission")
            want("notification", e.notification, "permission-revoked")
            want("button", e.button, "open-settings")
            want("source", e.source, "system")
            flag("session", e.keepsSession, true)
            flag("shown", e.shownConnected, false)
        }
        "core-crash" -> {
            want("display", e.display, "failed")
            want("notification", e.notification, "core-crashed")
            want("button", e.button, "retry")
            flag("failure", e.failureWritten, true)
            want("source", e.source, "core")
            flag("shown", e.shownConnected, false)
            flag("session", e.keepsSession, true)
        }
        "jetsam-or-process-killed" -> {
            want("display", e.display, "failed")
            want("notification", e.notification, "process-killed")
            want("button", e.button, "retry")
            flag("failure", e.failureWritten, true)
            want("source", e.source, "core")
            flag("shown", e.shownConnected, false)
        }
        "network-lost" -> {
            want("display", e.display, "failed")
            want("notification", e.notification, "network-lost")
            want("button", e.button, "retry")
            want("source", e.source, "network")
            flag("failure", e.failureWritten, true)
            flag("session", e.keepsSession, true)
        }
        "sign-out" -> {
            want("display", e.display, "signed-out")
            want("notification", e.notification, "none")
            want("button", e.button, "sign-in")
            flag("failure", e.failureWritten, false)
            flag("session", e.keepsSession, false)
            flag("profile", e.keepsVpnProfile, false)
            flag("shown", e.shownConnected, false)
        }
        "plan-expired" -> {
            want("display", e.display, "account-hold")
            want("notification", e.notification, "plan-expired")
            want("button", e.button, "renew")
            flag("http", e.http == 403, true)
            want("code", e.code, "PLAN_EXPIRED")
            flag("session", e.keepsSession, true)
            flag("profile", e.keepsVpnProfile, true)
            flag("grant", e.revokesNetworkGrant, true)
            flag("auto", e.autoConnect, false)
            flag("failure", e.failureWritten, false)
            want("source", e.source, "account")
        }
        "quota-exhausted" -> {
            want("display", e.display, "account-hold")
            want("notification", e.notification, "quota-exhausted")
            want("button", e.button, "renew")
            flag("http", e.http == 403, true)
            want("code", e.code, "QUOTA_EXHAUSTED")
            flag("session", e.keepsSession, true)
            flag("profile", e.keepsVpnProfile, true)
            flag("grant", e.revokesNetworkGrant, true)
            flag("auto", e.autoConnect, false)
            flag("failure", e.failureWritten, false)
            want("source", e.source, "account")
        }
        "device-reauth-required" -> {
            want("display", e.display, "reauth")
            want("notification", e.notification, "reauth-required")
            want("button", e.button, "verify-login")
            flag("http", e.http == 403, true)
            want("code", e.code, "DEVICE_REAUTH_REQUIRED")
            flag("session", e.keepsSession, true)
            flag("profile", e.keepsVpnProfile, true)
            flag("auto", e.autoConnect, false)
            flag("failure", e.failureWritten, false)
            want("source", e.source, "account")
        }
        "explicit-credential-revoke" -> {
            want("display", e.display, "signed-out")
            want("notification", e.notification, "signed-out")
            want("button", e.button, "sign-in")
            flag("http", e.http == 401, true)
            want("code", e.code, "UNAUTHORIZED")
            flag("session", e.keepsSession, false)
            flag("profile", e.keepsVpnProfile, false)
            flag("failure", e.failureWritten, false)
            want("source", e.source, "account")
        }
        "rate-limited" -> {
            want("display", e.display, "limited")
            want("notification", e.notification, "rate-limited")
            want("button", e.button, "retry")
            flag("http", e.http == 429, true)
            want("code", e.code, "RATE_LIMITED")
            flag("session", e.keepsSession, true)
            flag("reports", e.deletesReports, false)
            flag("profile", e.keepsVpnProfile, true)
        }
        "recovery-success" -> {
            want("display", e.display, "connected")
            want("notification", e.notification, "recovered")
            want("button", e.button, "disconnect")
            flag("cleared", e.failureCleared, true)
            flag("failure", e.failureWritten, false)
            flag("shown", e.shownConnected, true)
            flag("session", e.keepsSession, true)
        }
        "retry-without-catalog" -> {
            want("display", e.display, "catalog-missing")
            want("notification", e.notification, "catalog-missing")
            want("button", e.button, "retry")
            flag("session", e.keepsSession, true)
        }
        "cancel-then-late-start" -> {
            want("display", e.display, "off")
            want("notification", e.notification, "none")
            want("button", e.button, "connect")
            flag("late", e.lateStartApplied, false)
            flag("shown", e.shownConnected, false)
            flag("failure", e.failureWritten, false)
        }
        "recheck-while-connected" -> {
            want("display", e.display, "connected")
            want("notification", e.notification, "none")
            want("button", e.button, "disconnect")
            flag("shown", e.shownConnected, true)
            flag("failure", e.failureWritten, false)
        }
        "optional-rollback-failed" -> {
            want("display", e.display, "failed")
            want("notification", e.notification, "rollback-failed")
            want("button", e.button, "retry")
            flag("shown", e.shownConnected, false)
            flag("baseline", e.baselineUpdated, true)
            flag("failure", e.failureWritten, true)
            want("source", e.source, "core")
        }
        "network-restored-update-retired" -> {
            want("display", e.display, "ready")
            want("notification", e.notification, "none")
            want("button", e.button, "connect")
            flag("blocked", e.connectBlocked, false)
            flag("shown", e.shownConnected, false)
        }
        "network-restored-update-still-pending" -> {
            want("display", e.display, "update-pending")
            want("notification", e.notification, "update-still-pending")
            want("button", e.button, "explain-blocked")
            flag("blocked", e.connectBlocked, true)
            flag("shown", e.shownConnected, false)
        }
        else -> p.add("unknown scenario $id")
    }
    return p
}

private fun scanErrorCodes(platform: String, repo: File) {
    val json = Json.parse(File(repo, "docs/contracts/state-intent-error-code-allowlist.json").readText()).asObject()
    val patterns = json["patterns"].asArray().map { it as String }
    val roots = json["scan"].asObject()[platform].asArray().map { it as String }
    val allow = json["allow"].asArray().map { it.asObject() }.filter { it["platform"] == platform }
    val extensions = setOf("kt", "swift", "tsx", "ts", "rs")
    val matches = mutableListOf<Pair<String, String>>()
    for (rel in roots) {
        val root = File(repo, rel)
        assertTrue("missing scan root $rel", root.exists())
        val files = if (root.isDirectory) root.walkTopDown().filter { it.isFile }.toList() else listOf(root)
        for (file in files) {
            if (file.extension !in extensions) continue
            val relPath = file.relativeTo(repo).invariantSeparatorsPath
            if (relPath.contains("/src/test/") || relPath.contains("/build/")) continue
            for (raw in file.readLines()) {
                val line = raw.removeSuffix("\r")
                if (patterns.any { line.contains(it) }) matches.add(relPath to line)
            }
        }
    }
    for ((path, line) in matches) {
        val listed = allow.any { it["file"] == path && line.contains(it["snippet"] as String) }
        assertTrue("unlisted code render $path: $line", listed)
    }
    for (entry in allow) {
        val file = entry["file"] as String
        val snippet = entry["snippet"] as String
        val live = matches.any { it.first == file && it.second.contains(snippet) }
        assertTrue("stale allowlist $file $snippet", live)
    }
}
