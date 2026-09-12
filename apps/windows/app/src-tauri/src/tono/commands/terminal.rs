//! Terminal/shell proxy-env diagnostics. Not the connect or account owner.

use std::sync::Arc;
use std::time::Duration;
use once_cell::sync::Lazy;
use tauri::AppHandle;
use crate::process::AsyncHandler;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyEnvEntry {
    pub key: String,
    pub value: String,
    pub source: String,
    pub guidance: String,
    pub auto_clearable: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalEnvReport {
    pub has_conflict: bool,
    pub entries: Vec<ProxyEnvEntry>,
    pub claude_code_ready: bool,
    pub can_auto_clear: bool,
}

const TERMINAL_PROXY_KEYS: [&str; 6] = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
];
const CONFIGURED_PROXY_VALUE: &str = "<configured>";
// Windows environment-variable and registry names are case-insensitive. Query
// one spelling so a lowercase value is detected once rather than duplicated;
// text/JSON profiles still use all six case-sensitive spellings above.
#[cfg(windows)]
const WINDOWS_TERMINAL_PROXY_KEYS: [&str; 3] = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"];
const MAX_TERMINAL_SETTINGS_BYTES: u64 = 1024 * 1024;

fn is_terminal_proxy_key(key: &str) -> bool {
    TERMINAL_PROXY_KEYS
        .iter()
        .any(|candidate| key.eq_ignore_ascii_case(candidate))
}

fn unquote_proxy_value(value: &str) -> Option<String> {
    let mut value = value.trim().trim_end_matches(';').trim();
    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        value = &value[1..value.len() - 1];
    }
    let value = value.trim();
    if value.is_empty()
        || value.eq_ignore_ascii_case("$null")
        || value.eq_ignore_ascii_case("null")
        || value.eq_ignore_ascii_case("nil")
    {
        None
    } else {
        Some(value.to_string())
    }
}

/// Finds active proxy assignments in shell, PowerShell and CMD startup text.
/// It deliberately does not rewrite these files: profiles often contain
/// conditionals and unrelated commands, so a textual delete is not safe.
pub(super) fn proxy_assignments_in_text(contents: &str) -> std::collections::BTreeMap<String, String> {
    static SH_ASSIGNMENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r"(?i)^(?:export\s+)?(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*(.+)$",
        )
        .expect("valid shell proxy regex")
    });
    static POWERSHELL_ASSIGNMENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r"(?i)^\$env:(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*(.+)$",
        )
        .expect("valid PowerShell proxy regex")
    });
    static CMD_ASSIGNMENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r#"(?i)^@?set\s+"?(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*(.*?)"?$"#,
        )
        .expect("valid CMD proxy regex")
    });
    static POWERSHELL_ITEM_ASSIGNMENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r#"(?i)(?:^|[;{]\s*)(?:set-item|new-item)\s+(?:(?:-path|-literalpath)\s+)?env:(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s+(?:-value\s+)?("[^"]*"|'[^']*'|[^\s;)}]+)"#,
        )
        .expect("valid PowerShell item proxy regex")
    });
    static POWERSHELL_PERSISTENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r#"(?i)(?:^|[;{]\s*)\[(?:System\.)?Environment\]::SetEnvironmentVariable\(\s*['"](HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)['"]\s*,\s*([^,)]+)"#,
        )
        .expect("valid persistent PowerShell proxy regex")
    });
    static INLINE_SH_ASSIGNMENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r#"(?i)(?:^|[;{(]\s*|\bthen\s+|\bdo\s+)(?:env\s+)?(?:export\s+)?(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*("[^"]+"|'[^']+'|[^\s;)}]+)"#,
        )
        .expect("valid inline shell proxy regex")
    });
    static SHELL_ALIAS_ASSIGNMENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r#"(?i)^alias\s+\S+\s*=\s*['"][^'"]*(?:env\s+)?(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*("[^"]+"|'[^']+'|[^\s;'"}]+)"#,
        )
        .expect("valid shell alias proxy regex")
    });
    static INLINE_POWERSHELL_ASSIGNMENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r#"(?i)(?:^|[;{]\s*)\$env:(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*("[^"]+"|'[^']+'|[^;)}]+)"#,
        )
        .expect("valid inline PowerShell proxy regex")
    });
    static PERSISTENT_PROXY_COMMAND: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r#"(?i)(?:^|[;&|]\s*)(?:launchctl\s+setenv|setx(?:\.exe)?)\s+['"]?(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)['"]?\s+("[^"]+"|'[^']+'|[^\s;&|]+)"#,
        )
        .expect("valid persistent proxy command regex")
    });
    static INLINE_CMD_ASSIGNMENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r#"(?i)(?:^|[;&|]\s*|\bdo\s+|cmd(?:\.exe)?\s+/[ck]\s+["']?)@?set\s+"?(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\s*=\s*("[^"]*"|'[^']*'|[^\s;&|"]+)"#,
        )
        .expect("valid inline CMD proxy regex")
    });
    static FISH_UNIVERSAL_ASSIGNMENT: Lazy<regex::Regex> = Lazy::new(|| {
        regex::Regex::new(
            r"(?i)^SETUVAR(?:\s+--[A-Za-z-]+)*\s+(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY):(.+)$",
        )
        .expect("valid fish universal proxy regex")
    });

    let mut assignments = std::collections::BTreeMap::new();
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty()
            || line.starts_with('#')
            || line.starts_with("//")
            || line.starts_with("::")
            || line
                .split_ascii_whitespace()
                .next()
                .is_some_and(|word| word.eq_ignore_ascii_case("rem"))
        {
            continue;
        }

        let captures = SH_ASSIGNMENT
            .captures(line)
            .or_else(|| POWERSHELL_ASSIGNMENT.captures(line))
            .or_else(|| CMD_ASSIGNMENT.captures(line))
            .or_else(|| POWERSHELL_ITEM_ASSIGNMENT.captures(line))
            .or_else(|| POWERSHELL_PERSISTENT.captures(line))
            .or_else(|| SHELL_ALIAS_ASSIGNMENT.captures(line))
            .or_else(|| INLINE_SH_ASSIGNMENT.captures(line))
            .or_else(|| INLINE_POWERSHELL_ASSIGNMENT.captures(line))
            .or_else(|| PERSISTENT_PROXY_COMMAND.captures(line))
            .or_else(|| INLINE_CMD_ASSIGNMENT.captures(line))
            .or_else(|| FISH_UNIVERSAL_ASSIGNMENT.captures(line));
        if let Some(captures) = captures {
            if let Some(value) = unquote_proxy_value(&captures[2]) {
                assignments.insert(captures[1].to_string(), value);
            }
            continue;
        }

        // CMD AutoRun commonly chains setup with `&` or `|`. We only need to
        // identify an assignment and deliberately leave the complete value for
        // the user's manual edit; splitting a URL query is still a positive hit.
        for statement in line.split(['&', '|']).skip(1).map(str::trim) {
            if let Some(captures) = CMD_ASSIGNMENT.captures(statement)
                && let Some(value) = unquote_proxy_value(&captures[2])
            {
                assignments.insert(captures[1].to_string(), value);
            }
        }

        // fish: `set -gx HTTP_PROXY value`. Erase/query forms are not
        // assignments and must not turn a clean profile into a conflict.
        let words: Vec<&str> = line.split_whitespace().collect();
        if words.first().is_some_and(|word| word.eq_ignore_ascii_case("set")) {
            let mut index = 1;
            let mut removes = false;
            while let Some(flag) = words.get(index).filter(|word| word.starts_with('-')) {
                removes |= flag.eq_ignore_ascii_case("--erase")
                    || (!flag.starts_with("--") && flag[1..].contains('e'));
                index += 1;
            }
            if !removes
                && let (Some(key), Some(value)) = (words.get(index), words.get(index + 1))
                && is_terminal_proxy_key(key)
                && let Some(value) = unquote_proxy_value(value)
            {
                assignments.insert((*key).to_string(), value);
            }
        }
    }
    assignments
}

fn strip_jsonc(contents: &str) -> String {
    let characters: Vec<char> = contents.chars().collect();
    let mut stripped = String::with_capacity(contents.len());
    let mut index = 0;
    let mut in_string = false;
    let mut escaped = false;
    while index < characters.len() {
        let character = characters[index];
        if in_string {
            stripped.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            index += 1;
            continue;
        }
        if character == '"' {
            in_string = true;
            stripped.push('"');
            index += 1;
        } else if character == '/' && characters.get(index + 1) == Some(&'/') {
            index += 2;
            while index < characters.len() && characters[index] != '\n' {
                index += 1;
            }
        } else if character == '/' && characters.get(index + 1) == Some(&'*') {
            index += 2;
            while index + 1 < characters.len()
                && !(characters[index] == '*' && characters[index + 1] == '/')
            {
                index += 1;
            }
            if index + 1 < characters.len() {
                index += 2;
            } else {
                // Keep malformed JSONC malformed. Silently consuming an
                // unfinished comment could turn an unreadable persistent
                // proxy source into a false Ready report.
                stripped.push('\0');
                index = characters.len();
            }
        } else {
            stripped.push(character);
            index += 1;
        }
    }

    // serde_json rejects JSONC trailing commas. Remove only a comma followed
    // by whitespace and a closing bracket, never one inside a string.
    let characters: Vec<char> = stripped.chars().collect();
    let mut normalized = String::with_capacity(stripped.len());
    let mut index = 0;
    let mut in_string = false;
    let mut escaped = false;
    while index < characters.len() {
        let character = characters[index];
        if in_string {
            normalized.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                in_string = false;
            }
            index += 1;
            continue;
        }
        if character == '"' {
            in_string = true;
        }
        if character == ',' {
            let mut lookahead = index + 1;
            while characters.get(lookahead).is_some_and(|ch| ch.is_whitespace()) {
                lookahead += 1;
            }
            if matches!(characters.get(lookahead), Some('}' | ']')) {
                index += 1;
                continue;
            }
        }
        normalized.push(character);
        index += 1;
    }
    normalized
}

pub(super) fn proxy_assignments_in_json(
    contents: &str,
    container_path: &[&str],
) -> Result<std::collections::BTreeMap<String, String>, String> {
    let root: serde_json::Value = serde_json::from_str(&strip_jsonc(contents))
        .map_err(|error| format!("invalid proxy settings JSON: {error}"))?;
    let mut container = &root;
    for component in container_path {
        let Some(next) = container.get(component) else {
            return Ok(std::collections::BTreeMap::new());
        };
        container = next;
    }
    let Some(object) = container.as_object() else {
        return Ok(std::collections::BTreeMap::new());
    };
    let mut assignments = std::collections::BTreeMap::new();
    for (key, value) in object {
        if !is_terminal_proxy_key(key) {
            continue;
        }
        if let Some(value) = value.as_str().and_then(unquote_proxy_value) {
            assignments.insert(key.clone(), value);
        }
    }
    Ok(assignments)
}

fn read_bounded_terminal_settings(path: &std::path::Path) -> Result<Option<String>, String> {
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Failed to inspect {}: {error}", path.display())),
    };
    if !metadata.is_file() {
        return Ok(None);
    }
    if metadata.len() > MAX_TERMINAL_SETTINGS_BYTES {
        return Err(format!("Proxy settings file is unexpectedly large: {}", path.display()));
    }
    std::fs::read_to_string(path)
        .map(Some)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))
}

pub(super) fn file_uri_path(uri: &str) -> Option<std::path::PathBuf> {
    let uri = reqwest::Url::parse(uri).ok()?;
    // Diagnostic discovery is local-only. Do not turn a remote authority into
    // a relative path, or newly probe stale/unreachable network shares here.
    if uri.scheme() != "file"
        || uri.host_str().is_some_and(|host| host != "localhost")
        || uri.query().is_some()
        || uri.fragment().is_some()
    {
        return None;
    }
    let path = uri.to_file_path().ok()?;
    (path.is_absolute() && !path.to_string_lossy().contains('\0')).then_some(path)
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct VscodeWorkspaceDiscovery {
    pub(super) settings: Vec<std::path::PathBuf>,
    pub(super) roots: Vec<std::path::PathBuf>,
}

fn vscode_workspace_roots(
    path: &std::path::Path,
) -> Result<Vec<std::path::PathBuf>, String> {
    let Some(contents) = read_bounded_terminal_settings(path)? else {
        return Ok(Vec::new());
    };
    let workspace = serde_json::from_str::<serde_json::Value>(&strip_jsonc(&contents))
        .map_err(|error| format!("Invalid {}: {error}", path.display()))?;
    let Some(folders) = workspace.get("folders") else {
        return Ok(Vec::new());
    };
    let folders = folders
        .as_array()
        .filter(|folders| folders.len() <= 256)
        .ok_or_else(|| format!("Invalid VS Code workspace folders in {}", path.display()))?;
    let mut roots = Vec::new();
    for folder in folders {
        let folder = folder
            .as_object()
            .ok_or_else(|| format!("Invalid VS Code workspace folder in {}", path.display()))?;
        if let Some(uri) = folder.get("uri").and_then(serde_json::Value::as_str) {
            if let Some(root) = file_uri_path(uri) {
                roots.push(root);
            }
            continue;
        }
        let relative = folder
            .get("path")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.is_empty() && !value.contains('\0'))
            .ok_or_else(|| format!("Invalid VS Code workspace folder in {}", path.display()))?;
        let root = std::path::PathBuf::from(relative);
        roots.push(if root.is_absolute() {
            root
        } else {
            path.parent()
                .unwrap_or_else(|| std::path::Path::new("."))
                .join(root)
        });
    }
    Ok(roots)
}

pub(super) fn vscode_workspace_discovery(
    user_dir: &std::path::Path,
) -> Result<VscodeWorkspaceDiscovery, String> {
    let storage = user_dir.join("workspaceStorage");
    let directories = match std::fs::read_dir(&storage) {
        Ok(directories) => directories,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(VscodeWorkspaceDiscovery {
                settings: Vec::new(),
                roots: Vec::new(),
            });
        }
        Err(error) => return Err(format!("Failed to inspect {}: {error}", storage.display())),
    };
    let mut discovery = VscodeWorkspaceDiscovery {
        settings: Vec::new(),
        roots: Vec::new(),
    };
    for directory in directories {
        let directory = directory.map_err(|error| {
            format!("Failed to inspect VS Code workspace metadata: {error}")
        })?;
        let metadata_path = directory.path().join("workspace.json");
        let Some(contents) = read_bounded_terminal_settings(&metadata_path)? else {
            continue;
        };
        let metadata = serde_json::from_str::<serde_json::Value>(&strip_jsonc(&contents))
            .map_err(|error| format!("Invalid {}: {error}", metadata_path.display()))?;
        if let Some(folder) = metadata
            .get("folder")
            .and_then(serde_json::Value::as_str)
            .and_then(file_uri_path)
        {
            discovery.roots.push(folder.clone());
            let settings = folder.join(".vscode").join("settings.json");
            if settings.is_file() {
                discovery.settings.push(settings);
            }
        }
        if let Some(workspace) = metadata
            .get("workspace")
            .and_then(serde_json::Value::as_str)
            .and_then(file_uri_path)
            .filter(|path| path.is_file())
        {
            discovery.roots.extend(vscode_workspace_roots(&workspace)?);
            discovery.settings.push(workspace);
        }
    }
    discovery.settings.sort();
    discovery.settings.dedup();
    discovery.roots.sort();
    discovery.roots.dedup();
    Ok(discovery)
}

pub(super) fn vscode_profile_setting_paths(
    user_dir: &std::path::Path,
) -> Result<Vec<std::path::PathBuf>, String> {
    let profiles = user_dir.join("profiles");
    let directories = match std::fs::read_dir(&profiles) {
        Ok(directories) => directories,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("Failed to inspect {}: {error}", profiles.display())),
    };
    let mut settings = Vec::new();
    for (index, directory) in directories.enumerate() {
        if index >= 128 {
            return Err(format!(
                "VS Code profiles directory has too many entries: {}",
                profiles.display()
            ));
        }
        let directory = directory
            .map_err(|error| format!("Failed to inspect VS Code profile metadata: {error}"))?;
        if !directory
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", directory.path().display()))?
            .is_dir()
        {
            continue;
        }
        let path = directory.path().join("settings.json");
        if path.is_file() {
            settings.push(path);
        }
    }
    settings.sort();
    Ok(settings)
}

pub(super) fn append_proxy_entries(
    entries: &mut Vec<ProxyEnvEntry>,
    assignments: std::collections::BTreeMap<String, String>,
    source: String,
    guidance: String,
    auto_clearable: bool,
) {
    entries.extend(assignments.into_keys().map(|key| ProxyEnvEntry {
        key,
        value: CONFIGURED_PROXY_VALUE.to_string(),
        source: source.clone(),
        guidance: guidance.clone(),
        auto_clearable,
    }));
}

fn scan_text_proxy_file(
    entries: &mut Vec<ProxyEnvEntry>,
    path: &std::path::Path,
    label: &str,
    guidance: &str,
) -> Result<(), String> {
    if let Some(contents) = read_bounded_terminal_settings(path)? {
        append_proxy_entries(
            entries,
            proxy_assignments_in_text(&contents),
            format!("{label}: {}", path.display()),
            guidance.to_string(),
            false,
        );
    }
    Ok(())
}

pub(super) fn scan_text_proxy_directory(
    entries: &mut Vec<ProxyEnvEntry>,
    directory: &std::path::Path,
    extension: &str,
    label: &str,
    guidance: &str,
) -> Result<(), String> {
    let listing = match std::fs::read_dir(directory) {
        Ok(listing) => listing,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Failed to inspect profile directory {}: {error}",
                directory.display()
            ));
        }
    };
    let mut paths = Vec::new();
    for entry in listing {
        let entry = entry.map_err(|error| {
            format!(
                "Failed to inspect profile directory {}: {error}",
                directory.display()
            )
        })?;
        let file_type = entry.file_type().map_err(|error| {
            format!("Failed to inspect {}: {error}", entry.path().display())
        })?;
        if file_type.is_file()
            && entry
                .path()
                .extension()
                .is_some_and(|value| value.eq_ignore_ascii_case(extension))
        {
            paths.push(entry.path());
        }
        if paths.len() > 256 {
            return Err(format!(
                "Profile directory contains too many files to inspect safely: {}",
                directory.display()
            ));
        }
    }
    paths.sort();
    for path in paths {
        scan_text_proxy_file(entries, &path, label, guidance)?;
    }
    Ok(())
}

pub(super) fn scan_json_proxy_file(
    entries: &mut Vec<ProxyEnvEntry>,
    path: &std::path::Path,
    container_path: &[&str],
    label: &str,
    guidance: &str,
) -> Result<(), String> {
    if let Some(contents) = read_bounded_terminal_settings(path)? {
        let assignments = proxy_assignments_in_json(&contents, container_path)
            .map_err(|error| format!("{}: {error}", path.display()))?;
        append_proxy_entries(
            entries,
            assignments,
            format!("{label}: {}", path.display()),
            guidance.to_string(),
            false,
        );
    }
    Ok(())
}

pub(super) fn scan_json_proxy_directory(
    entries: &mut Vec<ProxyEnvEntry>,
    directory: &std::path::Path,
    container_path: &[&str],
    label: &str,
    guidance: &str,
) -> Result<(), String> {
    let listing = match std::fs::read_dir(directory) {
        Ok(listing) => listing,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Failed to inspect settings directory {}: {error}",
                directory.display()
            ));
        }
    };
    let mut paths = Vec::new();
    for entry in listing {
        let entry = entry.map_err(|error| {
            format!(
                "Failed to inspect settings directory {}: {error}",
                directory.display()
            )
        })?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Failed to inspect {}: {error}", entry.path().display()))?;
        if file_type.is_file()
            && entry
                .path()
                .extension()
                .is_some_and(|value| value.eq_ignore_ascii_case("json"))
        {
            paths.push(entry.path());
        }
        if paths.len() > 256 {
            return Err(format!(
                "Settings directory contains too many files to inspect safely: {}",
                directory.display()
            ));
        }
    }
    paths.sort();
    for path in paths {
        scan_json_proxy_file(entries, &path, container_path, label, guidance)?;
    }
    Ok(())
}

pub(super) fn command_output_with_timeout(
    command: &mut std::process::Command,
    timeout: std::time::Duration,
    maximum_bytes: usize,
) -> std::io::Result<std::process::Output> {
    use std::io::Read as _;
    use std::process::Stdio;

    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn()?;
    let stdout = child.stdout.take().expect("piped stdout is present");
    let stderr = child.stderr.take().expect("piped stderr is present");
    let read_pipe = move |pipe: Box<dyn std::io::Read + Send>| {
        let mut bytes = Vec::new();
        pipe.take(maximum_bytes as u64 + 1).read_to_end(&mut bytes)?;
        Ok::<Vec<u8>, std::io::Error>(bytes)
    };
    let stdout_reader = std::thread::spawn(move || read_pipe(Box::new(stdout)));
    let stderr_reader = std::thread::spawn(move || read_pipe(Box::new(stderr)));
    let started = std::time::Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            // Do not join here: a descendant can inherit the pipe handles and
            // keep reader threads alive after the direct child is gone. The
            // detached bounded readers close when that process tree exits,
            // while diagnostics returns fail-closed on the deadline.
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "command timed out",
            ));
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    };
    let join = |reader: std::thread::JoinHandle<std::io::Result<Vec<u8>>>| {
        reader.join().map_err(|_| {
            std::io::Error::other("command output reader terminated unexpectedly")
        })?
    };
    Ok(std::process::Output {
        status,
        stdout: join(stdout_reader)?,
        stderr: join(stderr_reader)?,
    })
}

#[cfg(windows)]
fn decode_windows_command_output(bytes: &[u8]) -> String {
    decode_windows_console_bytes(bytes)
}

#[cfg(windows)]
fn scan_wsl_profiles(entries: &mut Vec<ProxyEnvEntry>) -> Result<(), String> {
    let mut list_command = std::process::Command::new("wsl.exe");
    list_command.args(["--list", "--quiet"]);
    let list = match command_output_with_timeout(
        &mut list_command,
        std::time::Duration::from_secs(10),
        64 * 1024,
    ) {
        Ok(output) if output.status.success() => output,
        Ok(output) => {
            use winreg::enums::HKEY_CURRENT_USER;
            use winreg::RegKey;
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let registered = match hkcu.open_subkey(
                r"Software\Microsoft\Windows\CurrentVersion\Lxss",
            ) {
                Ok(key) => match key.enum_keys().next() {
                    Some(Ok(_)) => true,
                    Some(Err(error)) => {
                        return Err(format!("Failed to inspect registered WSL distributions: {error}"));
                    }
                    None => false,
                },
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
                Err(error) => {
                    return Err(format!("Failed to inspect registered WSL distributions: {error}"));
                }
            };
            if !registered {
                return Ok(());
            }
            return Err(format!(
                "Failed to list registered WSL distributions (status {})",
                output.status
            ));
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Failed to start WSL profile inspection: {error}")),
    };
    let distributions = decode_windows_command_output(&list.stdout);
    const SCRIPT: &str = r#"total=0; for f in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.zshenv" "$HOME/.zshrc" "$HOME/.zprofile" "$HOME/.zlogin" "$HOME/.config/fish/config.fish" "$HOME/.config/fish/fish_variables" "$HOME"/.config/fish/conf.d/*.fish "$HOME"/.config/powershell/*.ps1 "$HOME/.claude/settings.json" "$HOME/.claude/settings.local.json" "$HOME/.vscode-server/data/Machine/settings.json" "$HOME/.vscode-server-insiders/data/Machine/settings.json" /etc/environment /etc/profile /etc/bash.bashrc /etc/zsh/zshenv /etc/zsh/zprofile /etc/zsh/zshrc /etc/profile.d/*.sh /etc/fish/config.fish /etc/fish/fish_variables /etc/fish/conf.d/*.fish /opt/microsoft/powershell/7/*.ps1 /etc/claude-code/managed-settings.json /etc/claude-code/managed-settings.d/*.json; do [ -f "$f" ] || continue; n=$(wc -c < "$f") || exit 1; total=$((total+n)); [ "$total" -le 4194304 ] || exit 2; printf '\036%s\037%s\037' "$f" "$n"; if [ "$n" -le 1048576 ]; then cat -- "$f"; fi; done"#;
    for distribution in distributions.lines().map(str::trim).filter(|name| !name.is_empty()) {
        let mut command = std::process::Command::new("wsl.exe");
        command.args(["--distribution", distribution, "--", "sh", "-lc", SCRIPT]);
        let output = command_output_with_timeout(
            &mut command,
            std::time::Duration::from_secs(15),
            4 * MAX_TERMINAL_SETTINGS_BYTES as usize,
        ).map_err(|error| format!("Failed to inspect WSL distribution {distribution}: {error}"))?;
        if !output.status.success() {
            return Err(format!("Failed to inspect WSL distribution {distribution}"));
        }
        if output.stdout.len() > 4 * MAX_TERMINAL_SETTINGS_BYTES as usize {
            return Err(format!("WSL proxy profiles are unexpectedly large: {distribution}"));
        }
        let output = String::from_utf8_lossy(&output.stdout);
        for section in output.split('\u{1e}').filter(|section| !section.is_empty()) {
            let mut fields = section.splitn(3, '\u{1f}');
            let (Some(path), Some(size), Some(contents)) =
                (fields.next(), fields.next(), fields.next())
            else {
                return Err(format!("Invalid WSL profile response from {distribution}"));
            };
            let size = size
                .parse::<u64>()
                .map_err(|_| format!("Invalid WSL profile size for {distribution}:{path}"))?;
            if size > MAX_TERMINAL_SETTINGS_BYTES {
                return Err(format!("WSL proxy profile is unexpectedly large: {distribution}:{path}"));
            }
            let assignments = if path.ends_with(".json") {
                let container: &[&str] = if path.contains("/.vscode-server") {
                    &["terminal.integrated.env.linux"]
                } else {
                    &["env"]
                };
                proxy_assignments_in_json(contents, container)
                    .map_err(|error| format!("WSL {distribution}:{path}: {error}"))?
            } else {
                proxy_assignments_in_text(contents)
            };
            append_proxy_entries(
                entries,
                assignments,
                format!("WSL {distribution}: {path}"),
                format!(
                    "Remove the proxy assignment from {path} inside WSL, then restart that WSL terminal (or run wsl --shutdown)."
                ),
                false,
            );
        }
    }
    Ok(())
}

fn powershell_profile_roots(home: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut roots = vec![home.join("Documents")];
    for variable in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] {
        if let Some(root) = std::env::var_os(variable).filter(|value| !value.is_empty()) {
            roots.push(std::path::PathBuf::from(root).join("Documents"));
        }
    }
    roots.sort();
    roots.dedup();
    roots
}

pub(super) fn scan_powershell_profile_directories(
    entries: &mut Vec<ProxyEnvEntry>,
    roots: impl IntoIterator<Item = std::path::PathBuf>,
    label: &str,
    guidance: &str,
) -> Result<(), String> {
    for root in roots {
        for file in [
            "profile.ps1",
            "Microsoft.PowerShell_profile.ps1",
            "Microsoft.VSCode_profile.ps1",
        ] {
            scan_text_proxy_file(entries, &root.join(file), label, guidance)?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn powershell_all_users_profile_roots() -> Result<Vec<std::path::PathBuf>, String> {
    let mut roots = Vec::new();
    if let Some(windows) = std::env::var_os("WINDIR").map(std::path::PathBuf::from) {
        for system in ["System32", "SysWOW64", "Sysnative"] {
            roots.push(windows.join(system).join("WindowsPowerShell").join("v1.0"));
        }
    }
    for variable in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        let Some(program_files) = std::env::var_os(variable).map(std::path::PathBuf::from) else {
            continue;
        };
        let parent = program_files.join("PowerShell");
        let versions = match std::fs::read_dir(&parent) {
            Ok(versions) => versions,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("Failed to inspect {}: {error}", parent.display())),
        };
        for (index, version) in versions.enumerate() {
            if index >= 32 {
                return Err(format!(
                    "PowerShell installation directory has too many entries: {}",
                    parent.display()
                ));
            }
            let version = version
                .map_err(|error| format!("Failed to inspect {}: {error}", parent.display()))?;
            if version
                .file_type()
                .map_err(|error| format!("Failed to inspect {}: {error}", version.path().display()))?
                .is_dir()
            {
                roots.push(version.path());
            }
        }
    }
    roots.sort();
    roots.dedup();
    Ok(roots)
}

fn scan_terminal_proxy_files(entries: &mut Vec<ProxyEnvEntry>) -> Result<(), String> {
    let home = std::env::var_os("USERPROFILE").map(std::path::PathBuf::from);
    if let Some(home) = home.as_deref() {
        let shell_guidance =
            "Remove only the proxy assignment shown from this profile; keep all unrelated profile content. Then restart the terminal and Claude supervisor.";
        for relative in [
            ".profile",
            ".bashrc",
            ".bash_profile",
            ".bash_login",
            ".zshenv",
            ".zshrc",
            ".zprofile",
            ".zlogin",
            ".config/fish/config.fish",
            ".config/fish/fish_variables",
        ] {
            scan_text_proxy_file(
                entries,
                &home.join(relative),
                "Shell/PowerShell profile",
                shell_guidance,
            )?;
        }
        scan_text_proxy_directory(
            entries,
            &home.join(".config/fish/conf.d"),
            "fish",
            "Shell/PowerShell profile",
            shell_guidance,
        )?;
        // OneDrive commonly redirects Documents, where PowerShell stores its
        // current-user profiles. Inspect both local and known OneDrive roots.
        for documents in powershell_profile_roots(home) {
            scan_powershell_profile_directories(
                entries,
                [documents.join("PowerShell"), documents.join("WindowsPowerShell")],
                "PowerShell profile",
                shell_guidance,
            )?;
        }
        for file in ["settings.json", "settings.local.json"] {
            scan_json_proxy_file(
                entries,
                &home.join(".claude").join(file),
                &["env"],
                "Claude settings",
                "Remove the proxy key from the env object in Claude settings, then fully restart Claude Code and its supervisor.",
            )?;
        }
    }

    if let Some(config_home) = std::env::var_os("XDG_CONFIG_HOME").filter(|value| !value.is_empty()) {
        let config_home = std::path::PathBuf::from(config_home);
        if !config_home.is_absolute() {
            return Err("XDG_CONFIG_HOME is relative and cannot be inspected safely".to_string());
        }
        let fish = config_home.join("fish");
        let guidance = "Remove only the proxy assignment shown from this profile; keep all unrelated profile content. Then restart the terminal and Claude supervisor.";
        scan_text_proxy_file(
            entries,
            &fish.join("config.fish"),
            "Shell/PowerShell profile",
            guidance,
        )?;
        scan_text_proxy_file(
            entries,
            &fish.join("fish_variables"),
            "Shell/PowerShell profile",
            guidance,
        )?;
        scan_text_proxy_directory(
            entries,
            &fish.join("conf.d"),
            "fish",
            "Shell/PowerShell profile",
            guidance,
        )?;
    }
    if let Some(zdotdir) = std::env::var_os("ZDOTDIR").filter(|value| !value.is_empty()) {
        let zdotdir = std::path::PathBuf::from(zdotdir);
        if !zdotdir.is_absolute() {
            return Err("ZDOTDIR is relative and cannot be inspected safely".to_string());
        }
        let guidance = "Remove only the proxy assignment shown from this profile; keep all unrelated profile content. Then restart the terminal and Claude supervisor.";
        for file in [".zshenv", ".zprofile", ".zshrc", ".zlogin"] {
            scan_text_proxy_file(
                entries,
                &zdotdir.join(file),
                "Shell/PowerShell profile",
                guidance,
            )?;
        }
    }

    #[cfg(windows)]
    {
        let mut managed_settings_roots = Vec::new();
        for variable in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
            if let Some(root) = std::env::var_os(variable).filter(|value| !value.is_empty()) {
                managed_settings_roots.push(std::path::PathBuf::from(root).join("ClaudeCode"));
            }
        }
        managed_settings_roots.sort();
        managed_settings_roots.dedup();
        let guidance = "Remove the proxy key from the administrator-managed Claude settings source, then fully restart Claude Code and its supervisor.";
        for root in managed_settings_roots {
            scan_json_proxy_file(
                entries,
                &root.join("managed-settings.json"),
                &["env"],
                "Claude managed settings",
                guidance,
            )?;
            scan_json_proxy_directory(
                entries,
                &root.join("managed-settings.d"),
                &["env"],
                "Claude managed settings",
                guidance,
            )?;
        }
    }

    #[cfg(windows)]
    scan_powershell_profile_directories(
        entries,
        powershell_all_users_profile_roots()?,
        "PowerShell all-users profile",
        "Remove only the proxy assignment shown from this administrator-managed profile; keep all unrelated content. Then restart PowerShell, VS Code, and the Claude supervisor.",
    )?;

    if let Some(appdata) = std::env::var_os("APPDATA").map(std::path::PathBuf::from) {
        for product in ["Code", "Code - Insiders"] {
            let user_dir = appdata.join(product).join("User");
            let guidance = "Remove the proxy key from terminal.integrated.env.windows, then fully restart VS Code and all integrated terminals.";
            scan_json_proxy_file(
                entries,
                &user_dir.join("settings.json"),
                &["terminal.integrated.env.windows"],
                "VS Code user settings",
                guidance,
            )?;
            for settings in vscode_profile_setting_paths(&user_dir)? {
                scan_json_proxy_file(
                    entries,
                    &settings,
                    &["terminal.integrated.env.windows"],
                    "VS Code profile settings",
                    guidance,
                )?;
            }
            let workspaces = vscode_workspace_discovery(&user_dir)?;
            for workspace in workspaces.settings {
                let is_code_workspace = workspace.extension().is_some_and(|extension| {
                    extension
                        .to_string_lossy()
                        .eq_ignore_ascii_case("code-workspace")
                });
                let path: &[&str] = if is_code_workspace {
                    &["settings", "terminal.integrated.env.windows"]
                } else {
                    &["terminal.integrated.env.windows"]
                };
                scan_json_proxy_file(
                    entries,
                    &workspace,
                    path,
                    "VS Code workspace settings",
                    guidance,
                )?;
            }
            for root in workspaces.roots {
                for file in ["settings.json", "settings.local.json"] {
                    scan_json_proxy_file(
                        entries,
                        &root.join(".claude").join(file),
                        &["env"],
                        "Claude project settings",
                        "Remove the proxy key from the project env object, then fully restart Claude Code and its supervisor.",
                    )?;
                }
            }
        }
    }

    #[cfg(windows)]
    scan_wsl_profiles(entries)?;
    Ok(())
}

#[tauri::command]
pub async fn tono_check_terminal_env() -> Result<TerminalEnvReport, String> {
    tokio::task::spawn_blocking(|| {
        let mut entries: Vec<ProxyEnvEntry> = Vec::new();

        #[cfg(windows)]
        {
            use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
            use winreg::RegKey;
            let registry_sources = [
                (
                    RegKey::predef(HKEY_CURRENT_USER),
                    "Environment",
                    "Windows user environment",
                    "Use the safe clear button below, then restart VS Code, every terminal, and the Claude supervisor.",
                    true,
                ),
                (
                    RegKey::predef(HKEY_LOCAL_MACHINE),
                    r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
                    "Windows machine environment (HKLM)",
                    "Remove this variable from an elevated System Properties or administrator shell. Tono will not silently modify HKLM. Then restart VS Code, every terminal, and the Claude supervisor.",
                    false,
                ),
            ];
            for (root, path, source, guidance, auto_clearable) in registry_sources {
                match root.open_subkey(path) {
                    Ok(env_key) => {
                        for key in &WINDOWS_TERMINAL_PROXY_KEYS {
                            match env_key.get_value::<String, _>(key) {
                                Ok(val) => {
                                    let trimmed = val.trim();
                                    if !trimmed.is_empty() {
                                        entries.push(ProxyEnvEntry {
                                            key: (*key).to_string(),
                                            value: CONFIGURED_PROXY_VALUE.to_string(),
                                            source: source.to_string(),
                                            guidance: guidance.to_string(),
                                            auto_clearable,
                                        });
                                    }
                                }
                                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                                Err(e) => {
                                    return Err(format!(
                                        "Failed to read registry env var {key}: {e}"
                                    ));
                                }
                            }
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => {
                        return Err(format!("Failed to open {source}: {e}"));
                    }
                }
            }

            for (root, source) in [
                (RegKey::predef(HKEY_CURRENT_USER), "Claude managed policy (HKCU)"),
                (RegKey::predef(HKEY_LOCAL_MACHINE), "Claude managed policy (HKLM)"),
            ] {
                match root.open_subkey(r"SOFTWARE\Policies\ClaudeCode") {
                    Ok(key) => match key.get_value::<String, _>("Settings") {
                        Ok(settings) => append_proxy_entries(
                            &mut entries,
                            proxy_assignments_in_json(&settings, &["env"])
                                .map_err(|error| format!("Invalid {source}: {error}"))?,
                            source.to_string(),
                            "Remove the proxy key from the administrator-managed Claude policy, then fully restart Claude Code and its supervisor.".to_string(),
                            false,
                        ),
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => return Err(format!("Failed to read {source}: {error}")),
                    },
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(format!("Failed to open {source}: {error}")),
                }
            }

            let command_processor = r"Software\Microsoft\Command Processor";
            for (root, source) in [
                (RegKey::predef(HKEY_CURRENT_USER), "CMD AutoRun (HKCU)"),
                (RegKey::predef(HKEY_LOCAL_MACHINE), "CMD AutoRun (HKLM)"),
            ] {
                match root.open_subkey(command_processor) {
                    Ok(key) => match key.get_value::<String, _>("AutoRun") {
                        Ok(value) => append_proxy_entries(
                            &mut entries,
                            proxy_assignments_in_text(&value),
                            source.to_string(),
                            "Edit the CMD AutoRun value and remove only the proxy SET command; preserve every unrelated command. Restart CMD, VS Code, and the Claude supervisor.".to_string(),
                            false,
                        ),
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => return Err(format!("Failed to read {source}: {error}")),
                    },
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(format!("Failed to open {source}: {error}")),
                }
            }
        }

        for (key, val) in std::env::vars().filter(|(key, _)| is_terminal_proxy_key(key)) {
            let trimmed = val.trim();
            if !trimmed.is_empty() {
                entries.push(ProxyEnvEntry {
                    key,
                    value: CONFIGURED_PROXY_VALUE.to_string(),
                    source: "Current Tono process environment".to_string(),
                    guidance: "Remove the variable from the parent source, including lowercase names, then fully restart Tono, VS Code, every terminal, and the Claude supervisor. Clearing only this child process would produce a false Ready result.".to_string(),
                    auto_clearable: false,
                });
            }
        }
        scan_terminal_proxy_files(&mut entries)?;

        let has_conflict = !entries.is_empty();
        let claude_code_ready = !has_conflict;
        let can_auto_clear = entries.iter().any(|entry| entry.auto_clearable);

        Ok(TerminalEnvReport {
            has_conflict,
            entries,
            claude_code_ready,
            can_auto_clear,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn tono_clear_terminal_proxy_env() -> Result<(), String> {
    tokio::task::spawn_blocking(|| {
        #[cfg(windows)]
        {
            use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
            use winreg::RegKey;
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            match hkcu.open_subkey_with_flags("Environment", KEY_SET_VALUE) {
                Ok(env_key) => {
                    for key in &WINDOWS_TERMINAL_PROXY_KEYS {
                        if let Err(e) = env_key.delete_value(key) {
                            if e.kind() != std::io::ErrorKind::NotFound {
                                return Err(format!("Failed to delete registry env var {key}: {e}"));
                            }
                        }
                    }
                }
                Err(e) => {
                    if e.kind() != std::io::ErrorKind::NotFound {
                        return Err(format!("Failed to open HKCU\\Environment: {e}"));
                    }
                }
            }

            // Verify keys were removed from registry
            match hkcu.open_subkey("Environment") {
                Ok(env_key) => {
                    let mut remaining = Vec::new();
                    for key in &WINDOWS_TERMINAL_PROXY_KEYS {
                        if let Ok(val) = env_key.get_value::<String, _>(key) {
                            if !val.trim().is_empty() {
                                remaining.push((*key).to_string());
                            }
                        }
                    }
                    if !remaining.is_empty() {
                        return Err(format!("Could not remove registry proxy variables: {}", remaining.join(", ")));
                    }
                }
                Err(e) => {
                    if e.kind() != std::io::ErrorKind::NotFound {
                        return Err(format!("Failed to verify HKCU\\Environment: {e}"));
                    }
                }
            }

            unsafe {
                use std::os::windows::ffi::OsStrExt;
                use windows::Win32::Foundation::{LPARAM, WPARAM};
                use windows::Win32::UI::WindowsAndMessaging::{
                    SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
                };
                let param: Vec<u16> = std::ffi::OsStr::new("Environment")
                    .encode_wide()
                    .chain(std::iter::once(0))
                    .collect();
                let mut result = 0usize;
                let _ = SendMessageTimeoutW(
                    HWND_BROADCAST,
                    WM_SETTINGCHANGE,
                    WPARAM(0),
                    LPARAM(param.as_ptr() as isize),
                    SMTO_ABORTIFHUNG,
                    1000,
                    Some(&mut result),
                );
            }
        }

        // Do not remove this process's inherited variables. That would make a
        // recheck look clean while already-running terminals and Claude still
        // retain the same parent environment. Restart guidance remains visible
        // until Tono itself is relaunched from a corrected parent source.
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn decode_windows_console_bytes(bytes: &[u8]) -> String {
    let bytes = if bytes.starts_with(&[0xFF, 0xFE]) {
        &bytes[2..]
    } else if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        bytes
    };
    if bytes.len() >= 2 && bytes.chunks_exact(2).any(|pair| pair[1] == 0) {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

#[cfg(test)]
mod decode_windows_console_bytes_tests {
    use super::decode_windows_console_bytes;

    #[test]
    fn strips_utf16_le_bom_from_wsl_list_output() {
        let mut bytes = vec![0xFF, 0xFE];
        for unit in "Ubuntu".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        assert_eq!(decode_windows_console_bytes(&bytes).trim(), "Ubuntu");
    }
}
