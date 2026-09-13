import unittest

from export import case_summary, distribution, summarize


class ExportTest(unittest.TestCase):
    def test_missing_and_failed_samples_remain_in_denominator(self):
        case = {"name": "cold-burst-c1", "elapsed_ms": 3002, "samples": [
            {"status": "PASS", "elapsed_ms": 2, "response_bytes": 128},
            {"status": "TIMEOUT", "elapsed_ms": 3000, "response_bytes": 64}]}
        result = {"status": "FAIL", "run_id": "synthetic-selftest", "clock_ticks_per_second": 100,
                  "rounds": [{"candidate": "mihomo", "round": 1, "cases": [case]}]}
        row = case_summary(case, 3, 100)
        self.assertEqual((row["passed"], row["failed"], row["timeouts"], row["missing"]), (1, 1, 1, 1))
        self.assertEqual(row["success_rate"], 1 / 3)
        self.assertEqual(row["verified_reply_bytes"], 128)
        summary, cases, requests, _ = summarize(result)
        self.assertEqual(summary["totals"]["expected"], 1602)
        self.assertEqual(summary["totals"]["missing"], 1600)
        self.assertEqual(len(cases), 81)
        self.assertEqual(len(requests), 2)
        self.assertEqual(summary["cases"][0]["elapsed_ms"]["p50"], 1501)
        self.assertIsNone(summary["cases"][0]["elapsed_ms"]["p95"])

    def test_nearest_rank_quantile_is_not_success_only(self):
        values = list(range(1, 20)) + [3000, 4000]
        stats = distribution(values)
        self.assertEqual(stats["p50"], 11)
        self.assertEqual(stats["p95"], 3000)
        self.assertEqual(stats["max"], 4000)


if __name__ == "__main__":
    unittest.main()
