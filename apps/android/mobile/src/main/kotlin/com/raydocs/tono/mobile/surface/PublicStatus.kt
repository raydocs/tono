package com.raydocs.tono.mobile.surface

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.mobile.engine.TunnelAuthority
import com.raydocs.tono.routing.Json
import com.raydocs.tono.routing.asObject
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile

/**
 * The part of the engine's state that system surfaces (Quick Settings tile, home-screen widget)
 * may show. Written by the engine in `:vpn`, read by any process. No tokens, e-mail or catalog.
 */
data class PublicStatus(
    val phase: Phase,
    val reasonCode: String? = null,
    /** The selected line: a preference, shown as such, never as the line in use. */
    val line: String? = null,
    val cloud: String? = null,
    val home: String? = null,
    /** Wall clock when written: for "last known at …" only, never for age or order. */
    val updatedAtMs: Long,
    /** [Settings.Global.BOOT_COUNT] when written: a tunnel never survives a reboot. */
    val boot: Int,
    /** The engine instance that wrote it ([EngineSnapshot.session]). */
    val session: String = "",
    /** That instance's snapshot version; a write never replaces a higher one from the same instance. */
    val version: Long = 0,
    /** The tunnel attempt [phase] belongs to. */
    val attempt: Long = 0,
    /** The engine confirmed the tunnel for [attempt] ([TunnelAuthority.confirmed]); false in records from before this field. */
    val confirmed: Boolean = false,
    /** The line the confirmed tunnel uses, or null. */
    val appliedLine: String? = null,
    /** [SystemClock.elapsedRealtime] when written: the only clock age is measured on; -1 if unknown. */
    val elapsedMs: Long = -1,
) {
    fun toJson(): String = Json.write(
        linkedMapOf(
            "phase" to phase.name, "reasonCode" to reasonCode, "line" to line, "cloud" to cloud, "home" to home,
            "updatedAtMs" to updatedAtMs, "boot" to boot, "session" to session, "version" to version, "attempt" to attempt,
            "confirmed" to confirmed, "appliedLine" to appliedLine, "elapsedMs" to elapsedMs,
        ),
    )

    /** Same content, ignoring when and in which write: decides whether a write is a change or a heartbeat. */
    fun sameAs(o: PublicStatus?) = o != null && heartbeatless() == o.heartbeatless()

    private fun heartbeatless() = copy(updatedAtMs = 0, elapsedMs = 0, version = 0)

    companion object {
        fun of(snapshot: EngineSnapshot, nowMs: Long, boot: Int, elapsedMs: Long): PublicStatus {
            val s = TunnelAuthority.seal(snapshot)
            val confirmed = TunnelAuthority.confirmed(s)
            return PublicStatus(
                phase = s.phase,
                reasonCode = s.reasonCode,
                line = (s.nodes.firstOrNull { it.name == s.selectedNode } ?: s.nodes.firstOrNull())?.name,
                cloud = s.cloudProbe.location.takeIf { confirmed },
                home = s.homeProbe.location.takeIf { confirmed },
                updatedAtMs = nowMs,
                boot = boot,
                session = s.session,
                version = s.version,
                attempt = s.attempt,
                confirmed = confirmed,
                appliedLine = TunnelAuthority.appliedNode(s),
                elapsedMs = elapsedMs,
            )
        }

        /** A record from an older engine lacks the confirmation and the monotonic time: it decodes as unconfirmed and of unknown age. */
        fun fromJson(text: String): PublicStatus? = runCatching {
            val m = Json.parse(text).asObject()
            PublicStatus(
                phase = Phase.valueOf(m["phase"] as String),
                reasonCode = m["reasonCode"] as String?,
                line = m["line"] as String?,
                cloud = m["cloud"] as String?,
                home = m["home"] as String?,
                updatedAtMs = (m["updatedAtMs"] as Number).toLong(),
                boot = (m["boot"] as Number).toInt(),
                session = m["session"] as? String ?: "",
                version = (m["version"] as? Number)?.toLong() ?: 0,
                attempt = (m["attempt"] as? Number)?.toLong() ?: 0,
                confirmed = m["confirmed"] as? Boolean ?: false,
                appliedLine = m["appliedLine"] as? String,
                elapsedMs = (m["elapsedMs"] as? Number)?.toLong() ?: -1,
            )
        }.getOrNull()
    }
}

/** What a system surface shows. Never claims a tunnel it cannot vouch for. */
enum class SurfaceState { SIGNED_OUT, OFF, NEEDS_PERMISSION, BUSY, CONNECTED, DEGRADED, FAILED, UNKNOWN }

data class SurfaceView(val state: SurfaceState, val status: PublicStatus?)

object SurfaceRules {
    /** The engine rewrites the status at least this often while a tunnel is up or starting. */
    const val HEARTBEAT_MS = 10_000L
    const val STALE_MS = 3 * HEARTBEAT_MS

    val LIVE = setOf(Phase.PREPARING, Phase.CONNECTING, Phase.CONNECTED, Phase.DEGRADED, Phase.DISCONNECTING)

    /**
     * [nowMs]: the reader's [SystemClock.elapsedRealtime]. [tonoVpn]: whether Android lists Tono's own
     * VPN network ([VpnAttribution]; null if it cannot tell). [dead]: engine instances known to have
     * died this boot ([DeathLog]). A live record is shown only when it is from this boot, its
     * heartbeat is fresh on the monotonic clock, and its writer is not known dead; a tunnel claim
     * also needs the engine's confirmation and Android listing Tono's VPN. Otherwise the surface says
     * "unknown" rather than guessing either way.
     */
    fun view(s: PublicStatus?, nowMs: Long, boot: Int, tonoVpn: Boolean?, dead: Set<String> = emptySet()): SurfaceView {
        if (s == null) return SurfaceView(SurfaceState.UNKNOWN, null)
        if (s.phase !in LIVE) return SurfaceView(stateFor(s.phase), s)
        if (boot >= 0 && s.boot >= 0 && s.boot != boot) return SurfaceView(SurfaceState.OFF, s) // rebooted since: that tunnel is gone
        if (!fresh(s, nowMs)) return SurfaceView(SurfaceState.UNKNOWN, s)
        // Its engine died; Android may still list the dead tunnel's VPN network for a while.
        if (s.session.isNotEmpty() && s.session in dead) return SurfaceView(SurfaceState.UNKNOWN, s)
        if (s.phase in TunnelAuthority.UP && (!s.confirmed || tonoVpn != true)) return SurfaceView(SurfaceState.UNKNOWN, s)
        return SurfaceView(stateFor(s.phase), s)
    }

    /** Written within [STALE_MS] on the monotonic clock. A record with no monotonic time, or from "the future" (another boot), is not fresh. */
    fun fresh(s: PublicStatus, nowMs: Long): Boolean {
        val age = nowMs - s.elapsedMs
        return s.elapsedMs >= 0 && age >= 0 && age <= STALE_MS
    }

    /** Whether [next] must be written: a change, or a heartbeat due on the monotonic clock. */
    fun needsWrite(previous: PublicStatus?, next: PublicStatus): Boolean =
        !next.sameAs(previous) || previous == null || next.elapsedMs - previous.elapsedMs !in 0 until HEARTBEAT_MS

    /** The state a record claimed, for "last known": an unconfirmed tunnel claim was only ever connecting. */
    fun claimed(s: PublicStatus): SurfaceState =
        if (s.phase in TunnelAuthority.UP && !s.confirmed) SurfaceState.BUSY else stateFor(s.phase)

    fun stateFor(p: Phase): SurfaceState = when (p) {
        Phase.SIGNED_OUT -> SurfaceState.SIGNED_OUT
        Phase.IDLE -> SurfaceState.OFF
        Phase.NEEDS_PERMISSION -> SurfaceState.NEEDS_PERMISSION
        Phase.PREPARING, Phase.CONNECTING, Phase.DISCONNECTING -> SurfaceState.BUSY
        Phase.CONNECTED -> SurfaceState.CONNECTED
        Phase.DEGRADED -> SurfaceState.DEGRADED
        Phase.FAILED -> SurfaceState.FAILED
    }
}

/**
 * Which VPN Android lists. Only one VPN app runs per user, but a VPN network can belong to another
 * app (or another profile), so "a VPN exists" is not "Tono's tunnel exists". Android shows a VPN's
 * owner UID only to that owner (API 30+); every Tono process shares the app's UID.
 */
object VpnAttribution {
    /**
     * [owners]: one entry per VPN network Android lists, its owner UID, or null when this Android
     * version cannot say. True: one is Tono's. False: none listed, or every one is another app's.
     * Null: some VPN's owner is unknown.
     */
    fun tono(owners: List<Int?>, myUid: Int): Boolean? = when {
        owners.isEmpty() -> false
        owners.any { it == myUid } -> true
        owners.all { it != null } -> false
        else -> null
    }
}

/**
 * The status file, shared by the `:vpn`, `:watch` and UI processes: one writer at a time (a file
 * lock across processes, a monitor within one), a fresh temporary name per write, a checked rename,
 * and no write that would replace a newer record (a higher version from the same engine instance,
 * or a later monotonic time from another instance of this boot). Plain `java.io`, so the JVM tests it.
 */
class StatusFile(private val dir: File) {
    private val target = File(dir, "status.json")

    fun read(): PublicStatus? = runCatching { PublicStatus.fromJson(target.readText()) }.getOrNull()

    /** True when [next] is on disk; false when refused (a newer record is there) or when writing failed. */
    fun write(next: PublicStatus): Boolean = synchronized(MONITOR) {
        locked(dir, "status.lock") { supersedes(next, read()) && replaceAtomically(dir, target, "status", next.toJson()) }
    }

    companion object {
        private val MONITOR = Any()

        fun supersedes(next: PublicStatus, current: PublicStatus?): Boolean = when {
            current == null -> true
            current.session == next.session -> next.version > current.version
            // Another instance of the same (known) boot: not from an earlier moment than the record it replaces.
            current.boot >= 0 && current.boot == next.boot && current.elapsedMs >= 0 && next.elapsedMs >= 0 -> next.elapsedMs >= current.elapsedMs
            else -> true
        }
    }
}

/**
 * Engine instances known to have died this boot, written by whoever heard the death (the watch
 * process, the open app). A death names one instance, so it never touches a newer engine's record,
 * however late it arrives. Kept short; a new boot starts it afresh.
 */
class DeathLog(private val dir: File) {
    private val target = File(dir, "dead.json")

    fun read(boot: Int): Set<String> = runCatching {
        val m = Json.parse(target.readText()).asObject()
        if ((m["boot"] as Number).toInt() != boot) emptySet() else (m["sessions"] as List<*>).mapNotNull { it as? String }.toSet()
    }.getOrDefault(emptySet())

    /** Adds [session]; false if it could not be written. */
    fun record(session: String, boot: Int): Boolean {
        if (session.isEmpty()) return false
        return synchronized(MONITOR) {
            locked(dir, "dead.lock") {
                val sessions = (read(boot) - session).toList().takeLast(KEEP - 1) + session
                replaceAtomically(dir, target, "dead", Json.write(linkedMapOf("boot" to boot, "sessions" to sessions)))
            }
        }
    }

    companion object {
        const val KEEP = 8
        private val MONITOR = Any()
    }
}

/** Runs [block] holding an exclusive lock on [lockName] in [dir], across processes. False if the lock could not be taken. */
private fun locked(dir: File, lockName: String, block: () -> Boolean): Boolean {
    if (!dir.isDirectory && !dir.mkdirs()) return false
    return RandomAccessFile(File(dir, lockName), "rw").use { file ->
        val lock = file.channel.lock()
        try {
            block()
        } finally {
            lock.release()
        }
    }
}

/** Writes [text] to a temporary file of its own, synced, then renames it over [target]; false if any step failed. */
private fun replaceAtomically(dir: File, target: File, prefix: String, text: String): Boolean {
    val tmp = File.createTempFile(prefix, ".tmp", dir)
    return try {
        FileOutputStream(tmp).use { out ->
            out.write(text.toByteArray(Charsets.UTF_8))
            out.fd.sync()
        }
        tmp.renameTo(target)
    } finally {
        if (tmp.exists()) tmp.delete()
    }
}

/** The shared status for this app (no-backup storage). */
object PublicStatusStore {
    private fun dir(context: Context) = File(context.noBackupFilesDir, "tono")

    fun boot(context: Context): Int = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)

    fun read(context: Context): PublicStatus? = StatusFile(dir(context)).read()

    fun write(context: Context, status: PublicStatus): Boolean = StatusFile(dir(context)).write(status)

    fun dead(context: Context): Set<String> = DeathLog(dir(context)).read(boot(context))

    /** [session]'s engine died; a null or empty session (never heard from) records nothing. */
    fun markDead(context: Context, session: String?): Boolean =
        session != null && runCatching { DeathLog(dir(context)).record(session, boot(context)) }.getOrDefault(false)

    /** Whether Android lists Tono's own VPN network ([VpnAttribution]); null if it cannot tell. */
    fun tonoVpn(context: Context): Boolean? = runCatching {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        @Suppress("DEPRECATION") // allNetworks: the only call that also lists a VPN this process is not routed through
        val owners = cm.allNetworks.mapNotNull { cm.getNetworkCapabilities(it) }
            .filter { it.hasTransport(NetworkCapabilities.TRANSPORT_VPN) }
            .map { if (Build.VERSION.SDK_INT >= 30) it.ownerUid else null }
        VpnAttribution.tono(owners, Process.myUid())
    }.getOrNull()

    fun current(context: Context, nowMs: Long = SystemClock.elapsedRealtime()): SurfaceView =
        SurfaceRules.view(read(context), nowMs, boot(context), tonoVpn(context), dead(context))
}
