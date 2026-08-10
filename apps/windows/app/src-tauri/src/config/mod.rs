mod clash;
#[allow(clippy::module_inception)]
mod config;
mod encrypt;
mod mixed_port;
mod verge;

pub use self::{clash::*, config::*, encrypt::*, mixed_port::*, verge::*};

pub const DEFAULT_PAC: &str = r#"function FindProxyForURL(url, host) {
  return "PROXY 127.0.0.1:%mixed-port%; SOCKS5 127.0.0.1:%mixed-port%; DIRECT;";
}
"#;
