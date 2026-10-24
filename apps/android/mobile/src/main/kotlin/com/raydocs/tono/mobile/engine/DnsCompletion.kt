package com.raydocs.tono.mobile.engine

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** One local DNS exchange, including the synchronous libbox wait and asynchronous Android callbacks. */
internal class DnsCompletion(private val cancelQuery: () -> Unit) {
    private val done = CountDownLatch(1)
    private val finished = AtomicBoolean()

    fun cancel() {
        complete { cancelQuery() }
    }

    fun complete(deliver: () -> Unit) {
        if (!finished.compareAndSet(false, true)) return
        try {
            deliver()
        } finally {
            done.countDown()
        }
    }

    fun await(timeout: Long, unit: TimeUnit): Boolean = done.await(timeout, unit)
}
