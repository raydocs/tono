package com.raydocs.tono.mobile

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
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
 * Screen shapes other than the CI phone, set on the real system before the activity starts: a small
 * phone (360 × 640 dp). Landscape is not covered: neither the user_rotation setting nor
 * UiAutomation.setRotation turned the CI emulator's activity to landscape (runs 39115256726,
 * 39120135343).
 * Fixture snapshots; in every Home state and in Details and Settings no text may be cut off, every
 * control keeps the accessibility contract, and every Home control can be brought on screen.
 */
abstract class ScreenShapeCheck(private val setUp: List<String>, private val tearDown: List<String>) {
    protected val instrumentation = InstrumentationRegistry.getInstrumentation()
    protected val context = instrumentation.targetContext
    private val device = UiDevice.getInstance(instrumentation)
    private val out = File(context.getExternalFilesDir(null), "evidence").apply { mkdirs() }

    private fun shell(cmd: String) = instrumentation.uiAutomation.executeShellCommand(cmd).close()

    private val shape = object : ExternalResource() {
        override fun before() { setUp.forEach(::shell); Thread.sleep(2_000) }
        override fun after() { tearDown.forEach(::shell); Thread.sleep(1_000) }
    }
    protected val compose = createAndroidComposeRule<ComponentActivity>()
    @get:Rule val rules: RuleChain = RuleChain.outerRule(shape).around(compose)

    private var snapshot by mutableStateOf<EngineSnapshot>(DeviceFixtures.idle)

    private fun set(s: EngineSnapshot) { snapshot = s; compose.waitForIdle() }
    private fun shot(name: String) { compose.waitForIdle(); Thread.sleep(400); assertTrue("screenshot $name drawn", Captures.drawn(File(out, "$name.png"))) }

    protected fun check(name: String, report: String) {
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
        val found = mutableListOf<String>()
        val lines = mutableListOf<String>()
        for ((state, s) in DeviceFixtures.homeStates + ("signin" to DeviceFixtures.idle.copy(phase = Phase.SIGNED_OUT))) {
            set(s)
            found += A11yContract.truncatedText(compose, "$name/$state")
            found += A11yContract.violations(compose, "$name/$state")
            if (s.phase != Phase.SIGNED_OUT) for (tag in listOf("primary", "exit", "settings", "details")) {
                // Reachable: on screen already, or brought there by Home's own scroll.
                runCatching { compose.onNodeWithTag(tag).performScrollTo().assertIsDisplayed() }.onFailure { found += "$name/$state: \"$tag\" cannot be brought on screen" }
            }
        }
        set(DeviceFixtures.degraded())
        val config = compose.activity.resources.configuration
        lines += "$name: ${config.screenWidthDp}×${config.screenHeightDp} dp, ${if (config.orientation == 2) "landscape" else "portrait"}, density ${config.densityDpi}"
        shot("fixture-$name-home")
        compose.onNodeWithTag("details").performScrollTo().performClick()
        compose.waitForIdle()
        found += A11yContract.truncatedText(compose, "$name/details")
        found += A11yContract.violations(compose, "$name/details")
        shot("fixture-$name-details")
        device.pressBack()
        compose.waitForIdle()
        compose.onNodeWithContentDescription(context.getString(R.string.settings_title)).performScrollTo().performClick()
        compose.waitForIdle()
        found += A11yContract.truncatedText(compose, "$name/settings")
        found += A11yContract.violations(compose, "$name/settings")
        lines += if (found.isEmpty()) "no text cut off, every control ≥ 48 dp and labelled, every Home control reachable in ${DeviceFixtures.homeStates.size} Home states, sign-in, Details and Settings" else found.joinToString("\n")
        File(out, report).writeText(lines.joinToString("\n") + "\n")
        assertEquals(found.joinToString("\n"), 0, found.size)
    }
}

@RunWith(AndroidJUnit4::class)
class SmallScreenDeviceTest : ScreenShapeCheck(
    setUp = listOf("wm size 720x1280", "wm density 320"),
    tearDown = listOf("wm size reset", "wm density reset"),
) {
    @Test fun l2_smallPhoneKeepsEverythingReadableAndReachable() {
        assertEquals("small phone width", 360, compose.activity.resources.configuration.screenWidthDp)
        check("26-small-phone", "small-phone-report.txt")
    }
}
