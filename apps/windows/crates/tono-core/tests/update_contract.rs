use serde::Deserialize;
use tono_core::update_contract::*;

fn fixture(name: &str) -> String {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../tooling/scripts/tests/fixtures/update-protocol-v1");
    std::fs::read_to_string(root.join(name)).unwrap()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixtures {
    fixture_version: u32,
    manifest_sha256: String,
    rejected_documents: Vec<RejectedDocument>,
    replays: Vec<Replay>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RejectedDocument {
    name: String,
    document: String,
    find: String,
    replace: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Replay {
    name: String,
    receipt: String,
    steps: Vec<Step>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Step {
    name: String,
    event: String,
    generation: u64,
    now_unix: u64,
    owner: Option<String>,
    attempt_id: Option<String>,
    installed_location_sha256: Option<String>,
    target_id: Option<TargetId>,
    protection: Option<Protection>,
    artifact_sha256: Option<String>,
    wrong_privileged_component: Option<bool>,
    error: Option<String>,
    phase: Option<Phase>,
    successor_generation: Option<u64>,
    blocked_reason: Option<BlockReason>,
}

// One shared conformance replay, not a second implementation of the guard. The
// same static wire bytes and asymmetric refusal/success steps run in XCTest.
#[test]
fn shared_wire_and_ownership_contract() {
    let fixtures: Fixtures = serde_json::from_str(&fixture("conformance.json")).unwrap();
    assert_eq!(fixtures.fixture_version, 1);
    assert_eq!(
        fixtures.rejected_documents.len(),
        13,
        "missing parser cases"
    );
    assert_eq!(fixtures.replays.len(), 4, "missing owner replays");
    assert_eq!(
        fixtures
            .replays
            .iter()
            .map(|r| r.steps.len())
            .sum::<usize>(),
        33
    );
    let bytes = fixture("manifest.json");
    let manifest = ReleaseManifest::decode(bytes.as_bytes()).unwrap();
    assert_eq!(canonical(&manifest).unwrap(), bytes.as_bytes());
    assert_eq!(manifest.sha256().unwrap(), fixtures.manifest_sha256);
    assert_eq!(
        ReleaseManifest::decode(&vec![b' '; 16_385]),
        Err(ContractError::Document)
    );
    for case in fixtures.rejected_documents {
        let input = fixture(&case.document);
        assert!(
            input.contains(&case.find),
            "ineffective mutation: {}",
            case.name
        );
        let changed = input.replace(&case.find, &case.replace);
        let error = if case.document == "manifest.json" {
            ReleaseManifest::decode(changed.as_bytes()).unwrap_err()
        } else {
            Receipt::decode(changed.as_bytes(), &manifest).unwrap_err()
        };
        assert_eq!(error, ContractError::Document, "{}", case.name);
    }
    for replay in fixtures.replays {
        let bytes = fixture(&replay.receipt);
        let mut receipt = Receipt::decode(bytes.as_bytes(), &manifest).unwrap();
        assert_eq!(canonical(&receipt).unwrap(), bytes.as_bytes());
        let target = manifest
            .targets
            .iter()
            .find(|t| t.id == receipt.target_id)
            .unwrap();
        for step in replay.steps {
            let before = canonical(&receipt).unwrap();
            let mut components = target.components.clone();
            if step.wrong_privileged_component == Some(true) {
                components.privileged_sha256 = "0".repeat(64);
            }
            let observation = match step.event.as_str() {
                "prepare" => Observation::PreparationVerified {
                    artifact_sha256: step
                        .artifact_sha256
                        .unwrap_or_else(|| target.artifact_sha256.clone()),
                    protection: step.protection.unwrap(),
                },
                "installed" => Observation::InstalledIdentityVerified { components },
                "recover" => Observation::RecoveryVerified {
                    components,
                    protection: step.protection.unwrap(),
                },
                "commit" => Observation::CommitVerified {
                    components,
                    protection: step.protection.unwrap(),
                },
                "continuation" => Observation::ApplicationContinuationRequested,
                "block" => Observation::Block(step.blocked_reason.unwrap()),
                other => panic!("unknown fixture event {other}"),
            };
            let context = Context {
                attempt_id: step.attempt_id.as_deref().unwrap_or(&receipt.attempt_id),
                owner: step.owner.as_deref().unwrap_or(&receipt.owner),
                installed_location_sha256: step
                    .installed_location_sha256
                    .as_deref()
                    .unwrap_or(&receipt.installed_location_sha256),
                target_id: step.target_id.unwrap_or(receipt.target_id),
                generation: step.generation,
                now_unix: step.now_unix,
            };
            let result = receipt.propose(&manifest, &context, observation);
            assert_eq!(
                canonical(&receipt).unwrap(),
                before,
                "a proposal must not mutate the original"
            );
            let label = format!("{} / {}", replay.name, step.name);
            if let Some(error) = step.error {
                assert!(step.phase.is_none(), "ambiguous expectation: {label}");
                assert_eq!(
                    format!("{:?}", result.unwrap_err()).to_lowercase(),
                    error,
                    "{label}"
                );
            } else {
                let next = result.unwrap_or_else(|e| panic!("{label}: {e}"));
                assert_eq!(Some(next.phase), step.phase, "{label}");
                assert_eq!(
                    next.successor_generation, step.successor_generation,
                    "{label}"
                );
                assert_eq!(next.blocked_reason, step.blocked_reason, "{label}");
                assert_eq!(next.updated_at_unix, step.now_unix, "{label}");
                // Serialized restart of the pure model. This is not durable
                // storage/replay protection or a real process crash.
                receipt = Receipt::decode(&canonical(&next).unwrap(), &manifest).unwrap();
            }
        }
    }
}
