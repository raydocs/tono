"""Tests the harness, not a copied Tono state machine."""
import json
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from bench import command, main


class HarnessTests(unittest.TestCase):
    def test_empty_exception_cannot_become_success(self):
        # Exercise the real result writer/classifier without network operations.
        with tempfile.TemporaryDirectory(prefix="tono-result-selftest-") as directory:
            with patch.object(sys, "argv", ["bench.py", "smoke", "--output", directory,
                                           "--inside", "old", "--binary", "/not-used"]), \
                    patch("bench.os.getpid", return_value=1), \
                    patch("bench.os.readlink", return_value="new"), \
                    patch("bench.signal.signal"), patch("bench.check_command"), \
                    patch("bench.snapshot", return_value={}), \
                    patch("bench.smoke", side_effect=AssertionError()), patch("builtins.print"):
                self.assertEqual(main(), 1)
            result = json.loads((Path(directory) / "results.json").read_text())
            self.assertEqual(result["status"], "FAIL")

    def test_root_watchdog_cleans_namespace_after_parent_timeout(self):
        result = command([
            "sudo", "-n", "timeout", "--signal=TERM", "--kill-after=.2s", ".5s",
            "unshare", "--net", "--pid", "--mount", "--mount-proc", "--fork",
            "--kill-child=SIGKILL", sys.executable, "-c",
            'import os,time; print(os.readlink("/proc/self/ns/net"),flush=True); time.sleep(30)',
        ], .2)
        self.assertEqual(result["status"], "TIMEOUT")
        self.assertLess(result["elapsed_ms"], 2000)
        namespace = result["stdout"].strip().removeprefix("net:[").removesuffix("]")
        self.assertTrue(namespace.isdigit(), result)
        live = subprocess.check_output(["sudo", "-n", "lsns", "-t", "net", "-n", "-o", "NS"], text=True)
        self.assertNotIn(namespace, live.split())

    def test_failure_timeout_and_interrupt_are_not_success_and_reap_process(self):
        failed = command([sys.executable, "-c", "raise SystemExit(7)"])
        self.assertEqual((failed["status"], failed["exit_code"]), ("FAIL", 7))
        timed = command([sys.executable, "-c",
                         "import os,time; print(os.getpid(),flush=True); time.sleep(30)"], .15)
        self.assertEqual(timed["status"], "TIMEOUT")
        self.assertNotEqual(timed["exit_code"], 0)
        self.assertFalse(Path(f"/proc/{int(timed['stdout'])}").exists())
        with tempfile.TemporaryDirectory(prefix="tono-harness-selftest-") as directory:
            pidfile = Path(directory) / "pid"

            def interrupt(*_):
                raise KeyboardInterrupt

            old = signal.signal(signal.SIGALRM, interrupt)
            try:
                signal.setitimer(signal.ITIMER_REAL, .3)
                with self.assertRaises(KeyboardInterrupt):
                    command([sys.executable, "-c",
                             "import os,time,pathlib; "
                             f"pathlib.Path({str(pidfile)!r}).write_text(str(os.getpid())); "
                             "time.sleep(30)"], 5)
            finally:
                signal.setitimer(signal.ITIMER_REAL, 0)
                signal.signal(signal.SIGALRM, old)
            self.assertFalse(Path(f"/proc/{int(pidfile.read_text())}").exists())


if __name__ == "__main__":
    unittest.main()
