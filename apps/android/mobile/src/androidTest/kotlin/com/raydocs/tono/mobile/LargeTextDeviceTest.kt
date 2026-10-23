package com.raydocs.tono.mobile

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.hasText
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
import org.junit.rules.ExternalResource
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import java.io.File

/**
 * Android's largest font size (Settings → Display → Font size, 200 %, with Android 14's non-linear
 * scaling of big text), set before the activity starts. Fixture snapshots only; no text may be
 * ellipsized or clipped, and Home must stay usable (it scrolls when the dock no longer fits).
 */
@RunWith(AndroidJUnit4::class)
class LargeTextDeviceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val device = UiDevice.getInstance(instrumentation)
    private val out = File(context.getExternalFilesDir(null), "evidence").apply { mkdirs() }

    private fun shell(cmd: String) = instrumentation.uiAutomation.executeShellCommand(cmd).close()

    private val largestFont = object : ExternalResource() {
        override fun before() { shell("settings put system font_scale 2.0"); Thread.sleep(1_500) }
        override fun after() { shell("settings put system font_scale 1.0") }
    }
    private val compose = createAndroidComposeRule<ComponentActivity>()
    @get:Rule val rules: RuleChain = RuleChain.outerRule(largestFont).around(compose)

    private var snapshot by mutableStateOf<EngineSnapshot>(DeviceFixtures.idle)

    private fun set(s: EngineSnapshot) { snapshot = s; compose.waitForIdle() }
    private fun shot(name: String) {
        compose.waitForIdle(); Thread.sleep(400); assertTrue("screenshot $name drawn", Captures.drawn(File(out, "$name.png")))
        if (name.startsWith("fixture-")) assertTrue("$name shows the FIXTURE mark", Captures.fixtureMarked(File(out, "$name.png")))
    }

    @Test fun l1_largestSystemTextIsNeverCutOff() {
        assertEquals("system font scale", 2f, compose.activity.resources.configuration.fontScale, 0.01f)
        compose.setContent {
            CompositionLocalProvider(LocalReduceMotion provides true) {
                TonoTheme {
                    FixtureFrame {
                        TonoRoot(snapshot, object : TonoActions {
                            override fun connect() {}
                            override fun command(op: String, vararg args: Pair<String, Any?>) {}
                            override fun explain(host: String): Map<String, Any?>? = null
                        })
                    }
                }
            }
        }
        val cut = mutableListOf<String>()
        for ((name, s) in DeviceFixtures.homeStates + ("signin" to DeviceFixtures.idle.copy(phase = Phase.SIGNED_OUT))) {
            set(s)
            cut += A11yContract.truncatedText(compose, name)
        }
        set(DeviceFixtures.degraded())
        shot("fixture-13-font-2.0-home")
        compose.onNodeWithTag("details").performClick()
        compose.waitForIdle()
        cut += A11yContract.truncatedText(compose, "details")
        shot("fixture-14-font-2.0-details")
        // The sheet scrolls: the mode control and the route check sit under the lanes at this size.
        compose.onNodeWithTag("routeCheckHost").performScrollTo()
        compose.waitForIdle()
        shot("fixture-14b-font-2.0-details-mode-and-check")
        device.pressBack()
        compose.waitForIdle()
        compose.onNodeWithContentDescription(context.getString(R.string.settings_title)).performClick()
        compose.waitForIdle()
        cut += A11yContract.truncatedText(compose, "settings")
        shot("fixture-15-font-2.0-settings")
        // The colophon's last line, so the capture shows the end of the list clear of the navigation bar.
        compose.onNode(hasText("GPL-3.0-or-later", substring = true)).performScrollTo()
        compose.waitForIdle()
        shot("fixture-15b-font-2.0-settings-bottom")
        compose.onNodeWithText(context.getString(R.string.settings_routing_rules)).performScrollTo().performClick()
        compose.waitForIdle()
        cut += A11yContract.truncatedText(compose, "routing-rules")
        shot("fixture-15c-font-2.0-routing-rules")
        device.pressBack()
        compose.waitForIdle()
        compose.onNodeWithText(context.getString(R.string.settings_sign_out)).performScrollTo().performClick()
        compose.waitForIdle()
        cut += A11yContract.truncatedText(compose, "sign-out-confirm")
        shot("fixture-15d-font-2.0-sign-out-confirm")
        device.pressBack()
        compose.waitForIdle()
        File(out, "font-2.0-report.txt").writeText(
            if (cut.isEmpty()) "font_scale 2.0: no text ellipsized or clipped in ${DeviceFixtures.homeStates.size} home states, sign-in, details and settings"
            else cut.joinToString("\n"),
        )
        assertEquals(cut.joinToString("\n"), 0, cut.size)
    }
}
