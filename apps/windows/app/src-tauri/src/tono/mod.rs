//! Tono product layer: account session, exit catalog, and the connect
//! transaction, built on the portable `tono-core` crate and the Service IPC
//! client in `core::service`. Tono pages are the only UI. Leftover Clash Verge
//! engine-room (sidecar manager, IClashTemp) is still compiled until those
//! modules are peeled.

pub mod audit;
pub mod bootstrap;
mod browser_dns;
pub mod catalog_sync;
pub mod commands;
pub mod connection;
mod connection_health;
mod connection_plan;
mod connection_routes;
pub mod credentials;
pub mod diagnostics;
pub(crate) mod encrypted_dns;
mod integration_profile;
pub mod policy_sync;
pub mod protected_probe;
mod signed_apps;
pub mod state;
pub mod steps;
pub mod log_upload;
pub mod telemetry;
pub mod transport;
pub mod update_handoff;
#[cfg(windows)]
mod windows_dns;

pub use state::TonoState;
