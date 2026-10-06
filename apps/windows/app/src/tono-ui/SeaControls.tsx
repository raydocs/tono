import { Dialog, DialogContent, DialogTitle, Popover } from '@mui/material'
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react'

import { TonoConfirmDialog } from './TonoAccountCard'

type DivProps = HTMLAttributes<HTMLDivElement>
export const SeaButton = ({
  variant = 'quiet',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'quiet' | 'text' | 'danger'
}) => (
  <button
    type="button"
    {...props}
    data-variant={variant}
    className={`sea-button ${className}`}
  />
)
export const SeaChip = ({ children }: { children: ReactNode }) => (
  <span className="sea-chip">{children}</span>
)
export const SeaTag = ({
  children,
  kind = 'quiet',
}: {
  children: ReactNode
  kind?: 'quiet' | 'good' | 'attention' | 'danger'
}) => (
  <span className="sea-tag" data-kind={kind}>
    {children}
  </span>
)
export const SeaField = ({
  label,
  search = false,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string
  search?: boolean
}) => (
  <label className="sea-field-label">
    <span>{label}</span>
    <input
      {...props}
      type={search ? 'search' : props.type}
      className="sea-field"
    />
  </label>
)
export const SeaToggle = ({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) => (
  <button
    type="button"
    className="sea-toggle"
    role="switch"
    aria-label={label}
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
  >
    <span />
  </button>
)
export const SeaRow = ({ className = '', ...props }: DivProps) => (
  <div {...props} className={`sea-row ${className}`} />
)
export const SeaKeyValueRow = ({
  label,
  children,
}: {
  label: ReactNode
  children: ReactNode
}) => (
  <SeaRow className="sea-key-value">
    <span>{label}</span>
    <span>{children}</span>
  </SeaRow>
)
export const SeaPanel = ({ className = '', ...props }: DivProps) => (
  <div {...props} className={`sea-panel ${className}`} />
)
export const SeaAttentionCard = ({ children }: { children: ReactNode }) => (
  <div role="alert" className="sea-attention">
    {children}
  </div>
)
export const SeaEmpty = ({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) => (
  <div className="sea-empty">
    <p>{children}</p>
    {action}
  </div>
)
export const SeaSkeleton = ({ label }: { label: string }) => (
  <div role="status" aria-label={label} className="sea-skeleton" />
)
export const SeaSignalBars = ({
  level,
  label,
}: {
  level: 0 | 1 | 2 | 3
  label: string
}) => (
  <span className="sea-signal" role="img" aria-label={label}>
    {[4, 8, 12].map((height, index) => (
      <span key={height} style={{ height }} data-lit={index < level} />
    ))}
  </span>
)
interface ChoiceProps {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}
export const SeaTabs = ({ label, value, options, onChange }: ChoiceProps) => (
  <div role="tablist" aria-label={label} className="sea-tabs">
    {options.map((option, index) => (
      <button
        key={option.value}
        type="button"
        role="tab"
        aria-selected={value === option.value}
        tabIndex={value === option.value ? 0 : -1}
        onClick={() => onChange(option.value)}
        onKeyDown={(event) => {
          const direction =
            event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          const target =
            event.key === 'Home'
              ? options[0]
              : event.key === 'End'
                ? options[options.length - 1]
                : direction
                  ? options[
                      (index + direction + options.length) % options.length
                    ]
                  : undefined
          if (target) {
            event.preventDefault()
            onChange(target.value)
            const buttons =
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                'button',
              )
            buttons?.[options.indexOf(target)]?.focus()
          }
        }}
      >
        {option.label}
      </button>
    ))}
  </div>
)
export const SeaSegmented = ({
  label,
  value,
  options,
  onChange,
}: ChoiceProps) => (
  <fieldset aria-label={label} className="sea-segmented">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={value === option.value}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </fieldset>
)
export const SeaPopover = ({
  anchor,
  onClose,
  children,
}: {
  anchor: HTMLElement | null
  onClose: () => void
  children: ReactNode
}) => (
  <Popover
    open={Boolean(anchor)}
    anchorEl={anchor}
    onClose={onClose}
    anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
    transformOrigin={{ vertical: 'top', horizontal: 'left' }}
    slotProps={{ paper: { className: 'sea-popover' } }}
  >
    <div style={{ maxWidth: 320 }}>{children}</div>
  </Popover>
)
export const SeaSheet = ({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) => (
  <Dialog
    open={open}
    onClose={onClose}
    slotProps={{ paper: { className: 'sea-sheet' } }}
  >
    <DialogTitle>{title}</DialogTitle>
    <DialogContent>{children}</DialogContent>
  </Dialog>
)
export const SeaDialog = TonoConfirmDialog
