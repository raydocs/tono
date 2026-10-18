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
