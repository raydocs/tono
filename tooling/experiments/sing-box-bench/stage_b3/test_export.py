import unittest

from export import export_run


class ExportTest(unittest.TestCase):
    def test_raw_cpu_failed_streams_and_separate_idle_adjustment(self):
        def resources(ticks, elapsed):
            return {"before": {r: {"cpu_ticks": 100, "rss_kib": 100} for r in ["client", "server", "fixture"]},
                    "after": {r: {"cpu_ticks": 100+ticks, "rss_kib": 200} for r in ["client", "server", "fixture"]},
                    "window_ms": elapsed, "samples_250ms": []}
        sample = {"status": "TIMEOUT", "elapsed_ms": 4000, "done": False, "events": [
            {"index": i, "bytes": 128, "client_arrival_ms": t, "server_emit_ms": t-1, "active": 1}
            for i, t in enumerate([1, 3, 10])]}
        value = {"run_id": "test", "batch": 1, "mode": "measure", "clock_ticks_per_second": 100, "cases": [
            {"candidate": "go", "case": "idle", "status": "PASS", "resources": resources(20, 2000)},
            {"candidate": "go", "case": "fresh-h1-c1", "status": "FAIL", "concurrency": 2,
             "expected_events": 600, "samples": [sample], "resources": resources(10, 4000)}]}
        cases, streams = export_run(value)
        row = cases[1]
        self.assertEqual(row["client_cpu_ms"], 100)
        self.assertEqual(row["client_idle_adjusted_cpu_ms"], -300)  # Do not clamp or replace raw CPU.
        self.assertEqual(row["client_cpu_ms_per_stream_second"], 25)
        self.assertEqual(row["client_cpu_ms_per_event"], 100/3)
        self.assertEqual((row["complete_streams"], row["timeout_streams"], row["failed_streams"], row["missing_streams"]), (0, 1, 1, 1))
        self.assertEqual(streams[0]["arrival_gap_ms_p50"], 4.5)
        self.assertEqual(streams[0]["arrival_gap_ms_p95"], 7)
        self.assertFalse(streams[0]["complete"])
        self.assertEqual(streams[0]["payload_bytes"], 384)


if __name__ == "__main__":
    unittest.main()
