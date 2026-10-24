package com.raydocs.tono.mobile.engine

/** Orders the physical stop and its durable intent; shared by disconnect and revocation. */
internal fun stopAndPersist(stop: () -> Unit, persist: () -> Unit, warn: (Exception) -> Unit) {
    persist()
    stop()
}
