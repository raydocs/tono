//! Local, account-owned route hints. They never authorize a connection or prove current health.
//! A bounded FIFO owns all disk work; the connection commit only tries to enqueue a captured owner.

use std::{io::Read as _, path::PathBuf, sync::Arc};

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, oneshot};
use tono_core::catalog_base_name;

use super::{
    catalog_sync,
    commands::epoch_millis,
    state::{AccountState, TonoInner, TonoState, write_private_file},
};

const MAX_BYTES: u64 = 65_536;
const MAX_ACCOUNTS: usize = 8;
const MAX_FAVORITES: usize = 24;
const MAX_RECENT: usize = 8;
const RECENT_AGE_MS: i64 = 86_400_000;
static PROCESS_SCOPE: Lazy<String> = Lazy::new(tono_core::auth::new_installation_id);
static STORE: Lazy<mpsc::Sender<Request>> = Lazy::new(|| {
    let (sender, mut receiver) = mpsc::channel::<Request>(32);
    tokio::spawn(async move {
        while let Some(request) = receiver.recv().await {
            let result = tokio::task::spawn_blocking(move || {
                let reply = operate(&request.context, request.operation);
                if let Some(done) = request.done {
                    let _ = done.send(reply);
                } else if reply.is_err() {
                    tono_logging::logging!(
                        warn,
                        tono_logging::Type::Service,
                        "Tono: could not retain verified route history"
                    );
                }
            })
            .await;
            if result.is_err() {
                tono_logging::logging!(
                    warn,
                    tono_logging::Type::Service,
                    "Tono: route preference worker failed; history is not guaranteed"
                );
            }
        }
    });
    sender
});

/// No account identifier crosses IPC. The auth generation changes on restore, login and logout.
pub fn scope_of(inner: &TonoInner) -> Option<String> {
    (inner.account_close.is_none() && matches!(inner.account_state, AccountState::Ready) && inner.account.is_some())
        .then(|| format!("{}:{}", *PROCESS_SCOPE, inner.sign_in_generation))
}

#[derive(Clone)]
pub(crate) struct PreferenceContext {
    dir: PathBuf,
    owner: String,
    scope: String,
    revision: i64,
    names: Vec<String>,
}

impl PreferenceContext {
    pub(crate) fn capture(inner: &TonoInner) -> Option<Self> {
        let revision = inner.catalog_tracker.current_revision();
        if revision < 0 {
            return None;
        }
        Some(Self {
            dir: inner.catalog_dir.clone(),
            owner: inner.account.as_ref()?.id.clone(),
            scope: scope_of(inner)?,
            revision,
            names: inner
                .nodes
                .iter()
                .filter(|node| !catalog_sync::is_exit_blocked(&node.name))
                .map(|node| node.name.clone())
                .collect(),
        })
    }

    fn is_current(&self, inner: &TonoInner) -> bool {
        scope_of(inner).as_deref() == Some(self.scope.as_str())
            && inner.account.as_ref().is_some_and(|user| user.id == self.owner)
            && inner.catalog_tracker.current_revision() == self.revision
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentRoute {
    pub name: String,
    pub revision: i64,
    pub verified_at_ms: i64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct AccountPreferences {
    owner: String,
    favorites: Vec<String>,
    recent: Vec<RecentRoute>,
    fixed_region: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct PreferenceFile {
    accounts: Vec<AccountPreferences>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutePreferences {
    pub scope: String,
    pub catalog_revision: i64,
    pub favorites: Vec<String>,
    pub recent: Vec<RecentRoute>,
    pub fixed_region: Option<String>,
}

enum Operation {
    Read,
    Update {
        favorites: Vec<String>,
        fixed_region: Option<String>,
    },
    Verified(RecentRoute),
}

struct Request {
    context: PreferenceContext,
    operation: Operation,
    done: Option<oneshot::Sender<Result<RoutePreferences, String>>>,
}

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 128 && !name.chars().any(char::is_control)
}

fn normalize(preferences: &mut AccountPreferences, names: &[String], now: i64) {
    let mut favorites = Vec::new();
    for name in &preferences.favorites {
        let base = catalog_base_name(name).to_owned();
        if valid_name(&base)
            && !favorites.contains(&base)
            && names.iter().any(|current| catalog_base_name(current) == base)
        {
            favorites.push(base);
        }
        if favorites.len() == MAX_FAVORITES {
            break;
        }
    }
    preferences.favorites = favorites;
    preferences
        .recent
        .sort_by_key(|entry| std::cmp::Reverse(entry.verified_at_ms));
    let mut seen = Vec::new();
    preferences.recent.retain(|entry| {
        let base = catalog_base_name(&entry.name).to_owned();
        let keep = valid_name(&entry.name)
            && entry.revision >= 0
            && now
                .checked_sub(entry.verified_at_ms)
                .is_some_and(|age| (0..RECENT_AGE_MS).contains(&age))
            && names.contains(&entry.name)
            && !seen.contains(&base);
        if keep {
            seen.push(base);
        }
        keep
    });
    preferences.recent.truncate(MAX_RECENT);
    preferences.fixed_region = preferences
        .fixed_region
        .take()
        .filter(|region| region.len() == 2 && region.bytes().all(|byte| byte.is_ascii_uppercase()));
}

fn read_file(dir: &std::path::Path) -> PreferenceFile {
    let read = || -> Option<PreferenceFile> {
        let file = std::fs::File::open(dir.join("route-preferences.json")).ok()?;
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1).read_to_end(&mut bytes).ok()?;
        if bytes.len() as u64 > MAX_BYTES {
            return None;
        }
        let mut parsed: PreferenceFile = serde_json::from_slice(&bytes).ok()?;
        parsed.accounts.truncate(MAX_ACCOUNTS);
        Some(parsed)
    };
    read().unwrap_or_default()
}

fn operate(context: &PreferenceContext, operation: Operation) -> Result<RoutePreferences, String> {
    let mut file = read_file(&context.dir);
    let mut preferences = file
        .accounts
        .iter()
        .find(|entry| entry.owner == context.owner)
        .cloned()
        .unwrap_or_else(|| AccountPreferences {
            owner: context.owner.clone(),
            ..Default::default()
        });
    let write = !matches!(operation, Operation::Read);
    match operation {
        Operation::Read => {}
        Operation::Update {
            favorites,
            fixed_region,
        } => {
            preferences.favorites = favorites;
            preferences.fixed_region = fixed_region;
        }
        Operation::Verified(recent) => preferences.recent.push(recent),
    }
    normalize(&mut preferences, &context.names, epoch_millis());
    if write {
        file.accounts.retain(|entry| entry.owner != context.owner);
        file.accounts.insert(0, preferences.clone());
        file.accounts.truncate(MAX_ACCOUNTS);
        let bytes = serde_json::to_vec(&file).map_err(|_| "could not encode route preferences")?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err("route preferences exceed storage limit".into());
        }
        let temporary = context.dir.join("route-preferences.tmp");
        write_private_file(&temporary, &bytes)
            .and_then(|_| std::fs::rename(&temporary, context.dir.join("route-preferences.json")).map_err(Into::into))
            .map_err(|_| "could not save route preferences")?;
    }
    Ok(RoutePreferences {
        scope: context.scope.clone(),
        catalog_revision: context.revision,
        favorites: preferences.favorites,
        recent: preferences.recent,
        fixed_region: preferences.fixed_region,
    })
}

async fn request(
    state: &TonoState,
    expected: Option<(&str, i64)>,
    operation: Operation,
) -> Result<RoutePreferences, String> {
    let (done, received) = oneshot::channel();
    let context = {
        let inner = state.lock().await;
        let context =
            PreferenceContext::capture(&inner).ok_or("route preferences require a ready account and catalog")?;
        if expected.is_some_and(|(scope, revision)| context.scope != scope || context.revision != revision) {
            return Err("route preference account or catalog changed".into());
        }
        // Enqueue in account-admission order without awaiting the writer. A stale same-account
        // login cannot race a newer accepted preference update to the FIFO after releasing this lock.
        STORE
            .try_send(Request {
                context: context.clone(),
                operation,
                done: Some(done),
            })
            .map_err(|_| "route preference queue is busy")?;
        context
    };
    // No product-state lock is held while storage or the owner queue is awaited.
    let reply = tokio::time::timeout(std::time::Duration::from_secs(3), received)
        .await
        .map_err(|_| "route preference storage is slow; refresh before retrying")?
        .map_err(|_| "route preference worker stopped")??;
    if !context.is_current(&state.lock().await) {
        return Err("route preference account or catalog changed".into());
    }
    Ok(reply)
}

#[tauri::command]
pub async fn tono_route_preferences(state: tauri::State<'_, Arc<TonoState>>) -> Result<RoutePreferences, String> {
    request(&state, None, Operation::Read).await
}

#[tauri::command]
pub async fn tono_update_route_preferences(
    state: tauri::State<'_, Arc<TonoState>>,
    scope: String,
    catalog_revision: i64,
    favorites: Vec<String>,
    fixed_region: Option<String>,
) -> Result<RoutePreferences, String> {
    if favorites.len() > MAX_FAVORITES
        || favorites.iter().any(|name| !valid_name(name))
        || fixed_region
            .as_ref()
            .is_some_and(|region| region.len() != 2 || !region.bytes().all(|byte| byte.is_ascii_uppercase()))
    {
        return Err("invalid route preferences".into());
    }
    request(
        &state,
        Some((&scope, catalog_revision)),
        Operation::Update {
            favorites,
            fixed_region,
        },
    )
    .await
}

/// Called only after the existing TUN verification + service verified-session commit. The
/// account captured at attempt admission must still own the commit; a newly selected row is not success.
pub(crate) fn record_verified(inner: &TonoInner, owner: Option<&PreferenceContext>, name: &str) {
    let Some(request) = verified_request(inner, owner, name) else {
        return;
    };
    if STORE.try_send(request).is_err() {
        tono_logging::logging!(
            warn,
            tono_logging::Type::Service,
            "Tono: route history queue busy; success hint omitted"
        );
    }
}

fn verified_request(inner: &TonoInner, owner: Option<&PreferenceContext>, name: &str) -> Option<Request> {
    let context = owner.filter(|owner| owner.is_current(inner) && owner.names.iter().any(|node| node == name))?;
    let recent = RecentRoute {
        name: name.to_owned(),
        revision: context.revision,
        verified_at_ms: epoch_millis(),
    };
    Some(Request {
        context: context.clone(),
        operation: Operation::Verified(recent),
        done: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn replacement_account_cannot_acquire_an_earlier_attempts_success() {
        let state = TonoState::for_test();
        let dir = std::env::temp_dir().join(tono_core::auth::new_installation_id());
        std::fs::create_dir_all(&dir).unwrap();
        let (owner, queued, replacement) = {
            let mut inner = state.lock().await;
            inner.catalog_dir = dir.clone();
            inner.catalog_tracker = tono_core::CatalogTracker::from_installed(7, "fixture".into());
            inner.account_state = AccountState::Ready;
            inner.account =
                Some(serde_json::from_value(serde_json::json!({ "id": "A", "email": "a@example.test" })).unwrap());
            let mut owner = PreferenceContext::capture(&inner).unwrap();
            owner.names = vec!["US Route".into()];
            let queued = verified_request(&inner, Some(&owner), "US Route").unwrap();
            // Deliberately keep the same catalog and connection generation. User.id fencing
            // rejects replacement adoption even before an auth-generation change is visible.
            inner.account.as_mut().unwrap().id = "B".into();
            assert!(verified_request(&inner, Some(&owner), "US Route").is_none());
            inner.sign_in_generation += 1;
            assert!(verified_request(&inner, Some(&owner), "US Route").is_none());
            (owner, queued, PreferenceContext::capture(&inner).unwrap())
        };
        // A write that had already queued before replacement still belongs to A, never B.
        operate(&queued.context, queued.operation).unwrap();
        assert!(operate(&replacement, Operation::Read).unwrap().recent.is_empty());
        assert_eq!(operate(&owner, Operation::Read).unwrap().recent[0].name, "US Route");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn preference_storage_is_bounded_corruption_tolerant_and_account_owned() {
        let dir = std::env::temp_dir().join(tono_core::auth::new_installation_id());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("route-preferences.json"), b"{broken").unwrap();
        let mut names: Vec<_> = (0..30).map(|n| format!("US Route {n}")).collect();
        names.push("US Route 0 · hy2".into());
        let context = PreferenceContext {
            dir: dir.clone(),
            owner: "A".into(),
            scope: "session-a".into(),
            revision: 7,
            names: names.clone(),
        };
        let read = operate(&context, Operation::Read).unwrap();
        assert!(read.favorites.is_empty());
        let saved = operate(
            &context,
            Operation::Update {
                favorites: names,
                fixed_region: Some("US".into()),
            },
        )
        .unwrap();
        assert_eq!(saved.favorites.len(), MAX_FAVORITES);
        let now = epoch_millis();
        let mut preferences = AccountPreferences {
            favorites: vec!["US Route 0 · hy2".into(), "US Route 0".into(), "retired".into()],
            recent: vec![
                RecentRoute {
                    name: "US Route 0".into(),
                    revision: 7,
                    verified_at_ms: now - 100,
                },
                RecentRoute {
                    name: "US Route 0 · hy2".into(),
                    revision: 7,
                    verified_at_ms: now - 50,
                },
                RecentRoute {
                    name: "retired".into(),
                    revision: 7,
                    verified_at_ms: now - 20,
                },
                RecentRoute {
                    name: "US Route 1".into(),
                    revision: 7,
                    verified_at_ms: now - RECENT_AGE_MS,
                },
                RecentRoute {
                    name: "US Route 2".into(),
                    revision: 7,
                    verified_at_ms: now + 1,
                },
            ],
            ..Default::default()
        };
        normalize(&mut preferences, &context.names, now);
        assert_eq!(preferences.favorites, ["US Route 0"]);
        assert_eq!(preferences.recent.len(), 1);
        assert_eq!(preferences.recent[0].name, "US Route 0 · hy2");
        preferences.recent = (0..30)
            .map(|n| RecentRoute {
                name: format!("US Route {n}"),
                revision: 7,
                verified_at_ms: now - 30 + n,
            })
            .collect();
        normalize(&mut preferences, &context.names, now);
        assert_eq!(preferences.recent.len(), MAX_RECENT);
        assert_eq!(preferences.recent[0].name, "US Route 29");
        let other = PreferenceContext {
            owner: "B".into(),
            scope: "session-b".into(),
            ..context.clone()
        };
        assert!(operate(&other, Operation::Read).unwrap().favorites.is_empty());
        assert_eq!(
            operate(&context, Operation::Read).unwrap().favorites.len(),
            MAX_FAVORITES
        );
        std::fs::write(dir.join("route-preferences.json"), vec![b' '; MAX_BYTES as usize + 1]).unwrap();
        assert!(operate(&context, Operation::Read).unwrap().favorites.is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
