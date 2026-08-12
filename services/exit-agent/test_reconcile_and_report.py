#!/usr/bin/env python3
"""Tests for the parts where an error costs money.

Counters reset when xray restarts, so lifetime totals are maintained here. Get the
fold wrong in one direction and every restart forgives whatever an account had
used; get it wrong in the other and accounts are billed twice for the same bytes.
Neither is visible from the outside — the numbers simply look plausible.
"""

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
