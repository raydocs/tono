package com.raydocs.tono.mobile.ui

import android.app.PendingIntent
import android.content.Intent
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.material3.Text
import com.github.takahirom.roborazzi.captureRoboImage
import com.github.takahirom.roborazzi.captureScreenRoboImage
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.raydocs.tono.mobile.R
import com.raydocs.tono.mobile.engine.LoginView
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.mobile.engine.TonoNotifications
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Identical fixture captures can be run on the base and candidate; no account or tunnel. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "en-w393dp-h852dp-xxhdpi")
class UiRevisionRender {
    private val compose = createAndroidComposeRule<ComponentActivity>()
    @get:Rule val rules: RuleChain = RuleChain.outerRule(RegisterComponentActivity()).around(compose)
    @Before fun gate() = assumeTrue(System.getProperty("tono.screenshots") == "true")

    private val actions = object : TonoActions {
        override fun connect() {}
        override fun command(op: String, vararg args: Pair<String, Any?>) {}
        override fun explain(host: String): Map<String, Any?>? = null
    }

    private fun show(content: @Composable () -> Unit) = compose.setContent {
        CompositionLocalProvider(LocalReduceMotion provides true) {
            TonoTheme {
                Box(Modifier.fillMaxSize()) {
                    content()
                    Text("FIXTURE · no tunnel", color = TonoColors.TextPrimary, modifier = Modifier.align(Alignment.TopCenter))
                }
            }
        }
    }

    @OptIn(ExperimentalRoborazziApi::class)
    private fun shot(item: String) {
        compose.waitForIdle()
        captureScreenRoboImage("build/r2ui/r2ui-$item.png")
    }

    @Test fun item1Sheets() {
        show { TonoRoot(UiFixtures.degraded(), actions) }
        compose.onNodeWithTag("details").performClick()
        shot("1")
    }

    @Test fun item2ImmediateLabels() {
        show { HomeScreen(UiFixtures.idle, {}, {}, {}, {}, {}) }
        shot("2")
    }

    @Test fun item3LargeText() {
        RuntimeEnvironment.setFontScale(2f)
        show { TonoRoot(UiFixtures.connected(), actions) }
        shot("3")
        compose.onNodeWithTag("details").performScrollTo().performClick()
        shot("3-details")
    }

    @Test fun item4ConnectingSweep() {
        show { HomeScreen(UiFixtures.idle.copy(phase = Phase.CONNECTING), {}, {}, {}, {}, {}) }
        shot("4")
    }

    @Test fun item5FieldError() {
        show { SignInScreen(LoginView(errorCode = "INVALID_EMAIL"), {}, {}, {}) }
        shot("5")
    }

    @Test fun item6LinesOverHome() {
        show { TonoRoot(UiFixtures.connected(), actions) }
        compose.onNodeWithTag("exit").performClick()
        shot("6")
    }

    @Test fun item7ConnectingNotification() {
        val app = compose.activity
        val pi = PendingIntent.getActivity(app, 0, Intent(), PendingIntent.FLAG_IMMUTABLE)
        val notification = TonoNotifications.ongoing(app, UiFixtures.idle.copy(phase = Phase.CONNECTING), pi, pi)
        val host = FrameLayout(app)
        val view = android.app.Notification.Builder.recoverBuilder(app, notification).createBigContentView().apply(app, host)
        host.addView(view)
        app.setContentView(host)
        view.captureRoboImage("build/r2ui/r2ui-7.png")
    }

    @Test fun item8NeutralSettings() {
        show { SettingsScreen(UiFixtures.idle, {}, {}, {}, {}) }
        compose.onNodeWithText(compose.activity.getString(R.string.system_verify_in_android)).performScrollTo()
        shot("8")
    }

    private fun openSettings() {
        show { TonoRoot(UiFixtures.idle.copy(excludedPackages = listOf("com.example.bank")), actions) }
        compose.onNodeWithContentDescription(compose.activity.getString(R.string.settings_title)).performClick()
        compose.waitForIdle()
    }

    @Test fun item9SettingsFirstScreen() {
        openSettings()
        shot("9-settings")
    }

    @Test fun item9SettingsFirstScreenLargeText() {
        RuntimeEnvironment.setFontScale(2f)
        openSettings()
        shot("9-settings-font-200")
    }

    @Test fun item10RoutingRules() {
        openSettings()
        compose.onNodeWithText(compose.activity.getString(R.string.settings_routing_rules)).performClick()
        shot("10-routing-rules")
    }

    @Test fun item11SignOutConfirm() {
        openSettings()
        compose.onNodeWithText(compose.activity.getString(R.string.settings_sign_out)).performScrollTo().performClick()
        shot("11-sign-out-confirm")
    }

    @Test fun item12DetailsPickerAndRouteCheck() {
        show { TonoRoot(UiFixtures.connected(), actions) }
        compose.onNodeWithTag("details").performClick()
        shot("12-details-mode-and-check")
    }
}
