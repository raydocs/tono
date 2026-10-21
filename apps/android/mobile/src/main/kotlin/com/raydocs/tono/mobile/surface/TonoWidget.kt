package com.raydocs.tono.mobile.surface

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.SystemClock
import android.widget.RemoteViews
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.mobile.engine.TonoVpnService
import com.raydocs.tono.mobile.ui.MainActivity

/**
 * Home-screen widget: state word, one detail line and one action, from the engine's shared status.
 * Its action follows the same rules as the Quick Settings tile (never around sign-in or consent).
 */
class TonoWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = updateAll(context)

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_RECHECK) updateAll(context) else super.onReceive(context, intent)
    }

    override fun onDisabled(context: Context) = recheck(context, live = false)

    companion object {
        private const val ACTION_RECHECK = "com.raydocs.tono.mobile.WIDGET_RECHECK"

        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, TonoWidget::class.java))
            if (ids.isEmpty()) return
            val v = PublicStatusStore.current(context)
            manager.updateAppWidget(ids, views(context, v, consentGranted = VpnService.prepare(context) == null))
            recheck(context, live = v.state in setOf(SurfaceState.CONNECTED, SurfaceState.DEGRADED, SurfaceState.BUSY))
        }

        /** The widget for [v]. Pure apart from resources, so fixture renders use the same code. */
        fun views(context: Context, v: SurfaceView, consentGranted: Boolean): RemoteViews {
            val rv = RemoteViews(context.packageName, R.layout.widget_tono)
            rv.setTextViewText(R.id.widget_state, SurfaceCopy.title(context, v))
            rv.setTextViewText(R.id.widget_detail, SurfaceCopy.detail(context, v))
            rv.setImageViewResource(R.id.widget_glyph, SurfaceGlyph.of(v.state))
            rv.setInt(R.id.widget_glyph, "setColorFilter", if (v.state == SurfaceState.UNKNOWN) 0xFF8F8A94.toInt() else 0xFFFFC38A.toInt())
            val open = PendingIntent.getActivity(
                context, 10, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE,
            )
            rv.setOnClickPendingIntent(R.id.widget_root, open)
            fun service(code: Int, action: String) = Intent(context, TonoVpnService::class.java).setAction(action).let {
                if (action == TonoVpnService.ACTION_CONNECT) PendingIntent.getForegroundService(context, code, it, PendingIntent.FLAG_IMMUTABLE)
                else PendingIntent.getService(context, code, it, PendingIntent.FLAG_IMMUTABLE)
            }
            val (label, warm, intent) = when (v.state) {
                SurfaceState.CONNECTED, SurfaceState.DEGRADED -> Triple(R.string.action_disconnect, false, service(11, TonoVpnService.ACTION_DISCONNECT))
                SurfaceState.BUSY -> if (v.status?.phase == Phase.DISCONNECTING) Triple(R.string.action_disconnecting, false, open)
                    else Triple(R.string.action_cancel, false, service(11, TonoVpnService.ACTION_DISCONNECT))
                SurfaceState.OFF -> if (consentGranted) Triple(R.string.action_connect, true, service(12, TonoVpnService.ACTION_CONNECT)) else Triple(R.string.action_allow_vpn, true, open)
                SurfaceState.FAILED -> if (consentGranted) Triple(R.string.action_retry, true, service(12, TonoVpnService.ACTION_CONNECT)) else Triple(R.string.action_allow_vpn, true, open)
                SurfaceState.NEEDS_PERMISSION -> Triple(R.string.action_allow_vpn, true, open)
                SurfaceState.SIGNED_OUT -> Triple(R.string.surface_sign_in, true, open)
                SurfaceState.UNKNOWN -> Triple(R.string.surface_open, false, open)
            }
            rv.setTextViewText(R.id.widget_action, context.getString(label))
            rv.setInt(R.id.widget_action, "setBackgroundResource", if (warm) R.drawable.widget_action_warm else R.drawable.widget_action_glass)
            rv.setTextColor(R.id.widget_action, if (warm) 0xFF2A1406.toInt() else 0xFFF7F3EE.toInt())
            rv.setOnClickPendingIntent(R.id.widget_action, intent)
            return rv
        }

        /**
         * While a live state is shown, look again once a fresh heartbeat would be overdue, so a
         * widget left showing "Connected" after the engine died turns into "unknown". Inexact and
         * non-waking: it runs when the phone is next awake, which is when anyone can see it.
         */
        private fun recheck(context: Context, live: Boolean) {
            val alarms = context.getSystemService(AlarmManager::class.java)
            val pi = PendingIntent.getBroadcast(
                context, 13, Intent(context, TonoWidget::class.java).setAction(ACTION_RECHECK), PendingIntent.FLAG_IMMUTABLE,
            )
            if (live) alarms.set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + SurfaceRules.STALE_MS + 10_000, pi)
            else alarms.cancel(pi)
        }
    }
}
