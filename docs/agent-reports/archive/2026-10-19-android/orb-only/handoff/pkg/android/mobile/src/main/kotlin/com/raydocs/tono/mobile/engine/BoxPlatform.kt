package com.raydocs.tono.mobile.engine

import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.DnsResolver
import android.net.NetworkCapabilities
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.system.OsConstants
import io.nekohasekai.libbox.AutoRedirectHandler
import io.nekohasekai.libbox.AutoRedirectSession
import io.nekohasekai.libbox.BridgeOptions
import io.nekohasekai.libbox.BridgeSession
import io.nekohasekai.libbox.ConnectionOwner
import io.nekohasekai.libbox.ExchangeContext
import io.nekohasekai.libbox.Func
import io.nekohasekai.libbox.InterfaceUpdateListener
import io.nekohasekai.libbox.LocalDNSTransport
import io.nekohasekai.libbox.NeighborUpdateListener
import io.nekohasekai.libbox.NetworkInterfaceIterator
import io.nekohasekai.libbox.Notification
import io.nekohasekai.libbox.PlatformInterface
import io.nekohasekai.libbox.PlatformUser
import io.nekohasekai.libbox.RoutePrefixIterator
import io.nekohasekai.libbox.ShellSession
import io.nekohasekai.libbox.StringIterator
import io.nekohasekai.libbox.TunOptions
import io.nekohasekai.libbox.WIFIState
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import io.nekohasekai.libbox.NetworkInterface as BoxInterface

/**
 * Android side of sing-box's platform contract for the Tono VPN service.
 * Owns the TUN descriptor, socket protection, connection-owner lookup and the phone's own DNS.
 */
class BoxPlatform(
    private val service: TonoVpnService,
    private val connectivity: ConnectivityManager,
    private val monitor: NetworkMonitor,
) : PlatformInterface {
    @Volatile private var tun: ParcelFileDescriptor? = null
    private val dnsExecutor = Executors.newCachedThreadPool()
    private val interfaceListeners = HashMap<InterfaceUpdateListener, (NetworkMonitor.Underlying?) -> Unit>()

    fun closeTun() {
        tun?.let { runCatching { it.close() } }
        tun = null
    }

    override fun usePlatformAutoDetectInterfaceControl(): Boolean = true

    override fun autoDetectInterfaceControl(fd: Int) {
        // Every sing-box outbound socket (cloud, Home, DIRECT, DNS) leaves on the physical network.
        if (!service.protect(fd)) throw IllegalStateException("VpnService.protect failed")
    }

    override fun openTun(options: TunOptions): Int {
        if (android.net.VpnService.prepare(service) != null) throw IllegalStateException("VPN_PERMISSION_REVOKED")
        val builder = service.Builder()
            .setSession("Tono")
            .setMtu(options.mtu)
            .setMetered(false)
            .setConfigureIntent(service.configureIntent())
        val inet4 = options.inet4Address.toList()
        val inet6 = options.inet6Address.toList()
        (inet4 + inet6).forEach { builder.addAddress(it.address(), it.prefix()) }
        if (options.autoRoute) {
            options.dnsServerAddress.forEachString { builder.addDnsServer(it) }
            // sing-tun already subtracted route_exclude_address (LAN, link-local, multicast) from these ranges.
            val v4Routes = options.inet4RouteRange.toList()
            val v6Routes = options.inet6RouteRange.toList()
            if (inet4.isNotEmpty()) {
                if (v4Routes.isEmpty()) builder.addRoute("0.0.0.0", 0) else v4Routes.forEach { builder.addRoute(it.address(), it.prefix()) }
            }
            // IPv6 is always captured, even on IPv4-only networks, so no IPv6 path can go around the rules.
            if (v6Routes.isEmpty()) builder.addRoute("::", 0) else v6Routes.forEach { builder.addRoute(it.address(), it.prefix()) }
        }
        // Per-app bypass chosen by the user. Tono itself is never excluded so its exit checks traverse the rules.
        options.excludePackage.forEachString { pkg ->
            if (pkg != service.packageName) runCatching { builder.addDisallowedApplication(pkg) }
        }
        builder.setUnderlyingNetworks(monitor.current?.network?.let { arrayOf(it) })
        val pfd = builder.establish() ?: throw IllegalStateException("VPN_PERMISSION_REVOKED")
        tun?.let { runCatching { it.close() } }
        tun = pfd
        return pfd.fd
    }

    override fun useProcFS(): Boolean = false

    override fun findConnectionOwner(ipProtocol: Int, sourceAddress: String, sourcePort: Int, destinationAddress: String, destinationPort: Int): ConnectionOwner {
        val uid = connectivity.getConnectionOwnerUid(
            ipProtocol,
            InetSocketAddress(InetAddress.getByName(sourceAddress), sourcePort),
            InetSocketAddress(InetAddress.getByName(destinationAddress), destinationPort),
        )
        if (uid == android.os.Process.INVALID_UID) throw IllegalStateException("owner not found")
        val packages = service.packageManager.getPackagesForUid(uid)?.toList().orEmpty()
        return ConnectionOwner().apply {
            userId = uid
            userName = packages.firstOrNull() ?: ""
            setAndroidPackageNames(StringArray(packages))
        }
    }

    override fun startDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
        val callback: (NetworkMonitor.Underlying?) -> Unit = { u ->
            val name = u?.interfaceName
            if (name == null) {
                listener.updateDefaultInterface("", -1, false, false)
            } else {
                val index = runCatching { java.net.NetworkInterface.getByName(name)?.index ?: -1 }.getOrDefault(-1)
                listener.updateDefaultInterface(name, index, u.metered, false)
            }
        }
        synchronized(interfaceListeners) { interfaceListeners[listener] = callback }
        monitor.addListener(callback)
    }

    override fun closeDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
        synchronized(interfaceListeners) { interfaceListeners.remove(listener) }?.let(monitor::removeListener)
    }

    override fun getInterfaces(): NetworkInterfaceIterator {
        val result = ArrayList<BoxInterface>()
        for (network in connectivity.allNetworks) {
            val caps = connectivity.getNetworkCapabilities(network) ?: continue
            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue
            val lp = connectivity.getLinkProperties(network) ?: continue
            val name = lp.interfaceName ?: continue
            val nif = runCatching { java.net.NetworkInterface.getByName(name) }.getOrNull() ?: continue
            result += BoxInterface().apply {
                setName(name)
                index = nif.index
                mtu = runCatching { nif.mtu }.getOrDefault(1500)
                addresses = StringArray(lp.linkAddresses.map { "${it.address.hostAddress}/${it.prefixLength}" })
                dnsServer = StringArray(lp.dnsServers.mapNotNull { it.hostAddress })
                type = when {
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> 0
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> 1
                    caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> 2
                    else -> 3
                }
                flags = (if (nif.isUp) OsConstants.IFF_UP else 0) or
                    (if (nif.supportsMulticast()) OsConstants.IFF_MULTICAST else 0) or
                    (if (nif.isPointToPoint) OsConstants.IFF_POINTOPOINT else 0) or
                    (if (nif.isLoopback) OsConstants.IFF_LOOPBACK else 0) or OsConstants.IFF_RUNNING
                metered = !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
            }
        }
        return object : NetworkInterfaceIterator {
            val it = result.iterator()
            override fun hasNext() = it.hasNext()
            override fun next(): BoxInterface = it.next()
        }
    }

    override fun underNetworkExtension(): Boolean = false
    override fun includeAllNetworks(): Boolean = false
    override fun readWIFIState(): WIFIState? = null
    override fun clearDNSCache() {}

    override fun sendNotification(notification: Notification) {
        service.showCoreNotice(notification.title, notification.body)
    }

    override fun cancelNotification(identifier: String, typeID: Int) {}
    override fun startNeighborMonitor(listener: NeighborUpdateListener) {}
    override fun closeNeighborMonitor(listener: NeighborUpdateListener) {}
    override fun registerMyInterface(name: String) {}
    override fun usePlatformShell(): Boolean = false
    override fun checkPlatformShell(): Unit = throw UnsupportedOperationException("shell")
    override fun openShellSession(user: PlatformUser, command: String, environ: StringIterator, term: String, rows: Int, cols: Int): ShellSession =
        throw UnsupportedOperationException("shell")
    override fun lookupUser(username: String): PlatformUser = throw UnsupportedOperationException("users")
    override fun lookupSFTPServer(): String = throw UnsupportedOperationException("sftp")
    override fun readSystemSSHHostKey(): String = throw UnsupportedOperationException("ssh")
    override fun tailscaleHostname(): String = ""
    override fun usePlatformBridge(): Boolean = false
    override fun createBridge(options: BridgeOptions): BridgeSession = throw UnsupportedOperationException("bridge")
    override fun usePlatformAutoRedirect(): Boolean = false
    override fun createAutoRedirect(options: ByteArray, handler: AutoRedirectHandler): AutoRedirectSession =
        throw UnsupportedOperationException("auto_redirect")

    override fun localDNSTransport(): LocalDNSTransport = localDns

    /** Resolves DIRECT names on the phone's own network ("本地DNS"), never through the tunnel. */
    private val localDns = object : LocalDNSTransport {
        override fun raw(): Boolean = true

        override fun exchange(ctx: ExchangeContext, message: ByteArray) {
            val network = monitor.current?.network
            if (network == null) {
                ctx.errnoCode(OsConstants.ENETUNREACH)
                return
            }
            val done = CountDownLatch(1)
            val cancel = CancellationSignal()
            ctx.onCancel(object : Func { override fun invoke() { cancel.cancel() } })
            DnsResolver.getInstance().rawQuery(network, message, DnsResolver.FLAG_NO_RETRY, dnsExecutor, cancel,
                object : DnsResolver.Callback<ByteArray> {
                    override fun onAnswer(answer: ByteArray, rcode: Int) {
                        ctx.rawSuccess(answer)
                        done.countDown()
                    }

                    override fun onError(error: DnsResolver.DnsException) {
                        val errno = (error.cause as? android.system.ErrnoException)?.errno
                        if (errno != null) ctx.errnoCode(errno) else ctx.errorCode(2)
                        done.countDown()
                    }
                })
            if (!done.await(12, TimeUnit.SECONDS)) {
                cancel.cancel()
                ctx.errnoCode(OsConstants.ETIMEDOUT)
            }
        }

        override fun lookup(ctx: ExchangeContext, network: String, domain: String) {
            throw UnsupportedOperationException("raw transport only")
        }
    }
}

class StringArray(private val values: List<String>) : StringIterator {
    private var index = 0
    override fun len(): Int = values.size
    override fun hasNext(): Boolean = index < values.size
    override fun next(): String = values[index++]
}

private fun RoutePrefixIterator.toList(): List<io.nekohasekai.libbox.RoutePrefix> =
    ArrayList<io.nekohasekai.libbox.RoutePrefix>().also { while (hasNext()) it += next() }

private inline fun StringIterator.forEachString(block: (String) -> Unit) {
    while (hasNext()) block(next())
}
