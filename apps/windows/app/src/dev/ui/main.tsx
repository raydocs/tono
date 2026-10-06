import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import {
  SeaAttentionCard,
  SeaButton,
  SeaChip,
  SeaDialog,
  SeaEmpty,
  SeaField,
  SeaKeyValueRow,
  SeaPanel,
  SeaPopover,
  SeaRow,
  SeaSegmented,
  SeaSheet,
  SeaSignalBars,
  SeaSkeleton,
  SeaTabs,
  SeaTag,
  SeaToggle,
} from '@/tono-ui/SeaControls'
import { useTonoToast } from '@/tono-ui/tono-toast-context'
import { TonoToastProvider } from '@/tono-ui/TonoToast'
import '@/tono-ui/design-tokens.css'
import '@/tono-ui/tono.css'
import '@/tono-ui/sea-shell.css'

if (!import.meta.env.DEV) throw new Error('UI gallery is development-only')
export const Gallery = () => {
  const [choice, setChoice] = useState('all')
  const [checked, setChecked] = useState(true)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [sheet, setSheet] = useState(false)
  const [dialog, setDialog] = useState(false)
  const toast = useTonoToast()
  const tone =
    new URLSearchParams(location.search).get('tone') === 'warm'
      ? 'warm'
      : 'cool'
  return (
    <div
      className="tono-root"
      data-tono-theme="dark"
      data-sea-appearance="true"
      data-sea-tone={tone}
      style={{
        minHeight: '100vh',
        padding: 24,
        background:
          tone === 'warm'
            ? 'linear-gradient(#0d0a12, #1e1216)'
            : 'linear-gradient(#0a0a12, #12111e)',
      }}
    >
      <h1>Sea UI foundation · {tone}</h1>
      <div style={{ display: 'grid', gap: 16, maxWidth: 760, margin: 'auto' }}>
        <SeaPanel>
          <SeaRow>
            <SeaButton variant="primary">Primary</SeaButton>
            <SeaButton>Quiet</SeaButton>
            <SeaButton variant="text">Text</SeaButton>
            <SeaButton variant="danger">Danger</SeaButton>
            <SeaButton disabled>Disabled</SeaButton>
          </SeaRow>
          <SeaRow>
            <SeaChip>Tokyo 02 · 62 ms</SeaChip>
            <SeaTag kind="good">Verified</SeaTag>
            <SeaTag kind="attention">Attention</SeaTag>
            <SeaTag kind="danger">Error</SeaTag>
          </SeaRow>
        </SeaPanel>
        <SeaPanel>
          <SeaField label="Field" placeholder="Email" />
          <SeaField label="Search" search placeholder="Search servers" />
          <SeaField label="Disabled" disabled value="Unavailable" />
        </SeaPanel>
        <SeaPanel>
          <SeaTabs
            label="Routes"
            value={choice}
            onChange={setChoice}
            options={[
              { value: 'all', label: 'All' },
              { value: 'exit', label: 'Servers' },
            ]}
          />
          <SeaKeyValueRow label="Toggle">
            <SeaToggle
              label="Preview toggle"
              checked={checked}
              onChange={setChecked}
            />
          </SeaKeyValueRow>
          <SeaKeyValueRow label="Disabled toggle">
            <SeaToggle
              label="Disabled toggle"
              checked
              disabled
              onChange={() => {}}
            />
          </SeaKeyValueRow>
          <SeaKeyValueRow label="Motion">
            <SeaSegmented
              label="Motion"
              value={choice}
              onChange={setChoice}
              options={[
                { value: 'all', label: 'Auto' },
                { value: 'exit', label: 'Static' },
              ]}
            />
          </SeaKeyValueRow>
          <SeaKeyValueRow label="Signal levels">
            {[0, 1, 2, 3].map((level) => (
              <SeaSignalBars
                key={level}
                level={level as 0 | 1 | 2 | 3}
                label={`Signal ${level}`}
              />
            ))}
          </SeaKeyValueRow>
        </SeaPanel>
        <SeaAttentionCard>
          Existing action and recovery meaning remain intact.
        </SeaAttentionCard>
        <SeaEmpty action={<SeaButton variant="text">Retry</SeaButton>}>
          No recent activity.
        </SeaEmpty>
        <SeaSkeleton label="Loading" />
        <SeaPanel>
          <SeaRow>
            <SeaButton onClick={(event) => setAnchor(event.currentTarget)}>
              Popover
            </SeaButton>
            <SeaButton onClick={() => setSheet(true)}>Sheet</SeaButton>
            <SeaButton onClick={() => setDialog(true)}>Confirmation</SeaButton>
          </SeaRow>
          <SeaRow>
            <SeaButton onClick={() => toast('Saved', 'success')}>
              Success toast
            </SeaButton>
            <SeaButton onClick={() => toast('Needs attention', 'attention')}>
              Attention toast
            </SeaButton>
            <SeaButton onClick={() => toast('Action failed', 'error')}>
              Error toast
            </SeaButton>
          </SeaRow>
        </SeaPanel>
        <SeaPopover anchor={anchor} onClose={() => setAnchor(null)}>
          Anchored panel; Escape/outside dismiss and return focus.
        </SeaPopover>
        <SeaSheet open={sheet} onClose={() => setSheet(false)} title="Details">
          <SeaButton onClick={() => setSheet(false)}>Close</SeaButton>
        </SeaSheet>
        {dialog && (
          <SeaDialog
            dark
            title="Confirm?"
            message="Existing safe-action focus and keyboard trap."
            confirmLabel="Confirm"
            cancelLabel="Cancel"
            onConfirm={() => setDialog(false)}
            onCancel={() => setDialog(false)}
          />
        )}
      </div>
    </div>
  )
}
const mount = document.getElementById('root')
if (!mount) throw new Error('Missing gallery mount')
createRoot(mount).render(
  <div data-sea-appearance="true" data-tono-theme="dark">
    <TonoToastProvider>
      <Gallery />
    </TonoToastProvider>
  </div>,
)
