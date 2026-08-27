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

    def test_empty_roster_does_not_remove_anyone(self) -> None:
        added, removed, installed = self.reconcile([], {"u:usr_1", agent.LEGACY_CLIENT_EMAIL}, None)
        self.assertEqual((added, removed), (0, 0))
        self.assertIsNone(installed)
        self.assertEqual(self.calls, [])

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

    def test_labels_come_back_in_the_form_the_control_plane_issues(self) -> None:
        listed = self.listing(
            0, '{"users": [{"email": "u:usr_1"}, {"email": "shared-legacy"}]}'
        )
        self.assertEqual(listed, {"u:usr_1", "shared-legacy"})


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


if __name__ == "__main__":
    unittest.main()
