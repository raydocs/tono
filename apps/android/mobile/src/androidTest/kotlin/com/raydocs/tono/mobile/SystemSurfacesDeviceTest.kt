package com.raydocs.tono.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.appwidget.AppWidgetHost
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.os.ParcelFileDescriptor
import android.view.Gravity
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Configurator
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.mobile.engine.TonoNotifications
import com.raydocs.tono.mobile.surface.PublicStatus
import com.raydocs.tono.mobile.surface.PublicStatusStore
import com.raydocs.tono.mobile.surface.SurfaceRules
import com.raydocs.tono.mobile.surface.SurfaceState
import com.raydocs.tono.mobile.surface.TonoTileService
import com.raydocs.tono.mobile.surface.TonoWidget
import com.raydocs.tono.mobile.ui.MainActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * Android system surfaces. `real-*`: the shipped tile and widget inside Android's own Quick Settings
 * and widget host, showing the real shared status of this install (signed out: CI has no account).
 * `fixture-*`: the same widget and notification builders fed fixture states, each marked "Fixture"
 * on screen; nothing here starts a tunnel or writes the shared status.
 */
@RunWith(AndroidJUnit4::class)
class SystemSurfacesDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val device = UiDevice.getInstance(instrumentation)
    private val out = File(context.getExternalFilesDir(null), "evidence").apply { mkdirs() }
    private val tile = ComponentName(context, TonoTileService::class.java)

    init { Configurator.getInstance().waitForIdleTimeout = 300 }

    private fun shell(cmd: String): String =
        ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand(cmd)).use { it.readBytes().decodeToString() }

    private fun shot(name: String) { Thread.sleep(600); assertTrue(name, device.takeScreenshot(File(out, "$name.png"))) }

    /** The engine publishes its status whenever it runs; launching the app starts it if needed. */
    private fun realState(): SurfaceState {
        if (PublicStatusStore.read(context) == null) {
            ActivityScenario.launch(MainActivity::class.java).use {
                device.wait(Until.hasObject(By.text(context.getString(R.string.signin_title))), 20_000)
                Thread.sleep(1_000)
            }
        }
        return PublicStatusStore.current(context).state
    }

    @Test fun s1_realQuickSettingsTileShowsSharedStatusAndOpensTheApp() {
        val state = realState()
        assertEquals("CI install is signed out", SurfaceState.SIGNED_OUT, state)
        // Put the tile first in Quick Settings for the capture (restored afterwards); appended tiles
        // land on a later page of the emulator's grid.
        val savedTiles = shell("settings get secure sysui_qs_tiles").trim()
        shell("settings put secure sysui_qs_tiles custom(${tile.flattenToString()}),internet,bt,flashlight,dnd")
        try {
            Thread.sleep(1_500)
            shell("cmd statusbar expand-settings")
            Thread.sleep(2_000) // let the panel finish expanding before reading it
            val signIn = context.getString(R.string.state_signed_out)
            val tileSelector = By.descContains("Tono")
            val found = device.wait(Until.findObject(tileSelector), 10_000)
            assertNotNull("Tono tile in Quick Settings", found)
            val desc = runCatching { device.findObject(tileSelector)?.contentDescription }.getOrNull()
            File(out, "real-tile.txt").writeText("shared status: $state\ntile description: $desc\n")
            shot("real-08-quick-settings-tile")
            assertTrue("tile shows the shared status ($desc)", desc?.contains(signIn) == true)
            device.findObject(tileSelector).click()
            // Signed out: the tile must not try to connect; it opens Tono at sign-in and closes the shade.
            assertNotNull("tile opens the app", device.wait(Until.findObject(By.text(context.getString(R.string.signin_title))), 15_000))
            shot("real-09-tile-opens-sign-in")
        } finally {
            shell("cmd statusbar collapse")
            shell(if (savedTiles.isEmpty() || savedTiles == "null") "settings delete secure sysui_qs_tiles" else "settings put secure sysui_qs_tiles $savedTiles")
        }
    }

    @Test fun s2_realWidgetInAndroidsWidgetHost() {
        val state = realState()
        val manager = AppWidgetManager.getInstance(context)
        val provider = ComponentName(context, TonoWidget::class.java)
        val host = AppWidgetHost(context, 4711)
        val id = host.allocateAppWidgetId()
        shell("appwidget grantbind --package ${context.packageName} --user 0")
        try {
            assertTrue("bind widget", manager.bindAppWidgetIdIfAllowed(id, provider))
            ActivityScenario.launch(ComponentActivity::class.java).use { scenario ->
                scenario.onActivity { a ->
                    host.startListening()
                    val view = host.createView(a, id, manager.getAppWidgetInfo(id))
                    a.setContentView(
                        FrameLayout(a).apply {
                            setBackgroundColor(Color.parseColor("#1F2433"))
                            val d = resources.displayMetrics.density
                            addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (88 * d).toInt(), Gravity.CENTER).apply { leftMargin = (16 * d).toInt(); rightMargin = leftMargin })
                        },
                    )
                }
                TonoWidget.updateAll(context) // what the engine calls on every state change
                assertNotNull("widget shows the real state", device.wait(Until.findObject(By.text(context.getString(R.string.state_signed_out))), 10_000))
                File(out, "real-widget.txt").writeText("shared status: $state; widget bound through AppWidgetManager id=$id\n")
                shot("real-10-widget")
            }
        } finally {
            host.stopListening()
            host.deleteAppWidgetId(id)
        }
    }

    @Test fun s3_fixtureWidgetAndNotificationStates() {
        val now = System.currentTimeMillis()
        val boot = PublicStatusStore.boot(context)
        fun st(p: Phase, reason: String? = null, cloud: String? = null, home: String? = null, age: Long = 0) =
            PublicStatus(p, reason, "Tokyo · Dawn", cloud, home, now - age, boot)
        val cases = listOf(
            "connected" to SurfaceRules.view(st(Phase.CONNECTED, cloud = "JP", home = "US"), now, boot, true),
            "degraded" to SurfaceRules.view(st(Phase.DEGRADED, "HOME_UNREACHABLE", cloud = "JP"), now, boot, true),
            "off" to SurfaceRules.view(st(Phase.IDLE), now, boot, false),
            "failed" to SurfaceRules.view(st(Phase.FAILED, "HOME_UNAVAILABLE"), now, boot, false),
            "connected 10 min ago, no heartbeat since" to SurfaceRules.view(st(Phase.CONNECTED, cloud = "JP", age = 10 * 60_000), now, boot, true),
        )
        assertEquals(SurfaceState.UNKNOWN, cases.last().second.state)
        ActivityScenario.launch(ComponentActivity::class.java).use { scenario ->
            scenario.onActivity { a ->
                val d = a.resources.displayMetrics.density
                val column = LinearLayout(a).apply {
                    orientation = LinearLayout.VERTICAL
                    setBackgroundColor(Color.parseColor("#1F2433"))
                    setPadding((16 * d).toInt(), (48 * d).toInt(), (16 * d).toInt(), 0)
                }
                for ((name, v) in cases) {
                    column.addView(TextView(a).apply { text = "FIXTURE · $name (no tunnel)"; setTextColor(Color.parseColor("#FFB4A0")); textSize = 12f })
                    val w = TonoWidget.views(a, v, consentGranted = true).apply(a, column)
                    column.addView(w, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (72 * d).toInt()).apply { bottomMargin = (14 * d).toInt() })
                }
                a.setContentView(column)
            }
            assertNotNull(device.wait(Until.findObject(By.textStartsWith("FIXTURE · connected")), 10_000))
            shot("fixture-17-widget-states")
        }

        shell("pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS")
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(TonoNotifications.CHANNEL, context.getString(R.string.notification_channel), NotificationManager.IMPORTANCE_LOW))
        val pi = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        // Marked in the title itself, so the label survives collapsed and grouped notification views.
        fun fixture(n: Notification) = Notification.Builder.recoverBuilder(context, n)
            .setContentTitle("FIXTURE · " + n.extras.getCharSequence(Notification.EXTRA_TITLE)).setSubText("no tunnel").build()
        val connected = DeviceFixtures.connected().let { EngineSnapshot(phase = it.phase, nodes = it.nodes, selectedNode = it.selectedNode, homeKind = it.homeKind, cloudProbe = it.cloudProbe, homeProbe = it.homeProbe) }
        val notifications = listOf(
            "fixture-18-notification-connected" to TonoNotifications.ongoing(context, connected, pi, pi),
            "fixture-19-notification-stopped" to TonoNotifications.stopped(context, "CORE_STOPPED", pi, pi),
        )
        try {
            for ((name, n) in notifications) {
                nm.notify(9101, fixture(n))
                shell("cmd statusbar expand-notifications")
                assertNotNull(device.wait(Until.findObject(By.textStartsWith("FIXTURE · ")), 10_000))
                shot(name)
                shell("cmd statusbar collapse")
                nm.cancel(9101)
                Thread.sleep(800)
            }
        } finally {
            shell("cmd statusbar collapse")
            nm.cancel(9101)
        }
    }
}
