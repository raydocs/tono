package com.raydocs.tono.mobile.engine

/** Engine-thread fence for same-attempt rechecks and underlying-network changes. */
class ProbeEpoch<N> {
    class Ticket<N>(internal val epoch: Long, internal val network: N?)
    private var epoch = 0L
    fun begin(network: N?): Ticket<N> = Ticket(++epoch, network)
    fun invalidate() { epoch++ }
    fun accepts(ticket: Ticket<N>, currentNetwork: N?): Boolean =
        ticket.epoch == epoch && ticket.network != null && ticket.network == currentNetwork
}
