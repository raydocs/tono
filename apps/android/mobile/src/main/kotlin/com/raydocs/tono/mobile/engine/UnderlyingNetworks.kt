package com.raydocs.tono.mobile.engine

/**
 * Argument for `VpnService.setUnderlyingNetworks`.
 *
 * An empty list means no connectivity. `null` means the system default and can keep sending
 * after the physical network is gone.
 */
internal fun <T> underlyingNetworkArgument(network: T?): List<T> =
    if (network == null) emptyList() else listOf(network)
