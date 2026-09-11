use super::*;
use crate::core::wfp_model::{
    Condition, FilterAction, FilterSpec, IpProtocol, LayerKind, WEIGHT_HARD_PERMIT,
};

/// Explicit READ-ONLY qualification, separate from the permit-writing fixture below. All
/// enumerators share one native read transaction; neither this test nor its opt-in writes WFP.
#[test]
fn all_layer_provider_enumeration_matches_the_full_engine_snapshot() {
    if std::env::var("TONO_REQUIRE_WFP_READONLY").as_deref() != Ok("1") {
        eprintln!("skipping native read-only enumeration qualification: not requested");
        return;
    }
    let engine = Engine::open().expect("read-only WFP qualification requires a live BFE");
    read_transaction(&engine, |engine| {
        let scoped = enumerate_our_filters_in_transaction(engine)?;
        let all = enumerate_filter_template(engine, None, &mut EnumBudget::new("reference"))?;
        let normalize = |filters: Vec<InstalledFilter>| {
            let mut rows = filters.into_iter().map(|f| {
                (f.key.into_u128(), f.sublayer.into_u128(), f.disabled)
            }).collect::<Vec<_>>();
            rows.sort_unstable();
            rows
        };
        assert!(normalize(scoped) == normalize(all), "native provider filter sets differ");
        Ok(())
    }).expect("every Tono filter and its usability metadata must match");
}

/// `None` when this machine cannot answer the question.
fn engine_or_skip() -> Option<Engine> {
    // Native qualification writes a real permit. Ordinary unit tests (including unattended
    // remote checks) must never change machine policy merely because the shell is elevated.
    if std::env::var("TONO_REQUIRE_REAL_WFP").as_deref() != Ok("1") {
        eprintln!("skipping real-engine test: explicit native WFP qualification was not requested");
        return None;
    }
    match Engine::open() {
        Ok(engine) => Some(engine),
        Err(error) => {
            assert!(
                std::env::var("TONO_REQUIRE_REAL_WFP").as_deref() != Ok("1"),
                "real WFP qualification was required but the engine is unavailable: {error:#}"
            );
            eprintln!("skipping real-engine test: {error:#}");
            None
        }
    }
}

/// A permit, never a block: an accidental block-all on a CI runner would cut the network
/// the job needs to report its own result.
fn multi_prefix_permit() -> FilterSpec {
    let prefixes = crate::core::wfp_model::public_unicast_v4_prefixes();
    assert!(
        prefixes.len() > 8,
        "the point of this test is a filter with many same-field conditions"
    );
    let mut conditions = vec![
        Condition::Protocol(IpProtocol::Tcp),
        Condition::RemotePort(443),
    ];
    conditions.extend(
        prefixes
            .into_iter()
            .map(|(addr, prefix)| Condition::RemoteAddressV4 { addr, prefix }),
    );
    FilterSpec {
        key: crate::core::wfp_model::key_for("tono/self-test/multi-prefix-permit"),
        name: "tono self-test multi-prefix permit".to_owned(),
        layer: LayerKind::AleAuthConnectV4,
        weight: WEIGHT_HARD_PERMIT,
        action: FilterAction::Permit,
        conditions,
        hard_permit: false,
        persistent: false,
    }
}

/// The kernel must accept a filter carrying many conditions on the same field.
///
/// This is the shape rule H uses. It does not prove the OR semantics — that needs traffic,
/// and arming a fail-closed switch on a runner would take the runner's own network with it
/// — but it does prove the filter loads, which is the failure that would break arming for
/// everybody rather than merely leave WeChat as slow as it is today.
#[test]
fn the_kernel_accepts_a_filter_with_many_same_field_conditions() {
    let Some(engine) = engine_or_skip() else {
        return;
    };
    let spec = multi_prefix_permit();
    let condition_count = spec.conditions.len();
    // This opt-in fixture tests only filter loading, not protection/adoption. Do not migrate
    // an existing product provider or replace its active policy as part of a permit fixture.
    transaction(&engine, |engine| {
        add_provider(engine)?;
        add_sublayer(engine)
    }).expect("provider and sublayer");

    let result = add_filter(&engine, &spec, std::ptr::null_mut());
    // Always clean up, whatever the outcome: a leftover permit on a developer machine is a
    // real if harmless change to their firewall.
    let removed = delete_filter_if_exists(&engine, spec.key);
    result.unwrap_or_else(|error| {
        panic!("the kernel refused a {condition_count}-condition filter: {error:#}")
    });
    removed.expect("the self-test filter must be removable");
}
