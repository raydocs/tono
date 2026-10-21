package com.raydocs.tono.mobile.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.RoborazziOptions
import com.github.takahirom.roborazzi.captureRoboImage
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.HomeKind
import com.raydocs.tono.mobile.engine.LoginView
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.mobile.engine.ExitProbe
import com.raydocs.tono.mobile.engine.ProbeState
import com.raydocs.tono.routing.RoutingMode
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Renders each user-visible state for visual review on the JVM (Robolectric native graphics) — not a
 * device or emulator. Opt-in:
 * `./gradlew :android:mobile:testDebugUnitTest -Ptono.screenshots --tests '*ScreenshotRender*'`.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "zh-rCN-w393dp-h852dp-xxhdpi")
class ScreenshotRender {
    @Before fun gate() = assumeTrue(System.getProperty("tono.screenshots") == "true")

    private val base = UiFixtures.idle

    private fun shot(name: String, content: @Composable () -> Unit) = captureRoboImage(
        filePath = "build/screenshots/$name.png",
        roborazziOptions = RoborazziOptions(),
    ) { CompositionLocalProvider(LocalReduceMotion provides true) { TonoTheme(content) } }

    private fun home(name: String, s: EngineSnapshot) = shot(name) { HomeScreen(s, {}, {}, {}, {}, {}) }

    private fun sheet(name: String, content: @Composable () -> Unit) = shot(name) {
        Box(Modifier.fillMaxSize().background(TonoColors.NightDeep), contentAlignment = Alignment.BottomCenter) {
            Box(Modifier.clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(TonoColors.Smoke).padding(top = 24.dp)) { content() }
        }
    }

    @Test fun signInEmail() = shot("01-signin-email") { SignInScreen(LoginView(), {}, {}, {}) }
    @Test fun signInCode() = shot("02-signin-code") { SignInScreen(LoginView("tester@example.com", "ch", false, "INVALID_OR_EXPIRED_CODE"), {}, {}, {}) }
    @Test fun idle() = home("03-home-idle", base)
    @Test fun connecting() = home("04-home-connecting-cancelable", base.copy(phase = Phase.CONNECTING))
    @Test fun connected() = home("05-home-connected", UiFixtures.connected())
    @Test fun degraded() = home("06-home-degraded-home-down", UiFixtures.degraded())
    @Test fun failed() = home("07-home-failed-home-unavailable", base.copy(phase = Phase.FAILED, reasonCode = "CATALOG_UNAVAILABLE"))
    @Test fun permission() = home("08-home-needs-permission", base.copy(phase = Phase.NEEDS_PERMISSION, reasonCode = "DENIED"))
    @Test fun stableNoHome() = home(
        "09-home-connected-stable-no-home",
        UiFixtures.connected(System.currentTimeMillis()).copy(mode = RoutingMode.STABLE, homeKind = HomeKind.NONE, homeProbe = ExitProbe(), usingCachedCatalog = true),
    )
    @Test fun disconnecting() = home("10-home-disconnecting", base.copy(phase = Phase.DISCONNECTING))
    @Test fun details() = sheet("11-details-degraded") { DetailsContent(UiFixtures.degraded(), {}, {}, {}) }
    @Test fun lines() = sheet("12-lines-sheet") { LinesContent(base, zh = true, onSelect = {}, onTest = {}) }
    @Test fun consent() = sheet("15-consent-explainer") { ConsentContent({}, {}) }
    @Test fun settings() = shot("13-settings") { SettingsScreen(base.copy(excludedPackages = listOf("com.example.bank")), {}, {}, {}, { null }, {}) }
    @Test fun largeText() {
        RuntimeEnvironment.setFontScale(1.3f)
        home("14-home-connected-font-130", UiFixtures.connected())
    }
}
