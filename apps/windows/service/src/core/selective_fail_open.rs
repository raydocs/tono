//! Narrow secondary hold used only after a non-strict full release.
//!
//! Nothing here can describe a default route or a catch-all DNS name. The
//! Windows installer refuses any command this module does not mark as
//! prefix-only. Keep the suffix list in parity with
//! `tooling/scripts/core-helper/SelectiveFailOpen.swift`.

/// Anthropic's published inbound prefixes (2026-09-30). Not the larger
/// outbound `/21`, and not a CDN.
pub const ANTHROPIC_IPV4: &str = "160.79.104.0/23";
pub const ANTHROPIC_IPV6: &str = "2607:6bc0::/48";

/// TEST-NET-1. Not a public resolver and not the TUN listener.
pub const SINKHOLE_DNS: &str = "192.0.2.1";

/// The NRPT catch-all key. A selective rule must not reuse it.
pub const CATCH_ALL_NRPT_GUID: &str = "{8f3c2b91-4a6e-4d17-9c1a-198018000002}";

pub const FIREWALL_V4_NAME: &str = "name=Tono selective anthropic v4";
pub const FIREWALL_V6_NAME: &str = "name=Tono selective anthropic v6";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NrptRule {
    pub suffix: &'static str,
    pub guid: &'static str,
}

/// Exclusive first-party suffixes. Shared CDN, payment, package, and
/// identity hosts are not in this table.
pub static NRPT_RULES: &[NrptRule] = &[
    NrptRule { suffix: "anthropic.com", guid: "{a17e4c10-5b21-4e08-9c1a-198018000010}" },
    NrptRule { suffix: "claude.ai", guid: "{a17e4c10-5b21-4e08-9c1a-198018000011}" },
    NrptRule { suffix: "claude.com", guid: "{a17e4c10-5b21-4e08-9c1a-198018000012}" },
    NrptRule { suffix: "claude.app", guid: "{a17e4c10-5b21-4e08-9c1a-198018000013}" },
    NrptRule { suffix: "claude.site", guid: "{a17e4c10-5b21-4e08-9c1a-198018000014}" },
    NrptRule { suffix: "clau.de", guid: "{a17e4c10-5b21-4e08-9c1a-198018000015}" },
    NrptRule { suffix: "anthropic.ai", guid: "{a17e4c10-5b21-4e08-9c1a-198018000016}" },
    NrptRule { suffix: "claudestudio.com", guid: "{a17e4c10-5b21-4e08-9c1a-198018000017}" },
    NrptRule { suffix: "claudemcpclient.com", guid: "{a17e4c10-5b21-4e08-9c1a-198018000018}" },
    NrptRule { suffix: "claudemcpcontent.com", guid: "{a17e4c10-5b21-4e08-9c1a-198018000019}" },
    NrptRule { suffix: "claudeusercontent.com", guid: "{a17e4c10-5b21-4e08-9c1a-19801800001a}" },
    NrptRule { suffix: "chatgpt.com", guid: "{a17e4c10-5b21-4e08-9c1a-19801800001b}" },
    NrptRule { suffix: "openai.com", guid: "{a17e4c10-5b21-4e08-9c1a-19801800001c}" },
    NrptRule { suffix: "oaistatic.com", guid: "{a17e4c10-5b21-4e08-9c1a-19801800001d}" },
    NrptRule { suffix: "oaiusercontent.com", guid: "{a17e4c10-5b21-4e08-9c1a-19801800001e}" },
    NrptRule { suffix: "grok.com", guid: "{a17e4c10-5b21-4e08-9c1a-19801800001f}" },
    NrptRule { suffix: "grok.x.com", guid: "{a17e4c10-5b21-4e08-9c1a-198018000020}" },
    NrptRule { suffix: "grokipedia.com", guid: "{a17e4c10-5b21-4e08-9c1a-198018000021}" },
    NrptRule { suffix: "x.ai", guid: "{a17e4c10-5b21-4e08-9c1a-198018000022}" },
    NrptRule { suffix: "perplexity.ai", guid: "{a17e4c10-5b21-4e08-9c1a-198018000023}" },
    NrptRule { suffix: "perplexity.com", guid: "{a17e4c10-5b21-4e08-9c1a-198018000024}" },
    NrptRule { suffix: "pplx.ai", guid: "{a17e4c10-5b21-4e08-9c1a-198018000025}" },
    // Model API namespaces only; general Alibaba Cloud stays available.
    NrptRule { suffix: "dashscope.aliyuncs.com", guid: "{a17e4c10-5b21-4e08-9c1a-198018000026}" },
    NrptRule { suffix: "dashscope-intl.aliyuncs.com", guid: "{a17e4c10-5b21-4e08-9c1a-198018000027}" },
    NrptRule { suffix: "dashscope-us.aliyuncs.com", guid: "{a17e4c10-5b21-4e08-9c1a-198018000028}" },
    NrptRule { suffix: "maas.aliyuncs.com", guid: "{a17e4c10-5b21-4e08-9c1a-198018000029}" },
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReleaseKind {
    CrashOrHang,
    RestoreOrDisconnect,
    ArmTunnel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FollowUp {
    Apply,
    Remove,
}

pub fn follow_up(kind: ReleaseKind) -> FollowUp {
    match kind {
        ReleaseKind::CrashOrHang => FollowUp::Apply,
        ReleaseKind::RestoreOrDisconnect | ReleaseKind::ArmTunnel => FollowUp::Remove,
    }
}

pub fn nrpt_name_is_safe(name: &str) -> bool {
    if name.is_empty()
        || name == "."
        || name.contains('*')
        || name.contains('/')
        || name.contains('\\')
        || name.contains(' ')
    {
        return false;
    }
    let apex = name.strip_prefix('.').unwrap_or(name);
    if apex.is_empty() || apex == "." || !apex.contains('.') {
        return false;
    }
    NRPT_RULES.iter().any(|rule| rule.suffix == apex)
}

pub fn names_for_rule(rule: &NrptRule) -> Option<Vec<String>> {
    if !nrpt_name_is_safe(rule.suffix) {
        return None;
    }
    let dotted = format!(".{}", rule.suffix);
    if !nrpt_name_is_safe(&dotted) {
        return None;
    }
    Some(vec![rule.suffix.to_owned(), dotted])
}

pub fn firewall_add_commands() -> Vec<Vec<&'static str>> {
    vec![
        vec![
            r"C:\Windows\System32\netsh.exe",
            "advfirewall",
            "firewall",
            "add",
            "rule",
            FIREWALL_V4_NAME,
            "dir=out",
            "action=block",
            "remoteip=160.79.104.0/23",
            "enable=yes",
        ],
        vec![
            r"C:\Windows\System32\netsh.exe",
            "advfirewall",
            "firewall",
            "add",
            "rule",
            FIREWALL_V6_NAME,
            "dir=out",
            "action=block",
            "remoteip=2607:6bc0::/48",
            "enable=yes",
        ],
    ]
}

pub fn firewall_delete_commands() -> Vec<Vec<&'static str>> {
    vec![
        vec![
            r"C:\Windows\System32\netsh.exe",
            "advfirewall",
            "firewall",
            "delete",
            "rule",
            FIREWALL_V4_NAME,
        ],
        vec![
            r"C:\Windows\System32\netsh.exe",
            "advfirewall",
            "firewall",
            "delete",
            "rule",
            FIREWALL_V6_NAME,
        ],
    ]
}

/// Add commands must name exactly one Anthropic prefix. Delete commands must
/// name one of the two fixed rule names and must not carry a remote prefix
/// of their own.
pub fn command_may_run(args: &[&str]) -> bool {
    if args.first().copied() != Some(r"C:\Windows\System32\netsh.exe") {
        return false;
    }
    let joined = args.join(" ");
    if joined.contains("0.0.0.0/0")
        || joined.contains("::/0")
        || joined.contains("remoteip=any")
        || joined.contains("remoteip=*")
        || joined.contains("remoteip=0.0.0.0")
    {
        return false;
    }
    let adds = args.iter().any(|arg| *arg == "add");
    let deletes = args.iter().any(|arg| *arg == "delete");
    if adds == deletes {
        return false;
    }
    if adds {
        let v4 = joined.contains(ANTHROPIC_IPV4);
        let v6 = joined.contains(ANTHROPIC_IPV6);
        return v4 != v6 && joined.contains("action=block");
    }
    let v4 = joined.contains(FIREWALL_V4_NAME);
    let v6 = joined.contains(FIREWALL_V6_NAME);
    v4 != v6 && !joined.contains("remoteip=")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crash_applies_and_restore_removes() {
        assert_eq!(follow_up(ReleaseKind::CrashOrHang), FollowUp::Apply);
        assert_eq!(follow_up(ReleaseKind::RestoreOrDisconnect), FollowUp::Remove);
        assert_eq!(follow_up(ReleaseKind::ArmTunnel), FollowUp::Remove);
    }

    #[test]
    fn shared_infrastructure_is_not_a_sinkhole_name() {
        for name in [
            ".",
            "",
            "google.com",
            "stripe.com",
            "cloudflare.com",
            "meta.com",
            "facebook.com",
            "registry.npmjs.org",
            "chat.com",
            "ai.com",
            "*",
        ] {
            assert!(!nrpt_name_is_safe(name), "{name}");
        }
        assert!(nrpt_name_is_safe("claude.ai"));
        assert!(nrpt_name_is_safe(".claude.ai"));
    }

    #[test]
    fn model_api_hold_covers_dedicated_families_without_blocking_alibaba_cloud() {
        for suffix in ["dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com", "dashscope-us.aliyuncs.com", "maas.aliyuncs.com"] {
            let rule = NRPT_RULES.iter().find(|rule| rule.suffix == suffix).expect(suffix);
            assert_eq!(names_for_rule(rule).unwrap(), vec![suffix.to_string(), format!(".{suffix}")]);
        }
        assert!(!nrpt_name_is_safe("aliyuncs.com"));
        assert!(!nrpt_name_is_safe("oss-cn-hangzhou.aliyuncs.com"));
    }

    #[test]
    fn nrpt_rules_stay_off_the_catch_all() {
        let mut guids = Vec::new();
        for rule in NRPT_RULES {
            assert_ne!(rule.guid, CATCH_ALL_NRPT_GUID);
            assert!(nrpt_name_is_safe(rule.suffix));
            let names = names_for_rule(rule).expect("suffix");
            assert!(names.iter().all(|name| nrpt_name_is_safe(name)));
            assert!(!guids.contains(&rule.guid));
            guids.push(rule.guid);
        }
        assert_eq!(SINKHOLE_DNS, "192.0.2.1");
    }

    #[test]
    fn firewall_commands_cannot_name_every_address() {
        assert!(firewall_add_commands().iter().all(|cmd| command_may_run(cmd)));
        assert!(firewall_delete_commands().iter().all(|cmd| command_may_run(cmd)));
        assert!(!command_may_run(&[
            r"C:\Windows\System32\netsh.exe",
            "advfirewall",
            "firewall",
            "add",
            "rule",
            "name=Tono selective anthropic v4",
            "dir=out",
            "action=block",
            "remoteip=any",
        ]));
        assert!(!command_may_run(&[
            r"C:\Windows\System32\netsh.exe",
            "advfirewall",
            "firewall",
            "add",
            "rule",
            "dir=out",
            "action=block",
            "remoteip=0.0.0.0/0",
        ]));
    }
}
