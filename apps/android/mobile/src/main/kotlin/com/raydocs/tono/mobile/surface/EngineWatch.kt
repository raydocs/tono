package com.raydocs.tono.mobile.surface

import android.app.Service
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
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

    private var bound = false
    @Volatile private var remote: Messenger? = null
    /** Lives in the engine's process: its death is the signal. */
    private val token by lazy { Messenger(Handler(Looper.getMainLooper())) }

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder) {
            remote = Messenger(service)
            send(WATCH)
        }

        // The watch's process died; Android re-creates it (auto-create binding) and connects again.
        override fun onServiceDisconnected(name: ComponentName?) { remote = null }
    }

    /** On every status write: [live] while a tunnel is up or starting. */
    @Synchronized fun keep(context: Context, live: Boolean) {
        if (live == bound) return
        val app = context.applicationContext
        if (live) {
            bound = runCatching { app.bindService(Intent(app, EngineWatchService::class.java), connection, Context.BIND_AUTO_CREATE) }.getOrDefault(false)
        } else {
            send(RELEASE)
            runCatching { app.unbindService(connection) }
            remote = null
            bound = false
        }
    }

    private fun send(what: Int) {
        runCatching { remote?.send(Message.obtain(null, what).apply { replyTo = token }) }
    }
}

/**
 * Runs in `:watch`. Links to the engine's binder; when it dies, the engine's notification is
 * replaced at once ([NotificationWatchdog.engineDied]), and the tile and widget are asked to look
 * again. If Android still lists a VPN network at that moment (it takes a moment to drop the dead
 * tunnel's), the replacement says "Status unknown" and turns into "Tono stopped" once it is gone.
 * For 10 s after, or until a new engine registers, a tunnel claim Android re-posts for a restarted
 * engine is replaced too.
 */
class EngineWatchService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private var watched: IBinder? = null
    /** Uptime until which a re-posted tunnel claim is replaced (see [NotificationWatchdog.restartRepost]). */
    private var repostUntil = 0L
    private val repostCheck = object : Runnable {
        override fun run() {
            if (SystemClock.uptimeMillis() > repostUntil) return
            NotificationWatchdog.restartRepost(this@EngineWatchService)
            main.postDelayed(this, 100)
        }
    }
    private val recipient = IBinder.DeathRecipient { main.post { engineDied() } }
    private val messenger = Messenger(Handler(Looper.getMainLooper()) { msg ->
        when (msg.what) {
            EngineWatch.WATCH -> watch(msg.replyTo?.binder)
            EngineWatch.RELEASE -> release()
        }
        true
    })

    override fun onBind(intent: Intent): IBinder = messenger.binder

    private fun watch(engine: IBinder?) {
        release()
        // An engine registered: from here its notification is its own.
        repostUntil = 0L
        engine ?: return
        try {
            engine.linkToDeath(recipient, 0)
            watched = engine
        } catch (e: RemoteException) {
            engineDied() // already gone
        }
    }

    private fun release() {
        watched?.let { runCatching { it.unlinkToDeath(recipient, 0) } }
        watched = null
    }

    private fun engineDied() {
        watched = null
        val vpn = PublicStatusStore.vpnPresent(this)
        // Logged whether or not a notification is left to replace (Android sometimes removes it itself).
        Log.i(NotificationWatchdog.TAG, "engine died: the watch heard its binder die (VPN network $vpn)")
        NotificationWatchdog.engineDied(this, vpn)
        // If Android restarts the engine, it first re-posts the dead engine's notification.
        repostUntil = SystemClock.uptimeMillis() + 10_000
        main.removeCallbacks(repostCheck)
        main.post(repostCheck)
        if (vpn != false) for (delay in longArrayOf(1_000, 2_000, 4_000, 8_000)) {
            main.postDelayed({ NotificationWatchdog.confirmStopped(this, PublicStatusStore.vpnPresent(this)) }, delay)
        }
    }
}
