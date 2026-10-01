//! tono-core: portable product layer for the Tono Windows client.
//!
//! Implements Tono's catalog, session, and connect contract without any
//! Windows API dependency: catalog admission and caching, owned Mihomo
//! runtime generation, API models and session logic, the connect state
//! machine, and credential storage abstractions.

#![forbid(unsafe_code)]

pub mod auth;
pub mod hy2_idle;
pub mod catalog;
pub mod config;
pub mod connect_timing;
pub mod connection;
pub mod credentials;
pub mod customer_failure;
pub mod direct_domains;
pub mod heal;
pub mod network_disposition;
pub mod node;
pub mod policy;
pub mod policy_signature;
pub mod protected_connectivity;
pub mod recovery;
pub mod sing_box;
pub mod unarmed_probe;
pub mod update_contract;
pub mod update_journal;

pub use catalog::{
    CatalogError, CatalogHomeSocks5, CatalogRouting, CatalogTracker, ExitCatalogResponse,
    InstallOutcome, sanitize_routing,
};
pub use config::{
    DirectPlan, OwnedRuntime, build_owned_runtime, generate_controller_secret, redact_secret,
};
pub use connection::{ConnectStage, ConnectionStatus, ReconnectBackoff, UiState};
pub use credentials::{CredentialKey, CredentialStore};
pub use customer_failure::{
    auth_recovery_plan, auth_support_prefix, backoff_before, classify_auth_transport,
    classify_connect_text, customer_message, disposition_after_exhausted_failure, doh_resolvers,
    extra_api_front_hosts, first_public_doh_answer, parse_doh_json_answers, stamp_connect_failure,
    strict_kill_switch_explicit, AuthRecoveryStep, CustomerFailureCode, DohResolver, FailureStage,
    NetworkDisposition,
};
pub use heal::{
    Candidate, DialChange, FailureClass, HYSTERESIS_MS, KillSwitchStance, NetworkEffect, Session,
    TCP_FAIL_FAST_MS, Transport,
};
pub use network_disposition::{
    exhausted_protection, exhausted_protection_using, register_selective_ai_block,
    registered_selective_ai_block, ExhaustedProtection,
};
pub use node::{
    EXIT_GROUP_NAME, HY2_NAME_SUFFIX, NodeProtocol, NodeRejection, ValidatedNode,
    catalog_base_name, catalog_transport_of_name, is_hy2_catalog_name,
};
pub use protected_connectivity::{
    PostLockDecision, ProtectedFailureCode, TUN_PROBE_ORIGINS, classify_exhausted_data_plane,
    classify_post_lock,
};
pub use update_journal::{
    UpdateHandoffJournal, UpdateHandoffPhase, commit_verified_recovery, incomplete_from_phase,
    record_install_started,
};
