import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react'

import { SeaWaterCanvas } from './SeaWater'
import { useSceneQuality } from './useSceneQuality'

import './tokens/motion.css'
import './sea-scene.css'

export type SeaPhase = 'connected' | 'connecting' | 'failed' | 'idle'

export interface SeaSceneProps {
  /** Decorative phase only. The caller must verify live protection before connected. */
  phase: SeaPhase
  /** Hidden native surfaces / closed tray may explicitly opt out. */
  paused?: boolean
  /** Caller-owned stage progress (0–1), connecting only; omitted keeps the half-rise. */
  progress?: number
}

const MEDIA = [
  '(prefers-reduced-motion: reduce)',
  '(forced-colors: active)',
] as const

const subscribe = (notify: () => void) => {
  const queries = MEDIA.map((query) => window.matchMedia(query))
  for (const query of queries) query.addEventListener('change', notify)
  document.addEventListener('visibilitychange', notify)
  return () => {
    for (const query of queries) query.removeEventListener('change', notify)
    document.removeEventListener('visibilitychange', notify)
  }
}

const snapshot = () => {
  const reduced = MEDIA.some((query) => window.matchMedia(query).matches)
  return (reduced ? 1 : 0) | (document.hidden ? 2 : 0)
}

const fill: CSSProperties = { position: 'absolute', inset: 0 }
const disk: CSSProperties = { ...fill, borderRadius: '50%' }
const sunBox: CSSProperties = {
  position: 'absolute',
  left: 'calc(67.3913% - 95 * var(--sea-unit))',
  top: 'calc(100% - 240 * var(--sea-unit))',
  width: 'calc(190 * var(--sea-unit))',
  height: 'calc(190 * var(--sea-unit))',
}
const mirrorBox: CSSProperties = {
  ...sunBox,
  top: 'calc(50 * var(--sea-unit))',
  left: 'calc(50% - 95 * var(--sea-unit))',
}

// Seeded once: phase commits never randomise/remount the sky.
const STARS = (() => {
  let seed = 47
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  return Array.from({ length: 200 }, (_, index) => ({
    id: `star-${index}`,
    x: 3 + random() * 94,
    y: 8 + random() * 72,
    tier: index % 11 < 6 ? 0 : index % 11 < 9 ? 1 : 2,
    twinkle: index % 3 === 0,
    duration: 3 + random() * 6,
    delay: -random() * 9,
    color: ['#b8caff', '#f4eee2', '#ffe0b0'][index % 3],
  }))
})()

const Glints = ({ tone, full }: { tone: 'sun' | 'moon'; full: boolean }) => (
  <>
    {(full ? (['far', 'near'] as const) : (['near'] as const)).map((depth) => (
      <div
        key={depth}
        className={`sea-glints-${depth}`}
        style={{ ...fill, overflow: 'hidden' }}
      >
        {[1, 2].map((layer) => (
          <div
            key={layer}
            className={`sea-specks sea-glint-${layer} sea-loop`}
            style={{ ...fill, top: 'calc(-1 * var(--sea-glint-tile))' }}
          >
            {tone === 'moon' ? (
              <div className="sea-path-cool" style={fill} />
            ) : (
              <>
                <div className="sea-path-gold" style={fill} />
                <div className="sea-path-red" style={fill} />
              </>
            )}
          </div>
        ))}
      </div>
    ))}
  </>
)

const SunDisk = () => (
  <div className="sea-sun-body" style={fill}>
    <div className="sea-disk" style={disk} />
    <div className="sea-red" style={disk} />
    <div className="sea-shade" style={disk} />
  </div>
)

/** Persistent, inert scenery. No connection state or native IPC; one bounded quality probe. */
export const SeaScene = ({
  phase,
  paused = false,
  progress,
}: SeaSceneProps) => {
  const sceneRef = useRef<HTMLDivElement>(null)
  const [starCount, setStarCount] = useState(54)
  const frozenTransitionsRef = useRef(new Set<Animation>())
  const environment = useSyncExternalStore(subscribe, snapshot, () => 1)
  const [hasSize, setHasSize] = useState(false)
  const { quality } = useSceneQuality(hasSize && !paused && environment === 0)
  const isStatic = paused || (environment & 1) !== 0 || quality === 'static'
  const full = quality !== 'lite'
  const isHidden = (environment & 2) !== 0
  const isPaused = isStatic || isHidden
  const progressStyle =
    phase === 'connecting' &&
    progress !== undefined &&
    Number.isFinite(progress)
      ? ({
          '--sea-progress-offset':
            205 - 150 * Math.min(1, Math.max(0, progress)),
        } as CSSProperties)
      : undefined
  const [entry, setEntry] = useState({ phase, isStatic, arrival: false })
  // Track prop changes before commit, not on a timer or an extra effect render.
  if (entry.phase !== phase || entry.isStatic !== isStatic) {
    setEntry({
      phase,
      isStatic,
      arrival:
        !isStatic &&
        (entry.phase !== phase ? phase === 'connected' : entry.arrival),
    })
  }

  useLayoutEffect(() => {
    if (!sceneRef.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (
        !entry ||
        entry.contentRect.width <= 0 ||
        entry.contentRect.height <= 0
      ) {
        setHasSize(false)
        return
      }
      setHasSize(true)
      const area = entry.contentRect.width * entry.contentRect.height
      setStarCount(
        Math.min(
          STARS.length,
          Math.max(37, Math.round((54 * area) / (920 * 600))),
        ),
      )
    })
    observer.observe(sceneRef.current)
    return () => observer.disconnect()
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: A phase/progress commit creates new CSS transitions even when visibility is unchanged.
  useLayoutEffect(() => {
    const frozen = frozenTransitionsRef.current
    if (!isHidden || isStatic) {
      for (const transition of frozen) {
        if (transition.playState === 'paused') {
          if (isStatic) transition.cancel()
          else transition.play()
        }
      }
      frozen.clear()
      return
    }

    // Visibility is transient: hold the presentation, including delayed moon fades.
    // CSS still owns the loops; only pause this scene's in-flight transitions.
    for (const animation of sceneRef.current?.getAnimations?.({
      subtree: true,
    }) ?? []) {
      if (
        'transitionProperty' in animation &&
        animation.playState === 'running'
      ) {
        animation.pause()
        frozen.add(animation)
      }
    }
    for (const transition of frozen) {
      if (
        transition.playState === 'idle' ||
        transition.playState === 'finished'
      ) {
        frozen.delete(transition)
      }
    }
  }, [isHidden, isStatic, phase, progress])

  useLayoutEffect(() => {
    const frozen = frozenTransitionsRef.current
    return () => {
      for (const transition of frozen) transition.cancel()
      frozen.clear()
    }
  }, [])

  return (
    <div
      ref={sceneRef}
      className="sea-scene"
      data-phase={phase}
      data-quality={isStatic ? 'static' : quality}
      data-low-sun={
        phase === 'failed' ||
        (phase === 'connecting' && progressStyle && (progress ?? 1) <= 0)
          ? 'true'
          : 'false'
      }
      data-progress={progressStyle ? 'true' : 'false'}
      data-arrival={entry.arrival && phase === 'connected' ? 'true' : 'false'}
      data-motion={isStatic ? 'static' : 'ambient'}
      data-paused={isPaused ? 'true' : 'false'}
      aria-hidden="true"
      style={{
        ...fill,
        ...progressStyle,
        overflow: 'hidden',
        pointerEvents: 'none',
        background: '#060506',
        containerType: 'size',
      }}
    >
      <div
        className="sea-sky"
        style={{ ...fill, bottom: '45%', overflow: 'hidden' }}
      >
        {[0, 1, 2].map((tier) => (
          <div
            key={tier}
            className={`sea-stars${tier === 2 ? ' sea-stars-bright' : ''}`}
            style={{ ...fill, '--sea-star-tier': tier } as CSSProperties}
          >
            {STARS.slice(0, starCount).map((star) =>
              star.tier === tier ? (
                <span
                  key={star.id}
                  className={`sea-star sea-star-tier-${star.tier}`}
                  style={{
                    position: 'absolute',
                    left: `${star.x}%`,
                    top: `${star.y}%`,
                    width: [1, 1.5, 2.5][star.tier],
                    height: [1, 1.5, 2.5][star.tier],
                  }}
                >
                  <span
                    className={
                      star.twinkle && full
                        ? 'sea-star-light sea-twinkle sea-loop'
                        : 'sea-star-light'
                    }
                    style={{
                      ...disk,
                      background: star.color,
                      animationDuration: `${star.duration}s`,
                      animationDelay: `${star.delay}s`,
                    }}
                  />
                </span>
              ) : null,
            )}
          </div>
        ))}
        <div
          className={`sea-meteor${full ? ' sea-loop' : ''}`}
          style={{
            position: 'absolute',
            left: '42%',
            top: '18%',
            width: 100,
            height: 1,
          }}
        />
        <div className="sea-dusk" style={fill}>
          <div className="sea-sky-dusk sea-evening" style={fill} />
          <div className="sea-sky-night sea-night" style={fill} />
          <div
            className="sea-sky-dusk sea-sky-night-top sea-night"
            style={fill}
          />
        </div>
        <div className="sea-day sea-sky-day" style={fill} />
        <div
          className="sea-moon"
          style={{
            position: 'absolute',
            left: 'calc(81.08696% - 70 * var(--sea-unit))',
            top: 'calc(100% - 238 * var(--sea-unit))',
            width: 'calc(140 * var(--sea-unit))',
            height: 'calc(140 * var(--sea-unit))',
          }}
        >
          <div
            className={`sea-moon-glow${full ? ' sea-loop' : ''}`}
            style={fill}
          />
          <svg
            className="sea-crescent"
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 40 40"
            style={{
              position: 'absolute',
              left: 'calc(50 * var(--sea-unit))',
              top: 'calc(50 * var(--sea-unit))',
              width: 'calc(40 * var(--sea-unit))',
              height: 'calc(40 * var(--sea-unit))',
            }}
          >
            <path
              d="M11.17 3.17A19 19 0 1 0 36.83 28.83A19 19 0 0 1 11.17 3.17Z"
              fill="#f4eee2"
            />
          </svg>
        </div>
        <div
          className="sea-afterglow"
          style={{
            position: 'absolute',
            left: 'calc(67.3913% - 220 * var(--sea-unit))',
            bottom: 0,
            width: 'calc(440 * var(--sea-unit))',
            height: 'calc(28 * var(--sea-unit))',
          }}
        />
        <div
          className={`sea-cloud sea-cloud-1${full ? ' sea-loop' : ''}`}
          style={{
            position: 'absolute',
            left: 0,
            bottom: 32,
            width: '100%',
            height: 64,
          }}
        />
        <div
          className={`sea-cloud sea-cloud-2${full ? ' sea-loop' : ''}`}
          style={{
            position: 'absolute',
            left: 0,
            bottom: 8,
            width: '100%',
            height: 58,
          }}
        />
        <div className="sea-track" style={sunBox}>
          <div
            className={`sea-sun-motion${full ? ' sea-loop' : ''}`}
            style={fill}
          >
            <div
              className="sea-arrival-bloom sea-loop"
              style={{
                position: 'absolute',
                inset: 'calc(-100 * var(--sea-unit))',
              }}
            />
            <div
              className="sea-halo"
              style={{
                position: 'absolute',
                inset: 'calc(-90 * var(--sea-unit))',
              }}
            >
              <div
                className={`sea-breathe${full ? ' sea-loop' : ''}`}
                style={fill}
              />
            </div>
            <div className="sea-sun-glow" style={disk}>
              <div
                className={`sea-glow-pulse${full ? ' sea-loop' : ''}`}
                style={disk}
              />
            </div>
            <SunDisk />
          </div>
        </div>
      </div>
      <div
        className="sea-water"
        style={{ ...fill, top: '55%', overflow: 'hidden' }}
      >
        <div className="sea-dusk" style={fill}>
          <div className="sea-water-dusk sea-evening" style={fill} />
          <div className="sea-water-night sea-night" style={fill} />
        </div>
        <div className="sea-day sea-water-day" style={fill} />
        <div className="sea-swell-envelope" style={fill}>
          <div
            className="sea-swell sea-swell-1 sea-loop"
            style={{ ...fill, top: -180 }}
          />
          <div
            className="sea-swell sea-swell-2 sea-loop"
            style={{ ...fill, top: -180 }}
          />
        </div>
        <div
          className="sea-water-light"
          style={{
            position: 'absolute',
            left: 'calc(67.3913% - 280 * var(--sea-unit))',
            top: 0,
            width: 'calc(560 * var(--sea-unit))',
            height: 'calc(270 * var(--sea-unit))',
          }}
        >
          <div className="sea-light-warm" style={fill} />
          <div className="sea-light-red" style={fill} />
        </div>
        <div
          className="sea-reflection-lift"
          style={{
            position: 'absolute',
            left: 'calc(67.3913% - 130 * var(--sea-unit))',
            top: 0,
            width: 'calc(260 * var(--sea-unit))',
            height: 'calc(60 * var(--sea-unit))',
          }}
        />
        <div
          className="sea-mirror"
          style={{
            position: 'absolute',
            left: 'calc(67.3913% - 165 * var(--sea-unit))',
            top: 0,
            width: 'calc(330 * var(--sea-unit))',
            height: 'calc(270 * var(--sea-unit))',
            transform: 'scaleY(1.45)',
            transformOrigin: '50% 0',
          }}
        >
          <div className="sea-mirror-track" style={mirrorBox}>
            <div
              className={`sea-mirror-motion${full ? ' sea-loop' : ''}`}
              style={fill}
            >
              <div
                className="sea-mirror-soft"
                style={{ position: 'absolute', inset: -7 }}
              />
            </div>
          </div>
          {[1, 2].map((layer) => (
            <div
              key={layer}
              className={`sea-ripple sea-ripple-${layer} sea-loop sea-ripple-flow-${layer}`}
              style={{
                ...fill,
                top: -270,
                bottom: 'auto',
                height: 'calc(270 * var(--sea-unit) + 270px)',
              }}
            >
              <div
                className={`sea-ripple-counter sea-loop sea-ripple-flow-${layer}`}
                style={{
                  ...fill,
                  top: 270,
                  bottom: 'auto',
                  height: 'calc(270 * var(--sea-unit))',
                }}
              >
                <div className="sea-mirror-track" style={mirrorBox}>
                  <div
                    className={`sea-mirror-motion${full ? ' sea-loop' : ''}`}
                    style={fill}
                  >
                    <div className="sea-reflected-disk" style={fill}>
                      <SunDisk />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div
          className="sea-moon-path"
          style={{
            position: 'absolute',
            left: 'calc(81.08696% - 84 * var(--sea-unit))',
            top: 0,
            width: 'calc(168 * var(--sea-unit))',
            height: 'calc(170 * var(--sea-unit))',
          }}
        >
          <Glints tone="moon" full={full} />
        </div>
        <div
          className="sea-light-column"
          style={{
            position: 'absolute',
            left: 'calc(67.3913% - 130 * var(--sea-unit))',
            top: 0,
            width: 'calc(260 * var(--sea-unit))',
            height: '70%',
          }}
        >
          <div className="sea-column-gold" style={fill} />
          <div className="sea-column-red" style={fill} />
        </div>
        <div
          className="sea-sun-path"
          style={{
            position: 'absolute',
            left: 'calc(67.3913% - 150 * var(--sea-unit))',
            top: 0,
            width: 'calc(300 * var(--sea-unit))',
            height: 'calc(270 * var(--sea-unit))',
          }}
        >
          <Glints tone="sun" full={full} />
          <div
            className="sea-arrival-sweep sea-loop"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 'calc(-60 * var(--sea-unit))',
              height: 'calc(60 * var(--sea-unit))',
            }}
          />
        </div>
        {quality === 'full' && !isStatic && hasSize && (
          <SeaWaterCanvas sceneRef={sceneRef} running={!isHidden} />
        )}
      </div>
      <div
        className="sea-horizon"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 'calc(55% - 9px)',
          height: 18,
        }}
      />
      <div className="sea-grain" style={fill} />
    </div>
  )
}
