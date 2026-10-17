package com.raydocs.tono.mobile.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.Phase
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Frame-by-frame motion preview on a manual Compose clock (JVM/Robolectric, not a device): connect,
 * arrive, disconnect, then a failed attempt. Frames go to build/motion/<run>/, assembled with ffmpeg.
 * Opt-in with -Ptono.screenshots. Timing is the app's real animation specs; frame pacing, jank and
 * GPU blur are not represented.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "zh-rCN-w360dp-h780dp-xhdpi")
class MotionPreview {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule val rules: RuleChain = RuleChain.outerRule(RegisterComponentActivity()).around(compose)

    @Before fun gate() = assumeTrue(System.getProperty("tono.screenshots") == "true")

    private var snapshot by mutableStateOf(UiFixtures.idle)
    private var frame = 0

    private fun run(name: String, reduce: Boolean, script: List<Pair<Long, EngineSnapshot>>) {
        val dir = File("build/motion/$name").apply { deleteRecursively(); mkdirs() }
        compose.mainClock.autoAdvance = false
        snapshot = script.first().second
        compose.setContent {
            CompositionLocalProvider(LocalReduceMotion provides reduce) { TonoTheme { HomeScreen(snapshot, {}, {}, {}, {}, {}) } }
        }
        frame = 0
        for ((durationMs, s) in script) {
            snapshot = s
            var t = 0L
            while (t < durationMs) {
                compose.mainClock.advanceTimeBy(FRAME_MS)
                compose.onRoot().captureRoboImage(File(dir, "f%04d.png".format(frame++)).path)
                t += FRAME_MS
            }
        }
    }

    private val connectThenFail by lazy {
        val idle = UiFixtures.idle
        val now = System.currentTimeMillis()
        listOf(
            500L to idle,
            900L to idle.copy(phase = Phase.PREPARING),
            900L to idle.copy(phase = Phase.CONNECTING),
            1600L to UiFixtures.connected(now),
            450L to idle.copy(phase = Phase.DISCONNECTING),
            800L to idle,
            700L to idle.copy(phase = Phase.PREPARING),
            1400L to idle.copy(phase = Phase.FAILED, reasonCode = "HOME_UNAVAILABLE"),
        )
    }

    @Test fun connectCycle() = run("connect-cycle", reduce = false, script = connectThenFail)

    @Test fun connectCycleReducedMotion() = run("connect-cycle-reduced", reduce = true, script = connectThenFail)

    private companion object { const val FRAME_MS = 50L }
}
