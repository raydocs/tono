const rawOf = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error ?? '')
}

const needsAttention =
  /a prior update needs reconciliation|needs attention|TONO_UPDATE_NEEDS_ATTENTION|rollback not proven|automatic update recovery failed/i
const signatureRefusal = /signature|ed25519|minisign/i
const floorRefusal =
  /release sequence|releaseSequence|installed floor|not newer|downgrade refused|release replay/i
const networkFailure =
  /unreachable|timed out|timeout|network|offline|\bdns\b|connection refused|connection reset/i
const hardRefusal =
  /signature|ed25519|minisign|release sequence|releaseSequence|installed floor|not newer|downgrade refused|release replay|verified a different manifest|invalid manifest|unsupported manifest|Service refused|protection retained|another owner/i

/** A signature, floor, or explicit service refusal cannot be retried as-is. */
export const updateFailureSticks = (raw: string): boolean => hardRefusal.test(raw)

type UpdateMessageKey =
  | 'tono.update.needsAttention'
  | 'tono.update.signatureRefused'
  | 'tono.update.notNewer'
  | 'tono.update.network'
  | 'tono.update.refused'
  | 'tono.update.notCompleted'

/** Human sentence key. The raw chain stays in technical details. */
export const updateFailureMessageKey = (raw: string): UpdateMessageKey => {
  if (needsAttention.test(raw)) return 'tono.update.needsAttention'
  if (signatureRefusal.test(raw)) return 'tono.update.signatureRefused'
  if (floorRefusal.test(raw)) return 'tono.update.notNewer'
  if (networkFailure.test(raw)) return 'tono.update.network'
  if (updateFailureSticks(raw)) return 'tono.update.refused'
  return 'tono.update.notCompleted'
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

/** Check-for-updates notice. Network failures keep the network sentence. */
export const updateCheckNoticeKey = (raw: string): string => {
  if (needsAttention.test(raw)) return 'tono.update.needsAttention'
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
