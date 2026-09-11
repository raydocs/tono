use super::{Guid, require_exact_filter_keys};

#[test]
fn exact_filter_verification_rejects_a_stale_direct_key() {
    let floor = Guid::from_u128(1);
    let locked = Guid::from_u128(2);
    let stale_direct = Guid::from_u128(3);

    require_exact_filter_keys(&[locked, floor], &[floor, locked]).unwrap();
    let error = require_exact_filter_keys(&[floor, locked, stale_direct], &[floor, locked])
        .expect_err("a stale DIRECT permit must make the live proof fail");
    assert!(error.to_string().contains("1 unexpected"));
}

#[test]
fn provider_template_includes_disabled_boot_time_and_every_action() {
    use super::*;
    let mut provider = to_sys(TONO_WFP_PROVIDER_KEY);
    // Deliberately not one of today's three model layers: callers pass the live layer catalog.
    let legacy_layer = to_sys(Guid::from_u128(42));
    let template = provider_filter_template(&mut provider, legacy_layer);
    assert_eq!(template.providerKey, std::ptr::addr_of_mut!(provider));
    assert_eq!(from_sys(template.layerKey), Guid::from_u128(42));
    assert_eq!(template.enumType, FWP_FILTER_ENUM_OVERLAPPING);
    assert_eq!(template.flags,
        FWP_FILTER_ENUM_FLAG_INCLUDE_DISABLED | FWP_FILTER_ENUM_FLAG_INCLUDE_BOOTTIME);
    assert_eq!(template.actionMask, u32::MAX);
    assert_eq!(template.numFilterConditions, 0);
    assert!(template.filterCondition.is_null());
    assert!(template.providerContextTemplate.is_null());
    assert!(template.calloutKey.is_null());
}

#[test]
fn incomplete_enum_pages_cannot_be_treated_as_an_empty_policy() {
    use super::validate_enum_page;
    assert!(validate_enum_page(true, 0, 128).is_ok());
    assert!(validate_enum_page(false, 0, 128).is_ok());
    assert!(validate_enum_page(false, 128, 128).is_ok());
    assert!(validate_enum_page(true, 1, 128).is_err());
    assert!(validate_enum_page(false, 129, 128).is_err());
}

#[test]
fn empty_layers_do_not_reset_or_escape_the_shared_enum_budget() {
    use super::{EnumBudget, ENUM_DEADLINE, ENUM_MAX_ENTRIES};
    let mut budget = EnumBudget::new("unit test");
    budget.charge(99).unwrap();
    for _ in 0..99 { budget.charge(0).unwrap(); }
    assert_eq!(budget.seen, 99);
    budget.seen = ENUM_MAX_ENTRIES;
    assert!(budget.charge(1).is_err());
    let mut budget = EnumBudget::new("unit test");
    budget.started_at = std::time::Instant::now() - ENUM_DEADLINE;
    assert!(budget.charge(0).is_err());
}
