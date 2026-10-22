package com.raydocs.tono.routing

import com.raydocs.tono.routing.RouteExplainer.Connection
import com.raydocs.tono.routing.RouteExplainer.Verdict
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RoutingPolicyTest {
    private val threeTier = Fixtures.config()
    private val stable = Fixtures.config(mode = RoutingMode.STABLE)
    private val home = SingBoxConfig.HOME_SOCKS_TAG
    private val exit = SingBoxConfig.EXIT_TAG
    private val direct = SingBoxConfig.DIRECT_TAG

    private fun outbound(config: Map<String, Any?>, c: Connection): String = when (val v = RouteExplainer.explain(config, c)) {
        is Verdict.Route -> v.outbound
        is Verdict.Reject -> "reject"
        Verdict.HijackDns -> "dns"
    }

    @Test
    fun videoExceptionBeatsBroadHomeParent() {
        assertEquals(exit, outbound(threeTier, Connection(domain = "youtubei.googleapis.com")))
        assertEquals(home, outbound(threeTier, Connection(domain = "generativelanguage.googleapis.com")))
        assertEquals(home, outbound(threeTier, Connection(domain = "googleapis.com")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "rr3---sn-a5mekn6d.googlevideo.com")))
    }

    @Test
    fun matchedUdpIsRejectedNeverDirect() {
        assertEquals("reject", outbound(threeTier, Connection(domain = "claude.ai", network = "udp")))
        assertEquals("reject", outbound(threeTier, Connection(domain = "www.youtube.com", network = "udp")))
        assertEquals("reject", outbound(threeTier, Connection(ip = "160.79.104.10", network = "udp")))
        assertEquals("reject", outbound(threeTier, Connection(ip = "203.0.114.9", packageName = "com.openai.chatgpt", network = "udp")))
    }

    @Test
    fun rawAnthropicAddressAndAiAppsFollowHome() {
        assertEquals(home, outbound(threeTier, Connection(ip = "160.79.104.10")))
        assertEquals(direct, outbound(threeTier, Connection(ip = "160.79.112.1")))
        assertEquals(home, outbound(threeTier, Connection(ip = "34.1.2.3", packageName = "com.anthropic.claude")))
        // Video still wins inside an AI app.
        assertEquals(exit, outbound(threeTier, Connection(domain = "www.youtube.com", packageName = "com.anthropic.claude")))
    }

    @Test
    fun ordinaryTrafficStaysLocalInThreeTierAndCloudInStable() {
        assertEquals(direct, outbound(threeTier, Connection(domain = "www.bilibili.com")))
        assertEquals(direct, outbound(threeTier, Connection(ip = "220.181.38.148", port = 8080)))
        assertEquals(direct, outbound(threeTier, Connection(domain = "quic.example.cn", network = "udp")))
        assertEquals(exit, outbound(stable, Connection(domain = "www.bilibili.com")))
        assertEquals("reject", outbound(stable, Connection(domain = "quic.example.cn", network = "udp")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "www.cloudflare.com")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "api.tono.app")))
    }

    @Test
    fun xWebApiAndMediaUseCloudWithoutWideningGrokOrProviderTrees() {
        // Exact first-party services, not x.com/twitter.com/twimg.com suffixes or shared CDNs.
        assertEquals(exit, outbound(threeTier, Connection(domain = "x.com")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "www.x.com")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "mobile.x.com")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "api.x.com")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "twitter.com")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "www.twitter.com")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "mobile.twitter.com")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "api.twitter.com")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "upload.twitter.com")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "abs.twimg.com")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "pbs.twimg.com")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "video.twimg.com")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "t.co")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "api.x.com", packageName = "com.twitter.android")))
        assertEquals("reject", outbound(threeTier, Connection(domain = "x.com", network = "udp")))
        assertEquals("reject", outbound(threeTier, Connection(domain = "pbs.twimg.com", network = "udp")))
        assertEquals("reject", outbound(threeTier, Connection(domain = "t.co", network = "icmp")))
        assertEquals("fakeip", RouteExplainer.dnsServer(threeTier, "x.com", "A"))
        assertEquals("fakeip", RouteExplainer.dnsServer(threeTier, "api.twitter.com", "AAAA"))
        assertEquals("fakeip", RouteExplainer.dnsServer(threeTier, "pbs.twimg.com", "A"))
        assertEquals("fakeip", RouteExplainer.dnsServer(threeTier, "t.co", "AAAA"))
        assertEquals("fakeip", RouteExplainer.dnsServer(Fixtures.config(ipv6 = false), "api.x.com", "AAAA"))
        assertEquals(home, outbound(threeTier, Connection(domain = "grok.x.com")))
        assertEquals(home, outbound(threeTier, Connection(domain = "api.grok.x.com")))
        assertEquals(home, outbound(threeTier, Connection(domain = "grok.com")))
        assertEquals("fakeip", RouteExplainer.dnsServer(threeTier, "grok.x.com", "A"))
        assertEquals("reject", outbound(threeTier, Connection(domain = "grok.x.com", network = "udp")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "youtubei.googleapis.com", packageName = "ai.x.grok")))
        assertEquals(home, outbound(threeTier, Connection(domain = "api.x.com", packageName = "ai.x.grok")))
        assertEquals(direct, outbound(threeTier, Connection(domain = "unreviewed.x.com")))
        assertEquals(direct, outbound(threeTier, Connection(domain = "unreviewed.twitter.com")))
        assertEquals(direct, outbound(threeTier, Connection(domain = "unreviewed.twimg.com")))
        assertEquals(direct, outbound(threeTier, Connection(domain = "twimg.com")))
        assertEquals(direct, outbound(threeTier, Connection(domain = "x.com.example.net")))
        assertEquals(direct, outbound(threeTier, Connection(domain = "unrelated.akamaized.net")))
        assertEquals("local", RouteExplainer.dnsServer(threeTier, "unreviewed.x.com", "A"))
        // No process-wide X pin: a raw-IP dial without a recovered name retains the mode boundary.
        assertEquals(direct, outbound(threeTier, Connection(ip = "203.0.114.9", packageName = "com.twitter.android")))
        assertEquals(exit, outbound(stable, Connection(domain = "x.com")))
        assertEquals(exit, outbound(stable, Connection(domain = "api.twitter.com")))
        assertEquals(exit, outbound(stable, Connection(domain = "pbs.twimg.com")))
        assertEquals("reject", outbound(stable, Connection(domain = "x.com", network = "udp")))
        assertEquals("fakeip", RouteExplainer.dnsServer(stable, "pbs.twimg.com", "AAAA"))
        assertEquals(home, outbound(stable, Connection(domain = "grok.x.com")))
        assertEquals("local", RouteExplainer.dnsServer(stable, "printer.local", "A"))
    }

    @Test
    fun lanDnsAndStaleFakeAddresses() {
        assertEquals(direct, outbound(threeTier, Connection(ip = "192.168.1.20", port = 445)))
        assertEquals(direct, outbound(stable, Connection(ip = "fd12::5", port = 22)))
        assertEquals("dns", outbound(threeTier, Connection(ip = "198.18.0.2", port = 53, network = "udp")))
        assertEquals("reject", outbound(threeTier, Connection(ip = "198.18.200.7")))
        assertEquals("reject", outbound(stable, Connection(ip = "fc00::1234")))
    }

    @Test
    fun withoutHomeBindingAiUsesCloudNotDirect() {
        val unbound = Fixtures.config(routing = null)
        assertEquals(exit, outbound(unbound, Connection(domain = "claude.ai")))
        assertEquals(exit, outbound(unbound, Connection(ip = "160.79.104.10")))
        val nodeHome = Fixtures.config(routing = CatalogRouting(homeProxy = "Los Angeles · Grove"))
        assertEquals("Los Angeles · Grove", outbound(nodeHome, Connection(domain = "chatgpt.com")))
    }

    @Test
    fun everyProtectedSuffixFailsClosedInEveryMode() {
        val lists = DesktopRoutingContract.HOME_SUFFIXES + DesktopRoutingContract.CLOUD_VIDEO_SUFFIXES +
            DesktopRoutingContract.PROTECTED_DIRECT_SUFFIXES
        for (config in listOf(threeTier, stable, Fixtures.config(routing = null))) {
            for (suffix in lists) for (host in listOf(suffix, "a.b.$suffix")) {
                assertTrue("$host tcp", outbound(config, Connection(domain = host)) !in setOf(direct, "reject"))
                assertEquals("$host udp", "reject", outbound(config, Connection(domain = host, network = "udp", port = 443)))
            }
        }
    }

    @Test
    fun dnsAnswersFakeForMatchedNamesAndLocalOtherwise() {
        assertEquals("fakeip", RouteExplainer.dnsServer(threeTier, "claude.ai", "A"))
        assertEquals("fakeip", RouteExplainer.dnsServer(threeTier, "i.ytimg.com", "AAAA"))
        assertEquals("local", RouteExplainer.dnsServer(threeTier, "www.baidu.com", "A"))
        assertEquals("local", RouteExplainer.dnsServer(threeTier, "www.baidu.com", "AAAA"))
        assertEquals("local", RouteExplainer.dnsServer(stable, "printer.local", "A"))
        assertEquals("fakeip", RouteExplainer.dnsServer(stable, "www.baidu.com", "A"))
        val noV6 = Fixtures.config(ipv6 = false)
        assertEquals("predefined", RouteExplainer.dnsServer(noV6, "www.baidu.com", "AAAA"))
        assertEquals("fakeip", RouteExplainer.dnsServer(noV6, "claude.ai", "AAAA"))
    }

    @Test
    fun configCarriesTunAndOutboundContract() {
        val outbounds = threeTier["outbounds"].asArray().map { it.asObject() }
        val socks = outbounds.single { it["type"] == "socks" }
        assertEquals(exit, socks["detour"])
        assertEquals("tcp", socks["network"])
        val selector = outbounds.single { it["tag"] == exit }
        assertEquals(listOf("Tokyo · Dawn", "Los Angeles · Grove"), selector["outbounds"])
        val tun = threeTier["inbounds"].asArray().single().asObject()
        assertEquals(listOf(SingBoxConfig.TUN_INET4, SingBoxConfig.TUN_INET6), tun["address"])
        assertTrue("192.168.0.0/16" in tun["route_exclude_address"].asArray())
        assertTrue(outbounds.none { it["type"] == "vless" && (it["tls"].asObject()["insecure"] == true) })
        // The JSON writer round-trips through the strict parser.
        assertEquals(Json.write(threeTier), Json.write(Json.parse(Json.write(threeTier))))
    }
}
