import importlib.util
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location('mac_sea_polish_metrics',
    Path(__file__).resolve().parents[1] / 'analyze-mac-sea-polish.py')
metrics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(metrics)


class MacSeaPolishMetricsTests(unittest.TestCase):
    def test_sunset_accepts_the_designed_hold(self):
        values = [0.8, 0.7, 0.6, 0.5, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.35, 0.3, 0.25, 0.2, 0.2]
        result = metrics.transition_metrics(values, -1, night_reference=0.2)
        self.assertEqual(result['acceptance'], 'PASS')
        self.assertGreater(result['longestEqualPlateauFrames'], 2)

    def test_sunset_rejects_a_single_large_drop(self):
        values = [0.8, 0.79, 0.78, 0.77, 0.4, 0.38, 0.36, 0.34, 0.32, 0.3, 0.28, 0.26, 0.24, 0.22, 0.2, 0.2]
        self.assertEqual(metrics.transition_metrics(values, -1, night_reference=0.2)['acceptance'], 'FAIL')

    def test_sunset_rejects_rebrightening_above_one_level(self):
        values = [0.8, 0.7, 0.6, 0.5, 0.51, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.2, 0.2, 0.2, 0.2]
        self.assertFalse(metrics.transition_metrics(values, -1, night_reference=0.2)['nonIncreasingWithinTolerance'])

    def test_sunset_requires_the_night_endpoint_evidence(self):
        values = [0.8 - i * 0.04 for i in range(16)]
        self.assertEqual(metrics.transition_metrics(values, -1)['acceptance'], 'FAIL')
        self.assertEqual(metrics.transition_metrics(values, -1, night_reference=0.25)['acceptance'], 'FAIL')

    def test_rise_still_rejects_reversal_and_a_long_plateau(self):
        self.assertEqual(metrics.transition_metrics([0.1, 0.2, 0.3], 1)['acceptance'], 'PASS')
        self.assertEqual(metrics.transition_metrics([0.1, 0.09, 0.3], 1)['acceptance'], 'FAIL')
        self.assertEqual(metrics.transition_metrics([0.1, 0.1, 0.1, 0.3], 1)['acceptance'], 'FAIL')


if __name__ == '__main__':
    unittest.main()
