package com.raydocs.tono.mobile.surface

import android.content.ComponentName
import android.content.Context
import android.service.quicksettings.TileService
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.Phase

/** Same glyph family as the status bar and desktop tray: only a verified tunnel gets the filled sun. */
object SurfaceGlyph {
    fun of(state: SurfaceState): Int = when (state) {
        SurfaceState.CONNECTED -> R.drawable.ic_stat_connected
        SurfaceState.DEGRADED -> R.drawable.ic_stat_degraded
        SurfaceState.BUSY -> R.drawable.ic_stat_connecting
        else -> R.drawable.ic_stat_standby
    }
}

/** Engine side (`:vpn`): publishes the shared status and asks the tile and widgets to redraw. */
object SystemSurfaces {
    @Volatile private var last: PublicStatus? = null
    private val TUNNEL_PHASES = setOf(Phase.PREPARING, Phase.CONNECTING, Phase.CONNECTED, Phase.DEGRADED, Phase.DISCONNECTING)

    fun publish(context: Context, s: EngineSnapshot, nowMs: Long = System.currentTimeMillis()) {
        val previous = last
        val next = PublicStatus.of(s, nowMs, PublicStatusStore.boot(context))
        val changed = !next.sameAs(previous)
        // Unchanged content is rewritten as a heartbeat, so readers can tell a live record from a stale one.
        if (!changed && previous != null && nowMs - previous.updatedAtMs < SurfaceRules.HEARTBEAT_MS) return
        runCatching { PublicStatusStore.write(context, next) }.onFailure { return }
        last = next
        // Pushed back on every write while a tunnel is up or starting; fires only if the engine stops writing.
        runCatching { NotificationWatchdog.arm(context, live = s.phase in TUNNEL_PHASES) }
        runCatching { EngineWatch.keep(context, live = s.phase in TUNNEL_PHASES) }
        val wasStale = previous != null && nowMs - previous.updatedAtMs > SurfaceRules.STALE_MS
        if (changed || wasStale) refresh(context)
    }

    fun refresh(context: Context) {
        runCatching { TileService.requestListeningState(context, ComponentName(context, TonoTileService::class.java)) }
        runCatching { TonoWidget.updateAll(context) }
    }
}
