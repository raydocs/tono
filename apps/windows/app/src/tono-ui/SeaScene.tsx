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
  left: 'calc(67.3913% - 95px)',
  top: 'calc(100% - 240px)',
  width: 190,
  height: 190,
}
const mirrorBox: CSSProperties = { ...sunBox, top: 50 }

const STARS = [
  [44, 96],
  [118, 74],
  [176, 122],
  [232, 88],
  [286, 70],
  [318, 262],
  [352, 108],
  [404, 78],
  [446, 136],
  [492, 92],
  [538, 158],
  [574, 84],
  [628, 118],
  [668, 72],
  [706, 176],
  [742, 98],
  [786, 142],
  [822, 80],
  [866, 124],
  [894, 206],
  [598, 222],
  [472, 214],
  [760, 236],
  [84, 268],
  [212, 286],
  [150, 104],
  [520, 70],
  [846, 104],
  [380, 190],
  [262, 132],
  [610, 152],
  [780, 66],
  [60, 180],
  [430, 108],
  [884, 168],
  [560, 232],
  [196, 226],
] as const

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
  <>
    <div className="sea-disk" style={disk} />
    <div className="sea-red" style={disk} />
    <div className="sea-shade" style={disk} />
  </>
)

/** Persistent, inert scenery. No connection state, native IPC, canvas or frame loop. */
export const SeaScene = ({ phase, paused = false }: SeaSceneProps) => {
  const sceneRef = useRef<HTMLDivElement>(null)
  const frozenTransitionsRef = useRef(new Set<Animation>())
  const environment = useSyncExternalStore(subscribe, snapshot, () => 1)
  const isStatic = paused || (environment & 1) !== 0
  const isHidden = (environment & 2) !== 0
  const isPaused = isStatic || isHidden
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: A phase commit creates new CSS transitions even when visibility is unchanged.
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
  }, [isHidden, isStatic, phase])

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
      data-arrival={entry.arrival && phase === 'connected' ? 'true' : 'false'}
      data-motion={isStatic ? 'static' : 'ambient'}
      data-paused={isPaused ? 'true' : 'false'}
      aria-hidden="true"
      style={{
        ...fill,
        overflow: 'hidden',
        pointerEvents: 'none',
        background: '#060506',
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
            {STARS.map(([x, y], i) =>
              (i % 7 === 0) === bright ? (
                <span
                  key={`${x}-${y}`}
                  className={
                    i < 25
                      ? 'sea-star'
                      : `sea-star sea-loop sea-twinkle-${i % 3}`
                  }
                  style={{
                    position: 'absolute',
                    left: `${x / 9.2}%`,
                    top: `${y / 3.3}%`,
                    width: i < 25 ? 1 : 2,
                    height: i < 25 ? 1 : 2,
                  }}
                />
              ) : null,
            )}
          </div>
        ))}
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
          <div
            className="sea-crescent"
            style={{
              position: 'absolute',
              left: 50,
              top: 50,
              width: 40,
              height: 40,
            }}
          />
        </div>
        <div
          className="sea-afterglow"
          style={{
            position: 'absolute',
            left: 'calc(67.3913% - 220px)',
            bottom: 0,
            width: 440,
            height: 28,
          }}
        />
        <div className="sea-track" style={sunBox}>
          <div
            className="sea-arrival-bloom sea-loop"
            style={{ position: 'absolute', inset: -100 }}
          />
          <div
            className="sea-halo"
            style={{ position: 'absolute', inset: -90 }}
          >
            <div className="sea-loop sea-breathe" style={fill} />
          </div>
          <div className="sea-sun-glow" style={disk} />
          <SunDisk />
        </div>
        <div
          className="sea-cloud sea-loop sea-cloud-1"
          style={{
            position: 'absolute',
            left: '45.65%',
            bottom: 32,
            width: 480,
            height: 64,
          }}
        />
        <div
          className="sea-cloud sea-loop sea-cloud-2"
          style={{
            position: 'absolute',
            left: '32.61%',
            bottom: 8,
            width: 580,
            height: 58,
          }}
        />
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
            left: 'calc(67.3913% - 280px)',
            top: 0,
            width: 560,
            height: 270,
          }}
        >
          <div className="sea-light-warm" style={fill} />
          <div className="sea-light-red" style={fill} />
        </div>
        <div
          className="sea-mirror"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: 270,
            transform: 'scaleY(1.45)',
            transformOrigin: '50% 0',
          }}
        >
          <div className="sea-mirror-track" style={mirrorBox}>
            <div
              className="sea-mirror-soft"
              style={{ position: 'absolute', inset: -7 }}
            />
          </div>
          {[1, 2].map((layer) => (
            <div
              key={layer}
              className={`sea-ripple sea-ripple-${layer} sea-loop sea-ripple-flow-${layer}`}
              style={{ ...fill, top: -270, bottom: 'auto', height: 540 }}
            >
              <div
                className={`sea-ripple-counter sea-loop sea-ripple-flow-${layer}`}
                style={{ ...fill, top: 270, bottom: 'auto', height: 270 }}
              >
                <div className="sea-mirror-track" style={mirrorBox}>
                  <div className="sea-reflected-disk" style={fill}>
                    <SunDisk />
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
          className="sea-sun-path"
          style={{
            position: 'absolute',
            left: 'calc(67.3913% - 150px)',
            top: 0,
            width: 300,
            height: 270,
          }}
        >
          <Specks />
          <div
            className="sea-arrival-sweep sea-loop"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: -60,
              height: 60,
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
          top: 'calc(55% - 1px)',
          height: 2,
        }}
      />
      <div className="sea-grain" style={fill} />
    </div>
  )
}
