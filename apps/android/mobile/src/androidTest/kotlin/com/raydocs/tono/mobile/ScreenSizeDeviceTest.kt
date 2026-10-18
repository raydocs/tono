package com.raydocs.tono.mobile

import android.app.UiAutomation
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ActivityScenario
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
 * Screen shapes other than the CI phone, on the real system: a small phone (360 × 640 dp) and the CI
 * phone turned to landscape. Fixture snapshots; in every Home state and in Details and Settings no
 * text may be cut off, every control keeps the accessibility contract, and every Home control can be
 * brought on screen.
 */
abstract class ScreenShapeCheck {
    protected val instrumentation = InstrumentationRegistry.getInstrumentation()
    protected val context = instrumentation.targetContext
    protected val device: UiDevice = UiDevice.getInstance(instrumentation)
    protected val out = File(context.getExternalFilesDir(null), "evidence").apply { mkdirs() }

    protected abstract val compose: ComposeTestRule
    protected abstract fun activity(): ComponentActivity
    protected abstract fun setContent(content: @Composable () -> Unit)

    protected fun shell(cmd: String): String =
        ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand(cmd)).bufferedReader().readText()

    private var snapshot by mutableStateOf<EngineSnapshot>(DeviceFixtures.idle)

    private fun set(s: EngineSnapshot) { snapshot = s; compose.waitForIdle() }
    private fun shot(name: String) {
        compose.waitForIdle(); Thread.sleep(400); assertTrue("screenshot $name drawn", Captures.drawn(File(out, "$name.png")))
        if (name.startsWith("fixture-")) assertTrue("$name shows the FIXTURE mark", Captures.fixtureMarked(File(out, "$name.png")))
    }

    protected fun check(name: String, report: String, notes: List<String> = emptyList()) {
        setContent {
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
        val lines = notes.toMutableList()
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
        val config = activity().resources.configuration
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
class SmallScreenDeviceTest : ScreenShapeCheck() {
    private val shape = object : ExternalResource() {
        override fun before() { shell("wm size 720x1280"); shell("wm density 320"); Thread.sleep(2_000) }
        override fun after() { shell("wm size reset"); shell("wm density reset"); Thread.sleep(1_000) }
    }
    private val rule = createAndroidComposeRule<ComponentActivity>()
    @get:Rule val rules: RuleChain = RuleChain.outerRule(shape).around(rule)
    override val compose: ComposeTestRule get() = rule
    override fun activity(): ComponentActivity = rule.activity
    override fun setContent(content: @Composable () -> Unit) = rule.setContent(content)

    @Test fun l2_smallPhoneKeepsEverythingReadableAndReachable() {
        assertEquals("small phone width", 360, rule.activity.resources.configuration.screenWidthDp)
        check("26-small-phone", "small-phone-report.txt")
    }
}

/**
 * The phone turned to landscape while Tono's window is in front, as a user turns it. Rotating first
 * and launching after left the activity in portrait on the CI image (runs 39115256726 and
 * 39120135343; logcat shows a fixed-rotation launch). The likely cause is the portrait-only launcher
 * being in front when the rotation was asked for. The window
 * is rotated with the content not yet set, since rotation recreates the activity; content goes onto
 * the recreated one. If the system rotation does not turn the display, the activity asks for
 * landscape itself, and the report says which of the two happened.
 */
@RunWith(AndroidJUnit4::class)
class LandscapeDeviceTest : ScreenShapeCheck() {
    private val rule = createEmptyComposeRule()
    @get:Rule val rules: ComposeTestRule = rule
    private lateinit var scenario: ActivityScenario<ComponentActivity>
    override val compose: ComposeTestRule get() = rule
    override fun activity(): ComponentActivity {
        var current: ComponentActivity? = null
        scenario.onActivity { current = it }
        return current!!
    }
    override fun setContent(content: @Composable () -> Unit) { scenario.onActivity { it.setContent(content = content) }; rule.waitForIdle() }

    private fun landscape() = activity().resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
    private fun waitForLandscape(timeoutMs: Long): Boolean {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        while (SystemClock.elapsedRealtime() < deadline) { if (landscape()) return true; Thread.sleep(250) }
        return landscape()
    }
    private fun rotationState() = shell("dumpsys window displays").lines()
        .filter { it.contains("mRotation=") || it.contains("mUserRotation") || it.contains("mFixedToUserRotation") || it.contains("mIgnoreOrientationRequest") }
        .joinToString(" | ") { it.trim() }.take(600)

    @Test fun l3_landscapeKeepsEverythingReadableAndReachable() {
        val notes = mutableListOf<String>()
        scenario = ActivityScenario.launch(ComponentActivity::class.java)
        try {
            notes += "before: ${if (landscape()) "landscape" else "portrait"}; ${rotationState()}"
            instrumentation.uiAutomation.setRotation(UiAutomation.ROTATION_FREEZE_90)
            val turned = waitForLandscape(15_000)
            notes += "system rotation (UiAutomation.setRotation 90, Tono's window in front): " +
                if (turned) "display turned, window landscape" else "display stayed portrait; ${rotationState()}"
            if (!turned) {
                scenario.onActivity { it.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }
                val forced = waitForLandscape(15_000)
                notes += "the activity asked for landscape: ${if (forced) "window landscape" else "still portrait; ${rotationState()}"}"
                File(out, "landscape-report.txt").writeText(notes.joinToString("\n") + "\n")
                assertTrue("landscape reached: $notes", forced)
            }
            Thread.sleep(1_000)
            check("27-landscape", "landscape-report.txt", notes)
        } finally {
            instrumentation.uiAutomation.setRotation(UiAutomation.ROTATION_FREEZE_0)
            instrumentation.uiAutomation.setRotation(UiAutomation.ROTATION_UNFREEZE)
            scenario.close()
        }
    }
}
