import type { ReactNode } from 'react'

import { useThemeMode } from '@/services/states'

import { tonoText } from './theme'

export const PageHeader = ({
  title,
  subtitle,
  trailing,
}: {
  title: string
  subtitle?: string
  trailing?: ReactNode
}) => {
  const dark = useThemeMode() !== 'light'
  const text = tonoText(dark)

  return (
    <header className="tono-page-header">
      <div className="tono-page-header__copy">
        <h1 className="tono-page-title" style={{ color: text.primary }}>
          {title}
        </h1>
        {subtitle && (
          <p className="tono-page-subtitle" style={{ color: text.secondary }}>
            {subtitle}
          </p>
        )}
      </div>
      {trailing && <div className="tono-page-header__trailing">{trailing}</div>}
    </header>
  )
}
