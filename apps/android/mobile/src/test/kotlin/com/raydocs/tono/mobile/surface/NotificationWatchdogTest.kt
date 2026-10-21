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
 * support, and leaves supported claims and its own replacements alone. Every replacement is fenced
 * by the engine instance it is about, so a late one never touches a newer engine's notification.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class NotificationWatchdogTest {
    private val app = RuntimeEnvironment.getApplication()
    private val nm = app.getSystemService(NotificationManager::class.java)
    private val now = 5_000_000L
    private val pi = PendingIntent.getActivity(app, 0, Intent(), PendingIntent.FLAG_IMMUTABLE)
    private val engineA = UiFixtures.ENGINE
    private val engineB = "fixture-engine-2"

    private fun postEngineNotification(phase: Phase, session: String = engineA) {
        nm.createNotificationChannel(NotificationChannel(TonoNotifications.CHANNEL, "t", NotificationManager.IMPORTANCE_LOW))
        val s = when (phase) {
            Phase.CONNECTED -> UiFixtures.connected()
            Phase.DEGRADED -> UiFixtures.degraded()
            else -> UiFixtures.idle.copy(phase = phase)
        }.copy(session = session)
        nm.notify(TonoNotifications.ONGOING_ID, TonoNotifications.ongoing(app, s, pi, pi))
    }

    private fun view(phase: Phase, ageMs: Long, vpn: Boolean?, session: String = engineA) = SurfaceRules.view(
        PublicStatus(phase, updatedAtMs = 0, boot = 7, session = session, version = 3, attempt = 3, confirmed = phase == Phase.CONNECTED || phase == Phase.DEGRADED, elapsedMs = now - ageMs),
        now, 7, vpn,
    )

    private fun title() = nm.activeNotifications.single { it.id == TonoNotifications.ONGOING_ID }.notification.extras.getCharSequence(Notification.EXTRA_TITLE).toString()

    @Test fun connectedWithoutTonosVpnNetworkIsReplacedWithStopped() {
        postEngineNotification(Phase.CONNECTED)
        assertEquals(app.getString(R.string.notif_running_title), title())
        // The record is still fresh (the engine died seconds ago), but Android lists no Tono VPN network.
        assertEquals(Phase.CONNECTED, NotificationWatchdog.check(app, view(Phase.CONNECTED, ageMs = 5_000, vpn = false), tonoVpn = false))
        assertEquals(app.getString(R.string.notif_stopped_title), title())
        // The replacement claims nothing, so a later check leaves it.
        assertNull(NotificationWatchdog.check(app, view(Phase.CONNECTED, ageMs = 200_000, vpn = false), tonoVpn = false))
    }

    @Test fun aLiveConfirmedTunnelIsLeftAlone() {
        postEngineNotification(Phase.CONNECTED)
        assertNull(NotificationWatchdog.check(app, view(Phase.CONNECTED, ageMs = 5_000, vpn = true), tonoVpn = true))
        assertEquals(app.getString(R.string.notif_running_title), title())
    }

    @Test fun connectingFromAnEngineThatStoppedWritingIsReplacedOnceTheRecordIsStale() {
        postEngineNotification(Phase.CONNECTING)
        assertNull("still within the heartbeat", NotificationWatchdog.check(app, view(Phase.CONNECTING, ageMs = 20_000, vpn = false), tonoVpn = false))
        assertEquals(Phase.CONNECTING, NotificationWatchdog.check(app, view(Phase.CONNECTING, ageMs = SurfaceRules.STALE_MS + 1, vpn = true), tonoVpn = true))
        // Android still lists Tono's VPN network, so the state cannot be vouched for either way.
        assertEquals(app.getString(R.string.surface_unknown), title())
    }

    @Test fun theAlarmReplacesALeftoverClaimOfAnInstanceThatNoLongerWrites() {
        // engine-a's notification is still up; the fresh, confirmed record is engine-b's.
        postEngineNotification(Phase.CONNECTED, session = engineA)
        assertEquals(Phase.CONNECTED, NotificationWatchdog.check(app, view(Phase.CONNECTED, ageMs = 1_000, vpn = true, session = engineB), tonoVpn = true))
        assertEquals(app.getString(R.string.surface_unknown), title())
    }

    @Test fun engineDeathReplacesItsClaimAtOnceAndSaysStoppedOnceTheVpnIsGone() {
        postEngineNotification(Phase.CONNECTED)
        // Android has not dropped the dead tunnel's VPN network yet: no claim either way.
        assertEquals(Phase.CONNECTED, NotificationWatchdog.engineDied(app, engineA, tonoVpn = true))
        assertEquals(app.getString(R.string.surface_unknown), title())
        assertEquals(false, NotificationWatchdog.confirmStopped(app, tonoVpn = true))
        assertEquals(true, NotificationWatchdog.confirmStopped(app, tonoVpn = false))
        assertEquals(app.getString(R.string.notif_stopped_title), title())
    }

    /** Run 39202302351's regression and r8's 57 s window, from the other side: a late death never takes a newer Connected. */
    @Test fun theOldEnginesLateDeathLeavesTheReconnectedEnginesConnected() {
        postEngineNotification(Phase.CONNECTED, session = engineB)
        assertNull(NotificationWatchdog.engineDied(app, engineA, tonoVpn = true))
        assertNull(NotificationWatchdog.restartRepost(app, engineA))
        assertEquals(false, NotificationWatchdog.confirmStopped(app, tonoVpn = false))
        assertEquals(app.getString(R.string.notif_running_title), title())
    }

    @Test fun engineDeathLeavesANormalStopAlone() {
        // A normal stop removed the engine's notification: nothing to replace.
        assertNull(NotificationWatchdog.engineDied(app, engineA, tonoVpn = false))
        assertEquals(0, nm.activeNotifications.count { it.id == TonoNotifications.ONGOING_ID })
    }

    @Test fun aLateStoppedConfirmationLeavesARestartedEnginesConnecting() {
        postEngineNotification(Phase.CONNECTING, session = engineB)
        assertEquals(false, NotificationWatchdog.confirmStopped(app, tonoVpn = false))
        assertEquals(app.getString(R.string.notif_running_title), title())
    }

    @Test fun aStartingEngineReplacesTheDeadOnesRepostedClaimButNotItsOwn() {
        // Android re-posts a crashed engine's last notification when it restarts the service.
        postEngineNotification(Phase.CONNECTED, session = engineA)
        assertEquals(Phase.CONNECTED, NotificationWatchdog.engineStarting(app, engineB))
        assertEquals(false, title() == app.getString(R.string.state_connected))
        // Nothing claimed: nothing to do; and an instance's own claim is never a leftover.
        assertNull(NotificationWatchdog.engineStarting(app, engineB))
        postEngineNotification(Phase.CONNECTING, session = engineB)
        assertNull(NotificationWatchdog.engineStarting(app, engineB))
    }

    @Test fun theWatchReplacesTheDeadInstancesRepostedTunnelClaimOnly() {
        // A restarted engine says Connecting before it registers with the watch: that one stays.
        postEngineNotification(Phase.CONNECTING, session = engineB)
        assertNull(NotificationWatchdog.restartRepost(app, engineA))
        assertEquals(app.getString(R.string.notif_running_title), title())
        postEngineNotification(Phase.DEGRADED, session = engineA)
        assertEquals(Phase.DEGRADED, NotificationWatchdog.restartRepost(app, engineA))
        assertNull(NotificationWatchdog.restartRepost(app, engineA))
    }

    @Test fun anUnconfirmedConnectedSnapshotPostsAConnectingClaim() {
        nm.createNotificationChannel(NotificationChannel(TonoNotifications.CHANNEL, "t", NotificationManager.IMPORTANCE_LOW))
        nm.notify(TonoNotifications.ONGOING_ID, TonoNotifications.ongoing(app, UiFixtures.connected().copy(applied = null), pi, pi))
        assertEquals(app.getString(R.string.notif_running_title), title())
        assertEquals(Phase.CONNECTING, TonoNotifications.claimedPhase(nm.activeNotifications.single { it.id == TonoNotifications.ONGOING_ID }.notification))
    }
}
