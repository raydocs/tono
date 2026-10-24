package com.raydocs.tono.mobile.engine

/**
 * Keeps `VpnService.setUnderlyingNetworks` in step with [NetworkMonitor] for the TUN that is open now.
 *
 * Every TUN Android establishes gets a new generation ([onTunEstablished]); every network the
 * monitor publishes carries its own sequence. An update is applied only if it names the current
 * TUN generation and is newer than the last one applied to it, so a callback queued for a TUN
 * that has since been closed or replaced cannot overwrite the live one, and a late, older network
 * callback cannot roll back a newer one. Applying is serialized under the object's lock.
 *
 * [N] is the network type (android.net.Network on device; anything in tests).
 */
class UnderlyingSync<N : Any>(private val apply: (N?) -> Boolean) {
    private var generation = 0L
    private var tunOpen = false
    private var appliedSeq = -1L
    private var latest: N? = null
    private var latestSeq = -1L

    /** The generation stamped onto the TUN just established; it starts from the latest network known. */
    @Synchronized
    fun onTunEstablished(): Long {
        generation++
        tunOpen = true
        appliedSeq = -1L
        if (latestSeq >= 0) push(generation, latestSeq)
        return generation
    }

    @Synchronized
    fun onTunClosed() { tunOpen = false; generation++ }

    /** A network published by [NetworkMonitor] with its monotonically increasing [seq]. */
    @Synchronized
    fun onNetwork(network: N?, seq: Long): Boolean {
        if (seq <= latestSeq) return false
        latest = network
        latestSeq = seq
        return if (tunOpen) push(generation, seq) else false
    }

    /** Apply only for [gen] that is still the open TUN, and only forwards in sequence. */
    @Synchronized
    fun applyFor(gen: Long): Boolean = tunOpen && gen == generation && latestSeq >= 0 && push(gen, latestSeq)

    @get:Synchronized val currentGeneration: Long get() = generation
    @get:Synchronized val appliedSequence: Long get() = appliedSeq

    private fun push(gen: Long, seq: Long): Boolean {
        if (!tunOpen || gen != generation || seq <= appliedSeq) return false
        if (!apply(latest)) return false
        appliedSeq = seq
        return true
    }
}
