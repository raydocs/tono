package com.raydocs.tono.mobile.engine

import com.raydocs.tono.routing.RoutingMode

/**
 * What the engine confirmed for one attempt: sing-box returned from starting (or reloading) it and
 * Android established a TUN during that same call. [node] and [mode] are what that start used, not
 * what the user has selected since.
 */
data class AppliedTunnel(val generation: Long, val node: String?, val mode: RoutingMode)

/**
 * The one rule every reader of an [EngineSnapshot] uses (the app, the ongoing notification and the
 * shared status behind the tile and widget): a tunnel-up phase counts only when the snapshot carries
 * a confirmation for its own attempt. Anything else (a legacy record, a fixture, a reload in flight)
 * is shown as still connecting, never as connected.
 */
object TunnelAuthority {
    /** Phases that claim a working tunnel. */
    val UP = setOf(Phase.CONNECTED, Phase.DEGRADED)

    /** Phases in which a confirmation may stand: after the start returned, while the exits are checked, and after. */
    private val HOLDS_APPLIED = setOf(Phase.CONNECTING, Phase.CONNECTED, Phase.DEGRADED)

    fun confirmed(s: EngineSnapshot): Boolean =
        s.phase in UP && s.attempt > 0 && s.applied?.generation == s.attempt

    /**
     * Drops a confirmation that is not for this attempt or phase, and demotes an unconfirmed tunnel
     * claim to Connecting (with no exit verdicts). Idempotent; the engine applies it to every write,
     * the decoder to every read.
     */
    fun seal(s: EngineSnapshot): EngineSnapshot {
        val applied = s.applied?.takeIf { s.attempt > 0 && it.generation == s.attempt && s.phase in HOLDS_APPLIED }
        val demote = s.phase in UP && applied == null
        if (applied == s.applied && !demote) return s
        return if (demote) s.copy(phase = Phase.CONNECTING, applied = null, cloudProbe = ExitProbe(), homeProbe = ExitProbe())
        else s.copy(applied = applied)
    }

    /** The line the confirmed tunnel uses, or null: a selection is not a current line. */
    fun appliedNode(s: EngineSnapshot): String? = s.applied?.node?.takeIf { confirmed(s) }

    /** The mode the confirmed tunnel uses, or null. */
    fun appliedMode(s: EngineSnapshot): RoutingMode? = s.applied?.mode?.takeIf { confirmed(s) }
}

/**
 * The engine's tunnel bookkeeping, engine thread only: which attempt is current and whether it is
 * confirmed. Every connect, reload, disconnect and failure starts or ends an attempt, which clears
 * the confirmation first; results that arrive for an earlier attempt (a start, exit checks) are
 * ignored. Pure, so the JVM drives every fault [TonoVpnService] meets.
 */
class TunnelLedger {
    var attempt = 0L
        private set

    fun isCurrent(gen: Long) = gen == attempt

    /** A new attempt in [phase]: PREPARING to connect, CONNECTING to reload, DISCONNECTING after physical close. */
    fun begin(s: EngineSnapshot, phase: Phase): EngineSnapshot {
        attempt++
        return s.copy(phase = phase, reasonCode = null, attempt = attempt, applied = null, cloudProbe = ExitProbe(), homeProbe = ExitProbe())
    }

    /**
     * sing-box returned from starting [gen] with the line and mode it was given. Confirmed only when
     * Android established a TUN during that call ([tunEstablished]); otherwise the attempt failed.
     * Null for an earlier attempt: a newer one owns the state.
     */
    fun started(s: EngineSnapshot, gen: Long, tunEstablished: Boolean, node: String?, mode: RoutingMode, sinceMs: Long): EngineSnapshot? {
        if (!isCurrent(gen)) return null
        if (!tunEstablished) return end(s, Phase.FAILED, "CORE_START")
        return s.copy(
            phase = Phase.CONNECTING, applied = AppliedTunnel(gen, node, mode), connectedSinceMs = sinceMs,
            cloudProbe = ExitProbe(ProbeState.CHECKING), homeProbe = ExitProbe(ProbeState.CHECKING),
        )
    }

    /** Exit checks for [gen]; null unless that attempt is current and confirmed. */
    fun probed(s: EngineSnapshot, gen: Long, cloud: ExitProbe, home: ExitProbe): EngineSnapshot? {
        if (!isCurrent(gen) || s.attempt != gen || s.applied?.generation != gen || s.phase !in setOf(Phase.CONNECTING, Phase.CONNECTED, Phase.DEGRADED)) return null
        val reason = when {
            cloud.state != ProbeState.OK -> "CLOUD_UNREACHABLE"
            home.state != ProbeState.OK -> "HOME_UNREACHABLE"
            else -> null
        }
        return s.copy(phase = if (reason == null) Phase.CONNECTED else Phase.DEGRADED, reasonCode = reason, cloudProbe = cloud, homeProbe = home)
    }

    /** Asks the exits again on a confirmed tunnel; the last verdicts are not kept as current. Null if none is confirmed. */
    fun rechecking(s: EngineSnapshot): EngineSnapshot? =
        if (!TunnelAuthority.confirmed(s)) null else s.copy(reasonCode = null, cloudProbe = ExitProbe(ProbeState.CHECKING), homeProbe = ExitProbe(ProbeState.CHECKING))

    /** Whether a queued core-stop callback still belongs to the live attempt. */
    fun acceptsCoreStop(s: EngineSnapshot, gen: Long): Boolean =
        isCurrent(gen) && s.attempt == gen && s.phase in setOf(Phase.PREPARING, Phase.CONNECTING, Phase.CONNECTED, Phase.DEGRADED)

    /** Ends the current attempt in a resting [phase]; no tunnel is confirmed afterwards. */
    fun end(s: EngineSnapshot, phase: Phase, reasonCode: String?): EngineSnapshot {
        attempt++
        return s.copy(
            phase = phase, reasonCode = reasonCode, attempt = attempt, applied = null, connectedSinceMs = 0,
            cloudProbe = ExitProbe(), homeProbe = ExitProbe(), rxBytesPerSec = 0, txBytesPerSec = 0,
        )
    }
}
