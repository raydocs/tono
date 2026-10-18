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
    private var link by mutableStateOf(EngineLink.LIVE)

    private fun str(id: Int, vararg args: Any) = compose.activity.getString(id, *args)

    private fun show(locale: java.util.Locale? = null) {
        compose.setContent {
            val conf = android.content.res.Configuration(androidx.compose.ui.platform.LocalConfiguration.current).apply { if (locale != null) setLocale(locale) }
            val base = androidx.compose.ui.platform.LocalContext.current
            val ctx = if (locale != null) base.createConfigurationContext(conf) else base
            CompositionLocalProvider(
                LocalReduceMotion provides true,
                androidx.compose.ui.platform.LocalContext provides ctx,
                androidx.compose.ui.platform.LocalResources provides ctx.resources,
            ) {
                TonoTheme {
                    TonoRoot(snapshot, object : TonoActions {
                        override fun connect() { calls += "connect" }
                        override fun command(op: String, vararg args: Pair<String, Any?>) { calls += op }
                        override fun explain(host: String): Map<String, Any?>? = null
                    }, link)
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

    /** A stopped hop is "paused" everywhere it is mentioned: the one-line status and its explanation in Details. */
    @Test fun shortStatusAndItsExplanationNameTheStopTheSameWay() {
        for ((locale, word) in listOf(java.util.Locale.ENGLISH to "paused", java.util.Locale.SIMPLIFIED_CHINESE to "暂停")) {
            val conf = android.content.res.Configuration(compose.activity.resources.configuration).apply { setLocale(locale) }
            val res = compose.activity.createConfigurationContext(conf).resources
            for (id in listOf(R.string.short_HOME_UNREACHABLE, R.string.reason_HOME_UNREACHABLE, R.string.short_CLOUD_UNREACHABLE, R.string.reason_CLOUD_UNREACHABLE)) {
                val text = res.getString(id)
                org.junit.Assert.assertTrue("$locale: \"$text\" says \"$word\"", text.contains(word))
            }
        }
    }

    @Test fun connectedLineShowsTheVerifiedExits() {
        show()
        snapshot = UiFixtures.connected()
        compose.waitForIdle()
        compose.onNodeWithText(str(R.string.status_exit_both, "Japan", "United States")).assertExists()
    }

    @Test fun exitCountriesFollowTheAppLanguageNotTheProcessDefault() {
        java.util.Locale.setDefault(java.util.Locale.US)
        show(java.util.Locale.SIMPLIFIED_CHINESE)
        snapshot = UiFixtures.connected()
        compose.waitForIdle()
        compose.onNode(hasText("日本", substring = true)).assertExists()
        // Details is a bottom sheet in its own window, which re-provides the activity's configuration.
        compose.onNodeWithTag("details").performClick()
        compose.waitForIdle()
        compose.onAllNodes(hasText("日本", substring = true)).fetchSemanticsNodes().let { assertEquals("日本 on Home and in Details", true, it.size >= 2) }
        compose.onAllNodes(hasText("Japan", substring = true)).assertCountEquals(0)
    }

    @Test fun fadingTimerKeepsTheLastElapsedTimeWhenDisconnected() {
        compose.mainClock.autoAdvance = false
        show()
        snapshot = UiFixtures.connected()
        compose.mainClock.advanceTimeBy(1_000)
        snapshot = UiFixtures.idle // the engine clears connectedSinceMs together with the phase
        val hugeElapsed = Regex("""\d{3,}:\d{2}:\d{2}""")
        val shown = SemanticsMatcher("elapsed time in the hundreds of hours") { n ->
            (n.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty() + n.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text })
                .any { hugeElapsed.containsMatchIn(it) }
        }
        repeat(8) {
            compose.mainClock.advanceTimeByFrame()
            compose.onAllNodes(shown, useUnmergedTree = true).assertCountEquals(0)
        }
    }

    /**
     * The engine's process can die with a tunnel up (and the tunnel with it). Until a running engine
     * speaks again, Home must not keep its last "Connected": no state word, sun timer, speed or Details.
     */
    @Test fun lastWordFromALostEngineIsNotShownAsCurrent() {
        snapshot = UiFixtures.connected()
        show()
        val connected = str(R.string.state_connected)
        val unknown = str(R.string.surface_unknown)
        compose.onNodeWithText(connected).assertExists()
        compose.onNodeWithTag("details").performClick()
        compose.onNodeWithText(str(R.string.lane_video)).assertExists()

        link = EngineLink.LOST
        compose.waitForIdle()
        compose.onAllNodesWithText(connected).assertCountEquals(0)
        compose.onAllNodes(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, connected)).assertCountEquals(0)
        compose.onNodeWithText(unknown).assertExists()
        compose.onNodeWithText(str(R.string.engine_lost)).assertExists()
        compose.onAllNodesWithText(str(R.string.lane_video)).assertCountEquals(0)
        compose.onAllNodesWithText(str(R.string.speed_line, Format.rate(2_340_000), Format.rate(81_000))).assertCountEquals(0)
        compose.onAllNodes(SemanticsMatcher("connected timer") { n -> n.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty().any { it.startsWith(str(R.string.a11y_connected_for, "").trim()) } }).assertCountEquals(0)
        // Stopping still works: the client sends it to the engine's service without the binder.
        compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, unknown)).assertExists()
        compose.onNodeWithText(str(R.string.action_disconnect)).performClick()
        assertEquals(listOf("disconnect"), calls.filter { it == "disconnect" })

        link = EngineLink.WAITING
        compose.waitForIdle()
        compose.onAllNodesWithText(connected).assertCountEquals(0)
        compose.onNodeWithText(str(R.string.engine_waiting)).assertExists()

        // The restarted engine's first word is the current state, whatever it is.
        snapshot = UiFixtures.idle
        link = EngineLink.LIVE
        compose.waitForIdle()
        compose.onNodeWithText(str(R.string.state_idle)).assertExists()
        compose.onAllNodesWithText(unknown).assertCountEquals(0)
    }

    @Test fun unconfirmedPrimaryStopsAfterATunnelPhaseAndConnectsOtherwise() {
        link = EngineLink.LOST
        show()
        for (p in Phase.entries.filter { it != Phase.SIGNED_OUT }) {
            snapshot = UiFixtures.connected().copy(phase = p)
            compose.waitForIdle()
            val tunnel = p in setOf(Phase.PREPARING, Phase.CONNECTING, Phase.CONNECTED, Phase.DEGRADED, Phase.DISCONNECTING)
            val expected = str(if (tunnel) R.string.action_disconnect else R.string.action_connect)
            compose.onNodeWithTag("primary").assert(hasAnyDescendant(hasText(expected)))
            compose.onAllNodesWithText(str(R.string.surface_unknown)).assertCountEquals(1)
        }
    }
}
