const TAURI_STYLE_NONCE_SOURCE =
  'style[data-tauri-csp-nonce-source][nonce]'

/**
 * Return the nonce Tauri placed on the marked bundled style element.
 *
 * Browsers deliberately hide a CSP nonce from `getAttribute`; the DOM `nonce`
 * property is the supported way to read it. Vite development has no injected
 * nonce, so returning undefined keeps normal web development behavior.
 */
export const getTauriStyleNonce = (): string | undefined => {
  if (typeof document === 'undefined') return undefined
  const nonce = document.querySelector<HTMLStyleElement>(
    TAURI_STYLE_NONCE_SOURCE,
  )?.nonce
  return nonce || undefined
}

/** Create a detached style element that is already authorized by Tauri's CSP. */
export const createTauriNoncedStyleElement = (): HTMLStyleElement => {
  const style = document.createElement('style')
  const nonce = getTauriStyleNonce()
  if (nonce) style.nonce = nonce
  return style
}
