package com.raydocs.tono.routing

object Fixtures {
    const val UUID_PLACEHOLDER_FREE = "11111111-1111-4111-8111-111111111111"

    fun yaml(vararg extra: String) = buildString {
        appendLine("# fixture with documentation-free public addresses")
        appendLine("proxies:")
        appendLine("  - name: Tokyo · Dawn")
        appendLine("    type: vless")
        appendLine("    server: 8.8.4.4")
        appendLine("    port: 443")
        appendLine("    uuid: $UUID_PLACEHOLDER_FREE")
        appendLine("    network: tcp")
        appendLine("    tls: true")
        appendLine("    udp: true")
        appendLine("    servername: alpha.example")
        appendLine("    client-fingerprint: chrome")
        appendLine("    flow: xtls-rprx-vision")
        appendLine("    reality-opts:")
        appendLine("      public-key: 3p7bfXt9wbTTW2HC7OQ1Nz-DQ8hbeGdNrfx-FG-IK08")
        appendLine("      short-id: a1b2")
        appendLine("  - {name: \"Los Angeles · Grove\", type: vless, server: 9.9.9.9, port: 8443, uuid: 22222222-2222-4222-8222-222222222222, tls: true, servername: beta.example, reality-opts: {public-key: 3p7bfXt9wbTTW2HC7OQ1Nz-DQ8hbeGdNrfx-FG-IK08, short-id: c3d4e5}}")
        extra.forEach { appendLine(it) }
    }

    fun body(yaml: String = yaml(), routing: CatalogRouting? = null, includeRoutingDigest: Boolean = true): Map<String, Any?> {
        val map = linkedMapOf<String, Any?>(
            "revision" to 7L,
            "yaml" to yaml,
            "sha256" to CatalogAdmission.base64UrlSha256(yaml),
        )
        if (includeRoutingDigest) map["routingSha256"] = CatalogAdmission.routingDigest(routing)
        if (routing != null) {
            map["routing"] = linkedMapOf<String, Any?>().apply {
                routing.homeProxy?.let { put("homeProxy", it) }
                routing.defaultProxy?.let { put("defaultProxy", it) }
                routing.homeSocks5?.let { put("homeSocks5", linkedMapOf("host" to it.host, "port" to it.port.toLong(), "username" to it.username, "password" to it.password)) }
            }
        }
        return map
    }

    val socks = HomeSocks5("1.0.0.1", 1080, "home-user", "home-pass")

    fun catalog(routing: CatalogRouting? = CatalogRouting(homeSocks5 = socks)) = CatalogAdmission.admit(body(routing = routing))

    fun config(
        mode: RoutingMode = RoutingMode.THREE_TIER,
        routing: CatalogRouting? = CatalogRouting(homeSocks5 = socks),
        ipv6: Boolean = true,
    ) = SingBoxConfig.build(ConfigInput(catalog(routing), null, mode, ipv6, "/data/cache.db"))
}
