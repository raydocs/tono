package com.raydocs.tono.mobile.surface

import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.mobile.engine.TunnelAuthority

/** What an engine's ongoing notification claims: its phase, and the engine instance that posted it ("" if it does not say). */
data class Claim(val phase: Phase, val session: String)

/**
 * When an invalidation may replace the ongoing notification. Every invalidation names the engine
 * instance it is about, so a late one (a queued death callback, an alarm Doze held back, an app
 * process thawed after the engine was replaced) never takes a newer engine's claim away. Engine
 * instances are compared for equality only, never ordered by any clock.
 */
object ClaimRules {
    /** A death heard for [deadSession] (the watch, the open app): only that instance's claim died with it. */
    fun diedWith(claim: Claim?, deadSession: String?): Boolean =
        claim != null && !deadSession.isNullOrEmpty() && claim.session == deadSession

    /** A new engine instance [session] starting: no earlier claim can be its own (Android re-posts the dead one's). */
    fun leftOver(claim: Claim?, session: String): Boolean = claim != null && claim.session != session

    /** After [deadSession] died, before a new engine registers: only that instance's tunnel-up claim is Android's re-post. */
    fun repost(claim: Claim?, deadSession: String?): Boolean =
        diedWith(claim, deadSession) && claim!!.phase in TunnelAuthority.UP

    /**
     * The alarm backstop: a claim stands only on a record from the same engine instance, and only
     * as far as [view] (fresh, this boot, writer not dead, confirmed and Android listing Tono's VPN
     * for a tunnel) supports it.
     */
    fun supported(claim: Claim, view: SurfaceView): Boolean {
        val record = view.status ?: return false
        if (claim.session.isEmpty() || record.session != claim.session) return false
        return when (claim.phase) {
            Phase.CONNECTED, Phase.DEGRADED -> view.state == SurfaceState.CONNECTED || view.state == SurfaceState.DEGRADED
            else -> view.state == SurfaceState.BUSY || view.state == SurfaceState.CONNECTED || view.state == SurfaceState.DEGRADED
        }
    }
}
