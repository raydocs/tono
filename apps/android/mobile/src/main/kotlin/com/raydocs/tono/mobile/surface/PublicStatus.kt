package com.raydocs.tono.mobile.surface

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.provider.Settings
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.routing.Json
import com.raydocs.tono.routing.asObject
import java.io.File

/**
 * The part of the engine's state that system surfaces (Quick Settings tile, home-screen widget)
 * may show. Written by the engine in `:vpn`, read by any process. No tokens, e-mail or catalog.
 */
data class PublicStatus(
    val phase: Phase,
    val reasonCode: String? = null,
    val line: String? = null,
    val cloud: String? = null,
    val home: String? = null,
    val updatedAtMs: Long,
    /** [Settings.Global.BOOT_COUNT] when written: a tunnel never survives a reboot. */
    val boot: Int,
) {
    fun toJson(): String = Json.write(
        linkedMapOf(
            "phase" to phase.name, "reasonCode" to reasonCode, "line" to line, "cloud" to cloud, "home" to home,
            "updatedAtMs" to updatedAtMs, "boot" to boot,
        ),
    )

    /** Same content, ignoring the timestamp: decides whether a write is a change or a heartbeat. */
    fun sameAs(o: PublicStatus?) = o != null && copy(updatedAtMs = 0) == o.copy(updatedAtMs = 0)

    companion object {
        fun of(s: EngineSnapshot, nowMs: Long, boot: Int) = PublicStatus(
            phase = s.phase,
            reasonCode = s.reasonCode,
            line = (s.nodes.firstOrNull { it.name == s.selectedNode } ?: s.nodes.firstOrNull())?.name,
            cloud = s.cloudProbe.location.takeIf { s.tunnelUp },
            home = s.homeProbe.location.takeIf { s.tunnelUp },
            updatedAtMs = nowMs,
            boot = boot,
        )

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
            )
        }.getOrNull()
    }
}

/** What a system surface shows. Never claims a tunnel it cannot vouch for. */
enum class SurfaceState { SIGNED_OUT, OFF, NEEDS_PERMISSION, BUSY, CONNECTED, DEGRADED, FAILED, UNKNOWN }

data class SurfaceView(val state: SurfaceState, val status: PublicStatus?)

object SurfaceRules {
    /** The engine rewrites the status at least this often while a tunnel is up or starting. */
    const val HEARTBEAT_MS = 30_000L
    const val STALE_MS = 3 * HEARTBEAT_MS

    /**
     * [vpnPresent]: whether Android currently has a VPN network (null if unknown). A recorded tunnel
     * is only shown when the record is fresh, from this boot, and Android agrees a VPN exists;
     * otherwise the surface says "unknown" rather than guessing either way.
     */
    fun view(s: PublicStatus?, nowMs: Long, boot: Int, vpnPresent: Boolean?): SurfaceView {
        if (s == null) return SurfaceView(SurfaceState.UNKNOWN, null)
        val live = s.phase in setOf(Phase.PREPARING, Phase.CONNECTING, Phase.CONNECTED, Phase.DEGRADED, Phase.DISCONNECTING)
        if (live && s.boot != boot) return SurfaceView(SurfaceState.OFF, s) // rebooted since: that tunnel is gone
        if (live && nowMs - s.updatedAtMs > STALE_MS) return SurfaceView(SurfaceState.UNKNOWN, s)
        if ((s.phase == Phase.CONNECTED || s.phase == Phase.DEGRADED) && vpnPresent == false) return SurfaceView(SurfaceState.UNKNOWN, s)
        return SurfaceView(stateFor(s.phase), s)
    }

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

/** File-backed store shared by the `:vpn` and UI processes (atomic rename, no-backup storage). */
object PublicStatusStore {
    private fun file(context: Context) = File(context.noBackupFilesDir, "tono/status.json")

    fun boot(context: Context): Int = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)

    fun read(context: Context): PublicStatus? = runCatching { PublicStatus.fromJson(file(context).readText()) }.getOrNull()

    fun write(context: Context, status: PublicStatus) {
        val f = file(context)
        f.parentFile?.mkdirs()
        val tmp = File(f.parentFile, "status.json.tmp")
        tmp.writeText(status.toJson())
        tmp.renameTo(f)
    }

    fun vpnPresent(context: Context): Boolean? = runCatching {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        @Suppress("DEPRECATION") // allNetworks: the only call that also lists a VPN this app is not routed through
        cm.allNetworks.any { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true }
    }.getOrNull()

    fun current(context: Context, nowMs: Long = System.currentTimeMillis()): SurfaceView =
        SurfaceRules.view(read(context), nowMs, boot(context), vpnPresent(context))
}
