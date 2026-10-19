package com.raydocs.tono.mobile.engine

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Bundle
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.surface.Claim
import com.raydocs.tono.mobile.ui.Format
import com.raydocs.tono.mobile.ui.shortReasonRes
import com.raydocs.tono.routing.RoutingMode

/** The tunnel's notifications. Built from a snapshot only, so fixture renders use the same code. */
object TonoNotifications {
    const val CHANNEL = "tunnel"
    const val ONGOING_ID = 7
    const val NOTICE_ID = 8
    /** The engine's phase when it posted its ongoing notification; replacements carry none. */
    private const val EXTRA_PHASE = "com.raydocs.tono.mobile.PHASE"
    /** The engine instance that posted it ([EngineSnapshot.session]): invalidations name the instance they are about. */
    private const val EXTRA_SESSION = "com.raydocs.tono.mobile.SESSION"

    fun claimedPhase(n: Notification): Phase? =
        n.extras.getString(EXTRA_PHASE)?.let { name -> runCatching { Phase.valueOf(name) }.getOrNull() }

    /** What an engine's ongoing notification claims, or null for a replacement (which claims nothing). */
    fun claim(n: Notification): Claim? = claimedPhase(n)?.let { Claim(it, n.extras.getString(EXTRA_SESSION) ?: "") }

    /** Ongoing while the tunnel runs: state, verified exits (or the line), and Disconnect. */
    fun ongoing(c: Context, snapshot: EngineSnapshot, open: PendingIntent, disconnect: PendingIntent): Notification {
        // The same rule as the app and the shared status: no tunnel-up title without a confirmation.
        val s = TunnelAuthority.seal(snapshot)
        val title = c.getString(
            when (s.phase) {
                Phase.CONNECTED -> R.string.state_connected
                Phase.DEGRADED -> R.string.state_degraded
                Phase.DISCONNECTING -> R.string.state_disconnecting
                else -> R.string.state_connecting
            },
        )
        // Up: the line and mode the confirmed tunnel uses. Connecting: the ones it is being started with.
        val node = TunnelAuthority.appliedNode(s) ?: s.nodes.firstOrNull { it.name == s.selectedNode }?.name
        val mode = TunnelAuthority.appliedMode(s) ?: s.mode
        val cloud = s.cloudProbe.location?.takeIf { s.tunnelUp }
        val home = s.homeProbe.location?.takeIf { s.tunnelUp && s.homeKind != HomeKind.NONE }
        val text = when {
            s.phase == Phase.DEGRADED && s.reasonCode != null -> shortReasonRes(s.reasonCode)?.let(c::getString) ?: s.reasonCode
            cloud != null && home != null -> c.getString(R.string.status_exit_both, Format.country(cloud), Format.country(home))
            cloud != null -> c.getString(R.string.status_exit_cloud, Format.country(cloud))
            else -> listOfNotNull(node, c.getString(if (mode == RoutingMode.THREE_TIER) R.string.mode_three_tier_short else R.string.mode_stable_short)).joinToString(" · ")
        }
        // Same glyph family as the desktop menu bar/tray: only a verified connection gets the filled sun.
        val icon = when (s.phase) {
            Phase.CONNECTED -> R.drawable.ic_stat_connected
            Phase.DEGRADED -> R.drawable.ic_stat_degraded
            Phase.DISCONNECTING -> R.drawable.ic_stat_standby
            else -> R.drawable.ic_stat_connecting
        }
        return Notification.Builder(c, CHANNEL)
            .setSmallIcon(icon)
            .setColor(0xFFFFAD74.toInt())
            .addExtras(Bundle().apply { putString(EXTRA_PHASE, s.phase.name); putString(EXTRA_SESSION, s.session) })
            .setContentTitle(title)
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, c.getString(R.string.action_disconnect), disconnect).build())
            .setCategory(Notification.CATEGORY_SERVICE)
            .build()
    }

    /** The tunnel ended without the user asking (core stopped, automatic attempt failed). */
    fun stopped(c: Context, code: String, open: PendingIntent, retry: PendingIntent): Notification =
        Notification.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_standby)
            .setColor(0xFFFFAD74.toInt())
            .setContentTitle(c.getString(R.string.notif_stopped_title))
            .setContentText(shortReasonRes(code)?.let(c::getString) ?: c.getString(R.string.short_generic, code))
            .setAutoCancel(true)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, c.getString(R.string.action_retry), retry).build())
            .setCategory(Notification.CATEGORY_ERROR)
            .build()

    /**
     * Posted by [com.raydocs.tono.mobile.surface.NotificationWatchdog] (from the watch process or the
     * open app) when the engine's notification outlived the engine. [tunnelGone]: Android has no VPN network,
     * so Tono's tunnel is gone; otherwise the state cannot be vouched for either way.
     */
    fun engineGone(c: Context, tunnelGone: Boolean): Notification {
        val open = PendingIntent.getActivity(
            c, 0, c.packageManager.getLaunchIntentForPackage(c.packageName), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return Notification.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_standby)
            .setColor(0xFFFFAD74.toInt())
            .setContentTitle(c.getString(if (tunnelGone) R.string.notif_stopped_title else R.string.surface_unknown))
            .setContentText(c.getString(if (tunnelGone) R.string.notif_stopped_no_vpn else R.string.surface_open_to_check))
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .setCategory(Notification.CATEGORY_STATUS)
            .build()
    }
}
