#[path = "../build_support/connection_fingerprint.rs"]
mod connection_fingerprint;

fn main() -> std::io::Result<()> {
    connection_fingerprint::emit(
        "TONO_SERVICE_CONNECTION_SOURCE",
        &[
            "build.rs",
            "../build_support/connection_fingerprint.rs",
            "src/lib.rs",
            "src/client/mod.rs",
            "src/client/windows_identity.rs",
            "src/core/mod.rs",
            "src/core/status.rs",
            "src/core/operation.rs",
            "src/core/structure.rs",
            "src/core/auth.rs",
            "src/core/desired.rs",
            "src/core/reconcile.rs",
            "src/core/manager.rs",
            "src/core/local_timing.rs",
            "src/core/server/mod.rs",
            "src/core/server/handlers.rs",
            "src/core/readiness.rs",
            "src/core/windows_kill_switch.rs",
            "src/core/wfp/mod.rs",
            "src/core/wfp_model.rs",
            "src/core/dns/mod.rs",
            "src/core/dns/engine.rs",
            "src/core/runtime_generation/assets.rs",
            "src/core/runtime_generation/staging.rs",
            "src/core/runtime_generation/core_integrity.rs",
        ],
    )
}
