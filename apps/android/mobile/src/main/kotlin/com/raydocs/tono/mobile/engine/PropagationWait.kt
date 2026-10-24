package com.raydocs.tono.mobile.engine

/**
 * Bounded wait on catalog GET 503 `EXIT_IDENTITY_PROPAGATING`.
 *
 * A new device's exit identity is served only once an exit node acknowledges it (the exit agent
 * runs every 60 s), so the first catalog read after sign-in can honestly answer "not yet". That is
 * not a failure to show: retry every [intervalMs] until [deadlineMs] after the first answer, then
 * surface the last error. Time is read from a monotonic clock ([nanoTime], SystemClock-style), so a
 * wall-clock change during the wait neither shortens nor stretches it. [cancelled] is polled before
 * every sleep slice so a disconnect or sign-out never sits behind a five-minute wait.
 */
class PropagationWait(
    private val nanoTime: () -> Long = System::nanoTime,
    private val sleep: (Long) -> Unit = { Thread.sleep(it) },
    private val intervalMs: Long = INTERVAL_MS,
    private val deadlineMs: Long = DEADLINE_MS,
    private val sliceMs: Long = 1_000,
) {
    class Cancelled : java.io.IOException("propagation wait cancelled")

    fun <T> run(cancelled: () -> Boolean = { false }, onWaiting: (attempt: Int) -> Unit = {}, block: () -> T): T {
        var start: Long? = null
        var attempt = 0
        while (true) {
            try {
                return block()
            } catch (e: ApiException) {
                if (!isPropagating(e)) throw e
                val now = nanoTime()
                val first = start ?: now.also { start = it }
                val elapsedMs = (now - first) / 1_000_000
                if (elapsedMs + intervalMs > deadlineMs) throw e
                attempt++
                onWaiting(attempt)
                var slept = 0L
                while (slept < intervalMs) {
                    if (cancelled()) throw Cancelled()
                    val step = minOf(sliceMs, intervalMs - slept)
                    sleep(step)
                    slept += step
                }
                if (cancelled()) throw Cancelled()
            }
        }
    }

    companion object {
        const val CODE = "EXIT_IDENTITY_PROPAGATING"
        const val INTERVAL_MS = 15_000L
        const val DEADLINE_MS = 5 * 60_000L

        fun isPropagating(e: Throwable): Boolean = e is ApiException && e.status == 503 && e.code == CODE
    }
}
