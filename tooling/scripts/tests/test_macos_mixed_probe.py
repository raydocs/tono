"""Exercise the production Swift mixed-path probe against a loopback-only fake proxy."""
from pathlib import Path
import json
import socket
import subprocess
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[3]
SERVICES = ROOT / 'apps/macos/Tono/Services'

class MixedProbeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='tono-mixed-probe-')
        root = Path(cls.tmp.name)
        harness = root / 'Harness.swift'
        harness.write_text('''import Foundation
@main struct Harness {
    static func main() async throws {
        let result = await ProtectedConnectivityVerifier.httpsGetThroughMixedProxy(
            host: "probe.invalid", path: "/generate_204",
            proxyPort: Int(CommandLine.arguments[1])!, expectedStatus: 204, timeout: 2)
        let data = try JSONSerialization.data(withJSONObject: [
            "success": result.category == .success,
            "category": result.category.rawValue,
            "status": result.status as Any? ?? NSNull()])
        print(String(decoding: data, as: UTF8.self))
    }
}
''')
        cls.binary = root / 'probe'
        subprocess.run(['xcrun', 'swiftc', '-parse-as-library', *[
            str(SERVICES / f) for f in ['ProtectedConnectivity.swift',
                'ProtectedConnectivityVerifier.swift', 'ProtectedDNSProbe.swift']],
            str(harness), '-o', str(cls.binary)], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def probe(self, response):
        requests = []
        with socket.socket() as server:
            server.bind(('127.0.0.1', 0))
            server.listen()
            server.settimeout(8)
            def serve():
                with server.accept()[0] as client:
                    client.settimeout(3)
                    request = b''
                    while b'\r\n\r\n' not in request:
                        chunk = client.recv(4096)
                        if not chunk:
                            break
                        request += chunk
                    requests.append(request)
                    client.sendall(response)
            worker = threading.Thread(target=serve, daemon=True)
            worker.start()
            run = subprocess.run([str(self.binary), str(server.getsockname()[1])],
                                 capture_output=True, text=True, timeout=10, check=True)
            worker.join(4)
        self.assertFalse(worker.is_alive())
        self.assertTrue(requests and requests[0].startswith(b'CONNECT probe.invalid:443 '), requests)
        return json.loads(run.stdout)

    def test_connect_200_without_origin_tls_is_not_success(self):
        result = self.probe(b'HTTP/1.1 200 Connection established\r\n\r\n')
        self.assertFalse(result['success'], result)
        self.assertIsNone(result['status'])

    def test_plaintext_204_after_connect_cannot_impersonate_https_origin(self):
        result = self.probe(b'HTTP/1.1 200 Connection established\r\n\r\n'
                            b'HTTP/1.1 204 No Content\r\n\r\n')
        self.assertFalse(result['success'], result)

    def test_proxy_refusal_is_not_success(self):
        result = self.probe(b'HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n')
        self.assertFalse(result['success'], result)

if __name__ == '__main__':
    unittest.main()
