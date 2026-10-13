//! Handing a departed owner's armed protection to the user who connects next (#1293 item 1).
//!
//! PrepareCoreStart stops the Core a recorded owner left running. When that owner has signed
//! out the next user may take over (`authorize_takeover_for`), but the owner on record used to
//! change only at StartClash's `arm_bootstrap`. A connect failing in between released as a user
//! who is not the recorded owner, which `authorize_write_for` and the release worker's
//! `owner_refusal` both refuse, so the machine stayed Blocked.
//!
//! The takeover is one transaction under the release authority's cross-process lock C, the same
//! lock the independent release worker holds from before its first effect:
//!
//! 1. take C (`Authority::hold_for_takeover`): refused, retryably, while a release is in flight;
//! 2. under `WFP_OPERATION`, re-decide with `authorize_takeover_for` (a signed-in owner is
//!    refused exactly as `arm_bootstrap` refuses it), retire the departed owner's active-owner
//!    record and desired run state, and move the recorded owner to the caller;
//! 3. stop the old Core, still under C.
//!
//! Neither `authorize_write_for` nor `owner_refusal` is relaxed: afterwards the caller really is
//! the recorded owner and nobody else's connection is on record.

use super::*;
use crate::core::release::{ADMISSION_LOCK_TIMEOUT, AdmissionRefusal, Authority, Processes};
use std::future::Future;
use std::sync::Arc;

/// Why a PrepareCoreStart could not proceed. Every variant but [`TakeoverError::Stop`] leaves
/// the old Core running.
#[derive(Debug)]
pub(crate) enum TakeoverError {
    /// The recorded owner is still signed in.
    Refused(crate::core::auth::ServiceError),
    /// A release is in flight; the caller may retry.
    Release(AdmissionRefusal),
    /// The ownership records could not be changed.
    State(anyhow::Error),
    /// The ownership moved, but stopping the old Core failed.
    Stop(anyhow::Error),
}

/// The owner on record when it is someone other than `caller_key` and the caller may take the
/// protection over; `None` when there is nothing to hand over.
fn departed_owner_for(
    caller_key: &str,
) -> std::result::Result<Option<String>, crate::core::auth::ServiceError> {
    authorize_takeover_for(caller_key)?;
    Ok(armed_guard()
        .as_ref()
        .filter(|armed| armed.intent.wanted)
        .and_then(|armed| armed.intent.owner_key.clone())
        .filter(|recorded| recorded != caller_key))
}

/// Run `stop_core`, first handing a departed owner's protection to `caller_key` when there is
/// one. With nothing to hand over `stop_core` runs as before, without taking C.
pub(crate) async fn stop_core_for_start<R, F, Fut>(
    caller_key: &str,
    authority: Authority,
    processes: Arc<Processes>,
    stop_core: F,
) -> std::result::Result<R, TakeoverError>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<R>>,
{
    if departed_owner_for(caller_key)
        .map_err(TakeoverError::Refused)?
        .is_none()
    {
        return stop_core().await.map_err(TakeoverError::Stop);
    }
    let _held = tokio::task::spawn_blocking(move || {
        authority.hold_for_takeover(ADMISSION_LOCK_TIMEOUT, &processes)
    })
    .await
    .unwrap_or_else(|error| {
        Err(AdmissionRefusal::Corrupt(format!(
            "takeover lock worker failed: {error}"
        )))
    })
    .map_err(TakeoverError::Release)?;
    move_ownership(caller_key).await?;
    stop_core().await.map_err(TakeoverError::Stop)
}

/// Step 2: decided again under `WFP_OPERATION`, because the owner may have changed since the
/// look above. Retirement comes first and is idempotent: a failure part-way leaves the departed
/// owner still on record, so the caller's retry runs the whole step again.
async fn move_ownership(caller_key: &str) -> std::result::Result<(), TakeoverError> {
    if caller_key.is_empty() {
        return Err(TakeoverError::State(anyhow::anyhow!(
            "taking over armed protection requires the authenticated owner key"
        )));
    }
    let _operation = WFP_OPERATION.lock().await;
    let Some(departed) = departed_owner_for(caller_key).map_err(TakeoverError::Refused)? else {
        return Ok(());
    };
    crate::core::desired::retire_owner_if_active(&departed)
        .await
        .map_err(|error| {
            TakeoverError::State(error.context("failed to retire the departed owner's connection"))
        })?;
    commit_owner(caller_key).await.map_err(TakeoverError::State)
}

/// What the intent file holds after a write that reported an error.
enum Disk {
    /// The new record: the write landed.
    New,
    /// A readable record still naming the previous owner.
    Old,
    /// Missing, unreadable, or something else.
    Unknown,
}

async fn disk_state(path: &Path, new_bytes: &[u8], old_owner: Option<&str>) -> Disk {
    match tokio::fs::read(path).await {
        Ok(bytes) if bytes == new_bytes => Disk::New,
        Ok(bytes) => match serde_json::from_slice::<IntentRecord>(&bytes) {
            Ok(intent) if intent.owner_key.as_deref() == old_owner => Disk::Old,
            _ => Disk::Unknown,
        },
        Err(_) => Disk::Unknown,
    }
}

/// Record `caller_key` as owner of the armed intent. Memory changes only once the disk is known
/// to hold the new record: after a clean write, or after an error whose re-read finds the new
/// bytes (the rename landed and only its report failed). An error that leaves the old record is
/// returned as is; one that leaves anything else (a stale or half-written file) is repaired by
/// writing the old record back. Only the owner, its verification and the timestamp change; the
/// filters, mode and Core window stay as they are, and the departed owner's verification is not
/// the caller's.
///
/// A rename that stalls past this whole call and lands later is the documented BRICK-W11 limit
/// of `atomic_write`; it is not covered here either.
async fn commit_owner(caller_key: &str) -> Result<()> {
    let Some(old) = armed_guard().as_ref().map(|armed| armed.intent.clone()) else {
        return Ok(());
    };
    let mut next = old.clone();
    next.owner_key = Some(caller_key.to_owned());
    next.verified = Some(false);
    next.updated_at = now_unix();
    let path = intent_path();
    let new_bytes = serde_json::to_vec_pretty(&next)?;
    if let Err(error) = atomic_write(&path, &new_bytes).await {
        match disk_state(&path, &new_bytes, old.owner_key.as_deref()).await {
            Disk::New => {}
            Disk::Old => {
                return Err(error.context("the protection owner was not changed"));
            }
            Disk::Unknown => {
                let old_bytes = serde_json::to_vec_pretty(&old)?;
                return Err(match atomic_write(&path, &old_bytes).await {
                    Ok(()) => error.context(
                        "the protection owner was not changed; the previous record was written back",
                    ),
                    Err(restore) => error.context(format!(
                        "the protection owner record is in an unknown state and the previous \
                         record could not be written back: {restore:#}"
                    )),
                });
            }
        }
    }
    if let Some(armed) = armed_guard().as_mut() {
        armed.intent.owner_key = next.owner_key;
        armed.intent.verified = next.verified;
        armed.intent.updated_at = next.updated_at;
    }
    Ok(())
}
