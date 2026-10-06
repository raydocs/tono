import type { ReactNode } from 'react'

/** Percentage-height home controls need a definite route containing block. */
export const SeaPageFrame = ({
  appearance,
  home,
  children,
}: {
  appearance: boolean
  home: boolean
  children: ReactNode
}) => (
  <div
    className={
      appearance
        ? `tono-sea-page-in${home ? '' : ' tono-sea-page'}`
        : 'tono-page-in'
    }
    style={{ height: appearance && home ? '100%' : undefined }}
  >
    {children}
  </div>
)
