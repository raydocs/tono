//! Domain and address lists that decide what may leave on a DIRECT outbound.
//!
//! The product compilers use them to build rules, and the Service compiles this
//! same file by path to admit only those rules. Keep it std-only.

/// Web suffixes that may use an address-free DIRECT rule on Windows.
///
/// Windows can only make this safe when the WFP reviewed-port permit is live
/// for the staged core. Keep this smaller than the full policy allowlist
/// (`zoom.us` and similar stay tunnelled). The China-site suffixes below are
/// product-direct: any process, TCP 80/443, same staged-core port permit as
/// Bilibili.
pub const ADDRESS_FREE_WEB_SUFFIXES: [&str; 49] = [
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
];

pub fn is_address_free_web_suffix(host: &str) -> bool {
    ADDRESS_FREE_WEB_SUFFIXES.contains(&host)
}
/// Dedicated Model Studio namespaces within Alibaba's general DIRECT tree.
pub const DEDICATED_MODEL_API_SUFFIXES: [&str; 4] = [
    "dashscope.aliyuncs.com",
    "dashscope-intl.aliyuncs.com",
    "dashscope-us.aliyuncs.com",
    "maas.aliyuncs.com",
];

/// First-party assistant domains pinned to the home-broadband exit when
/// `homeProxy` / `homeSocks5` is in force. These are DOMAIN-SUFFIX rules
/// with no process constraint, so Chrome / Edge / Arc count the same as
/// the desktop apps. `google.com`, `googleapis.com`, and `gstatic.com`
/// stay out: they are shared by Search, YouTube, Gmail, and Tono's own
/// exit probe. Gemini is pinned by its product hostnames instead.
pub const CLAUDE_HOME_DOMAINS: [&str; 84] = [
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
];
/// Anthropic's own unicast range (ARIN AP-2440 / AS399358). Customer audits
/// only ever show `160.79.104.10:443` as a raw dest, which skips every
/// DOMAIN-SUFFIX pin. IPv6 prefixes stay off: the runtime is `ipv6: false`,
/// so AAAA never reaches TUN. The ARIN block is first-party only — unlike
/// `1.1.1.1` / `8.8.8.8`, which Tono itself uses as the exit probe and must
/// stay on `Tono-Exit`. `no-resolve` keeps the match on the packet address.
pub const CLAUDE_HOME_IPV4_CIDRS: [&str; 1] = ["160.79.104.0/21"];

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
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

pub fn direct_suffix_overlaps_protected(host: &str) -> bool {
    is_protected_from_direct(host)
        || PROTECTED_DIRECT_SUFFIXES
            .iter()
            .chain(CLAUDE_HOME_DOMAINS.iter())
            .any(|protected| {
                protected.ends_with(&format!(".{host}"))
                // Only these reviewed assistant children run ahead of the
                // Alibaba parent in both emitters. All other overlaps stay denied.
                && !(host == "aliyuncs.com"
                    && DEDICATED_MODEL_API_SUFFIXES.contains(protected))
            })
}
