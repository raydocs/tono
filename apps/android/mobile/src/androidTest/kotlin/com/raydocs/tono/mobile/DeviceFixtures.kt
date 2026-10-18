package com.raydocs.tono.mobile

import com.raydocs.tono.mobile.engine.EngineSnapshot
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
        phase = Phase.CONNECTED, connectedSinceMs = System.currentTimeMillis() - 23 * 60_000,
        cloudProbe = ExitProbe(ProbeState.OK, "JP"), homeProbe = ExitProbe(ProbeState.OK, "US"), rxBytesPerSec = 2_340_000, txBytesPerSec = 81_000,
    )
    fun degraded() = connected().copy(phase = Phase.DEGRADED, reasonCode = "HOME_UNREACHABLE", homeProbe = ExitProbe(ProbeState.FAILED))
    val failed = idle.copy(phase = Phase.FAILED, reasonCode = "HOME_UNAVAILABLE")

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
