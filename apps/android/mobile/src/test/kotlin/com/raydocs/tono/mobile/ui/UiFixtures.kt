package com.raydocs.tono.mobile.ui

import android.content.ComponentName
import androidx.activity.ComponentActivity
import com.raydocs.tono.mobile.engine.EngineSnapshot
import com.raydocs.tono.mobile.engine.ExitProbe
import com.raydocs.tono.mobile.engine.HomeKind
import com.raydocs.tono.mobile.engine.NodeView
import com.raydocs.tono.mobile.engine.Phase
import com.raydocs.tono.mobile.engine.ProbeState
import com.raydocs.tono.routing.RoutingMode
import org.junit.rules.ExternalResource
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf

/** Layout-only fixture lines; the app itself only ever shows lines from an admitted catalog. */
object UiFixtures {
    val nodes = listOf(
        NodeView("Tokyo · Dawn", "Tokyo", "Dawn", 86),
        NodeView("Los Angeles · Grove", "Los Angeles", "Grove", 162),
        NodeView("Singapore · Reef", "Singapore", "Reef", 412),
        NodeView("Salt Lake City · Basin", "Salt Lake City", "Basin", null),
    )
    val idle = EngineSnapshot(
        phase = Phase.IDLE, email = "tester@example.com", nodes = nodes, selectedNode = "Tokyo · Dawn",
        homeKind = HomeKind.RESIDENTIAL, mode = RoutingMode.THREE_TIER, coreVersion = "1.15.0-alpha.12", catalogRevision = 12,
    )
    fun connected(sinceMs: Long = System.currentTimeMillis() - 23 * 60_000) = idle.copy(
        phase = Phase.CONNECTED, connectedSinceMs = sinceMs,
        cloudProbe = ExitProbe(ProbeState.OK, "JP"), homeProbe = ExitProbe(ProbeState.OK, "US"),
        rxBytesPerSec = 2_340_000, txBytesPerSec = 81_000,
    )
    fun degraded() = connected().copy(phase = Phase.DEGRADED, reasonCode = "HOME_UNREACHABLE", homeProbe = ExitProbe(ProbeState.FAILED))
}

/** Lets a Compose test host a plain ComponentActivity without a test-only manifest entry. */
class RegisterComponentActivity : ExternalResource() {
    override fun before() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app.packageManager).addActivityIfNotPresent(ComponentName(app, ComponentActivity::class.java))
    }
}
