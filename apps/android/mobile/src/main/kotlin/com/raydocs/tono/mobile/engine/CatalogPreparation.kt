package com.raydocs.tono.mobile.engine

import java.io.IOException

/** Only the catalog GET may mint this signal. A refresh POST with the same code is not replayable. */
internal class CatalogIdentityPending(cause: ApiException) : IOException(cause.message, cause)
internal class CatalogIdentityTimeout : IOException("exit identity did not become ready within the preparation budget")

internal fun readExitCatalog(api: ControlPlane, bearer: (Boolean) -> String): Map<String, Any?> {
    fun get(access: String): Map<String, Any?> = try {
        api.get("exit-catalog", access)
    } catch (e: ApiException) {
        if (e.status == 503 && e.code == CatalogPreparation.PENDING_CODE) throw CatalogIdentityPending(e)
        throw e
    }
    // Evaluate bearer (and its possible POST) OUTSIDE the catalog error classifier/401 retry.
    val access = bearer(false)
    return try { get(access) } catch (e: ApiException) {
        if (e.status != 401 || e.code == "INVALID_REFRESH_TOKEN") throw e
        get(bearer(true))
    }
}

/** Engine-thread catalog preparation. HTTP and credential commits stay in AccountWorkQueue. */
internal class CatalogPreparation<T>(
    private val nowMs: () -> Long,
    private val schedule: (Long, () -> Unit) -> Cancel,
    private val request: (() -> Boolean, (Result<T>) -> Unit) -> Unit,
    private val current: () -> Boolean,
    private val waiting: () -> Unit,
    private val complete: (Result<T>) -> Unit,
) {
    fun interface Cancel { fun cancel() }
    private var started = false
    private var active = false
    private var deadlineMs: Long? = null
    private var retryTask: Cancel? = null
    private var deadlineTask: Cancel? = null

    fun start() {
        if (started) return
        started = true
        active = true
        read()
    }

    fun cancel() {
        active = false
        retryTask?.cancel()
        retryTask = null
        deadlineTask?.cancel()
        deadlineTask = null
    }

    /** Also checked when a queued read reaches AccountWorkQueue's engine-thread preparation. */
    private fun accepts(): Boolean {
        if (!active) return false
        if (!current()) { cancel(); return false }
        if (deadlineMs?.let { nowMs() >= it } == true) {
            finish(Result.failure(CatalogIdentityTimeout()))
            return false
        }
        return true
    }

    private fun read() {
        retryTask = null
        if (!accepts()) return
        request(::accepts) { result ->
            if (!accepts()) return@request
            if (result.exceptionOrNull() !is CatalogIdentityPending) {
                finish(result)
                return@request
            }
            if (deadlineMs == null) {
                // Start once, on the first explicit catalog signal; subsequent replies never extend it.
                deadlineMs = nowMs() + BUDGET_MS
                deadlineTask = schedule(minOf(BUDGET_MS, DEADLINE_RECHECK_MS), ::onDeadline)
                waiting()
            }
            if (accepts()) {
                val delay = minOf(RETRY_DELAY_MS, (deadlineMs!! - nowMs()).coerceAtLeast(0))
                retryTask = schedule(delay, ::read)
            }
        }
    }

    private fun onDeadline() {
        deadlineTask = null
        if (!accepts()) return
        // Relative executor delays can pause in deep sleep. Recheck within one active second
        // after resume even if HTTP never completes; this is not a wakeup alarm or a wake lock.
        val delay = minOf(DEADLINE_RECHECK_MS, (deadlineMs!! - nowMs()).coerceAtLeast(0))
        deadlineTask = schedule(delay, ::onDeadline)
    }

    private fun finish(result: Result<T>) {
        // In-flight IO may still commit a rotated token for its account; it cannot complete this
        // preparation again. Do not invalidate the account queue just to cancel a connection.
        cancel()
        complete(result)
    }

    companion object {
        const val PENDING_CODE = "EXIT_IDENTITY_PROPAGATING"
        const val TIMEOUT_CODE = "EXIT_IDENTITY_PREPARATION_TIMEOUT"
        private const val DEADLINE_RECHECK_MS = 1_000L
        const val RETRY_DELAY_MS = 15_000L
        const val BUDGET_MS = 5 * 60_000L
    }
}
