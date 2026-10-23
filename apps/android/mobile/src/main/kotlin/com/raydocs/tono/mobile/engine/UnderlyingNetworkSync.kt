package com.raydocs.tono.mobile.engine

/** Engine-thread-only metadata delivery; Binder failures must not skip network reconciliation. */
internal class UnderlyingNetworkSync(
    private val update: () -> Unit,
    private val onFailure: () -> Unit,
) {
    private var retriesLeft = 0

    fun onNetworkChanged() {
        retriesLeft = 2
        attempt()
    }

    /** Called by the existing traffic tick, so no retry task can outlive stopCore. */
    fun retryIfNeeded() {
        if (retriesLeft == 0) return
        retriesLeft--
        attempt()
    }

    fun cancelRetries() {
        retriesLeft = 0
    }

    private fun attempt() {
        try {
            // The platform reads the latest monitor value under the live TUN lock on every attempt.
            update()
            retriesLeft = 0
        } catch (_: Exception) {
            onFailure()
        }
    }
}
