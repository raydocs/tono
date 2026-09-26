//! Identify reviewed desktop apps by Authenticode publisher, not only by
//! process name.
//!
//! WeChat DIRECT punches a physical-interface hole bounded by WFP IP:port.
//! A renamed helper inside an official install must still match, but a
//! Tencent-signed QQ tree — or a user-writable folder that merely claims
//! the WeChat name — must not. Discovery therefore requires:
//!
//! 1. WinVerifyTrust success (the signature is trusted).
//! 2. The signer CN or organization matches a reviewed Tencent publisher key.
//! 3. The witness file is a reviewed product binary (`WeChat.exe`,
//!    `Weixin.exe`, `xwechat.exe`).
//! 4. A *directory* grant is emitted only for official install layouts
//!    (`…\Tencent\WeChat`, `%LOCALAPPDATA%\Programs\wechatapp`, …). A folder
//!    that is merely named WeChat — including `C:\Users\me\WeChat` and
//!    `C:\Users\me\evil\Tencent\WeChat` — gets one exact PROCESS-PATH.
//! 5. The directory grant also needs the install directory and its ancestors
//!    to be writable only by Administrators, SYSTEM and TrustedInstaller.
//!    Per-user and default non-system-drive installs, or any DACL read error,
//!    get one exact PROCESS-PATH instead.
//!
//! A portable `D:\Apps\WeChat.exe` becomes one exact PROCESS-PATH. Failure
//! to discover anything keeps the existing PROCESS-NAME list.

#[cfg(windows)]
use std::collections::BTreeSet;
#[cfg(windows)]
use std::path::{Path, PathBuf};

use tono_core::config::{
    wechat_file_path_regex, wechat_prefix_path_regex, windows_path_regex, WindowsPathRegexKind,
};
#[cfg(windows)]
use tono_core::config::MAX_WECHAT_PROCESS_PATH_REGEXES;

/// Product witnesses. Helpers (WeChatAppEx, …) are covered by the prefix
/// of a verified witness, not used as tree roots themselves.
const WECHAT_WITNESS_FILES: [&str; 3] = ["WeChat.exe", "Weixin.exe", "xwechat.exe"];

/// Product witnesses. Helpers are covered by the prefix of a verified witness
/// and are never used as tree roots themselves.
const DINGTALK_WITNESS_FILES: [&str; 4] = [
    "DingTalk.exe",
    "dingtalk.exe",
    "DingTalkHelper.exe",
    "DingTalkLauncher.exe",
];
const FEISHU_WITNESS_FILES: [&str; 4] = [
    "Feishu.exe",
    "feishu.exe",
    "Lark.exe",
    "lark.exe",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReviewedDirectProduct {
    WeChat,
    DingTalk,
    Feishu,
}

/// Directory tails of official installers. A user-writable folder that is
/// merely *named* WeChat is not one of these.
const OFFICIAL_WECHAT_LAYOUT_TAILS: [&str; 8] = [
    r"\tencent\wechat",
    r"\tencent\weixin",
    r"\tencent\xwechat",
    r"\tencent\weixinapp",
    r"\programs\wechatapp",
    r"\programs\wechat",
    r"\programs\weixin",
    r"\programs\xwechat",
];

/// Alphanumeric-folded signer subjects read from known-good Tencent WeChat
/// builds. Spacing and punctuation differences collapse to the same key.
const REVIEWED_WECHAT_PUBLISHER_KEYS: [&str; 2] = [
    "tencenttechnologyshenzhencompanylimited",
    "shenzhentencentcomputersystemscompanylimited",
];

/// Folders that hold the product, not the user's chat history.
const REVIEWED_WECHAT_FOLDER_MARKERS: [&str; 4] = ["wechat", "weixin", "xwechat", "微信"];

const OFFICIAL_DINGTALK_LAYOUT_TAILS: [&str; 7] = [
    r"\alibaba\dingtalk",
    r"\alibaba\dingding",
    r"\programs\dingtalk",
    r"\programs\dingding",
    r"\dingtalk",
    r"\dingding",
    r"\钉钉",
];
const OFFICIAL_FEISHU_LAYOUT_TAILS: [&str; 8] = [
    r"\bytedance\feishu",
    r"\bytedance\lark",
    r"\programs\feishu",
    r"\programs\lark",
    r"\feishu",
    r"\lark",
    r"\飞书",
    r"\larksuite",
];

/// Alphanumeric-folded signer subjects from reviewed product installers.
/// Keep these vendor-specific; the witness filename alone is not an identity.
const REVIEWED_DINGTALK_PUBLISHER_KEYS: [&str; 6] = [
    "dingtalkchinainformationtechnologycoltd",
    "dingtalkchinainformationtechnologycolimited",
    "alibabachinatechnologycoltd",
    "alibabachinatechnologycolimited",
    "alibabachinatechnologycompanylimited",
    "alibabacomgroup",
];
const REVIEWED_FEISHU_PUBLISHER_KEYS: [&str; 8] = [
    "beijingbytedancetechnologycoltd",
    "beijingbytedancetechnologycolimited",
    "beijingfeishutechnologycoltd",
    "beijingfeishutechnologycolimited",
    "beijingfeishuinformationtechnologycoltd",
    "beijingfeishuinformationtechnologycolimited",
    "larktechnologiespteltd",
    "bytedancepteltd",
];

/// Discover signed WeChat install trees and return PROCESS-PATH-REGEX
/// payloads ready for [`tono_core::config::DirectPlan`]. Empty on
/// non-Windows and whenever nothing can be proven.
pub fn discover_signed_wechat_path_regexes() -> Vec<String> {
    #[cfg(windows)]
    {
        discover_signed_wechat_path_regexes_windows()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// Discover signed install trees for WeChat, DingTalk and Feishu/Lark. The
/// resulting patterns feed the same DirectPlan and WFP reviewed-port permit
/// as WeChat, so office-app raw-IP/HTTPDNS traffic gets the same bounded
/// treatment. Empty on non-Windows or when no product identity is proven.
pub fn discover_signed_reviewed_direct_path_regexes() -> Vec<String> {
    #[cfg(windows)]
    {
        discover_signed_reviewed_direct_path_regexes_windows()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// Collapse a signer subject to the compared publisher key.
pub fn publisher_identity_key(subject: &str) -> String {
    subject
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|character| character.to_ascii_lowercase())
        .collect()
}

pub fn is_reviewed_wechat_publisher(subject: &str) -> bool {
    let key = publisher_identity_key(subject);
    REVIEWED_WECHAT_PUBLISHER_KEYS
        .iter()
        .any(|reviewed| *reviewed == key)
}

pub fn is_wechat_data_folder(name: &str) -> bool {
    let lowered = name.to_lowercase();
    lowered.contains("files")
        || lowered.contains("文档")
        || lowered.contains("_files")
        || lowered.contains("wechat files")
}

pub fn is_reviewed_wechat_folder_name(name: &str) -> bool {
    if name.is_empty() || is_wechat_data_folder(name) || is_rejected_tencent_product(name) {
        return false;
    }
    let lowered = name.to_lowercase();
    REVIEWED_WECHAT_FOLDER_MARKERS
        .iter()
        .any(|marker| lowered.contains(marker))
}

pub fn is_accepted_wechat_display_name(name: &str) -> bool {
    if name.is_empty() || is_rejected_tencent_product(name) {
        return false;
    }
    let lowered = name.to_lowercase();
    lowered.contains("wechat")
        || lowered.contains("weixin")
        || (name.contains('微') && name.contains('信'))
}

pub fn is_rejected_tencent_product(name: &str) -> bool {
    let lowered = name.to_lowercase();
    lowered.contains("wechat work")
        || lowered.contains("wechatwork")
        || lowered.contains("wecom")
        || lowered.contains("wxwork")
        || lowered.contains("企业微信")
        || lowered.contains("work weixin")
        || lowered.contains("会议")
        || lowered.contains("电脑管家")
        || has_product_word(&lowered, "qq")
        || has_product_word(&lowered, "tim")
        || has_product_word(&lowered, "meeting")
}

fn has_product_word(name: &str, word: &str) -> bool {
    name.split(|character: char| !character.is_alphanumeric())
        .any(|token| token == word)
}

/// Strip `\\?\` and normalize slashes so canonicalize output can be compared.
pub fn normalize_windows_display_path(path: &str) -> String {
    let trimmed = path.trim().trim_matches('"');
    let stripped = trimmed
        .strip_prefix(r"\\?\")
        .or_else(|| trimmed.strip_prefix(r"//?/"))
        .unwrap_or(trimmed);
    stripped.replace('/', "\\")
}

/// Uninstall `DisplayIcon` / `InstallLocation` values are often quoted and
/// sometimes carry a `,<icon-index>` suffix.
pub fn sanitize_windows_registry_path(raw: &str) -> Option<String> {
    let mut value = raw.trim().trim_matches('"').trim().to_string();
    if value.is_empty() {
        return None;
    }
    if let Some((path, suffix)) = value.rsplit_once(',') {
        let suffix = suffix.trim();
        if !suffix.is_empty()
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_digit() || byte == b'-')
        {
            value = path.trim().trim_matches('"').trim().to_string();
        }
    }
    if value.is_empty() {
        None
    } else {
        Some(normalize_windows_display_path(&value))
    }
}

fn parent_directory(path: &str) -> Option<&str> {
    path.rsplit_once('\\').map(|(parent, _)| parent)
}

fn file_name(path: &str) -> &str {
    path.rsplit('\\').next().unwrap_or(path)
}

pub fn is_wechat_witness_file_name(name: &str) -> bool {
    WECHAT_WITNESS_FILES
        .iter()
        .any(|witness| witness.eq_ignore_ascii_case(name))
}

/// Official installer layout, not a folder that happens to be named WeChat.
pub fn has_official_wechat_layout_tail(directory: &str) -> bool {
    let normalized = normalize_windows_display_path(directory)
        .trim_end_matches('\\')
        .to_ascii_lowercase();
    if normalized.contains(r"\windowsapps\") {
        return is_reviewed_wechat_folder_name(file_name(&normalized));
    }
    OFFICIAL_WECHAT_LAYOUT_TAILS
        .iter()
        .any(|tail| normalized.ends_with(tail))
}

/// User-profile trees outside the official AppData install locations.
pub fn is_untrusted_user_profile_wechat_tree(directory: &str) -> bool {
    let normalized = normalize_windows_display_path(directory)
        .trim_end_matches('\\')
        .to_ascii_lowercase();
    let Some(after_users) = normalized.split_once(r"\users\").map(|(_, rest)| rest) else {
        return false;
    };
    let after_name = after_users.split_once('\\').map(|(_, rest)| rest).unwrap_or("");
    let official_appdata = after_name.starts_with(r"appdata\local\tencent\")
        || after_name.starts_with(r"appdata\roaming\tencent\")
        || after_name.starts_with(r"appdata\local\programs\wechat")
        || after_name.starts_with(r"appdata\local\programs\weixin")
        || after_name.starts_with(r"appdata\local\programs\xwechat")
        || after_name.starts_with(r"appdata\local\programs\tencent\");
    !official_appdata
}

pub fn allows_wechat_directory_prefix(exe_path: &str) -> bool {
    let Some(parent) = parent_directory(exe_path) else {
        return false;
    };
    let folder = file_name(parent);
    if is_wechat_data_folder(folder) || is_rejected_tencent_product(folder) {
        return false;
    }
    has_official_wechat_layout_tail(parent) && !is_untrusted_user_profile_wechat_tree(parent)
}

/// Choose the PROCESS-PATH-REGEX for one verified witness path.
pub fn regex_for_verified_wechat_exe(path: &str) -> Option<String> {
    let normalized = normalize_windows_display_path(path);
    if normalized.is_empty() {
        return None;
    }
    if !is_wechat_witness_file_name(file_name(&normalized)) {
        return None;
    }
    let parent = parent_directory(&normalized)?;
    let folder = file_name(parent);
    if is_wechat_data_folder(folder) || is_rejected_tencent_product(folder) {
        return None;
    }
    if allows_wechat_directory_prefix(&normalized) {
        let mut prefix = parent.to_string();
        prefix.push('\\');
        wechat_prefix_path_regex(&prefix)
    } else {
        wechat_file_path_regex(&normalized)
    }
}

fn reviewed_product_for_witness_file_name(name: &str) -> Option<ReviewedDirectProduct> {
    if WECHAT_WITNESS_FILES
        .iter()
        .any(|witness| witness.eq_ignore_ascii_case(name))
    {
        return Some(ReviewedDirectProduct::WeChat);
    }
    if DINGTALK_WITNESS_FILES
        .iter()
        .any(|witness| witness.eq_ignore_ascii_case(name))
    {
        return Some(ReviewedDirectProduct::DingTalk);
    }
    if FEISHU_WITNESS_FILES
        .iter()
        .any(|witness| witness.eq_ignore_ascii_case(name))
    {
        return Some(ReviewedDirectProduct::Feishu);
    }
    None
}

pub fn is_dingtalk_witness_file_name(name: &str) -> bool {
    matches!(
        reviewed_product_for_witness_file_name(name),
        Some(ReviewedDirectProduct::DingTalk)
    )
}

pub fn is_feishu_witness_file_name(name: &str) -> bool {
    matches!(
        reviewed_product_for_witness_file_name(name),
        Some(ReviewedDirectProduct::Feishu)
    )
}

fn is_reviewed_direct_publisher(subject: &str, product: ReviewedDirectProduct) -> bool {
    let key = publisher_identity_key(subject);
    let keys: &[&str] = match product {
        ReviewedDirectProduct::WeChat => &REVIEWED_WECHAT_PUBLISHER_KEYS,
        ReviewedDirectProduct::DingTalk => &REVIEWED_DINGTALK_PUBLISHER_KEYS,
        ReviewedDirectProduct::Feishu => &REVIEWED_FEISHU_PUBLISHER_KEYS,
    };
    keys.iter().any(|reviewed| *reviewed == key)
}

pub fn is_reviewed_dingtalk_publisher(subject: &str) -> bool {
    is_reviewed_direct_publisher(subject, ReviewedDirectProduct::DingTalk)
}

pub fn is_reviewed_feishu_publisher(subject: &str) -> bool {
    is_reviewed_direct_publisher(subject, ReviewedDirectProduct::Feishu)
}

fn is_reviewed_direct_data_folder(name: &str) -> bool {
    let lowered = name.to_lowercase();
    lowered.contains("files")
        || lowered.contains("_files")
        || lowered.contains("文档")
        || lowered.contains("缓存")
        || lowered.contains("cache")
}

fn reviewed_direct_layout_tails(product: ReviewedDirectProduct) -> &'static [&'static str] {
    match product {
        ReviewedDirectProduct::WeChat => &OFFICIAL_WECHAT_LAYOUT_TAILS,
        ReviewedDirectProduct::DingTalk => &OFFICIAL_DINGTALK_LAYOUT_TAILS,
        ReviewedDirectProduct::Feishu => &OFFICIAL_FEISHU_LAYOUT_TAILS,
    }
}

fn reviewed_direct_folder_marker(product: ReviewedDirectProduct, name: &str) -> bool {
    let lowered = name.to_lowercase();
    match product {
        ReviewedDirectProduct::WeChat => is_reviewed_wechat_folder_name(name),
        ReviewedDirectProduct::DingTalk => {
            ["dingtalk", "dingding", "钉钉"]
                .iter()
                .any(|marker| lowered.contains(marker))
        }
        ReviewedDirectProduct::Feishu => {
            ["feishu", "lark", "飞书"]
                .iter()
                .any(|marker| lowered.contains(marker))
        }
    }
}

pub fn has_official_reviewed_direct_layout_tail(
    product_name: &str,
    directory: &str,
) -> bool {
    let product = match product_name.to_ascii_lowercase().as_str() {
        "wechat" | "weixin" => ReviewedDirectProduct::WeChat,
        "dingtalk" | "dingding" => ReviewedDirectProduct::DingTalk,
        "feishu" | "lark" => ReviewedDirectProduct::Feishu,
        _ => return false,
    };
    has_official_reviewed_layout(product, directory)
}

fn has_official_reviewed_layout(product: ReviewedDirectProduct, directory: &str) -> bool {
    let normalized = normalize_windows_display_path(directory)
        .trim_end_matches('\\')
        .to_ascii_lowercase();
    if normalized.contains(r"\windowsapps\") {
        return reviewed_direct_folder_marker(product, file_name(&normalized));
    }
    reviewed_direct_layout_tails(product)
        .iter()
        .any(|tail| normalized.ends_with(tail))
}

fn is_untrusted_user_profile_reviewed_tree(
    product: ReviewedDirectProduct,
    directory: &str,
) -> bool {
    let normalized = normalize_windows_display_path(directory)
        .trim_end_matches('\\')
        .to_ascii_lowercase();
    let Some(after_users) = normalized.split_once(r"\users\").map(|(_, rest)| rest) else {
        return false;
    };
    let after_name = after_users
        .split_once('\\')
        .map(|(_, rest)| rest)
        .unwrap_or("");
    let official_appdata = match product {
        ReviewedDirectProduct::WeChat => {
            after_name.starts_with(r"appdata\local\tencent\")
                || after_name.starts_with(r"appdata\roaming\tencent\")
                || after_name.starts_with(r"appdata\local\programs\wechat")
                || after_name.starts_with(r"appdata\local\programs\weixin")
                || after_name.starts_with(r"appdata\local\programs\xwechat")
                || after_name.starts_with(r"appdata\local\programs\tencent\")
        }
        ReviewedDirectProduct::DingTalk => {
            after_name.starts_with(r"appdata\local\alibaba\")
                || after_name.starts_with(r"appdata\roaming\alibaba\")
                || after_name.starts_with(r"appdata\local\programs\dingtalk")
                || after_name.starts_with(r"appdata\local\programs\dingding")
                || after_name.starts_with(r"appdata\roaming\programs\dingtalk")
                || after_name.starts_with(r"appdata\roaming\programs\dingding")
                || after_name.starts_with(r"appdata\local\dingtalk")
                || after_name.starts_with(r"appdata\local\dingding")
                || after_name.starts_with(r"appdata\roaming\dingtalk")
                || after_name.starts_with(r"appdata\roaming\dingding")
        }
        ReviewedDirectProduct::Feishu => {
            after_name.starts_with(r"appdata\local\bytedance\")
                || after_name.starts_with(r"appdata\roaming\bytedance\")
                || after_name.starts_with(r"appdata\local\programs\feishu")
                || after_name.starts_with(r"appdata\local\programs\lark")
                || after_name.starts_with(r"appdata\roaming\programs\feishu")
                || after_name.starts_with(r"appdata\roaming\programs\lark")
                || after_name.starts_with(r"appdata\local\feishu")
                || after_name.starts_with(r"appdata\local\lark")
                || after_name.starts_with(r"appdata\roaming\feishu")
                || after_name.starts_with(r"appdata\roaming\lark")
        }
    };
    !official_appdata
}

fn allows_reviewed_direct_directory_prefix(
    product: ReviewedDirectProduct,
    exe_path: &str,
) -> bool {
    let Some(parent) = parent_directory(exe_path) else {
        return false;
    };
    let folder = file_name(parent);
    if is_reviewed_direct_data_folder(folder) {
        return false;
    }
    has_official_reviewed_layout(product, parent)
        && !is_untrusted_user_profile_reviewed_tree(product, parent)
}

fn regex_for_verified_reviewed_direct_exe(
    path: &str,
    product: ReviewedDirectProduct,
) -> Option<String> {
    if product == ReviewedDirectProduct::WeChat {
        return regex_for_verified_wechat_exe(path);
    }
    let normalized = normalize_windows_display_path(path);
    if normalized.is_empty()
        || reviewed_product_for_witness_file_name(file_name(&normalized)) != Some(product)
    {
        return None;
    }
    let parent = parent_directory(&normalized)?;
    if is_reviewed_direct_data_folder(file_name(parent)) {
        return None;
    }
    if allows_reviewed_direct_directory_prefix(product, &normalized) {
        let mut prefix = parent.to_string();
        prefix.push('\\');
        windows_path_regex(&prefix, WindowsPathRegexKind::AnchoredPrefix)
    } else {
        windows_path_regex(&normalized, WindowsPathRegexKind::ExactFile)
    }
}

pub fn regex_for_verified_dingtalk_exe(path: &str) -> Option<String> {
    regex_for_verified_reviewed_direct_exe(path, ReviewedDirectProduct::DingTalk)
}

pub fn regex_for_verified_feishu_exe(path: &str) -> Option<String> {
    regex_for_verified_reviewed_direct_exe(path, ReviewedDirectProduct::Feishu)
}

/// The only principals that may add, replace or re-permission anything in a
/// prefix-granted install tree: Administrators, SYSTEM, TrustedInstaller.
const ADMIN_ONLY_WRITER_SIDS: [&str; 3] = [
    "S-1-5-32-544",
    "S-1-5-18",
    "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464",
];

/// CREATOR OWNER only appears on inheritable ACEs and becomes the SID of
/// whoever creates the child. Creating requires a write-class right on the
/// parent, which this check restricts to [`ADMIN_ONLY_WRITER_SIDS`].
const CREATOR_OWNER_SID: &str = "S-1-3-0";

/// FILE_WRITE_DATA/ADD_FILE, FILE_APPEND_DATA/ADD_SUBDIRECTORY, FILE_WRITE_EA,
/// FILE_DELETE_CHILD, FILE_WRITE_ATTRIBUTES, DELETE, WRITE_DAC, WRITE_OWNER,
/// GENERIC_ALL and GENERIC_WRITE.
const DIRECTORY_WRITE_CLASS_RIGHTS: u32 = 0x0000_0002
    | 0x0000_0004
    | 0x0000_0010
    | 0x0000_0040
    | 0x0000_0100
    | 0x0001_0000
    | 0x0004_0000
    | 0x0008_0000
    | 0x1000_0000
    | 0x4000_0000;

/// Owner and access-allowed ACEs of one directory, as string SIDs.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Clone, Debug, PartialEq, Eq)]
struct DirectorySecurity {
    owner_sid: String,
    /// Every access-allowed ACE with its mask, inherit-only ones included:
    /// they decide what the children, which the prefix also covers, grant.
    allowed_aces: Vec<(String, u32)>,
}

#[cfg_attr(not(windows), allow(dead_code))]
impl DirectorySecurity {
    fn is_admin_only_writable(&self) -> bool {
        is_admin_only_writer(&self.owner_sid)
            && self.allowed_aces.iter().all(|(sid, mask)| {
                mask & DIRECTORY_WRITE_CLASS_RIGHTS == 0
                    || is_admin_only_writer(sid)
                    || sid.as_str() == CREATOR_OWNER_SID
            })
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
fn is_admin_only_writer(sid: &str) -> bool {
    ADMIN_ONLY_WRITER_SIDS
        .iter()
        .any(|writer| writer.eq_ignore_ascii_case(sid))
}

/// Reads a directory's security descriptor. A trait so the admin-only decision
/// can be tested with fake ACLs. An `Err` never counts as admin-only.
#[cfg_attr(not(windows), allow(dead_code))]
trait DirectorySecuritySource {
    fn read_directory_security(&self, directory: &str) -> Result<DirectorySecurity, String>;
}

/// `X:\Program Files` and `X:\Program Files (x86)`: the walk stops here after
/// checking it, because the drive root above lets Authenticated Users create
/// folders by default.
#[cfg_attr(not(windows), allow(dead_code))]
fn is_known_system_root(directory: &str) -> bool {
    let Some((drive, rest)) = directory.split_once('\\') else {
        return false;
    };
    drive.len() == 2
        && (rest.eq_ignore_ascii_case("Program Files")
            || rest.eq_ignore_ascii_case("Program Files (x86)"))
}

/// True only when `directory` and each ancestor up to a known system root (or
/// the drive root) are owned by, and grant write-class rights only to,
/// Administrators, SYSTEM and TrustedInstaller. A path that is not a plain
/// drive path, or any error reading a DACL, answers false.
#[cfg_attr(not(windows), allow(dead_code))]
fn is_admin_only_install_chain(directory: &str, source: &impl DirectorySecuritySource) -> bool {
    let normalized = normalize_windows_display_path(directory);
    let mut current = normalized.trim_end_matches('\\');
    let drive_path = matches!(
        current.as_bytes(),
        [drive, b':'] | [drive, b':', b'\\', ..] if drive.is_ascii_alphabetic()
    );
    if !drive_path
        || current
            .split('\\')
            .skip(1)
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return false;
    }
    loop {
        let drive_root = current.len() == 2;
        let query = if drive_root {
            format!("{current}\\")
        } else {
            current.to_string()
        };
        match source.read_directory_security(&query) {
            Ok(security) if security.is_admin_only_writable() => {}
            _ => return false,
        }
        if drive_root || is_known_system_root(current) {
            return true;
        }
        let Some(parent) = parent_directory(current) else {
            return false;
        };
        current = parent;
    }
}

/// [`regex_for_verified_reviewed_direct_exe`] behind a directory-security gate.
/// The layout decides whether a prefix is possible; the prefix survives only
/// when the install tree is admin-only writable. Otherwise, including any DACL
/// read error, the verified file gets its exact regex.
#[cfg_attr(not(windows), allow(dead_code))]
fn regex_for_verified_exe_on_admin_only_tree(
    path: &str,
    product: ReviewedDirectProduct,
    security: &impl DirectorySecuritySource,
) -> Option<String> {
    let layout_regex = regex_for_verified_reviewed_direct_exe(path, product)?;
    let normalized = normalize_windows_display_path(path);
    let layout_prefix = if product == ReviewedDirectProduct::WeChat {
        allows_wechat_directory_prefix(&normalized)
    } else {
        allows_reviewed_direct_directory_prefix(product, &normalized)
    };
    if !layout_prefix {
        return Some(layout_regex);
    }
    let parent = parent_directory(&normalized)?;
    if is_admin_only_install_chain(parent, security) {
        return Some(layout_regex);
    }
    if product == ReviewedDirectProduct::WeChat {
        wechat_file_path_regex(&normalized)
    } else {
        windows_path_regex(&normalized, WindowsPathRegexKind::ExactFile)
    }
}

/// Reads the owner and DACL with `GetNamedSecurityInfoW`. A NULL DACL, an
/// unreadable ACE, or an ACE type other than (callback) allow/deny is an error.
#[cfg(windows)]
struct WindowsDirectorySecurity;

#[cfg(windows)]
impl DirectorySecuritySource for WindowsDirectorySecurity {
    fn read_directory_security(&self, directory: &str) -> Result<DirectorySecurity, String> {
        windows_directory_security::read(directory)
    }
}

#[cfg(windows)]
mod windows_directory_security {
    use super::DirectorySecurity;
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt as _;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{
        ConvertSidToStringSidW, GetNamedSecurityInfoW, SE_FILE_OBJECT,
    };
    use windows_sys::Win32::Security::{
        ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, DACL_SECURITY_INFORMATION, GetAce, IsValidSid,
        OWNER_SECURITY_INFORMATION, PSID,
    };

    const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
    const ACCESS_DENIED_ACE_TYPE: u8 = 1;
    const ACCESS_ALLOWED_CALLBACK_ACE_TYPE: u8 = 9;
    const ACCESS_DENIED_CALLBACK_ACE_TYPE: u8 = 10;

    struct LocalAllocation(*mut c_void);

    impl Drop for LocalAllocation {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { LocalFree(self.0) };
            }
        }
    }

    pub(super) fn read(directory: &str) -> Result<DirectorySecurity, String> {
        let wide: Vec<u16> = std::ffi::OsStr::new(directory)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut owner: PSID = std::ptr::null_mut();
        let mut dacl: *mut ACL = std::ptr::null_mut();
        let mut descriptor = std::ptr::null_mut();
        let status = unsafe {
            GetNamedSecurityInfoW(
                wide.as_ptr(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
                &mut owner,
                std::ptr::null_mut(),
                &mut dacl,
                std::ptr::null_mut(),
                &mut descriptor,
            )
        };
        if status != 0 || descriptor.is_null() {
            return Err(format!("GetNamedSecurityInfoW failed: Windows error {status}"));
        }
        let _descriptor = LocalAllocation(descriptor);
        if owner.is_null() {
            return Err("directory has no owner".to_string());
        }
        if dacl.is_null() {
            return Err("directory has a NULL DACL".to_string());
        }
        let owner_sid = sid_string(owner)?;
        let ace_count = u32::from(unsafe { (*dacl).AceCount });
        let mut allowed_aces = Vec::new();
        for index in 0..ace_count {
            let mut ace: *mut c_void = std::ptr::null_mut();
            if unsafe { GetAce(dacl, index, &mut ace) } == 0 || ace.is_null() {
                return Err(format!("ACE {index} could not be read"));
            }
            let header = unsafe { &*ace.cast::<ACE_HEADER>() };
            match header.AceType {
                ACCESS_DENIED_ACE_TYPE | ACCESS_DENIED_CALLBACK_ACE_TYPE => {}
                ACCESS_ALLOWED_ACE_TYPE | ACCESS_ALLOWED_CALLBACK_ACE_TYPE => {
                    let allowed = unsafe { &*ace.cast::<ACCESS_ALLOWED_ACE>() };
                    let sid = std::ptr::addr_of!(allowed.SidStart)
                        .cast_mut()
                        .cast::<c_void>();
                    if unsafe { IsValidSid(sid) } == 0 {
                        return Err(format!("ACE {index} has an invalid SID"));
                    }
                    allowed_aces.push((sid_string(sid)?, allowed.Mask));
                }
                other => return Err(format!("ACE {index} has unsupported type {other}")),
            }
        }
        Ok(DirectorySecurity {
            owner_sid,
            allowed_aces,
        })
    }

    fn sid_string(sid: PSID) -> Result<String, String> {
        let mut value: *mut u16 = std::ptr::null_mut();
        if unsafe { ConvertSidToStringSidW(sid, &mut value) } == 0 || value.is_null() {
            return Err("ConvertSidToStringSidW failed".to_string());
        }
        let _value = LocalAllocation(value.cast());
        let length = (0..)
            .take_while(|index| unsafe { *value.add(*index) } != 0)
            .count();
        String::from_utf16(unsafe { std::slice::from_raw_parts(value, length) })
            .map_err(|_| "SID is not valid UTF-16".to_string())
    }
}

#[cfg(windows)]
#[derive(Clone, Debug, PartialEq, Eq)]
struct WitnessFingerprint {
    path: String,
    len: u64,
    modified: Option<std::time::SystemTime>,
}

#[cfg(windows)]
struct DiscoverySnapshot {
    fingerprints: Vec<WitnessFingerprint>,
    regexes: Vec<String>,
}

#[cfg(windows)]
static LAST_DISCOVERY: std::sync::Mutex<Option<DiscoverySnapshot>> = std::sync::Mutex::new(None);

#[cfg(windows)]
fn fingerprint_existing(paths: &[PathBuf]) -> Vec<WitnessFingerprint> {
    let mut fingerprints = Vec::new();
    for path in paths {
        let Ok(metadata) = path.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        fingerprints.push(WitnessFingerprint {
            path: path.to_string_lossy().into_owned(),
            len: metadata.len(),
            modified: metadata.modified().ok(),
        });
    }
    fingerprints.sort_by(|left, right| left.path.cmp(&right.path));
    fingerprints
}

#[cfg(windows)]
fn discover_signed_wechat_path_regexes_windows() -> Vec<String> {
    let candidates = wechat_witness_candidates();
    let fingerprints = fingerprint_existing(&candidates);
    if let Ok(cache) = LAST_DISCOVERY.lock()
        && let Some(previous) = cache.as_ref()
        && previous.fingerprints == fingerprints
    {
        return previous.regexes.clone();
    }
    let mut regexes = BTreeSet::new();
    for candidate in candidates {
        if regexes.len() >= MAX_WECHAT_PROCESS_PATH_REGEXES {
            break;
        }
        let Ok(canonical) = dunce::canonicalize(&candidate) else {
            continue;
        };
        if !canonical.is_file() {
            continue;
        }
        if !is_signed_wechat_witness(&canonical) {
            continue;
        }
        let Some(display) = canonical.to_str() else {
            continue;
        };
        if let Some(regex) = regex_for_verified_exe_on_admin_only_tree(
            &normalize_windows_display_path(display),
            ReviewedDirectProduct::WeChat,
            &WindowsDirectorySecurity,
        ) {
            regexes.insert(regex);
        }
    }
    let regexes: Vec<String> = regexes.into_iter().take(MAX_WECHAT_PROCESS_PATH_REGEXES).collect();
    if let Ok(mut cache) = LAST_DISCOVERY.lock() {
        *cache = Some(DiscoverySnapshot {
            fingerprints,
            regexes: regexes.clone(),
        });
    }
    regexes
}

#[cfg(windows)]
static LAST_REVIEWED_DIRECT_DISCOVERY: std::sync::Mutex<Option<DiscoverySnapshot>> =
    std::sync::Mutex::new(None);

#[cfg(windows)]
fn discover_signed_reviewed_direct_path_regexes_windows() -> Vec<String> {
    let candidates = reviewed_direct_witness_candidates();
    let fingerprints = fingerprint_existing(&candidates);
    if let Ok(cache) = LAST_REVIEWED_DIRECT_DISCOVERY.lock()
        && let Some(previous) = cache.as_ref()
        && previous.fingerprints == fingerprints
    {
        return previous.regexes.clone();
    }
    let mut regexes = BTreeSet::new();
    for candidate in candidates {
        if regexes.len() >= MAX_WECHAT_PROCESS_PATH_REGEXES {
            break;
        }
        let Some(product) = reviewed_product_for_witness_file_name(
            candidate.file_name().and_then(|name| name.to_str()).unwrap_or_default(),
        ) else {
            continue;
        };
        let Ok(canonical) = dunce::canonicalize(&candidate) else {
            continue;
        };
        if !canonical.is_file() || !is_signed_reviewed_direct_witness(&canonical, product) {
            continue;
        }
        let Some(display) = canonical.to_str() else {
            continue;
        };
        if let Some(regex) =
            regex_for_verified_exe_on_admin_only_tree(display, product, &WindowsDirectorySecurity)
        {
            regexes.insert(regex);
        }
    }
    let regexes: Vec<String> = regexes
        .into_iter()
        .take(MAX_WECHAT_PROCESS_PATH_REGEXES)
        .collect();
    if let Ok(mut cache) = LAST_REVIEWED_DIRECT_DISCOVERY.lock() {
        *cache = Some(DiscoverySnapshot {
            fingerprints,
            regexes: regexes.clone(),
        });
    }
    regexes
}

#[cfg(windows)]
fn is_signed_reviewed_direct_witness(path: &Path, product: ReviewedDirectProduct) -> bool {
    authenticode_subjects(path)
        .iter()
        .any(|subject| is_reviewed_direct_publisher(subject, product))
}

#[cfg(windows)]
fn reviewed_direct_witness_candidates() -> Vec<PathBuf> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    let mut push = |path: PathBuf| {
        if seen.insert(path.clone()) {
            out.push(path);
        }
    };
    let witness_files = WECHAT_WITNESS_FILES
        .iter()
        .chain(DINGTALK_WITNESS_FILES.iter())
        .chain(FEISHU_WITNESS_FILES.iter());
    for root in known_reviewed_direct_roots()
        .into_iter()
        .chain(registry_reviewed_direct_install_locations())
    {
        for name in witness_files.clone() {
            push(root.join(name));
        }
    }
    out
}

#[cfg(windows)]
fn known_reviewed_direct_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut push_env = |key: &str, tails: &[&str]| {
        let Ok(base) = std::env::var(key) else {
            return;
        };
        if base.trim().is_empty() {
            return;
        }
        for tail in tails {
            roots.push(PathBuf::from(&base).join(tail));
        }
    };
    let tails = [
        r"Tencent\WeChat",
        r"Tencent\Weixin",
        r"Tencent\xwechat",
        r"Tencent\WeixinApp",
        r"Programs\Tencent\WeChat",
        r"Programs\Tencent\Weixin",
        r"Programs\wechatapp",
        r"Programs\WeChat",
        r"Programs\Weixin",
        r"Programs\xwechat",
        r"Alibaba\DingTalk",
        r"Alibaba\DingDing",
        r"Programs\DingTalk",
        r"Programs\DingDing",
        r"DingTalk",
        r"DingDing",
        r"ByteDance\Feishu",
        r"ByteDance\Lark",
        r"Programs\Feishu",
        r"Programs\Lark",
        r"Feishu",
        r"Lark",
    ];
    push_env("ProgramFiles", &tails);
    push_env("ProgramFiles(x86)", &tails);
    push_env("LOCALAPPDATA", &tails);
    push_env("APPDATA", &tails);
    roots
}

#[cfg(windows)]
fn reviewed_product_for_display_name(name: &str) -> Option<ReviewedDirectProduct> {
    let lowered = name.to_lowercase();
    if is_accepted_wechat_display_name(name) {
        return Some(ReviewedDirectProduct::WeChat);
    }
    if lowered.contains("dingtalk")
        || lowered.contains("dingding")
        || name.contains('钉')
    {
        return Some(ReviewedDirectProduct::DingTalk);
    }
    if lowered.contains("feishu") || lowered.contains("lark") || name.contains('飞') {
        return Some(ReviewedDirectProduct::Feishu);
    }
    None
}

#[cfg(windows)]
fn registry_reviewed_direct_install_locations() -> Vec<PathBuf> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};

    let mut locations = Vec::new();
    fn push_sanitized(locations: &mut Vec<PathBuf>, raw: &str) {
        if let Some(path) = sanitize_windows_registry_path(raw) {
            locations.push(PathBuf::from(path));
        }
    }
    let hives = [
        (
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            HKEY_LOCAL_MACHINE,
        ),
        (
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
            HKEY_LOCAL_MACHINE,
        ),
        (
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            HKEY_CURRENT_USER,
        ),
    ];
    for (subkey, hive) in hives {
        let Ok(root) = RegKey::predef(hive).open_subkey_with_flags(subkey, KEY_READ) else {
            continue;
        };
        for name in root.enum_keys().filter_map(Result::ok).take(512) {
            let Ok(key) = root.open_subkey_with_flags(&name, KEY_READ) else {
                continue;
            };
            let display: String = key.get_value("DisplayName").unwrap_or_default();
            if reviewed_product_for_display_name(&display).is_none() {
                continue;
            }
            if let Ok(install) = key.get_value::<String, _>("InstallLocation") {
                push_sanitized(&mut locations, &install);
            }
            if let Ok(icon) = key.get_value::<String, _>("DisplayIcon") {
                if let Some(path) = sanitize_windows_registry_path(&icon) {
                    let path = PathBuf::from(path);
                    if path.is_file() || path.extension().is_some() {
                        if let Some(parent) = path.parent() {
                            locations.push(parent.to_path_buf());
                        }
                    } else {
                        locations.push(path);
                    }
                }
            }
        }
    }
    locations
}

#[cfg(windows)]
fn is_signed_wechat_witness(path: &Path) -> bool {
    authenticode_subjects(path)
        .iter()
        .any(|subject| is_reviewed_wechat_publisher(subject))
}

#[cfg(windows)]
fn wechat_witness_candidates() -> Vec<PathBuf> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    let mut push = |path: PathBuf| {
        if seen.insert(path.clone()) {
            out.push(path);
        }
    };
    for root in known_wechat_roots() {
        for name in WECHAT_WITNESS_FILES {
            push(root.join(name));
        }
    }
    for install in registry_wechat_install_locations() {
        for name in WECHAT_WITNESS_FILES {
            push(install.join(name));
        }
    }
    out
}

#[cfg(windows)]
fn known_wechat_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut push_env = |key: &str, tails: &[&str]| {
        let Ok(base) = std::env::var(key) else {
            return;
        };
        if base.trim().is_empty() {
            return;
        }
        for tail in tails {
            roots.push(PathBuf::from(&base).join(tail));
        }
    };
    let tails = [
        r"Tencent\WeChat",
        r"Tencent\Weixin",
        r"Tencent\xwechat",
        r"Tencent\WeixinApp",
        r"Programs\Tencent\WeChat",
        r"Programs\Tencent\Weixin",
        r"Programs\wechatapp",
        r"Programs\WeChat",
        r"Programs\Weixin",
        r"Programs\xwechat",
    ];
    push_env("ProgramFiles", &tails);
    push_env("ProgramFiles(x86)", &tails);
    push_env("LOCALAPPDATA", &tails);
    push_env("APPDATA", &tails);
    roots
}

#[cfg(windows)]
fn registry_wechat_install_locations() -> Vec<PathBuf> {
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ};

    let mut locations = Vec::new();
    // No explicit element type: `winreg::HKEY` is `*mut c_void` in 0.56, not the
    // `isize` this used to claim, and the annotation is what made the Tauri crate
    // fail to compile for Windows — four of the five errors, all of them here.
    // Inference cannot drift the way a hand-written alias does.
    let hives = [
        (r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", HKEY_LOCAL_MACHINE),
        (
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
            HKEY_LOCAL_MACHINE,
        ),
        (r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall", HKEY_CURRENT_USER),
    ];
    for (subkey, hive) in hives {
        let Ok(root) = RegKey::predef(hive).open_subkey_with_flags(subkey, KEY_READ) else {
            continue;
        };
        for name in root.enum_keys().filter_map(Result::ok).take(256) {
            let Ok(key) = root.open_subkey_with_flags(&name, KEY_READ) else {
                continue;
            };
            let display: String = key.get_value("DisplayName").unwrap_or_default();
            if !is_accepted_wechat_display_name(&display) {
                continue;
            }
            if let Ok(install) = key.get_value::<String, _>("InstallLocation") {
                if let Some(path) = sanitize_windows_registry_path(&install) {
                    locations.push(PathBuf::from(path));
                }
            }
            if let Ok(icon) = key.get_value::<String, _>("DisplayIcon") {
                if let Some(path) = sanitize_windows_registry_path(&icon) {
                    let path = PathBuf::from(path);
                    if path.is_file() || path.extension().is_some() {
                        if let Some(parent) = path.parent() {
                            locations.push(parent.to_path_buf());
                        }
                    } else {
                        locations.push(path);
                    }
                }
            }
        }
    }
    for subkey in [
        r"Software\Tencent\WeChat",
        r"Software\Tencent\Weixin",
        r"Software\Tencent\xwechat",
    ] {
        if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(subkey, KEY_READ) {
            for value_name in ["InstallPath", "InstallDir", "install_path"] {
                if let Ok(install) = key.get_value::<String, _>(value_name) {
                    if let Some(path) = sanitize_windows_registry_path(&install) {
                        locations.push(PathBuf::from(path));
                    }
                }
            }
        }
    }
    locations
}

/// Signer names of a trusted Authenticode signature: CN, organization, and
/// simple display. Empty when the file is unsigned, untrusted, or unreadable.
#[cfg(windows)]
fn authenticode_subjects(path: &Path) -> Vec<String> {
    if tono_authenticode::verify(path) != tono_authenticode::AuthenticodeVerdict::Signed {
        return Vec::new();
    }
    tono_authenticode::signer_subjects(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn publisher_keys_collapse_spacing_and_punctuation() {
        assert!(is_reviewed_wechat_publisher(
            "Tencent Technology(Shenzhen) Company Limited"
        ));
        assert!(is_reviewed_wechat_publisher(
            "Tencent Technology (Shenzhen) Company Limited"
        ));
        assert!(is_reviewed_wechat_publisher(
            "Shenzhen Tencent Computer Systems Company Limited"
        ));
        assert!(!is_reviewed_wechat_publisher(
            "Tencent Cloud Computing (Beijing) Company Limited"
        ));
        assert!(!is_reviewed_wechat_publisher("Microsoft Corporation"));
        assert!(!is_reviewed_wechat_publisher("Tencent"));
        assert!(!is_reviewed_wechat_publisher(""));
        assert!(is_reviewed_dingtalk_publisher(
            "DingTalk (China) Information Technology Co., Ltd."
        ));
        assert!(is_reviewed_dingtalk_publisher(
            "Alibaba China Technology Co., Ltd."
        ));
        assert!(is_reviewed_feishu_publisher(
            "Beijing ByteDance Technology Co., Ltd."
        ));
        assert!(is_reviewed_feishu_publisher(
            "Beijing Feishu Technology Co., Ltd."
        ));
        assert!(is_reviewed_feishu_publisher("Lark Technologies Pte. Ltd."));
        assert!(!is_reviewed_feishu_publisher("Microsoft Corporation"));
    }

    #[test]
    fn wechat_folder_and_display_filters_reject_adjacent_tencent_products() {
        assert!(is_reviewed_wechat_folder_name("WeChat"));
        assert!(is_reviewed_wechat_folder_name("Weixin"));
        assert!(is_reviewed_wechat_folder_name("xwechat"));
        assert!(is_reviewed_wechat_folder_name("微信"));
        assert!(is_reviewed_wechat_folder_name("Tencent WeChat"));
        assert!(!is_reviewed_wechat_folder_name("WeChat Files"));
        assert!(!is_reviewed_wechat_folder_name("xwechat_files"));
        assert!(!is_reviewed_wechat_folder_name("QQ"));
        assert!(!is_reviewed_wechat_folder_name("WeChatWork"));
        assert!(!is_reviewed_wechat_folder_name("Tencent"));

        assert!(is_accepted_wechat_display_name("WeChat"));
        assert!(is_accepted_wechat_display_name("微信"));
        assert!(is_accepted_wechat_display_name("Weixin"));
        assert!(!is_accepted_wechat_display_name("企业微信"));
        assert!(!is_accepted_wechat_display_name("WeChat Work"));
        assert!(!is_accepted_wechat_display_name("QQ"));
        assert!(!is_accepted_wechat_display_name("Tencent Meeting"));
    }

    #[test]
    fn registry_paths_strip_quotes_and_icon_indexes() {
        assert_eq!(
            sanitize_windows_registry_path(r#""C:\Program Files\Tencent\WeChat\WeChat.exe",0"#)
                .as_deref(),
            Some(r"C:\Program Files\Tencent\WeChat\WeChat.exe")
        );
        assert_eq!(
            sanitize_windows_registry_path(r#"  "D:\Tencent\Weixin\"  "#).as_deref(),
            Some(r"D:\Tencent\Weixin\")
        );
        assert_eq!(
            sanitize_windows_registry_path(r"C:\WeChat\WeChat.exe,0").as_deref(),
            Some(r"C:\WeChat\WeChat.exe")
        );
        assert!(sanitize_windows_registry_path("").is_none());
    }

    #[test]
    fn only_official_layouts_receive_a_directory_prefix() {
        assert!(allows_wechat_directory_prefix(
            r"C:\Program Files\Tencent\WeChat\WeChat.exe"
        ));
        assert!(allows_wechat_directory_prefix(
            r"D:\Tencent\Weixin\Weixin.exe"
        ));
        assert!(allows_wechat_directory_prefix(
            r"C:\Users\a\AppData\Local\Tencent\xwechat\xwechat.exe"
        ));
        assert!(allows_wechat_directory_prefix(
            r"C:\Users\a\AppData\Local\Programs\wechatapp\WeChat.exe"
        ));
        assert!(!allows_wechat_directory_prefix(r"C:\Users\a\WeChat\WeChat.exe"));
        assert!(!allows_wechat_directory_prefix(
            r"C:\Users\a\evil\Tencent\WeChat\WeChat.exe"
        ));
        assert!(!allows_wechat_directory_prefix(r"D:\Apps\WeChat.exe"));
        assert!(!allows_wechat_directory_prefix(
            r"C:\Users\a\Documents\WeChat Files\WeChat.exe"
        ));
    }

    #[test]
    fn verified_exe_in_a_product_folder_becomes_a_prefix() {
        let regex = regex_for_verified_wechat_exe(r"C:\Program Files\Tencent\WeChat\WeChat.exe")
            .expect("reviewed product folder");
        assert!(regex.starts_with('^'));
        assert!(!regex.ends_with('$'));
        assert!(regex.contains("[Ww][Ee][Cc][Hh][Aa][Tt]"));
        assert!(tono_core::config::is_rule_payload_safe(&regex));

        let weixin = regex_for_verified_wechat_exe(r"D:\Tencent\Weixin\Weixin.exe").unwrap();
        assert!(!weixin.ends_with('$'));
        let four = regex_for_verified_wechat_exe(
            r"C:\Users\a\AppData\Local\Tencent\xwechat\xwechat.exe",
        )
        .unwrap();
        assert!(!four.ends_with('$'));
    }

    #[test]
    fn portable_exe_outside_a_product_folder_is_exact() {
        let regex =
            regex_for_verified_wechat_exe(r"D:\Apps\WeChat.exe").expect("portable witness");
        assert!(regex.starts_with('^') && regex.ends_with('$'));
        assert!(regex.contains(r"[Ww][Ee][Cc][Hh][Aa][Tt]\.[Ee][Xx][Ee]$"));
        assert!(tono_core::config::is_rule_payload_safe(&regex));
    }

    #[test]
    fn helpers_and_data_folders_are_not_tree_roots() {
        assert!(regex_for_verified_wechat_exe(r"C:\Tencent\WeChat\WeChatAppEx.exe").is_none());
        assert!(regex_for_verified_wechat_exe(r"C:\Users\a\Documents\WeChat Files\WeChat.exe").is_none());
        assert!(regex_for_verified_wechat_exe(r"C:\Tencent\QQ\WeChat.exe").is_none());
        let homemade = regex_for_verified_wechat_exe(r"C:\Users\a\WeChat\WeChat.exe").unwrap();
        assert!(homemade.ends_with('$'), "{homemade}");
        let planted = regex_for_verified_wechat_exe(r"C:\Users\a\evil\Tencent\WeChat\WeChat.exe")
            .unwrap();
        assert!(planted.ends_with('$'), "{planted}");
        let portable = regex_for_verified_wechat_exe(r"D:\Apps\WeChat.exe").unwrap();
        assert!(portable.ends_with('$'));
    }

    #[test]
    fn extended_paths_and_xwechat_are_witnesses() {
        assert!(is_wechat_witness_file_name("xwechat.exe"));
        let regex = regex_for_verified_wechat_exe(
            r"\\?\C:\Program Files\Tencent\WeChat\WeChat.exe",
        )
        .unwrap();
        assert!(regex.starts_with('^'));
        assert!(!regex.contains('?'));
    }

    #[test]
    fn office_witnesses_and_official_layouts_are_recognized() {
        assert!(is_dingtalk_witness_file_name("DingTalk.exe"));
        assert!(is_dingtalk_witness_file_name("DingTalkHelper.exe"));
        assert!(is_feishu_witness_file_name("Feishu.exe"));
        assert!(is_feishu_witness_file_name("Lark.exe"));
        assert!(!is_feishu_witness_file_name("LarkHelper.dll"));

        assert!(has_official_reviewed_direct_layout_tail(
            "dingtalk",
            r"C:\Program Files\Alibaba\DingTalk"
        ));
        assert!(has_official_reviewed_direct_layout_tail(
            "feishu",
            r"C:\Users\a\AppData\Local\Programs\Feishu"
        ));
        assert!(has_official_reviewed_direct_layout_tail(
            "feishu",
            r"C:\Users\a\Downloads\Feishu"
        ));
        let untrusted = regex_for_verified_feishu_exe(
            r"C:\Users\a\Downloads\Feishu\Feishu.exe",
        )
        .unwrap();
        assert!(untrusted.ends_with('$'));
    }

    #[test]
    fn office_portable_witnesses_are_exact_and_official_trees_are_prefixes() {
        let ding = regex_for_verified_dingtalk_exe(
            r"C:\Program Files\Alibaba\DingTalk\DingTalk.exe"
        )
        .unwrap();
        assert!(ding.starts_with('^') && !ding.ends_with('$'));
        assert!(tono_core::config::is_rule_payload_safe(&ding));

        let feishu = regex_for_verified_feishu_exe(r"D:\Apps\Feishu.exe").unwrap();
        assert!(feishu.starts_with('^') && feishu.ends_with('$'));
        assert!(tono_core::config::is_rule_payload_safe(&feishu));

        assert!(regex_for_verified_dingtalk_exe(
            r"C:\Alibaba\DingTalk\DingTalkHelper.exe"
        )
        .is_some());
        assert!(regex_for_verified_feishu_exe(
            r"C:\Users\a\Documents\Feishu Files\Feishu.exe"
        )
        .is_none());
    }

    #[test]
    fn roaming_dingding_install_gets_a_tree_prefix() {
        // Discovery also probes %APPDATA%\DingDing. Without the matching Roaming allow-list
        // entry the official tail was still classified as an untrusted user-profile tree.
        let dingding = regex_for_verified_dingtalk_exe(
            r"C:\Users\a\AppData\Roaming\DingDing\DingTalk.exe",
        )
        .unwrap();
        assert!(
            dingding.starts_with('^') && !dingding.ends_with('$'),
            "expected AnchoredPrefix, got {dingding}"
        );
        let dingtalk = regex_for_verified_dingtalk_exe(
            r"C:\Users\a\AppData\Roaming\DingTalk\DingTalk.exe",
        )
        .unwrap();
        assert!(
            dingtalk.starts_with('^') && !dingtalk.ends_with('$'),
            "expected AnchoredPrefix, got {dingtalk}"
        );
        let feishu = regex_for_verified_feishu_exe(
            r"C:\Users\a\AppData\Roaming\Feishu\Feishu.exe",
        )
        .unwrap();
        assert!(
            feishu.starts_with('^') && !feishu.ends_with('$'),
            "expected AnchoredPrefix, got {feishu}"
        );
    }

    #[test]
    fn localappdata_dingding_install_gets_a_tree_prefix() {
        // `%LOCALAPPDATA%\DingDing` is an official layout tail and a discovery root. Without the
        // matching untrusted-tree allow-list entry it was demoted to ExactFile, so helper
        // binaries next to DingTalk.exe missed the reviewed-DIRECT grant.
        let dingding = regex_for_verified_dingtalk_exe(
            r"C:\Users\a\AppData\Local\DingDing\DingTalk.exe",
        )
        .unwrap();
        assert!(
            dingding.starts_with('^') && !dingding.ends_with('$'),
            "expected AnchoredPrefix, got {dingding}"
        );
        let dingtalk = regex_for_verified_dingtalk_exe(
            r"C:\Users\a\AppData\Local\DingTalk\DingTalk.exe",
        )
        .unwrap();
        assert!(
            dingtalk.starts_with('^') && !dingtalk.ends_with('$'),
            "expected AnchoredPrefix, got {dingtalk}"
        );
    }

    #[test]
    fn directory_prefix_requires_an_admin_only_install_chain() {
        struct FakeSecurity<F>(F);
        impl<F: Fn(&str) -> Result<DirectorySecurity, String>> DirectorySecuritySource for FakeSecurity<F> {
            fn read_directory_security(&self, directory: &str) -> Result<DirectorySecurity, String> {
                (self.0)(directory)
            }
        }
        // Program Files defaults: TrustedInstaller owns it; SYSTEM, Administrators and
        // TrustedInstaller write; CREATOR OWNER is inherit-only; Users read and execute.
        // The drive root also lets Authenticated Users create folders, so the walk must
        // stop at the system root instead of reaching `C:\`.
        fn modeled(directory: &str) -> DirectorySecurity {
            let mut security = DirectorySecurity {
                owner_sid: "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464"
                    .to_string(),
                allowed_aces: vec![
                    ("S-1-5-18".to_string(), 0x001f_01ff),
                    ("S-1-5-32-544".to_string(), 0x001f_01ff),
                    ("S-1-3-0".to_string(), 0x1000_0000),
                    ("S-1-5-32-545".to_string(), 0x0012_00a9),
                ],
            };
            if directory.trim_end_matches('\\').eq_ignore_ascii_case("C:") {
                security.allowed_aces.push(("S-1-5-11".to_string(), 0x0000_0004));
            }
            security
        }
        let exe = r"C:\Program Files\Tencent\WeChat\WeChat.exe";

        let admin_only =
            FakeSecurity(|directory: &str| -> Result<DirectorySecurity, String> { Ok(modeled(directory)) });
        let prefix =
            regex_for_verified_exe_on_admin_only_tree(exe, ReviewedDirectProduct::WeChat, &admin_only)
                .unwrap();
        assert!(!prefix.ends_with('$'), "admin-only tree keeps the prefix: {prefix}");

        // Authenticated Users may modify an ancestor: anything can be planted in the tree.
        let user_writable = FakeSecurity(|directory: &str| -> Result<DirectorySecurity, String> {
            let mut security = modeled(directory);
            if directory.eq_ignore_ascii_case(r"C:\Program Files\Tencent") {
                security.allowed_aces.push(("S-1-5-11".to_string(), 0x0013_01bf));
            }
            Ok(security)
        });
        let exact = regex_for_verified_exe_on_admin_only_tree(
            exe,
            ReviewedDirectProduct::WeChat,
            &user_writable,
        )
        .unwrap();
        assert!(exact.ends_with('$'), "user-writable tree must be exact: {exact}");

        let unreadable = FakeSecurity(|directory: &str| -> Result<DirectorySecurity, String> {
            if directory.eq_ignore_ascii_case(r"C:\Program Files\Tencent\WeChat") {
                Err("access denied".to_string())
            } else {
                Ok(modeled(directory))
            }
        });
        let exact =
            regex_for_verified_exe_on_admin_only_tree(exe, ReviewedDirectProduct::WeChat, &unreadable)
                .unwrap();
        assert!(exact.ends_with('$'), "unreadable DACL must be exact: {exact}");
    }

    #[test]
    fn discovery_is_empty_off_windows() {
        #[cfg(not(windows))]
        assert!(discover_signed_wechat_path_regexes().is_empty());
        #[cfg(not(windows))]
        assert!(discover_signed_reviewed_direct_path_regexes().is_empty());
    }
}
