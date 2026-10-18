package com.raydocs.tono.mobile

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.mobile.ui.LocalReduceMotion
import com.raydocs.tono.mobile.ui.TonoActions
import com.raydocs.tono.mobile.ui.TonoRoot
import com.raydocs.tono.mobile.ui.TonoTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.Collections

/**
 * Horizon UI on a real Android system from fixture snapshots (no tunnel exists): the accessibility
 * contract plus Google's Accessibility Test Framework on every screen, the primary control through
 * real taps and the swipe-up gesture through the system input pipeline ([LargeTextDeviceTest] covers
 * the largest text size). Ambient motion is off here so Compose can reach idle; [SystemMotionDeviceTest] covers motion.
 * Screenshots are `fixture-*`.
 */
@RunWith(AndroidJUnit4::class)
class HorizonUiDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val device = UiDevice.getInstance(instrumentation)
    private val out = File(context.getExternalFilesDir(null), "evidence").apply { mkdirs() }

    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private val calls: MutableList<String> = Collections.synchronizedList(mutableListOf())
    private var snapshot by mutableStateOf<EngineSnapshot>(DeviceFixtures.idle)

    private fun str(id: Int) = context.getString(id)

    private fun show() = compose.setContent {
        CompositionLocalProvider(LocalReduceMotion provides true) {
            TonoTheme {
                TonoRoot(snapshot, object : TonoActions {
                    override fun connect() { calls += "connect" }
                    override fun command(op: String, vararg args: Pair<String, Any?>) { calls += op }
                    override fun explain(host: String): Map<String, Any?>? = null
                })
            }
        }
    }

    private fun set(s: EngineSnapshot) { snapshot = s; compose.waitForIdle() }

    private fun shot(name: String) { compose.waitForIdle(); Thread.sleep(400); device.takeScreenshot(File(out, "$name.png")) }

    private fun back() { device.pressBack(); compose.waitForIdle(); Thread.sleep(300) }

    @Test fun u1_accessibilityContractAndAtfOnEveryScreen() {
        compose.enableAccessibilityChecks() // ATF runs on every Compose interaction below; it throws on errors
        show()
        val report = mutableListOf<String>()
        val found = mutableListOf<String>()
        fun check(screen: String) { compose.waitForIdle(); found += A11yContract.violations(compose, screen, report) }
        for ((name, s) in DeviceFixtures.homeStates + ("signin" to DeviceFixtures.idle.copy(phase = Phase.SIGNED_OUT))) { set(s); check(name) }
        set(DeviceFixtures.degraded())
        compose.onNodeWithTag("details").performClick(); check("details"); back()
        compose.onNodeWithTag("exit").performClick(); check("lines"); shot("fixture-10-lines-sheet"); back()
        compose.onNodeWithContentDescription(str(R.string.settings_title)).performClick(); check("settings"); shot("fixture-11-settings")
        compose.onNodeWithText(str(R.string.settings_apps_none)).performScrollTo().performClick(); check("apps"); shot("fixture-12-apps")
        File(out, "a11y-report.txt").writeText((report + listOf("", "violations: ${found.size}") + found).joinToString("\n"))
        assertEquals(found.joinToString("\n"), 0, found.size)
    }

    @Test fun u2_primaryControlActsThroughRealTaps() {
        show()
        val expected = listOf(
            DeviceFixtures.idle to "connect",
            DeviceFixtures.idle.copy(phase = Phase.NEEDS_PERMISSION) to "connect",
            DeviceFixtures.idle.copy(phase = Phase.PREPARING) to "disconnect",
            DeviceFixtures.idle.copy(phase = Phase.CONNECTING) to "disconnect",
            DeviceFixtures.connected() to "disconnect",
            DeviceFixtures.degraded() to "disconnect",
            DeviceFixtures.failed to "connect",
        )
        val log = mutableListOf<String>()
        for ((s, action) in expected) {
            set(s)
            calls.clear()
            // A real tap: UiDevice injects the touch through the system, at the capsule's centre.
            val b = compose.onNodeWithTag("primary").fetchSemanticsNode().boundsInWindow
            device.click(b.center.x.toInt(), b.center.y.toInt() + windowTop())
            compose.waitForIdle()
            log += "${s.phase} → ${calls.joinToString().ifEmpty { "(nothing)" }}"
            assertEquals("tap in ${s.phase}", listOf(action), calls.toList())
        }
        set(DeviceFixtures.idle.copy(phase = Phase.DISCONNECTING))
        calls.clear()
        compose.onNodeWithTag("primary").assertIsNotEnabled()
        val b = compose.onNodeWithTag("primary").fetchSemanticsNode().boundsInWindow
        device.click(b.center.x.toInt(), b.center.y.toInt() + windowTop())
        compose.waitForIdle()
        log += "DISCONNECTING → ${calls.joinToString().ifEmpty { "(disabled, nothing)" }}"
        File(out, "interaction-report.txt").writeText(log.joinToString("\n"))
        assertTrue("disconnecting ignores taps", calls.isEmpty())
    }

    @Test fun u3_swipeUpOnTheDockOpensDetails() {
        show()
        set(DeviceFixtures.connected())
        val b = compose.onNodeWithTag("primary").fetchSemanticsNode().boundsInWindow
        val x = b.center.x.toInt()
        val y = b.center.y.toInt() + windowTop()
        device.swipe(x, y, x, y - 500, 25) // ~125 ms flick starting on the capsule
        compose.waitForIdle()
        Thread.sleep(800)
        compose.onNodeWithText(str(R.string.details_routes)).assertExists()
        shot("fixture-09-details-by-swipe")
        File(out, "interaction-report.txt").appendText("\nswipe up from the capsule → Details open, actions: ${calls.joinToString().ifEmpty { "none" }}\n")
        assertTrue("a swipe is not a tap", calls.isEmpty())
    }

    /** Window → screen offset for UiDevice coordinates. */
    private fun windowTop(): Int {
        val loc = IntArray(2)
        instrumentation.runOnMainSync { compose.activity.window.decorView.getLocationOnScreen(loc) }
        return loc[1]
    }
}
