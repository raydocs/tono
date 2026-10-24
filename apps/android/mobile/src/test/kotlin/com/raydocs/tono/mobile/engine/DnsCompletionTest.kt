package com.raydocs.tono.mobile.engine

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.TimeUnit

class DnsCompletionTest {
    @Test fun cancellationReleasesTheEngineWaitAndRejectsLateCallbacks() {
        var cancelled = 0
        var delivered = 0
        val exchange = DnsCompletion { cancelled++ }
        exchange.cancel()
        assertTrue("cancellation must not wait for the 12 second DNS timeout", exchange.await(0, TimeUnit.SECONDS))
        exchange.complete { delivered++ }
        exchange.cancel()
        assertEquals(1, cancelled)
        assertEquals("cancelled context must never receive a late answer", 0, delivered)
    }
}
