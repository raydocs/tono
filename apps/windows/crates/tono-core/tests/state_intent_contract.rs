//! The shared state-intent table. Windows has no product probe in this thread, so every
//! Windows row must stay `todo`. The rule check and the error-code scan still run here.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Fixture {
    version: u32,
    decision: String,
    account_contract: String,
    account_contract_pr: String,
    account_contract_head: String,
    account_contract_introduced: String,
    scenarios: Vec<Scenario>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Scenario {
    id: String,
    rules: Vec<u32>,
    expect: Expect,
    platforms: Platforms,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Expect {
    display: String,
    notification: String,
    button: String,
    failure_written: bool,
    keeps_session: bool,
    keeps_vpn_profile: bool,
    revokes_network_grant: bool,
    auto_connect: bool,
    silent_no_op: bool,
    source: String,
    http: i32,
    code: String,
    deletes_reports: bool,
    late_start_applied: bool,
    connect_blocked: bool,
    failure_cleared: bool,
    baseline_updated: bool,
    shown_connected: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Platforms {
    ios: Row,
    android: Row,
    macos: Row,
    windows: Row,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Row {
    enforcement: String,
    owner: String,
    note: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Allowlist {
    patterns: Vec<String>,
    scan: std::collections::BTreeMap<String, Vec<String>>,
    allow: Vec<AllowEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct AllowEntry {
    platform: String,
    file: String,
    snippet: String,
    owner: String,
    note: String,
}

fn repo_root() -> PathBuf {
    let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    loop {
        if dir.join("docs/contracts/state-intent-scenarios.json").is_file() {
            return dir;
        }
        assert!(dir.pop(), "state-intent fixture not found");
    }
}

fn load_fixture() -> Fixture {
    let path = repo_root().join("docs/contracts/state-intent-scenarios.json");
    let text = std::fs::read_to_string(&path).expect("read state-intent fixture");
    serde_json::from_str(&text).expect("decode state-intent fixture")
}

fn want(out: &mut Vec<String>, id: &str, name: &str, got: &str, exp: &str) {
    if got != exp {
        out.push(format!("{id} {name}={got} want {exp}"));
    }
}

fn flag(out: &mut Vec<String>, id: &str, name: &str, got: bool, exp: bool) {
    if got != exp {
        out.push(format!("{id} {name}={got} want {exp}"));
    }
}

fn problems(scenario: &Scenario) -> Vec<String> {
    let mut out = Vec::new();
    let id = scenario.id.as_str();
    if scenario.expect.silent_no_op {
        out.push(format!("{id} silent no-op"));
    }
    let known = match id {
        "user-disconnect" => {
            check_user_disconnect(scenario, &mut out);
            true
        }
        "system-revoke" => {
            check_system_revoke(scenario, &mut out);
            true
        }
        "core-crash" => {
            check_core_crash(scenario, &mut out);
            true
        }
        "jetsam-or-process-killed" => {
            check_jetsam(scenario, &mut out);
            true
        }
        "network-lost" => {
            check_network_lost(scenario, &mut out);
            true
        }
        "sign-out" => {
            check_sign_out(scenario, &mut out);
            true
        }
        "plan-expired" => {
            check_plan_expired(scenario, &mut out);
            true
        }
        "quota-exhausted" => {
            check_quota_exhausted(scenario, &mut out);
            true
        }
        "device-reauth-required" => {
            check_device_reauth(scenario, &mut out);
            true
        }
        "explicit-credential-revoke" => {
            check_explicit_revoke(scenario, &mut out);
            true
        }
        "rate-limited" => {
            check_rate_limited(scenario, &mut out);
            true
        }
        "recovery-success" => {
            check_recovery(scenario, &mut out);
            true
        }
        "retry-without-catalog" => {
            check_retry_without_catalog(scenario, &mut out);
            true
        }
        "cancel-then-late-start" => {
            check_cancel_late_start(scenario, &mut out);
            true
        }
        "recheck-while-connected" => {
            check_recheck(scenario, &mut out);
            true
        }
        "optional-rollback-failed" => {
            check_optional_rollback(scenario, &mut out);
            true
        }
        "network-restored-update-retired" => {
            check_network_retired(scenario, &mut out);
            true
        }
        "network-restored-update-still-pending" => {
            check_network_pending(scenario, &mut out);
            true
        }
        _ => false,
    };
    if !known {
        out.push(format!("unknown scenario {id}"));
    }
    out
}

fn check_user_disconnect(s: &Scenario, out: &mut Vec<String>) {
    let e = &s.expect;
    want(out, &s.id, "display", &e.display, "off");
    want(out, &s.id, "notification", &e.notification, "none");
    want(out, &s.id, "button", &e.button, "connect");
    flag(out, &s.id, "failure", e.failure_written, false);
    flag(out, &s.id, "session", e.keeps_session, true);
    flag(out, &s.id, "shown", e.shown_connected, false);
}

fn check_system_revoke(s: &Scenario, out: &mut Vec<String>) {
    let e = &s.expect;
    want(out, &s.id, "display", &e.display, "needs-permission");
    want(out, &s.id, "notification", &e.notification, "permission-revoked");
    want(out, &s.id, "button", &e.button, "open-settings");
    want(out, &s.id, "source", &e.source, "system");
    flag(out, &s.id, "session", e.keeps_session, true);
    flag(out, &s.id, "shown", e.shown_connected, false);
}

fn check_core_crash(s: &Scenario, out: &mut Vec<String>) {
    let e = &s.expect;
    want(out, &s.id, "display", &e.display, "failed");
    want(out, &s.id, "notification", &e.notification, "core-crashed");
    want(out, &s.id, "button", &e.button, "retry");
    flag(out, &s.id, "failure", e.failure_written, true);
    want(out, &s.id, "source", &e.source, "core");
    flag(out, &s.id, "shown", e.shown_connected, false);
    flag(out, &s.id, "session", e.keeps_session, true);
}

fn check_jetsam(s: &Scenario, out: &mut Vec<String>) {
    let e = &s.expect;
    want(out, &s.id, "display", &e.display, "failed");
    want(out, &s.id, "notification", &e.notification, "process-killed");
    want(out, &s.id, "button", &e.button, "retry");
    flag(out, &s.id, "failure", e.failure_written, true);
    want(out, &s.id, "source", &e.source, "core");
    flag(out, &s.id, "shown", e.shown_connected, false);
}

fn check_network_lost(s: &Scenario, out: &mut Vec<String>) {
    let e = &s.expect;
    want(out, &s.id, "display", &e.display, "failed");
    want(out, &s.id, "notification", &e.notification, "network-lost");
    want(out, &s.id, "button", &e.button, "retry");
    want(out, &s.id, "source", &e.source, "network");
    flag(out, &s.id, "failure", e.failure_written, true);
    flag(out, &s.id, "session", e.keeps_session, true);
}

fn check_sign_out(s: &Scenario, out: &mut Vec<String>) {
    let e = &s.expect;
    want(out, &s.id, "display", &e.display, "signed-out");
    want(out, &s.id, "notification", &e.notification, "none");
    want(out, &s.id, "button", &e.button, "sign-in");
    flag(out, &s.id, "failure", e.failure_written, false);
    flag(out, &s.id, "session", e.keeps_session, false);
    flag(out, &s.id, "profile", e.keeps_vpn_profile, false);
    flag(out, &s.id, "shown", e.shown_connected, false);
}

fn check_plan_expired(s: &Scenario, out: &mut Vec<String>) {
    let e = &s.expect;
    want(out, &s.id, "display", &e.display, "account-hold");
    want(out, &s.id, "notification", &e.notification, "plan-expired");
    want(out, &s.id, "button", &e.button, "renew");
    flag(out, &s.id, "http", e.http == 403, true);
    want(out, &s.id, "code", &e.code, "PLAN_EXPIRED");
    flag(out, &s.id, "session", e.keeps_session, true);
    flag(out, &s.id, "profile", e.keeps_vpn_profile, true);
    flag(out, &s.id, "grant", e.revokes_network_grant, true);
    flag(out, &s.id, "auto", e.auto_connect, false);
    flag(out, &s.id, "failure", e.failure_written, false);
    want(out, &s.id, "source", &e.source, "account");
}

fn check_quota_exhausted(s: &Scenario, out: &mut Vec<String>) {
    let e = &s.expect;
    want(out, &s.id, "display", &e.display, "account-hold");
    want(out, &s.id, "notification", &e.notification, "quota-exhausted");
    want(out, &s.id, "button", &e.button, "renew");
    flag(out, &s.id, "http", e.http == 403, true);
    want(out, &s.id, "code", &e.code, "QUOTA_EXHAUSTED");
    flag(out, &s.id, "session", e.keeps_session, true);
    flag(out, &s.id, "profile", e.keeps_vpn_profile, true);
    flag(out, &s.id, "grant", e.revokes_network_grant, true);
    flag(out, &s.id, "auto", e.auto_connect, false);
    flag(out, &s.id, "failure", e.failure_written, false);
    want(out, &s.id, "source", &e.source, "account");
}

fn check_device_reauth(s: &Scenario, out: &mut Vec<String>) {
    let e = &s.expect;
    want(out, &s.id, "display", &e.display, "reauth");
    want(out, &s.id, "notification", &e.notification, "reauth-required");
    want(out, &s.id, "button", &e.button, "verify-login");
    flag(out, &s.id, "http", e.http == 403, true);
    want(out, &s.id, "code", &e.code, "DEVICE_REAUTH_REQUIRED");
    flag(out, &s.id, "session", e.keeps_session, true);
    flag(out, &s.id, "profile", e.keeps_vpn_profile, true);
    flag(out, &s.id, "auto", e.auto_connect, false);
    flag(out, &s.id, "failure", e.failure_written, false);
    want(out, &s.id, "source", &e.source, "account");
}

fn check_explicit_revoke(s: &Scenario, out: &mut Vec<String>) {
    let e = &s.expect;
    want(out, &s.id, "display", &e.display, "signed-out");
    want(out, &s.id, "notification", &e.notification, "signed-out");
    want(out, &s.id, "button", &e.button, "sign-in");
    flag(out, &s.id, "http", e.http == 401, true);
    want(out, &s.id, "code", &e.code, "UNAUTHORIZED");
    flag(out, &s.id, "session", e.keeps_session, false);
    flag(out, &s.id, "profile", e.keeps_vpn_profile, false);
    flag(out, &s.id, "failure", e.failure_written, false);
    want(out, &s.id, "source", &e.source, "account");
}

fn check_rate_limited(s: &Scenario, out: &mut Vec<String>) {
    let e = &s.expect;
    want(out, &s.id, "display", &e.display, "limited");
    want(out, &s.id, "notification", &e.notification, "rate-limited");
    want(out, &s.id, "button", &e.button, "retry");
    flag(out, &s.id, "http", e.http == 429, true);
    want(out, &s.id, "code", &e.code, "RATE_LIMITED");
    flag(out, &s.id, "session", e.keeps_session, true);
    flag(out, &s.id, "reports", e.deletes_reports, false);
    flag(out, &s.id, "profile", e.keeps_vpn_profile, true);
}

fn check_recovery(s: &Scenario, out: &mut Vec<String>) {
    let e = &s.expect;
    want(out, &s.id, "display", &e.display, "connected");
    want(out, &s.id, "notification", &e.notification, "recovered");
    want(out, &s.id, "button", &e.button, "disconnect");
    flag(out, &s.id, "cleared", e.failure_cleared, true);
    flag(out, &s.id, "failure", e.failure_written, false);
    flag(out, &s.id, "shown", e.shown_connected, true);
    flag(out, &s.id, "session", e.keeps_session, true);
}

fn check_retry_without_catalog(s: &Scenario, out: &mut Vec<String>) {
    let e = &s.expect;
    want(out, &s.id, "display", &e.display, "catalog-missing");
    want(out, &s.id, "notification", &e.notification, "catalog-missing");
    want(out, &s.id, "button", &e.button, "retry");
    flag(out, &s.id, "session", e.keeps_session, true);
}

fn check_cancel_late_start(s: &Scenario, out: &mut Vec<String>) {
    let e = &s.expect;
    want(out, &s.id, "display", &e.display, "off");
    want(out, &s.id, "notification", &e.notification, "none");
    want(out, &s.id, "button", &e.button, "connect");
    flag(out, &s.id, "late", e.late_start_applied, false);
    flag(out, &s.id, "shown", e.shown_connected, false);
    flag(out, &s.id, "failure", e.failure_written, false);
}

fn check_recheck(s: &Scenario, out: &mut Vec<String>) {
    let e = &s.expect;
    want(out, &s.id, "display", &e.display, "connected");
    want(out, &s.id, "notification", &e.notification, "none");
    want(out, &s.id, "button", &e.button, "disconnect");
    flag(out, &s.id, "shown", e.shown_connected, true);
    flag(out, &s.id, "failure", e.failure_written, false);
}

fn check_optional_rollback(s: &Scenario, out: &mut Vec<String>) {
    let e = &s.expect;
    want(out, &s.id, "display", &e.display, "failed");
    want(out, &s.id, "notification", &e.notification, "rollback-failed");
    want(out, &s.id, "button", &e.button, "retry");
    flag(out, &s.id, "shown", e.shown_connected, false);
    flag(out, &s.id, "baseline", e.baseline_updated, true);
    flag(out, &s.id, "failure", e.failure_written, true);
    want(out, &s.id, "source", &e.source, "core");
}

fn check_network_retired(s: &Scenario, out: &mut Vec<String>) {
    let e = &s.expect;
    want(out, &s.id, "display", &e.display, "ready");
    want(out, &s.id, "notification", &e.notification, "none");
    want(out, &s.id, "button", &e.button, "connect");
    flag(out, &s.id, "blocked", e.connect_blocked, false);
    flag(out, &s.id, "shown", e.shown_connected, false);
}

fn check_network_pending(s: &Scenario, out: &mut Vec<String>) {
    let e = &s.expect;
    want(out, &s.id, "display", &e.display, "update-pending");
    want(out, &s.id, "notification", &e.notification, "update-still-pending");
    want(out, &s.id, "button", &e.button, "explain-blocked");
    flag(out, &s.id, "blocked", e.connect_blocked, true);
    flag(out, &s.id, "shown", e.shown_connected, false);
}

fn enforcement_ok(value: &str) -> bool {
    matches!(value, "enabled" | "expected-failure" | "todo")
}

fn rel_posix(repo: &Path, file: &Path) -> String {
    file.strip_prefix(repo)
        .expect("scan file is under the repo")
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn collect_files(root: &Path, out: &mut Vec<PathBuf>) {
    if root.is_file() {
        out.push(root.to_path_buf());
        return;
    }
    let entries = std::fs::read_dir(root).unwrap_or_else(|err| panic!("cannot list {}: {err}", root.display()));
    for entry in entries {
        let path = entry.expect("read dir entry").path();
        if path.is_dir() {
            collect_files(&path, out);
        } else {
            out.push(path);
        }
    }
}

fn scan_error_codes(platform: &str, repo: &Path) {
    let path = repo.join("docs/contracts/state-intent-error-code-allowlist.json");
    let text = std::fs::read_to_string(&path).expect("read error-code allowlist");
    let allowlist: Allowlist = serde_json::from_str(&text).expect("decode error-code allowlist");
    let roots = allowlist.scan.get(platform).expect("scan roots for platform");
    let allow: Vec<&AllowEntry> = allowlist.allow.iter().filter(|entry| entry.platform == platform).collect();
    let extensions = ["kt", "swift", "tsx", "ts", "rs"];
    let mut matches: Vec<(String, String)> = Vec::new();
    for rel in roots {
        let root = repo.join(rel);
        assert!(root.exists(), "missing scan root {rel}");
        let mut files = Vec::new();
        collect_files(&root, &mut files);
        for file in files {
            let ext = file.extension().and_then(|ext| ext.to_str()).unwrap_or("");
            if !extensions.contains(&ext) {
                continue;
            }
            let rel_path = rel_posix(repo, &file);
            if rel_path.contains("/src/test/") || rel_path.contains("/build/") {
                continue;
            }
            let text = std::fs::read_to_string(&file).unwrap_or_else(|err| panic!("read {}: {err}", file.display()));
            for raw in text.split('\n') {
                let line = raw.strip_suffix('\r').unwrap_or(raw);
                if allowlist.patterns.iter().any(|pattern| line.contains(pattern)) {
                    matches.push((rel_path.clone(), line.to_string()));
                }
            }
        }
    }
    for (path, line) in &matches {
        let listed = allow.iter().any(|entry| entry.file == *path && line.contains(&entry.snippet));
        assert!(listed, "unlisted code render {path}: {line}");
    }
    for entry in allow {
        assert!(!entry.owner.is_empty(), "{}", entry.file);
        assert!(!entry.note.is_empty(), "{}", entry.file);
        let live = matches.iter().any(|(path, line)| path == &entry.file && line.contains(&entry.snippet));
        assert!(live, "stale allowlist {} {}", entry.file, entry.snippet);
    }
}

#[test]
fn fixture_matches_the_rules_and_windows_stays_todo() {
    let fixture = load_fixture();
    assert_eq!(fixture.version, 1);
    assert_eq!(fixture.account_contract, "docs/control-plane-error-contract.md");
    assert_eq!(fixture.account_contract_pr, "https://github.com/raydocs/tono/pull/1738");
    assert_eq!(fixture.account_contract_head, "429e23427");
    assert_eq!(fixture.account_contract_introduced, "3205b5c76");
    let decision = std::fs::read_to_string(repo_root().join(&fixture.decision)).expect("read decision");
    assert!(decision.contains("134-2026-10-24-state-intent-rule"));
    assert!(decision.contains("429e23427"));
    assert_eq!(fixture.scenarios.len(), 18);
    let mut covered = BTreeSet::new();
    let mut ids = BTreeSet::new();
    for scenario in &fixture.scenarios {
        assert!(ids.insert(scenario.id.clone()), "{}", scenario.id);
        covered.extend(scenario.rules.iter().copied());
        for row in [
            &scenario.platforms.ios,
            &scenario.platforms.android,
            &scenario.platforms.macos,
            &scenario.platforms.windows,
        ] {
            assert!(enforcement_ok(&row.enforcement), "{}", scenario.id);
            assert!(!row.note.is_empty(), "{}", scenario.id);
            assert!(!row.owner.is_empty(), "{}", scenario.id);
        }
        assert_eq!(
            scenario.platforms.windows.enforcement, "todo",
            "Windows has no product probe for {}",
            scenario.id
        );
        let found = problems(scenario);
        assert!(found.is_empty(), "{}", found.join("\n"));
        assert!(decision.contains(&scenario.id), "{}", scenario.id);
    }
    assert_eq!(covered, (1..=7).collect::<BTreeSet<_>>());
}

#[test]
fn internal_codes_are_not_rendered_unless_allowlisted() {
    scan_error_codes("windows", &repo_root());
}
