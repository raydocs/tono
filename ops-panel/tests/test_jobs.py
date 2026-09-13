#!/usr/bin/env python3
"""Unit tests for the hub job runner. No network."""
from __future__ import annotations

import io
import json
import sys
import time
import unittest
import urllib.error
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import jobs  # noqa: E402


class FakeResponse:
    def __init__(self, status: int, body: bytes) -> None:
        self.status = status
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> FakeResponse:
        return self

    def __exit__(self, *exc: object) -> None:
        return None


class StubUrlOpen:
    def __init__(self) -> None:
        self.calls: list[object] = []
        self.queue: list[object] = []

    def add(self, status: int, body) -> None:
        raw = body if isinstance(body, (bytes, bytearray)) else json.dumps(body).encode()
        self.queue.append((int(status), bytes(raw)))

    def add_error(self, exc: BaseException) -> None:
        self.queue.append(exc)

    def __call__(self, req, timeout=None):
        self.calls.append(req)
        if not self.queue:
            raise AssertionError(f"unexpected urlopen {req.full_url}")
        item = self.queue.pop(0)
        if isinstance(item, BaseException):
            raise item
        status, raw = item
        if status == 409:
            raise urllib.error.HTTPError(
                req.full_url, 409, "Conflict", {}, io.BytesIO(raw)
            )
        if status >= 400:
            raise urllib.error.HTTPError(
                req.full_url, status, "Error", {}, io.BytesIO(raw)
            )
        return FakeResponse(status, raw)


class FakeCollector:
    API_BASE = "https://api.example.test"
    BASE = Path("/tmp/tono-ops-jobs-test")

    def __init__(self) -> None:
        self.logs: list[str] = []
        self.token = "collector-token-collector-token"

    def collector_token(self) -> str:
        return self.token

    def log(self, msg: str) -> None:
        self.logs.append(str(msg))

    def load_config(self):
        return (
            [{"name": "Tokyo · Kite", "host": "198.51.100.4", "password": "secret", "port": 22}],
            [],
        )

    def acquire_lock(self, path):
        raise AssertionError("tests must pass acquire_lock=False")

    def probe_home_lines(self, token, home_exit_id=None):
        return []

    def put_snapshot(self, token, body):
        return True


class FakeIngest:
    def __init__(self, leased: list[dict], lease_id: str = "lease-1") -> None:
        self.leased = leased
        self.lease_id = lease_id
        self.heartbeats: list[tuple[str, str]] = []
        self.results: list[dict] = []
        self.lease_error: Exception | None = None
        self.result_error: Exception | None = None
        self.result_conflict = False

    def lease(self, max_jobs: int) -> dict:
        if self.lease_error:
            raise self.lease_error
        return {
            "leaseId": self.lease_id,
            "leaseExpiresAt": 1_800_000_000,
            "jobs": self.leased[:max_jobs],
        }

    def heartbeat(self, job_id: str, lease_id: str) -> str:
        self.heartbeats.append((job_id, lease_id))
        return "ok"

    def post_result(self, job_id, lease_id, status, summary, result) -> str:
        if self.result_error:
            raise self.result_error
        self.results.append({
            "id": job_id,
            "leaseId": lease_id,
            "status": status,
            "summary": summary,
            "resultJson": result,
        })
        return "conflict" if self.result_conflict else "ok"


def _headers(req) -> dict[str, str]:
    return {key.lower(): value for key, value in req.header_items()}


class DispatchTests(unittest.TestCase):
    def test_unknown_type_is_refused_without_running_a_handler(self):
        sentinel = object()
        status, summary, result = jobs.dispatch("not_a_job", {"cmd": "rm -rf /"}, sentinel)
        self.assertEqual(status, "error")
        self.assertEqual(summary, "unsupported job type on this hub")
        self.assertEqual(result, {})

    def test_worker_catalog_jobs_are_unsupported_on_the_hub(self):
        status, summary, result = jobs.dispatch("catalog_retire", {}, None)
        self.assertEqual(status, "error")
        self.assertEqual(summary, "unsupported job type on this hub")
        self.assertEqual(result, {})

    def test_agent_reinstall_is_a_fixed_error_not_an_installer(self):
        status, summary, result = jobs.dispatch("agent_reinstall", {}, None)
        self.assertEqual(status, "error")
        self.assertEqual(summary, "agent_reinstall not implemented on hub")
        self.assertEqual(result, {})

    def test_unknown_type_is_posted_and_never_sshes(self):
        ssh_calls = []

        def ssh(*_args, **_kwargs):
            ssh_calls.append(1)
            raise AssertionError("unknown types must not execute")

        ingest = FakeIngest([{
            "id": "job-unknown",
            "nodeName": "Tokyo · Kite",
            "type": "rm_rf",
            "params": {"cmd": "id"},
        }])
        code = jobs.run_jobs(
            max_jobs=5,
            collector=FakeCollector(),
            client=ingest,
            token="tok",
            nodes=[{"name": "Tokyo · Kite", "host": "198.51.100.4", "password": "x"}],
            cn_agents=[],
            ssh_fn=ssh,
            acquire_lock=False,
        )
        self.assertEqual(code, 0)
        self.assertEqual(ssh_calls, [])
        self.assertEqual(len(ingest.results), 1)
        self.assertEqual(ingest.results[0]["status"], "error")
        self.assertEqual(ingest.results[0]["summary"], "unsupported job type on this hub")


class RedactionTests(unittest.TestCase):
    def test_redacts_uuid_email_foreign_ipv4_and_password_word(self):
        uuid = "123e4567-e89b-12d3-a456-426614174000"
        raw = f"user ops@example.com uuid={uuid} ip=203.0.113.9 node=198.51.100.4 password=hunter2"
        self.assertEqual(
            jobs.redact_text(raw, "198.51.100.4"),
            "user [redacted] uuid=[redacted] ip=[redacted] node=198.51.100.4 [redacted]=hunter2",
        )

    def test_nested_values_are_redacted(self):
        out = jobs.redact_value(
            {"lines": ["reach 8.8.8.8 as admin@x.test"], "n": 1},
            allow_ip="198.51.100.4",
        )
        self.assertEqual(out["lines"], ["reach [redacted] as [redacted]"])
        self.assertEqual(out["n"], 1)

    def test_finalize_truncates_summary_to_500(self):
        status, summary, result = jobs.finalize_result("ok", "x" * 600, {})
        self.assertEqual(status, "ok")
        self.assertEqual(len(summary), 500)


class DigestTests(unittest.TestCase):
    def test_classifies_known_xray_lines(self):
        self.assertEqual(
            jobs.classify_xray_line("dial tcp 10.0.0.1:443: i/o timeout"),
            "dial_timeout",
        )
        self.assertEqual(
            jobs.classify_xray_line("REALITY: failed to complete handshake"),
            "handshake_fail",
        )
        self.assertEqual(
            jobs.classify_xray_line("authentication failed: invalid user"),
            "auth_reject",
        )
        self.assertEqual(
            jobs.classify_xray_line("read tcp: connection reset by peer"),
            "upstream_reject",
        )
        self.assertEqual(jobs.classify_xray_line("dialed something odd"), "other")

    def test_digest_counts_and_keeps_first_redacted_sample(self):
        uuid = "123e4567-e89b-12d3-a456-426614174000"
        lines = [
            "noise that should be ignored",
            f"dial tcp 203.0.113.9:443: i/o timeout uuid={uuid}",
            "dial tcp 203.0.113.9:443: i/o timeout later",
            "REALITY handshake failed from 8.8.8.8",
            "connection refused upstream",
        ]
        digest = jobs.digest_from_lines(lines, allow_ip="198.51.100.4")
        self.assertEqual(digest["counts"]["dial_timeout"], 2)
        self.assertEqual(digest["counts"]["handshake_fail"], 1)
        self.assertEqual(digest["counts"]["upstream_reject"], 1)
        self.assertEqual(digest["counts"]["other"], 0)
        self.assertNotIn(uuid, digest["samples"]["dial_timeout"])
        self.assertNotIn("203.0.113.9", digest["samples"]["dial_timeout"])
        self.assertIn("[redacted]", digest["samples"]["dial_timeout"])
        self.assertIn("REALITY", digest["samples"]["handshake_fail"])


class TruncationTests(unittest.TestCase):
    def test_drops_trailing_lines_and_sets_truncated(self):
        lines = [f"line-{i:04d} " + ("abcd" * 20) for i in range(400)]
        out = jobs.truncate_result({"lines": lines, "matched": 400, "scanned": 400})
        self.assertTrue(out.get("truncated"))
        self.assertLess(len(out["lines"]), 400)
        self.assertLessEqual(jobs.utf8_size(out), jobs.RESULT_JSON_MAX)
        self.assertEqual(out["lines"], lines[: len(out["lines"])])

    def test_small_payload_is_unchanged(self):
        body = {"lines": ["a", "b"], "matched": 2}
        self.assertEqual(jobs.truncate_result(body), body)


class IngestClientTests(unittest.TestCase):
    def test_lease_sends_bearer_executor_and_max(self):
        stub = StubUrlOpen()
        stub.add(200, {
            "leaseId": "L1",
            "leaseExpiresAt": 99,
            "jobs": [{"id": "j1", "nodeName": "n", "type": "xray_restart", "params": None}],
        })
        client = jobs.IngestClient("https://api.example.test", "secret-token", urlopen=stub)
        payload = client.lease(5)
        self.assertEqual(payload["leaseId"], "L1")
        self.assertEqual(len(stub.calls), 1)
        req = stub.calls[0]
        self.assertEqual(req.get_method(), "GET")
        parsed = urllib.parse.urlparse(req.full_url)
        self.assertEqual(parsed.path, "/api/v1/ops-ingest/jobs")
        query = urllib.parse.parse_qs(parsed.query)
        self.assertEqual(query["max"], ["5"])
        self.assertEqual(query["executor"], ["hub"])
        headers = _headers(req)
        self.assertEqual(headers["authorization"], "Bearer secret-token")
        self.assertEqual(headers["accept"], "application/json")
        self.assertIn("tono-ops-collector", headers["user-agent"])

    def test_heartbeat_and_result_bodies(self):
        stub = StubUrlOpen()
        stub.add(200, {})
        stub.add(200, {})
        client = jobs.IngestClient("https://api.example.test/", "tok", urlopen=stub)
        self.assertEqual(client.heartbeat("job-1", "lease-9"), "ok")
        self.assertEqual(
            client.post_result("job-1", "lease-9", "ok", "done", {"matched": 1}),
            "ok",
        )
        beat, result = stub.calls
        self.assertEqual(beat.get_method(), "POST")
        self.assertTrue(beat.full_url.endswith("/api/v1/ops-ingest/jobs/job-1/heartbeat"))
        self.assertEqual(json.loads(beat.data.decode()), {"leaseId": "lease-9"})
        self.assertEqual(_headers(beat)["content-type"], "application/json")
        self.assertEqual(result.get_method(), "POST")
        self.assertTrue(result.full_url.endswith("/api/v1/ops-ingest/jobs/job-1/result"))
        body = json.loads(result.data.decode())
        self.assertEqual(body, {
            "leaseId": "lease-9",
            "status": "ok",
            "summary": "done",
            "resultJson": {"matched": 1},
        })

    def test_result_409_is_conflict_not_an_exception(self):
        stub = StubUrlOpen()
        stub.add(409, {"error": "JOB_LEASE_CONFLICT"})
        client = jobs.IngestClient("https://api.example.test", "tok", urlopen=stub)
        self.assertEqual(
            client.post_result("job-1", "wrong", "ok", "done", {}),
            "conflict",
        )

    def test_heartbeat_409_is_conflict(self):
        stub = StubUrlOpen()
        stub.add(409, {})
        client = jobs.IngestClient("https://api.example.test", "tok", urlopen=stub)
        self.assertEqual(client.heartbeat("job-1", "wrong"), "conflict")

    def test_http_500_is_unreachable(self):
        stub = StubUrlOpen()
        stub.add(500, {"error": "boom"})
        client = jobs.IngestClient("https://api.example.test", "tok", urlopen=stub)
        with self.assertRaises(jobs.ControlPlaneUnreachable):
            client.lease(1)


class TimeoutTests(unittest.TestCase):
    def test_execute_bounded_returns_timeout_and_heartbeats(self):
        beats = []

        def slow():
            time.sleep(0.25)
            return ("ok", "done", {"late": True})

        status, summary, result = jobs.execute_bounded(
            slow,
            timeout=0.08,
            on_heartbeat=lambda: beats.append(1),
            interval=0.02,
        )
        self.assertEqual(status, "timeout")
        self.assertIn("timeout", summary.lower())
        self.assertEqual(result, {})
        self.assertGreaterEqual(len(beats), 1)

    def test_run_jobs_posts_timeout_status(self):
        original = jobs.HANDLERS["xray_restart"]
        original_timeout = jobs.JOB_TIMEOUTS["xray_restart"]

        def slow(_params, _ctx):
            time.sleep(0.3)
            return ("ok", "restarted", {})

        jobs.HANDLERS["xray_restart"] = slow
        jobs.JOB_TIMEOUTS["xray_restart"] = 0.05
        try:
            ingest = FakeIngest([{
                "id": "job-restart",
                "nodeName": "Tokyo · Kite",
                "type": "xray_restart",
                "params": {},
            }])
            code = jobs.run_jobs(
                max_jobs=1,
                collector=FakeCollector(),
                client=ingest,
                token="tok",
                nodes=[{"name": "Tokyo · Kite", "host": "198.51.100.4", "password": "x"}],
                cn_agents=[],
                heartbeat_interval=0.01,
                acquire_lock=False,
            )
        finally:
            jobs.HANDLERS["xray_restart"] = original
            jobs.JOB_TIMEOUTS["xray_restart"] = original_timeout
        self.assertEqual(code, 0)
        self.assertEqual(ingest.results[0]["status"], "timeout")
        self.assertGreaterEqual(len(ingest.heartbeats), 1)


class RunJobsExitTests(unittest.TestCase):
    def test_missing_token_is_nonzero(self):
        collector = FakeCollector()
        collector.token = ""
        code = jobs.run_jobs(
            collector=collector,
            client=FakeIngest([]),
            acquire_lock=False,
        )
        self.assertEqual(code, 1)

    def test_unreachable_control_plane_is_nonzero(self):
        ingest = FakeIngest([])
        ingest.lease_error = jobs.ControlPlaneUnreachable("down")
        code = jobs.run_jobs(
            collector=FakeCollector(),
            client=ingest,
            token="tok",
            acquire_lock=False,
        )
        self.assertEqual(code, 1)

    def test_handler_failure_is_still_exit_zero(self):
        ingest = FakeIngest([{
            "id": "job-reinstall",
            "nodeName": "Tokyo · Kite",
            "type": "agent_reinstall",
            "params": {},
        }])
        code = jobs.run_jobs(
            collector=FakeCollector(),
            client=ingest,
            token="tok",
            nodes=[{"name": "Tokyo · Kite", "host": "198.51.100.4", "password": "x"}],
            cn_agents=[],
            acquire_lock=False,
        )
        self.assertEqual(code, 0)
        self.assertEqual(ingest.results[0]["status"], "error")
        self.assertEqual(ingest.results[0]["summary"], "agent_reinstall not implemented on hub")

    def test_result_409_does_not_fail_the_pass(self):
        ingest = FakeIngest([{
            "id": "job-reinstall",
            "nodeName": "Tokyo · Kite",
            "type": "agent_reinstall",
            "params": None,
        }])
        ingest.result_conflict = True
        code = jobs.run_jobs(
            collector=FakeCollector(),
            client=ingest,
            token="tok",
            nodes=[{"name": "Tokyo · Kite", "host": "198.51.100.4", "password": "x"}],
            cn_agents=[],
            acquire_lock=False,
        )
        self.assertEqual(code, 0)

    def test_result_unreachable_is_nonzero(self):
        ingest = FakeIngest([{
            "id": "job-reinstall",
            "nodeName": "Tokyo · Kite",
            "type": "agent_reinstall",
            "params": {},
        }])
        ingest.result_error = jobs.ControlPlaneUnreachable("gone")
        code = jobs.run_jobs(
            collector=FakeCollector(),
            client=ingest,
            token="tok",
            nodes=[{"name": "Tokyo · Kite", "host": "198.51.100.4", "password": "x"}],
            cn_agents=[],
            acquire_lock=False,
        )
        self.assertEqual(code, 1)

    def test_dial_errors_handler_filters_and_redacts(self):
        def ssh(_node, remote, timeout=60):
            self.assertIn("journalctl -u xray", remote)
            self.assertIn('--since "-15min"', remote)
            self.assertIn("-n 20", remote)
            return 0, "\n".join([
                "unrelated info",
                "dial tcp 203.0.113.9:443: i/o timeout",
                "accepted connection",
            ])

        ingest = FakeIngest([{
            "id": "job-dial",
            "nodeName": "Tokyo · Kite",
            "type": "xray_dial_errors",
            "params": {"sinceMinutes": 15, "maxLines": 20},
        }])
        code = jobs.run_jobs(
            collector=FakeCollector(),
            client=ingest,
            token="tok",
            nodes=[{"name": "Tokyo · Kite", "host": "198.51.100.4", "password": "x"}],
            cn_agents=[],
            ssh_fn=ssh,
            acquire_lock=False,
        )
        self.assertEqual(code, 0)
        posted = ingest.results[0]
        self.assertEqual(posted["status"], "ok")
        self.assertEqual(posted["resultJson"]["matched"], 1)
        self.assertEqual(posted["resultJson"]["scanned"], 3)
        self.assertNotIn("203.0.113.9", posted["resultJson"]["lines"][0])


if __name__ == "__main__":
    unittest.main()
