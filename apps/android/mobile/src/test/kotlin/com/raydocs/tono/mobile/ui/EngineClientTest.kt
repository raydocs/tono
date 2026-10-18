package com.raydocs.tono.mobile.ui

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ComponentName
import android.os.Looper
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.TonoNotifications
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.mobile.engine.TonoVpnService
import com.raydocs.tono.mobile.ipc.ITonoEngine
import com.raydocs.tono.mobile.ipc.ITonoEngineListener
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration

/**
 * The UI's link to the engine process, on the JVM (Robolectric) with an in-process stand-in engine:
 * the engine dying, coming back, the app leaving and returning, and binding failing. The device
 * check (LocalTunnelDeviceTest) kills the real `:vpn` process.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class EngineClientTest {
    private val app = RuntimeEnvironment.getApplication()
    private val name = ComponentName(app, TonoVpnService::class.java)

    private class StandInEngine(var current: EngineSnapshot?) : ITonoEngine.Stub() {
        var listener: ITonoEngineListener? = null
        val commands = mutableListOf<String>()
        override fun register(l: ITonoEngineListener) { listener = l }
        override fun unregister(l: ITonoEngineListener) { if (listener?.asBinder() == l.asBinder()) listener = null }
        override fun snapshot(): String? = current?.toJson()
        override fun command(json: String) { commands += json }
        override fun explain(host: String) = "{}"
        fun push(s: EngineSnapshot) { current = s; listener?.onSnapshot(s.toJson()) }
    }

    private fun idleLooper() = shadowOf(Looper.getMainLooper()).idle()

    private fun bound(engine: StandInEngine): EngineClient {
        shadowOf(app).setComponentNameAndServiceForBindService(name, engine)
        return EngineClient(app).also { it.bind(); idleLooper(); shadowOf(app).clearStartedServices() }
    }

    private fun connection() = shadowOf(app).boundServiceConnections.single()

    @Test fun engineDeathTurnsTheLastSnapshotUnconfirmedUntilTheRestartedEngineSpeaks() {
        val connected = UiFixtures.connected()
        val engine = StandInEngine(connected)
        val client = bound(engine)
        assertEquals(EngineLink.LIVE, client.link.value)
        assertEquals(Phase.CONNECTED, client.snapshot.value?.phase)
        // The engine's ongoing notification, as its process left it.
        val nm = app.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(TonoNotifications.CHANNEL, "t", NotificationManager.IMPORTANCE_LOW))
        nm.notify(TonoNotifications.ONGOING_ID, Notification.Builder(app, TonoNotifications.CHANNEL).setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentTitle(app.getString(R.string.state_connected)).setOngoing(true).build())

        connection().onServiceDisconnected(name)
        assertEquals(EngineLink.LOST, client.link.value)
        // The last word is kept for layout, but only alongside LOST.
        assertEquals(Phase.CONNECTED, client.snapshot.value?.phase)
        // Android may leave the dead engine's notification up; it must stop saying Connected.
        val title = nm.activeNotifications.single { it.id == TonoNotifications.ONGOING_ID }.notification.extras.getCharSequence(Notification.EXTRA_TITLE)
        assertEquals(app.getString(R.string.surface_unknown), title.toString())

        // Commands have no binder to go to; a stop request still reaches the engine's service.
        client.command("recheck")
        assertNull(shadowOf(app).nextStartedService)
        client.command("disconnect")
        assertEquals(TonoVpnService.ACTION_DISCONNECT, shadowOf(app).nextStartedService?.action)
        assertEquals(emptyList<String>(), engine.commands)

        // Android does not restart it within 3 s: the app in front starts the engine itself.
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(3))
        val revived = shadowOf(app).nextStartedService
        assertEquals(TonoVpnService::class.java.name, revived?.component?.className)
        assertNull("started as Android's own restart, with no action", revived?.action)

        // Android restarts the engine; it has not restored its state yet, so it has nothing to say.
        val restarted = StandInEngine(null)
        connection().onServiceConnected(name, restarted)
        assertEquals(EngineLink.WAITING, client.link.value)
        assertEquals(Phase.CONNECTED, client.snapshot.value?.phase)

        restarted.push(UiFixtures.idle)
        idleLooper()
        assertEquals(EngineLink.LIVE, client.link.value)
        assertEquals(Phase.IDLE, client.snapshot.value?.phase)
    }

    @Test fun returningToTheForegroundReadsTheCurrentSnapshotAtOnce() {
        val engine = StandInEngine(UiFixtures.connected())
        val client = bound(engine)

        client.pause()
        assertEquals(EngineLink.WAITING, client.link.value)
        assertNull("off screen, the client stops listening", engine.listener)
        // The tunnel went down while the app was away.
        engine.current = UiFixtures.idle

        client.resume()
        assertEquals(EngineLink.LIVE, client.link.value)
        assertEquals(Phase.IDLE, client.snapshot.value?.phase)
    }

    @Test fun anEngineThatCannotBeBoundIsLostNotWaiting() {
        shadowOf(app).declareActionUnbindable(TonoVpnService.ACTION_BIND_ENGINE)
        val client = EngineClient(app)
        client.bind()
        idleLooper()
        assertEquals(EngineLink.LOST, client.link.value)
        assertNull(client.snapshot.value)
    }
}
