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
    class GrantedVpn {
        companion object {
            @JvmStatic @Implementation fun prepare(context: Context): Intent? = null
        }
    }
}
