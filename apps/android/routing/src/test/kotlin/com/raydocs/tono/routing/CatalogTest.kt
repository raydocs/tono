package com.raydocs.tono.routing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CatalogTest {
    @Test
    fun parsesBlockAndFlowEntriesLikeTheDesktopFixture() {
        val text = javaClass.getResource("/desktop-multi-vless-reality.yaml")!!.readText()
        val nodes = CatalogAdmission.admitYaml(text)
        assertEquals(listOf("US Reality", "JP Reality"), nodes.map { it.name })
        assertEquals("fedcba9876543210", nodes[1].realityShortId)
        assertEquals("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", nodes[1].realityPublicKey)
        assertEquals("xtls-rprx-vision", nodes[1].flow)
    }

    @Test
    fun admitsSocksHomeAndKeepsHomeNodeOutOfCloudSelector() {
        val socksCatalog = Fixtures.catalog()
        assertTrue(socksCatalog.home is HomeTarget.Socks5)
        assertEquals(2, socksCatalog.cloudNodes.size)

        val nodeHome = Fixtures.catalog(CatalogRouting(homeProxy = "Los Angeles · Grove", defaultProxy = "Tokyo · Dawn"))
        assertEquals("Los Angeles · Grove", (nodeHome.home as HomeTarget.CatalogNode).node.name)
        assertEquals(listOf("Tokyo · Dawn"), nodeHome.cloudNodes.map { it.name })
        assertEquals("Tokyo · Dawn", nodeHome.defaultCloudNode)
    }

    @Test
    fun rejectsTamperedDigestsAndUnknownHome() {
        val body = Fixtures.body().toMutableMap()
        body["yaml"] = (body["yaml"] as String).replace("8.8.4.4", "8.8.8.8")
        assertEquals("CATALOG_DIGEST", assertThrows(CatalogRejected::class.java) { CatalogAdmission.admit(body) }.code)

        val routing = CatalogRouting(homeSocks5 = Fixtures.socks)
        val rotated = Fixtures.body(routing = routing).toMutableMap()
        rotated["routingSha256"] = CatalogAdmission.routingDigest(routing.copy(homeSocks5 = Fixtures.socks.copy(password = "old")))
        assertEquals("ROUTING_DIGEST", assertThrows(CatalogRejected::class.java) { CatalogAdmission.admit(rotated) }.code)

        val missingHome = Fixtures.body(routing = CatalogRouting(homeProxy = "Nowhere"))
        assertEquals("HOME_UNAVAILABLE", assertThrows(CatalogRejected::class.java) { CatalogAdmission.admit(missingHome) }.code)
    }

    @Test
    fun routingDigestMatchesControlPlaneRecipe() {
        // sha256("\n\n") base64url, the digest of the empty routing document served to unbound accounts.
        assertEquals(CatalogAdmission.base64UrlSha256("\n\n"), CatalogAdmission.routingDigest(null))
        val expected = CatalogAdmission.base64UrlSha256("\nTokyo · Dawn\n1.0.0.1\n1080\nhome-user\nhome-pass")
        assertEquals(expected, CatalogAdmission.routingDigest(CatalogRouting(defaultProxy = "Tokyo · Dawn", homeSocks5 = Fixtures.socks)))
    }

    @Test
    fun refusesUnsafeNodesAndSkipsHy2Blocks() {
        fun reject(line: String, code: String) {
            val yaml = Fixtures.yaml().replace("    server: 8.8.4.4", line)
            assertEquals(code, assertThrows(CatalogRejected::class.java) { CatalogAdmission.admitYaml(yaml) }.code)
        }
        reject("    server: 192.168.1.2", "NODE_SERVER")
        reject("    server: proxy.example.com", "NODE_SERVER")
        reject("    server: 8.8.4.4\n    skip-cert-verify: true", "NODE_TLS")
        val withHy2 = Fixtures.yaml("  - {name: Tokyo · Dawn · hy2, type: hysteria2, server: 8.8.4.4, port: 443, password: x}")
        assertEquals(2, CatalogAdmission.admitYaml(withHy2).size)
        val anchored = Fixtures.yaml("  - &a {name: X, type: vless}")
        assertEquals("CATALOG_YAML", assertThrows(CatalogRejected::class.java) { CatalogAdmission.admitYaml(anchored) }.code)
        val duplicate = Fixtures.yaml().replace("    port: 443\n", "    port: 443\n    port: 444\n")
        assertEquals("CATALOG_YAML", assertThrows(CatalogRejected::class.java) { CatalogAdmission.admitYaml(duplicate) }.code)
        // Tab-led indentation (pure tab or mixed with spaces) is ambiguous YAML and must fail closed.
        for (indent in listOf("\t", "  \t", "\t  ")) {
            val tabbed = Fixtures.yaml().replace("    port: 443\n", "${indent}port: 443\n")
            assertEquals("CATALOG_YAML", assertThrows(CatalogRejected::class.java) { CatalogAdmission.admitYaml(tabbed) }.code)
        }
    }

    @Test
    fun unboundAccountHasNoHomeTarget() {
        val catalog = Fixtures.catalog(routing = null)
        assertNull(catalog.home)
        assertEquals(SingBoxConfig.EXIT_TAG, SingBoxConfig.homeTargetTag(catalog))
    }
}
