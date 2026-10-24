package com.raydocs.tono.mobile.engine

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** One local DNS exchange, including the synchronous libbox wait and asynchronous Android callbacks. */
internal class DnsCompletion(private val cancelQuery: () -> Unit) {
    private val done = CountDownLatch(1)

    fun cancel() { cancelQuery() }

    fun complete(deliver: () -> Unit) {
        deliver()
        done.countDown()
    }

    fun await(timeout: Long, unit: TimeUnit): Boolean = done.await(timeout, unit)
}
