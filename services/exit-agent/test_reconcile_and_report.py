#!/usr/bin/env python3
"""Tests for the parts where an error costs money.

Counters reset when xray restarts, so lifetime totals are maintained here. Get the
fold wrong in one direction and every restart forgives whatever an account had
used; get it wrong in the other and accounts are billed twice for the same bytes.
Neither is visible from the outside — the numbers simply look plausible.

The other half is the labels. A label the control plane does not use makes usage
unattributable, and a removal driven from the wrong set disconnects a paying
customer — also invisible from here, and reported by the customer.
"""

from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import threading
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "agent", Path(__file__).with_name("reconcile_and_report.py")
)
agent = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(agent)


def fresh_state() -> dict:
    return {"totals": {}, "counterBaseline": {}, "pendingReports": []}


class ApiOrigin(unittest.TestCase):
    def test_api_base_is_an_https_origin_without_credentials_or_custom_port(self) -> None:
        for invalid in (
            "http://api.example.com",
            "https://user:password@api.example.com",
            "https://api.example.com:8443",
            "https://api.example.com:not-a-port",
            "https://api.example.com/prefix",
            "https://api.example.com?next=https://attacker.example",
            "https://api.example.com#fragment",
        ):
            with self.subTest(invalid=invalid), patch.dict(
                os.environ, {"TONO_API_BASE": invalid}, clear=False
            ):
                with self.assertRaisesRegex(agent.Refusal, "HTTPS origin"):
                    agent.api_base()

    def test_all_authenticated_requests_disable_redirects(self) -> None:
        requests = []

        class Response:
            def __init__(self, body: bytes):
                self.body = body

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self, _limit: int) -> bytes:
                return self.body

        def respond(request, timeout=None):  # noqa: ARG001
            requests.append(request)
            if request.full_url.endswith("/exit-identities"):
                return Response(json.dumps({
                    "nodeId": "exit-one",
                    "observedAt": 1,
                    "identities": [],
                }).encode("utf-8"))
            return Response(b"{}")

        with patch.object(
            agent.urllib.request,
            "urlopen",
            side_effect=respond,
        ) as redirect_following, patch.object(
            agent.urllib.request,
            "build_opener",
        ) as build_opener:
            build_opener.return_value.open.side_effect = respond
            agent.fetch_roster("https://api.example.com", "node-token")
            agent.acknowledge_roster("https://api.example.com", "node-token", 1)
            agent.deliver("https://api.example.com", "node-token", [])

        redirect_following.assert_not_called()
        self.assertEqual(build_opener.call_count, 3)
        self.assertTrue(all(
            call.args and call.args[0].__name__ == "NoRedirect"
            for call in build_opener.call_args_list
        ))
        self.assertTrue(all(
            request.unredirected_hdrs.get("Authorization") == "Bearer node-token"
            for request in requests
        ))

    def test_a_redirect_is_refused_without_contacting_its_destination(self) -> None:
        contacted = []

        class Destination(BaseHTTPRequestHandler):
            def do_GET(self):
                contacted.append(self.headers.get("Authorization"))
                self.send_response(200)
                self.end_headers()

            def log_message(self, *_args):
                pass

        destination = ThreadingHTTPServer(("127.0.0.1", 0), Destination)

        class Redirect(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(302)
                self.send_header(
                    "Location",
                    f"http://127.0.0.1:{destination.server_port}/stolen",
                )
                self.end_headers()

            def log_message(self, *_args):
                pass

        redirect = ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
        threads = [
            threading.Thread(target=server.serve_forever, daemon=True)
            for server in (destination, redirect)
        ]
        try:
            for thread in threads:
                thread.start()
            request = agent.urllib.request.Request(
                f"http://127.0.0.1:{redirect.server_port}/roster"
            )
            request.add_unredirected_header("Authorization", "Bearer node-token")
            with self.assertRaises(urllib.error.HTTPError) as failure:
                agent.open_control_plane(request, timeout=2)
            self.assertEqual(failure.exception.code, 302)
            failure.exception.close()
            self.assertEqual(contacted, [])
        finally:
            for server in (redirect, destination):
                server.shutdown()
                server.server_close()
            for thread in threads:
                thread.join(timeout=2)


class LifetimeTotals(unittest.TestCase):
    def test_first_reading_is_the_whole_total(self) -> None:
        state = fresh_state()
        self.assertEqual(agent.lifetime_totals(state, {"u1": 500}), {"u1": 500})

    def test_growth_between_readings_adds_the_delta_not_the_reading(self) -> None:
        state = fresh_state()
        agent.lifetime_totals(state, {"u1": 500})
        state["totals"] = {"u1": 500}
        # Billing the reading rather than the delta would charge 500 + 900 for 900
        # bytes of traffic.
        self.assertEqual(agent.lifetime_totals(state, {"u1": 900}), {"u1": 900})

    def test_a_restart_contributes_the_new_reading_as_fresh_usage(self) -> None:
        state = fresh_state()
        agent.lifetime_totals(state, {"u1": 900})
        state["totals"] = {"u1": 900}
        # xray restarted: the counter is below its last raw value, so everything it
        # now reports happened after the restart. Treating the decrease as a
        # decrease would roll the lifetime total backwards and forgive the 900.
        self.assertEqual(agent.lifetime_totals(state, {"u1": 120}), {"u1": 1020})

    def test_a_restart_landing_above_the_old_reading_is_still_a_restart(self) -> None:
        state = fresh_state()
        agent.lifetime_totals(state, {"u1": 900})
        state["totals"] = {"u1": 900}
        # The other direction of the same restart. A busy account can pass its
        # pre-restart figure before this agent's next run, and a counter that rose
        # is indistinguishable from 300 bytes of growth — reading it as growth
        # forgives the 900 that came before the restart. Only the node saying it
        # restarted can tell the two apart.
        self.assertEqual(
            agent.lifetime_totals(state, {"u1": 1200}, restarted=True), {"u1": 2100}
        )

    def test_a_restart_settles_every_account_in_one_observation(self) -> None:
        state = fresh_state()
        agent.lifetime_totals(state, {"u1": 900, "u2": 100})
        state["totals"] = {"u1": 900, "u2": 100}
        # A restart is node-level: it resets every counter at once, whichever
        # direction each account's next reading happens to land in.
        self.assertEqual(
            agent.lifetime_totals(state, {"u1": 1200, "u2": 40}, restarted=True),
            {"u1": 2100, "u2": 140},
        )

    def test_without_a_restart_a_risen_counter_is_growth(self) -> None:
        state = fresh_state()
        agent.lifetime_totals(state, {"u1": 900})
        state["totals"] = {"u1": 900}
        # And the signal is only ever additive: absent it, nothing changes, and a
        # false one would bill the account for its own history a second time.
        self.assertEqual(agent.lifetime_totals(state, {"u1": 1200}), {"u1": 1200})

    def test_an_account_missing_from_a_reading_keeps_its_total(self) -> None:
        state = fresh_state()
        agent.lifetime_totals(state, {"u1": 700, "u2": 300})
        state["totals"] = {"u1": 700, "u2": 300}
        # u2 was removed from the roster, so it no longer appears. Dropping it here
        # would let a re-added account resume from zero.
        self.assertEqual(
            agent.lifetime_totals(state, {"u1": 800}), {"u1": 800, "u2": 300}
        )

    def test_a_readmitted_account_does_not_restart_from_zero(self) -> None:
        state = fresh_state()
        agent.lifetime_totals(state, {"u1": 400})
        state["totals"] = {"u1": 400}
        agent.lifetime_totals(state, {})          # removed
        state["totals"] = {"u1": 400}
        # Back on the roster with a counter of its own starting from zero.
        self.assertEqual(agent.lifetime_totals(state, {"u1": 50}), {"u1": 450})

    def test_a_total_past_the_reportable_range_is_refused(self) -> None:
        state = fresh_state()
        state["totals"] = {"u1": agent.MAX_SAFE_INTEGER}
        state["counterBaseline"] = {"u1": 0}
        with self.assertRaises(agent.Refusal):
            agent.lifetime_totals(state, {"u1": 1})


class RestartMarker(unittest.TestCase):
    """The out-of-band restart signal, read off /proc rather than asked of xray.

    It only ever adds a restart the counters could not see, so an unreadable or
    ambiguous node must produce nothing at all: a marker invented here would bill
    an account for its own history a second time on the next round.
    """

    BINARY = Path("/opt/tono-xray/current/xray")
    BOOT_ID = "6f1b0f2c-0000-4000-8000-0123456789ab"
    # `comm` is parenthesised and may contain spaces; starttime is the 22nd field.
    STAT = "{pid} (x ray) S 1 {pid} {pid} 0 -1 4194560 90 0 0 0 7 3 0 0 20 0 12 0 {start}"

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.proc = Path(directory.name)
        random = self.proc / "sys/kernel/random"
        random.mkdir(parents=True)
        (random / "boot_id").write_text(f"{self.BOOT_ID}\n", encoding="utf-8")

    def process(self, pid: int, start: int, *, executable: str,
                by_cmdline: bool = False) -> None:
        entry = self.proc / str(pid)
        entry.mkdir()
        entry.joinpath("stat").write_text(
            self.STAT.format(pid=pid, start=start), encoding="utf-8"
        )
        if by_cmdline:
            # No readable `exe`, which is what an unprivileged run sees.
            entry.joinpath("cmdline").write_bytes(
                executable.encode("utf-8") + b"\0run\0-c\0/etc/xray/config.json\0"
            )
        else:
            entry.joinpath("exe").symlink_to(executable)

    def test_the_marker_names_the_boot_and_the_process_start(self) -> None:
        self.process(4242, 987654, executable=str(self.BINARY))
        self.assertEqual(
            agent.xray_start_marker(self.BINARY, self.proc),
            f"{self.BOOT_ID}:987654",
        )

    def test_a_restart_changes_the_marker(self) -> None:
        self.process(4242, 987654, executable=str(self.BINARY))
        before = agent.xray_start_marker(self.BINARY, self.proc)
        (self.proc / "4242" / "exe").unlink()
        (self.proc / "4242" / "stat").unlink()
        (self.proc / "4242").rmdir()
        self.process(5150, 1122334, executable=str(self.BINARY))
        self.assertNotEqual(agent.xray_start_marker(self.BINARY, self.proc), before)

    def test_cmdline_answers_when_exe_cannot_be_read(self) -> None:
        self.process(4242, 555, executable=str(self.BINARY), by_cmdline=True)
        self.assertEqual(
            agent.xray_start_marker(self.BINARY, self.proc), f"{self.BOOT_ID}:555"
        )

    def test_other_processes_are_not_the_exit(self) -> None:
        self.process(4242, 555, executable="/usr/bin/python3")
        self.assertIsNone(agent.xray_start_marker(self.BINARY, self.proc))

    def test_two_candidates_are_ambiguous_rather_than_a_restart(self) -> None:
        # Nothing here can say which of them the counters came from, and guessing
        # wrong reads as a restart on every run.
        self.process(4242, 555, executable=str(self.BINARY))
        self.process(4243, 666, executable=str(self.BINARY))
        self.assertIsNone(agent.xray_start_marker(self.BINARY, self.proc))

    def test_a_node_that_cannot_be_read_reports_no_restart(self) -> None:
        self.process(4242, 555, executable=str(self.BINARY))
        (self.proc / "sys/kernel/random/boot_id").unlink()
        self.assertIsNone(agent.xray_start_marker(self.BINARY, self.proc))


class RestartMarkerRound(unittest.TestCase):
    """What a whole round records about the process its counters came from.

    A restart can land between reading the marker and reading the counters. That
    round folds it correctly, because the counters fell; the question is which
    marker it leaves behind for the next round. Leaving the one read before the
    counters has the next round see a marker it has never recorded, call the same
    restart a second time, and bill the bytes this round already folded.
    """

    def rounds(self, markers: list[str], readings: list[dict[str, int]],
               recorded_marker: str, round_count: int | None = None) -> dict:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "state.json"
        path.write_text(json.dumps({
            "totals": {"u:alice": 900},
            "counterBaseline": {"u:alice": 900},
            "pendingReports": [],
            "sourceId": "node-under-test",
            "startMarker": recorded_marker,
        }), encoding="utf-8")

        def fake_env(name: str, *, required: bool = True) -> str:
            values = {
                "TONO_HOME_AGENT_TOKEN": "agent-token",
                "TONO_SOURCE_ID": "node-under-test",
            }
            value = values.get(name, "")
            if not value and required:
                raise agent.Refusal(f"missing {name}")
            return value

        def fake_deliver(base: str, token: str, queue_path: Path, state: dict):
            delivered = len(state["pendingReports"])
            state["pendingReports"] = []
            agent.save_state(queue_path, state)
            return delivered, 0

        with patch.object(agent, "env", fake_env), \
             patch.object(agent, "api_base", return_value="https://control.example"), \
             patch.object(agent, "xray_binary", return_value=Path("/opt/tono-xray/current/xray")), \
             patch.object(agent, "api_address", return_value="127.0.0.1:10085"), \
             patch.object(agent, "inbound_tag", return_value="vless-in"), \
             patch.object(agent, "state_path", return_value=path), \
             patch.object(agent, "require_commands", return_value={"stats_query": "statsquery"}), \
             patch.object(
                 agent,
                 "fetch_roster",
                 return_value=("node-under-test", 1_700_000_000, [], False),
             ), \
             patch.object(agent, "installed_clients", return_value={"u:alice"}), \
             patch.object(agent, "reconcile", return_value=(0, 0, {"u:alice"})), \
             patch.object(agent, "read_counters", side_effect=readings), \
             patch.object(agent, "xray_start_marker", side_effect=markers), \
             patch.object(agent, "acknowledge_roster"), \
             patch.object(agent, "deliver_queue", side_effect=fake_deliver):
            for _ in range(round_count if round_count is not None else len(readings)):
                agent.main()
        return json.loads(path.read_text(encoding="utf-8"))

    def test_a_restart_between_the_two_reads_is_folded_once(self) -> None:
        # Round one reads the marker, xray restarts, and the first 50-byte read
        # cannot be assigned safely to either process. The retry reads the new
        # process at 50 and folds it once. Round two then adds only 300 - 50.
        state = self.rounds(
            markers=[
                "boot:100", "boot:200",
                "boot:200", "boot:200",
                "boot:200", "boot:200",
            ],
            readings=[{"u:alice": 50}, {"u:alice": 50}, {"u:alice": 300}],
            recorded_marker="boot:100",
            round_count=2,
        )
        self.assertEqual(state["totals"], {"u:alice": 1200})
        self.assertEqual(state["startMarker"], "boot:200")

    def test_a_restart_between_rounds_is_still_folded(self) -> None:
        # The signal's own case, unchanged: the restart lands between two rounds,
        # the second round's reading rose past the first, and only the marker can
        # say the counters started over.
        state = self.rounds(
            markers=["boot:100", "boot:100", "boot:200", "boot:200"],
            readings=[{"u:alice": 950}, {"u:alice": 1200}],
            recorded_marker="boot:100",
        )
        self.assertEqual(state["totals"], {"u:alice": 2150})
        self.assertEqual(state["startMarker"], "boot:200")

    def test_an_unreadable_marker_is_forgotten_rather_than_kept(self) -> None:
        state = self.rounds(
            markers=["boot:100", None, "boot:100", "boot:100"],
            readings=[{"u:alice": 950}, {"u:alice": 1000}],
            recorded_marker="boot:100",
        )
        self.assertEqual(state["startMarker"], "boot:100")
        self.assertEqual(state["totals"], {"u:alice": 1000})


class RosterValidation(unittest.TestCase):
    def test_a_repeated_identity_is_refused(self) -> None:
        # Two accounts on one identity is the state this whole system exists to
        # end: their counters would merge and usage would be unattributable again.
        payload = {
            "nodeId": "exit-node-a",
            "observedAt": 1,
            "identities": [
                {"userId": "a", "clientUUID": "11111111-1111-4111-8111-111111111111"},
                {"userId": "b", "clientUUID": "11111111-1111-4111-8111-111111111111"},
            ],
        }
        with self.assertRaises(agent.Refusal):
            self._parse(payload)

    def test_a_malformed_identity_is_refused(self) -> None:
        payload = {
            "nodeId": "exit-node-a",
            "observedAt": 1,
            "identities": [{"userId": "a", "clientUUID": "not-a-uuid"}],
        }
        with self.assertRaises(agent.Refusal):
            self._parse(payload)

    def test_a_present_but_invalid_device_id_is_not_downgraded_to_legacy(self) -> None:
        payload = {
            "nodeId": "exit-node-a",
            "observedAt": 1,
            "identities": [{
                "userId": "a",
                "deviceId": "",
                "clientUUID": "11111111-1111-4111-8111-111111111111",
            }],
        }
        with self.assertRaises(agent.Refusal):
            self._parse(payload)

    def test_a_valid_roster_is_accepted(self) -> None:
        payload = {
            "nodeId": "exit-node-a",
            "observedAt": 7,
            "identities": [
                {"userId": "a", "clientUUID": "11111111-1111-4111-8111-111111111111"},
                {"userId": "b", "clientUUID": "22222222-2222-4222-8222-222222222222"},
            ],
        }
        node_id, observed_at, roster, retire_shared_legacy = self._parse(payload)
        self.assertEqual(node_id, "exit-node-a")
        self.assertEqual(observed_at, 7)
        self.assertEqual([entry["userId"] for entry in roster], ["a", "b"])
        self.assertFalse(retire_shared_legacy)

    def test_a_roster_without_an_authenticated_node_id_is_refused(self) -> None:
        with self.assertRaises(agent.Refusal):
            self._parse({"observedAt": 7, "identities": []})

    def test_the_shared_legacy_retirement_signal_is_returned(self) -> None:
        self.assertEqual(
            self._parse({
                "nodeId": "exit-node-a",
                "observedAt": 7,
                "retireSharedLegacy": True,
                "identities": [],
            }),
            ("exit-node-a", 7, [], True),
        )

    def _parse(self, payload: dict):
        # Exercises the validation without a network round trip by standing in for
        # the response body.
        import io
        import json as json_module
        from contextlib import contextmanager

        encoded = json_module.dumps(payload).encode("utf-8")

        @contextmanager
        def fake_urlopen(_request, timeout=None):  # noqa: ARG001
            yield io.BytesIO(encoded)

        with patch.object(agent, "open_control_plane", fake_urlopen):
            return agent.fetch_roster("https://example.invalid", "token")


class RosterControlSignals(unittest.TestCase):
    def run_round(
        self,
        *,
        server_retire: bool,
        override: str | None = None,
        ack_error: Exception | None = None,
        reconcile_error: Exception | None = None,
        inventory_known: bool = True,
    ):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "state.json"
        environment = {
            "TONO_HOME_AGENT_TOKEN": "node-token",
            "TONO_SOURCE_ID": "exit-node-a",
        }
        if override is not None:
            environment["TONO_RETIRE_SHARED_LEGACY"] = override

        reconcile_result = (0, 0, set() if inventory_known else None, {}, None)
        with patch.dict(agent.os.environ, environment, clear=True), \
             patch.object(agent, "api_base", return_value="https://control.example"), \
             patch.object(agent, "xray_binary", return_value=Path("/unused/xray")), \
             patch.object(agent, "api_address", return_value="127.0.0.1:10085"), \
             patch.object(agent, "inbound_tag", return_value="vless-in"), \
             patch.object(agent, "require_commands", return_value={"stats_query": "statsquery"}), \
             patch.object(
                 agent,
                 "fetch_roster",
                 return_value=("exit-node-a", 1_700_000_000, [], server_retire),
             ), \
             patch.object(
                 agent,
                 "reconcile_and_read_stable",
                 return_value=reconcile_result,
                 side_effect=reconcile_error,
             ) as reconcile, \
             patch.object(agent, "acknowledge_roster", side_effect=ack_error) as acknowledge:
            if ack_error or reconcile_error or not inventory_known:
                with self.assertRaises(agent.Refusal):
                    agent.run_once(path)
            else:
                agent.run_once(path)
        return path, reconcile, acknowledge

    def test_an_unset_override_follows_the_server_retirement_signal(self) -> None:
        _, reconcile, acknowledge = self.run_round(server_retire=True)
        self.assertTrue(reconcile.call_args.kwargs["retire_shared_legacy"])
        acknowledge.assert_called_once_with(
            "https://control.example", "node-token", 1_700_000_000,
        )

    def test_an_explicit_false_override_blocks_server_retirement(self) -> None:
        _, reconcile, _ = self.run_round(server_retire=True, override="false")
        self.assertFalse(reconcile.call_args.kwargs["retire_shared_legacy"])

    def test_an_ack_failure_does_not_persist_the_round(self) -> None:
        path, _, _ = self.run_round(
            server_retire=False,
            ack_error=agent.Refusal("roster ack failed"),
        )
        self.assertFalse(path.exists())

    def test_a_failed_reconcile_is_never_acknowledged(self) -> None:
        _, _, acknowledge = self.run_round(
            server_retire=False,
            reconcile_error=agent.Refusal("xray reconcile failed"),
        )
        acknowledge.assert_not_called()

    def test_an_unverifiable_live_client_inventory_is_never_acknowledged(self) -> None:
        path, _, acknowledge = self.run_round(
            server_retire=True,
            inventory_known=False,
        )

        acknowledge.assert_not_called()
        self.assertFalse(path.exists())

    def test_a_token_bound_to_another_source_stops_before_reconciliation(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "state.json"
        state = {
            **fresh_state(),
            "sourceId": "exit-node-a",
        }
        path.write_text(json.dumps(state), encoding="utf-8")
        with patch.dict(agent.os.environ, {
                 "TONO_HOME_AGENT_TOKEN": "node-token",
                 "TONO_SOURCE_ID": "exit-node-a",
             }, clear=True), \
             patch.object(agent, "api_base", return_value="https://control.example"), \
             patch.object(agent, "xray_binary", return_value=Path("/unused/xray")), \
             patch.object(agent, "require_commands", return_value={}), \
             patch.object(
                 agent,
                 "fetch_roster",
                 return_value=("exit-node-b", 1_700_000_000, [], False),
             ), \
             patch.object(agent, "reconcile_and_read_stable") as reconcile:
            with self.assertRaises(agent.Refusal):
                agent.run_once(path)
        reconcile.assert_not_called()
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), state)


class Labels(unittest.TestCase):
    def test_the_label_written_is_the_label_the_control_plane_issues(self) -> None:
        # The control plane hands out `u:<userId>` and the fleet audit counts
        # labels in that form. A bare userId makes every account on the node look
        # absent to one of the three.
        self.assertEqual(agent.client_label("usr_1"), "u:usr_1")
        self.assertEqual(agent.attributed_user(agent.client_label("usr_1")), "usr_1")

    def test_a_label_that_is_not_ours_is_attributed_to_nobody(self) -> None:
        # `shared-legacy` carries the whole fleet's traffic and hand-added entries
        # carry somebody's else. Billing either to an account bills the wrong one.
        self.assertIsNone(agent.attributed_user(agent.LEGACY_CLIENT_EMAIL))
        self.assertIsNone(agent.attributed_user("ops-laptop"))
        self.assertIsNone(agent.attributed_user("u:"))


class SourceIdentity(unittest.TestCase):
    def setUp(self) -> None:
        patcher = patch.dict(agent.os.environ, {}, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_the_source_can_be_the_control_plane_exit_node_id(self) -> None:
        state = fresh_state()
        with patch.dict(agent.os.environ, {"TONO_SOURCE_ID": "exit_node_123"}, clear=True):
            self.assertEqual(agent.source_id(state), "exit_node_123")

    def test_the_source_is_the_machine_identity_and_does_not_change_per_run(self) -> None:
        # A source that changed per run would read on the server as a new exit
        # each time, and the same account would be counted once per run.
        state = fresh_state()
        with patch.object(agent, "machine_identity", return_value="0123456789abcdef"):
            first = agent.source_id(state)
            second = agent.source_id(dict(state))
        self.assertEqual(first, "0123456789abcdef")
        self.assertEqual(first, second)
        self.assertEqual(state["sourceId"], first)

    def test_two_clones_of_one_image_do_not_present_the_same_name(self) -> None:
        # These nodes are provisioned from cloned images, and a clone carries the
        # source image's /etc/machine-id. Two exits under one name do not merely
        # merge: each reads the other's lower figure as a counter reset, and the
        # account's total runs away until enforcement revokes a paying customer.
        with tempfile.TemporaryDirectory() as directory:
            machine_id = Path(directory) / "machine-id"
            machine_id.write_text("0123456789abcdef0123456789abcdef\n", encoding="utf-8")
            with patch.object(agent, "Path", lambda _: machine_id):
                with patch.object(agent.socket, "gethostname", return_value="tono-exit-hk-1"):
                    first = agent.machine_identity()
                with patch.object(agent.socket, "gethostname", return_value="tono-exit-hk-2"):
                    second = agent.machine_identity()
        self.assertNotEqual(first, second)
        # And the part set per node survives the 64-character limit.
        self.assertTrue(first.startswith("tono-exit-hk-1"))

    def test_long_equal_hostnames_keep_the_machine_identity_in_the_source(self) -> None:
        hostname = "h" * 64
        first_state = fresh_state()
        second_state = fresh_state()
        with patch.object(agent, "machine_identity", return_value=f"{hostname}-machine-a"):
            first = agent.source_id(first_state)
        with patch.object(agent, "machine_identity", return_value=f"{hostname}-machine-b"):
            second = agent.source_id(second_state)
        self.assertNotEqual(first, second)
        self.assertEqual(len(first), 64)
        self.assertEqual(len(second), 64)

    def test_an_unusable_identity_is_refused_rather_than_invented(self) -> None:
        with patch.object(agent, "machine_identity", return_value="   "):
            with self.assertRaises(agent.Refusal):
                agent.source_id(fresh_state())

    def test_a_changed_source_is_refused_without_mutating_billing_state(self) -> None:
        # A rename cannot be made exactly-once: an old queued cumulative report
        # may or may not already have reached the old ledger. Rewriting it under
        # the new source can double-charge history; dropping it can lose usage.
        # Provision the node with this durable source identity instead.
        state = fresh_state()
        state["sourceId"] = "old-node"
        state["totals"] = {"u:usr_1": 900}
        state["counterBaseline"] = {"u:usr_1": 900}
        state["userTotals"] = {"usr_1": 900}
        state["pendingReports"] = [{
            "reportId": "pending-1",
            "userId": "usr_1",
            "sourceId": "old-node",
            "totalBytes": 900,
            "observedAt": 10,
        }]
        before = json.loads(json.dumps(state))
        with patch.object(agent, "machine_identity", return_value="new-node"):
            with self.assertRaises(agent.Refusal):
                agent.source_id(state)
        self.assertEqual(state, before)


class MultipleExits(unittest.TestCase):
    def test_two_exits_report_the_same_account_under_their_own_names(self) -> None:
        # Each exit reports only the bytes that crossed it, and names itself, so
        # the server can add the two rather than fold them to the larger one. The
        # sum is what an account spread over several exits actually used.
        reports = []
        for source, counters in (("exit-a", {"u:usr_1": 300}), ("exit-b", {"u:usr_1": 700})):
            state = fresh_state()
            state["sourceId"] = source
            totals = agent.lifetime_totals(state, counters)
            for label, total in totals.items():
                reports.append({
                    "reportId": f"{source}-1",
                    "userId": agent.attributed_user(label),
                    "sourceId": source,
                    "totalBytes": total,
                    "observedAt": 10,
                })
        self.assertEqual({report["sourceId"] for report in reports}, {"exit-a", "exit-b"})
        self.assertEqual({report["userId"] for report in reports}, {"usr_1"})
        self.assertEqual(sum(report["totalBytes"] for report in reports), 1000)

    def test_report_timestamps_follow_the_roster_clock_and_remain_strictly_monotonic(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "state.json"
        path.write_text(json.dumps(fresh_state()), encoding="utf-8")
        delivered: list[dict] = []

        def fake_deliver(base: str, token: str, queue_path: Path, state: dict):
            delivered.extend(dict(report) for report in state["pendingReports"])
            count = len(state["pendingReports"])
            state["pendingReports"] = []
            agent.save_state(queue_path, state)
            return count, 0

        stable_rounds = [
            (0, 0, {"u:usr_1"}, {"u:usr_1": 10}, None),
            (0, 0, {"u:usr_1"}, {"u:usr_1": 20}, None),
        ]
        with patch.object(agent, "api_base", return_value="https://control.example"), \
             patch.object(agent, "env", return_value="node-token"), \
             patch.object(agent, "xray_binary", return_value=Path("/xray")), \
             patch.object(agent, "require_commands", return_value={}), \
             patch.object(
                 agent,
                 "fetch_roster",
                 return_value=("node-token", 500, [], False),
             ), \
             patch.object(agent, "reconcile_and_read_stable", side_effect=stable_rounds), \
             patch.object(agent, "acknowledge_roster"), \
             patch.object(agent, "deliver_queue", side_effect=fake_deliver), \
             patch.object(agent.time, "time", return_value=100):
            agent.run_once(path)
            agent.run_once(path)

        self.assertEqual(
            [report["observedAt"] for report in delivered],
            [500, 501],
            "the control-plane roster clock must survive a backwards local clock and same-second runs",
        )
        self.assertEqual([report.get("protocolVersion") for report in delivered], [2, 2])

    def test_a_timestamp_beyond_the_server_window_keeps_usage_uncommitted(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "state.json"
        initial = {
            **fresh_state(),
            "sourceId": "node-under-test",
            "lastReportObservedAt": 1_000,
        }
        path.write_text(json.dumps(initial), encoding="utf-8")

        with patch.object(agent, "api_base", return_value="https://control.example"), \
             patch.object(agent, "env", return_value="node-under-test"), \
             patch.object(agent, "xray_binary", return_value=Path("/xray")), \
             patch.object(agent, "require_commands", return_value={}), \
             patch.object(
                 agent,
                 "fetch_roster",
                 return_value=("node-under-test", 100, [], False),
             ), \
             patch.object(
                 agent,
                 "reconcile_and_read_stable",
                 return_value=(0, 0, {"u:usr_1"}, {"u:usr_1": 10}, None),
             ), \
             patch.object(agent, "acknowledge_roster"), \
             patch.object(agent, "deliver_queue", return_value=(1, 0)) as deliver:
            with self.assertRaises(agent.Refusal):
                agent.run_once(path)

        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), initial)
        deliver.assert_not_called()

    def test_a_queued_future_timestamp_is_not_dropped_on_replay(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / "state.json"
        initial = {
            **fresh_state(),
            "sourceId": "node-under-test",
            "lastReportObservedAt": 1_000,
            "pendingReports": [{
                "reportId": "future-1",
                "userId": "usr_1",
                "sourceId": "node-under-test",
                "totalBytes": 10,
                "observedAt": 1_000,
            }],
        }
        path.write_text(json.dumps(initial), encoding="utf-8")

        with patch.object(agent, "api_base", return_value="https://control.example"), \
             patch.object(agent, "env", return_value="node-under-test"), \
             patch.object(agent, "xray_binary", return_value=Path("/xray")), \
             patch.object(agent, "require_commands", return_value={}), \
             patch.object(
                 agent,
                 "fetch_roster",
                 return_value=("node-under-test", 100, [], False),
             ), \
             patch.object(
                 agent,
                 "reconcile_and_read_stable",
                 return_value=(0, 0, set(), {}, None),
             ) as reconcile, \
             patch.object(agent, "acknowledge_roster"), \
             patch.object(agent, "deliver_queue", return_value=(1, 0)) as deliver:
            with self.assertRaises(agent.Refusal):
                agent.run_once(path)

        reconcile.assert_not_called()
        deliver.assert_not_called()
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), initial)

    def test_a_queued_report_is_superseded_only_within_its_own_source(self) -> None:
        # Collapsing the queue across sources would drop one exit's figure in
        # favour of another's, which is the same fault as folding with MAX.
        queued = [
            {"reportId": "a1", "userId": "usr_1", "sourceId": "exit-a", "totalBytes": 300},
            {"reportId": "b1", "userId": "usr_1", "sourceId": "exit-b", "totalBytes": 700},
        ]
        fresh = [
            {"reportId": "a2", "userId": "usr_1", "sourceId": "exit-a", "totalBytes": 450},
        ]
        merged = agent.merge_reports(queued, fresh)
        self.assertEqual(
            {(report["sourceId"], report["totalBytes"]) for report in merged},
            {("exit-a", 450), ("exit-b", 700)},
        )

    def test_a_report_without_a_source_keeps_its_place_in_the_queue(self) -> None:
        # A state file written before this agent named its source still holds
        # reports without one. They belong to the legacy source and are delivered,
        # not dropped.
        queued = [{"reportId": "old", "userId": "usr_1", "totalBytes": 900}]
        merged = agent.merge_reports(queued, [])
        self.assertEqual(merged, queued)

    def test_traffic_on_the_shared_credential_is_never_queued(self) -> None:
        queued = [{"reportId": "x", "userId": agent.LEGACY_CLIENT_EMAIL, "totalBytes": 900}]
        self.assertEqual(agent.merge_reports(queued, []), [])


class ReconcileSafety(unittest.TestCase):
    def setUp(self) -> None:
        self.calls: list[list[str]] = []
        self.result = type("Result", (), {"returncode": 0, "stderr": ""})

        def fake_run(_binary, arguments):
            self.calls.append(arguments)
            return self.result

        patcher = patch.object(agent, "run_xray", fake_run)
        patcher.start()
        self.addCleanup(patcher.stop)

    def reconcile(self, roster, listed, recorded):
        return agent.reconcile(
            Path("/unused"),
            {"add_user": "adu", "remove_user": "rmu"},
            "127.0.0.1:10085",
            "tono-vless",
            roster,
            listed,
            recorded,
        )

    def test_a_verified_empty_roster_removes_only_managed_clients(self) -> None:
        added, removed, installed = self.reconcile([], {"u:usr_1", agent.LEGACY_CLIENT_EMAIL}, None)
        self.assertEqual((added, removed), (0, 1))
        self.assertEqual(installed, {agent.LEGACY_CLIENT_EMAIL})
        self.assertEqual(len(self.calls), 1)
        self.assertIn("--email=u:usr_1", self.calls[0])

    def test_an_empty_roster_with_no_installed_inventory_removes_nothing(self) -> None:
        added, removed, installed = self.reconcile([], None, None)
        self.assertEqual((added, removed), (0, 0))
        self.assertIsNone(installed)
        self.assertEqual(self.calls, [])

    def test_an_empty_roster_uses_the_durable_inventory_when_listing_is_unavailable(self) -> None:
        added, removed, installed = self.reconcile([], None, {"u:usr_1"})
        self.assertEqual((added, removed), (0, 1))
        self.assertEqual(installed, set())
        self.assertIn("--email=u:usr_1", self.calls[0])

    def test_nothing_is_removed_when_the_installed_set_is_unknown(self) -> None:
        # Counters used to stand in for this. They are created on first connect
        # and outlive the client, so every active customer looked removable — and
        # removal is the disconnect path.
        added, removed, installed = self.reconcile(
            [{"userId": "usr_1", "clientUUID": "11111111-1111-4111-8111-111111111111"}],
            None,
            None,
        )
        self.assertEqual(removed, 0)
        self.assertEqual(added, 1)
        self.assertIsNone(installed)
        self.assertTrue(all("rmu" not in call for call in self.calls))

    def test_dual_phase_remembers_shared_legacy_until_it_is_retired(self) -> None:
        added, removed, installed = self.reconcile(
            [{"userId": "usr_1", "clientUUID": "11111111-1111-4111-8111-111111111111"}],
            {"u:usr_1", agent.LEGACY_CLIENT_EMAIL},
            None,
        )

        self.assertEqual((added, removed), (0, 0))
        self.assertEqual(installed, {"u:usr_1", agent.LEGACY_CLIENT_EMAIL})

    def test_an_account_still_on_the_roster_is_never_removed(self) -> None:
        added, removed, _ = self.reconcile(
            [{"userId": "usr_1", "clientUUID": "11111111-1111-4111-8111-111111111111"}],
            {"u:usr_1"},
            {"u:usr_1"},
        )
        self.assertEqual((added, removed), (0, 0))
        self.assertEqual(self.calls, [])

    def test_a_rotated_device_credential_removes_the_old_generation_before_adding_the_new_one(self) -> None:
        old_uuid = "11111111-1111-4111-8111-111111111111"
        new_uuid = "22222222-2222-4222-8222-222222222222"
        old_label = agent.client_label("usr_1", "device_1", old_uuid)
        new_label = agent.client_label("usr_1", "device_1", new_uuid)

        added, removed, installed = self.reconcile(
            [{"userId": "usr_1", "deviceId": "device_1", "clientUUID": new_uuid}],
            {old_label},
            {old_label},
        )

        self.assertEqual((added, removed), (1, 1))
        self.assertEqual(installed, {new_label})
        self.assertIn(f"--email={old_label}", self.calls[0])
        self.assertIn("rmu", self.calls[0])
        self.assertIn(f"--email={new_label}", self.calls[1])
        self.assertIn(f"--uuid={new_uuid}", self.calls[1])
        self.assertIn("adu", self.calls[1])

    def test_only_this_agent_s_own_namespace_is_ever_removed(self) -> None:
        added, removed, _ = self.reconcile(
            [{"userId": "usr_1", "clientUUID": "11111111-1111-4111-8111-111111111111"}],
            {"u:usr_1", "u:usr_gone", agent.LEGACY_CLIENT_EMAIL, "ops-laptop"},
            None,
        )
        self.assertEqual((added, removed), (0, 1))
        removals = [call for call in self.calls if "rmu" in call]
        self.assertEqual(len(removals), 1)
        self.assertIn("--email=u:usr_gone", removals[0])

    def test_the_installed_label_is_the_prefixed_one(self) -> None:
        self.reconcile(
            [{"userId": "usr_1", "clientUUID": "11111111-1111-4111-8111-111111111111"}],
            set(),
            None,
        )
        additions = [call for call in self.calls if "adu" in call]
        self.assertEqual(len(additions), 1)
        self.assertIn("--email=u:usr_1", additions[0])
        self.assertIn("--uuid=11111111-1111-4111-8111-111111111111", additions[0])

    def test_a_client_already_present_is_not_counted_as_an_addition(self) -> None:
        # Adds are attempted whenever the node cannot be asked what it holds,
        # because clients added over the API do not survive a restart. Counting
        # them would print the whole roster as added on every run.
        self.result = type("Result", (), {"returncode": 1, "stderr": "User already exists."})
        added, removed, _ = self.reconcile(
            [{"userId": "usr_1", "clientUUID": "11111111-1111-4111-8111-111111111111"}],
            None,
            None,
        )
        self.assertEqual((added, removed), (0, 0))


class InstalledClients(unittest.TestCase):
    def listing(self, returncode: int, stdout: str, commands=None) -> set[str] | None:
        result = type("Result", (), {"returncode": returncode, "stdout": stdout, "stderr": ""})
        with patch.object(agent, "run_xray", return_value=result):
            return agent.installed_clients(
                Path("/unused"),
                {"list_users": "inbounduser"} if commands is None else commands,
                "127.0.0.1:10085",
                "tono-vless",
            )

    def test_an_xray_without_the_listing_command_says_it_does_not_know(self) -> None:
        self.assertIsNone(self.listing(0, "{}", commands={}))

    def test_a_failed_or_unreadable_listing_says_it_does_not_know(self) -> None:
        # Unknown removes nothing; empty would remove everything.
        self.assertIsNone(self.listing(1, ""))
        self.assertIsNone(self.listing(0, "not json"))
        self.assertIsNone(self.listing(0, '{"users": ["u:usr_1"]}'))
        self.assertIsNone(self.listing(0, '{"users": [{"email": "u:usr_1"}, {}]}'))
        self.assertIsNone(self.listing(0, '{"users": [{"email": null}]}'))
        self.assertIsNone(self.listing(0, '{"users": [{"email": 42}]}'))

    def test_labels_come_back_in_the_form_the_control_plane_issues(self) -> None:
        listed = self.listing(
            0, '{"users": [{"email": "u:usr_1"}, {"email": "shared-legacy"}]}'
        )
        self.assertEqual(listed, {"u:usr_1", "shared-legacy"})


class RunLock(unittest.TestCase):
    def test_an_overlapping_run_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            with agent.agent_run_lock(path):
                with self.assertRaisesRegex(agent.Refusal, "another exit-agent run"):
                    with agent.agent_run_lock(path):
                        self.fail("the second run acquired the same state lock")


class StableXrayRead(unittest.TestCase):
    def test_a_restart_during_the_read_reconciles_and_reads_the_new_process_again(self) -> None:
        with patch.object(agent, "xray_start_marker", side_effect=["old", "new", "new", "new"]), \
             patch.object(agent, "installed_clients", side_effect=[set(), set()]), \
             patch.object(agent, "reconcile", side_effect=[
                 (1, 0, {"u:usr_1"}),
                 (1, 0, {"u:usr_1"}),
             ]) as reconcile, \
             patch.object(agent, "read_counters", side_effect=[
                 {"u:usr_1": 150},
                 {"u:usr_1": 120},
             ]):
            result = agent.reconcile_and_read_stable(
                Path("/unused"),
                {"stats_query": "stats", "add_user": "add", "remove_user": "remove"},
                "127.0.0.1:10085",
                "tono-vless",
                [{"userId": "usr_1", "clientUUID": "11111111-1111-4111-8111-111111111111"}],
                None,
            )
        self.assertEqual(result, (1, 0, {"u:usr_1"}, {"u:usr_1": 120}, "new"))
        self.assertEqual(reconcile.call_count, 2)


class Delivery(unittest.TestCase):
    def setUp(self) -> None:
        self.sent: list[list[dict]] = []
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "state.json"
        patcher = patch.object(agent.time, "sleep")
        patcher.start()
        self.addCleanup(patcher.stop)

    def queue(self, count: int) -> list[dict]:
        return [
            {
                "reportId": f"r{index}", "userId": f"usr_{index}", "sourceId": "exit-a",
                "totalBytes": 10 + index, "observedAt": 1,
            }
            for index in range(count)
        ]

    def deliver_queue(self, state: dict, responder) -> tuple[int, int]:
        with patch.object(agent, "deliver", side_effect=responder) as call:
            self.call = call
            return agent.deliver_queue("https://example.invalid", "token", self.path, state)

    def test_a_round_larger_than_one_request_is_delivered_in_batches(self) -> None:
        # A round over the server's limit used to be refused outright and never
        # sent, which stopped the meter until somebody noticed.
        state = fresh_state()
        state["pendingReports"] = self.queue(agent.BATCH_SIZE + 5)
        delivered, dropped = self.deliver_queue(state, lambda *_: None)
        self.assertEqual((delivered, dropped), (agent.BATCH_SIZE + 5, 0))
        self.assertEqual(state["pendingReports"], [])
        self.assertEqual([len(call.args[2]) for call in self.call.call_args_list],
                         [agent.BATCH_SIZE, 5])

    def test_a_failure_partway_keeps_what_was_already_delivered(self) -> None:
        state = fresh_state()
        state["pendingReports"] = self.queue(agent.BATCH_SIZE + 5)
        attempts: list[int] = []

        def responder(_base, _token, reports):
            attempts.append(len(reports))
            if len(attempts) > 1:
                raise agent.Unreachable("no route to host")

        with self.assertRaises(agent.Unreachable):
            self.deliver_queue(state, responder)
        # The delivered batch is gone from the queue and the rest is still in it,
        # on disk: the whole round used to be discarded together.
        self.assertEqual(len(state["pendingReports"]), 5)
        self.assertEqual(
            len(json.loads(self.path.read_text(encoding="utf-8"))["pendingReports"]), 5
        )

    def test_one_report_the_server_refuses_does_not_block_the_rest(self) -> None:
        # A permanent rejection used to wedge the meter: the same batch was
        # offered every run and refused every run. The figure is cumulative, but
        # an idle account has no "next" growth: forget only its local reported
        # watermark so the same cumulative total is regenerated next round.
        state = fresh_state()
        state["pendingReports"] = self.queue(4)
        state["userTotals"] = {
            report["userId"]: report["totalBytes"]
            for report in state["pendingReports"]
        }

        def responder(_base, _token, reports):
            if any(report["userId"] == "usr_2" for report in reports):
                raise agent.Rejection("400 VALIDATION_ERROR")

        delivered, dropped = self.deliver_queue(state, responder)
        self.assertEqual((delivered, dropped), (3, 1))
        self.assertEqual(state["pendingReports"], [])
        self.assertNotIn("usr_2", state["userTotals"])
        self.assertEqual(state["userTotals"]["usr_1"], 11)

    def test_a_transient_failure_is_retried_rather_than_losing_the_round(self) -> None:
        import io
        from contextlib import contextmanager

        attempts = {"count": 0}
        requests = []

        @contextmanager
        def fake_urlopen(_request, timeout=None):  # noqa: ARG001
            attempts["count"] += 1
            requests.append(_request)
            if attempts["count"] < 3:
                raise urllib.error.URLError("connection reset")
            yield io.BytesIO(b"{}")

        with patch.object(agent, "open_control_plane", fake_urlopen):
            agent.deliver("https://example.invalid", "token", self.queue(1))
        self.assertEqual(attempts["count"], 3)
        self.assertEqual(len({id(request) for request in requests}), 3)

    def test_a_failure_that_does_not_pass_is_given_up_on_and_stays_queued(self) -> None:
        attempts = {"count": 0}

        def fake_urlopen(_request, timeout=None):  # noqa: ARG001
            attempts["count"] += 1
            raise urllib.error.URLError("connection reset")

        with patch.object(agent, "open_control_plane", fake_urlopen):
            with self.assertRaises(agent.Unreachable):
                agent.deliver("https://example.invalid", "token", self.queue(1))
        self.assertEqual(attempts["count"], agent.DELIVERY_ATTEMPTS)

    def test_a_rejection_is_not_retried(self) -> None:
        def fake_urlopen(_request, timeout=None):  # noqa: ARG001
            raise urllib.error.HTTPError(
                "https://example.invalid", 400, "Bad Request", {}, None
            )

        with patch.object(agent, "open_control_plane", fake_urlopen):
            with self.assertRaises(agent.Rejection):
                agent.deliver("https://example.invalid", "token", self.queue(1))

    def test_a_rejected_token_keeps_the_queue_instead_of_discarding_it(self) -> None:
        # Splitting a batch down and dropping what is refused is right when the
        # batch is what is wrong. A rotated token would otherwise discard every
        # account's measurement one report at a time.
        def fake_urlopen(_request, timeout=None):  # noqa: ARG001
            raise urllib.error.HTTPError(
                "https://example.invalid", 401, "Unauthorized", {}, None
            )

        state = fresh_state()
        state["pendingReports"] = self.queue(3)
        with patch.object(agent, "open_control_plane", fake_urlopen):
            with self.assertRaises(agent.Refusal):
                agent.deliver_queue("https://example.invalid", "token", self.path, state)
        self.assertEqual(len(state["pendingReports"]), 3)


class ApiHelpParsing(unittest.TestCase):
    def test_tab_indented_xray_help_lists_handler_commands(self) -> None:
        help_text = (
            "xray api provides tools to manipulate Xray via its API.\n"
            "Usage:\n"
            "\txray api <command> [arguments]\n"
            "The commands are:\n"
            "\trestartlogger          Restart the logger\n"
            "\tstatsquery             Query statistics\n"
            "\tadu                    Add users to inbounds\n"
            "\trmu                    Remove users from inbounds\n"
            "\tinbounduser            Get users in an inbound\n"
        )

        class Result:
            stdout = ""
            stderr = help_text
            returncode = 2

        with patch.object(agent, "run_xray", return_value=Result()):
            found = agent.supported_api_commands(Path("/unused"))
            resolved = agent.require_commands(Path("/unused"))
        self.assertIn("adu", found)
        self.assertIn("rmu", found)
        self.assertIn("statsquery", found)
        self.assertEqual(resolved["list_users"], "inbounduser")

    def test_an_xray_without_the_listing_command_still_reconciles(self) -> None:
        # The listing is what makes removal safe, not what makes the agent work.
        # Requiring it would take metering off every node that has an older
        # build; its absence removes nothing instead.
        help_text = (
            "\tstatsquery             Query statistics\n"
            "\tadu                    Add users to inbounds\n"
            "\trmu                    Remove users from inbounds\n"
        )

        class Result:
            stdout = ""
            stderr = help_text
            returncode = 2

        with patch.object(agent, "run_xray", return_value=Result()):
            resolved = agent.require_commands(Path("/unused"))
        self.assertNotIn("list_users", resolved)

    def test_device_scoped_client_labels_and_attributed_user(self) -> None:
        credential = "11111111-1111-4111-8111-111111111111"
        label = agent.client_label("user123", "device456", credential)
        self.assertEqual(
            label,
            "u:user123:device456:"
            "bd7662a5eeb41614e720d477abfcb2272e19a8a70a93b7e3bc8560d44ad326e9",
        )
        self.assertNotIn(credential, label)
        self.assertEqual(agent.attributed_user(label), "user123")
        self.assertNotEqual(
            label,
            agent.client_label(
                "user123", "device456", "22222222-2222-4222-8222-222222222222"
            ),
        )

        # Legacy without device_id
        legacy_label = agent.client_label("user123")
        self.assertEqual(legacy_label, "u:user123")
        self.assertEqual(agent.attributed_user(legacy_label), "user123")

    def test_reconcile_supports_multiple_devices_for_same_user(self) -> None:
        roster = [
            {"userId": "userA", "deviceId": "dev1", "clientUUID": "00000000-0000-0000-0000-000000000001"},
            {"userId": "userA", "deviceId": "dev2", "clientUUID": "00000000-0000-0000-0000-000000000002"},
            {"userId": "userB", "deviceId": "dev3", "clientUUID": "00000000-0000-0000-0000-000000000003"},
        ]
        wanted = {
            agent.client_label(e["userId"], e.get("deviceId"), e["clientUUID"]): e["clientUUID"]
            for e in roster
        }
        self.assertEqual(len(wanted), 3)
        self.assertEqual({agent.attributed_user(label) for label in wanted}, {"userA", "userB"})
        self.assertTrue(
            all(
                not any(entry["clientUUID"] in label for label in wanted)
                for entry in roster
            )
        )

    def test_multi_device_usage_is_summed_into_single_user_report(self) -> None:
        device_a1 = agent.client_label(
            "userA", "dev1", "00000000-0000-0000-0000-000000000001"
        )
        device_a2 = agent.client_label(
            "userA", "dev2", "00000000-0000-0000-0000-000000000002"
        )
        device_b = agent.client_label(
            "userB", "dev3", "00000000-0000-0000-0000-000000000003"
        )
        totals = {
            device_a1: 300,
            device_a2: 700,
            device_b: 500,
        }
        aggregated = agent.aggregate_user_totals(totals)
        self.assertEqual(aggregated["userA"], 1000)
        self.assertEqual(aggregated["userB"], 500)

        reports = [
            {"userId": "userA", "sourceId": "node1", "totalBytes": 1000, "reportId": "r1"},
            {"userId": "userB", "sourceId": "node1", "totalBytes": 500, "reportId": "r2"},
        ]
        merged = agent.merge_reports([], reports)
        self.assertEqual(len(merged), 2)
        userA_rep = next(r for r in merged if r["userId"] == "userA")
        self.assertEqual(userA_rep["totalBytes"], 1000)

    def test_retire_shared_legacy_removes_shared_legacy_when_requested(self) -> None:
        class Result:
            returncode = 0
            stdout = ""
            stderr = ""

        removed_labels: list[str] = []
        def mock_run_xray(binary, args):
            for arg in args:
                if arg.startswith("--email="):
                    removed_labels.append(arg.split("=", 1)[1])
            return Result()

        commands = {"add_user": "adu", "remove_user": "rmu", "stats_query": "stats"}
        with patch.object(agent, "run_xray", side_effect=mock_run_xray):
            agent.reconcile(
                Path("/unused"), commands, "127.0.0.1:10085", "inbound",
                [], {"shared-legacy", "u:old_user"}, None,
                retire_shared_legacy=False,
            )
            self.assertIn("u:old_user", removed_labels)
            self.assertNotIn("shared-legacy", removed_labels)

            removed_labels.clear()

            agent.reconcile(
                Path("/unused"), commands, "127.0.0.1:10085", "inbound",
                [], {"shared-legacy", "u:old_user"}, None,
                retire_shared_legacy=True,
            )
            self.assertIn("u:old_user", removed_labels)
            self.assertIn("shared-legacy", removed_labels)


if __name__ == "__main__":
    unittest.main()
