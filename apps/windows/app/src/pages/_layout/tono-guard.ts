import type { TonoStatus } from '@/services/tono'

export type TonoGuardAction =
  | 'loading'
  | 'toLogin'
  | 'toHome'
  | 'toIntro'
  | null

export const TONO_INTRO_SEEN_KEY = 'tono.introSeen'

export const readTonoIntroSeen = (): boolean => {
  try {
    return globalThis.localStorage.getItem(TONO_INTRO_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export const writeTonoIntroSeen = (): void => {
  try {
    globalThis.localStorage.setItem(TONO_INTRO_SEEN_KEY, '1')
  } catch {
    // Private mode / quota: the session still proceeds to login.
  }
}

/**
 * The Tono auth guard decision, pure so it can be pinned by contract tests.
 *
 * - Status not yet read, or the backend mid-restore: nothing is decidable, the
 *   layout shows a loading placeholder instead of the full UI.
 * - First-run signed-out, intro not yet seen: the intro screen owns the UI.
 *   Signed-in accounts never see it. `localStorage` is read by the caller.
 * - No usable account (signedOut/suspended/error), or mid sign-in
 *   (`authenticating`): the login screen owns the UI. `authenticating` must NOT
 *   be treated as loading — the backend flips to it the moment a sign-in code
 *   is requested and stays there until verify, so swapping in a spinner would
 *   unmount the form (and the resend countdown) mid sign-in and deadlock the
 *   flow.
 * - Ready account on /login or /intro: pushed back to the dashboard.
 */
export const resolveTonoGuard = (
  status: TonoStatus | undefined,
  pathname: string,
  introSeen: boolean,
): TonoGuardAction => {
  const accountState = status?.accountState

  if (!status || accountState === 'restoring') {
    return pathname === '/tray' ? null : 'loading'
  }

  // The tray flyout is its own window; it must not be hijacked onto /login.
  if (pathname === '/tray') {
    return null
  }

  const loginOwned =
    accountState === 'signedOut' ||
    accountState === 'suspended' ||
    accountState === 'error' ||
    accountState === 'authenticating'
  if (loginOwned) {
    const showIntro = accountState === 'signedOut' && !introSeen
    if (showIntro) {
      return pathname === '/intro' ? null : 'toIntro'
    }
    if (pathname === '/intro') {
      return 'toLogin'
    }
    if (pathname !== '/login') {
      return 'toLogin'
    }
    return null
  }

  if (
    accountState === 'ready' &&
    (pathname === '/login' || pathname === '/intro')
  ) {
    return 'toHome'
  }

  return null
}
