package com.raydocs.tono.mobile.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.Phase
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Home interaction contract, on the JVM (Robolectric) — not a device. One primary control whose
 * action follows the engine phase; cancel exists while connecting; nothing explanatory on the first
 * screen; Details is one tap away.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class HomeInteractionTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule val rules: RuleChain = RuleChain.outerRule(RegisterComponentActivity()).around(compose)

    private val calls = mutableListOf<String>()
    private var snapshot by mutableStateOf(UiFixtures.idle)

    private fun str(id: Int, vararg args: Any) = compose.activity.getString(id, *args)

    private fun show() {
        compose.setContent {
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
    }



    private fun labelFor(p: Phase) = str(
        when (primaryActionFor(p)) {
            PrimaryAction.CONNECT -> R.string.action_connect
            PrimaryAction.RETRY -> R.string.action_retry
            PrimaryAction.ALLOW -> R.string.action_allow_vpn
            PrimaryAction.CANCEL -> R.string.action_cancel
            PrimaryAction.DISCONNECT -> R.string.action_disconnect
            PrimaryAction.WAIT -> R.string.action_disconnecting
        },
    )

    private fun tapPrimaryIn(s: EngineSnapshot): String? {
        snapshot = s
        compose.waitForIdle()
        calls.clear()
        compose.onNode(hasTestTag("primary").and(hasAnyDescendant(hasText(labelFor(s.phase)))), useUnmergedTree = true).performClick()
        compose.waitForIdle()
        return calls.singleOrNull()
    }

    @Test fun primaryControlFollowsThePhase() {
        show()
        assertEquals("connect", tapPrimaryIn(UiFixtures.idle))
        assertEquals("disconnect", tapPrimaryIn(UiFixtures.idle.copy(phase = Phase.PREPARING)))   // cancel
        assertEquals("disconnect", tapPrimaryIn(UiFixtures.idle.copy(phase = Phase.CONNECTING)))  // cancel
        assertEquals("disconnect", tapPrimaryIn(UiFixtures.connected()))
        assertEquals("disconnect", tapPrimaryIn(UiFixtures.degraded()))
        assertEquals("connect", tapPrimaryIn(UiFixtures.idle.copy(phase = Phase.FAILED, reasonCode = "NETWORK")))   // retry
        assertEquals("connect", tapPrimaryIn(UiFixtures.idle.copy(phase = Phase.NEEDS_PERMISSION, reasonCode = "DENIED")))
    }

    @Test fun primaryIsAButtonWithStateAndIsDisabledWhileDisconnecting() {
        show()
        snapshot = UiFixtures.idle.copy(phase = Phase.CONNECTING)
        compose.waitForIdle()
        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button).and(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, str(R.string.state_connecting))))
            .assertIsEnabled()
            .assert(SemanticsMatcher("cancel click label") { it.config.getOrNull(androidx.compose.ui.semantics.SemanticsActions.OnClick)?.label == str(R.string.a11y_cancel_connect) })
        snapshot = UiFixtures.idle.copy(phase = Phase.DISCONNECTING)
        compose.waitForIdle()
        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, str(R.string.state_disconnecting))).assertIsNotEnabled()
    }

    @Test fun firstScreenStaysShortAndDetailsHoldTheExplanation() {
        show()
        snapshot = UiFixtures.degraded()
        compose.waitForIdle()
        // Short reason on home, full reason and the route lanes only in Details.
        compose.onNodeWithText(str(R.string.short_HOME_UNREACHABLE)).assertExists()
        compose.onAllNodesWithText(str(R.string.reason_HOME_UNREACHABLE)).assertCountEquals(0)
        compose.onAllNodesWithText(str(R.string.lane_video)).assertCountEquals(0)
        compose.onNodeWithTag("details").performClick()
        compose.waitForIdle()
        compose.onNodeWithText(str(R.string.reason_HOME_UNREACHABLE)).assertExists()
        compose.onNodeWithText(str(R.string.lane_video)).assertExists()
        compose.onNodeWithText(str(R.string.action_recheck)).performClick()
        assertEquals(listOf("recheck"), calls)
    }

    @Test fun connectedLineShowsTheVerifiedExits() {
        show()
        snapshot = UiFixtures.connected()
        compose.waitForIdle()
        compose.onNodeWithText(str(R.string.status_exit_both, "Japan", "United States")).assertExists()
    }
}
