package com.raydocs.tono.mobile.engine

import org.junit.Assert.*
import org.junit.Test

class PropagationWaitTest {
    private class FakeTime {
        var nanos = 1_000_000_000L
        val sleeps = mutableListOf<Long>()
        fun sleep(ms: Long) { sleeps += ms; nanos += ms * 1_000_000 }
        val elapsedMs get() = (nanos - 1_000_000_000L) / 1_000_000
    }

    private fun propagating() = ApiException(503, PropagationWait.CODE, "waiting for exit ack")
    private fun wait(t: FakeTime) = PropagationWait(nanoTime = { t.nanos }, sleep = t::sleep)

    @Test fun retriesEveryFifteenSecondsUntilTheIdentityIsServed() {
        val t = FakeTime()
        var calls = 0
        val waited = mutableListOf<Int>()
        val result = wait(t).run(onWaiting = { waited += it }) {
            calls++
            if (calls < 4) throw propagating()
            "catalog"
        }
        assertEquals("catalog", result)
        assertEquals(4, calls)
        assertEquals(listOf(1, 2, 3), waited)
        assertEquals(45_000L, t.elapsedMs)
        assertTrue("slept in slices so cancel is prompt", t.sleeps.all { it <= 1_000 })
    }

    @Test fun givesUpWithTheLastErrorAtTheFiveMinuteDeadline() {
        val t = FakeTime()
        var calls = 0
        val thrown = assertThrows(ApiException::class.java) {
            wait(t).run { calls++; throw propagating() }
        }
        assertEquals(PropagationWait.CODE, thrown.code)
        assertEquals(503, thrown.status)
        // Attempts at 0, 15, …, 300 s: never a sleep that would end past the deadline.
        assertEquals(21, calls)
        assertEquals(PropagationWait.DEADLINE_MS, t.elapsedMs)
    }

    @Test fun deadlineFollowsTheMonotonicClockNotTheNumberOfAttempts() {
        // A slow request (the clock moves while the GET runs) consumes the budget too.
        val t = FakeTime()
        var calls = 0
        assertThrows(ApiException::class.java) {
            wait(t).run { calls++; t.nanos += 60_000L * 1_000_000; throw propagating() }
        }
        // 0→60 fail, +15 → 75→135 fail, +15 → 150→210, +15 → 225→285, 285+15 = 300 ≤ 300 → 300→360 > deadline.
        assertEquals(5, calls)
    }

    @Test fun otherErrorsAreNotWaitedOn() {
        val t = FakeTime()
        for (e in listOf(ApiException(503, "SERVER_ERROR", "x"), ApiException(500, PropagationWait.CODE, "x"), ApiException(0, "NETWORK", "x"))) {
            var calls = 0
            val thrown = assertThrows(ApiException::class.java) { wait(t).run { calls++; throw e } }
            assertSame(e, thrown)
            assertEquals(1, calls)
        }
        assertTrue(t.sleeps.isEmpty())
    }

    @Test fun cancellationStopsTheWaitWithinASlice() {
        val t = FakeTime()
        var calls = 0
        assertThrows(PropagationWait.Cancelled::class.java) {
            wait(t).run(cancelled = { t.elapsedMs >= 3_000 }) { calls++; throw propagating() }
        }
        assertEquals(1, calls)
        assertEquals(3_000L, t.elapsedMs)
    }

    @Test fun defaultsMatchTheContract() {
        assertEquals(15_000L, PropagationWait.INTERVAL_MS)
        assertEquals(300_000L, PropagationWait.DEADLINE_MS)
        assertTrue(PropagationWait.isPropagating(propagating()))
        assertFalse(PropagationWait.isPropagating(RuntimeException()))
    }
}
