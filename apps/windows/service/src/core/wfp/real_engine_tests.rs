use super::*;
use crate::core::wfp_model::{
    Condition, FilterAction, FilterSpec, IpProtocol, LayerKind, WEIGHT_HARD_PERMIT,
};

/// `None` when this machine cannot answer the question.
fn engine_or_skip() -> Option<Engine> {
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
    ensure_provider_and_sublayer(&engine).expect("provider and sublayer");

    let result = add_filter(&engine, &spec, std::ptr::null_mut());
    // Always clean up, whatever the outcome: a leftover permit on a developer machine is a
    // real if harmless change to their firewall.
    let removed = delete_filter_if_exists(&engine, spec.key);
    result.unwrap_or_else(|error| {
        panic!("the kernel refused a {condition_count}-condition filter: {error:#}")
    });
    removed.expect("the self-test filter must be removable");
}
