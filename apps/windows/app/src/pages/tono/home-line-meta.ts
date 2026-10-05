import type { TonoStatus } from '@/services/tono'

import { readNodeLatency } from './node-latency'
import {
  HY2_NAME_SUFFIX,
  isHy2CatalogName,
  nodeCityLabel,
  nodeCityParts,
} from './node-meta'

/** One display identity for the chip and picker; wire names stay with the handler. */
export const homeLineParts = (
  name: string,
  t: Parameters<typeof nodeCityLabel>[1],
) => {
  const { codename, city } = nodeCityParts(name)
  const label = nodeCityLabel(
    codename ? `${city}${isHy2CatalogName(name) ? HY2_NAME_SUFFIX : ''}` : name,
    t,
  )
  return {
    name: codename || label,
    city: codename ? label : '',
  }
}

export const homeLineReading = (
  name: string,
  status: TonoStatus | undefined,
) => {
  const exit = status?.selectedServer === name ? status.exitDelayMs : null
  if (exit != null && Number.isFinite(exit) && exit > 0 && exit < 1e6)
    return { ms: exit, kind: 'exit' as const }
  const cached = readNodeLatency(name)
  return cached === null ? null : { ms: cached, kind: 'cached' as const }
}
