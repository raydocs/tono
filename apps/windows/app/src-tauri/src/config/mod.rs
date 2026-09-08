mod clash;
#[allow(clippy::module_inception)]
mod config;
mod encrypt;
mod mixed_port;
mod preferences;

pub use self::{clash::*, config::*, encrypt::*, mixed_port::*, preferences::*};

pub const DEFAULT_PAC: &str = r#"function FindProxyForURL(url, host) {
  return "PROXY 127.0.0.1:%mixed-port%; SOCKS5 127.0.0.1:%mixed-port%; DIRECT;";
}
"#;
