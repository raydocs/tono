use crate::core::handle;
use crate::process::AsyncHandler;
use crate::tono::state::{TonoInner, TonoState};
use crate::utils::connections_stream;
#[cfg(target_os = "windows")]
use crate::utils::speed::format_bytes_per_second;
#[cfg(target_os = "macos")]
use crate::utils::tray_speed;
use crate::{Type, logging};
use parking_lot::Mutex;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;
use tauri::Manager as _;
use tauri::async_runtime::JoinHandle;
use tono_plugin_core::models::WsConnectionId;

/// 托盘速率流异常后的重连间隔。
const TRAY_SPEED_RETRY_DELAY: Duration = Duration::from_secs(1);
/// 托盘速率流运行时的空闲轮询间隔。
const TRAY_SPEED_IDLE_POLL_INTERVAL: Duration = Duration::from_millis(200);
/// 托盘速率流在此时间内收不到有效数据时，触发重连并降级到 0/0。
const TRAY_SPEED_STALE_TIMEOUT: Duration = Duration::from_secs(5);
/// How often an idle speed task looks for a published controller. Reading the product state
/// costs no I/O and writes no log line, unlike a connect attempt.
const TRAY_SPEED_CONTROLLER_POLL: Duration = Duration::from_secs(1);

/// Only a connected session publishes an owned Core controller to the plugin; the plugin's
/// startup named-pipe context is never served. Without one, every `/traffic` attempt fails.
fn owns_published_controller(inner: &TonoInner) -> bool {
    inner.fsm.status().is_connected && inner.controller_secret.is_some()
}

async fn controller_published() -> bool {
    let Some(state) = handle::Handle::app_handle().try_state::<Arc<TonoState>>() else {
        return false;
    };
    owns_published_controller(&*state.lock().await)
}

/// Wait for a published controller, then make one connect attempt. `None` means `should_stop`
/// ended the wait. With no Core the task polls the product state rather than retrying the
/// socket every second, which wrote a connect log line per attempt (H18-O-F2).
async fn connect_when_published<T, Published, PublishedFut, Connect, ConnectFut>(
    mut published: Published,
    connect: Connect,
    should_stop: impl Fn() -> bool,
) -> Option<T>
where
    Published: FnMut() -> PublishedFut,
    PublishedFut: Future<Output = bool>,
    Connect: FnOnce() -> ConnectFut,
    ConnectFut: Future<Output = T>,
{
    loop {
        if should_stop() {
            return None;
        }
        if published().await {
            return Some(connect().await);
        }
        tokio::time::sleep(TRAY_SPEED_CONTROLLER_POLL).await;
    }
}

/// macOS 托盘速率任务控制器。
#[derive(Clone)]
pub struct TraySpeedController {
    speed_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    speed_connection_id: Arc<Mutex<Option<WsConnectionId>>>,
}

impl Default for TraySpeedController {
    fn default() -> Self {
        Self {
            speed_task: Arc::new(Mutex::new(None)),
            speed_connection_id: Arc::new(Mutex::new(None)),
        }
    }
}

impl TraySpeedController {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn update_task(&self, enable_tray_speed: bool) {
        if enable_tray_speed {
            self.start_task();
        } else {
            self.stop_task();
        }
    }

    /// 启动托盘速率采集后台任务（基于 `/traffic` WebSocket 流）。
    fn start_task(&self) {
        if handle::Handle::global().is_exiting() {
            return;
        }

        // 关键步骤：托盘不可用时不启动速率任务，避免无效连接重试。
        if !Self::has_main_tray() {
            logging!(warn, Type::Tray, "托盘不可用，跳过启动托盘速率任务");
            return;
        }

        let mut guard = self.speed_task.lock();
        if guard.as_ref().is_some_and(|task| !task.inner().is_finished()) {
            return;
        }

        let speed_connection_id = Arc::clone(&self.speed_connection_id);
        let task = AsyncHandler::spawn(move || async move {
            loop {
                if handle::Handle::global().is_exiting() {
                    break;
                }

                if !Self::has_main_tray() {
                    logging!(warn, Type::Tray, "托盘已不可用，停止托盘速率任务");
                    break;
                }

                let Some(stream_connect_result) = connect_when_published(
                    controller_published,
                    connections_stream::connect_traffic_stream,
                    || handle::Handle::global().is_exiting() || !Self::has_main_tray(),
                )
                .await
                else {
                    // The checks at the top of the loop end the task and say why.
                    continue;
                };
                let mut speed_stream = match stream_connect_result {
                    Ok(stream) => stream,
                    Err(err) => {
                        logging!(debug, Type::Tray, "托盘速率流连接失败，稍后重试: {err}");
                        Self::apply_tray_speed(0, 0);
                        tokio::time::sleep(TRAY_SPEED_RETRY_DELAY).await;
                        continue;
                    }
                };

                Self::set_speed_connection_id(&speed_connection_id, Some(speed_stream.connection_id));

                loop {
                    let next_state = speed_stream
                        .next_event(TRAY_SPEED_IDLE_POLL_INTERVAL, TRAY_SPEED_STALE_TIMEOUT, || {
                            handle::Handle::global().is_exiting()
                        })
                        .await;

                    match next_state {
                        connections_stream::StreamConsumeState::Event(speed_event) => {
                            Self::apply_tray_speed(speed_event.up, speed_event.down);
                        }
                        connections_stream::StreamConsumeState::Stale => {
                            logging!(debug, Type::Tray, "托盘速率流长时间未收到有效数据，触发重连");
                            Self::apply_tray_speed(0, 0);
                            break;
                        }
                        connections_stream::StreamConsumeState::Closed
                        | connections_stream::StreamConsumeState::ExitRequested => {
                            break;
                        }
                    }
                }

                Self::disconnect_speed_connection(&speed_connection_id).await;

                if handle::Handle::global().is_exiting() || !Self::has_main_tray() {
                    break;
                }

                // Stale 分支在内层 loop 中已重置为 0/0；此处兜底 Closed 分支（流被远端关闭）。
                Self::apply_tray_speed(0, 0);
                tokio::time::sleep(TRAY_SPEED_RETRY_DELAY).await;
            }

            Self::set_speed_connection_id(&speed_connection_id, None);
            super::Tray::global().forget_speed();
        });

        *guard = Some(task);
    }

    /// 停止托盘速率采集后台任务并清除速率显示。
    fn stop_task(&self) {
        // 取出任务句柄，与 speed_connection_id 一同传入清理任务。
        let task = self.speed_task.lock().take();
        let speed_connection_id = Arc::clone(&self.speed_connection_id);

        AsyncHandler::spawn(move || async move {
            // 关键步骤：先等待 abort 完成，再断开 WebSocket 连接。
            // 若直接 abort 后立即 disconnect，任务可能已通过 take 取走 connection_id
            // 但尚未完成断开，导致 connection_id 丢失、连接泄漏。
            // await task handle 可保证原任务已退出，connection_id 不再被占用。
            if let Some(task) = task {
                task.abort();
                let _ = task.await;
            }
            Self::disconnect_speed_connection(&speed_connection_id).await;
        });

        let app_handle = handle::Handle::app_handle();
        if let Some(tray) = app_handle.tray_by_id(super::TRAY_ID) {
            #[cfg(target_os = "macos")]
            {
                let result = tray.with_inner_tray_icon(|inner| {
                    if let Some(status_item) = inner.ns_status_item() {
                        tray_speed::clear_speed_attributed_title(&status_item);
                    }
                });
                if let Err(err) = result {
                    logging!(warn, Type::Tray, "清除富文本速率失败: {err}");
                }
            }
            #[cfg(target_os = "windows")]
            {
                super::Tray::global().show_speed(None, |text| Ok(tray.set_tooltip(Some(text))?));
            }
        }
    }

    fn has_main_tray() -> bool {
        handle::Handle::app_handle().tray_by_id(super::TRAY_ID).is_some()
    }

    fn set_speed_connection_id(
        speed_connection_id: &Arc<Mutex<Option<WsConnectionId>>>,
        connection_id: Option<WsConnectionId>,
    ) {
        *speed_connection_id.lock() = connection_id;
    }

    fn take_speed_connection_id(speed_connection_id: &Arc<Mutex<Option<WsConnectionId>>>) -> Option<WsConnectionId> {
        speed_connection_id.lock().take()
    }

    async fn disconnect_speed_connection(speed_connection_id: &Arc<Mutex<Option<WsConnectionId>>>) {
        if let Some(connection_id) = Self::take_speed_connection_id(speed_connection_id) {
            connections_stream::disconnect_connection(connection_id).await;
        }
    }

    fn apply_tray_speed(up: u64, down: u64) {
        let app_handle = handle::Handle::app_handle();
        if let Some(tray) = app_handle.tray_by_id(super::TRAY_ID) {
            #[cfg(target_os = "macos")]
            {
                let result = tray.with_inner_tray_icon(move |inner| {
                    if let Some(status_item) = inner.ns_status_item() {
                        tray_speed::set_speed_attributed_title(&status_item, up, down);
                    }
                });
                if let Err(err) = result {
                    logging!(warn, Type::Tray, "设置富文本速率失败: {err}");
                }
            }
            #[cfg(target_os = "windows")]
            {
                let speed = format!(
                    "↑ {}\n↓ {}",
                    format_bytes_per_second(up),
                    format_bytes_per_second(down)
                );
                // Added under the protection line, never in place of it.
                super::Tray::global().show_speed(Some(speed), |text| Ok(tray.set_tooltip(Some(text))?));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{TRAY_SPEED_CONTROLLER_POLL, connect_when_published, owns_published_controller};
    use crate::tono::state::TonoState;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    /// H18-O-F2: with no Core the old loop made one connect attempt, and wrote one INFO line,
    /// every second. The task must wait for a published controller instead, then start.
    #[tokio::test(start_paused = true)]
    async fn speed_stream_waits_for_a_published_controller_before_connecting() {
        let state = Arc::new(TonoState::for_test());
        let attempts = Arc::new(AtomicUsize::new(0));
        let task = tokio::spawn({
            let state = Arc::clone(&state);
            let attempts = Arc::clone(&attempts);
            async move {
                connect_when_published(
                    || {
                        let state = Arc::clone(&state);
                        async move { owns_published_controller(&*state.lock().await) }
                    },
                    move || async move { attempts.fetch_add(1, Ordering::SeqCst) + 1 },
                    || false,
                )
                .await
            }
        });

        tokio::time::sleep(Duration::from_secs(600)).await;
        assert_eq!(attempts.load(Ordering::SeqCst), 0, "no controller, no connect attempt");

        {
            let mut inner = state.lock().await;
            inner.fsm.begin_connect();
            inner.fsm.mark_kill_switch_armed();
            inner.fsm.mark_session_verified();
            inner.fsm.connect_succeeded().unwrap();
            inner.controller_secret = Some("published".into());
        }
        let started = tokio::time::timeout(TRAY_SPEED_CONTROLLER_POLL * 2, task)
            .await
            .expect("a published controller starts the stream within one poll")
            .unwrap();
        assert_eq!(started, Some(1));
    }
}
