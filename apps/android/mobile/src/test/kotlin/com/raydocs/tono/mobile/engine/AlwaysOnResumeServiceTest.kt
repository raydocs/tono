package com.raydocs.tono.mobile.engine

import android.content.Context
import android.content.Intent
import android.net.VpnService
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import java.util.concurrent.AbstractExecutorService
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Real service entry points and engine executor; only account presence/OS consent are fixtures. */
@RunWith(RobolectricTestRunner::class)
@Config(
    sdk = [35],
    shadows = [AlwaysOnResumeServiceTest.SignedInStore::class, AlwaysOnResumeServiceTest.GrantedVpn::class],
    instrumentedPackages = ["com.raydocs.tono.mobile.engine"],
)
class AlwaysOnResumeServiceTest {
    @Test fun systemAlwaysOnRequestAfterRevokeAndDisconnectEntersPreparingInTheSameInstance() {
        val controller = Robolectric.buildService(TonoVpnService::class.java)
        val service = controller.get()
        val io = HoldingIo()
        field("io").set(service, io)
        val engine = field("engine").get(service) as ScheduledExecutorService
        fun drain() { engine.submit {}.get(5, TimeUnit.SECONDS) }
        @Suppress("UNCHECKED_CAST")
        val state = field("snapshot").get(service) as AtomicReference<EngineSnapshot>
        try {
            controller.create()
            drain()
            service.onRevoke()
            drain()
            assertEquals(Phase.NEEDS_PERMISSION, state.get().phase)
            assertFalse(EngineStore(service).settings().wantConnected)

            // The UI still holds this instance; renewed system consent is a newer explicit intent.
            service.onStartCommand(Intent(VpnService.SERVICE_INTERFACE), 0, 1)
            drain()
            assertEquals("Always-on must not silently consume the start after revoke", Phase.PREPARING, state.get().phase)
            assertTrue(EngineStore(service).settings().wantConnected)

            service.onStartCommand(Intent(TonoVpnService.ACTION_DISCONNECT), 0, 2)
            drain()
            assertEquals(Phase.IDLE, state.get().phase)
            assertFalse(EngineStore(service).settings().wantConnected)
            service.onStartCommand(Intent(VpnService.SERVICE_INTERFACE), 0, 3)
            drain()
            assertEquals("a fresh system start also supersedes a previous disconnect", Phase.PREPARING, state.get().phase)
            assertTrue(EngineStore(service).settings().wantConnected)
        } finally {
            controller.destroy()
            io.shutdownNow()
        }
    }

    @Test fun disconnectClosesTheActualPlatformTunBeforeAFailedSettingsWriteAndWarns() {
        val controller = Robolectric.buildService(TonoVpnService::class.java)
        val service = controller.get()
        val io = HoldingIo()
        field("io").set(service, io)
        val engine = field("engine").get(service) as ScheduledExecutorService
        fun drain() { engine.submit {}.get(5, TimeUnit.SECONDS) }
        val pipe = android.os.ParcelFileDescriptor.createPipe()
        val blockedWrite = java.io.File(service.noBackupFilesDir, "tono/engine.json.tmp")
        try {
            controller.create()
            drain()
            val platform = field("platform").get(service) as BoxPlatform
            BoxPlatform::class.java.getDeclaredField("tun").apply { isAccessible = true }.set(platform, pipe[0])
            assertTrue(platform.tunOpen)
            assertTrue(blockedWrite.mkdir()) // Real filesystem write failure, not a mocked stop helper.
            val phases = mutableListOf<Pair<Phase, Boolean>>()
            val listener = object : com.raydocs.tono.mobile.ipc.ITonoEngineListener.Stub() {
                override fun onSnapshot(json: String) { phases += EngineSnapshot.fromJson(json).phase to platform.tunOpen }
            }
            val binder = com.raydocs.tono.mobile.ipc.ITonoEngine.Stub.asInterface(service.onBind(Intent("test-ui")))
            binder.register(listener)
            phases.clear()
            service.onStartCommand(Intent(TonoVpnService.ACTION_DISCONNECT), 0, 1)
            drain()
            assertFalse("the real disconnect entry point must release the TUN despite storage failure", platform.tunOpen)
            @Suppress("UNCHECKED_CAST")
            val state = field("snapshot").get(service) as AtomicReference<EngineSnapshot>
            assertEquals(Phase.IDLE, state.get().phase)
            assertNull(state.get().reasonCode)
            assertTrue("the service must publish DISCONNECTING after the physical close", phases.any { it.first == Phase.DISCONNECTING && !it.second })
            assertEquals(Phase.IDLE, phases.last().first)
            binder.unregister(listener)
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
            assertEquals(service.getString(com.raydocs.tono.mobile.R.string.stop_persistence_warning), org.robolectric.shadows.ShadowToast.getTextOfLatestToast())
        } finally {
            blockedWrite.delete()
            controller.destroy()
            pipe.forEach { it.close() }
            io.shutdownNow()
        }
    }

    private fun field(name: String) = TonoVpnService::class.java.getDeclaredField(name).apply { isAccessible = true }

    /** Hold catalog HTTP without running it: PREPARING is observable, no real network or sleeps. */
    private class HoldingIo : AbstractExecutorService() {
        private val tasks = mutableListOf<Runnable>()
        private var stopped = false
        override fun execute(command: Runnable) { check(!stopped); tasks += command }
        override fun shutdown() { stopped = true }
        override fun shutdownNow(): MutableList<Runnable> { stopped = true; return tasks.toMutableList().also { tasks.clear() } }
        override fun isShutdown() = stopped
        override fun isTerminated() = stopped
        override fun awaitTermination(timeout: Long, unit: TimeUnit) = stopped
    }

    @Implements(value = EngineStore::class, isInAndroidSdk = false)
    class SignedInStore {
        @Implementation fun refreshToken(): String = "fixture-refresh"
    }

    @Implements(VpnService::class)
    class GrantedVpn : org.robolectric.shadows.ShadowService() {
        companion object {
            @JvmStatic @Implementation fun prepare(context: Context): Intent? = null
        }
    }
}
