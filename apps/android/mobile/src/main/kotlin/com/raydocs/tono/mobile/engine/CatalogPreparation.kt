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
    private var active = false

    fun start() {
        active = true
        // RED scaffolding: the original single read still ends preparation on the first error.
        request({ active && current() }) { result ->
            if (active && current()) {
                active = false
                complete(result)
            }
        }
    }

    fun cancel() { active = false }

    companion object {
        const val PENDING_CODE = "EXIT_IDENTITY_PROPAGATING"
        const val TIMEOUT_CODE = "EXIT_IDENTITY_PREPARATION_TIMEOUT"
        const val RETRY_DELAY_MS = 15_000L
        const val BUDGET_MS = 5 * 60_000L
    }
}
