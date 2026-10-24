package com.raydocs.tono.mobile.engine

import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class StopPersistenceTest {
    @Test fun storageFailureCannotPreventPhysicalStopAndIsReportedAfterwards() {
        val events = mutableListOf<String>()
        val failure = IOException("disk full")
        stopAndPersist(
            stop = { events += "tunnel closed" },
            persist = { events += "persist"; throw failure },
            warn = { assertSame(failure, it); events += "warning" },
        )
        assertEquals(listOf("tunnel closed", "persist", "warning"), events)
    }
}
