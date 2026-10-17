package com.raydocs.tono.routing

/**
 * Evaluates the generated route rules for one connection, the same first-match way sing-box does.
 * Used by tests and by the in-app "where does this go?" check. It understands exactly the rule
 * items [SingBoxConfig] emits; an unknown item fails loudly instead of guessing.
 */
object RouteExplainer {
    data class Connection(
        /** Name known from a fake-IP mapping or a sniffed TLS/HTTP/QUIC name; null for raw-IP dials without SNI. */
        val domain: String? = null,
        val ip: String? = null,
        val port: Int = 443,
        val network: String = "tcp",
        val packageName: String? = null,
        val dns: Boolean = false,
    )

    sealed interface Verdict {
        data class Route(val outbound: String, val ruleIndex: Int) : Verdict
        data class Reject(val ruleIndex: Int) : Verdict
        data object HijackDns : Verdict
    }

    fun explain(config: Map<String, Any?>, c: Connection): Verdict {
        val route = config["route"].asObject()
        route["rules"].asArray().forEachIndexed { index, raw ->
            val rule = raw.asObject()
            val action = rule["action"] as String
            if (action == "sniff") return@forEachIndexed
            if (matches(rule, c)) {
                return when (action) {
                    "hijack-dns" -> Verdict.HijackDns
                    "route" -> Verdict.Route(rule["outbound"] as String, index)
                    "reject" -> Verdict.Reject(index)
                    else -> error("unsupported action $action")
                }
            }
        }
        return Verdict.Route(route["final"] as String, -1)
    }

    /** Which DNS server answers an A/AAAA query, or "predefined" for a synthesized empty answer. */
    fun dnsServer(config: Map<String, Any?>, domain: String, queryType: String): String {
        val dns = config["dns"].asObject()
        dns["rules"].asArray().forEach { raw ->
            val rule = raw.asObject()
            val types = (rule["query_type"] as? List<*>)?.map { it as String }
            val ok = (types == null || queryType in types) &&
                (rule["domain_suffix"]?.let { suffixMatch(domain, it.asArray()) } ?: true) &&
                (rule["domain"]?.let { domain in it.asArray() } ?: true)
            val known = setOf("query_type", "domain_suffix", "domain", "action", "server", "rcode")
            require(rule.keys.all { it in known }) { "unsupported DNS rule item ${rule.keys - known}" }
            if (ok) return if (rule["action"] == "predefined") "predefined" else rule["server"] as String
        }
        return dns["final"] as String
    }

    private fun matches(rule: Map<String, Any?>, c: Connection): Boolean {
        for ((key, value) in rule) {
            val ok = when (key) {
                "action", "outbound" -> true
                "inbound" -> true
                "protocol" -> c.dns && "dns" in value.asArray()
                "port" -> c.port.toLong() in value.asArray().map { (it as Number).toLong() }
                "network" -> c.network in value.asArray()
                "domain_suffix" -> c.domain != null && suffixMatch(c.domain, value.asArray())
                "domain" -> c.domain != null && c.domain.lowercase() in value.asArray()
                "ip_cidr" -> c.ip != null && value.asArray().any { cidrMatch(c.ip, it as String) }
                "ip_is_private" -> c.ip != null && isPrivate(c.ip) == value
                "package_name" -> c.packageName != null && c.packageName in value.asArray()
                else -> error("unsupported rule item $key")
            }
            if (!ok) return false
        }
        return true
    }

    fun suffixMatch(domain: String, suffixes: List<Any?>): Boolean {
        val host = domain.lowercase().trimEnd('.')
        return suffixes.any { s -> val suffix = s as String; host == suffix || host.endsWith(".$suffix") }
    }

    private fun cidrMatch(ip: String, cidr: String): Boolean =
        if (':' in ip || ':' in cidr) ':' in ip && ':' in cidr && ipv6InCidr(ip, cidr) else Net.ipv4InCidr(ip, cidr)

    private fun isPrivate(ip: String): Boolean = if (':' in ip) {
        val first = ip.lowercase()
        first.startsWith("fc") || first.startsWith("fd") || first.startsWith("fe8") || first == "::1"
    } else {
        listOf("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16", "100.64.0.0/10")
            .any { Net.ipv4InCidr(ip, it) }
    }

    private fun ipv6InCidr(ip: String, cidr: String): Boolean {
        val (base, bits) = cidr.split('/').let { it[0] to it[1].toInt() }
        val a = java.net.InetAddress.getByName(ip).address
        val b = java.net.InetAddress.getByName(base).address
        if (a.size != 16 || b.size != 16) return false
        for (i in 0 until bits) {
            val mask = 0x80 ushr (i % 8)
            if ((a[i / 8].toInt() and mask) != (b[i / 8].toInt() and mask)) return false
        }
        return true
    }
}
