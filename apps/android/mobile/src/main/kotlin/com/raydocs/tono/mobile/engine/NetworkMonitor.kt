package com.raydocs.tono.mobile.engine

import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Handler
import android.os.HandlerThread
import java.net.Inet6Address

/**
 * Tracks the phone's own (non-VPN) default network. sing-box binds DIRECT and outbound sockets to it,
 * the local DNS transport resolves on it, and its IPv6 capability decides whether DIRECT names get AAAA.
 */
class NetworkMonitor(private val connectivity: ConnectivityManager) {
    data class Underlying(
        val network: Network,
        val interfaceName: String?,
        val metered: Boolean,
        val globalIpv6: Boolean,
    )

    @Volatile var current: Underlying? = null
        private set

    private val listeners = LinkedHashSet<(Underlying?) -> Unit>()
    private val thread = HandlerThread("tono-network").apply { start() }
    private val handler = Handler(thread.looper)
    private var registered = false
    private val caps = HashMap<Network, NetworkCapabilities>()
    private val links = HashMap<Network, LinkProperties>()
    private var best: Network? = null

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { best = network; publish() }
        override fun onCapabilitiesChanged(network: Network, c: NetworkCapabilities) { best = network; caps[network] = c; publish() }
        override fun onLinkPropertiesChanged(network: Network, lp: LinkProperties) { best = network; links[network] = lp; publish() }
        override fun onLost(network: Network) {
            caps.remove(network); links.remove(network)
            if (best == network) best = null
            publish()
        }
    }

    @Synchronized
    fun start() {
        if (registered) return
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
            .build()
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            connectivity.registerBestMatchingNetworkCallback(request, callback, handler)
        } else {
            connectivity.requestNetwork(request, callback, handler)
        }
        registered = true
    }

    @Synchronized
    fun stop() {
        if (!registered) return
        runCatching { connectivity.unregisterNetworkCallback(callback) }
        registered = false
    }

    @Synchronized
    fun addListener(listener: (Underlying?) -> Unit) { listeners += listener; listener(current) }

    @Synchronized
    fun removeListener(listener: (Underlying?) -> Unit) { listeners -= listener }

    private fun publish() {
        val network = best
        val next = network?.let {
            val lp = links[it] ?: connectivity.getLinkProperties(it)
            val nc = caps[it] ?: connectivity.getNetworkCapabilities(it)
            Underlying(
                network = it,
                interfaceName = lp?.interfaceName,
                metered = nc?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == false,
                // Global unicast 2000::/3 on the physical link; ULA and link-local do not reach the Internet.
                globalIpv6 = lp?.linkAddresses?.any { la ->
                    val a = la.address
                    a is Inet6Address && (a.address[0].toInt() and 0xe0) == 0x20
                } == true,
            )
        }
        if (next == current) return
        current = next
        val snapshot = synchronized(this) { listeners.toList() }
        snapshot.forEach { runCatching { it(next) } }
    }
}
