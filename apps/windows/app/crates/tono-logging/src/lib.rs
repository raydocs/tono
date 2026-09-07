use flexi_logger::DeferredNow;
use flexi_logger::filter::LogLineFilter;
use flexi_logger::writers::FileLogWriter;
use log::Record;
use std::{fmt, sync::Arc};
use tokio::sync::Mutex;

pub type SharedWriter = Arc<Mutex<FileLogWriter>>;

#[derive(Debug, PartialEq, Eq)]
pub enum Type {
    Core,
    Config,
    Setup,
    System,
    SystemSignal,
    Service,
    Window,
    Tray,
    Frontend,
    File,
    Tono,
}

impl fmt::Display for Type {
    #[inline]
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Core => write!(f, "[Core]"),
            Self::Config => write!(f, "[Config]"),
            Self::Setup => write!(f, "[Setup]"),
            Self::System => write!(f, "[System]"),
            Self::SystemSignal => write!(f, "[SysSignal]"),
            Self::Service => write!(f, "[Service]"),
            Self::Window => write!(f, "[Window]"),
            Self::Tray => write!(f, "[Tray]"),
            Self::Frontend => write!(f, "[Frontend]"),
            Self::File => write!(f, "[File]"),
            Self::Tono => write!(f, "[Tono]"),
        }
    }
}

#[macro_export]
macro_rules! logging {
    // 不带 print 参数的版本（默认不打印）
    ($level:ident, $type:expr, $($arg:tt)*) => {
        log::$level!(target: "app", "{} {}", $type, format_args!($($arg)*))
    };
}

#[macro_export]
macro_rules! logging_error {
    // Handle Result<T, E>
    ($type:expr, $expr:expr) => {
        if let Err(err) = $expr {
            log::error!(target: "app", "[{}] {}", $type, err);
        }
    };

    // Handle formatted message: always print to stdout and log as error
    ($type:expr, $fmt:literal $(, $arg:expr)*) => {
        log::error!(target: "app", "[{}] {}", $type, format_args!($fmt $(, $arg)*));
    };
}

pub struct NoModuleFilter<'a>(pub Vec<&'a str>);

impl<'a> NoModuleFilter<'a> {
    #[inline]
    pub fn filter(&self, record: &Record) -> bool {
        if let Some(module) = record.module_path() {
            for blocked in self.0.iter() {
                if module.len() >= blocked.len() && module.as_bytes()[..blocked.len()] == blocked.as_bytes()[..] {
                    return false;
                }
            }
        }
        true
    }
}

impl<'a> LogLineFilter for NoModuleFilter<'a> {
    #[inline]
    fn write(
        &self,
        now: &mut DeferredNow,
        record: &Record,
        writer: &dyn flexi_logger::filter::LogLineWriter,
    ) -> std::io::Result<()> {
        if !self.filter(record) {
            return Ok(());
        }
        writer.write(now, record)
    }
}
