package com.raydocs.tono.mobile.engine

import org.junit.Assert.*
import org.junit.Test

class ProbeEpochTest {
    @Test fun olderRecheckCannotOverwriteNewerResultOnTheSameAttempt() {
        val fence = ProbeEpoch<String>()
        val old = fence.begin("wifi")
        val latest = fence.begin("wifi")
        assertTrue(fence.accepts(latest, "wifi"))
        assertFalse(fence.accepts(old, "wifi"))
    }
    @Test fun networkLossRejectsOldSuccessEvenBeforeTheListenerRuns() {
        val fence = ProbeEpoch<String>()
        val old = fence.begin("wifi")
        assertFalse(fence.accepts(old, null))
        assertFalse(fence.accepts(old, "mobile"))
    }
    @Test fun returningToTheSameNetworkDoesNotReviveItsRetiredProbe() {
        val fence = ProbeEpoch<String>()
        val old = fence.begin("wifi")
        fence.invalidate()
        fence.begin("mobile")
        assertFalse(fence.accepts(old, "wifi"))
    }
}
