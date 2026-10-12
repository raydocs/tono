//! Cross-platform facade for the Windows WFP kill switch.
//!
//! Layering mirrors `macos_kill_switch.rs`: this module owns the state machine, the persisted
//! intent record (`kill-switch.json`, normally written atomically before widening WFP; the
//! DIRECT retraction narrows live WFP first), the
//! verify-after-write watchdog, startup recovery (corrupt or unhealthy state releases
//! general traffic unless the user explicitly enabled the strict kill switch), and the emergency
//! disarm. The rule set itself comes from the pure model (`wfp_model.rs`); the `Fwpm*` FFI is
//! confined to `wfp.rs` and compiled only on Windows, so everything here builds and is
//! unit-exercised on any host — off Windows every mutating entry point refuses with
//! "unsupported" and status reports a never-armed switch.

use crate::core::structure::{
    KillSwitchConfig, KillSwitchStatus, KillSwitchStatusMode, ProxyEndpoint,
};
use crate::core::wfp_model::{self, RuleConfig};
use anyhow::{Context as _, Result, bail};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

mod state;
mod intent;
mod validate;
mod rules;
mod engine;
mod arm;
mod session;
mod direct;
mod disarm;
mod policy;
mod startup;
mod watchdog;
mod emergency;
mod report;

pub use self::state::*;
pub use self::intent::*;
use self::validate::*;
use self::rules::*;
pub(crate) use self::engine::*;
pub(crate) use self::arm::*;
pub(crate) use self::session::*;
pub(crate) use self::direct::*;
pub use self::disarm::*;
pub(crate) use self::policy::*;
pub use self::startup::*;
pub use self::watchdog::*;
pub use self::emergency::*;
pub(crate) use self::report::*;

#[cfg(test)]
mod tests;
