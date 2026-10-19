package com.raydocs.tono.mobile.surface

import com.raydocs.tono.mobile.engine.Phase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the tile, widget and notification backstop may claim from the engine's shared status. The
 * reader's clocks are passed in: [now] is its elapsed-realtime reading, [wall] only for display.
 */
class SurfaceRulesTest {
    private val now = 5_000_000L
    private val wall = 1_000_000_000L
    private fun status(phase: Phase, ageMs: Long = 0, boot: Int = 7, session: String = "engine-a", confirmed: Boolean = phase == Phase.CONNECTED || phase == Phase.DEGRADED) =
        PublicStatus(
            phase, line = "Tokyo · Dawn", cloud = "JP", updatedAtMs = wall - ageMs, boot = boot,
            session = session, version = 9, attempt = 2, confirmed = confirmed, appliedLine = "Tokyo · Dawn".takeIf { confirmed }, elapsedMs = now - ageMs,
        )
    private fun state(s: PublicStatus?, vpn: Boolean? = true, dead: Set<String> = emptySet()) = SurfaceRules.view(s, now, boot = 7, tonoVpn = vpn, dead = dead).state

    @Test fun noRecordIsUnknownNotOff() = assertEquals(SurfaceState.UNKNOWN, state(null))

    @Test fun aConfirmedTunnelIsShownWhileItsHeartbeatIsFreshOnTheMonotonicClock() {
        assertEquals(SurfaceState.CONNECTED, state(status(Phase.CONNECTED, ageMs = SurfaceRules.STALE_MS)))
        assertEquals(SurfaceState.UNKNOWN, state(status(Phase.CONNECTED, ageMs = SurfaceRules.STALE_MS + 1)))
        assertEquals(SurfaceState.UNKNOWN, state(status(Phase.CONNECTING, ageMs = SurfaceRules.STALE_MS + 1)))
    }

    @Test fun aWallClockSetBackDoesNotMakeAStaleRecordFresh() {
        // Written 40 s ago on the monotonic clock; the wall clock was set back, so it "looks" 5 s old.
        val s = status(Phase.CONNECTED, ageMs = 40_000).copy(updatedAtMs = wall - 5_000)
        assertEquals(SurfaceState.UNKNOWN, state(s))
    }

    @Test fun aRecordFromAheadOfTheReadersClockIsNotFresh() {
        // Another boot whose count could not be read: its elapsed time is ahead of this boot's.
        val s = status(Phase.CONNECTED, ageMs = -60_000, boot = -1)
        assertEquals(SurfaceState.UNKNOWN, SurfaceRules.view(s, now, boot = -1, tonoVpn = true).state)
    }

    @Test fun aDozeDelayedHeartbeatIsUnknownUntilTheNextWriteLands() {
        // The engine's writes were held back past the stale bound (Doze), then one landed.
        assertEquals(SurfaceState.UNKNOWN, state(status(Phase.CONNECTED, ageMs = SurfaceRules.STALE_MS + 25_000)))
        assertEquals(SurfaceState.CONNECTED, state(status(Phase.CONNECTED, ageMs = 0)))
    }

    @Test fun anUnknownVpnReadingIsNotProof() {
        val record = PublicStatus.fromJson(
            """{"phase":"CONNECTED","updatedAtMs":1000,"boot":7,"session":"engine-a","version":1,"attempt":1,"confirmed":true,"appliedLine":"Tokyo","elapsedMs":1000}""",
        )!!
        assertEquals(SurfaceState.CONNECTED, SurfaceRules.view(record, 1000, 7, true).state)
        assertEquals(SurfaceState.UNKNOWN, SurfaceRules.view(record, 1000, 7, null).state)
    }

    @Test fun noTonoVpnNetworkMeansNoTunnelClaim() {
        assertEquals(SurfaceState.UNKNOWN, state(status(Phase.CONNECTED), vpn = false))
        assertEquals(SurfaceState.UNKNOWN, state(status(Phase.DEGRADED), vpn = false))
    }

    @Test fun anotherAppsVpnIsNotTonosTunnel() {
        val me = 10_123
        assertEquals(false, VpnAttribution.tono(listOf(10_456), me))
        assertEquals(false, VpnAttribution.tono(listOf(-1), me)) // owner hidden: not this app's (Android shows the owner its own)
        assertEquals(null, VpnAttribution.tono(listOf(null), me)) // Android 10 cannot say
        assertEquals(true, VpnAttribution.tono(listOf(10_456, me), me))
        assertEquals(false, VpnAttribution.tono(emptyList(), me))
    }

    @Test fun aRecordClaimingConnectedWithoutTheEnginesConfirmationIsUnknown() =
        assertEquals(SurfaceState.UNKNOWN, state(status(Phase.CONNECTED, confirmed = false)))

    @Test fun aLegacyRecordDecodesUnconfirmedAndOfUnknownAge() {
        val legacy = """{"phase":"CONNECTED","reasonCode":null,"line":"Tokyo · Dawn","cloud":"JP","home":null,"updatedAtMs":$wall,"boot":7}"""
        val s = PublicStatus.fromJson(legacy)!!
        assertFalse(s.confirmed)
        assertEquals(-1L, s.elapsedMs)
        assertEquals(SurfaceState.UNKNOWN, state(s))
        assertEquals("last known: it was only ever connecting", SurfaceState.BUSY, SurfaceRules.claimed(s))
    }

    @Test fun anEngineCrashWhileAndroidStillListsItsVpnIsUnknownAtOnce() {
        // The watch heard engine-a die; the record is seconds old and Android has not dropped the VPN yet.
        assertEquals(SurfaceState.UNKNOWN, state(status(Phase.CONNECTED, ageMs = 2_000), vpn = true, dead = setOf("engine-a")))
    }

    @Test fun theOldEnginesDeathDoesNotUnsetTheNewEnginesConnected() {
        val restarted = status(Phase.CONNECTED, session = "engine-b")
        assertEquals(SurfaceState.CONNECTED, state(restarted, vpn = true, dead = setOf("engine-a")))
    }

    @Test fun aTunnelFromBeforeARebootIsOff() = assertEquals(SurfaceState.OFF, state(status(Phase.CONNECTED, boot = 6)))

    @Test fun restingStatesDoNotGoStale() {
        assertEquals(SurfaceState.OFF, state(status(Phase.IDLE, ageMs = 10 * SurfaceRules.STALE_MS), vpn = false))
        assertEquals(SurfaceState.FAILED, state(status(Phase.FAILED, ageMs = 10 * SurfaceRules.STALE_MS), vpn = false))
        assertEquals(SurfaceState.SIGNED_OUT, state(status(Phase.SIGNED_OUT, boot = 1), vpn = false))
    }

    @Test fun aHeartbeatIsDueOnTheMonotonicClockAndAChangeAtOnce() {
        val written = status(Phase.CONNECTED, ageMs = 0)
        assertFalse(SurfaceRules.needsWrite(written, written.copy(elapsedMs = now + SurfaceRules.HEARTBEAT_MS - 1, version = 10)))
        assertTrue(SurfaceRules.needsWrite(written, written.copy(elapsedMs = now + SurfaceRules.HEARTBEAT_MS, version = 11)))
        assertTrue(SurfaceRules.needsWrite(written, written.copy(phase = Phase.DEGRADED, elapsedMs = now + 1, version = 12)))
        // The monotonic clock going backwards (a new boot) is never taken as "written just now".
        assertTrue(SurfaceRules.needsWrite(written, written.copy(elapsedMs = now - 1, version = 13)))
    }

    @Test fun recordRoundTripsWithoutSecrets() {
        val s = status(Phase.DEGRADED).copy(reasonCode = "HOME_UNREACHABLE", home = null)
        assertEquals(s, PublicStatus.fromJson(s.toJson()))
        assertEquals(
            setOf("phase", "reasonCode", "line", "cloud", "home", "updatedAtMs", "boot", "session", "version", "attempt", "confirmed", "appliedLine", "elapsedMs"),
            Regex("\"(\\w+)\":").findAll(s.toJson()).map { it.groupValues[1] }.toSet(),
        )
        assertNull(PublicStatus.fromJson("{}"))
    }
}
