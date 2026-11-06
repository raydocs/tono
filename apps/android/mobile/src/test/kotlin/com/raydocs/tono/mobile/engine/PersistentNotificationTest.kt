package com.raydocs.tono.mobile.engine

import android.app.Notification
import android.app.PendingIntent
import android.content.Intent
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.ui.UiFixtures
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PersistentNotificationTest {
    @Test fun androidRepostingTheExactOldNotificationCannotAssertALiveTunnel() {
        val app = RuntimeEnvironment.getApplication()
        val pi = PendingIntent.getActivity(app, 0, Intent(), PendingIntent.FLAG_IMMUTABLE)
        val old = TonoNotifications.ongoing(app, UiFixtures.connected(), pi, pi)
        // Replay the SAME object, with no watchdog or replacement. Neither process nor VPN need
        // exist now: the OS can retain these public fields indefinitely.
        val replay = old.clone()
        assertEquals(app.getString(R.string.notif_running_title), replay.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertEquals(app.getString(R.string.notif_check_live), replay.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        assertEquals(R.drawable.ic_stat_standby, replay.smallIcon.resId)
        assertFalse(replay.extras.getCharSequence(Notification.EXTRA_TITLE).toString().contains(app.getString(R.string.state_connected)))
        // Phase is private protocol metadata, retained for session-fenced watchdog convergence.
        assertEquals(Phase.CONNECTED, TonoNotifications.claimedPhase(replay))
    }
    @Test fun connectingNotificationOffersCancelInsteadOfDisconnect() {
        val app = RuntimeEnvironment.getApplication()
        val pi = PendingIntent.getActivity(app, 0, Intent(), PendingIntent.FLAG_IMMUTABLE)
        val notification = TonoNotifications.ongoing(app, UiFixtures.idle.copy(phase = Phase.CONNECTING), pi, pi)
        assertEquals(app.getString(R.string.action_cancel), notification.actions.single().title.toString())
    }
    @Test fun ongoingNotificationIsRepostedOnChangeOrAfterAHeartbeatNotOnEveryTick() {
        val posted = TonoNotifications.Posted(Phase.CONNECTED, "engine-a", atElapsedMs = 50_000)
        // A speed tick one second later changes nothing the notification shows.
        assertFalse(TonoNotifications.repostDue(posted, Phase.CONNECTED, "engine-a", 51_000))
        assertFalse(TonoNotifications.repostDue(posted, Phase.CONNECTED, "engine-a", 59_999))
        // A heartbeat later it is posted again, so a replacement made while the engine runs is undone.
        assertTrue(TonoNotifications.repostDue(posted, Phase.CONNECTED, "engine-a", 60_000))
        assertTrue(TonoNotifications.repostDue(posted, Phase.DEGRADED, "engine-a", 50_001))
        assertTrue(TonoNotifications.repostDue(posted, Phase.CONNECTED, "engine-b", 50_001))
        assertTrue(TonoNotifications.repostDue(posted, Phase.CONNECTED, "engine-a", 49_000))
        assertTrue(TonoNotifications.repostDue(null, Phase.CONNECTING, "engine-a", 0))
    }

}
