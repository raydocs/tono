use std::{sync::Mutex, time::Duration};

use tauri::plugin::Plugin;
use tono_plugin_core::{Mihomo, MihomoContext, models::Protocol};

#[test]
fn websocket_disconnect_accepts_the_full_decimal_handle_through_tauri() {
    let protocol = Protocol::Http;
    let context = MihomoContext::new(
        protocol.clone(),
        Some("127.0.0.1".into()),
        Some(9090),
        None,
        None,
        Duration::from_secs(5),
        MihomoContext::build_client(&protocol, None).unwrap(),
    );
    let handler = Mutex::new(tono_plugin_core::Builder::new().build::<tauri::test::MockRuntime>());
    let app = tauri::test::mock_builder()
        .manage(Mihomo::new(context))
        .invoke_handler(move |invoke| handler.lock().unwrap().extend_api(invoke))
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let id = u128::MAX.to_string();
    let result = tauri::test::get_ipc_response(
        &webview,
        tauri::webview::InvokeRequest {
            cmd: "ws_disconnect".into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: if cfg!(windows) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body: tauri::ipc::InvokeBody::Json(serde_json::json!({"id": id, "forceTimeout": 1})),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.into(),
        },
    );

    // Reaching this error proves that the real command decoded the handle and
    // passed every digit to Mihomo; the old u128 argument failed in Tauri first.
    assert_eq!(
        result.unwrap_err(),
        serde_json::json!(format!("Connection not found for the given id: {id}"))
    );
}
