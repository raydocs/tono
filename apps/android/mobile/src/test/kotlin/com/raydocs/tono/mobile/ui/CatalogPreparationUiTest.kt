package com.raydocs.tono.mobile.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.engine.CatalogPreparation
import com.raydocs.tono.mobile.engine.Phase
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "en")
class CatalogPreparationUiTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()
    @get:Rule val rules: RuleChain = RuleChain.outerRule(RegisterComponentActivity()).around(compose)

    @Test fun preparationShowsWaitAndCancelWithoutClaimingAConnectedTunnel() {
        var snapshot by mutableStateOf(UiFixtures.idle.copy(phase = Phase.PREPARING, reasonCode = CatalogPreparation.PENDING_CODE))
        val calls = mutableListOf<String>()
        compose.setContent {
            CompositionLocalProvider(LocalReduceMotion provides true) {
                TonoTheme {
                    TonoRoot(snapshot, object : TonoActions {
                        override fun connect() { calls.add("connect") }
                        override fun command(op: String, vararg args: Pair<String, Any?>) { calls.add(op) }
                        override fun explain(host: String): Map<String, Any?>? = null
                    })
                }
            }
        }
        compose.onNodeWithText(compose.activity.getString(R.string.short_EXIT_IDENTITY_PROPAGATING)).assertExists()
        compose.onAllNodesWithText(compose.activity.getString(R.string.state_connected)).assertCountEquals(0)
        compose.onNodeWithTag("primary").assertIsEnabled().performClick()
        assertEquals(listOf("disconnect"), calls)

        snapshot = snapshot.copy(phase = Phase.FAILED, reasonCode = CatalogPreparation.TIMEOUT_CODE)
        compose.waitForIdle()
        compose.onNodeWithText(compose.activity.getString(R.string.short_EXIT_IDENTITY_PREPARATION_TIMEOUT)).assertExists()
        compose.onNodeWithTag("primary").assertIsEnabled().performClick()
        assertEquals(listOf("disconnect", "connect"), calls)
        compose.onNodeWithTag("details").performClick()
        compose.onNodeWithText(compose.activity.getString(R.string.reason_EXIT_IDENTITY_PREPARATION_TIMEOUT)).assertExists()
    }
}
