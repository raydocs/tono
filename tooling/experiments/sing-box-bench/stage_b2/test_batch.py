"""Offline orchestration checks; no product state machine or network calls."""
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import batch


class BatchTest(unittest.TestCase):
    def test_boolean_arguments_and_failed_worker_cannot_pass(self):
        experiment = batch.Experiment.__new__(batch.Experiment)
        experiment.prefix = ["nsenter", "-t", "123", "-n"]
        experiment.args = SimpleNamespace(workload="synthetic-workload")
        experiment.creds = Path("/synthetic")
        with patch.object(batch, "command", return_value={
            "stdout": json.dumps({"status": "PASS", "samples": []}), "stderr": "",
            "status": "FAIL", "exit_code": 1, "elapsed_ms": 12}) as execute:
            value = experiment.https("batch", reuse=False, count=24)
            self.assertEqual(value["status"], "FAIL")
            self.assertIn("-reuse=false", execute.call_args.args[0])
            self.assertNotIn("false", execute.call_args.args[0])
        with patch.object(batch, "command", return_value={
            "stdout": "", "stderr": "", "status": "TIMEOUT", "exit_code": -9, "elapsed_ms": 45000}):
            value = experiment.https("batch", count=24)
            self.assertEqual(value["status"], "TIMEOUT")
            self.assertEqual(value["samples"], [])

    def test_fixed_small_traffic_plan(self):
        self.assertEqual(sum(spec["count"] for _, spec in batch.REALITY_CASES + batch.HY2_CASES), 178)
        self.assertLess(batch.payload_budget(), 240 << 20)
        self.assertEqual(batch.payload_budget(), 202530816)


if __name__ == "__main__":
    unittest.main()
