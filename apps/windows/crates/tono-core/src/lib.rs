//! tono-core: portable product layer for the Tono Windows client.
//!
//! Implements Tono's catalog, session, and connect contract without any
//! Windows API dependency: catalog admission and caching, owned Mihomo
//! runtime generation, API models and session logic, the connect state
//! machine, and credential storage abstractions.

#![forbid(unsafe_code)]

pub mod auth;
pub mod catalog;
pub mod config;
pub mod connection;
pub mod credentials;
pub mod node;
pub mod policy;
pub mod policy_signature;
pub mod protected_connectivity;
pub mod update_journal;

pub use catalog::{
    CatalogError, CatalogHomeSocks5, CatalogRouting, CatalogTracker, ExitCatalogResponse,
    InstallOutcome, sanitize_routing,
};
pub use config::{
    DirectPlan, OwnedRuntime, build_owned_runtime, generate_controller_secret, redact_secret,
};
pub use connection::{ConnectStage, ConnectionStatus, ReconnectBackoff, UiState};
pub use protected_connectivity::{
    EXIT_PROBE_INTERVAL, PostLockDecision, ProtectedFailureCode, TUN_PROBE_ORIGINS,
    UNVERIFIED_PROBE_ESCALATE_AFTER, UNVERIFIED_PROBE_INITIAL, UNVERIFIED_PROBE_MAX,
    classify_exhausted_data_plane, classify_post_lock, next_unverified_probe_delay,
};
pub use update_journal::{UpdateHandoffJournal, UpdateHandoffPhase};
pub use credentials::{CredentialKey, CredentialStore};
pub use node::{EXIT_GROUP_NAME, NodeRejection, ValidatedNode};
