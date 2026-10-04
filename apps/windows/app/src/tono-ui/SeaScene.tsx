import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react'

import './tokens/motion.css'
import './sea-scene.css'

export type SeaPhase = 'connected' | 'connecting' | 'failed' | 'idle'

export interface SeaSceneProps {
  /** Decorative phase only. The caller must verify live protection before connected. */
  phase: SeaPhase
  /** Hidden native surfaces / closed tray / software rendering must opt out. */
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

const Specks = () => (
  <>
    <div
      className="sea-specks sea-specks-1 sea-loop"
      style={{ ...fill, top: -192 }}
    >
      <div className="sea-path-gold" style={fill} />
      <div className="sea-path-red" style={fill} />
    </div>
    <div
      className="sea-specks sea-specks-2 sea-loop"
      style={{ ...fill, top: -192 }}
    >
      <div className="sea-path-gold" style={fill} />
      <div className="sea-path-red" style={fill} />
    </div>
  </>
)

const SunDisk = () => (
  <div className="sea-sun-body" style={fill}>
    <div className="sea-disk" style={disk} />
    <div className="sea-red" style={disk} />
    <div className="sea-shade" style={disk} />
  </div>
)

/** Persistent, inert scenery. No connection state, native IPC, canvas or frame loop. */
export const SeaScene = ({
  phase,
  paused = false,
  progress,
}: SeaSceneProps) => {
  const sceneRef = useRef<HTMLDivElement>(null)
  const [starCount, setStarCount] = useState(54)
  const frozenTransitionsRef = useRef(new Set<Animation>())
  const environment = useSyncExternalStore(subscribe, snapshot, () => 1)
  const isStatic = paused || (environment & 1) !== 0
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
      )
        return
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
        {[false, true].map((bright) => (
          <div
            key={String(bright)}
            className={bright ? 'sea-stars sea-stars-bright' : 'sea-stars'}
            style={fill}
          >
            {STARS.slice(0, starCount).map((star) =>
              (star.tier === 2) === bright ? (
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
                      star.twinkle
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
          className="sea-meteor sea-loop"
          style={{
            position: 'absolute',
            left: '42%',
            top: '18%',
            width: 100,
            height: 1,
          }}
        />
        <div className="sea-dusk sea-sky-dusk" style={fill} />
        <div className="sea-day sea-sky-day" style={fill} />
        <div
          className="sea-moon"
          style={{
            position: 'absolute',
            left: 'calc(81.08696% - 70px)',
            top: 'calc(100% - 238px)',
            width: 140,
            height: 140,
          }}
        >
          <div className="sea-moon-glow" style={fill} />
          <svg
            className="sea-crescent"
            aria-hidden="true"
            focusable="false"
            viewBox="0 0 40 40"
            style={{
              position: 'absolute',
              left: 50,
              top: 50,
              width: 40,
              height: 40,
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
          className="sea-cloud sea-loop sea-cloud-1"
          style={{
            position: 'absolute',
            left: 0,
            bottom: 32,
            width: '100%',
            height: 64,
          }}
        />
        <div
          className="sea-cloud sea-loop sea-cloud-2"
          style={{
            position: 'absolute',
            left: 0,
            bottom: 8,
            width: '100%',
            height: 58,
          }}
        />
        <div className="sea-track" style={sunBox}>
          <div className="sea-sun-motion sea-loop" style={fill}>
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
              <div className="sea-loop sea-breathe" style={fill} />
            </div>
            <div className="sea-sun-glow" style={disk}>
              <div className="sea-glow-pulse sea-loop" style={disk} />
            </div>
            <SunDisk />
          </div>
        </div>
      </div>
      <div
        className="sea-water"
        style={{ ...fill, top: '55%', overflow: 'hidden' }}
      >
        <div className="sea-dusk sea-water-dusk" style={fill} />
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
            left: 0,
            top: 0,
            width: '100%',
            height: 'calc(270 * var(--sea-unit))',
            transform: 'scaleY(1.45)',
            transformOrigin: '50% 0',
          }}
        >
          <div className="sea-mirror-track" style={mirrorBox}>
            <div className="sea-mirror-motion sea-loop" style={fill}>
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
                  <div className="sea-mirror-motion sea-loop" style={fill}>
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
            left: 'calc(81.08696% - 70px)',
            top: 0,
            width: 140,
            height: 150,
          }}
        >
          {[
            [34, 10, 72, 2, 0.9],
            [46, 24, 54, 2, 0.8],
            [28, 42, 86, 3, 0.7],
            [44, 66, 60, 3, 0.55],
            [22, 96, 98, 4, 0.4],
          ].map(([left, top, width, height, opacity], i) => (
            <div
              key={top}
              style={{
                position: 'absolute',
                left,
                top,
                width,
                height,
                opacity,
              }}
            >
              <div
                className={`sea-loop sea-bar sea-glitter-${i % 3}`}
                style={{ ...fill, animationDelay: `${-i * 0.37}s` }}
              />
            </div>
          ))}
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
          <Specks />
          <div
            className="sea-near-specks"
            style={{
              ...fill,
              bottom: 'auto',
              height: 'calc(80 * var(--sea-unit))',
              overflow: 'hidden',
            }}
          >
            <Specks />
          </div>
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
