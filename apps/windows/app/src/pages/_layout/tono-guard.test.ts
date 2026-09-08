import { describe, expect, it } from 'vitest'

import type { TonoStatus } from '@/services/tono'

import { resolveTonoGuard } from './tono-guard'

const status = (accountState: TonoStatus['accountState']): TonoStatus =>
  ({
    accountState,
    uiState: 'notConnected',
    stage: null,
    stageLabel: null,
    selectedServer: null,
    protectionBlocked: false,
    killSwitch: null,
    catalogRevision: 1,
    catalogRequiresChoice: false,
    controllerGeneration: 1,
  }) as TonoStatus

describe('resolveTonoGuard', () => {
  it('leaves the tray flyout mounted while signed out', () => {
    expect(resolveTonoGuard(status('signedOut'), '/tray', false)).toBeNull()
  })

  it('does not send a ready session away from the tray flyout', () => {
    expect(resolveTonoGuard(status('ready'), '/tray', true)).toBeNull()
  })

  it('sends a first-run signed-out user to intro instead of login', () => {
    expect(resolveTonoGuard(status('signedOut'), '/', false)).toBe('toIntro')
    expect(resolveTonoGuard(status('signedOut'), '/login', false)).toBe(
      'toIntro',
    )
    expect(resolveTonoGuard(status('signedOut'), '/intro', false)).toBeNull()
  })

  it('sends a signed-out user who has seen intro to login', () => {
    expect(resolveTonoGuard(status('signedOut'), '/', true)).toBe('toLogin')
    expect(resolveTonoGuard(status('signedOut'), '/intro', true)).toBe(
      'toLogin',
    )
    expect(resolveTonoGuard(status('signedOut'), '/login', true)).toBeNull()
  })

  it('never shows intro to a signed-in user', () => {
    expect(resolveTonoGuard(status('ready'), '/intro', false)).toBe('toHome')
    expect(resolveTonoGuard(status('ready'), '/login', false)).toBe('toHome')
    expect(resolveTonoGuard(status('ready'), '/', false)).toBeNull()
  })

  it('keeps mid-sign-in and account errors on login, not intro', () => {
    expect(resolveTonoGuard(status('authenticating'), '/', false)).toBe(
      'toLogin',
    )
    expect(resolveTonoGuard(status('authenticating'), '/intro', false)).toBe(
      'toLogin',
    )
    expect(resolveTonoGuard(status('suspended'), '/', false)).toBe('toLogin')
    expect(resolveTonoGuard(status('error'), '/intro', false)).toBe('toLogin')
  })
})
