package com.raydocs.tono.routing

import java.security.MessageDigest
import java.util.Base64
import java.util.Locale

/** One admitted cloud exit (VLESS + Reality over TCP), mirroring desktop `node::admit_node`. */
data class VlessNode(
    val name: String,
    val server: String,
    val port: Int,
    val uuid: String,
    val serverName: String,
    val flow: String?,
    val fingerprint: String,
    val realityPublicKey: String,
    val realityShortId: String,
) {
    /** "Tokyo · Dawn" → "Tokyo"; used only for presentation. */
    val city: String get() = name.substringBefore(" · ").trim()
    val label: String get() = name.substringAfter(" · ", name).trim()
    override fun toString(): String = "VlessNode($name)"
}

data class HomeSocks5(val host: String, val port: Int, val username: String, val password: String) {
    override fun toString(): String = "HomeSocks5(redacted)"
}

/** Per-account routing document served beside the catalog. */
data class CatalogRouting(
    val homeProxy: String? = null,
    val defaultProxy: String? = null,
    val homeSocks5: HomeSocks5? = null,
)

sealed interface HomeTarget {
    /** Residential SOCKS5 reached through the cloud exit (`Tono-Home-Residential`, detour `Tono-Exit`). */
    data class Socks5(val socks: HomeSocks5) : HomeTarget
    /** A catalog node reserved for this account as its Home exit. */
    data class CatalogNode(val node: VlessNode) : HomeTarget
}

data class ExitCatalog(
    val revision: Long,
    val sha256: String,
    val routingSha256: String?,
    val cloudNodes: List<VlessNode>,
    val home: HomeTarget?,
    val defaultCloudNode: String?,
) {
    /** Freshness key used for rollback refusal: (revision, sha256, routingSha256). */
    val key: String get() = "$revision/$sha256/${routingSha256 ?: "-"}"
}

class CatalogRejected(val code: String, message: String) : IllegalArgumentException(message)

object CatalogAdmission {
    const val MAX_NODES = 200
    const val HY2_SUFFIX = " · hy2"
    private const val REQUIRED_FLOW = "xtls-rprx-vision"
    private val RESERVED = setOf(
        "Tono-Exit", "Tono-Direct", "Tono-Web-Direct", "Tono-Claude-Home", SingBoxConfig.HOME_SOCKS_TAG,
        "DIRECT", "REJECT", "Tono-TUN", "Tono-DNS", "Tono-Mixed", "Tono-FakeIP", "Tono-DoH", "Tono-DoH-Backup",
        "Tono-Hosts", SingBoxConfig.DIRECT_TAG, SingBoxConfig.BLOCK_TAG,
    )
    private val UUID = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    private val BASE64URL_KEY = Regex("^[A-Za-z0-9_-]{43}$")
    private val HEX = Regex("^[0-9a-fA-F]*$")

    fun base64UrlSha256(text: String): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)))

    /** `routingSha256` recipe from control-plane `catalog.ts`. */
    fun routingDigest(routing: CatalogRouting?): String {
        val socks = routing?.homeSocks5
        return base64UrlSha256(
            listOf(
                routing?.homeProxy ?: "",
                routing?.defaultProxy ?: "",
                socks?.let { listOf(it.host, it.port.toString(), it.username, it.password).joinToString("\n") } ?: "",
            ).joinToString("\n"),
        )
    }

    /** Admits a parsed `GET /api/v1/exit-catalog` body. */
    fun admit(body: Map<String, Any?>): ExitCatalog {
        val yaml = body["yaml"] as? String ?: throw CatalogRejected("CATALOG_SHAPE", "missing yaml")
        val sha = body["sha256"] as? String ?: throw CatalogRejected("CATALOG_SHAPE", "missing sha256")
        val revision = (body["revision"] as? Number)?.toLong() ?: throw CatalogRejected("CATALOG_SHAPE", "missing revision")
        if (revision < 0) throw CatalogRejected("CATALOG_SHAPE", "negative revision")
        if (base64UrlSha256(yaml) != sha) throw CatalogRejected("CATALOG_DIGEST", "catalog digest mismatch")
        val routing = (body["routing"] as? Map<*, *>)?.let { parseRouting(it) }
        val routingSha = body["routingSha256"] as? String
        if (routingSha != null && routingDigest(routing) != routingSha) {
            throw CatalogRejected("ROUTING_DIGEST", "routing digest mismatch")
        }
        if (routing != null && routingSha == null) throw CatalogRejected("ROUTING_DIGEST", "routing without digest")
        val nodes = admitYaml(yaml)
        val home: HomeTarget? = when {
            routing?.homeSocks5 != null -> HomeTarget.Socks5(routing.homeSocks5)
            routing?.homeProxy != null -> HomeTarget.CatalogNode(
                nodes.firstOrNull { it.name == routing.homeProxy }
                    ?: throw CatalogRejected("HOME_UNAVAILABLE", "assigned home exit is not in the catalog"),
            )
            else -> null
        }
        val homeName = (home as? HomeTarget.CatalogNode)?.node?.name
        val cloud = nodes.filter { it.name != homeName }
        if (cloud.isEmpty()) throw CatalogRejected("CATALOG_EMPTY", "no cloud exit is available for this account")
        val default = routing?.defaultProxy?.takeIf { name -> cloud.any { it.name == name } }
        return ExitCatalog(revision, sha, routingSha, cloud, home, default)
    }

    fun admitYaml(yaml: String): List<VlessNode> {
        val root = try {
            CatalogYaml.parse(yaml)
        } catch (e: IllegalArgumentException) {
            throw CatalogRejected("CATALOG_YAML", e.message ?: "unreadable catalog")
        }
        val proxies = (root as? Map<*, *>)?.get("proxies") as? List<*>
            ?: throw CatalogRejected("CATALOG_YAML", "catalog has no proxies list")
        val nodes = proxies.mapNotNull { item ->
            val map = item as? Map<*, *> ?: throw CatalogRejected("CATALOG_YAML", "proxy entry is not a mapping")
            val name = (map["name"] as? String)?.trim().orEmpty()
            if (map["type"] == "hysteria2" || name.endsWith(HY2_SUFFIX)) null else admitNode(map)
        }
        if (nodes.size > MAX_NODES) throw CatalogRejected("CATALOG_SIZE", "too many nodes")
        val names = HashSet<String>()
        nodes.forEach { if (it.name in RESERVED || !names.add(it.name)) throw CatalogRejected("NODE_NAME", "duplicate or reserved node name") }
        return nodes
    }

    fun admitNode(map: Map<*, *>): VlessNode {
        fun s(key: String): String? = (map[key] as? String)?.trim()?.takeIf { it.isNotEmpty() }
        val name = s("name") ?: throw CatalogRejected("NODE_NAME", "missing name")
        if (name.length > 128 || name.any { it.isISOControl() }) throw CatalogRejected("NODE_NAME", "bad name")
        if (s("type") != "vless") throw CatalogRejected("NODE_TYPE", "only VLESS Reality nodes are supported")
        if (s("tls") != "true") throw CatalogRejected("NODE_TLS", "TLS must be enabled")
        if (s("skip-cert-verify") == "true") throw CatalogRejected("NODE_TLS", "skip-cert-verify is forbidden")
        val uuid = s("uuid")?.takeIf { UUID.matches(it) }?.lowercase(Locale.ROOT) ?: throw CatalogRejected("NODE_UUID", "bad uuid")
        val reality = map["reality-opts"] as? Map<*, *> ?: throw CatalogRejected("NODE_REALITY", "missing reality-opts")
        val publicKey = (reality["public-key"] as? String)?.trim()?.takeIf { BASE64URL_KEY.matches(it) }
            ?: throw CatalogRejected("NODE_REALITY", "bad reality public key")
        val shortId = (reality["short-id"] as? String)?.trim()?.takeIf { it.isNotEmpty() && it.length <= 16 && it.length % 2 == 0 && HEX.matches(it) }
            ?: throw CatalogRejected("NODE_REALITY", "bad reality short id")
        val serverName = normalizeSni(s("servername") ?: s("sni")) ?: throw CatalogRejected("NODE_SNI", "bad servername")
        val flow = when (val f = s("flow")) {
            null -> null
            REQUIRED_FLOW -> REQUIRED_FLOW
            else -> throw CatalogRejected("NODE_FLOW", "unsupported flow $f")
        }
        s("network")?.let { if (!it.equals("tcp", ignoreCase = true)) throw CatalogRejected("NODE_NETWORK", "unsupported network") }
        val port = s("port")?.toIntOrNull()?.takeIf { it in 1..65535 } ?: throw CatalogRejected("NODE_PORT", "bad port")
        val server = s("server")?.takeIf { Net.isPublicIpv4(it) } ?: throw CatalogRejected("NODE_SERVER", "server must be a public IPv4 literal")
        val fingerprint = s("client-fingerprint")?.takeIf { it.length <= 64 && it.none(Char::isISOControl) } ?: "chrome"
        return VlessNode(name, server, port, uuid, serverName, flow, fingerprint, publicKey, shortId.lowercase(Locale.ROOT))
    }

    private fun parseRouting(map: Map<*, *>): CatalogRouting {
        val socks = (map["homeSocks5"] as? Map<*, *>)?.let { s ->
            val host = (s["host"] as? String)?.trim()
            val port = (s["port"] as? Number)?.toInt()
            val user = s["username"] as? String
            val pass = s["password"] as? String
            if (host == null || !(Net.isPublicIpv4(host) || Net.isPublicHostname(host)) || port == null || port !in 1..65535 ||
                user.isNullOrEmpty() || pass.isNullOrEmpty() || user.length > 255 || pass.length > 255
            ) throw CatalogRejected("HOME_SOCKS", "assigned home exit is malformed")
            HomeSocks5(host, port, user, pass)
        }
        fun name(key: String) = (map[key] as? String)?.takeIf { it.isNotBlank() }
        return CatalogRouting(homeProxy = name("homeProxy"), defaultProxy = name("defaultProxy"), homeSocks5 = socks)
    }

    private fun normalizeSni(raw: String?): String? {
        val host = raw?.trim()?.lowercase(Locale.ROOT)?.trim('.') ?: return null
        if (host.isEmpty() || host.length > 253 || host.contains('%') || host.any { it.code !in 0x21..0x7e }) return null
        if (Net.parseIpv4(host) != null) return host
        val labels = host.split('.')
        if (labels.size < 2) return null
        return host.takeIf {
            labels.all { l -> l.length in 1..63 && !l.startsWith('-') && !l.endsWith('-') && l.all { c -> c in 'a'..'z' || c in '0'..'9' || c == '-' } }
        }
    }
}

object Net {
    fun parseIpv4(text: String): IntArray? {
        val parts = text.split('.')
        if (parts.size != 4) return null
        return IntArray(4) { i ->
            val p = parts[i]
            if (p.isEmpty() || p.length > 3 || !p.all(Char::isDigit) || (p.length > 1 && p[0] == '0')) return null
            p.toInt().takeIf { it <= 255 } ?: return null
        }
    }

    /** Desktop `node::is_public_ipv4`: no private, loopback, CGNAT, link-local, benchmark, documentation or multicast. */
    fun isPublicIpv4(text: String): Boolean {
        val b = parseIpv4(text) ?: return false
        return !(b[0] == 0 || b[0] == 10 || b[0] == 127 || b[0] >= 224 ||
            (b[0] == 100 && b[1] in 64..127) || (b[0] == 169 && b[1] == 254) ||
            (b[0] == 172 && b[1] in 16..31) || (b[0] == 192 && b[1] == 168) ||
            (b[0] == 192 && b[1] == 0 && b[2] == 0) || (b[0] == 192 && b[1] == 0 && b[2] == 2) ||
            (b[0] == 198 && (b[1] == 18 || b[1] == 19)) || (b[0] == 198 && b[1] == 51 && b[2] == 100) ||
            (b[0] == 203 && b[1] == 0 && b[2] == 113) ||
            (b[0] == 192 && b[1] == 31 && b[2] == 196) || (b[0] == 192 && b[1] == 52 && b[2] == 193) ||
            (b[0] == 192 && b[1] == 88 && b[2] == 99) || (b[0] == 192 && b[1] == 175 && b[2] == 48))
    }

    /**
     * Desktop `publicHostname`: Home lines are usually a provider gateway name (`isp.decodo.com`), dialled
     * through `Tono-Exit`, so the cloud node resolves it. Only an ordinary lowercase DNS name, never a
     * special-use suffix or an all-numeric form that inet_aton reads as an IP (`127.0.0.0x1`).
     */
    fun isPublicHostname(text: String): Boolean {
        val labels = text.split('.')
        if (text.length > 253 || labels.size < 2 ||
            !labels.all { l -> l.length in 1..63 && !l.startsWith('-') && !l.endsWith('-') && l.all { c -> c in 'a'..'z' || c in '0'..'9' || c == '-' } } ||
            labels.last().none { it in 'a'..'z' }
        ) return false
        val numeric = labels.all { l ->
            val hex = l.startsWith("0x")
            l.removePrefix("0x").all { c -> c in '0'..'9' || (hex && c in 'a'..'f') }
        }
        val reserved = listOf("localhost", "local", "internal", "arpa", "invalid", "onion", "alt", "test", "example",
            "example.com", "example.net", "example.org")
        return !numeric && reserved.none { text == it || text.endsWith(".$it") } && labels.first() != "localhost"
    }

    fun ipv4InCidr(ip: String, cidr: String): Boolean {
        val a = parseIpv4(ip) ?: return false
        val (base, bitsText) = cidr.split('/').let { it[0] to it.getOrElse(1) { "32" } }
        val b = parseIpv4(base) ?: return false
        val bits = bitsText.toInt()
        val av = a.fold(0L) { acc, x -> (acc shl 8) or x.toLong() }
        val bv = b.fold(0L) { acc, x -> (acc shl 8) or x.toLong() }
        val mask = if (bits == 0) 0L else (0xffffffffL shl (32 - bits)) and 0xffffffffL
        return (av and mask) == (bv and mask)
    }
}
