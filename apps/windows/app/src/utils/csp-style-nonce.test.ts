// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import {
  createTauriNoncedStyleElement,
  getTauriStyleNonce,
} from './csp-style-nonce'

const SOURCE_SELECTOR = 'style[data-tauri-csp-nonce-source]'

afterEach(() => {
  document.querySelectorAll(SOURCE_SELECTOR).forEach((element) => element.remove())
})

describe('Tauri style CSP nonce', () => {
  it('returns undefined in ordinary web development without an injected nonce', () => {
    expect(getTauriStyleNonce()).toBeUndefined()
    expect(createTauriNoncedStyleElement().nonce).toBe('')
  })

  it('copies the packaged-app nonce before a runtime style is inserted', () => {
    const source = document.createElement('style')
    source.dataset.tauriCspNonceSource = ''
    source.nonce = 'test-tauri-nonce'
    document.head.appendChild(source)

    expect(getTauriStyleNonce()).toBe('test-tauri-nonce')
    const runtimeStyle = createTauriNoncedStyleElement()
    expect(runtimeStyle.isConnected).toBe(false)
    expect(runtimeStyle.nonce).toBe('test-tauri-nonce')
  })
})
