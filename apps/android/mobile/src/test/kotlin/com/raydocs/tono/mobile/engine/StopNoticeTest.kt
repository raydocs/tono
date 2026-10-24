package com.raydocs.tono.mobile.engine

import android.app.Notification
import android.app.PendingIntent
import android.content.Intent
import com.raydocs.tono.mobile.R
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class StopNoticeTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private fun pi() = PendingIntent.getActivity(app, 0, Intent(), PendingIntent.FLAG_IMMUTABLE)
    private fun text(n: Notification) =
        "${n.extras.getCharSequence(Notification.EXTRA_TEXT)}\n${n.extras.getCharSequence(Notification.EXTRA_BIG_TEXT)}"

    @Test fun userStopPostsNothing() {
        assertNull(StopNotices.of(StopKind.USER, lockdown = false, code = null))
        assertNull(StopNotices.of(StopKind.USER, lockdown = true, code = "CORE_STOPPED"))
    }

    @Test fun revokeAndFailureAreToldApart() {
        val revoked = StopNotices.of(StopKind.REVOKED, false, null)!!
        val failed = StopNotices.of(StopKind.RECOVERABLE, false, "CORE_STOPPED")!!
        assertEquals(StopTitle.REVOKED, revoked.title)
        assertEquals(StopAction.OPEN, revoked.action)
        assertEquals(StopTitle.STOPPED, failed.title)
        assertEquals(StopAction.RETRY, failed.action)
        assertEquals("CORE_STOPPED", failed.reasonCode)
    }

    @Test fun lockdownNeverChoosesAnOpenNetworkBody() {
        for (kind in listOf(StopKind.REVOKED, StopKind.RECOVERABLE)) {
            val body = StopNotices.of(kind, lockdown = true, code = "X")!!.body
            assertTrue(body.name, body == StopBody.REVOKED_LOCKDOWN || body == StopBody.FAILED_LOCKDOWN)
        }
    }

    @Test fun lockdownNotificationsNeverSayTrafficIsGoingOutDirectly() {
        val open = setOf(app.getString(R.string.notif_failed_open), app.getString(R.string.notif_revoked_open))
        val shown = listOf(
            TonoNotifications.stopped(app, "CORE_STOPPED", pi(), pi(), lockdown = true),
            TonoNotifications.revoked(app, pi(), lockdown = true),
            // Callers that do not know default to the Lockdown-safe copy.
            TonoNotifications.stopped(app, "CORE_STOPPED", pi(), pi()),
            TonoNotifications.revoked(app, pi()),
        )
        for (n in shown) {
            val t = text(n)
            open.forEach { assertFalse(t, t.contains(it)) }
        }
        assertTrue(text(shown[0]).contains(app.getString(R.string.notif_failed_lockdown)))
        assertTrue(text(shown[1]).contains(app.getString(R.string.notif_revoked_lockdown)))
    }

    @Test fun revokeOffersOpenNotRetryAndFailureOffersRetry() {
        val revoked = TonoNotifications.revoked(app, pi(), lockdown = false)
        assertEquals(app.getString(R.string.notif_revoked_title), revoked.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertEquals(app.getString(R.string.surface_open), revoked.actions.single().title.toString())
        assertTrue(text(revoked).contains(app.getString(R.string.notif_revoked_open)))

        val failed = TonoNotifications.stopped(app, "CORE_STOPPED", pi(), pi(), lockdown = false)
        assertEquals(app.getString(R.string.notif_stopped_title), failed.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertEquals(app.getString(R.string.action_retry), failed.actions.single().title.toString())
        assertTrue(text(failed).contains(app.getString(R.string.notif_failed_open)))
    }

    @Test @Config(sdk = [35], qualifiers = "zh-rCN")
    fun chineseCopyKeepsTheLockdownPromise() {
        val n = TonoNotifications.revoked(app, pi(), lockdown = true)
        assertEquals("系统已关闭 Tono 的 VPN", n.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        val t = text(n)
        assertTrue(t, t.contains("阻断"))
        assertFalse(t, t.contains("直接使用本机网络"))
        val failed = TonoNotifications.stopped(app, "CORE_STOPPED", pi(), pi(), lockdown = true)
        assertEquals("Tono 已停止", failed.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertFalse(text(failed).contains("直接使用本机网络"))
    }
}
