package com.raydocs.tono.routing

/** Mobile routing modes. Names follow the desktop "路由模式" setting. */
enum class RoutingMode {
    /** AI/Home → Home, video → cloud, everything else on the phone's own network (DIRECT). */
    THREE_TIER,
    /** Desktop "稳定": AI/Home → Home, video and every other public destination → cloud. LAN stays local. */
    STABLE,
}

data class ConfigInput(
    val catalog: ExitCatalog,
    val selectedCloudNode: String?,
    val mode: RoutingMode,
    /** Whether the underlying (non-VPN) network currently has global IPv6. */
    val underlyingIpv6: Boolean,
    /** Absolute path for sing-box's cache file (fake-IP mappings survive a reload). */
    val cacheFilePath: String?,
    val logLevel: String = "warn",
)

/**
 * Generates the sing-box 1.15 configuration for the Android VpnService.
 *
 * Priority (each matched rule is terminal; a failure never falls through to DIRECT):
 *  1. DNS hijack; 2. cloud video (TCP → cloud, UDP/ICMP rejected) — ahead of the broad Home parents;
 *  3. Home suffixes, Anthropic CIDR and AI app packages (TCP → Home, UDP/ICMP rejected);
 *  4. protected Tono hosts and the explicit overseas list → cloud; 5. stale fake IPs rejected;
 *  6. LAN/private → DIRECT; 7. final: DIRECT (three-tier) or cloud (stable, UDP rejected).
 */
object SingBoxConfig {
    const val EXIT_TAG = "Tono-Exit"
    const val HOME_SOCKS_TAG = "Tono-Home-Residential"
    const val DIRECT_TAG = "direct"
    const val BLOCK_TAG = "block"
    const val DNS_LOCAL = "local"
    const val DNS_FAKEIP = "fakeip"
    const val TUN_TAG = "tun-in"

    const val TUN_INET4 = "198.18.0.1/30"
    const val TUN_INET6 = "fdfe:dcba:9876::1/126"
    const val FAKEIP_INET4 = "198.18.128.0/17"
    const val FAKEIP_INET6 = "fc00::/18"

    /** Destinations that never enter the TUN on any Android version (sing-tun subtracts them from the route set). */
    val TUN_ROUTE_EXCLUDE = listOf(
        "10.0.0.0/8", "100.64.0.0/10", "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16",
        "224.0.0.0/4", "255.255.255.255/32", "fe80::/10", "ff00::/8",
    )

    /**
     * Android packages of the desktop HOME_PROCESS_NAMES assistants (Claude, ChatGPT, Grok).
     * Mobile-only addition: their TCP follows Home even when a destination hides its name.
     */
    val AI_APP_PACKAGES = listOf(
        "com.anthropic.claude",
        "com.openai.chatgpt",
        "ai.x.grok",
        "ai.perplexity.app.android",
        "com.google.android.apps.bard",
    )

    /**
     * Android packages routed through the cloud exit (TCP -> Tono-Exit, UDP/ICMP -> reject)
     * even when a connection dials a raw IP without a sniffed domain. Evaluated after Home
     * domain rules so Grok (grok.x.com / grok.com / x.ai) inside the X app and WhatsApp domains
     * still route to Home while un-sniffed raw-IP TCP routes to Cloud instead of DIRECT.
     */
    val CLOUD_APP_PACKAGES = listOf(
        "com.twitter.android",
        "org.telegram.messenger",
        "org.telegram.messenger.web",
        "org.thoughtcrime.securesms",
        "com.whatsapp",
        "com.discord",
        "com.google.android.youtube",
        "com.zhiliaoapp.musically",
        "com.ss.android.ugc.trill",
    )

    /** Local names that must keep resolving on the phone's own network. */
    private val LOCAL_DNS_SUFFIXES = listOf("local", "lan", "home.arpa", "in-addr.arpa", "ip6.arpa", "localhost")

    val protectedRemainder: List<String>
        get() = DesktopRoutingContract.PROTECTED_DIRECT_SUFFIXES.filterNot { suffix ->
            (DesktopRoutingContract.HOME_SUFFIXES + DesktopRoutingContract.MOBILE_HOME_AUX_SUFFIXES + DesktopRoutingContract.CLOUD_VIDEO_SUFFIXES)
                .any { suffix == it || suffix.endsWith(".$it") }
        }

    fun homeTargetTag(catalog: ExitCatalog): String = when (val home = catalog.home) {
        is HomeTarget.Socks5 -> HOME_SOCKS_TAG
        is HomeTarget.CatalogNode -> home.node.name
        null -> EXIT_TAG
    }

    fun selectedNode(input: ConfigInput): VlessNode {
        val nodes = input.catalog.cloudNodes
        return nodes.firstOrNull { it.name == input.selectedCloudNode }
            ?: nodes.firstOrNull { it.name == input.catalog.defaultCloudNode }
            ?: nodes.first()
    }

    fun build(input: ConfigInput): Map<String, Any?> {
        val catalog = input.catalog
        val selected = selectedNode(input)
        val home = homeTargetTag(catalog)
        val video = DesktopRoutingContract.CLOUD_VIDEO_SUFFIXES
        val homeSuffixes = DesktopRoutingContract.HOME_SUFFIXES + DesktopRoutingContract.MOBILE_HOME_AUX_SUFFIXES
        val protected = protectedRemainder + DesktopRoutingContract.PUBLIC_STUN_SUFFIXES + DesktopRoutingContract.X_CLOUD_SUFFIXES + DesktopRoutingContract.OVERSEAS_CLOUD_SUFFIXES
        val threeTier = input.mode == RoutingMode.THREE_TIER
        val cloudOnlyExact = if (threeTier) DesktopRoutingContract.OVERSEAS_EXACT else emptyList()

        val outbounds = ArrayList<Any?>()
        catalog.cloudNodes.forEach { outbounds += vless(it) }
        (catalog.home as? HomeTarget.CatalogNode)?.let { outbounds += vless(it.node) }
        outbounds += linkedMapOf(
            "type" to "selector",
            "tag" to EXIT_TAG,
            "outbounds" to catalog.cloudNodes.map { it.name },
            "default" to selected.name,
            "interrupt_exist_connections" to true,
        )
        (catalog.home as? HomeTarget.Socks5)?.socks?.let { socks ->
            outbounds += linkedMapOf(
                "type" to "socks",
                "tag" to HOME_SOCKS_TAG,
                "server" to socks.host,
                "server_port" to socks.port,
                "version" to "5",
                "username" to socks.username,
                "password" to socks.password,
                "network" to "tcp",
                "detour" to EXIT_TAG,
            )
        }
        outbounds += linkedMapOf("type" to "direct", "tag" to DIRECT_TAG)

        val udpIcmp = listOf("udp", "icmp")
        val rules = ArrayList<Any?>()
        rules += linkedMapOf("inbound" to listOf(TUN_TAG), "action" to "sniff")
        rules += linkedMapOf("protocol" to listOf("dns"), "action" to "hijack-dns")
        rules += linkedMapOf("port" to listOf(53), "action" to "hijack-dns")
        rules += reject(linkedMapOf("port" to DesktopRoutingContract.ENCRYPTED_DNS_PORTS))
        // Cloud video wins over the broad Home parents (youtubei.googleapis.com vs googleapis.com).
        rules += route(linkedMapOf("network" to listOf("tcp"), "domain_suffix" to video), EXIT_TAG)
        rules += reject(linkedMapOf("network" to udpIcmp, "domain_suffix" to video))
        rules += route(linkedMapOf("network" to listOf("tcp"), "domain_suffix" to homeSuffixes), home)
        rules += reject(linkedMapOf("network" to udpIcmp, "domain_suffix" to homeSuffixes))
        rules += route(linkedMapOf("network" to listOf("tcp"), "ip_cidr" to DesktopRoutingContract.HOME_IPV4_CIDRS), home)
        rules += reject(linkedMapOf("network" to udpIcmp, "ip_cidr" to DesktopRoutingContract.HOME_IPV4_CIDRS))
        rules += route(linkedMapOf("network" to listOf("tcp"), "package_name" to AI_APP_PACKAGES), home)
        rules += reject(linkedMapOf("network" to udpIcmp, "package_name" to AI_APP_PACKAGES))
        if (protected.isNotEmpty()) {
            rules += route(linkedMapOf("network" to listOf("tcp"), "domain_suffix" to protected), EXIT_TAG)
            rules += reject(linkedMapOf("network" to udpIcmp, "domain_suffix" to protected))
        }
        val cloudCidrs = DesktopRoutingContract.CLOUD_IPV4_CIDRS + DesktopRoutingContract.CLOUD_IPV6_CIDRS
        rules += route(linkedMapOf("network" to listOf("tcp"), "ip_cidr" to cloudCidrs), EXIT_TAG)
        rules += reject(linkedMapOf("network" to udpIcmp, "ip_cidr" to cloudCidrs))
        if (cloudOnlyExact.isNotEmpty()) {
            rules += route(linkedMapOf("network" to listOf("tcp"), "domain" to cloudOnlyExact), EXIT_TAG)
            rules += reject(linkedMapOf("network" to udpIcmp, "domain" to cloudOnlyExact))
        }
        rules += route(linkedMapOf("network" to listOf("tcp"), "package_name" to CLOUD_APP_PACKAGES), EXIT_TAG)
        rules += reject(linkedMapOf("network" to udpIcmp, "package_name" to CLOUD_APP_PACKAGES))
        // A fake address without a live mapping (e.g. cached across a restart) never leaves the phone.
        rules += reject(linkedMapOf("ip_cidr" to listOf(FAKEIP_INET4, FAKEIP_INET6)))
        rules += route(linkedMapOf("ip_is_private" to true), DIRECT_TAG)
        // Overseas UDP and raw-IP STUN probes (e.g. 74.125.250.129:19302) are rejected in every mode
        // while domestic UDP (WeChat voice/video, Douyin QUIC, LAN cast) stays direct in Three-Tier.
        val overseasUdpCidrs = DesktopRoutingContract.OVERSEAS_UDP_REJECT_IPV4_CIDRS + DesktopRoutingContract.OVERSEAS_UDP_REJECT_IPV6_CIDRS
        rules += reject(linkedMapOf("network" to udpIcmp, "port" to DesktopRoutingContract.STUN_UDP_PORTS))
        rules += reject(linkedMapOf("network" to udpIcmp, "ip_cidr" to overseasUdpCidrs))
        if (!threeTier) rules += reject(linkedMapOf("network" to udpIcmp))

        val fakeipSuffixes = video + homeSuffixes + protected
        val dnsRules = ArrayList<Any?>()
        dnsRules += linkedMapOf("domain_suffix" to LOCAL_DNS_SUFFIXES, "action" to "route", "server" to DNS_LOCAL)
        dnsRules += linkedMapOf(
            "query_type" to listOf("A", "AAAA"), "domain_suffix" to fakeipSuffixes,
            "action" to "route", "server" to DNS_FAKEIP,
        )
        dnsRules += linkedMapOf(
            "domain_suffix" to fakeipSuffixes,
            "action" to "predefined", "rcode" to "NOERROR",
        )
        if (cloudOnlyExact.isNotEmpty()) {
            dnsRules += linkedMapOf("query_type" to listOf("A", "AAAA"), "domain" to cloudOnlyExact, "action" to "route", "server" to DNS_FAKEIP)
            dnsRules += linkedMapOf("domain" to cloudOnlyExact, "action" to "predefined", "rcode" to "NOERROR")
        }
        if (!threeTier) {
            // Stable: every public name leaves through the cloud, so the phone's resolver never sees it.
            dnsRules += linkedMapOf("query_type" to listOf("A", "AAAA"), "action" to "route", "server" to DNS_FAKEIP)
            dnsRules += linkedMapOf("action" to "predefined", "rcode" to "NOERROR")
        }
        if (!input.underlyingIpv6) {
            // No global IPv6 on the phone's network: DIRECT names answer IPv4 only, so apps do not stall on v6.
            dnsRules += linkedMapOf("query_type" to listOf("AAAA"), "action" to "predefined", "rcode" to "NOERROR")
        }

        val experimental = linkedMapOf<String, Any?>()
        input.cacheFilePath?.let {
            experimental["cache_file"] = linkedMapOf("enabled" to true, "path" to it, "store_fakeip" to true)
        }

        return linkedMapOf(
            "log" to linkedMapOf("level" to input.logLevel, "timestamp" to false),
            "dns" to linkedMapOf(
                "servers" to listOf(
                    linkedMapOf("type" to "local", "tag" to DNS_LOCAL),
                    linkedMapOf("type" to "fakeip", "tag" to DNS_FAKEIP, "inet4_range" to FAKEIP_INET4, "inet6_range" to FAKEIP_INET6),
                ),
                "rules" to dnsRules,
                "final" to DNS_LOCAL,
            ),
            "inbounds" to listOf(
                linkedMapOf(
                    "type" to "tun",
                    "tag" to TUN_TAG,
                    "address" to listOf(TUN_INET4, TUN_INET6),
                    "mtu" to 9000,
                    "auto_route" to true,
                    "route_exclude_address" to TUN_ROUTE_EXCLUDE,
                ),
            ),
            "outbounds" to outbounds,
            "route" to linkedMapOf(
                "rules" to rules,
                "final" to if (threeTier) DIRECT_TAG else EXIT_TAG,
                "auto_detect_interface" to true,
                "default_domain_resolver" to linkedMapOf("server" to DNS_LOCAL),
            ),
        ).also { if (experimental.isNotEmpty()) it["experimental"] = experimental }
    }

    fun buildJson(input: ConfigInput): String = Json.write(build(input))

    private fun vless(node: VlessNode): Map<String, Any?> = linkedMapOf<String, Any?>(
        "type" to "vless",
        "tag" to node.name,
        "server" to node.server,
        "server_port" to node.port,
        "uuid" to node.uuid,
    ).apply {
        node.flow?.let { put("flow", it) }
        put(
            "tls",
            linkedMapOf(
                "enabled" to true,
                "server_name" to node.serverName,
                "utls" to linkedMapOf("enabled" to true, "fingerprint" to node.fingerprint),
                "reality" to linkedMapOf("enabled" to true, "public_key" to node.realityPublicKey, "short_id" to node.realityShortId),
            ),
        )
    }

    private fun route(match: LinkedHashMap<String, Any?>, outbound: String) =
        match.apply { put("action", "route"); put("outbound", outbound) }

    private fun reject(match: LinkedHashMap<String, Any?>) = match.apply { put("action", "reject") }
}
