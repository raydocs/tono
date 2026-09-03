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
import tempfile
import unittest
import urllib.error
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
                "TONO_EXIT_SOURCE_ID": "node-under-test",
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
             patch.object(agent, "fetch_roster", return_value=(1_700_000_000, [])), \
             patch.object(agent, "installed_clients", return_value={"u:alice"}), \
             patch.object(agent, "reconcile", return_value=(0, 0, {"u:alice"})), \
             patch.object(agent, "read_counters", side_effect=readings), \
             patch.object(agent, "xray_start_marker", side_effect=markers), \
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
            "observedAt": 1,
            "identities": [{"userId": "a", "clientUUID": "not-a-uuid"}],
        }
        with self.assertRaises(agent.Refusal):
            self._parse(payload)

    def test_a_valid_roster_is_accepted(self) -> None:
        payload = {
            "observedAt": 7,
            "identities": [
                {"userId": "a", "clientUUID": "11111111-1111-4111-8111-111111111111"},
                {"userId": "b", "clientUUID": "22222222-2222-4222-8222-222222222222"},
            ],
        }
        observed_at, roster = self._parse(payload)
        self.assertEqual(observed_at, 7)
        self.assertEqual([entry["userId"] for entry in roster], ["a", "b"])

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

        original = agent.urllib.request.urlopen
        agent.urllib.request.urlopen = fake_urlopen
        try:
            return agent.fetch_roster("https://example.invalid", "token")
        finally:
            agent.urllib.request.urlopen = original


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

    def test_a_changed_source_counts_from_here_rather_than_reporting_again(self) -> None:
        # The server keeps one cumulative figure per source, so a rename is a new
        # counter starting at zero. Re-anchoring the local totals is what stops
        # the exit's whole history being billed a second time under the new name.
        state = fresh_state()
        state["sourceId"] = "old-node"
        state["totals"] = {"u:usr_1": 900}
        state["counterBaseline"] = {"u:usr_1": 900}
        with patch.object(agent, "machine_identity", return_value="new-node"):
            self.assertEqual(agent.source_id(state), "new-node")
        self.assertEqual(state["totals"], {"u:usr_1": 0})
        # And what it measures from here is only what happens from here.
        self.assertEqual(agent.lifetime_totals(state, {"u:usr_1": 950}), {"u:usr_1": 50})


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
        self.assertEqual(installed, set())
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
        self.assertEqual(installed, {"u:usr_1"})
        self.assertTrue(all("rmu" not in call for call in self.calls))

    def test_an_account_still_on_the_roster_is_never_removed(self) -> None:
        added, removed, _ = self.reconcile(
            [{"userId": "usr_1", "clientUUID": "11111111-1111-4111-8111-111111111111"}],
            {"u:usr_1"},
            {"u:usr_1"},
        )
        self.assertEqual((added, removed), (0, 0))
        self.assertEqual(self.calls, [])

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
        # offered every run and refused every run. The figure is cumulative, so
        # the account's next report carries these bytes again.
        state = fresh_state()
        state["pendingReports"] = self.queue(4)

        def responder(_base, _token, reports):
            if any(report["userId"] == "usr_2" for report in reports):
                raise agent.Rejection("400 VALIDATION_ERROR")

        delivered, dropped = self.deliver_queue(state, responder)
        self.assertEqual((delivered, dropped), (3, 1))
        self.assertEqual(state["pendingReports"], [])

    def test_a_transient_failure_is_retried_rather_than_losing_the_round(self) -> None:
        import io
        from contextlib import contextmanager

        attempts = {"count": 0}

        @contextmanager
        def fake_urlopen(_request, timeout=None):  # noqa: ARG001
            attempts["count"] += 1
            if attempts["count"] < 3:
                raise urllib.error.URLError("connection reset")
            yield io.BytesIO(b"{}")

        with patch.object(agent.urllib.request, "urlopen", fake_urlopen):
            agent.deliver("https://example.invalid", "token", self.queue(1))
        self.assertEqual(attempts["count"], 3)

    def test_a_failure_that_does_not_pass_is_given_up_on_and_stays_queued(self) -> None:
        attempts = {"count": 0}

        def fake_urlopen(_request, timeout=None):  # noqa: ARG001
            attempts["count"] += 1
            raise urllib.error.URLError("connection reset")

        with patch.object(agent.urllib.request, "urlopen", fake_urlopen):
            with self.assertRaises(agent.Unreachable):
                agent.deliver("https://example.invalid", "token", self.queue(1))
        self.assertEqual(attempts["count"], agent.DELIVERY_ATTEMPTS)

    def test_a_rejection_is_not_retried(self) -> None:
        def fake_urlopen(_request, timeout=None):  # noqa: ARG001
            raise urllib.error.HTTPError(
                "https://example.invalid", 400, "Bad Request", {}, None
            )

        with patch.object(agent.urllib.request, "urlopen", fake_urlopen):
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
        with patch.object(agent.urllib.request, "urlopen", fake_urlopen):
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
        label = agent.client_label("user123", "device456")
        self.assertEqual(label, "u:user123:device456")
        self.assertEqual(agent.attributed_user(label), "user123")

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
            agent.client_label(e["userId"], e.get("deviceId")): e["clientUUID"]
            for e in roster
        }
        self.assertEqual(len(wanted), 3)
        self.assertIn("u:userA:dev1", wanted)
        self.assertIn("u:userA:dev2", wanted)
        self.assertIn("u:userB:dev3", wanted)


if __name__ == "__main__":
    unittest.main()
