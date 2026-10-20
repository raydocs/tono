package com.raydocs.tono.mobile.diagnostics

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.ui.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.ConcurrentLinkedQueue

/** Diagnostic only. The four variants may fail: record the distinction, never count it as acceptance. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class HomeStatePropagationProbe {
    private val compose = createAndroidComposeRule<ComponentActivity>()
    @get:Rule val rules: RuleChain = RuleChain.outerRule(RegisterComponentActivity()).around(compose)
    private val input = mutableStateOf(UiFixtures.idle)
    private var snapshot by input

    private fun probe(wrapper: Boolean, publish: Boolean) {
        val trace = ConcurrentLinkedQueue<String>()
        val observer = Snapshot.registerApplyObserver { changed, _ ->
            if (input in changed) trace.add("apply-notification input=${snapshot.phase}")
        }
        try {
            compose.setContent {
                val s = snapshot
                CompositionLocalProvider(LocalReduceMotion provides false) {
                    TonoTheme {
                        if (wrapper) TonoRoot(s, object : TonoActions {
                            override fun connect() {}
                            override fun command(op: String, vararg args: Pair<String, Any?>) {}
                            override fun explain(host: String): Map<String, Any?>? = null
                        }) else HomeScreen(s, {}, {}, {}, {}, {})
                        SideEffect { trace.add("entry-composed phase=${s.phase}") }
                    }
                }
            }
            compose.mainClock.autoAdvance = false
            fun str(id: Int) = compose.activity.getString(id)
            fun apply(s: com.raydocs.tono.mobile.engine.EngineSnapshot) {
                compose.runOnIdle {
                    snapshot = s
                    trace.add("input-written phase=${s.phase}")
                    if (publish) Snapshot.sendApplyNotifications()
                }
                compose.mainClock.advanceTimeByFrame()
                compose.mainClock.advanceTimeByFrame()
                val descriptions = compose.onAllNodes(
                    SemanticsMatcher.keyIsDefined(SemanticsProperties.StateDescription), useUnmergedTree = true,
                ).fetchSemanticsNodes().map { it.config[SemanticsProperties.StateDescription] }
                trace.add("after-two-ticks descriptions=$descriptions")
                println("PROPAGATION wrapper=$wrapper publish=$publish input=${s.phase}: ${trace.joinToString(" | ")}")
                trace.clear()
            }
            apply(UiFixtures.connected())
            compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, str(R.string.state_connected))).assertExists()
            compose.onNodeWithText(str(R.string.state_connected)).assertExists()
            compose.onNodeWithText(str(R.string.action_disconnect)).assertExists()
            compose.onAllNodesWithText(str(R.string.state_idle)).assertCountEquals(0)
            compose.onAllNodesWithText(str(R.string.action_connect)).assertCountEquals(0)
            apply(UiFixtures.idle)
            compose.onNode(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, str(R.string.state_idle))).assertExists()
            compose.onNodeWithText(str(R.string.action_connect)).assertExists()
            compose.onAllNodesWithText(str(R.string.action_disconnect)).assertCountEquals(0)
        } finally {
            observer.dispose()
            compose.mainClock.autoAdvance = true
        }
    }

    @Test fun directWithoutExplicitPublication() = probe(wrapper = false, publish = false)
    @Test fun directWithExplicitPublication() = probe(wrapper = false, publish = true)
    @Test fun wrapperWithoutExplicitPublication() = probe(wrapper = true, publish = false)
    @Test fun wrapperWithExplicitPublication() = probe(wrapper = true, publish = true)
}
