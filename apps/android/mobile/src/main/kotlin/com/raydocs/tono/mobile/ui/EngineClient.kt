package com.raydocs.tono.mobile.ui

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.TonoVpnService
import com.raydocs.tono.mobile.ipc.ITonoEngine
import com.raydocs.tono.mobile.ipc.ITonoEngineListener
import com.raydocs.tono.routing.Json
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Thin UI-side view of the engine, which lives in the `:vpn` process. The UI never holds tokens,
 * the catalog or the tunnel; it renders snapshots and sends commands.
 */
class EngineClient(private val context: Context) {
    private val _snapshot = MutableStateFlow<EngineSnapshot?>(null)
    val snapshot: StateFlow<EngineSnapshot?> = _snapshot.asStateFlow()

    @Volatile private var engine: ITonoEngine? = null
    private var bound = false

    private val listener = object : ITonoEngineListener.Stub() {
        override fun onSnapshot(json: String) {
            runCatching { EngineSnapshot.fromJson(json) }.onSuccess { _snapshot.value = it }
        }
    }

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder) {
            val e = ITonoEngine.Stub.asInterface(service)
            engine = e
            runCatching { e.register(listener) }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            // The :vpn process died; Android rebinds automatically while we stay bound.
            engine = null
        }
    }

    fun bind() {
        if (bound) return
        bound = context.bindService(
            Intent(context, TonoVpnService::class.java).setAction(TonoVpnService.ACTION_BIND_ENGINE),
            connection,
            Context.BIND_AUTO_CREATE,
        )
    }

    fun unbind() {
        if (!bound) return
        runCatching { engine?.unregister(listener) }
        context.unbindService(connection)
        bound = false
        engine = null
    }

    fun command(op: String, vararg args: Pair<String, Any?>) {
        val body = linkedMapOf<String, Any?>("op" to op).apply { putAll(args) }
        runCatching { engine?.command(Json.write(body)) }
    }

    /** Returns {host, tcp, udp} or {error}; null if the engine is not reachable. */
    fun explain(host: String): Map<String, Any?>? =
        runCatching { engine?.explain(host)?.let { @Suppress("UNCHECKED_CAST") (Json.parse(it) as Map<String, Any?>) } }.getOrNull()

    /** Connecting must start (not only bind) the service so it survives the UI going away. */
    fun startConnect() {
        context.startForegroundService(Intent(context, TonoVpnService::class.java).setAction(TonoVpnService.ACTION_CONNECT))
    }
}
