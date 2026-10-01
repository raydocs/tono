#!/usr/bin/env python3
"""Handshake ceilings must reject a count of zero."""

import gzip
import io
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import bench
from bench import limit_failures


class HandshakeFloorTest(unittest.TestCase):
    def test_zero_handshakes_fail_while_one_stays_under_the_ceiling(self):
        rows = [
            {
                "profile": "tono-fixed",
                "protocol": "vless",
                "cold_ms": 40,
                "dns_ms": 80,
                "handshakes": 0,
                "dns_handshakes": 1,
                "fake_ip_handshakes": 0,
            },
            {
                "profile": "sing-box",
                "protocol": "vless",
                "cold_ms": 40,
                "dns_ms": 120,
                "handshakes": 1,
                "dns_handshakes": 0,
            },
            {
                "profile": "tono-fixed",
                "protocol": "hysteria2",
                "cold_ms": 4,
                "handshakes": 0,
                "fake_ip_handshakes": 0,
            },
        ]
        limits = {
            "vless/tono-fixed/cold_ms": 120,
            "vless/tono-fixed/dns_ms": 180,
            "vless/tono-fixed/handshakes": 1,
            "vless/tono-fixed/dns_handshakes": 2,
            "vless/tono-fixed/fake_ip_handshakes": 0,
            "vless/sing-box/cold_ms": 120,
            "vless/sing-box/dns_ms": 180,
            "vless/sing-box/handshakes": 1,
            "vless/sing-box/dns_handshakes": 2,
            "hysteria2/tono-fixed/cold_ms": 40,
            "hysteria2/tono-fixed/fake_ip_handshakes": 0,
        }
        failed = "\n".join(limit_failures(rows, limits))
        self.assertIn("vless/tono-fixed/handshakes", failed)
        self.assertIn("vless/sing-box/dns_handshakes", failed)
        self.assertNotIn("vless/tono-fixed/dns_handshakes", failed)
        self.assertNotIn("vless/tono-fixed/cold_ms", failed)
        self.assertNotIn("hysteria2/tono-fixed/handshakes", failed)
        self.assertNotIn("fake_ip_handshakes", failed)

        over = "\n".join(limit_failures(
            [{"profile": "tono-fixed", "protocol": "vless", "cold_ms": None, "handshakes": 2}],
            {"vless/tono-fixed/cold_ms": 120, "vless/tono-fixed/handshakes": 1},
        ))
        self.assertIn("vless/tono-fixed/cold_ms", over)
        self.assertIn("vless/tono-fixed/handshakes", over)


class BinaryCacheTest(unittest.TestCase):
    def archives(self, cache):
        (cache / "mihomo.gz").write_bytes(gzip.compress(b"fixture-mihomo"))
        with tarfile.open(cache / "sing-box.tar.gz", "w:gz") as archive:
            info = tarfile.TarInfo("sing-box-1.14.2-linux-amd64/sing-box")
            info.size = len(b"fixture-sing-box")
            archive.addfile(info, io.BytesIO(b"fixture-sing-box"))

    def test_interrupted_extraction_is_not_published_as_a_cached_executable(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            self.archives(cache)
            run = subprocess.run
            interrupted = False

            def extract(command, **kwargs):
                nonlocal interrupted
                if command[0] == "gzip" and not interrupted:
                    interrupted = True
                    kwargs["stdout"].write(b"partial")
                    raise subprocess.CalledProcessError(-15, command)
                return run(command, **kwargs)

            with mock.patch.object(bench, "CACHE", cache), mock.patch.object(bench, "download"), \
                    mock.patch.object(bench.subprocess, "run", side_effect=extract):
                with self.assertRaises(subprocess.CalledProcessError):
                    bench.ensure_bins()
                self.assertFalse((cache / "mihomo").exists())
                mihomo, sing = bench.ensure_bins()
                self.assertEqual(b"fixture-mihomo", mihomo.read_bytes())
                self.assertEqual(b"fixture-sing-box", sing.read_bytes())
                self.assertEqual(0o755, mihomo.stat().st_mode & 0o777)

    def test_an_existing_executable_cannot_override_the_current_pinned_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            self.archives(cache)
            (cache / "mihomo").write_bytes(b"previous-pin")
            (cache / "sing-box").write_bytes(b"previous-pin")
            with mock.patch.object(bench, "CACHE", cache), mock.patch.object(bench, "download"):
                mihomo, sing = bench.ensure_bins()
            self.assertEqual(b"fixture-mihomo", mihomo.read_bytes())
            self.assertEqual(b"fixture-sing-box", sing.read_bytes())


if __name__ == "__main__":
    unittest.main()
