//! Bounded, address/credential-free observations. Never an admission verdict.
//! Freeze before cleanup; late completions cannot rewrite a failed attempt's history.

use tono_service_protocol::{DnsProtectionStatus, KillSwitchStatus, ProtectionProof, ServiceStatusSnapshot};

use super::route_diagnostics::RouteObservation;

#[derive(Clone, Debug)]
struct Observed<T> {
    at_ms: i64,
    source: &'static str,
    value: T,
}

#[derive(Clone, Debug)]
struct CoreEvidence {
    pid: Option<u32>,
    generation: u32,
    session: Option<u64>,
    tunnel_luid: Option<u64>,
}

#[derive(Clone, Debug)]
struct WfpEvidence {
    mode: tono_service_protocol::KillSwitchStatusMode,
    wanted: bool,
    live: bool,
    verified: bool,
    tunnel_permit: bool,
}

#[derive(Clone, Debug)]
struct DnsEvidence {
    enabled: bool,
    adapters: u32,
    has_error: bool,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct AttemptEvidence {
    generation: u64,
    closed: bool,
    core: Option<Observed<CoreEvidence>>,
    wfp: Option<Observed<WfpEvidence>>,
    dns: Option<Observed<DnsEvidence>>,
    routes: Option<Observed<RouteObservation>>,
}

#[derive(Clone, Debug)]
pub(crate) struct FailureEvidence {
    captured_at_ms: i64,
    stage: Option<&'static str>,
    committed: bool,
    observations: AttemptEvidence,
    handler_wfp: Option<Observed<WfpEvidence>>,
}

impl AttemptEvidence {
    pub(crate) fn begin(generation: u64) -> Self {
        Self {
            generation,
            ..Self::default()
        }
    }

    fn accepts(&self, generation: u64) -> bool {
        !self.closed && self.generation == generation
    }

    pub(crate) fn service(&mut self, generation: u64, at_ms: i64, snapshot: &ServiceStatusSnapshot) {
        if !self.accepts(generation) {
            return;
        }
        self.core = Some(Observed {
            at_ms,
            source: "serviceReported",
            value: CoreEvidence {
                pid: snapshot.core_pid,
                generation: snapshot.core_generation,
                session: snapshot.active_generation,
                tunnel_luid: None,
            },
        });
        if let Some(status) = &snapshot.kill_switch {
            self.wfp(generation, at_ms, "serviceReported", status);
        }
    }

    pub(crate) fn wfp(&mut self, generation: u64, at_ms: i64, source: &'static str, status: &KillSwitchStatus) {
        if !self.accepts(generation) {
            return;
        }
        self.wfp = Some(Observed {
            at_ms,
            source,
            value: WfpEvidence {
                mode: status.mode,
                wanted: status.wanted,
                live: status.live,
                verified: status.verified,
                tunnel_permit: status.tunnel_permit_rendered,
            },
        });
    }

    pub(crate) fn dns(&mut self, generation: u64, at_ms: i64, status: &DnsProtectionStatus) {
        if !self.accepts(generation) {
            return;
        }
        self.dns = Some(Observed {
            at_ms,
            source: "nativeApplyReply",
            value: DnsEvidence {
                enabled: status.enabled,
                adapters: status.adapters,
                has_error: status.last_error.is_some(),
            },
        });
    }

    pub(crate) fn proof(&mut self, generation: u64, at_ms: i64, proof: &ProtectionProof) {
        if !self.accepts(generation) {
            return;
        }
        self.core = Some(Observed {
            at_ms,
            source: "freshCommit",
            value: CoreEvidence {
                pid: Some(proof.core_pid),
                generation: proof.core_generation,
                session: Some(proof.session_generation),
                tunnel_luid: Some(proof.tunnel_luid),
            },
        });
        self.wfp(generation, at_ms, "freshCommit", &proof.kill_switch);
    }

    pub(crate) fn routes(&mut self, generation: u64, at_ms: i64, routes: RouteObservation) {
        if self.accepts(generation) {
            self.routes = Some(Observed {
                at_ms,
                source: "localDiagnosticOnly",
                value: routes,
            });
        }
    }

    pub(crate) fn freeze(
        &mut self,
        at_ms: i64,
        stage: Option<&'static str>,
        committed: bool,
        failure_wfp: Option<&KillSwitchStatus>,
    ) -> FailureEvidence {
        // Only already-owned observations belong here: never perform I/O before freezing.
        // The failure handler's later read is recorded separately, not retroactively substituted.
        if let Some(status) = failure_wfp {
            self.wfp(self.generation, at_ms, "serviceReportedBeforeCleanup", status);
        }
        self.closed = true;
        FailureEvidence {
            captured_at_ms: at_ms,
            stage,
            committed,
            observations: self.clone(),
            handler_wfp: None,
        }
    }
}

impl FailureEvidence {
    pub(crate) fn note_handler_wfp(&mut self, at_ms: i64, status: &KillSwitchStatus) {
        // Never overwrite failure-time history with a status read made later. In particular,
        // timeout retirement may already have triggered detached late-mutation compensation.
        self.handler_wfp = Some(Observed {
            at_ms,
            source: "laterServiceReported",
            value: WfpEvidence {
                mode: status.mode,
                wanted: status.wanted,
                live: status.live,
                verified: status.verified,
                tunnel_permit: status.tunnel_permit_rendered,
            },
        });
    }

    pub(crate) fn render(&self) -> String {
        let evidence = &self.observations;
        let mut lines = vec![format!(
            "Failure evidence before cleanup (last observations, NOT packet proof): attempt={} capturedAtMs: {} stage={} committed={}",
            evidence.generation,
            self.captured_at_ms,
            self.stage.unwrap_or("unknown"),
            self.committed,
        )];
        if let Some(observation) = &evidence.core {
            let v = &observation.value;
            lines.push(format!(
                "Core [{}@{}]: pid={:?} generation={} session={:?} provedTunLuid={:?}",
                observation.source, observation.at_ms, v.pid, v.generation, v.session, v.tunnel_luid
            ));
        } else {
            lines.push("Core: not observed".into());
        }
        if let Some(observation) = &evidence.wfp {
            let v = &observation.value;
            lines.push(format!(
                "WFP [{}@{}]: mode={:?} wanted={} live={} verified={} tunnelPermit={}",
                observation.source, observation.at_ms, v.mode, v.wanted, v.live, v.verified, v.tunnel_permit
            ));
        } else {
            lines.push("WFP: not observed".into());
        }
        if let Some(observation) = &evidence.dns {
            let v = &observation.value;
            lines.push(format!(
                "DNS [{}@{}]: enabled={} adapters={} hasError={}",
                observation.source, observation.at_ms, v.enabled, v.adapters, v.has_error
            ));
        } else {
            lines.push("DNS: not observed".into());
        }
        if let Some(observation) = &evidence.routes {
            lines.push(format!(
                "Routes [{}@{}]: {}",
                observation.source,
                observation.at_ms,
                observation.value.render()
            ));
        } else {
            lines.push("Routes: not observed (not a route failure)".into());
        }
        if let Some(observation) = &self.handler_wfp {
            let v = &observation.value;
            lines.push(format!(
                "Handler WFP [{}@{}] (may follow asynchronous cleanup): mode={:?} wanted={} live={} verified={} tunnelPermit={}",
                observation.source, observation.at_ms, v.mode, v.wanted, v.live, v.verified, v.tunnel_permit,
            ));
        }
        lines.push("The report's current protection/DNS/adapter fields were collected later.".into());
        lines.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn freeze_survives_cleanup_and_refuses_late_or_other_generation_results() {
        let mut evidence = AttemptEvidence::begin(7);
        let dns = DnsProtectionStatus {
            enabled: true,
            adapters: 2,
            ..Default::default()
        };
        evidence.dns(6, 1, &dns);
        assert!(evidence.dns.is_none());
        evidence.dns(7, 2, &dns);
        let frozen = evidence.freeze(3, Some("securingDNS"), false, None);
        let before = frozen.render();
        evidence.dns(7, 4, &DnsProtectionStatus::default());
        assert_eq!(frozen.render(), before);
        assert!(before.contains("nativeApplyReply@2"));
        assert!(before.contains("enabled=true"));
        assert!(before.contains("Core: not observed"));
        assert!(evidence.dns.as_ref().unwrap().value.enabled);
        assert!(AttemptEvidence::begin(8).dns.is_none());
    }

    #[test]
    fn evidence_never_copies_free_text_or_endpoint_material() {
        let mut evidence = AttemptEvidence::begin(1);
        evidence.dns(
            1,
            0,
            &DnsProtectionStatus {
                last_error: Some("private credential and endpoint material".into()),
                ..Default::default()
            },
        );
        let text = evidence.freeze(0, None, false, None).render();
        assert!(text.contains("hasError=true"));
        assert!(!text.contains("private credential"));
        assert!(text.len() < 1400);
    }

    #[test]
    fn later_handler_read_cannot_replace_observations_frozen_before_timeout_cleanup() {
        use tono_service_protocol::KillSwitchStatusMode;
        let mut evidence = AttemptEvidence::begin(7);
        let mut status = KillSwitchStatus {
            wanted: true,
            live: true,
            verified: false,
            mode: KillSwitchStatusMode::Locked,
            endpoints: Vec::new(),
            tunnel_permit_rendered: true,
            direct_endpoint_digest: String::new(),
            last_error: None,
        };
        evidence.wfp(7, 1, "serviceReported", &status);
        let mut frozen = evidence.freeze(2, Some("securingDNS"), false, None);
        status.wanted = false;
        status.live = false;
        status.mode = KillSwitchStatusMode::Blocked;
        status.tunnel_permit_rendered = false;
        status.last_error = Some("not safe to copy raw material".into());
        frozen.note_handler_wfp(3, &status);
        let text = frozen.render();
        assert!(text.contains("capturedAtMs: 2"));
        assert!(text.contains("WFP [serviceReported@1]: mode=Locked wanted=true live=true"));
        assert!(text.contains("Handler WFP [laterServiceReported@3]"));
        assert!(text.contains("mode=Blocked wanted=false live=false"));
        assert!(!text.contains("not safe to copy"));
    }

    #[test]
    fn route_answers_after_freeze_cannot_rewrite_failure_or_authorize_a_connection() {
        use super::super::route_diagnostics::RouteClass;
        let mut evidence = AttemptEvidence::begin(7);
        let observation = RouteObservation {
            tunnel_luid: Some(9),
            fake_ip_sample: RouteClass::Physical,
            selected_vps: RouteClass::OtherInterface,
            tunnel_error: None,
            fake_ip_error: None,
            vps_error: None,
            unavailable: None,
        };
        evidence.routes(6, 0, observation.clone());
        assert!(evidence.routes.is_none());
        evidence.routes(7, 1, observation.clone());
        let frozen = evidence.freeze(2, None, false, None);
        let before = frozen.render();
        evidence.routes(
            7,
            3,
            RouteObservation {
                fake_ip_sample: RouteClass::TonoTunnel,
                ..observation
            },
        );
        assert_eq!(frozen.render(), before);
        assert!(before.contains("localDiagnosticOnly@1"));
        assert!(before.contains("fakeIpSample=Physical"));
    }
}
