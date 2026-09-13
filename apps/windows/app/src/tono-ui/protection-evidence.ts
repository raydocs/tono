import type { TonoStatus } from '@/services/tono'

/** An armed/blocked FSM is conservative intent, not proof of a live Service barrier. */
export const hasLiveProtection = (status?: Pick<TonoStatus, 'killSwitch'>) =>
  status?.killSwitch?.wanted === true && status.killSwitch.live === true
