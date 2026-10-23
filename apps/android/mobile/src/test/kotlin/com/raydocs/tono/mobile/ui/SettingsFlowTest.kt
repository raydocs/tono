package com.raydocs.tono.mobile.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodes
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.espresso.Espresso
import com.raydocs.tono.mobile.R
import com.raydocs.tono.routing.RoutingMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Settings flow contract, on the JVM (Robolectric), not a device. The first screen holds what you set
 * and who you are; the mode picker and the route check live in Details; the rules are explained on
 * one second-level screen; signing out asks first.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SettingsFlowTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule val rules: RuleChain = RuleChain.outerRule(RegisterComponentActivity()).around(compose)

    private val calls = mutableListOf<String>()
    private val explained = mutableListOf<String>()
    private var snapshot by mutableStateOf(UiFixtures.idle)

    private fun str(id: Int) = compose.activity.getString(id)

    private fun show() = compose.setContent {
        CompositionLocalProvider(LocalReduceMotion provides true) {
            TonoTheme {
                TonoRoot(snapshot, object : TonoActions {
                    override fun connect() { calls += "connect" }
                    override fun command(op: String, vararg args: Pair<String, Any?>) { calls += op + args.joinToString("") { ":${it.second}" } }
                    override fun explain(host: String): Map<String, Any?>? { explained += host; return mapOf("tcp" to "HOME", "udp" to "BLOCKED") }
                })
            }
        }
    }

    private fun openSettings() {
        compose.onNodeWithContentDescription(str(R.string.settings_title)).performClick()
        compose.waitForIdle()
    }

    @Test fun firstScreenOpensOnProtectionAndHoldsNoPickerOrRouteCheck() {
        show()
        openSettings()
        // The first row a reader reaches is the way out to Android's VPN settings, with its honest state under it.
        val rows = compose.onAllNodes(hasClickAction()).fetchSemanticsNodes()
            .mapNotNull { n -> n.config.getOrNull(SemanticsProperties.Text)?.joinToString(" ") { it.text } }
        assertEquals(str(R.string.system_open), rows.first())
        compose.onNodeWithText(str(R.string.system_verify_in_android)).assertExists()
        // Neither mode radio nor the route-check field is on the first screen any more.
        compose.onAllNodesWithText(str(R.string.mode_three_tier)).assertCountEquals(0)
        compose.onAllNodesWithText(str(R.string.check_hint)).assertCountEquals(0)
        compose.onAllNodesWithText(str(R.string.routing_scope)).assertCountEquals(0)
        // The mode and the bypass count read as values on their rows.
        compose.onNodeWithText(str(R.string.mode_three_tier_short)).assertExists()
        compose.onNodeWithText(str(R.string.settings_apps_none)).assertExists()
    }

    @Test fun routingRulesOpenOnceAndBackReturnsToSettings() {
        show()
        openSettings()
        compose.onNodeWithText(str(R.string.settings_routing_rules)).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(str(R.string.routing_scope)).assertExists()
        compose.onNodeWithText(str(R.string.routing_platform)).assertExists()
        compose.onNodeWithText(str(R.string.mode_selected)).assertExists()
        compose.onNodeWithText(str(R.string.settings_mode_where)).assertExists()
        Espresso.pressBack()
        compose.waitForIdle()
        compose.onNodeWithText(str(R.string.settings_title)).assertExists()
        compose.onAllNodesWithText(str(R.string.routing_scope)).assertCountEquals(0)
    }

    @Test fun signOutAsksFirstAndOnlyTheConfirmationSignsOut() {
        show()
        openSettings()
        compose.onNodeWithText(str(R.string.settings_sign_out)).performScrollTo().performClick()
        compose.waitForIdle()
        compose.onNodeWithText(str(R.string.sign_out_title)).assertExists()
        compose.onNodeWithText(str(R.string.action_cancel)).performClick()
        compose.waitForIdle()
        compose.onAllNodesWithText(str(R.string.sign_out_title)).assertCountEquals(0)
        assertFalse("cancel signs nobody out: $calls", calls.any { it.startsWith("signOut") })
        compose.onNodeWithText(str(R.string.settings_sign_out)).performScrollTo().performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("signOutConfirm").performClick()
        compose.waitForIdle()
        assertEquals(listOf("signOut"), calls)
    }

    @Test fun modeIsChosenInDetailsAndTheRouteCheckAnswersThere() {
        snapshot = UiFixtures.connected()
        show()
        compose.onNodeWithTag("details").performClick()
        compose.waitForIdle()
        compose.onNodeWithText(str(R.string.mode_stable_short)).performClick()
        compose.waitForIdle()
        assertEquals(listOf("setMode:${RoutingMode.STABLE.name}"), calls)
        compose.onNodeWithTag("routeCheckHost").performTextInput("claude.ai")
        compose.onNodeWithText(str(R.string.check_go)).performClick()
        val verdict = compose.activity.getString(R.string.check_result, str(R.string.verdict_HOME), str(R.string.verdict_BLOCKED))
        compose.waitUntil(5_000) { compose.onAllNodesWithText(verdict).fetchSemanticsNodes().isNotEmpty() }
        assertEquals(listOf("claude.ai"), explained)
        assertTrue("Details keeps no row that sends the mode to Settings", compose.onAllNodesWithText(str(R.string.settings_title)).fetchSemanticsNodes().isEmpty())
    }
}
