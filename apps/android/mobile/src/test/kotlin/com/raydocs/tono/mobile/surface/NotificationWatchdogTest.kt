package com.raydocs.tono.mobile.surface

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.mobile.engine.TonoNotifications
import com.raydocs.tono.mobile.ui.UiFixtures
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * The engine's ongoing notification after the engine's process died with no app open to replace
 * it: the watchdog the engine leaves armed replaces any claim the shared status and Android do not
 * support, and leaves supported claims and its own replacements alone.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NotificationWatchdogTest {
    private val app = RuntimeEnvironment.getApplication()
    private val nm = app.getSystemService(NotificationManager::class.java)
    private val now = 1_000_000_000L
    private val pi = PendingIntent.getActivity(app, 0, Intent(), PendingIntent.FLAG_IMMUTABLE)

    private fun postEngineNotification(phase: Phase) {
        nm.createNotificationChannel(NotificationChannel(TonoNotifications.CHANNEL, "t", NotificationManager.IMPORTANCE_LOW))
        val s = if (phase == Phase.CONNECTED) UiFixtures.connected() else UiFixtures.idle.copy(phase = phase)
        nm.notify(TonoNotifications.ONGOING_ID, TonoNotifications.ongoing(app, s, pi, pi))
    }

    private fun view(phase: Phase, ageMs: Long, vpn: Boolean) =
        SurfaceRules.view(PublicStatus(phase, updatedAtMs = now - ageMs, boot = 7), now, 7, vpn)

    private fun title() = nm.activeNotifications.single { it.id == TonoNotifications.ONGOING_ID }.notification.extras.getCharSequence(Notification.EXTRA_TITLE).toString()

    @Test fun connectedWithoutAVpnNetworkIsReplacedWithStopped() {
        postEngineNotification(Phase.CONNECTED)
        assertEquals(app.getString(R.string.state_connected), title())
        // The record is still fresh (the engine died seconds ago), but Android has no VPN network.
        assertEquals(Phase.CONNECTED, NotificationWatchdog.check(app, view(Phase.CONNECTED, ageMs = 5_000, vpn = false), vpnPresent = false))
        assertEquals(app.getString(R.string.notif_stopped_title), title())
        // The replacement claims nothing, so a later check leaves it.
        assertNull(NotificationWatchdog.check(app, view(Phase.CONNECTED, ageMs = 200_000, vpn = false), vpnPresent = false))
    }

    @Test fun aLiveTunnelIsLeftAlone() {
        postEngineNotification(Phase.CONNECTED)
        assertNull(NotificationWatchdog.check(app, view(Phase.CONNECTED, ageMs = 5_000, vpn = true), vpnPresent = true))
        assertEquals(app.getString(R.string.state_connected), title())
    }

    @Test fun connectingFromAnEngineThatStoppedWritingIsReplacedOnceTheRecordIsStale() {
        postEngineNotification(Phase.CONNECTING)
        assertNull("still within the heartbeat", NotificationWatchdog.check(app, view(Phase.CONNECTING, ageMs = 20_000, vpn = false), vpnPresent = false))
        assertEquals(Phase.CONNECTING, NotificationWatchdog.check(app, view(Phase.CONNECTING, ageMs = SurfaceRules.STALE_MS + 1, vpn = true), vpnPresent = true))
        // Android still has a VPN network, so the state cannot be vouched for either way.
        assertEquals(app.getString(R.string.surface_unknown), title())
    }

    @Test fun engineDeathReplacesAnyClaimAtOnceAndSaysStoppedOnceTheVpnIsGone() {
        postEngineNotification(Phase.CONNECTED)
        // Android has not dropped the dead tunnel's VPN network yet: no claim either way.
        assertEquals(Phase.CONNECTED, NotificationWatchdog.engineDied(app, vpnPresent = true))
        assertEquals(app.getString(R.string.surface_unknown), title())
        assertEquals(false, NotificationWatchdog.confirmStopped(app, vpnPresent = true))
        assertEquals(true, NotificationWatchdog.confirmStopped(app, vpnPresent = false))
        assertEquals(app.getString(R.string.notif_stopped_title), title())
    }

    @Test fun engineDeathLeavesARestartedEnginesNotificationAndANormalStopAlone() {
        // A normal stop removed the engine's notification: nothing to replace.
        assertNull(NotificationWatchdog.engineDied(app, vpnPresent = false))
        assertEquals(0, nm.activeNotifications.count { it.id == TonoNotifications.ONGOING_ID })
        // A restarted engine already posted its own: a late confirmation must not overwrite it.
        postEngineNotification(Phase.CONNECTING)
        assertEquals(false, NotificationWatchdog.confirmStopped(app, vpnPresent = false))
        assertEquals(app.getString(R.string.state_connecting), title())
    }

    @Test fun aStartingEngineReplacesTheDeadOnesRepostedClaim() {
        // Android re-posts a crashed engine's last notification when it restarts the service.
        postEngineNotification(Phase.CONNECTED)
        assertEquals(Phase.CONNECTED, NotificationWatchdog.engineStarting(app))
        assertEquals(false, title() == app.getString(R.string.state_connected))
        // Nothing claimed: nothing to do.
        assertNull(NotificationWatchdog.engineStarting(app))
    }

    @Test fun theWatchReplacesARepostedTunnelClaimButNotARestartedEnginesConnecting() {
        // A restarted engine says Connecting before it registers with the watch: that one stays.
        postEngineNotification(Phase.CONNECTING)
        assertNull(NotificationWatchdog.restartRepost(app))
        assertEquals(app.getString(R.string.state_connecting), title())
        postEngineNotification(Phase.DEGRADED)
        assertEquals(Phase.DEGRADED, NotificationWatchdog.restartRepost(app))
        assertNull(NotificationWatchdog.restartRepost(app))
    }
}
