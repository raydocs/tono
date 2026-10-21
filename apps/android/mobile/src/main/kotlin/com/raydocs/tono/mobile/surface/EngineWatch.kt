package com.raydocs.tono.mobile.surface

import android.app.Service
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Message
import android.os.Messenger
import android.os.RemoteException
import android.os.SystemClock
import android.util.Log

/**
 * Engine side (`:vpn`): while a tunnel is up or starting, the engine stays bound to [EngineWatchService]
 * in its own small process and hands it a binder that lives in the engine's process. When the
 * engine's process dies, that binder dies with it and the watch hears it at once, with no app screen
 * open and whether or not Android restarts the engine. The binding also keeps the watch's process
 * at the engine's priority, so it is there to hear it.
 */
object EngineWatch {
    const val WATCH = 1
    const val RELEASE = 2
    /** The engine instance a [WATCH] registers ([com.raydocs.tono.mobile.engine.EngineSnapshot.session]). */
    const val KEY_SESSION = "session"

    private var bound = false
    /** The instance last registered with the watch; a new instance in the same process registers again. */
    private var registered: String? = null
    private var session: String? = null
    @Volatile private var remote: Messenger? = null
    /** Lives in the engine's process: its death is the signal. */
    private val token by lazy { Messenger(Handler(Looper.getMainLooper())) }

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder) {
            remote = Messenger(service)
            register()
        }

        // The watch's process died; Android re-creates it (auto-create binding) and connects again.
        override fun onServiceDisconnected(name: ComponentName?) { remote = null; registered = null }
    }

    /** On every status write: [live] while a tunnel is up or starting; [session] is the writing engine instance. */
    @Synchronized fun keep(context: Context, live: Boolean, session: String) {
        this.session = session
        if (live && bound) {
            if (registered != session) register()
            return
        }
        if (live == bound) return
        val app = context.applicationContext
        if (live) {
            bound = runCatching { app.bindService(Intent(app, EngineWatchService::class.java), connection, Context.BIND_AUTO_CREATE) }.getOrDefault(false)
        } else {
            send(RELEASE)
            runCatching { app.unbindService(connection) }
            remote = null
            registered = null
            bound = false
        }
    }

    @Synchronized private fun register() {
        val s = session ?: return
        if (send(WATCH, s)) registered = s
    }

    private fun send(what: Int, session: String? = null): Boolean {
        val r = remote ?: return false
        val msg = Message.obtain(null, what).apply {
            replyTo = token
            if (session != null) data = Bundle().apply { putString(KEY_SESSION, session) }
        }
        return runCatching { r.send(msg) }.isSuccess
    }
}

/**
 * Runs in `:watch`. Links to the engine's binder; when it dies, that engine instance is recorded as
 * dead ([PublicStatusStore.markDead], so the tile and widget stop vouching for its record even while
 * Android still lists the dead tunnel's VPN network), its notification is replaced at once
 * ([NotificationWatchdog.engineDied]), and the tile and widget are asked to look again. If Android
 * may still list Tono's VPN network at that moment (it takes a moment to drop the dead tunnel's),
 * the replacement says "Status unknown" and turns into "Tono stopped" once it is gone. For 10 s
 * after, or until a new engine registers, a tunnel claim Android re-posts for the dead instance is
 * replaced too ([RepostGuard]). Every one of these names the dead instance, so a death heard late
 * never touches a restarted engine's state or notification.
 */
class EngineWatchService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private var watched: IBinder? = null
    private var watchedSession: String? = null
    private var recipient: IBinder.DeathRecipient? = null
    private val messenger = Messenger(Handler(Looper.getMainLooper()) { msg ->
        when (msg.what) {
            EngineWatch.WATCH -> watch(msg.replyTo?.binder, msg.peekData()?.getString(EngineWatch.KEY_SESSION))
            EngineWatch.RELEASE -> release()
        }
        true
    })

    override fun onBind(intent: Intent): IBinder = messenger.binder

    private fun watch(engine: IBinder?, session: String?) {
        release()
        // An engine registered: from here its notification is its own.
        RepostGuard.stop()
        engine ?: return
        // One recipient per registration: a death names the instance it is about, however late it runs.
        val r = IBinder.DeathRecipient { main.post { engineDied(session) } }
        try {
            engine.linkToDeath(r, 0)
            watched = engine
            watchedSession = session
            recipient = r
        } catch (e: RemoteException) {
            engineDied(session) // already gone
        }
    }

    private fun release() {
        val w = watched
        val r = recipient
        if (w != null && r != null) runCatching { w.unlinkToDeath(r, 0) }
        watched = null
        watchedSession = null
        recipient = null
    }

    private fun engineDied(session: String?) {
        // Only the registration still current is cleared: a late death of an earlier one leaves a newer link alone.
        if (session == watchedSession) { watched = null; watchedSession = null; recipient = null }
        PublicStatusStore.markDead(this, session)
        val vpn = PublicStatusStore.tonoVpn(this)
        // Logged whether or not a notification is left to replace (Android sometimes removes it itself).
        Log.i(NotificationWatchdog.TAG, "engine died: the watch heard its binder die (Tono VPN $vpn)")
        NotificationWatchdog.engineDied(this, session, vpn)
        SystemSurfaces.refresh(this)
        // If Android restarts the engine, it first re-posts the dead engine's notification.
        RepostGuard.start(this, session)
        if (vpn != false) for (delay in longArrayOf(1_000, 2_000, 4_000, 8_000)) {
            main.postDelayed({ NotificationWatchdog.confirmStopped(this, PublicStatusStore.tonoVpn(this)) }, delay)
        }
    }
}

/**
 * After an engine instance's death: replaces a tunnel claim Android re-posts for it when it restarts
 * the engine ([NotificationWatchdog.restartRepost]) every 100 ms, for 10 s (on the uptime clock) or
 * until a new engine registers with the watch. Only the dead instance's claim is touched, so a
 * restarted engine's own Connected stays whenever this runs (run 39202302351: an unfenced check
 * replaced it 6 s later). Process-wide, not per service instance: the engine was the watch service's
 * only client, so Android destroys that instance when the engine dies and makes a new one for the
 * restarted engine.
 */
private object RepostGuard {
    private val main = Handler(Looper.getMainLooper())
    private var app: Context? = null
    private var until = 0L
    private var dead: String? = null
    private val check = object : Runnable {
        override fun run() {
            val context = app ?: return
            if (SystemClock.uptimeMillis() > until) return
            NotificationWatchdog.restartRepost(context, dead)
            main.postDelayed(this, 100)
        }
    }

    fun start(context: Context, deadSession: String?) {
        app = context.applicationContext
        dead = deadSession
        until = SystemClock.uptimeMillis() + 10_000
        main.removeCallbacks(check)
        main.post(check)
    }

    fun stop() {
        until = 0L
        main.removeCallbacks(check)
    }
}
