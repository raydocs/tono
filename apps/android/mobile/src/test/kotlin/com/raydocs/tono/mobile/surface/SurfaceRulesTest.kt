package com.raydocs.tono.mobile.surface

import com.raydocs.tono.mobile.engine.Phase
import org.junit.Assert.assertEquals
import org.junit.Test

/** What the tile and widget may claim from the engine's shared status. */
class SurfaceRulesTest {
    private val now = 1_000_000_000L
    private fun status(phase: Phase, ageMs: Long = 0, boot: Int = 7) = PublicStatus(phase, line = "Tokyo · Dawn", cloud = "JP", updatedAtMs = now - ageMs, boot = boot)
    private fun state(s: PublicStatus?, vpn: Boolean? = true) = SurfaceRules.view(s, now, boot = 7, vpnPresent = vpn).state

    @Test fun noRecordIsUnknownNotOff() = assertEquals(SurfaceState.UNKNOWN, state(null))

    @Test fun aTunnelIsShownOnlyWhileItsHeartbeatIsFresh() {
        assertEquals(SurfaceState.CONNECTED, state(status(Phase.CONNECTED, ageMs = SurfaceRules.STALE_MS - 1)))
        assertEquals(SurfaceState.UNKNOWN, state(status(Phase.CONNECTED, ageMs = SurfaceRules.STALE_MS + 1)))
        assertEquals(SurfaceState.UNKNOWN, state(status(Phase.CONNECTING, ageMs = SurfaceRules.STALE_MS + 1)))
    }

    @Test fun androidMustAgreeAVpnExists() {
        assertEquals(SurfaceState.UNKNOWN, state(status(Phase.CONNECTED), vpn = false))
        assertEquals(SurfaceState.UNKNOWN, state(status(Phase.DEGRADED), vpn = false))
        assertEquals(SurfaceState.CONNECTED, state(status(Phase.CONNECTED), vpn = null)) // cannot tell: trust the fresh record
    }

    @Test fun aTunnelFromBeforeARebootIsOff() = assertEquals(SurfaceState.OFF, state(status(Phase.CONNECTED, boot = 6)))

    @Test fun restingStatesDoNotGoStale() {
        assertEquals(SurfaceState.OFF, state(status(Phase.IDLE, ageMs = 10 * SurfaceRules.STALE_MS), vpn = false))
        assertEquals(SurfaceState.FAILED, state(status(Phase.FAILED, ageMs = 10 * SurfaceRules.STALE_MS), vpn = false))
        assertEquals(SurfaceState.SIGNED_OUT, state(status(Phase.SIGNED_OUT, boot = 1), vpn = false))
    }

    @Test fun recordRoundTripsWithoutSecrets() {
        val s = status(Phase.DEGRADED).copy(reasonCode = "HOME_UNREACHABLE", home = null)
        assertEquals(s, PublicStatus.fromJson(s.toJson()))
        assertEquals(setOf("phase", "reasonCode", "line", "cloud", "home", "updatedAtMs", "boot"), Regex("\"(\\w+)\":").findAll(s.toJson()).map { it.groupValues[1] }.toSet())
    }
}
