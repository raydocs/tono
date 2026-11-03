package com.raydocs.tono.mobile.engine

/**
 * Bounded backoff for a first catalog read that answers HTTP 503.
 *
 * `EXIT_IDENTITY_PROPAGATING` stays with [PropagationWait] (15s, five minutes). Every other 503,
 * including an unstructured edge 503 that the HTTP client reports as NETWORK, is retried here so
 * a cold connect recovers without another tap. Time is monotonic. [cancelled] is polled before
 * every sleep slice.
 */
class FirstConnectRetry(
    private val sleep: (Long) -> Unit = { Thread.sleep(it) },
    private val delaysMs: LongArray = DELAYS_MS,
    private val sliceMs: Long = 1_000,
) {
    class Cancelled : java.io.IOException("first-connect retry cancelled")

    fun <T> run(cancelled: () -> Boolean = { false }, block: () -> T): T {
        var attempt = 0
        while (true) {
            try {
                return block()
            } catch (e: ApiException) {
                if (!isRetryable(e) || attempt >= delaysMs.size) throw e
                val delay = delaysMs[attempt]
                attempt++
                var slept = 0L
                while (slept < delay) {
                    if (cancelled()) throw Cancelled()
                    val step = minOf(sliceMs, delay - slept)
                    sleep(step)
                    slept += step
                }
                if (cancelled()) throw Cancelled()
            }
        }
    }

    companion object {
        val DELAYS_MS = longArrayOf(1_000, 2_000, 4_000)

        fun isRetryable(e: Throwable): Boolean {
            if (e !is ApiException || PropagationWait.isPropagating(e)) return false
            if (e.status == 503) return true
            return e.status == 0 && e.code == "NETWORK" && (e.message?.contains("HTTP 503") == true)
        }

        /** A tapped connect clears the saved intent. A 503 that outlasted the backoff does not. */
        fun shouldClearWantConnected(userInitiated: Boolean, error: Throwable): Boolean =
            userInitiated && !isRetryable(error)
    }
}
