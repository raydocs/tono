package com.raydocs.tono.mobile.ui

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import android.graphics.BitmapFactory
import com.github.takahirom.roborazzi.captureRoboImage
import com.raydocs.tono.mobile.engine.Phase
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "zh-rCN-w393dp-h852dp-xxhdpi")
class GlassRegionTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()
    @get:Rule val rules: RuleChain = RuleChain.outerRule(RegisterComponentActivity()).around(compose)

    @Test fun topRightContainsOnlyTheSceneNotAGhostDetailsPill() {
        var home by mutableStateOf(true)
        compose.setContent {
            CompositionLocalProvider(LocalReduceMotion provides true) {
                TonoTheme {
                    if (home) HomeScreen(UiFixtures.idle.copy(phase = Phase.FAILED), {}, {}, {}, {}, {})
                    else SeaScene(SkyState.EMBER, Modifier.fillMaxSize().background(TonoColors.Night), horizon = 0.46f)
                }
            }
        }
        compose.waitForIdle()
        compose.activity.window.decorView.captureRoboImage("build/ghost-region-home.png")
        val actual = BitmapFactory.decodeFile("build/ghost-region-home.png")
        compose.runOnIdle { home = false }
        compose.waitForIdle()
        compose.activity.window.decorView.captureRoboImage("build/ghost-region-scene.png")
        val scene = BitmapFactory.decodeFile("build/ghost-region-scene.png")
        var changed = 0
        for (y in 0 until actual.height / 3) for (x in actual.width * 3 / 5 until actual.width) {
            if (actual.getPixel(x, y) != scene.getPixel(x, y)) changed++
        }
        assertEquals("upper-right sky must not contain a duplicated dock recording", 0, changed)
    }
}
