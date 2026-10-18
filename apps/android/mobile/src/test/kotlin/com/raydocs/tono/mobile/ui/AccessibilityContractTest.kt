package com.raydocs.tono.mobile.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Density
import androidx.test.espresso.Espresso
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.Phase
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** JVM pass of the accessibility contract, so violations show up before an emulator run. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w411dp-h914dp-xxhdpi") // Pixel 6 class, like the CI emulator
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AccessibilityContractTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule val rules: RuleChain = RuleChain.outerRule(RegisterComponentActivity()).around(compose)

    private var snapshot by mutableStateOf<EngineSnapshot>(UiFixtures.idle)
    private val states = listOf(
        "idle" to UiFixtures.idle,
        "permission" to UiFixtures.idle.copy(phase = Phase.NEEDS_PERMISSION),
        "connecting" to UiFixtures.idle.copy(phase = Phase.CONNECTING),
        "connected" to UiFixtures.connected(),
        "degraded" to UiFixtures.degraded(),
        "failed" to UiFixtures.idle.copy(phase = Phase.FAILED, reasonCode = "HOME_UNAVAILABLE"),
        "signin" to UiFixtures.idle.copy(phase = Phase.SIGNED_OUT),
    )

    private fun show(fontScale: Float? = null) = compose.setContent {
        val base = LocalDensity.current
        CompositionLocalProvider(LocalReduceMotion provides true, LocalDensity provides Density(base.density, fontScale ?: base.fontScale)) {
            TonoTheme {
                TonoRoot(snapshot, object : TonoActions {
                    override fun connect() {}
                    override fun command(op: String, vararg args: Pair<String, Any?>) {}
                    override fun explain(host: String): Map<String, Any?>? = null
                })
            }
        }
    }

    private fun eachScreen(check: (String) -> List<String>): List<String> {
        val found = mutableListOf<String>()
        for ((name, s) in states) {
            snapshot = s
            compose.waitForIdle()
            found += check(name)
        }
        snapshot = UiFixtures.degraded()
        compose.waitForIdle()
        compose.onNodeWithTag("details").performClick()
        compose.waitForIdle()
        found += check("details")
        Espresso.pressBack()
        compose.waitForIdle()
        compose.onNodeWithContentDescription(RuntimeEnvironment.getApplication().getString(com.raydocs.tono.mobile.R.string.settings_title)).performClick()
        compose.waitForIdle()
        found += check("settings")
        return found
    }

    @Test fun everyActionableNodeIs48dpAndLabelled() {
        compose.enableAccessibilityChecks() // Accessibility Test Framework on every interaction
        show()
        val found = eachScreen { A11yContract.violations(compose, it) }
        assertEquals(found.joinToString("\n"), 0, found.size)
    }

    @Test fun doubleSizeTextIsNeverCutOff() {
        show(fontScale = 2f)
        val found = eachScreen { A11yContract.truncatedText(compose, it) }
        assertEquals(found.joinToString("\n"), 0, found.size)
    }
}
