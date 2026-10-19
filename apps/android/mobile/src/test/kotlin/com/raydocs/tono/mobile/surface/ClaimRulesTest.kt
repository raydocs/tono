package com.raydocs.tono.mobile.surface

import com.raydocs.tono.mobile.engine.Phase
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which invalidation may replace which notification claim. Every invalidation names the engine
 * instance it is about; instances are compared, never ordered. Pure JVM; clocks are passed in.
 */
class ClaimRulesTest {
    private val now = 5_000_000L
    private fun record(phase: Phase, session: String, ageMs: Long = 0, confirmed: Boolean = phase == Phase.CONNECTED) =
        PublicStatus(phase, updatedAtMs = 0, boot = 7, session = session, version = 3, attempt = 2, confirmed = confirmed, elapsedMs = now - ageMs)
    private fun view(r: PublicStatus, vpn: Boolean? = true, dead: Set<String> = emptySet()) = SurfaceRules.view(r, now, 7, vpn, dead)

    @Test fun aStaleDeathCallbackCannotReplaceTheReconnectedEnginesConnected() {
        // engine-a's binder death was queued; by the time it runs, engine-b posted its own Connected.
        assertFalse(ClaimRules.diedWith(Claim(Phase.CONNECTED, "engine-b"), deadSession = "engine-a"))
        assertTrue(ClaimRules.diedWith(Claim(Phase.CONNECTED, "engine-a"), deadSession = "engine-a"))
    }

    @Test fun aDeathOfAnEngineNeverHeardFromReplacesNothing() =
        assertFalse(ClaimRules.diedWith(Claim(Phase.CONNECTED, ""), deadSession = null))

    @Test fun theAlarmLeavesAClaimItsOwnFreshConfirmedRecordSupports() =
        assertTrue(ClaimRules.supported(Claim(Phase.CONNECTED, "engine-b"), view(record(Phase.CONNECTED, "engine-b"))))

    @Test fun theAlarmReplacesAClaimFromAnEngineThatIsNoLongerTheWriter() {
        // The record is fresh and confirmed, but another instance wrote it: engine-a's claim is a leftover.
        assertFalse(ClaimRules.supported(Claim(Phase.CONNECTED, "engine-a"), view(record(Phase.CONNECTED, "engine-b"))))
    }

    @Test fun aDozeDelayedAlarmLeavesTheNextEnginesConfirmedClaim() {
        // Armed by engine-a, held back by Doze, fired after engine-a died and engine-b connected.
        val v = view(record(Phase.CONNECTED, "engine-b"), dead = setOf("engine-a"))
        assertTrue(ClaimRules.supported(Claim(Phase.CONNECTED, "engine-b"), v))
    }

    @Test fun aDozeDelayedAlarmReplacesAClaimWhoseHeartbeatStopped() =
        assertFalse(ClaimRules.supported(Claim(Phase.CONNECTED, "engine-a"), view(record(Phase.CONNECTED, "engine-a", ageMs = SurfaceRules.STALE_MS + 1))))

    @Test fun aConnectedClaimOnAnUnknownVpnReadingIsNotSupported() =
        assertFalse(ClaimRules.supported(Claim(Phase.CONNECTED, "engine-a"), view(record(Phase.CONNECTED, "engine-a"), vpn = null)))

    @Test fun aStartingEngineReplacesEveryClaimButItsOwn() {
        assertTrue(ClaimRules.leftOver(Claim(Phase.CONNECTED, "engine-a"), session = "engine-b"))
        assertTrue("an older app version's claim names no instance", ClaimRules.leftOver(Claim(Phase.CONNECTED, ""), session = "engine-b"))
        assertFalse(ClaimRules.leftOver(Claim(Phase.CONNECTING, "engine-b"), session = "engine-b"))
    }

    @Test fun theRepostGuardOnlyReplacesTheDeadEnginesTunnelClaims() {
        assertTrue(ClaimRules.repost(Claim(Phase.CONNECTED, "engine-a"), deadSession = "engine-a"))
        assertFalse("the restarted engine's own Connected stays", ClaimRules.repost(Claim(Phase.CONNECTED, "engine-b"), deadSession = "engine-a"))
        assertFalse("a Connecting claim is not Android's re-post of a tunnel", ClaimRules.repost(Claim(Phase.CONNECTING, "engine-a"), deadSession = "engine-a"))
    }
}
