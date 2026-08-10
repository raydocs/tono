pub mod autostart;
pub mod handle;
pub mod logger;
pub mod manager;
mod notification;
pub(crate) mod owner_identity;
pub mod proxy_control;
pub mod runstate;
pub mod service;
pub mod sysopt;
pub mod tray;

pub use self::manager::CoreManager;
