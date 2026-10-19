package com.raydocs.tono.mobile.ui

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.TonoVpnService
import com.raydocs.tono.mobile.ipc.ITonoEngine
import com.raydocs.tono.mobile.ipc.ITonoEngineListener
import com.raydocs.tono.mobile.surface.NotificationWatchdog
import com.raydocs.tono.mobile.surface.PublicStatusStore
import com.raydocs.tono.mobile.surface.SystemSurfaces
import com.raydocs.tono.routing.Json
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Whether the snapshot on screen is the engine's current word. */
enum class EngineLink {
    /** Bound, or coming back to the foreground, and no fresh snapshot yet. */
    WAITING,
    /** The snapshot came from the running engine since it was last (re)connected. */
    LIVE,
    /** The engine's process died or could not be bound; the snapshot is from before. */
    LOST,
}

/**
 * Thin UI-side view of the engine, which lives in the `:vpn` process. The UI never holds tokens,
 * the catalog or the tunnel; it renders snapshots and sends commands.
 *
 * The last snapshot is kept when the engine goes away, but [link] says it is no longer current,
 * so the UI never keeps claiming a tunnel that died with the engine's process.
 */
class EngineClient(private val context: Context) {
    private val _snapshot = MutableStateFlow<EngineSnapshot?>(null)
    val snapshot: StateFlow<EngineSnapshot?> = _snapshot.asStateFlow()
    private val _link = MutableStateFlow(EngineLink.WAITING)
    val link: StateFlow<EngineLink> = _link.asStateFlow()

    @Volatile private var engine: ITonoEngine? = null
    @Volatile private var paused = false
    private var bound = false
    private val main = Handler(Looper.getMainLooper())

    private val listener = object : ITonoEngineListener.Stub() {
        override fun onSnapshot(json: String) {
            val fresh = runCatching { EngineSnapshot.fromJson(json) }.getOrNull() ?: return
            // On the main thread, in order with the connection callbacks that set [engine].
            main.post {
                if (paused) return@post
                _snapshot.value = fresh
                if (engine != null) _link.value = EngineLink.LIVE
            }
        }
    }

    /**
     * Android restarts a dead engine on its own, but not always (run 39170392763: not within 90 s).
     * With the app in front, start it again as Android's restart would, so a tunnel the user wanted
     * comes back and the screen stops saying "Status unknown". The old binding is replaced too: when
     * Android drops the dead service instead of restarting it, that binding never connects again
     * (run 39173982324: the revived engine was up, the screen still waiting).
     */
    private val revive: Runnable = Runnable {
        if (engine != null || !bound || paused) return@Runnable
        runCatching { context.startService(Intent(context, TonoVpnService::class.java)) }
        runCatching { context.unbindService(connection) }
        bound = false
        bind()
    }

    private val connection: ServiceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder) {
            val e = ITonoEngine.Stub.asInterface(service)
            engine = e
            main.removeCallbacks(revive)
            _link.value = EngineLink.WAITING
            if (!paused) refresh(e)
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            // The :vpn process died, and the tunnel with it. Android restarts the engine and calls
            // onServiceConnected again while we stay bound; until then nothing on screen is current.
            engine = null
            _link.value = EngineLink.LOST
            // The widget redraws only when the engine publishes; have it look again now, and once more
            // after Android has had time to drop the dead tunnel's VPN network.
            SystemSurfaces.refresh(context)
            main.postDelayed({ SystemSurfaces.refresh(context) }, 2_000)
            // Android can leave the dead engine's notification up, still saying Connected (the watch
            // process does the same; whichever runs first, both say the same).
            runCatching { NotificationWatchdog.engineDied(context, PublicStatusStore.vpnPresent(context)) }
            main.postDelayed({ runCatching { NotificationWatchdog.confirmStopped(context, PublicStatusStore.vpnPresent(context)) } }, 2_000)
            main.removeCallbacks(revive)
            main.postDelayed(revive, 3_000)
        }

        override fun onBindingDied(name: ComponentName?) {
            // Android will not reconnect this binding: make a new one.
            engine = null
            _link.value = EngineLink.LOST
            runCatching { context.unbindService(this) }
            bound = false
            bind()
        }

        override fun onNullBinding(name: ComponentName?) {
            engine = null
            _link.value = EngineLink.LOST
        }
    }

    /** Registers for snapshots and reads the current one in the same breath, so the next frame is current. */
    private fun refresh(e: ITonoEngine) {
        runCatching {
            e.register(listener)
            e.snapshot()?.let { EngineSnapshot.fromJson(it) }
        }.onSuccess { fresh ->
            // Null while the engine is still starting: its first snapshot follows through the listener.
            if (fresh != null) { _snapshot.value = fresh; _link.value = EngineLink.LIVE }
        }.onFailure {
            // Dead already; onServiceDisconnected follows.
            _link.value = EngineLink.LOST
        }
    }

    fun bind() {
        if (bound) return
        bound = context.bindService(
            Intent(context, TonoVpnService::class.java).setAction(TonoVpnService.ACTION_BIND_ENGINE),
            connection,
            Context.BIND_AUTO_CREATE,
        )
        if (!bound) _link.value = EngineLink.LOST
    }

    fun unbind() {
        main.removeCallbacks(revive)
        if (!bound) return
        runCatching { engine?.unregister(listener) }
        context.unbindService(connection)
        bound = false
        engine = null
        _link.value = EngineLink.WAITING
    }

    /**
     * Off screen: stop receiving snapshots but stay bound. A process in the background may be
     * frozen and miss snapshots, so what it holds is no longer current.
     */
    fun pause() {
        paused = true
        runCatching { engine?.unregister(listener) }
        if (_link.value == EngineLink.LIVE) _link.value = EngineLink.WAITING
    }

    /** Back on screen: read the current snapshot before the first frame is drawn. */
    fun resume() {
        paused = false
        engine?.let { refresh(it) }
        // The engine died while the app was away and has not come back: try now.
        if (engine == null && _link.value == EngineLink.LOST) main.post(revive)
    }

    fun command(op: String, vararg args: Pair<String, Any?>) {
        val e = engine
        if (e == null) {
            // Without the engine's binder, a stop request still has to reach it: through the service.
            if (op == "disconnect") runCatching { context.startService(Intent(context, TonoVpnService::class.java).setAction(TonoVpnService.ACTION_DISCONNECT)) }
            return
        }
        val body = linkedMapOf<String, Any?>("op" to op).apply { putAll(args) }
        runCatching { e.command(Json.write(body)) }
    }

    /** Returns {host, tcp, udp} or {error}; null if the engine is not reachable. */
    fun explain(host: String): Map<String, Any?>? =
        runCatching { engine?.explain(host)?.let { @Suppress("UNCHECKED_CAST") (Json.parse(it) as Map<String, Any?>) } }.getOrNull()

    /** Connecting must start (not only bind) the service so it survives the UI going away. */
    fun startConnect() {
        context.startForegroundService(Intent(context, TonoVpnService::class.java).setAction(TonoVpnService.ACTION_CONNECT))
    }
}
