package com.raydocs.tono.mobile.surface

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.VpnService
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.mobile.engine.TonoVpnService
import com.raydocs.tono.mobile.ui.MainActivity

/**
 * Quick Settings tile. Shows the engine's shared status (or "unknown" when it cannot vouch for it)
 * and toggles the tunnel. It never gets around sign-in, Android's VPN consent or the lock screen:
 * anything that needs them opens the app, and the engine re-checks both before connecting.
 */
class TonoTileService : TileService() {
    override fun onStartListening() = render()

    override fun onClick() {
        if (isLocked) unlockAndRun(::act) else act()
    }

    private fun act() {
        val v = PublicStatusStore.current(this)
        when (v.state) {
            SurfaceState.CONNECTED, SurfaceState.DEGRADED -> engine(TonoVpnService.ACTION_DISCONNECT)
            SurfaceState.BUSY -> if (v.status?.phase != Phase.DISCONNECTING) engine(TonoVpnService.ACTION_DISCONNECT)
            SurfaceState.OFF, SurfaceState.FAILED ->
                if (VpnService.prepare(this) == null && runCatching { startForegroundService(intent(TonoVpnService.ACTION_CONNECT)) }.isSuccess) Unit
                else openApp()
            SurfaceState.SIGNED_OUT, SurfaceState.NEEDS_PERMISSION, SurfaceState.UNKNOWN -> openApp()
        }
    }

    private fun intent(action: String) = Intent(this, TonoVpnService::class.java).setAction(action)

    private fun engine(action: String) { runCatching { startService(intent(action)) }.onFailure { openApp() } }

    @SuppressLint("StartActivityAndCollapseDeprecated") // the Intent form only runs below API 34, where it is the API
    private fun openApp() {
        val open = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE))
        } else {
            @Suppress("DEPRECATION") startActivityAndCollapse(open)
        }
    }

    private fun render() {
        val tile = qsTile ?: return
        val v = PublicStatusStore.current(this)
        tile.state = when (v.state) {
            SurfaceState.CONNECTED, SurfaceState.DEGRADED, SurfaceState.BUSY -> Tile.STATE_ACTIVE
            else -> Tile.STATE_INACTIVE
        }
        tile.icon = Icon.createWithResource(this, SurfaceGlyph.of(v.state))
        tile.label = "Tono"
        if (Build.VERSION.SDK_INT >= 29) tile.subtitle = SurfaceCopy.title(this, v)
        tile.contentDescription = "Tono, ${SurfaceCopy.title(this, v)}"
        tile.updateTile()
    }
}
