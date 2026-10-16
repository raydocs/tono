use super::*;

/// What the release worker reads back about DNS (PROPOSAL §10 v5). Read-only.
pub(crate) struct ReleaseDnsReadback {
    /// Whether any adapter Tono manages still resolves through a Tono DNS target.
    pub(crate) adapters_on_tono: Result<bool>,
    /// Whether Tono's NRPT catch-all is still in the store the DNS Client applies.
    pub(crate) tono_rule_effective: std::result::Result<bool, String>,
}

pub(crate) async fn release_readback() -> ReleaseDnsReadback {
    let adapters_on_tono = match collect_dns_adapters().await {
        Ok(adapters) => engine_any_loopback(&adapters).await,
        Err(error) => Err(error),
    };
    let tono_rule_effective = engine::effective_nrpt_rules()
        .await
        .map(|rules| rules.iter().any(|rule| rule.tono_owned));
    ReleaseDnsReadback {
        adapters_on_tono,
        tono_rule_effective,
    }
}
