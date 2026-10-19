package com.raydocs.tono.mobile.engine

import com.raydocs.tono.mobile.surface.PublicStatus
import com.raydocs.tono.routing.RoutingMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The engine's tunnel bookkeeping, driven step by step as [TonoVpnService] drives it: what counts as
 * a confirmed tunnel, and what a reload, a refusal, a failed recovery or a late result leaves behind.
 * Pure JVM; no clock is read (times are passed in).
 */
class TunnelAuthorityTest {
    private val tokyo = "Tokyo · Dawn"
    private val la = "Los Angeles · Grove"
    private val base = EngineSnapshot(
        phase = Phase.IDLE, nodes = listOf(NodeView(tokyo, "Tokyo", "Dawn"), NodeView(la, "Los Angeles", "Grove")),
        selectedNode = tokyo, mode = RoutingMode.THREE_TIER, session = "engine-a",
    )
    private val ok = ExitProbe(ProbeState.OK, "JP")
    private val homeOk = ExitProbe(ProbeState.OK, "US")

    /** Connect → start (TUN established) → exits answer: the path every confirmed tunnel takes. */
    private fun connected(ledger: TunnelLedger): EngineSnapshot {
        val preparing = ledger.begin(base, Phase.PREPARING)
        val gen = ledger.attempt
        val started = ledger.started(preparing.copy(phase = Phase.CONNECTING), gen, tunEstablished = true, node = tokyo, mode = RoutingMode.THREE_TIER, sinceMs = 1_000)!!
        return ledger.probed(started, gen, ok, homeOk)!!
    }

    @Test fun aConfirmedStartWithAnsweringExitsIsConnected() {
        val s = connected(TunnelLedger())
        assertEquals(Phase.CONNECTED, s.phase)
        assertTrue(s.tunnelUp)
        assertEquals(tokyo, TunnelAuthority.appliedNode(s))
    }

    @Test fun aTunnelUpPhaseWithoutAConfirmationForItsAttemptIsSealedToConnecting() {
        val claimed = base.copy(phase = Phase.CONNECTED, attempt = 4, applied = AppliedTunnel(3, tokyo, RoutingMode.THREE_TIER), cloudProbe = ok)
        val sealed = TunnelAuthority.seal(claimed)
        assertEquals(Phase.CONNECTING, sealed.phase)
        assertNull(sealed.applied)
        assertNull("no exit verdict survives the demotion", sealed.cloudProbe.location)
        assertFalse(sealed.tunnelUp)
    }

    @Test fun aStartWithoutAnEstablishedTunFailsInsteadOfConfirming() {
        val ledger = TunnelLedger()
        val preparing = ledger.begin(base, Phase.PREPARING)
        val s = ledger.started(preparing, ledger.attempt, tunEstablished = false, node = tokyo, mode = RoutingMode.THREE_TIER, sinceMs = 1_000)!!
        assertEquals(Phase.FAILED, s.phase)
        assertNull(s.applied)
        assertNull("no exit check is accepted for it", ledger.probed(s, ledger.attempt, ok, homeOk))
    }

    @Test fun selectingALineWhileConnectedLeavesTheRunningLineAsTheAppliedOne() {
        // The engine records the selection, then reloads: in between, the selection is not the current line.
        val selected = connected(TunnelLedger()).copy(selectedNode = la)
        assertTrue(selected.tunnelUp)
        assertEquals(tokyo, TunnelAuthority.appliedNode(selected))
        assertEquals(tokyo, PublicStatus.of(selected, nowMs = 0, boot = 1, elapsedMs = 0).appliedLine)
    }

    @Test fun aReloadClearsTheConfirmationBeforeTheCoreRestarts() {
        val ledger = TunnelLedger()
        val reloading = ledger.begin(connected(ledger).copy(selectedNode = la), Phase.CONNECTING)
        assertFalse(reloading.tunnelUp)
        assertNull(reloading.applied)
        assertNull(TunnelAuthority.appliedNode(reloading))
        assertNull(reloading.cloudProbe.location)
    }

    @Test fun aModeChangeIsAppliedOnlyOnceTheReloadedTunnelIsConfirmed() {
        val ledger = TunnelLedger()
        val requested = connected(ledger).copy(mode = RoutingMode.STABLE)
        assertEquals("selected, not yet applied", RoutingMode.THREE_TIER, TunnelAuthority.appliedMode(requested))
        val reloading = ledger.begin(requested, Phase.CONNECTING)
        assertNull(TunnelAuthority.appliedMode(reloading))
        val started = ledger.started(reloading, ledger.attempt, tunEstablished = true, node = tokyo, mode = RoutingMode.STABLE, sinceMs = 2_000)!!
        val up = ledger.probed(started, ledger.attempt, ok, homeOk)!!
        assertEquals(RoutingMode.STABLE, TunnelAuthority.appliedMode(up))
    }

    @Test fun aReloadAndroidRefusesEndsWithoutAConfirmedTunnel() {
        // establish() returned null on reload (consent revoked): the core start throws, the engine ends the attempt.
        val ledger = TunnelLedger()
        val reloading = ledger.begin(connected(ledger).copy(selectedNode = la), Phase.CONNECTING)
        val refused = ledger.end(reloading, Phase.NEEDS_PERMISSION, "REVOKED")
        assertEquals(Phase.NEEDS_PERMISSION, refused.phase)
        assertNull(refused.applied)
        assertNull("neither the old nor the requested line is current", TunnelAuthority.appliedNode(refused))
    }

    @Test fun aFailedRecoveryNeverShowsTheRequestedLineAsCurrent() {
        // Android has no rollback: a failed reload closed the old tunnel, and the record says so.
        val ledger = TunnelLedger()
        val reloading = ledger.begin(connected(ledger).copy(selectedNode = la), Phase.CONNECTING)
        val failed = ledger.end(reloading, Phase.FAILED, "CORE_START")
        val record = PublicStatus.of(failed, nowMs = 0, boot = 1, elapsedMs = 0)
        assertFalse(record.confirmed)
        assertNull(record.appliedLine)
        assertNull(record.cloud)
        assertEquals("the selection stays labelled as the selection", la, record.line)
    }

    @Test fun heartbeatsAfterAFailedReloadCarryNoConfirmation() {
        val ledger = TunnelLedger()
        val failed = ledger.end(ledger.begin(connected(ledger), Phase.CONNECTING), Phase.FAILED, "CORE_START")
        // Later writes (traffic, catalog) copy the failed snapshot; none of them brings the confirmation back.
        val later = TunnelAuthority.seal(failed.copy(version = failed.version + 5, phase = Phase.CONNECTED))
        assertFalse(later.tunnelUp)
        assertFalse(PublicStatus.of(later, nowMs = 0, boot = 1, elapsedMs = 10_000).confirmed)
    }

    @Test fun exitChecksFromAnEarlierAttemptAreIgnored() {
        val ledger = TunnelLedger()
        val first = connected(ledger)
        val earlier = ledger.attempt
        val reloading = ledger.begin(first, Phase.CONNECTING)
        assertNull(ledger.probed(reloading, earlier, ok, homeOk))
        val started = ledger.started(reloading, ledger.attempt, tunEstablished = true, node = la, mode = RoutingMode.THREE_TIER, sinceMs = 3_000)!!
        assertNull("still the old attempt's answers", ledger.probed(started, earlier, ok, homeOk))
    }

    @Test fun aLateStartResultFromAnEarlierAttemptIsIgnored() {
        val ledger = TunnelLedger()
        val preparing = ledger.begin(base, Phase.PREPARING)
        val earlier = ledger.attempt
        val stopped = ledger.end(ledger.begin(preparing, Phase.DISCONNECTING), Phase.IDLE, null)
        assertNull(ledger.started(stopped, earlier, tunEstablished = true, node = tokyo, mode = RoutingMode.THREE_TIER, sinceMs = 1_000))
        assertFalse(TunnelAuthority.seal(stopped).tunnelUp)
    }

    @Test fun recheckingKeepsNoEarlierVerdictAsCurrent() {
        val ledger = TunnelLedger()
        val rechecking = ledger.rechecking(connected(ledger))!!
        assertEquals(ProbeState.CHECKING, rechecking.cloudProbe.state)
        assertNull(rechecking.cloudProbe.location)
        assertNull("nothing to recheck without a confirmed tunnel", ledger.rechecking(base))
    }

    @Test fun snapshotJsonCarriesTheConfirmationIdentity() {
        val s = connected(TunnelLedger()).copy(version = 12)
        assertEquals(s, EngineSnapshot.fromJson(s.toJson()))
    }

    @Test fun aSnapshotFromAnOlderEngineDecodesAsUnconfirmed() {
        // An older engine's JSON: Connected, with no session, attempt or confirmation.
        val legacy = connected(TunnelLedger()).copy(session = "", attempt = 0, applied = null)
        val json = legacy.toJson().replace(Regex(""","session":.*$"""), "}")
        assertFalse(json.contains("\"applied\""))
        val decoded = EngineSnapshot.fromJson(json)
        assertEquals(Phase.CONNECTING, decoded.phase)
        assertFalse(decoded.tunnelUp)
        assertNull(decoded.applied)
    }
}
