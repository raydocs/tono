//! Caller authorization: owner, takeover and logon-session checks.

use super::*;

/// Whether `caller_key` may mutate the armed protection (release / restrict / DNS restore).
///
/// The pipe authenticates *a* local user; the armed WFP policy is machine-global and belongs
/// to the owner who armed it. A different local user must not release it. Intents without an
/// `owner_key` (emergency/corrupt restores, or files predating this field) own no one: they
/// can be released by any authenticated owner — that is the documented escape hatch, and it
/// cannot be abused to steal another user's protection because there is nothing to steal
/// beyond a block anybody would want gone anyway.
pub(crate) fn authorize_write_for(
    caller_key: &str,
) -> std::result::Result<(), crate::core::auth::ServiceError> {
    let recorded = { armed_guard().clone() }.and_then(|armed| armed.intent.owner_key);
    let Some(recorded) = recorded else {
        return Ok(());
    };
    if recorded == caller_key {
        Ok(())
    } else {
        Err(crate::core::auth::ServiceError::not_active())
    }
}

/// Whether `caller_key` may make itself the owner of the armed protection (StartClash /
/// PrepareCoreStart).
///
/// `authorize_write_for` stops a different local user from releasing the armed policy, but a
/// start rewrites the recorded owner and stops the running Core, after which that user's
/// release would pass. So a start is refused on the same terms while the recorded owner still
/// has a Windows logon session (active or disconnected). Once that user has signed out nobody
/// is left to protect and the next user may take over. Ownerless intents stay open to anyone,
/// exactly as in `authorize_write_for`.
pub(crate) fn authorize_takeover_for(
    caller_key: &str,
) -> std::result::Result<(), crate::core::auth::ServiceError> {
    let recorded = { armed_guard().clone() }
        .filter(|armed| armed.intent.wanted)
        .and_then(|armed| armed.intent.owner_key);
    match recorded {
        Some(recorded) if recorded != caller_key && owner_signed_in(&recorded) => {
            Err(crate::core::auth::ServiceError::protection_held_by_another_user())
        }
        _ => Ok(()),
    }
}

/// The kind of Windows session the authenticated caller's process runs in.
#[cfg_attr(not(any(all(windows, not(feature = "test")), test)), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CallerSession {
    /// The physical console session.
    Console,
    /// A Remote Desktop (or other remoting protocol) session. It reaches this PC over the
    /// physical interface that armed protection blocks, with no inbound exception.
    Remote,
    /// The session could not be read.
    Unknown,
}

/// Whether a user-initiated connect (`StartClash` / `PrepareCoreStart`) must be refused because
/// of the caller's session (TW-anthropic-1).
///
/// Arming protection from a Remote Desktop session cuts that session, and once the intent is
/// verified the block is reinstalled at every boot; the emergency release refuses while the
/// Service answers, and a disconnected owner still counts as signed in. A PC managed only over
/// RDP could not be recovered. So a caller that is not provably on the console may not be the one
/// that first arms protection. An unreadable session is refused like a remote one: the refusal
/// leaves the network exactly as it was, while a wrong "console" answer could strand the machine.
///
/// The one exception is a caller whose own protection is already *verified* (`armed` is the
/// published intent). Verification is committed only after a successful lock, so it proves the
/// barrier was actually installed for this owner; that reconnect path stays fail-closed and
/// unchanged. A verified intent carried over by startup recovery is withheld from `armed` until
/// this start has proved its filters (`connect_session_refused`, TW-R-boot).
/// A bare `wanted` intent proves nothing: `ARMED` is published before the WFP install
/// and survives a failed one, so a local first arm that failed before committing filters must not
/// let a Remote Desktop retry arm for the first time.
pub(super) fn remote_session_connect_refused(
    session: CallerSession,
    armed: Option<&IntentRecord>,
    caller_key: &str,
) -> bool {
    let caller_holds_verified_protection = armed.is_some_and(|intent| {
        intent.wanted && intent.is_verified() && intent.owner_key.as_deref() == Some(caller_key)
    });
    session != CallerSession::Console && !caller_holds_verified_protection
}

/// [`remote_session_connect_refused`] against the Service's published protection. A verified
/// intent carried over by startup recovery counts only once this start has proved its filters
/// ([`RESTORED_BARRIER_UNPROVEN`]); until then the caller holds no proven protection.
pub(super) fn connect_session_refused(session: CallerSession, caller_key: &str) -> bool {
    let armed = armed_guard();
    let proven = armed
        .as_ref()
        .filter(|_| !RESTORED_BARRIER_UNPROVEN.load(Ordering::Acquire));
    remote_session_connect_refused(session, proven.map(|armed| &armed.intent), caller_key)
}

/// Refuse a connect from a non-console session unless the caller already holds verified
/// protection. `caller_session_id` is `AuthenticatedOwner::peer_session_id`: read from the token of
/// the very pipe-peer process whose SID authentication verified, while that process handle was
/// open, so it names the calling App's session (not this Service's Session 0) and cannot be
/// redirected by a PID reused while the request waited for the lifecycle lock.
pub(crate) fn authorize_connect_session_for(
    caller_key: &str,
    caller_session_id: Option<u32>,
) -> std::result::Result<(), crate::core::auth::ServiceError> {
    let session = caller_session(caller_session_id);
    if !connect_session_refused(session, caller_key) {
        return Ok(());
    }
    tracing::warn!("connect refused: caller session is {session:?}, not the local console");
    let message = if session == CallerSession::Remote {
        "Connect is not allowed from a Remote Desktop session because protection would block this \
         remote connection; connect from the local console"
    } else {
        "Connect is not allowed because this Windows session could not be confirmed as the local \
         console, and protection would block a remote connection; connect from the local console"
    };
    Err(crate::core::auth::ServiceError::remote_session_connect_refused(message))
}

/// The current `WTSClientProtocolType` of Windows session `session_id` (0 = console; 1 = legacy
/// ICA and 2 = RDP are both remote). Read at the gate, not at authentication, so a console session
/// taken over by Remote Desktop while the request waited is seen as remote. Any failure, including
/// a peer whose session was never read, answers `Unknown`.
#[cfg(all(windows, not(feature = "test")))]
fn caller_session(session_id: Option<u32>) -> CallerSession {
    use windows_sys::Win32::System::RemoteDesktop::{
        WTS_CURRENT_SERVER_HANDLE, WTSClientProtocolType, WTSFreeMemory,
        WTSQuerySessionInformationW,
    };

    let Some(session_id) = session_id else {
        return CallerSession::Unknown;
    };
    let mut buffer: windows_sys::core::PWSTR = std::ptr::null_mut();
    let mut returned = 0_u32;
    if unsafe {
        WTSQuerySessionInformationW(
            WTS_CURRENT_SERVER_HANDLE,
            session_id,
            WTSClientProtocolType,
            &mut buffer,
            &mut returned,
        )
    } == 0
        || buffer.is_null()
    {
        return CallerSession::Unknown;
    }
    // A USHORT; read unaligned because the buffer is typed as a wide string.
    let protocol = (returned as usize >= std::mem::size_of::<u16>())
        .then(|| unsafe { buffer.read_unaligned() });
    unsafe { WTSFreeMemory(buffer.cast()) };
    match protocol {
        Some(0) => CallerSession::Console,
        Some(_) => CallerSession::Remote,
        None => CallerSession::Unknown,
    }
}

/// Off Windows and in the lifecycle `test` build there is no WTS: every caller is on the console,
/// so the gate never changes those builds' behavior.
#[cfg(not(all(windows, not(feature = "test"))))]
fn caller_session(_session_id: Option<u32>) -> CallerSession {
    CallerSession::Console
}

/// True unless every Windows session a user can be signed in to was inspected and none belongs to
/// the user whose owner key is `owner_key`. Only sessions in the Active, Connected or
/// Disconnected state can hold a signed-in user; listener, idle, reset, down and init sessions
/// are skipped, so a Remote Desktop listener cannot keep a takeover refused forever. Within
/// those sessions, only an explicit "no user" (`ERROR_NO_TOKEN`) or "session gone"
/// (`ERROR_CTX_WINSTATION_NOT_FOUND`) counts as not signed in; any other failure, and any
/// failure to enumerate, answers true: not knowing must keep the other user's protection in
/// place.
#[cfg(all(windows, not(feature = "test")))]
fn owner_signed_in(owner_key: &str) -> bool {
    use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, OwnedHandle};
    use windows_sys::Win32::Foundation::{
        ERROR_CTX_WINSTATION_NOT_FOUND, ERROR_NO_TOKEN, GetLastError, LocalFree,
    };
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows_sys::Win32::Security::{GetTokenInformation, TOKEN_USER, TokenUser};
    use windows_sys::Win32::System::RemoteDesktop::{
        WTS_CURRENT_SERVER_HANDLE, WTS_SESSION_INFOW, WTSActive, WTSConnected, WTSDisconnected,
        WTSEnumerateSessionsW, WTSFreeMemory, WTSQueryUserToken,
    };

    fn session_user_key(token: &OwnedHandle) -> Option<String> {
        let mut required = 0_u32;
        unsafe {
            GetTokenInformation(
                token.as_raw_handle(),
                TokenUser,
                std::ptr::null_mut(),
                0,
                &mut required,
            )
        };
        if required == 0 {
            return None;
        }
        let words = (required as usize).div_ceil(std::mem::size_of::<usize>());
        let mut buffer = vec![0_usize; words];
        if unsafe {
            GetTokenInformation(
                token.as_raw_handle(),
                TokenUser,
                buffer.as_mut_ptr().cast(),
                required,
                &mut required,
            )
        } == 0
        {
            return None;
        }
        let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
        let mut text = std::ptr::null_mut();
        if unsafe { ConvertSidToStringSidW(user.User.Sid, &mut text) } == 0 || text.is_null() {
            return None;
        }
        let length = (0..)
            .take_while(|index| unsafe { *text.add(*index) } != 0)
            .count();
        let sid = String::from_utf16(unsafe { std::slice::from_raw_parts(text, length) });
        unsafe { LocalFree(text.cast()) };
        Some(crate::core::structure::owner_key(
            &crate::OwnerIdentity::Windows { sid: sid.ok()? },
        ))
    }

    let mut sessions: *mut WTS_SESSION_INFOW = std::ptr::null_mut();
    let mut count = 0_u32;
    if unsafe { WTSEnumerateSessionsW(WTS_CURRENT_SERVER_HANDLE, 0, 1, &mut sessions, &mut count) }
        == 0
    {
        tracing::warn!("logon sessions could not be enumerated; treating the owner as signed in");
        return true;
    }
    let listed = unsafe { std::slice::from_raw_parts(sessions, count as usize) }
        .iter()
        .filter(|session| matches!(session.State, WTSActive | WTSConnected | WTSDisconnected))
        .map(|session| session.SessionId)
        .collect::<Vec<_>>();
    unsafe { WTSFreeMemory(sessions.cast()) };
    for session_id in listed {
        let mut token = std::ptr::null_mut();
        if unsafe { WTSQueryUserToken(session_id, &mut token) } == 0 {
            if matches!(
                unsafe { GetLastError() },
                ERROR_NO_TOKEN | ERROR_CTX_WINSTATION_NOT_FOUND
            ) {
                // No user on this session (e.g. an empty logon screen), or it ended after the
                // enumeration.
                continue;
            }
            tracing::warn!(
                "session {session_id} user could not be read; treating the owner as signed in"
            );
            return true;
        }
        let token = unsafe { OwnedHandle::from_raw_handle(token) };
        match session_user_key(&token) {
            Some(key) if key == owner_key => return true,
            Some(_) => {}
            None => return true,
        }
    }
    false
}

#[cfg(not(all(windows, not(feature = "test"))))]
fn owner_signed_in(_owner_key: &str) -> bool {
    #[cfg(test)]
    {
        !TEST_OWNER_SIGNED_OUT.load(Ordering::Relaxed)
    }
    #[cfg(not(test))]
    {
        true
    }
}
