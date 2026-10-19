package com.raydocs.tono.mobile.surface

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.service.notification.StatusBarNotification
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
 *
 * Every replacement is fenced by the engine instance it is about ([ClaimRules]): a late or repeated
 * one leaves a newer engine's notification alone. Replacements only ever say less (Status unknown,
 * Tono stopped), never that a tunnel is up.
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

    private fun ongoing(nm: NotificationManager): StatusBarNotification? =
        nm.activeNotifications.firstOrNull { it.id == TonoNotifications.ONGOING_ID }

    private fun replace(context: Context, nm: NotificationManager, tonoVpn: Boolean?) =
        nm.notify(TonoNotifications.ONGOING_ID, TonoNotifications.engineGone(context, tunnelGone = tonoVpn == false))

    /**
     * Replaces the ongoing notification if it claims more than [view] supports for the engine
     * instance that posted it. Returns what it replaced, or null. Pure apart from the notification
     * manager, so the JVM can drive it.
     */
    fun check(context: Context, view: SurfaceView, tonoVpn: Boolean?): Phase? {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return null
        val n = ongoing(nm) ?: return null
        // Only the engine's own notification carries its phase; a replacement is already honest.
        val claim = TonoNotifications.claim(n.notification) ?: return null
        if (ClaimRules.supported(claim, view)) {
            // The engine is alive and will keep pushing the alarm back; keep watching meanwhile.
            arm(context, live = true)
            return null
        }
        replace(context, nm, tonoVpn)
        Log.i(TAG, "replaced a stale ${claim.phase.name} notification (surface ${view.state}, Tono VPN $tonoVpn)")
        SystemSurfaces.refresh(context)
        return claim.phase
    }

    /**
     * The engine instance [deadSession] is known to have died ([EngineWatchService] heard its binder
     * die, or the open app lost its binding): its claim died with it. Returns what it replaced, or
     * null when no claim of that instance is up (a normal stop removed it, or a newer engine's is).
     */
    fun engineDied(context: Context, deadSession: String?, tonoVpn: Boolean?): Phase? {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return null
        val n = ongoing(nm) ?: return null
        val claim = TonoNotifications.claim(n.notification) ?: return null
        if (!ClaimRules.diedWith(claim, deadSession)) return null
        replace(context, nm, tonoVpn)
        Log.i(TAG, "engine died: replaced its ${claim.phase.name} notification (Tono VPN $tonoVpn)")
        SystemSurfaces.refresh(context)
        return claim.phase
    }

    /**
     * A new engine instance [session] starting: it cannot have a tunnel yet, but when Android restarts
     * a crashed engine it re-posts the dead one's last notification first (run 39193223160: "Connected"
     * with no VPN network until the new engine said Connecting). Replaced before anything else runs.
     */
    fun engineStarting(context: Context, session: String): Phase? {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return null
        val n = ongoing(nm) ?: return null
        val claim = TonoNotifications.claim(n.notification) ?: return null
        if (!ClaimRules.leftOver(claim, session)) return null
        val vpn = PublicStatusStore.tonoVpn(context)
        replace(context, nm, vpn)
        Log.i(TAG, "engine starting: replaced a leftover ${claim.phase.name} notification (Tono VPN $vpn)")
        return claim.phase
    }

    /**
     * Between [deadSession]'s death and the next engine registering with the watch: Android re-posts
     * a crashed engine's last notification when it restarts the service, before the new process runs
     * any code (runs 39197246583: "Connected" for 0.4–0.7 s with no VPN network until
     * [engineStarting]). Only the dead instance's tunnel-up claim is replaced; a restarted engine's
     * own notification carries its own instance and stays, whenever this runs.
     */
    fun restartRepost(context: Context, deadSession: String?): Phase? {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return null
        val n = ongoing(nm) ?: return null
        val claim = TonoNotifications.claim(n.notification) ?: return null
        if (!ClaimRules.repost(claim, deadSession)) return null
        val vpn = PublicStatusStore.tonoVpn(context)
        replace(context, nm, vpn)
        Log.i(TAG, "engine restarting: replaced Android's re-posted ${claim.phase.name} notification (Tono VPN $vpn)")
        return claim.phase
    }

    /** After a replacement that said "Status unknown": once Android lists no Tono VPN network, say Tono stopped. */
    fun confirmStopped(context: Context, tonoVpn: Boolean?): Boolean {
        if (tonoVpn != false) return false
        val nm = context.getSystemService(NotificationManager::class.java) ?: return false
        val n = ongoing(nm) ?: return false
        // A restarted engine's own notification (it carries a phase) or one already saying stopped stays.
        if (TonoNotifications.claimedPhase(n.notification) != null) return false
        if (n.notification.extras.getCharSequence(android.app.Notification.EXTRA_TITLE)?.toString() != context.getString(com.raydocs.tono.mobile.R.string.surface_unknown)) return false
        nm.notify(TonoNotifications.ONGOING_ID, TonoNotifications.engineGone(context, tunnelGone = true))
        Log.i(TAG, "engine died: no Tono VPN network now, notification says Tono stopped")
        SystemSurfaces.refresh(context)
        return true
    }

    class Receiver : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action != ACTION_CHECK) return
            val vpn = PublicStatusStore.tonoVpn(context)
            val view = SurfaceRules.view(PublicStatusStore.read(context), SystemClock.elapsedRealtime(), PublicStatusStore.boot(context), vpn, PublicStatusStore.dead(context))
            check(context, view, vpn)
        }
    }
}
