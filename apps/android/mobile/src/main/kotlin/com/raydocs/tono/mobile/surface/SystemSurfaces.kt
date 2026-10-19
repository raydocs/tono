package com.raydocs.tono.mobile.surface

import android.content.ComponentName
import android.content.Context
import android.os.SystemClock
import android.service.quicksettings.TileService
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.engine.EngineSnapshot

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

    fun publish(context: Context, s: EngineSnapshot, nowMs: Long = System.currentTimeMillis(), elapsedMs: Long = SystemClock.elapsedRealtime()) {
        val previous = last
        val next = PublicStatus.of(s, nowMs, PublicStatusStore.boot(context), elapsedMs)
        // Unchanged content is rewritten as a heartbeat, so readers can tell a live record from a stale one.
        if (!SurfaceRules.needsWrite(previous, next)) return
        // A refused or failed write is not taken as published: the next update tries again.
        if (!runCatching { PublicStatusStore.write(context, next) }.getOrDefault(false)) return
        last = next
        val live = next.phase in SurfaceRules.LIVE
        // Pushed back on every write while a tunnel is up or starting; fires only if the engine stops writing.
        runCatching { NotificationWatchdog.arm(context, live) }
        runCatching { EngineWatch.keep(context, live, s.session) }
        val wasStale = previous != null && !SurfaceRules.fresh(previous, elapsedMs)
        if (!next.sameAs(previous) || wasStale) refresh(context)
    }

    fun refresh(context: Context) {
        runCatching { TileService.requestListeningState(context, ComponentName(context, TonoTileService::class.java)) }
        runCatching { TonoWidget.updateAll(context) }
    }
}
