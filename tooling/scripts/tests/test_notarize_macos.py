import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('notary', Path(__file__).resolve().parents[1] / 'notarize-macos.py')
notary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notary)

class NotaryTests(unittest.TestCase):
    def run_case(self, status, code=0, structured=True):
        identifier = '9d045c57-e0ad-461a-97cc-472923390001'
        value = {'id': identifier, 'status': status, 'secret': 'never-persist'}
        submit = subprocess.CompletedProcess([], code, json.dumps(value) if structured else 'raw-never-persist', 'stderr-never-persist')
        log = subprocess.CompletedProcess([], 0, json.dumps({'issues': [{'severity': 'error', 'message': 'Missing secure timestamp', 'secret': 'never-persist'}], 'signedURL': 'never-persist'}), '')
        with tempfile.TemporaryDirectory() as directory, patch.object(notary.subprocess, 'run', side_effect=[submit, log]) as run:
            result = notary.notarize('fixture.zip', 'profile', directory)
            outputs = {p.name: p.read_text() for p in Path(directory).iterdir()}
            self.assertNotIn('never-persist', ''.join(outputs.values()))
            return result, outputs, run.call_count

    def test_accepted(self):
        result, outputs, count = self.run_case('Accepted')
        self.assertEqual((result, count), (0, 1))
        self.assertNotIn('issues.json', outputs)

    def test_invalid_preserves_issues_and_original_exit(self):
        result, outputs, count = self.run_case('Invalid', 65)
        self.assertEqual((result, count), (65, 2))
        self.assertIn('Missing secure timestamp', outputs['issues.json'])

    def test_zero_exit_is_not_acceptance(self):
        result, _, _ = self.run_case('Invalid')
        self.assertEqual(result, 65)

    def test_nonzero_exit_is_not_acceptance(self):
        result, _, _ = self.run_case('Accepted', 75)
        self.assertEqual(result, 75)

    def test_unstructured_transport_error_does_not_leak(self):
        result, outputs, count = self.run_case(None, 69, False)
        self.assertEqual((result, count), (69, 1))
        self.assertFalse(json.loads(outputs['submission.json'])['structuredResponse'])

    def test_missing_status_fails_closed(self):
        result, _, _ = self.run_case(None)
        self.assertEqual(result, 65)

if __name__ == '__main__':
    unittest.main()
