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
    expect(resolveTonoGuard(status('signedOut'), '/tray')).toBeNull()
  })

  it('does not send a ready session away from the tray flyout', () => {
    expect(resolveTonoGuard(status('ready'), '/tray')).toBeNull()
  })
})
