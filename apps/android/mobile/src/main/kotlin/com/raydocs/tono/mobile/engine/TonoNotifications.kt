package com.raydocs.tono.mobile.engine

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.ui.Format
import com.raydocs.tono.mobile.ui.shortReasonRes
import com.raydocs.tono.routing.RoutingMode

/** The tunnel's notifications. Built from a snapshot only, so fixture renders use the same code. */
object TonoNotifications {
    const val CHANNEL = "tunnel"
    const val ONGOING_ID = 7
    const val NOTICE_ID = 8

    /** Ongoing while the tunnel runs: state, verified exits (or the line), and Disconnect. */
    fun ongoing(c: Context, s: EngineSnapshot, open: PendingIntent, disconnect: PendingIntent): Notification {
        val title = c.getString(
            when (s.phase) {
                Phase.CONNECTED -> R.string.state_connected
                Phase.DEGRADED -> R.string.state_degraded
                Phase.DISCONNECTING -> R.string.state_disconnecting
                else -> R.string.state_connecting
            },
        )
        val node = s.nodes.firstOrNull { it.name == s.selectedNode }
        val cloud = s.cloudProbe.location?.takeIf { s.tunnelUp }
        val home = s.homeProbe.location?.takeIf { s.tunnelUp && s.homeKind != HomeKind.NONE }
        val text = when {
            s.phase == Phase.DEGRADED && s.reasonCode != null -> shortReasonRes(s.reasonCode)?.let(c::getString) ?: s.reasonCode
            cloud != null && home != null -> c.getString(R.string.status_exit_both, Format.country(cloud), Format.country(home))
            cloud != null -> c.getString(R.string.status_exit_cloud, Format.country(cloud))
            else -> listOfNotNull(node?.name, c.getString(if (s.mode == RoutingMode.THREE_TIER) R.string.mode_three_tier_short else R.string.mode_stable_short)).joinToString(" · ")
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
     * Posted by the app's own process over the engine's ongoing notification when the engine's
     * process died: Android may leave that notification up, still saying Connected, after the tunnel
     * died with the process. Replaced by the engine's own as soon as it runs again.
     */
    fun engineLost(c: Context, open: PendingIntent): Notification =
        Notification.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_standby)
            .setColor(0xFFFFAD74.toInt())
            .setContentTitle(c.getString(R.string.surface_unknown))
            .setContentText(c.getString(R.string.surface_open_to_check))
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .setCategory(Notification.CATEGORY_STATUS)
            .build()

    /** Replaces the engine's ongoing notification, if one is up, with [engineLost]. */
    fun replaceAfterEngineLoss(c: Context) {
        val nm = c.getSystemService(NotificationManager::class.java) ?: return
        if (nm.activeNotifications.none { it.id == ONGOING_ID }) return
        val open = PendingIntent.getActivity(
            c, 0, c.packageManager.getLaunchIntentForPackage(c.packageName), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        nm.notify(ONGOING_ID, engineLost(c, open))
    }
}
