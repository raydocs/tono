package com.raydocs.tono.mobile.engine

import org.junit.Assert.*
import org.junit.Test

class FirstConnectRetryTest {
    private class FakeSleep {
        val sleeps = mutableListOf<Long>()
        fun sleep(ms: Long) { sleeps += ms }
    }

    private fun retry(clock: FakeSleep) = FirstConnectRetry(sleep = clock::sleep)

    @Test fun retries503WithOneTwoFourThenReturns() {
        val clock = FakeSleep()
        var calls = 0
        val result = retry(clock).run {
            calls++
            if (calls < 4) throw ApiException(503, "CATALOG_UNAVAILABLE", "busy")
            "catalog"
        }
        assertEquals("catalog", result)
        assertEquals(4, calls)
        assertEquals(listOf(1_000L, 1_000L, 1_000L, 1_000L, 1_000L, 1_000L, 1_000L), clock.sleeps)
    }

    @Test fun givesUpWithTheLast503AfterTheBackoff() {
        val clock = FakeSleep()
        var calls = 0
        val thrown = assertThrows(ApiException::class.java) {
            retry(clock).run { calls++; throw ApiException(503, "CATALOG_UNAVAILABLE", "busy") }
        }
        assertEquals(503, thrown.status)
        assertEquals(4, calls)
        assertEquals(7_000L, clock.sleeps.sum())
    }

    @Test fun propagationAndOtherErrorsAreNotRetriedHere() {
        val clock = FakeSleep()
        val errors = listOf(
            ApiException(503, PropagationWait.CODE, "waiting"),
            ApiException(500, "SERVER_ERROR", "x"),
            ApiException(0, "NETWORK", "timeout"),
            ApiException(401, "SIGNED_OUT", "no"),
        )
        for (e in errors) {
            var calls = 0
            val thrown = assertThrows(ApiException::class.java) { retry(clock).run { calls++; throw e } }
            assertSame(e, thrown)
            assertEquals(1, calls)
        }
        assertTrue(clock.sleeps.isEmpty())
    }

    @Test fun unstructuredEdge503IsRetried() {
        val clock = FakeSleep()
        var calls = 0
        val result = retry(clock).run {
            calls++
            if (calls == 1) throw ApiException(0, "NETWORK", "HTTP 503 via system_dns")
            "ok"
        }
        assertEquals("ok", result)
        assertEquals(2, calls)
        assertEquals(1_000L, clock.sleeps.sum())
    }

    @Test fun cancellationStopsInsideASlice() {
        val clock = FakeSleep()
        var calls = 0
        assertThrows(FirstConnectRetry.Cancelled::class.java) {
            retry(clock).run(cancelled = { clock.sleeps.sum() >= 1_000 }) {
                calls++
                throw ApiException(503, "CATALOG_UNAVAILABLE", "busy")
            }
        }
        assertEquals(1, calls)
        assertEquals(1_000L, clock.sleeps.sum())
    }

    @Test fun aUserTapClearsIntentExceptForA503ThatCanStillRecover() {
        val busy = ApiException(503, "CATALOG_UNAVAILABLE", "busy")
        val denied = ApiException(401, "SIGNED_OUT", "no")
        assertFalse(FirstConnectRetry.shouldClearWantConnected(userInitiated = true, busy))
        assertTrue(FirstConnectRetry.shouldClearWantConnected(userInitiated = true, denied))
        assertFalse(FirstConnectRetry.shouldClearWantConnected(userInitiated = false, denied))
    }
}
