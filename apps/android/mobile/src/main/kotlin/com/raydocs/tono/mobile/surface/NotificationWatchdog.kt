package com.raydocs.tono.mobile.surface

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.util.Log
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.mobile.engine.TonoNotifications

/**
 * Keeps the engine's ongoing notification honest after the engine's `:vpn` process died: Android
 * leaves the notification up without restarting the service (runs 39170392763 and 39184008733: still
 * saying Connected with no VPN network until replaced).
 *
 * First line: [EngineWatchService] hears the engine's binder die and calls [engineDied] at once.
 *
 * Backstop, for when the watch's process died together with the engine: while a tunnel is up or
 * starting, the engine re-arms an alarm each time it rewrites its shared status (at least every
 * [SurfaceRules.HEARTBEAT_MS]); a living engine always pushes it back before it fires. If the engine
 * dies, the alarm fires in `:watch` (starting that process if needed), which compares what the
 * notification claims with what Android and the status record say, and replaces a claim nobody can
 * vouch for. The alarm is inexact and non-waking: with the phone awake it fires about 10–35 s after
 * the engine's death; asleep, once the phone wakes (Doze and standby buckets can defer it further).
 */
object NotificationWatchdog {
    const val ARM_MS = SurfaceRules.HEARTBEAT_MS + 10_000
    private const val ACTION_CHECK = "com.raydocs.tono.mobile.NOTIFICATION_CHECK"
    internal const val TAG = "TonoWatchdog"

    private fun intent(context: Context) = PendingIntent.getBroadcast(
        context, 14, Intent(context, Receiver::class.java).setAction(ACTION_CHECK), PendingIntent.FLAG_IMMUTABLE,
    )

    /** Engine side, on every status write: [live] while a tunnel is up or starting. */
    fun arm(context: Context, live: Boolean) {
        val alarms = context.getSystemService(AlarmManager::class.java) ?: return
        if (live) alarms.set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + ARM_MS, intent(context))
        else alarms.cancel(intent(context))
    }

    /**
     * Replaces the ongoing notification if it claims more than [view] supports. Returns what it
     * replaced, or null. Pure apart from the notification manager, so the JVM can drive it.
     */
    fun check(context: Context, view: SurfaceView, vpnPresent: Boolean?): Phase? {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return null
        val n = nm.activeNotifications.firstOrNull { it.id == TonoNotifications.ONGOING_ID } ?: return null
        // Only the engine's own notification carries its phase; a replacement is already honest.
        val claimed = TonoNotifications.claimedPhase(n.notification) ?: return null
        val supported = when (claimed) {
            Phase.CONNECTED, Phase.DEGRADED -> view.state == SurfaceState.CONNECTED || view.state == SurfaceState.DEGRADED
            else -> view.state == SurfaceState.BUSY || view.state == SurfaceState.CONNECTED || view.state == SurfaceState.DEGRADED
        }
        if (supported) {
            // The engine is alive and will keep pushing the alarm back; keep watching meanwhile.
            arm(context, live = true)
            return null
        }
        nm.notify(TonoNotifications.ONGOING_ID, TonoNotifications.engineGone(context, tunnelGone = vpnPresent == false))
        Log.i(TAG, "replaced a stale ${claimed.name} notification (surface ${view.state}, VPN network ${vpnPresent})")
        SystemSurfaces.refresh(context)
        return claimed
    }

    /**
     * The engine's process is known to have died ([EngineWatchService] heard its binder die, or the
     * open app lost its binding): whatever the engine's notification claims died with it. Returns
     * what it replaced, or null when no engine claim is up (a normal stop already removed it).
     */
    fun engineDied(context: Context, vpnPresent: Boolean?): Phase? {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return null
        val n = nm.activeNotifications.firstOrNull { it.id == TonoNotifications.ONGOING_ID } ?: return null
        val claimed = TonoNotifications.claimedPhase(n.notification) ?: return null
        nm.notify(TonoNotifications.ONGOING_ID, TonoNotifications.engineGone(context, tunnelGone = vpnPresent == false))
        Log.i(TAG, "engine died: replaced its ${claimed.name} notification (VPN network $vpnPresent)")
        SystemSurfaces.refresh(context)
        return claimed
    }

    /**
     * A new engine process starting: it cannot have a tunnel yet, but when Android restarts a crashed
     * engine it re-posts the dead one's last notification first (run 39193223160: "Connected" with no
     * VPN network until the new engine said Connecting). Replaced before anything else runs.
     */
    fun engineStarting(context: Context): Phase? {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return null
        val n = nm.activeNotifications.firstOrNull { it.id == TonoNotifications.ONGOING_ID } ?: return null
        val claimed = TonoNotifications.claimedPhase(n.notification) ?: return null
        val vpn = PublicStatusStore.vpnPresent(context)
        nm.notify(TonoNotifications.ONGOING_ID, TonoNotifications.engineGone(context, tunnelGone = vpn == false))
        Log.i(TAG, "engine starting: replaced a leftover ${claimed.name} notification (VPN network $vpn)")
        return claimed
    }

    /**
     * Between an engine's death and the next engine registering with the watch: Android re-posts a
     * crashed engine's last notification when it restarts the service, before the new process runs any
     * code (runs 39197246583: "Connected" for 0.4–0.7 s with no VPN network until [engineStarting]).
     * Only a tunnel-up claim is replaced, and only until a new engine shows it is alive (the caller
     * stops at its first shared-status write or registration, both long before it can be connected),
     * so a Connected or Partly working claim here is the dead engine's.
     */
    fun restartRepost(context: Context): Phase? {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return null
        val n = nm.activeNotifications.firstOrNull { it.id == TonoNotifications.ONGOING_ID } ?: return null
        val claimed = TonoNotifications.claimedPhase(n.notification) ?: return null
        if (claimed != Phase.CONNECTED && claimed != Phase.DEGRADED) return null
        val vpn = PublicStatusStore.vpnPresent(context)
        nm.notify(TonoNotifications.ONGOING_ID, TonoNotifications.engineGone(context, tunnelGone = vpn == false))
        Log.i(TAG, "engine restarting: replaced Android's re-posted ${claimed.name} notification (VPN network $vpn)")
        return claimed
    }

    /** After a replacement that said "Status unknown": once Android has no VPN network, say Tono stopped. */
    fun confirmStopped(context: Context, vpnPresent: Boolean?): Boolean {
        if (vpnPresent != false) return false
        val nm = context.getSystemService(NotificationManager::class.java) ?: return false
        val n = nm.activeNotifications.firstOrNull { it.id == TonoNotifications.ONGOING_ID } ?: return false
        // A restarted engine's own notification (it carries a phase) or one already saying stopped stays.
        if (TonoNotifications.claimedPhase(n.notification) != null) return false
        if (n.notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE)?.toString() != context.getString(com.raydocs.tono.mobile.R.string.surface_unknown)) return false
        nm.notify(TonoNotifications.ONGOING_ID, TonoNotifications.engineGone(context, tunnelGone = true))
        Log.i(TAG, "engine died: no VPN network now, notification says Tono stopped")
        SystemSurfaces.refresh(context)
        return true
    }

    class Receiver : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != ACTION_CHECK) return
            val vpn = PublicStatusStore.vpnPresent(context)
            check(context, SurfaceRules.view(PublicStatusStore.read(context), System.currentTimeMillis(), PublicStatusStore.boot(context), vpn), vpn)
        }
    }
}
