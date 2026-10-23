//! Domain and address lists that decide what may leave on a DIRECT outbound.
//!
//! The product compilers use them to build rules, and the Service compiles this
//! same file by path to admit only those rules. Keep it std-only.
//! The Model API/Home/cloud-video arrays also generate the macOS declarations:
//! `node tooling/scripts/sync-routing-domains.mjs --write` (CI checks parity).

/// Web suffixes that may use an address-free DIRECT rule on Windows.
///
/// Windows can only make this safe when the WFP reviewed-port permit is live
/// for the staged core. Keep this smaller than the full policy allowlist
/// (`zoom.us` and similar stay tunnelled). The China-site suffixes below are
/// product-direct: any process, TCP 80/443, same staged-core port permit as
/// Bilibili.
pub const ADDRESS_FREE_WEB_SUFFIXES: [&str; 52] = [
    "bilibili.com",
    "biliapi.net",
    "bilivideo.com",
    "hdslb.com",
    "qq.com",
    "baidu.com",
    "aliyuncs.com",
    "edu.cn",
    "weixinbridge.com",
    "taobao.com",
    "tmall.com",
    "alipay.com",
    "alicdn.com",
    "jd.com",
    "douyin.com",
    "163.com",
    "netease.com",
    "weibo.com",
    "meituan.com",
    "dianping.com",
    "pinduoduo.com",
    "amap.com",
    "douyu.com",
    "huya.com",
    "kuaishou.com",
    "yy.com",
    "ixigua.com",
    "iqiyi.com",
    "youku.com",
    "mgtv.com",
    "xiaohongshu.com",
    "wps.cn",
    "kdocs.cn",
    "yuque.com",
    "voovmeeting.com",
    "12306.cn",
    "yximgs.com",
    "kugou.com",
    "kuwo.cn",
    "migu.cn",
    "ximalaya.com",
    "qingting.fm",
    "xylink.com",
    "zhumu.me",
    "quanshi.com",
    "zhihu.com",
    "zhimg.com",
    "goofish.com",
    "1688.com",
    "10086.cn",
    "cmecloud.cn",
    "miit.gov.cn",
];

pub fn is_address_free_web_suffix(host: &str) -> bool {
    ADDRESS_FREE_WEB_SUFFIXES.contains(&host)
}
/// Always attached to a native-app DIRECT plan, even if the published policy
/// omitted them. Unidentified helpers and browsers hit these trees.
pub const ALWAYS_ADDRESS_FREE_WEB_SUFFIXES: [&str; 48] = [
    "qq.com",
    "baidu.com",
    "aliyuncs.com",
    "edu.cn",
    "weixinbridge.com",
    "bilibili.com",
    "taobao.com",
    "tmall.com",
    "alipay.com",
    "alicdn.com",
    "jd.com",
    "douyin.com",
    "163.com",
    "netease.com",
    "weibo.com",
    "meituan.com",
    "dianping.com",
    "pinduoduo.com",
    "amap.com",
    "douyu.com",
    "huya.com",
    "kuaishou.com",
    "yy.com",
    "ixigua.com",
    "iqiyi.com",
    "youku.com",
    "mgtv.com",
    "xiaohongshu.com",
    "wps.cn",
    "kdocs.cn",
    "yuque.com",
    "voovmeeting.com",
    "12306.cn",
    "kugou.com",
    "kuwo.cn",
    "migu.cn",
    "ximalaya.com",
    "qingting.fm",
    "xylink.com",
    "zhumu.me",
    "quanshi.com",
    "zhihu.com",
    "zhimg.com",
    "goofish.com",
    "1688.com",
    "10086.cn",
    "cmecloud.cn",
    "miit.gov.cn",
];
/// Dedicated Model Studio namespaces within Alibaba's general DIRECT tree.
pub const DEDICATED_MODEL_API_SUFFIXES: [&str; 4] = [
    "dashscope.aliyuncs.com",
    "dashscope-intl.aliyuncs.com",
    "dashscope-us.aliyuncs.com",
    "maas.aliyuncs.com",
];

/// Owner-selected domains pinned to the home-broadband exit when
/// `homeProxy` / `homeSocks5` is in force. These are DOMAIN-SUFFIX rules
/// with no process constraint, so Chrome / Edge / Arc count the same as
/// the desktop apps. Cloud video exceptions precede Google and process
/// fallbacks. Shared CDN/ByteDance parents and gstatic remain excluded.
pub const CLAUDE_HOME_DOMAINS: [&str; 194] = [
    DEDICATED_MODEL_API_SUFFIXES[0],
    DEDICATED_MODEL_API_SUFFIXES[1],
    DEDICATED_MODEL_API_SUFFIXES[2],
    DEDICATED_MODEL_API_SUFFIXES[3],
    "anthropic.com",
    "claude.ai",
    "claude.com",
    "claude.app",
    "claude.site",
    "clau.de",
    "anthropic.ai",
    "claudestudio.com",
    "claudemcpclient.com",
    "claudemcpcontent.com",
    "claudeusercontent.com",
    "servd-anthropic-website.b-cdn.net",
    "challenges.cloudflare.com",
    "cf-assets.www.cloudflare.com",
    "cloudflareinsights.com",
    "browser-intake-datadoghq.com",
    "browser-intake-us5-datadoghq.com",
    "browser-intake-us3-datadoghq.com",
    "browser-intake-ap1-datadoghq.com",
    "browser-intake-ap2-datadoghq.com",
    "browser-intake-datadoghq.eu",
    "browser-intake-ddog-gov.com",
    "datadoghq.com",
    "statsig.com",
    "statsigapi.net",
    "featuregates.org",
    "growthbook.io",
    "cdn.usefathom.com",
    "stripe.com",
    "stripecdn.com",
    "link.com",
    "hcaptcha.com",
    "stripe.network",
    // Claude Code install/update dependencies and Claude Desktop essential
    // telemetry. Keep these exact suffixes rather than routing node.exe: npm
    // and bun host unrelated Node workloads under the same process name.
    "storage.googleapis.com",
    "registry.npmjs.org",
    "raw.githubusercontent.com",
    "formulae.brew.sh",
    "sentry.io",
    "chatgpt.com",
    "openai.com",
    "chat.com",
    "ai.com",
    "oaistatic.com",
    "oaiusercontent.com",
    "sora.com",
    "grok.com",
    "grok.x.com",
    "grokipedia.com",
    "x.ai",
    "perplexity.ai",
    "perplexity.com",
    "pplx.ai",
    "gemini.google.com",
    "bard.google.com",
    "aistudio.google.com",
    "generativelanguage.googleapis.com",
    "notebooklm.google.com",
    "ai.google.dev",
    "gemini.google",
    "deepmind.com",
    "deepmind.google",
    "notebooklm.google",
    "antigravity.google",
    "generativeai.google",
    "makersuite.google.com",
    "jules.google.com",
    "antigravity-unleash.goog",
    "aida.googleapis.com",
    "geller-pa.googleapis.com",
    "aisandbox-pa.googleapis.com",
    "cloudcode-pa.googleapis.com",
    "robinfrontend-pa.googleapis.com",
    "alkalicore-pa.clients6.google.com",
    "daily-cloudcode-pa.googleapis.com",
    "proactivebackend-pa.googleapis.com",
    "alkalimakersuite-pa.clients6.google.com",
    // Owner-selected AI services and dependency hosts. This is a routing
    // choice, not an assertion of provider affiliation. Specific host
    // suffixes include their children, not the shared parent namespace.
    "g.ai",
    "dify.ai",
    "poe.com",
    "groq.com",
    "cursor.sh",
    "ampcode.com",
    "cursor.com",
    "cursorapi.com",
    "js.workos.com",
    "githubcopilot.com",
    "kiro.dev",
    "q.us-east-1.amazonaws.com",
    "q.eu-central-1.amazonaws.com",
    "windsurf.com",
    "codeium.com",
    "grazie.ai",
    "grazie.aws.intellij.net",
    "hark.com",
    "mistral.ai",
    "elevenlabs.io",
    "elevenlabs.com",
    "midjourney.com",
    "suno.com",
    "poecdn.net",
    "pplx-res.cloudinary.com",
    "ppl-ai-file-upload.s3.amazonaws.com",
    "oaistatsig.com",
    "openai-api.arkoselabs.com",
    "labs.google",
    "flow.google",
    "opal.google",
    "stitch.withgoogle.com",
    "llama.com",
    "jasper.ai",
    "openart.ai",
    "clipdrop.co",
    "chatgpt.site",
    "openrouter.ai",
    "api.github.com",
    "api.jetbrains.ai",
    "gateway.ai.cloudflare.com",
    // Meta Muse
    "muse.ai",
    "meta.ai",
    "muse.meta.com",
    "www.muse.ai",
    // Meta & Facebook
    "meta.com",
    "facebook.com",
    "fb.com",
    "fb.me",
    "fb.watch",
    "fbcdn.net",
    "facebook.net",
    "messenger.com",
    // Instagram & Threads
    "instagram.com",
    "cdninstagram.com",
    "ig.me",
    "threads.net",
    // Gmail & Google Auth
    "gmail.com",
    "mail.google.com",
    "googlemail.com",
    "inbox.google.com",
    "accounts.google.com",
    "myaccount.google.com",
    "oauth2.googleapis.com",
    "mail-pa.clients6.google.com",
    "gmail.googleapis.com",
    // Owner-approved expansion; shared downloads/APIs also use Home.
    "google.com", "googleapis.com", "github.com",
    "githubusercontent.com", "githubassets.com",
    // Dedicated Reddit/TikTok hosts, including their media. Selected from
    // v2fly/domain-list-community c6adacf29; never the shared CDN parents.
    "redd.it", "reddit.app.link", "reddit.com", "redditblog.com",
    "reddithelp.com", "redditinc.com", "redditmail.com", "redditmedia.com",
    "redditspace.com", "redditstatic.com", "redditstatus.com", "reddit.map.fastly.net",
    "muscdn.com", "musical.ly", "tik-tokapi.com", "tiktok-minis.com",
    "tiktok-row.net", "tiktok.com", "tiktokcdn-eu.com", "tiktokcdn-us.com",
    "tiktokcdn.com", "tiktokd.net", "tiktokd.org", "tiktokeu-cdn.com",
    "tiktokglobalshopv.com", "tiktokminis.us", "tiktokrow-cdn.com",
    "tiktokv.com", "tiktokv.eu", "tiktokv.us", "tiktokw.eu", "tiktokw.us",
    "ttcdn-us.com", "ttlivecdn.com", "ttoverseaus.net", "ttwstatic.com",
    "tiktokcdn-us.com.edgesuite.net", "tiktokcdn.com.akamaized.net",
    "tiktokcdn.com.edgesuite.net", "tiktokv.com.edgekey.net", "tiktokv.com.edgesuite.net",
    "p16-tiktokcdn-com.akamaized.net", "p16-tiktok-dm-sticker-sign-sg.ibyteimg.com",
];

/// Cloud-only video sites/media/APIs, even inside a Home-pinned process.
/// TCP pins plus UDP rejection avoid a SOCKS/Reality UDP DIRECT fallback.
pub const CLOUD_VIDEO_DOMAINS: [&str; 21] = [
    "youtube.com", "youtube-nocookie.com", "youtu.be", "googlevideo.com", "ytimg.com",
    "youtube.googleapis.com", "youtubei.googleapis.com", "youtubeembeddedplayer.googleapis.com",
    "youtube-ui.l.google.com", "wide-youtube.l.google.com", "yt3.googleusercontent.com", "ggpht.com",
    "pornhub.com", "pornhub.org", "pornhubpremium.com", "phncdn.com", "phprcdn.com",
    "porngub.com", "pornhub-deutsch.net", "pornhubapparel.com", "gaytube.com",
];
/// Anthropic's own unicast range (ARIN AP-2440 / AS399358). Customer audits
/// only ever show `160.79.104.10:443` as a raw dest, which skips every
/// DOMAIN-SUFFIX pin. IPv6 prefixes stay off: the runtime is `ipv6: false`,
/// so AAAA never reaches TUN. The ARIN block is first-party only — unlike
/// `1.1.1.1` / `8.8.8.8`, which Tono itself uses as the exit probe and must
/// stay on `Tono-Exit`. `no-resolve` keeps the match on the packet address.
pub const CLAUDE_HOME_IPV4_CIDRS: [&str; 1] = ["160.79.104.0/21"];

/// Google WebRTC STUN UDP ports rejected across mobile routing modes so raw-IP
/// STUN probes (e.g. 74.125.250.129:19302) cannot leak the physical egress IP,
/// without blanket-blocking RFC 5389 port 3478 used by domestic P2P/IoT in China.
pub const STUN_UDP_PORTS: [u16; 8] = [19302, 19303, 19304, 19305, 19306, 19307, 19308, 19309];

/// Encrypted DNS (DoT/DoQ) port rejected in mobile TUN so apps and OS private DNS
/// fall back to standard port-53 DNS where sing-box hijacks and serves FakeIP.
pub const ENCRYPTED_DNS_PORTS: [u16; 1] = [853];

/// Third-party public STUN/TURN suffixes whose UDP/ICMP is rejected across mobile
/// routing modes and whose TCP/DNS is kept off the physical interface.
pub const PUBLIC_STUN_SUFFIXES: [&str; 5] = [
    "stun.cloudflare.com",
    "turn.cloudflare.com",
    "global.stun.twilio.com",
    "stun.services.mozilla.com",
    "stunprotocol.org",
];

/// Claude / AI auxiliary support, device fingerprinting, anti-fraud, captcha,
/// Apple Sign-In OAuth, telemetry, and SSO suffixes routed through the Home tier
/// on mobile TCP with UDP/ICMP rejected and FakeIP DNS.
pub const MOBILE_HOME_AUX_SUFFIXES: [&str; 44] = [
    // WorkOS / Arkose / Intercom / Statsig feature-flag alias suffixes
    "workos.com",
    "authkit.app",
    "workos.imgix.net",
    "arkoselabs.com",
    "funcaptcha.com",
    "funcaptcha.co",
    "intercom.io",
    "intercomcdn.com",
    "intercomassets.com",
    "intercom-mail.com",
    "featureassets.org",
    "prodregistryv2.org",
    "beyondwickedmapping.org",
    // Device fingerprinting & anti-fraud SDKs
    "fpjs.io",
    "fpnpmcdn.net",
    "openfpcdn.io",
    "fingerprint.com",
    "sift.com",
    "siftscience.com",
    "sardine.ai",
    "castle.io",
    // reCAPTCHA & bot challenges
    "recaptcha.net",
    // Apple Sign-In OAuth (Continue with Apple)
    "appleid.apple.com",
    "idmsa.apple.com",
    "appleid.cdn-apple.com",
    "gsa.apple.com",
    // Telemetry, feature flags & session replay
    "segment.io",
    "segment.com",
    "launchdarkly.com",
    "posthog.com",
    "amplitude.com",
    "logrocket.com",
    "lr-ingest.com",
    "lr-in.com",
    "lr-in-prod.com",
    "honeybadger.io",
    // SSO / passwordless auth & MCP ecosystem
    "stytch.com",
    "stytch.io",
    "auth0.com",
    "okta.com",
    "modelcontextprotocol.io",
    "anthropicstatus.com",
    "claudecode.com",
    "claude.codes",
];

/// X (Twitter) full domain suffixes routed through the Cloud exit (`Tono-Exit`)
/// on mobile TCP with UDP/ICMP rejected and FakeIP DNS. Evaluated after
/// `CLAUDE_HOME_DOMAINS` so `grok.x.com` stays on Home while all other `*.x.com`
/// and X media/API/streaming subdomains route through Cloud.
pub const X_CLOUD_SUFFIXES: [&str; 10] = [
    "x.com",
    "twitter.com",
    "twimg.com",
    "t.co",
    "pscp.tv",
    "periscope.tv",
    "twtrdns.net",
    "cms-twdigitalassets.com",
    "vine.co",
    "twitpic.com",
];

/// Overseas STUN, public DNS, CDN, AI and messaging IPv4 ranges whose UDP/ICMP
/// traffic is rejected in mobile Three-Tier mode while domestic UDP stays DIRECT.
pub const OVERSEAS_UDP_REJECT_IPV4_CIDRS: [&str; 33] = [
    // Google STUN / WebRTC / YouTube / Public DNS (AS15169)
    "74.125.0.0/16",
    "142.250.0.0/15",
    "172.217.0.0/16",
    "172.253.0.0/16",
    "216.58.192.0/19",
    "64.233.160.0/19",
    "108.177.0.0/17",
    "209.85.128.0/17",
    "8.8.8.0/24",
    "8.8.4.0/24",
    // Cloudflare DNS / Anycast / STUN / QUIC (AS13335)
    "1.1.1.0/24",
    "1.0.0.0/24",
    "104.16.0.0/12",
    "172.64.0.0/13",
    "162.159.0.0/16",
    // Quad9 & OpenDNS Public DNS (AS19281 / AS36692)
    "9.9.9.9/32",
    "149.112.112.112/32",
    "208.67.222.222/32",
    "208.67.220.220/32",
    // Anthropic (AS399358)
    "160.79.104.0/21",
    // Fastly CDN (AS54113)
    "151.101.0.0/16",
    "199.232.0.0/16",
    // Telegram Messenger (AS62041 / AS62014 / AS44907 / AS59930)
    "91.108.4.0/22",
    "91.108.8.0/22",
    "91.108.12.0/22",
    "91.108.16.0/22",
    "91.108.56.0/22",
    "149.154.160.0/20",
    // Meta / WhatsApp / Instagram / Facebook (AS32934)
    "31.13.24.0/21",
    "31.13.64.0/18",
    "157.240.0.0/16",
    "179.60.192.0/22",
    "185.60.216.0/22",
];

/// Overseas STUN, public DNS, CDN, AI and messaging IPv6 ranges whose UDP/ICMP
/// traffic is rejected on dual-stack 5G/Wi-Fi in mobile Three-Tier mode while
/// domestic carrier IPv6 (2408::/2409::/240e::) and ULA/link-local stay DIRECT.
pub const OVERSEAS_UDP_REJECT_IPV6_CIDRS: [&str; 21] = [
    // Google / YouTube / Google STUN / Google Public DNS IPv6 (AS15169)
    "2001:4860::/32",
    "2404:6800::/32",
    "2607:f8b0::/32",
    "2800:3f0::/32",
    "2a00:1450::/32",
    "2c0f:fb50::/32",
    // Cloudflare DNS / Anycast / STUN / QUIC IPv6 (AS13335)
    "2606:4700::/32",
    "2803:f800::/32",
    "2405:b500::/32",
    "2405:8100::/32",
    "2a06:98c0::/29",
    "2c0f:f248::/32",
    // Quad9 & OpenDNS Public DNS IPv6 (AS19281 / AS36692)
    "2620:fe::/48",
    "2620:119:35::/48",
    "2620:119:53::/48",
    // Anthropic (AS399358)
    "2607:6bc0::/48",
    // Fastly CDN (AS54113)
    "2a04:4e40::/32",
    // Meta / WhatsApp / Instagram / Facebook (AS32934)
    "2a03:2880::/32",
    // Telegram Messenger (AS62041 / AS62014)
    "2001:67c:4e8::/48",
    "2001:b28:f23d::/48",
    "2001:b28:f23f::/48",
];

/// Claude's first-party, login/challenge, telemetry and update hosts must never
/// be moved to the physical interface, even by an otherwise trusted policy.
/// Keep this in parity with the control-plane and macOS protected lists.
pub const PROTECTED_DIRECT_SUFFIXES: &[&str] = &[
    "anthropic.com",
    "claude.ai",
    "claude.com",
    "claude.app",
    "claude.site",
    "clau.de",
    "anthropic.ai",
    "claudestudio.com",
    "claudemcpclient.com",
    "claudemcpcontent.com",
    "claudeusercontent.com",
    "servd-anthropic-website.b-cdn.net",
    "challenges.cloudflare.com",
    "cf-assets.www.cloudflare.com",
    "cloudflareinsights.com",
    "browser-intake-datadoghq.com",
    "browser-intake-us5-datadoghq.com",
    "browser-intake-us3-datadoghq.com",
    "browser-intake-ap1-datadoghq.com",
    "browser-intake-ap2-datadoghq.com",
    "browser-intake-datadoghq.eu",
    "browser-intake-ddog-gov.com",
    "datadoghq.com",
    "statsig.com",
    "statsigapi.net",
    "featuregates.org",
    "growthbook.io",
    "stripe.com",
    "stripecdn.com",
    "link.com",
    "hcaptcha.com",
    "stripe.network",
    "storage.googleapis.com",
    "registry.npmjs.org",
    "raw.githubusercontent.com",
    "formulae.brew.sh",
    "sentry.io",
    "tono.app",
    "tono.com",
];

pub fn is_protected_from_direct(host: &str) -> bool {
    PROTECTED_DIRECT_SUFFIXES
        .iter()
        .chain(CLAUDE_HOME_DOMAINS.iter())
        .chain(CLOUD_VIDEO_DOMAINS.iter())
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

pub fn direct_suffix_overlaps_protected(host: &str) -> bool {
    is_protected_from_direct(host)
        || PROTECTED_DIRECT_SUFFIXES
            .iter()
            .chain(CLAUDE_HOME_DOMAINS.iter())
            .chain(CLOUD_VIDEO_DOMAINS.iter())
            .any(|protected| {
                protected.ends_with(&format!(".{host}"))
                // Only these reviewed assistant children run ahead of the
                // Alibaba parent in both emitters. All other overlaps stay denied.
                && !(host == "aliyuncs.com"
                    && DEDICATED_MODEL_API_SUFFIXES.contains(protected))
            })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mobile_anti_leak_lists_are_well_formed() {
        assert_eq!(STUN_UDP_PORTS, [19302, 19303, 19304, 19305, 19306, 19307, 19308, 19309]);
        assert_eq!(ENCRYPTED_DNS_PORTS, [853]);
        assert_eq!(PUBLIC_STUN_SUFFIXES.len(), 5);
        assert_eq!(MOBILE_HOME_AUX_SUFFIXES.len(), 44);
        assert_eq!(X_CLOUD_SUFFIXES.len(), 10);
        assert!(CLAUDE_HOME_DOMAINS.contains(&"statsig.com"));
        assert!(CLAUDE_HOME_DOMAINS.contains(&"grok.x.com"));
        assert!(X_CLOUD_SUFFIXES.contains(&"x.com"));
        assert_eq!(OVERSEAS_UDP_REJECT_IPV4_CIDRS.len(), 33);
        assert_eq!(OVERSEAS_UDP_REJECT_IPV6_CIDRS.len(), 21);
        for cidr in OVERSEAS_UDP_REJECT_IPV4_CIDRS {
            assert!(cidr.contains('/') && !cidr.contains(':'), "invalid IPv4 CIDR: {cidr}");
        }
        for cidr in OVERSEAS_UDP_REJECT_IPV6_CIDRS {
            assert!(cidr.contains('/') && cidr.contains(':'), "invalid IPv6 CIDR: {cidr}");
        }
    }
}
