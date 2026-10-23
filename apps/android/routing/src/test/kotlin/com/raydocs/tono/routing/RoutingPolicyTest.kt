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
    fun overseasUdpAndStunAreRejectedWhileDomesticUdpStaysDirectInThreeTier() {
        assertEquals(listOf(19302, 19303, 19304, 19305, 19306, 19307, 19308, 19309), DesktopRoutingContract.STUN_UDP_PORTS)
        assertEquals(listOf(853), DesktopRoutingContract.ENCRYPTED_DNS_PORTS)
        assertEquals(listOf("stun.cloudflare.com", "turn.cloudflare.com", "global.stun.twilio.com", "stun.services.mozilla.com", "stunprotocol.org"), DesktopRoutingContract.PUBLIC_STUN_SUFFIXES)
        assertEquals(60, DesktopRoutingContract.MOBILE_HOME_AUX_SUFFIXES.size)
        assertEquals(listOf("x.com", "twitter.com", "twimg.com", "t.co", "pscp.tv", "periscope.tv", "twtrdns.net", "cms-twdigitalassets.com", "vine.co", "twitpic.com"), DesktopRoutingContract.X_CLOUD_SUFFIXES)
        assertEquals(52, DesktopRoutingContract.OVERSEAS_CLOUD_SUFFIXES.size)
        assertEquals(6, DesktopRoutingContract.CLOUD_IPV4_CIDRS.size)
        assertEquals(3, DesktopRoutingContract.CLOUD_IPV6_CIDRS.size)
        assertEquals(33, DesktopRoutingContract.OVERSEAS_UDP_REJECT_IPV4_CIDRS.size)
        assertEquals(21, DesktopRoutingContract.OVERSEAS_UDP_REJECT_IPV6_CIDRS.size)

        for (config in listOf(threeTier, stable)) {
            for (port in DesktopRoutingContract.STUN_UDP_PORTS) {
                assertEquals("reject", outbound(config, Connection(ip = "74.125.250.129", port = port, network = "udp")))
                assertEquals("reject", outbound(config, Connection(domain = "stun1.l.google.com", port = port, network = "udp")))
            }
            for (ip in listOf("74.125.250.129", "142.250.80.46", "172.217.160.142", "8.8.8.8", "1.1.1.1", "9.9.9.9", "149.112.112.112", "208.67.222.222", "208.67.220.220", "104.16.132.229", "160.79.104.10", "151.101.1.69", "149.154.167.91", "157.240.22.35", "2001:4860:4864:5:8000::1", "2001:4860:4860::8888", "2606:4700:4700::1111", "2620:fe::fe", "2620:119:35::35", "2607:6bc0::10", "2a04:4e40::1", "2a03:2880:f100:83:face:b00c:0:25de", "2001:67c:4e8:f002::a")) {
                for (port in listOf(53, 443, 3478, 5349)) {
                    val expected = if (port == 53) "dns" else "reject"
                    assertEquals(expected, outbound(config, Connection(ip = ip, port = port, network = "udp")))
                }
            }
            for (stunHost in DesktopRoutingContract.PUBLIC_STUN_SUFFIXES) {
                assertEquals("reject", outbound(config, Connection(domain = stunHost, port = 3478, network = "udp")))
                assertEquals(exit, outbound(config, Connection(domain = stunHost, port = 443, network = "tcp")))
                assertEquals("fakeip", RouteExplainer.dnsServer(config, stunHost, "A"))
                assertEquals("predefined", RouteExplainer.dnsServer(config, stunHost, "HTTPS"))
            }
            for (net in listOf("tcp", "udp")) {
                assertEquals("reject", outbound(config, Connection(ip = "8.8.8.8", port = 853, network = net)))
                assertEquals("reject", outbound(config, Connection(domain = "dns.google", port = 853, network = net)))
            }
        }

        // Claude auxiliary auth, fingerprinting, captcha, Apple Sign-In, telemetry, and SSO domains route to Home on TCP, reject UDP, and use FakeIP DNS.
        for (host in listOf(
            "intercom.io", "widget.intercom.io", "js.intercomcdn.com", "intercomassets.com", "intercom-mail.com",
            "arkoselabs.com", "client-api.arkoselabs.com", "funcaptcha.com", "funcaptcha.co",
            "workos.com", "auth.workos.com", "authkit.app", "workos.imgix.net",
            "statsig.com", "featureassets.org", "prodregistryv2.org", "beyondwickedmapping.org",
            "fpjs.io", "api.fpjs.io", "fpnpmcdn.net", "openfpcdn.io", "fingerprint.com",
            "sift.com", "siftscience.com", "sardine.ai", "castle.io",
            "recaptcha.net", "www.recaptcha.net",
            "appleid.apple.com", "idmsa.apple.com", "appleid.cdn-apple.com", "gsa.apple.com",
            "segment.io", "api.segment.io", "segment.com", "launchdarkly.com", "app.launchdarkly.com",
            "posthog.com", "amplitude.com", "logrocket.com", "lr-ingest.com", "lr-in.com", "lr-in-prod.com", "honeybadger.io",
            "stytch.com", "stytch.io", "auth0.com", "tenant.auth0.com", "okta.com",
            "modelcontextprotocol.io", "anthropicstatus.com", "claudecode.com", "claude.codes",
            "gstatic.com", "fonts.gstatic.com", "www.gstatic.com",
            "googleusercontent.com", "lh3.googleusercontent.com", "1e100.net", "gvt1.com", "gvt2.com",
            "google.com.hk", "google.co.jp", "google.com.sg", "google.co.uk", "android.com", "g.co", "goo.gl",
            "whatsapp.com", "web.whatsapp.com", "whatsapp.net", "g.whatsapp.net", "wa.me",
            "livekit.cloud", "chatgpt.livekit.cloud",
        )) {
            assertEquals(home, outbound(threeTier, Connection(domain = host, port = 443, network = "tcp")))
            assertEquals("reject", outbound(threeTier, Connection(domain = host, port = 443, network = "udp")))
            assertEquals("fakeip", RouteExplainer.dnsServer(threeTier, host, "A"))
            assertEquals("fakeip", RouteExplainer.dnsServer(threeTier, host, "AAAA"))
            assertEquals("predefined", RouteExplainer.dnsServer(threeTier, host, "HTTPS"))
            assertEquals("predefined", RouteExplainer.dnsServer(threeTier, host, "SVCB"))
        }

        // Domestic UDP (Douyin QUIC, WeChat voice/video, smart home P2P, NTP, LAN cast, 5G IPv6) stays direct in Three-Tier.
        assertEquals(direct, outbound(threeTier, Connection(domain = "quic.example.cn", port = 443, network = "udp")))
        assertEquals(direct, outbound(threeTier, Connection(domain = "weixin.qq.com", port = 8000, network = "udp")))
        assertEquals(direct, outbound(threeTier, Connection(ip = "101.1.2.6", port = 8000, network = "udp")))
        assertEquals(direct, outbound(threeTier, Connection(ip = "43.146.27.17", port = 8000, network = "udp")))
        assertEquals(direct, outbound(threeTier, Connection(ip = "223.5.5.5", port = 3478, network = "udp")))
        assertEquals(direct, outbound(threeTier, Connection(ip = "114.114.114.114", port = 123, network = "udp")))
        assertEquals(direct, outbound(threeTier, Connection(ip = "192.168.1.20", port = 5353, network = "udp")))
        assertEquals(direct, outbound(threeTier, Connection(ip = "2408:8207:1800::1", port = 443, network = "udp")))
        assertEquals(direct, outbound(threeTier, Connection(ip = "2409:8080:1000::1", port = 8000, network = "udp")))
        assertEquals(direct, outbound(threeTier, Connection(ip = "fe80::1", port = 5353, network = "udp")))
    }

    @Test
    fun rawAnthropicAddressAndAiAppsFollowHome() {
        assertEquals(home, outbound(threeTier, Connection(ip = "160.79.104.10")))
        assertEquals(direct, outbound(threeTier, Connection(ip = "160.79.112.1")))
        assertEquals(home, outbound(threeTier, Connection(ip = "34.1.2.3", packageName = "com.anthropic.claude")))
        assertEquals(home, outbound(threeTier, Connection(ip = "34.1.2.3", packageName = "ai.perplexity.app.android")))
        assertEquals(home, outbound(threeTier, Connection(ip = "34.1.2.3", packageName = "com.google.android.apps.bard")))
        assertEquals("reject", outbound(threeTier, Connection(ip = "34.1.2.3", packageName = "ai.perplexity.app.android", network = "udp")))
        // Video still wins inside an AI app, and youtubei.googleapis.com / yt3.googleusercontent.com still beat googleusercontent.com.
        assertEquals(exit, outbound(threeTier, Connection(domain = "www.youtube.com", packageName = "com.anthropic.claude")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "yt3.googleusercontent.com")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "yt3.ggpht.com")))
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
        // Full X domain suffixes route to Cloud (Tono-Exit) while grok.x.com / grok.com / x.ai precede x.com and stay on Home.
        for (host in listOf(
            "x.com", "www.x.com", "mobile.x.com", "api.x.com", "upload.x.com", "sso.x.com", "api-stream.x.com",
            "twitter.com", "www.twitter.com", "mobile.twitter.com", "api.twitter.com", "upload.twitter.com",
            "twimg.com", "abs.twimg.com", "abs-0.twimg.com", "pbs.twimg.com", "video.twimg.com", "ton.twimg.com", "cdn.syndication.twimg.com",
            "t.co", "pscp.tv", "prod.pscp.tv", "periscope.tv", "twtrdns.net", "cms-twdigitalassets.com", "vine.co", "twitpic.com",
        )) {
            assertEquals(exit, outbound(threeTier, Connection(domain = host)))
            assertEquals("reject", outbound(threeTier, Connection(domain = host, network = "udp")))
            assertEquals("reject", outbound(threeTier, Connection(domain = host, network = "icmp")))
            assertEquals("fakeip", RouteExplainer.dnsServer(threeTier, host, "A"))
            assertEquals("fakeip", RouteExplainer.dnsServer(threeTier, host, "AAAA"))
            assertEquals("predefined", RouteExplainer.dnsServer(threeTier, host, "HTTPS"))
            assertEquals("predefined", RouteExplainer.dnsServer(threeTier, host, "SVCB"))
        }
        assertEquals(exit, outbound(threeTier, Connection(domain = "api.x.com", packageName = "com.twitter.android")))
        assertEquals("fakeip", RouteExplainer.dnsServer(Fixtures.config(ipv6 = false), "api.x.com", "AAAA"))
        assertEquals(home, outbound(threeTier, Connection(domain = "grok.x.com")))
        assertEquals(home, outbound(threeTier, Connection(domain = "api.grok.x.com")))
        assertEquals(home, outbound(threeTier, Connection(domain = "grok.com")))
        assertEquals(home, outbound(threeTier, Connection(domain = "x.ai")))
        assertEquals(home, outbound(threeTier, Connection(domain = "grokipedia.com")))
        assertEquals(home, outbound(threeTier, Connection(domain = "grok.x.com", packageName = "com.twitter.android")))
        assertEquals("fakeip", RouteExplainer.dnsServer(threeTier, "grok.x.com", "A"))
        assertEquals("predefined", RouteExplainer.dnsServer(threeTier, "grok.x.com", "HTTPS"))
        assertEquals("reject", outbound(threeTier, Connection(domain = "grok.x.com", network = "udp")))
        assertEquals(exit, outbound(threeTier, Connection(domain = "youtubei.googleapis.com", packageName = "ai.x.grok")))
        assertEquals(home, outbound(threeTier, Connection(domain = "api.x.com", packageName = "ai.x.grok")))
        assertEquals(direct, outbound(threeTier, Connection(domain = "x.com.example.net")))
        assertEquals(direct, outbound(threeTier, Connection(domain = "unrelated.akamaized.net")))
        assertEquals("local", RouteExplainer.dnsServer(threeTier, "x.com.example.net", "A"))
        // Un-sniffed raw-IP dial from Cloud Android apps routes through Tono-Exit on TCP and rejects UDP/ICMP,
        // while domain-sniffed WhatsApp traffic still matches Home rules first.
        for (pkg in listOf("com.twitter.android", "org.telegram.messenger", "org.telegram.messenger.web", "org.thoughtcrime.securesms", "com.whatsapp", "com.discord", "com.google.android.youtube", "com.zhiliaoapp.musically", "com.ss.android.ugc.trill")) {
            assertEquals(exit, outbound(threeTier, Connection(ip = "203.0.114.9", packageName = pkg)))
            assertEquals("reject", outbound(threeTier, Connection(ip = "203.0.114.9", packageName = pkg, network = "udp")))
        }
        assertEquals(home, outbound(threeTier, Connection(domain = "web.whatsapp.com", packageName = "com.whatsapp")))
        assertEquals(home, outbound(threeTier, Connection(domain = "g.whatsapp.net", packageName = "com.whatsapp")))
        // Home Cloudflare / npm subdomains still precede broad OVERSEAS_CLOUD_SUFFIXES parents.
        assertEquals(home, outbound(threeTier, Connection(domain = "gateway.ai.cloudflare.com")))
        assertEquals(home, outbound(threeTier, Connection(domain = "challenges.cloudflare.com")))
        assertEquals(home, outbound(threeTier, Connection(domain = "registry.npmjs.org")))
        // Overseas messaging, knowledge, community, streaming, and developer ecosystems route to Cloud (Tono-Exit).
        for (host in listOf(
            "telegram.org", "core.telegram.org", "t.me", "tdesktop.com", "telegra.ph", "telegram.me", "telesco.pe", "cdn-telegram.org",
            "discord.com", "gateway.discord.gg", "discordapp.com", "cdn.discordapp.com", "discordapp.net", "discord.media",
            "signal.org", "chat.signal.org", "whispersystems.org", "line.me", "line-scdn.net",
            "wikipedia.org", "en.wikipedia.org", "zh.wikipedia.org", "wikimedia.org", "upload.wikimedia.org", "wikidata.org", "wiktionary.org", "mediawiki.org",
            "archive.org", "web.archive.org", "medium.com", "substack.com", "v2ex.com", "www.v2ex.com", "nodeseek.com", "www.nodeseek.com", "linux.do",
            "netflix.com", "www.netflix.com", "nflxvideo.net", "nflximg.net", "nflxext.com", "nflxso.net",
            "spotify.com", "open.spotify.com", "scdn.co", "twitch.tv", "www.twitch.tv", "ttvnw.net", "pixiv.net", "www.pixiv.net", "pximg.net", "i.pximg.net",
            "huggingface.co", "cdn-lfs.huggingface.co", "hf.co", "npmjs.com", "www.npmjs.com", "npmjs.org",
            "pypi.org", "files.pythonhosted.org", "ghcr.io", "github.io", "githubstatus.com",
            "vercel.app", "vercel.com", "cloudflare.com", "dash.cloudflare.com", "docker.com", "hub.docker.com", "docker.io", "registry-1.docker.io",
        )) {
            assertEquals(exit, outbound(threeTier, Connection(domain = host)))
            assertEquals("reject", outbound(threeTier, Connection(domain = host, network = "udp")))
            assertEquals("fakeip", RouteExplainer.dnsServer(threeTier, host, "A"))
            assertEquals("fakeip", RouteExplainer.dnsServer(threeTier, host, "AAAA"))
            assertEquals("predefined", RouteExplainer.dnsServer(threeTier, host, "HTTPS"))
            assertEquals("predefined", RouteExplainer.dnsServer(threeTier, host, "TXT"))
        }
        // Telegram Data Center (DC1–DC5) raw-IP TCP routes to Cloud (Tono-Exit) while UDP is rejected.
        for (tgIp in listOf("91.108.4.10", "91.108.8.20", "91.108.12.30", "91.108.16.40", "91.108.56.130", "149.154.167.50", "2001:67c:4e8:f002::a", "2001:b28:f23d:f001::a", "2001:b28:f23f:f005::a")) {
            assertEquals(exit, outbound(threeTier, Connection(ip = tgIp, port = 443, network = "tcp")))
            assertEquals("reject", outbound(threeTier, Connection(ip = tgIp, port = 443, network = "udp")))
        }
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
        val lists = DesktopRoutingContract.HOME_SUFFIXES + DesktopRoutingContract.MOBILE_HOME_AUX_SUFFIXES +
            DesktopRoutingContract.CLOUD_VIDEO_SUFFIXES + DesktopRoutingContract.PROTECTED_DIRECT_SUFFIXES +
            DesktopRoutingContract.PUBLIC_STUN_SUFFIXES + DesktopRoutingContract.X_CLOUD_SUFFIXES +
            DesktopRoutingContract.OVERSEAS_CLOUD_SUFFIXES
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
        assertEquals("predefined", RouteExplainer.dnsServer(threeTier, "claude.ai", "HTTPS"))
        assertEquals("predefined", RouteExplainer.dnsServer(threeTier, "claude.ai", "SVCB"))
        assertEquals("predefined", RouteExplainer.dnsServer(threeTier, "i.ytimg.com", "HTTPS"))
        for (host in listOf("claude.ai", "i.ytimg.com", "x.com", "api.twitter.com", "telegram.org", "whatsapp.com", "www.google.com")) {
            for (qtype in listOf("HTTPS", "SVCB", "TXT", "SRV", "CAA", "CNAME", "PTR")) {
                assertEquals("predefined", RouteExplainer.dnsServer(threeTier, host, qtype))
            }
        }
        assertEquals("local", RouteExplainer.dnsServer(threeTier, "www.baidu.com", "A"))
        assertEquals("local", RouteExplainer.dnsServer(threeTier, "www.baidu.com", "AAAA"))
        assertEquals("local", RouteExplainer.dnsServer(threeTier, "www.baidu.com", "HTTPS"))
        assertEquals("local", RouteExplainer.dnsServer(threeTier, "www.baidu.com", "TXT"))
        assertEquals("local", RouteExplainer.dnsServer(stable, "printer.local", "A"))
        assertEquals("local", RouteExplainer.dnsServer(stable, "printer.local", "HTTPS"))
        assertEquals("fakeip", RouteExplainer.dnsServer(stable, "www.baidu.com", "A"))
        assertEquals("predefined", RouteExplainer.dnsServer(stable, "www.baidu.com", "HTTPS"))
        assertEquals("predefined", RouteExplainer.dnsServer(stable, "www.baidu.com", "SVCB"))
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
