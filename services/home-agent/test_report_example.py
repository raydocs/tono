from __future__ import annotations

import errno
import fcntl
import importlib.util
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).with_name("report_example.py")
SPEC = importlib.util.spec_from_file_location("tono_home_reporter", MODULE_PATH)
assert SPEC and SPEC.loader
reporter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(reporter)


class ReporterTests(unittest.TestCase):
    def test_api_origin_is_https_only_and_has_no_credentials_or_custom_port(self) -> None:
        for invalid in (
            "http://api.example.com",
            "https://user:password@api.example.com",
            "https://api.example.com:8443",
            "https://api.example.com:not-a-port",
            "https://api.example.com/prefix",
        ):
            with self.subTest(invalid=invalid), mock.patch.dict(
                os.environ, {"TONO_API_BASE_URL": invalid}, clear=False
            ):
                with self.assertRaises(RuntimeError):
                    reporter.api_base()

    def test_token_file_must_be_private_and_is_never_a_plist_value(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            token_path = Path(temporary) / "token"
            token = "test-home-agent-token-with-32-characters"
            token_path.write_text(token, encoding="utf-8")
            token_path.chmod(0o600)
            with mock.patch.dict(
                os.environ,
                {"HOME_AGENT_TOKEN_FILE": str(token_path)},
                clear=True,
            ):
                self.assertEqual(reporter.home_agent_token(), token)

            token_path.chmod(0o644)
            with mock.patch.dict(
                os.environ,
                {"HOME_AGENT_TOKEN_FILE": str(token_path)},
                clear=True,
            ):
                with self.assertRaisesRegex(RuntimeError, "mode 0600"):
                    reporter.home_agent_token()

    def test_state_is_atomic_private_and_rejects_symlinks(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary) / "private"
            path = parent / "state.json"
            state = {"totals": {"user-one": 12}, "pendingReports": []}
            reporter.save_state(path, state)
            self.assertEqual(
                reporter.load_state(path),
                {
                    **state,
                    "peerCounters": {},
                },
            )
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(parent.stat().st_mode), 0o700)

            target = parent / "target.json"
            path.replace(target)
            path.symlink_to(target)
            with self.assertRaises(OSError):
                reporter.load_state(path)

    def test_an_overlapping_main_run_is_refused_before_observing_counters(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "private" / "state.json"
            reporter.ensure_private_parent(path.parent)
            lock_path = path.with_name(f"{path.name}.lock")
            descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
            try:
                os.fchmod(descriptor, 0o600)
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                environment = {
                    "TONO_API_BASE_URL": "https://api.example.com",
                    "HOME_AGENT_TOKEN": "test-home-agent-token-with-32-characters",
                    "TONO_SOURCE_ID": "home-exit-one",
                    "STATE_PATH": str(path),
                }
                with mock.patch.dict(os.environ, environment, clear=False), mock.patch.object(
                    reporter,
                    "observe_totals",
                    return_value=({}, 1_700_000_000),
                ) as observe:
                    with self.assertRaisesRegex(RuntimeError, "another home-agent run"):
                        reporter.main()
                observe.assert_not_called()
            finally:
                os.close(descriptor)

    def test_run_lock_rejects_symlink_without_changing_target(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "private" / "state.json"
            reporter.ensure_private_parent(path.parent)
            target = path.parent / "target"
            target.write_text("untouched", encoding="utf-8")
            target.chmod(0o644)
            path.with_name(f"{path.name}.lock").symlink_to(target)
            with self.assertRaises(OSError):
                with reporter.agent_run_lock(path):
                    self.fail("symlink lock must not be acquired")
            self.assertEqual(target.read_text(encoding="utf-8"), "untouched")
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o644)

    def test_run_lock_rejects_untrusted_metadata_and_closes_descriptor(self) -> None:
        real_fstat = os.fstat
        for invalid in ("owner", "file_type"):
            with self.subTest(invalid=invalid), tempfile.TemporaryDirectory() as temporary:
                path = Path(temporary) / "private" / "state.json"
                descriptors = []

                def invalid_metadata(descriptor):
                    descriptors.append(descriptor)
                    fields = list(real_fstat(descriptor))
                    if invalid == "owner":
                        fields[4] = os.geteuid() + 1
                    else:
                        fields[0] = stat.S_IFIFO | 0o600
                    return os.stat_result(fields)

                with mock.patch.object(reporter.os, "fstat", side_effect=invalid_metadata):
                    with self.assertRaisesRegex(RuntimeError, "service-owned regular file"):
                        with reporter.agent_run_lock(path):
                            self.fail("untrusted lock must not be acquired")
                self.assertEqual(len(descriptors), 1)
                with self.assertRaises(OSError) as closed:
                    real_fstat(descriptors[0])
                self.assertEqual(closed.exception.errno, errno.EBADF)

    def test_run_lock_preserves_unexpected_flock_error_and_closes_descriptor(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "private" / "state.json"
            failure = OSError(errno.EIO, "injected lock I/O failure")
            with mock.patch.object(reporter.fcntl, "flock", side_effect=failure) as flock:
                with self.assertRaises(OSError) as raised:
                    with reporter.agent_run_lock(path):
                        self.fail("failed lock must not be acquired")
            self.assertIs(raised.exception, failure)
            descriptor = flock.call_args.args[0]
            with self.assertRaises(OSError) as closed:
                os.fstat(descriptor)
            self.assertEqual(closed.exception.errno, errno.EBADF)
            with reporter.agent_run_lock(path):
                pass

    def test_failed_delivery_is_replayed_with_the_exact_report(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "state" / "state.json"
            environment = {
                "TONO_API_BASE_URL": "https://api.example.com",
                "HOME_AGENT_TOKEN": "test-home-agent-token-with-32-characters",
                "TONO_SOURCE_ID": "home-exit-one",
                "STATE_PATH": str(path),
            }
            with mock.patch.dict(os.environ, environment, clear=False), mock.patch.object(
                reporter,
                "observe_totals",
                return_value=({"user-one": 100}, 1_700_000_000),
            ), mock.patch.object(
                reporter, "post_reports", side_effect=TimeoutError("simulated timeout")
            ):
                with self.assertRaises(TimeoutError):
                    reporter.main()

            pending_state = reporter.load_state(path)
            self.assertEqual(len(pending_state["pendingReports"]), 1)
            original = pending_state["pendingReports"][0].copy()
            self.assertEqual(original["sourceId"], "home-exit-one")
            self.assertEqual(original["protocolVersion"], 2)
            self.assertEqual(original["observedAt"], 1_700_000_000)

            delivered: list[dict] = []

            def accept(_base: str, _token: str, reports: list[dict]) -> None:
                delivered.extend(report.copy() for report in reports)

            with mock.patch.dict(os.environ, environment, clear=False), mock.patch.object(
                reporter, "observe_totals", side_effect=AssertionError("must replay first")
            ), mock.patch.object(reporter, "post_reports", side_effect=accept), mock.patch.object(
                reporter, "acknowledge_metering", create=True
            ) as metering_ack:
                reporter.main()

            self.assertEqual(delivered, [original])
            metering_ack.assert_not_called()
            acknowledged = reporter.load_state(path)
            self.assertEqual(acknowledged["pendingReports"], [])
            self.assertEqual(acknowledged["totals"], {"user-one": 100})

    def test_idle_observation_is_durably_saved_before_metering_ack(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "state" / "state.json"
            environment = {
                "TONO_API_BASE_URL": "https://api.example.com",
                "HOME_AGENT_TOKEN": "test-home-agent-token-with-32-characters",
                "TONO_SOURCE_ID": "home-exit-one",
                "STATE_PATH": str(path),
            }

            def verify_saved(_base: str, _token: str, observed_at: int) -> None:
                self.assertEqual(observed_at, 1_700_000_000)
                saved = reporter.load_state(path)
                self.assertEqual(saved["peerCounters"]["stable-one"]["lastRawBytes"], 0)

            with mock.patch.dict(os.environ, environment, clear=False), mock.patch.object(
                reporter,
                "observe_totals",
                side_effect=lambda state, *_args: (
                    state["peerCounters"].update({
                        "stable-one": {"userId": "user-one", "lastRawBytes": 0}
                    }) or {},
                    1_700_000_000,
                ),
            ), mock.patch.object(reporter, "post_reports") as usage_post, mock.patch.object(
                reporter, "acknowledge_metering", side_effect=verify_saved, create=True
            ) as metering_ack:
                reporter.main()

            usage_post.assert_not_called()
            metering_ack.assert_called_once_with(
                "https://api.example.com",
                "test-home-agent-token-with-32-characters",
                1_700_000_000,
            )

    def test_state_save_failure_does_not_send_metering_ack(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "state" / "state.json"
            environment = {
                "TONO_API_BASE_URL": "https://api.example.com",
                "HOME_AGENT_TOKEN": "test-home-agent-token-with-32-characters",
                "TONO_SOURCE_ID": "home-exit-one",
                "STATE_PATH": str(path),
            }
            with mock.patch.dict(os.environ, environment, clear=False), mock.patch.object(
                reporter, "observe_totals", return_value=({}, 1_700_000_000)
            ), mock.patch.object(
                reporter, "save_state", side_effect=OSError("disk full")
            ), mock.patch.object(
                reporter, "acknowledge_metering", create=True
            ) as metering_ack:
                with self.assertRaisesRegex(OSError, "disk full"):
                    reporter.main()

            metering_ack.assert_not_called()

    def test_delivery_failure_does_not_send_metering_ack(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "state" / "state.json"
            environment = {
                "TONO_API_BASE_URL": "https://api.example.com",
                "HOME_AGENT_TOKEN": "test-home-agent-token-with-32-characters",
                "TONO_SOURCE_ID": "home-exit-one",
                "STATE_PATH": str(path),
            }
            with mock.patch.dict(os.environ, environment, clear=False), mock.patch.object(
                reporter, "observe_totals", return_value=({"user-one": 1}, 1_700_000_000)
            ), mock.patch.object(
                reporter, "post_reports", side_effect=TimeoutError("delivery failed")
            ), mock.patch.object(
                reporter, "acknowledge_metering", create=True
            ) as metering_ack:
                with self.assertRaisesRegex(TimeoutError, "delivery failed"):
                    reporter.main()

            metering_ack.assert_not_called()

    def test_metering_ack_failure_preserves_delivered_state(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "state" / "state.json"
            environment = {
                "TONO_API_BASE_URL": "https://api.example.com",
                "HOME_AGENT_TOKEN": "test-home-agent-token-with-32-characters",
                "TONO_SOURCE_ID": "home-exit-one",
                "STATE_PATH": str(path),
            }
            with mock.patch.dict(os.environ, environment, clear=False), mock.patch.object(
                reporter, "observe_totals", return_value=({"user-one": 25}, 1_700_000_000)
            ), mock.patch.object(reporter, "post_reports"), mock.patch.object(
                reporter,
                "acknowledge_metering",
                side_effect=TimeoutError("ack failed"),
                create=True,
            ):
                with self.assertRaisesRegex(TimeoutError, "ack failed"):
                    reporter.main()

            saved = reporter.load_state(path)
            self.assertEqual(saved["totals"], {"user-one": 25})
            self.assertEqual(saved["pendingReports"], [])

    def test_metering_ack_uses_authenticated_separate_endpoint_contract(self) -> None:
        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self, _limit: int) -> bytes:
                return json.dumps({
                    "nodeId": "home-exit-one",
                    "meteringProtocolVersion": 2,
                    "observedAt": 1_700_000_000,
                }).encode("utf-8")

        opener = mock.Mock()
        opener.open.return_value = Response()
        with mock.patch.object(
            reporter.urllib.request, "build_opener", return_value=opener
        ) as build_opener:
            reporter.acknowledge_metering(
                "https://api.example.com",
                "test-home-agent-token-with-32-characters",
                1_700_000_000,
            )

        build_opener.assert_called_once_with(reporter.NoRedirect)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.example.com/api/v1/home/metering-ack")
        self.assertEqual(request.method, "POST")
        self.assertEqual(
            json.loads(request.data),
            {"meteringProtocolVersion": 2, "observedAt": 1_700_000_000},
        )
        self.assertEqual(
            request.headers["Authorization"],
            "Bearer test-home-agent-token-with-32-characters",
        )

    def test_delivery_chunks_at_the_worker_distinct_user_limit(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "state" / "state.json"
            reports = [
                {
                    "reportId": f"report-{index}",
                    "userId": f"user-{index}",
                    "sourceId": "home-exit-one",
                    "protocolVersion": 2,
                    "totalBytes": index + 1,
                    "observedAt": 1_700_000_000,
                }
                for index in range(101)
            ]
            state = {
                "sourceId": "home-exit-one",
                "totals": {},
                "pendingReports": reports.copy(),
            }
            reporter.save_state(path, state)
            batches: list[list[dict]] = []

            def accept(_base: str, _token: str, batch: list[dict]) -> None:
                batches.append([report.copy() for report in batch])

            with mock.patch.object(reporter, "post_reports", side_effect=accept):
                delivered = reporter.deliver_pending(
                    "https://api.example.com", "test-token", path, state
                )

            self.assertEqual(delivered, 101)
            self.assertEqual([len(batch) for batch in batches], [100, 1])
            self.assertEqual(reporter.load_state(path)["pendingReports"], [])

    def test_peer_counters_are_attributed_by_verified_key_and_survive_reset(self) -> None:
        state = {
            "totals": {"user-one": 1_000},
            "pendingReports": [],
            "peerCounters": {},
        }
        mapping = {
            "public-one": "user-one",
            "public-two": "user-one",
        }
        first = reporter.attribute_peer_counters(
            state,
            mapping,
            {"user-one": 1_000},
            {
                "stable-one": ("public-one", 100),
                "stable-two": ("public-two", 50),
                "unmanaged-peer": ("unmanaged-key", 9_999),
            },
        )
        self.assertEqual(first, {"user-one": 1_150})
        state["totals"] = first

        second = reporter.attribute_peer_counters(
            state,
            mapping,
            {"user-one": 1_150},
            {
                "stable-one": ("public-one", 125),
                "stable-two": ("public-two", 10),
            },
        )
        # stable-one advanced by 25; stable-two reset and contributed its new 10.
        self.assertEqual(second, {"user-one": 1_185})

    def test_server_source_baseline_does_not_rebill_raw_counters_after_state_loss(self) -> None:
        state = {
            "totals": {},
            "pendingReports": [],
            "peerCounters": {},
        }
        mapping = {"public-one": "user-one"}

        recovered = reporter.attribute_peer_counters(
            state,
            mapping,
            {"user-one": 125},
            {"stable-one": ("public-one", 1_000)},
        )

        # The server has already accepted 125 bytes from this source. With the
        # local peer baseline gone, the current raw 1,000 may include all of
        # those bytes and cannot safely be charged again.
        self.assertEqual(recovered, {"user-one": 125})
        self.assertEqual(state["peerCounters"]["stable-one"]["lastRawBytes"], 1_000)

        state["totals"] = recovered
        advanced = reporter.attribute_peer_counters(
            state,
            mapping,
            {"user-one": 125},
            {"stable-one": ("public-one", 1_025)},
        )
        self.assertEqual(advanced, {"user-one": 150})

    def test_stable_id_cannot_move_between_users(self) -> None:
        state = {
            "totals": {},
            "pendingReports": [],
            "peerCounters": {
                "stable-one": {
                    "userId": "original-user",
                    "lastRawBytes": 10,
                },
            },
        }
        with self.assertRaisesRegex(RuntimeError, "changed users"):
            reporter.attribute_peer_counters(
                state,
                {"public-one": "different-user"},
                {},
                {"stable-one": ("public-one", 20)},
            )

    def test_tailscale_status_requires_unique_bounded_integer_peer_counters(self) -> None:
        parsed = reporter.parse_tailscale_status({
            "Peer": {
                "nodekey:one": {
                    "ID": "stable-one",
                    "PublicKey": "nodekey:public-one",
                    "RxBytes": 123,
                    "TxBytes": 456,
                },
            },
        })
        self.assertEqual(parsed, {"stable-one": ("public-one", 579)})

        with self.assertRaisesRegex(RuntimeError, "invalid"):
            reporter.parse_tailscale_status({
                "Peer": {
                    "nodekey:one": {
                        "ID": "stable-one",
                        "PublicKey": "nodekey:public-one",
                        "RxBytes": True,
                        "TxBytes": 0,
                    },
                },
            })

    def test_counter_source_types_are_rejected_before_sorting(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "state" / "state.json"
            environment = {
                "TONO_API_BASE_URL": "https://api.example.com",
                "HOME_AGENT_TOKEN": "test-home-agent-token-with-32-characters",
                "TONO_SOURCE_ID": "home-exit-one",
                "STATE_PATH": str(path),
            }
            with mock.patch.dict(os.environ, environment, clear=False), mock.patch.object(
                reporter,
                "observe_totals",
                return_value=({"valid-user": 1, 7: 2}, 1_700_000_000),
            ):
                with self.assertRaisesRegex(RuntimeError, "counter source returned invalid data"):
                    reporter.main()

    def test_source_identity_cannot_change_after_it_is_persisted(self) -> None:
        state = {
            "sourceId": "home-exit-one",
            "totals": {},
            "pendingReports": [],
            "peerCounters": {},
        }
        with mock.patch.dict(
            os.environ,
            {"TONO_SOURCE_ID": "home-exit-two"},
            clear=False,
        ):
            with self.assertRaisesRegex(RuntimeError, "durable source"):
                reporter.source_id(state)

    def test_inventory_node_identity_must_match_the_configured_source(self) -> None:
        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self, _limit: int) -> bytes:
                return json.dumps({
                    "nodeId": "different-exit",
                    "observedAt": 1_700_000_000,
                    "devices": [],
                }).encode("utf-8")

        opener = mock.Mock()
        opener.open.return_value = Response()
        with mock.patch.object(reporter.urllib.request, "build_opener", return_value=opener):
            with self.assertRaisesRegex(RuntimeError, "authenticated exit node"):
                reporter.fetch_inventory(
                    "https://api.example.com",
                    "test-home-agent-token-with-32-characters",
                    "home-exit-one",
                )

    def test_inventory_uses_node_source_total_not_account_aggregate(self) -> None:
        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self, _limit: int) -> bytes:
                return json.dumps({
                    "nodeId": "home-exit-two",
                    "observedAt": 1_700_000_000,
                    "devices": [{
                        "stableNodeId": "stable-one",
                        "publicKey": "nodekey:public-one",
                        "userId": "user-one",
                        "status": "active",
                        "usageBytes": 9_000,
                        "sourceUsageBytes": 125,
                    }],
                }).encode("utf-8")

        opener = mock.Mock()
        opener.open.return_value = Response()
        with mock.patch.object(reporter.urllib.request, "build_opener", return_value=opener):
            mapping, source_totals, observed_at = reporter.fetch_inventory(
                "https://api.example.com",
                "test-home-agent-token-with-32-characters",
                "home-exit-two",
            )

        self.assertEqual(mapping, {"public-one": "user-one"})
        self.assertEqual(source_totals, {"user-one": 125})
        self.assertEqual(observed_at, 1_700_000_000)

    def test_duplicate_pending_report_ids_are_rejected(self) -> None:
        report = {
            "reportId": "same-report",
            "userId": "user-one",
            "sourceId": "home-exit-one",
            "protocolVersion": 2,
            "totalBytes": 42,
            "observedAt": 1_700_000_000,
        }
        with self.assertRaisesRegex(RuntimeError, "duplicate pending report ID"):
            reporter.validate_state(
                {
                    "sourceId": "home-exit-one",
                    "totals": {},
                    "pendingReports": [report, report.copy()],
                }
            )


if __name__ == "__main__":
    unittest.main()
