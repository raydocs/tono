package com.raydocs.tono.mobile.engine

/** Engine-thread ownership. IO returns values; only current-account completions may commit them. */
class AccountWorkQueue(
    private val onIo: (() -> Unit) -> Unit,
    private val onEngine: (() -> Unit) -> Unit,
) {
    private var epoch = 0L
    private var busy = false
    private val waiting = ArrayDeque<() -> Unit>()

    /** Sign-out/account replacement retires running work and drops work not yet started. */
    fun invalidate() { epoch++; waiting.clear() }

    /** Preparation runs on the engine, after the preceding commit (including rotated credentials). */
    fun <T> submit(prepare: () -> (() -> T), commit: (Result<T>) -> Unit) {
        val owner = epoch
        waiting.addLast {
            val prepared = runCatching(prepare)
            onIo {
                val result = prepared.fold(onSuccess = { runCatching(it) }, onFailure = { Result.failure(it) })
                onEngine {
                    try { if (owner == epoch) commit(result) }
                    finally { busy = false; drain() }
                }
            }
        }
        drain()
    }

    private fun drain() {
        if (busy || waiting.isEmpty()) return
        busy = true
        waiting.removeFirst().invoke()
    }
}

/** Independent of tunnel attempts: cancelling/replacing a login invalidates its delayed replies. */
class RequestEpoch {
    private var current = 0L
    fun next(): Long = ++current
    fun accepts(request: Long): Boolean = request == current
}
