//! The exit region rule is written five times: here twice (`heal::region_key` for failover,
//! `unarmed_probe::region_of` for unarmed recovery), Windows `catalog_sync::region_rank`, the
//! Windows UI `nodeRegion` and macOS `ExitHeal.regionKey`. All five read this fixture, so a
//! city or token added on one side only fails a test instead of sending recovery to another
//! region than the one the UI groups the node in.
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    fixture_version: u32,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Case {
    name: String,
    region: String,
}

#[test]
fn failover_and_unarmed_recovery_classify_exits_like_every_other_client() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../tooling/scripts/tests/fixtures/exit-region-v1/cases.json");
    let fixture: Fixture = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(fixture.fixture_version, 1);
    for case in &fixture.cases {
        assert_eq!(tono_core::heal::region_key(&case.name), case.region, "heal: {:?}", case.name);
        assert_eq!(tono_core::unarmed_probe::region_of(&case.name), case.region, "unarmed: {:?}", case.name);
    }
}
