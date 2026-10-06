import {
  setMotionPreference,
  useAppearancePreferences,
} from '@/tono-ui/appearance-preferences'

/** Show the existing bounded probe, not a second or continuous frame loop. */
export const HomePreviewDiagnostics = () => {
  const preferences = useAppearancePreferences()
  const quality =
    preferences.motion === 'auto'
      ? preferences.automaticQuality
      : preferences.motion
  const report = preferences.report
  return (
    <aside
      style={{
        position: 'absolute',
        top: 12,
        right: 16,
        zIndex: 10,
        padding: 10,
        borderRadius: 8,
        background: '#11111b',
        color: '#d8d9e2',
        font: '11px/1.5 monospace',
        maxWidth: 280,
        overflowWrap: 'anywhere',
      }}
    >
      <output
        data-testid="tono-home-preview-readout"
        data-probe-complete={preferences.measured}
      >
        {quality} · fps {report ? report.fps.toFixed(1) : '—'} · p95{' '}
        {report ? `${report.p95.toFixed(1)} ms` : '—'}
        <br />
        {report?.renderer ?? 'Not sampled'}
        <br />
        {preferences.measured
          ? 'Finished — frame script stopped'
          : quality === 'static'
            ? 'Static — no frame sampling'
            : 'Sampling once for 3 s'}
      </output>
      <button
        type="button"
        data-preview-remeasure
        onClick={() => setMotionPreference(preferences.motion)}
        style={{
          display: 'block',
          marginTop: 8,
          padding: '4px 8px',
          color: 'inherit',
          background: '#24242b',
          border: 0,
          borderRadius: 4,
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        Measure 3 s
      </button>
    </aside>
  )
}
