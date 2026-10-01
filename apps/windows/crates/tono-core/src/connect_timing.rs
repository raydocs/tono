//! Stable connect-stage keys shared with macOS `ConnectionStage.wireKey`
//! and the existing telemetry `stage` field.
//!
//! Durations already ride the audit `stage` event (`elapsed_ms`) and the
//! macOS `previous_stage_duration_ms` detail. Field comparison with Clash is
//! a separate harness; this module only names the stages.

use crate::connection::ConnectStage;

/// Wire keys, in [`ConnectStage::ALL`] order. Do not rename them.
pub const WIRE_KEYS: [&str; 9] = [
    "preparing",
    "preparingService",
    "startingKillSwitch",
    "startingTunnel",
    "lockingTraffic",
    "applyingCloudPolicy",
    "securingDNS",
    "checkingExit",
    "verifyingTraffic",
];

pub fn wire_key(stage: ConnectStage) -> &'static str {
    match stage {
        ConnectStage::Preparing => WIRE_KEYS[0],
        ConnectStage::PreparingService => WIRE_KEYS[1],
        ConnectStage::StartingKillSwitch => WIRE_KEYS[2],
        ConnectStage::StartingTunnel => WIRE_KEYS[3],
        ConnectStage::LockingTraffic => WIRE_KEYS[4],
        ConnectStage::ApplyingCloudPolicy => WIRE_KEYS[5],
        ConnectStage::SecuringDns => WIRE_KEYS[6],
        ConnectStage::CheckingExit => WIRE_KEYS[7],
        ConnectStage::VerifyingTraffic => WIRE_KEYS[8],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_keys_follow_connect_stage_order() {
        let keys: Vec<&str> = ConnectStage::ALL.iter().copied().map(wire_key).collect();
        assert_eq!(keys, WIRE_KEYS);
    }
}
