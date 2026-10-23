package com.raydocs.tono.mobile.engine

import org.junit.Assert.*
import org.junit.Test

class UnderlyingNetworkSyncTest {
    @Test fun binderFailureReturnsToReconciliationAndRetriesLatestStateWithABoundedBudget() {
        var current = "wifi"
        var binderFailed = true
        var failures = 0
        val attempts = mutableListOf<String>()
        val sync = UnderlyingNetworkSync(
            update = {
                attempts += current
                if (binderFailed) throw IllegalStateException("Binder unavailable")
            },
            onFailure = { failures++ },
        )

        // This call must return normally so its caller can invalidate probes / mark the link offline.
        sync.onNetworkChanged()
        assertEquals(listOf("wifi"), attempts)
        assertEquals(1, failures)

        current = "cellular"
        binderFailed = false
        sync.retryIfNeeded()
        sync.retryIfNeeded()
        assertEquals("successful retry reads current state and stops", listOf("wifi", "cellular"), attempts)
        assertEquals(1, failures)

        binderFailed = true
        sync.onNetworkChanged()
        sync.retryIfNeeded()
        sync.retryIfNeeded()
        sync.retryIfNeeded()
        assertEquals("at most the initial delivery and two retries per event", 5, attempts.size)
        assertEquals(4, failures)

        current = "offline"
        sync.onNetworkChanged()
        sync.cancelRetries()
        binderFailed = false
        sync.retryIfNeeded()
        assertEquals("stop clears pending work", 6, attempts.size)
        assertEquals(5, failures)
        assertEquals("offline", attempts.last())

        sync.onNetworkChanged()
        assertEquals("a successor event can sync normally", 7, attempts.size)
        assertEquals(5, failures)
    }
}
