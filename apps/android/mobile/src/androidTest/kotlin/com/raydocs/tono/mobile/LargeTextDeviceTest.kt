package com.raydocs.tono.mobile

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.unit.dp
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
        reachInDetails(context, "14b-font-2.0-details-scrolled")
        device.pressBack()
        compose.waitForIdle()
        compose.onNodeWithContentDescription(context.getString(R.string.settings_title)).performClick()
        compose.waitForIdle()
        cut += A11yContract.truncatedText(compose, "settings")
        shot("fixture-15-font-2.0-settings")
        cut += reachInSettings(context, "15")
        File(out, "font-2.0-report.txt").writeText(
            if (cut.isEmpty()) "font_scale 2.0: no text ellipsized or clipped in ${DeviceFixtures.homeStates.size} home states, sign-in, details, routing rules, sign-out confirmation and settings; mode picker, route check, sign out and colophon reached by scrolling"
            else cut.joinToString("\n"),
        )
        assertEquals(cut.joinToString("\n"), 0, cut.size)
    }

    /** The Simplified Chinese copy at the same size, on Settings, its rules screen, the confirmation and Details. */
    @Test fun l4_largestTextInSimplifiedChineseIsNeverCutOff() {
        assertEquals("system font scale", 2f, compose.activity.resources.configuration.fontScale, 0.01f)
        val zh = java.util.Locale.SIMPLIFIED_CHINESE
        compose.setContent {
            val base = androidx.compose.ui.platform.LocalContext.current
            val conf = android.content.res.Configuration(androidx.compose.ui.platform.LocalConfiguration.current).apply { setLocale(zh) }
            val ctx = base.createConfigurationContext(conf)
            CompositionLocalProvider(
                LocalReduceMotion provides true,
                androidx.compose.ui.platform.LocalContext provides ctx,
                androidx.compose.ui.platform.LocalConfiguration provides conf,
                androidx.compose.ui.platform.LocalResources provides ctx.resources,
            ) {
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
        val zhContext = context.createConfigurationContext(android.content.res.Configuration(context.resources.configuration).apply { setLocale(zh) })
        val cut = mutableListOf<String>()
        set(DeviceFixtures.degraded())
        compose.onNodeWithTag("details").performClick()
        compose.waitForIdle()
        cut += A11yContract.truncatedText(compose, "zh details")
        shot("fixture-33-font-2.0-zh-details")
        reachInDetails(zhContext, "33b-font-2.0-zh-details-scrolled")
        device.pressBack()
        compose.waitForIdle()
        compose.onNodeWithContentDescription(zhContext.getString(R.string.settings_title)).performClick()
        compose.waitForIdle()
        cut += A11yContract.truncatedText(compose, "zh settings")
        shot("fixture-34-font-2.0-zh-settings")
        cut += reachInSettings(zhContext, "34")
        assertEquals(cut.joinToString("\n"), 0, cut.size)
    }

    /**
     * In the Details sheet the mode picker and the route check sit under the lanes; at 200 % they start
     * below the fold and must come on screen by the sheet's own scroll, both segments and the field whole.
     */
    private fun reachInDetails(strings: android.content.Context, name: String) {
        compose.onNodeWithTag("routeCheckHost").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(strings.getString(R.string.mode_three_tier_short)).assertIsDisplayed()
        compose.onNodeWithText(strings.getString(R.string.mode_stable_short)).assertIsDisplayed()
        shot("fixture-$name")
    }

    /**
     * From the Settings first screen: the rules screen and the confirmation keep every line whole, and
     * Sign out and the colophon come on screen by scrolling, above the navigation bar. Captures `<n>b`
     * (scrolled to the end), `<n>c` (confirmation) and `<n>d` (rules); returns the truncated lines found.
     */
    private fun reachInSettings(strings: android.content.Context, n: String): List<String> {
        val cut = mutableListOf<String>()
        compose.onNodeWithText(strings.getString(R.string.settings_routing_rules)).performClick()
        compose.waitForIdle()
        cut += A11yContract.truncatedText(compose, "$n routing rules")
        shot("fixture-${n}d-font-2.0-routing-rules")
        device.pressBack()
        compose.waitForIdle()
        // To the very end of the list, not just until the colophon peeks in: the last line must then sit
        // above the 24 dp fade and the navigation bar, as the list's own bottom padding promises.
        compose.onNodeWithTag("settingsScroll").performSemanticsAction(SemanticsActions.ScrollBy) { it(0f, 100_000f) }
        compose.waitForIdle()
        val colophon = compose.onNodeWithText(strings.getString(R.string.about_core, com.raydocs.tono.mobile.BuildConfig.SING_BOX_VERSION).replace("/", "/\u2060")).assertIsDisplayed()
        compose.onNodeWithText(strings.getString(R.string.settings_sign_out)).assertIsDisplayed()
        val colophonBottom = colophon.fetchSemanticsNode().boundsInWindow.bottom
        val navBar = androidx.core.view.ViewCompat.getRootWindowInsets(compose.activity.window.decorView)?.getInsets(androidx.core.view.WindowInsetsCompat.Type.navigationBars())?.bottom ?: 0
        val fadeTop = device.displayHeight - navBar - with(compose.density) { 24.dp.toPx() }
        assertTrue("colophon ends at $colophonBottom px, above the scroll-edge fade at $fadeTop px", colophonBottom <= fadeTop)
        shot("fixture-${n}b-font-2.0-settings-end")
        compose.onNodeWithText(strings.getString(R.string.settings_sign_out)).performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("signOutConfirm").assertIsDisplayed()
        cut += A11yContract.truncatedText(compose, "$n sign-out confirmation")
        shot("fixture-${n}c-font-2.0-sign-out-confirm")
        device.pressBack()
        compose.waitForIdle()
        return cut
    }
}
