#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChannelIdentity {
    pub id: &'static str,
    pub service_slug: &'static str,
    pub windows_service_name: &'static str,
    pub windows_state_dir: &'static str,
    pub service_display_name: &'static str,
    pub macos_app_bundle_id: &'static str,
    pub macos_service_id: &'static str,
}

#[cfg(not(feature = "development-channel"))]
pub const CHANNEL_IDENTITY: ChannelIdentity = ChannelIdentity {
    id: "production",
    service_slug: "tono-service",
    windows_service_name: "TonoService",
    windows_state_dir: "Tono",
    service_display_name: "Tono Service",
    macos_app_bundle_id: "com.raydocs.tono",
    macos_service_id: "com.raydocs.tono.service",
};

#[cfg(feature = "development-channel")]
pub const CHANNEL_IDENTITY: ChannelIdentity = ChannelIdentity {
    id: "development",
    service_slug: "tono-service-dev",
    windows_service_name: "TonoServiceDev",
    windows_state_dir: "Tono-dev",
    service_display_name: "Tono Service Dev",
    macos_app_bundle_id: "com.raydocs.tono.dev",
    macos_service_id: "com.raydocs.tono.dev.service",
};

pub const SERVICE_SLUG: &str = CHANNEL_IDENTITY.service_slug;
pub const WINDOWS_SERVICE_NAME: &str = CHANNEL_IDENTITY.windows_service_name;
pub const WINDOWS_STATE_DIR_NAME: &str = CHANNEL_IDENTITY.windows_state_dir;
pub const SERVICE_DISPLAY_NAME: &str = CHANNEL_IDENTITY.service_display_name;
pub const MACOS_APP_BUNDLE_ID: &str = CHANNEL_IDENTITY.macos_app_bundle_id;
pub const MACOS_SERVICE_ID: &str = CHANNEL_IDENTITY.macos_service_id;
/// Prior Tono and Clash Verge launchd identities. Install/uninstall still
/// boot these out so an identity rename cannot leave a second privileged helper.
pub const LEGACY_MACOS_SERVICE_IDS: &[&str] = &[
    "io.github.clash-verge-rev.clash-verge-rev.service",
    "io.github.clash-verge-rev.clash-verge-rev.dev.service",
    "io.github.clashverge.helper",
];

#[cfg(test)]
mod tests {
    use super::CHANNEL_IDENTITY;

    #[test]
    fn compiled_channel_has_a_self_consistent_identity() {
        assert!(!CHANNEL_IDENTITY.id.is_empty());
        assert!(
            CHANNEL_IDENTITY
                .service_slug
                .starts_with("tono-service")
        );
        assert!(
            CHANNEL_IDENTITY
                .windows_service_name
                .starts_with("TonoService")
        );
        assert!(CHANNEL_IDENTITY.windows_state_dir.starts_with("Tono"));
        assert!(
            CHANNEL_IDENTITY
                .macos_service_id
                .starts_with(CHANNEL_IDENTITY.macos_app_bundle_id)
        );
        assert!(CHANNEL_IDENTITY.macos_app_bundle_id.starts_with("com.raydocs.tono"));
        assert!(!CHANNEL_IDENTITY.macos_service_id.contains("clash-verge"));
    }
}
