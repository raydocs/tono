package com.raydocs.tono.mobile.engine

import org.junit.Assert.*
import org.junit.Test

class UnderlyingSyncTest {
    private val applied = mutableListOf<String?>()
    private val sync = UnderlyingSync<String> { applied += it; true }

    @Test fun nothingIsAppliedWithoutAnOpenTun() {
        assertFalse(sync.onNetwork("wifi", 1))
        assertTrue(applied.isEmpty())
    }

    @Test fun establishingATunAssertsTheNewestNetworkThenFollowsChanges() {
        sync.onNetwork("wifi", 1)
        sync.onTunEstablished()
        assertEquals(listOf<String?>("wifi"), applied)
        assertTrue(sync.onNetwork("cell", 2))
        assertTrue(sync.onNetwork(null, 3))
        assertEquals(listOf("wifi", "cell", null), applied)
    }

    @Test fun aReorderedOlderCallbackCannotRollBackANewerNetwork() {
        sync.onTunEstablished()
        sync.onNetwork("cell", 5)
        assertFalse(sync.onNetwork("wifi", 4))
        assertFalse(sync.onNetwork("cell", 5))
        assertEquals(listOf<String?>("cell"), applied)
    }

    @Test fun anApplyBoundToAClosedOrReplacedTunIsDropped() {
        val first = sync.onTunEstablished()
        sync.onNetwork("wifi", 1)
        val second = sync.onTunEstablished()
        assertNotEquals(first, second)
        applied.clear()
        assertFalse("stale generation", sync.applyFor(first))
        sync.onTunClosed()
        assertFalse("tun closed", sync.applyFor(second))
        assertFalse(sync.onNetwork("cell", 2))
        assertTrue(applied.isEmpty())
        // The next TUN starts from the newest network seen while closed.
        sync.onTunEstablished()
        assertEquals(listOf<String?>("cell"), applied)
    }

    @Test fun aFailedApplyIsRetriedOnTheNextChance() {
        var ok = false
        val calls = mutableListOf<String?>()
        val s = UnderlyingSync<String> { calls += it; ok }
        val gen = s.onTunEstablished()
        assertFalse(s.onNetwork("wifi", 1))
        assertEquals(-1L, s.appliedSequence)
        ok = true
        assertTrue(s.applyFor(gen))
        assertEquals(1L, s.appliedSequence)
        assertEquals(listOf<String?>("wifi", "wifi"), calls)
    }
}
