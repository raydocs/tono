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
