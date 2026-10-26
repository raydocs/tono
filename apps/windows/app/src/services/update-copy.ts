const rawOf = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error ?? '')
}

/** Same token the native download attaches. The only install failure that may be tried again. */
const DOWNLOAD_FAILED = 'TONO_UPDATE_DOWNLOAD_FAILED'

const needsAttention =
  /a prior update needs reconciliation|needs attention|TONO_UPDATE_NEEDS_ATTENTION|rollback not proven|automatic update recovery failed/i
const signatureRefusal = /signature|ed25519|minisign/i
const floorRefusal =
  /release sequence|releaseSequence|installed floor|not newer|downgrade refused|release replay/i
/** A Service refusal about the barrier, not a package that failed to download. */
const serviceNetworkWording = /network protection|barrier|filters/i
const networkFailure =
  /unreachable|timed out|timeout|network|offline|\bdns\b|connection refused|connection reset/i

const isDownloadTransport = (raw: string): boolean => raw.includes(DOWNLOAD_FAILED)

/** Anything except a marked download-phase transport failure stays blocked for this offer. */
export const updateFailureSticks = (raw: string): boolean => !isDownloadTransport(raw)

type UpdateMessageKey =
  | 'tono.update.needsAttention'
  | 'tono.update.signatureRefused'
  | 'tono.update.notNewer'
  | 'tono.update.network'
  | 'tono.update.refused'

/** Human sentence key. The raw chain stays in technical details. */
export const updateFailureMessageKey = (raw: string): UpdateMessageKey => {
  if (isDownloadTransport(raw)) return 'tono.update.network'
  if (needsAttention.test(raw)) return 'tono.update.needsAttention'
  if (signatureRefusal.test(raw)) return 'tono.update.signatureRefused'
  if (floorRefusal.test(raw)) return 'tono.update.notNewer'
  return 'tono.update.refused'
}

export const describeUpdateFailure = (
  error: unknown,
  t: (key: UpdateMessageKey) => string,
): { message: string; detail: string; sticks: boolean } => {
  const raw = rawOf(error)
  return {
    message: t(updateFailureMessageKey(raw)),
    detail: raw,
    sticks: updateFailureSticks(raw),
  }
}

/** Check-for-updates notice. A barrier refusal is not a dropped download. */
export const updateCheckNoticeKey = (raw: string): string => {
  if (needsAttention.test(raw)) return 'tono.update.needsAttention'
  if (serviceNetworkWording.test(raw)) return 'tono.update.checkUnknown'
  if (networkFailure.test(raw)) return 'tono.settings.about.checkFailed'
  return 'tono.update.checkUnknown'
}

const LATER_PREFIX = 'tono-update-later:'
export const UPDATE_LATER_MS = 24 * 60 * 60 * 1000

export const updateSnoozed = (
  manifestSha256: string,
  now = Date.now(),
): boolean => {
  const raw = localStorage.getItem(LATER_PREFIX + manifestSha256)
  if (!raw) return false
  const until = Number(raw)
  return Number.isFinite(until) && until > now
}

export const snoozeUpdate = (manifestSha256: string, now = Date.now()): void => {
  localStorage.setItem(
    LATER_PREFIX + manifestSha256,
    String(now + UPDATE_LATER_MS),
  )
}
