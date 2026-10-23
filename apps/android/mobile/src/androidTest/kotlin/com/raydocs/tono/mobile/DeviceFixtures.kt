package com.raydocs.tono.mobile

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.activity.enableEdgeToEdge
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.AppliedTunnel
import com.raydocs.tono.mobile.engine.ExitProbe
import com.raydocs.tono.mobile.engine.HomeKind
import com.raydocs.tono.mobile.engine.NodeView
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.mobile.engine.ProbeState
import com.raydocs.tono.routing.RoutingMode

/** Fixture snapshots for UI-only device tests. No tunnel exists behind any of them. */
object DeviceFixtures {
    val nodes = listOf(NodeView("Tokyo · Dawn", "Tokyo", "Dawn", 86), NodeView("Los Angeles · Grove", "Los Angeles", "Grove", 162))
    val idle = EngineSnapshot(
        phase = Phase.IDLE, email = "tester@example.com", nodes = nodes, selectedNode = "Tokyo · Dawn",
        homeKind = HomeKind.RESIDENTIAL, mode = RoutingMode.THREE_TIER, coreVersion = "1.15.0-alpha.12", catalogRevision = 12,
    )
    fun connected() = idle.copy(
        session = "device-fixture", attempt = 1, applied = AppliedTunnel(1, idle.selectedNode, idle.mode),
        phase = Phase.CONNECTED, connectedSinceMs = System.currentTimeMillis() - 23 * 60_000,
        cloudProbe = ExitProbe(ProbeState.OK, "JP"), homeProbe = ExitProbe(ProbeState.OK, "US"), rxBytesPerSec = 2_340_000, txBytesPerSec = 81_000,
    )
    fun degraded() = connected().copy(phase = Phase.DEGRADED, reasonCode = "HOME_UNREACHABLE", homeProbe = ExitProbe(ProbeState.FAILED))
    val failed = idle.copy(phase = Phase.FAILED, reasonCode = "CATALOG_UNAVAILABLE")

    val homeStates = listOf(
        "idle" to idle,
        "permission" to idle.copy(phase = Phase.NEEDS_PERMISSION),
        "preparing" to idle.copy(phase = Phase.PREPARING),
        "connecting" to idle.copy(phase = Phase.CONNECTING),
        "connected" to connected(),
        "degraded" to degraded(),
        "disconnecting" to idle.copy(phase = Phase.DISCONNECTING),
        "failed" to failed,
    )
}

/**
 * Saves a screenshot only once the window below the status bar has actually been drawn: a software-GPU
 * emulator can hand back a frame of plain window background while the test already sees the content
 * in the semantics tree (run 39095195211 kept a blank consent capture that way).
 */
object Captures {
    fun drawn(file: java.io.File, attempts: Int = 12): Boolean {
        val automation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation
        repeat(attempts) {
            val bitmap = automation.takeScreenshot()
            if (bitmap != null && !plain(bitmap)) {
                file.outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
                return true
            }
            Thread.sleep(500)
        }
        return false
    }

    /**
     * The "FIXTURE · no tunnel" pill ([FixtureFrame]) is in the picture: enough pixels of its colour in
     * the status-bar band, as drawn, under an open sheet's scrim (45 % or 55 % of the sheets' night
     * colour) or under a dialog window's dim (60 % black on this emulator, measured FFB4A0 → 664840 behind the
     * sign-out confirmation). A fixture
     * capture without it could pass for the real app.
     */
    fun fixtureMarked(file: java.io.File): Boolean {
        val b = android.graphics.BitmapFactory.decodeFile(file.path) ?: return false
        val mark = intArrayOf(0xFF, 0xB4, 0xA0)
        val night = intArrayOf(0x06, 0x07, 0x0F)
        val looks = listOf(0f, 0.45f, 0.55f).map { scrim -> IntArray(3) { (mark[it] * (1 - scrim) + night[it] * scrim).toInt() } } +
            listOf(IntArray(3) { (mark[it] * (1 - 0.6f)).toInt() })
        val band = (b.height * 0.06).toInt()
        var hits = 0
        for (y in 0 until band step 2) for (x in 0 until b.width step 2) {
            val p = b.getPixel(x, y)
            val rgb = intArrayOf(android.graphics.Color.red(p), android.graphics.Color.green(p), android.graphics.Color.blue(p))
            if (looks.any { c -> (0..2).sumOf { Math.abs(rgb[it] - c[it]) } < 24 }) hits++
        }
        return hits > 40
    }

    /** Every sample on a 24 × 24 grid between 8 % and 92 % of the height has the same colour. */
    private fun plain(b: android.graphics.Bitmap): Boolean {
        val first = b.getPixel(b.width / 2, b.height / 2)
        for (i in 0 until 24) for (j in 0 until 24) {
            val p = b.getPixel(b.width * (i * 2 + 1) / 48, (b.height * (0.08 + 0.84 * (j * 2 + 1) / 48)).toInt())
            if (Math.abs(android.graphics.Color.red(p) - android.graphics.Color.red(first)) +
                Math.abs(android.graphics.Color.green(p) - android.graphics.Color.green(first)) +
                Math.abs(android.graphics.Color.blue(p) - android.graphics.Color.blue(first)) > 12) return false
        }
        return true
    }
}

/**
 * Every fixture screen carries this mark in the picture itself, so a screenshot passed around on its
 * own cannot be mistaken for a real connection. It sits in the status-bar band, where it covers no
 * title (round 5 put it over "Apps that bypass Tono"), and is hidden from accessibility so it does
 * not change what the screen-reader and ATF checks see. The host is drawn edge to edge, as
 * MainActivity is, so fixture layouts match the shipped app's.
 */
@androidx.compose.runtime.Composable
fun FixtureFrame(content: @androidx.compose.runtime.Composable () -> Unit) {
    // From the view, not LocalActivity: tests that switch the language provide a configuration context
    // as LocalContext, which hid the activity, so the Chinese captures were neither edge to edge nor marked.
    val activity = androidx.compose.ui.platform.LocalView.current.context.let { c ->
        generateSequence(c) { (it as? android.content.ContextWrapper)?.baseContext }.firstNotNullOfOrNull { it as? androidx.activity.ComponentActivity }
    }
    androidx.compose.runtime.LaunchedEffect(activity) {
        activity?.enableEdgeToEdge(
            statusBarStyle = androidx.activity.SystemBarStyle.dark(0),
            navigationBarStyle = androidx.activity.SystemBarStyle.dark(0),
        )
    }
    androidx.compose.foundation.layout.Box(androidx.compose.ui.Modifier.fillMaxSize()) {
        content()
        com.raydocs.tono.mobile.ui.StatusBandMark(
            "FIXTURE · no tunnel",
            androidx.compose.ui.Modifier.align(androidx.compose.ui.Alignment.TopCenter).clearAndSetSemantics { },
        )
    }
}

/**
 * CI emulators sometimes raise a system "isn't responding" dialog for another app (the launcher
 * after boot, VpnDialogs on a slow host). It is not ours; answer "Wait" so it does not cover the
 * evidence, and log it. Tono's own ANR stays on screen and fails the run.
 */
object ForeignAnr {
    fun dismiss(device: androidx.test.uiautomator.UiDevice, out: java.io.File) {
        repeat(3) {
            val title = device.findObject(androidx.test.uiautomator.By.text(java.util.regex.Pattern.compile(".+ isn't responding"))) ?: return
            if (title.text.startsWith("Tono")) return
            val wait = device.findObject(androidx.test.uiautomator.By.text("Wait")) ?: return
            java.io.File(out, "foreign-anr.txt").appendText("${title.text} → Wait\n")
            wait.click()
            device.waitForIdle(1_000)
        }
    }
}
