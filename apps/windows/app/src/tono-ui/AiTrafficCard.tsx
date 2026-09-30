import dayjs from 'dayjs'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useConnectionData } from '@/hooks/use-connection-data'
import { tonoAccountQueryKey } from '@/hooks/use-tono'
import { useQuery } from '@/services/query-client'
import { tonoAccount } from '@/services/tono'
import parseTraffic from '@/utils/parse-traffic'

import {
  AI_TRAFFIC_DAYS,
  AI_TRAFFIC_FAMILIES,
  accumulateAiTraffic,
  aiTrafficDayTotal,
  aiTrafficStorageKey,
  loadAiTrafficDays,
  saveAiTrafficDays,
  type AiTrafficDays,
} from './ai-traffic'
import { GlassCard } from './GlassCard'

const DAY_FORMAT = 'YYYY-MM-DD'

// Mihomo connection ids are unique per core run; remounting the overview in
// the same run must not count a connection's bytes twice.
let seenGeneration: number | undefined
let seenBytes = new Map<string, number>()
const seenFor = (generation?: number) => {
  if (generation !== seenGeneration) {
    seenGeneration = generation
    seenBytes = new Map()
  }
  return seenBytes
}

const formatBytes = (bytes: number) => parseTraffic(bytes).join(' ')

export const AiTrafficCard = ({
  connected,
  generation,
}: {
  connected: boolean
  generation?: number
}) => {
  const { t } = useTranslation()
  const { data: account } = useQuery({
    queryKey: tonoAccountQueryKey,
    queryFn: tonoAccount,
  })
  const email = account?.email

  const [keyed, setKeyed] = useState<{ email: string; key: string } | null>(
    null,
  )
  useEffect(() => {
    if (!email) return
    let cancelled = false
    void aiTrafficStorageKey(email).then((key) => {
      if (!cancelled) setKeyed({ email, key })
    })
    return () => {
      cancelled = true
    }
  }, [email])
  const storageKey = email && keyed?.email === email ? keyed.key : null

  const [store, setStore] = useState<{
    key: string | null
    days: AiTrafficDays
  }>({ key: null, days: {} })
  if (store.key !== storageKey) {
    setStore({
      key: storageKey,
      days: storageKey ? loadAiTrafficDays(storageKey) : {},
    })
  }
  const days = store.key === storageKey ? store.days : {}

  const {
    response: { data },
  } = useConnectionData({
    enabled: connected && storageKey != null,
    generation,
  })
  useEffect(() => {
    if (!storageKey || store.key !== storageKey) return
    const next = accumulateAiTraffic(
      store.days,
      seenFor(generation),
      [...data.activeConnections, ...data.closedConnections],
      dayjs().format(DAY_FORMAT),
    )
    if (next === store.days) return
    saveAiTrafficDays(storageKey, next)
    // eslint-disable-next-line @eslint-react/set-state-in-effect -- folds the connection feed's frames into the persisted tally
    setStore({ key: storageKey, days: next })
  }, [data, storageKey, generation, store])

  const week = Array.from({ length: AI_TRAFFIC_DAYS }, (_, index) => {
    const day = dayjs()
      .subtract(AI_TRAFFIC_DAYS - 1 - index, 'day')
      .format(DAY_FORMAT)
    return { day, total: aiTrafficDayTotal(days[day]) }
  })
  const weekMax = Math.max(...week.map((entry) => entry.total))
  if (!storageKey || (!connected && weekMax === 0)) return null

  const today = days[week[week.length - 1].day] ?? {}
  const rows = AI_TRAFFIC_FAMILIES.filter((family) => (today[family] ?? 0) > 0)

  return (
    <GlassCard
      radius="var(--tono-radius-card)"
      padding={16}
      style={{ width: 520, maxWidth: '100%' }}
    >
      <section
        className="tono-ai-traffic"
        aria-labelledby="tono-ai-traffic-title"
      >
        <header>
          <h2 id="tono-ai-traffic-title">
            {t('tono.dashboard.aiTraffic.title')}
          </h2>
          <p>{t('tono.dashboard.aiTraffic.subtitle')}</p>
        </header>
        {rows.length === 0 ? (
          <p className="tono-ai-traffic__empty">
            {t('tono.dashboard.aiTraffic.empty')}
          </p>
        ) : (
          <dl className="tono-ai-traffic__rows">
            {rows.map((family) => (
              <div key={family}>
                <dt>{family}</dt>
                <dd>{formatBytes(today[family] ?? 0)}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="tono-ai-traffic__week">
          <span>{t('tono.dashboard.aiTraffic.week')}</span>
          <ol>
            {week.map((entry, index) => (
              <li
                key={entry.day}
                title={`${entry.day} · ${formatBytes(entry.total)}`}
                aria-label={`${entry.day} · ${formatBytes(entry.total)}`}
                data-today={index === week.length - 1 ? '' : undefined}
                style={{
                  height: `${weekMax > 0 ? Math.max(2, (entry.total / weekMax) * 24) : 2}px`,
                }}
              />
            ))}
          </ol>
        </div>
        <p className="tono-ai-traffic__note">
          {t('tono.dashboard.aiTraffic.note')}
        </p>
      </section>
    </GlassCard>
  )
}
