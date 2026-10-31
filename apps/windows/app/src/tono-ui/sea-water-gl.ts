import { THROTTLED_WATER_FRAME_MS } from './sea-scene-motion'
import { readSeaTraffic } from './sea-traffic'

// Real-time water for the full-quality sea (decision 078). The CSS sky stays
// the source of truth: every frame reads the sun and moon boxes and their
// opacities from the DOM, so the reflection follows the CSS transitions
// exactly. The CSS water layers stay mounted and take over again on any
// failure, at lite/static quality, or under reduced motion.

const VERTEX = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`

const FRAGMENT = `precision highp float;
uniform vec2 uView;uniform float uHorizon,uDpr,uCanvasH,uDither;
uniform float uWave[9];uniform vec2 uRipple,uDrift;
uniform vec3 uZen,uMid,uHor,uGlowCol,uWater;
uniform vec4 uSun,uMoon;
uniform float uGlow,uRed,uRough,uSpark,uHaze;
const float FOV=1.25;
const float CAMH=2.;
const float NOISE=256.;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float cell(vec2 i){return hash(mod(i,NOISE));}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(cell(i),cell(i+vec2(1,0)),f.x),mix(cell(i+vec2(0,1)),cell(i+vec2(1,1)),f.x),f.y)*2.-1.;}
vec2 toScreen(vec2 px){return vec2((px.x-uView.x*.5)/uView.y,(uHorizon-px.y)/uView.y);}
vec2 scr(vec3 d){return d.xy/max(d.z,1e-3)*FOV;}
vec3 sunDisk(vec2 q){
  float y=clamp(.5-.5*q.y,0.,1.);
  vec3 a=mix(vec3(1.,.965,.871),vec3(1.,.835,.557),smoothstep(0.,.3,y));
  a=mix(a,vec3(1.,.639,.369),smoothstep(.3,.66,y));
  a=mix(a,vec3(.949,.408,.353),smoothstep(.66,1.,y));
  vec3 r=mix(vec3(1.,.66,.36),vec3(.9,.26,.2),smoothstep(.1,.9,y));
  r=mix(r,vec3(.6,.12,.22),smoothstep(.7,1.,y));
  vec3 c=mix(a,r,uRed);
  float l=length(q);
  c=mix(c,vec3(1.,.975,.92),(1.-smoothstep(.2,.95,l))*(1.-.8*uRed)*.42);
  c*=mix(.82,1.,sqrt(max(1.-l*l,0.)));
  return c*mix(1.55,1.18,uRed);
}
vec3 sky(vec3 d,bool disk){
  float e=max(d.y,0.);
  vec3 c=mix(uHor,uMid,smoothstep(0.,.11,e));
  c=mix(c,uZen,smoothstep(.1,.5,e));
  vec2 sp=scr(d);
  vec2 sun=toScreen(uSun.xy);
  float R=max(uSun.z/uView.y,1e-3);
  vec2 q=(sp-sun)/vec2(R,R*uSun.w);
  float r=length(q);
  float wide=exp(-r*r/9.);
  float tight=exp(-max(r-1.,0.)*2.2);
  float hband=exp(-e*22.)*exp(-pow((sp.x-sun.x)/1.1,2.));
  c+=uGlowCol*uGlow*(.26*wide+.26*tight*(1.-uRed*.5)+.22*hband);
  c=mix(c,uHor*1.02+uGlowCol*.08*uGlow,exp(-e*70.)*.38*uHaze);
  if(disk){
    float k=1.-smoothstep(.94,1.,r);
    c=mix(c,sunDisk(q),k*clamp(uGlow*1.6+.25,0.,1.));
  }
  if(uMoon.w>0.){
    vec2 m=(sp-toScreen(uMoon.xy))/max(uMoon.z/uView.y,1e-3);
    float md=length(m);
    float cres=(1.-smoothstep(.92,1.,md))*smoothstep(.92,1.,length(m-vec2(-.38,.26)));
    c+=vec3(.96,.95,.9)*cres*uMoon.w*1.2+vec3(.55,.62,.9)*exp(-md*md/40.)*.1*uMoon.w;
  }
  return c;
}
vec2 waves(vec2 p,float foot){
  vec2 g=vec2(0.);
  float amp=.055,len=15.;
  for(int i=0;i<9;i++){
    float fi=float(i);
    float ang=-.35+fi*2.39+sin(fi*3.7)*.6;
    vec2 D=normalize(vec2(cos(ang),sin(ang)*.55+.6));
    float k=6.2832/len;
    float att=smoothstep(len*.6,len*.18,foot);
    float s=amp*(fi<4.?1.:mix(.6,1.6,uRough));
    g+=D*s*cos(dot(D,p)*k-uWave[i]+fi*1.7)*att;
    len*=.62;amp*=.82;
  }
  return g;
}
void main(){
  vec2 px=vec2(gl_FragCoord.x/uDpr,uHorizon+(uCanvasH-gl_FragCoord.y)/uDpr);
  vec3 d=normalize(vec3(toScreen(px),FOV));
  d.y=min(d.y,-1e-4);
  float t=CAMH/-d.y;
  vec2 p=d.xz*t;
  float foot=t/(uView.y*uDpr*FOV)/max(-d.y,.002);
  vec2 g=waves(p,foot);
  vec2 rp=p*vec2(1.,1.6);
  float fa=smoothstep(.5,.08,foot)*(.012+.05*uRough);
  g+=fa*vec2(sin(rp.x*9.1+uRipple.x+sin(rp.y*4.3)),sin(rp.y*11.3-uRipple.y+sin(rp.x*3.7)));
  float na=smoothstep(2.,.3,foot)*.035;
  g+=na*vec2(vnoise(p*.7+uDrift.x)-vnoise(p*.7+vec2(3.1,0.)+uDrift.x),vnoise(p*.7+vec2(0.,5.2)-uDrift.y)-vnoise(p*.7+vec2(1.7,2.9)-uDrift.y));
  vec3 n=normalize(vec3(-g.x,1.,-g.y));
  vec3 r=reflect(d,n);r.y=abs(r.y)+.002;
  float F=.02+.98*pow(1.-max(dot(n,-d),0.),5.);
  vec3 col=mix(uWater+uGlowCol*.03*uGlow,sky(r,true),F);
  vec2 sun=toScreen(uSun.xy);
  float R=max(uSun.z/uView.y,1e-3);
  vec2 rq=(scr(r)-sun)/R;
  float rr=dot(rq,rq)*step(0.,r.z);
  col+=uGlowCol*uGlow*(1.-uRed*.6)*F*(1.2*exp(-rr*.8)+(1.5+9.*uSpark)*exp(-rr*7.));
  col=mix(col,sky(vec3(d.x,.0005,d.z),false)*.9,(1.-exp(-t/420.))*.7);
  float m=max(col.r,max(col.g,col.b));
  if(m>1.)col=mix(col/m,vec3(1.),clamp((m-1.)*.5,0.,1.));
  col+=(hash(gl_FragCoord.xy+uDither)-.5)/255.;
  gl_FragColor=vec4(col,1.);
}`

type Phase = 'connected' | 'connecting' | 'failed' | 'idle'
type Rgb = [number, number, number]
interface Palette {
  zen: Rgb
  mid: Rgb
  hor: Rgb
  glowCol: Rgb
  water: Rgb
  haze: number
}

const rgb = (hex: string): Rgb => [
  Number.parseInt(hex.slice(1, 3), 16) / 255,
  Number.parseInt(hex.slice(3, 5), 16) / 255,
  Number.parseInt(hex.slice(5, 7), 16) / 255,
]
// What the water reflects. Tuned against the CSS sky after the light pass.
const PALETTE: Record<Phase, Palette> = {
  connected: {
    zen: rgb('#1A2440'),
    mid: rgb('#6E3442'),
    hor: rgb('#F2965E'),
    glowCol: rgb('#FFA862'),
    water: rgb('#06080F'),
    haze: 1,
  },
  connecting: {
    zen: rgb('#0B1128'),
    mid: rgb('#56182C'),
    hor: rgb('#FF9254'),
    glowCol: rgb('#FF8E58'),
    water: rgb('#06070D'),
    haze: 0.9,
  },
  failed: {
    zen: rgb('#070914'),
    mid: rgb('#3A1222'),
    hor: rgb('#B23A30'),
    glowCol: rgb('#E85A44'),
    water: rgb('#05060B'),
    haze: 0.6,
  },
  idle: {
    zen: rgb('#04050A'),
    mid: rgb('#090D20'),
    hor: rgb('#1C2448'),
    glowCol: rgb('#FF7A5A'),
    water: rgb('#04050A'),
    haze: 0.35,
  },
}
// Water calms when there is no live tunnel; connecting carries a little.
const LIVE: Record<Phase, number> = {
  connected: 1,
  connecting: 0.35,
  failed: 0,
  idle: 0,
}
const COLOR_KEYS = ['zen', 'mid', 'hor', 'glowCol', 'water'] as const

const phaseOf = (scene: HTMLElement): Phase => {
  const value = scene.dataset.phase
  return value === 'connecting' || value === 'failed' || value === 'idle'
    ? value
    : 'connected'
}
const opacity = (element: Element | null) =>
  element ? Number.parseFloat(getComputedStyle(element).opacity) || 0 : 0

const TAU = 2 * Math.PI
// The shader's value noise repeats every NOISE lattice cells.
const NOISE_PERIOD = 256
// Deep-water speed of each wave octave, as the shader builds them.
const WAVE_SPEEDS = Array.from(
  { length: 9 },
  (_, octave) => Math.sqrt((9.81 * 6.2832) / (15 * 0.62 ** octave)) * 0.8,
)

/** The water's time terms, wrapped in double precision on each one's own period.
 *  A raw seconds uniform would leave float32 wave phases quantised after a day
 *  of tray uptime; each wrapped term is exactly periodic, so there is no seam. */
export const seaWaterClock = (seconds: number) => ({
  waves: WAVE_SPEEDS.map((speed) => (speed * seconds) % TAU),
  ripple: [(3.1 * seconds) % TAU, (2.6 * seconds) % TAU] as const,
  drift: [
    (0.15 * seconds) % NOISE_PERIOD,
    (0.12 * seconds) % NOISE_PERIOD,
  ] as const,
  dither: seconds % 1,
})

// The lose-context control of a canvas outlives its context, so a remount on
// the same canvas (StrictMode) can bring back a context an earlier dispose released.
const contextControls = new WeakMap<HTMLCanvasElement, WEBGL_lose_context>()

export const startSeaWater = (
  scene: HTMLElement,
  canvas: HTMLCanvasElement,
) => {
  const water = canvas.parentElement
  const sunBody = scene.querySelector('.sea-track .sea-sun-body')
  const sunRed = scene.querySelector('.sea-track .sea-red')
  const sunGlow = scene.querySelector('.sea-track .sea-sun-glow')
  const moon = scene.querySelector('.sea-moon')
  const crescent = scene.querySelector('.sea-crescent')
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  })
  if (!gl || !water || !sunBody) return null
  const control =
    contextControls.get(canvas) ?? gl.getExtension('WEBGL_lose_context')
  if (control) contextControls.set(canvas, control)

  // Program, shaders, buffer and uniform locations; rebuilt after a context restore.
  const setup = () => {
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) return null
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
      gl.deleteShader(shader)
      return null
    }
    const vertex = compile(gl.VERTEX_SHADER, VERTEX)
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT)
    const program = gl.createProgram()
    const buffer = gl.createBuffer()
    const release = () => {
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
    }
    if (!vertex || !fragment || !program || !buffer) {
      release()
      return null
    }
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      release()
      return null
    }
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    )
    const position = gl.getAttribLocation(program, 'p')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    const at = (name: string) => gl.getUniformLocation(program, name)
    const uniforms = {
      view: at('uView'),
      horizon: at('uHorizon'),
      dpr: at('uDpr'),
      canvasH: at('uCanvasH'),
      wave: at('uWave'),
      ripple: at('uRipple'),
      drift: at('uDrift'),
      dither: at('uDither'),
      sun: at('uSun'),
      moon: at('uMoon'),
      glow: at('uGlow'),
      red: at('uRed'),
      rough: at('uRough'),
      spark: at('uSpark'),
      haze: at('uHaze'),
      zen: at('uZen'),
      mid: at('uMid'),
      hor: at('uHor'),
      glowCol: at('uGlowCol'),
      water: at('uWater'),
    }
    return { uniforms, release }
  }
  let lost = gl.isContextLost()
  // A remount on a canvas an earlier dispose released (StrictMode): its lost
  // event is still queued, and the context can come back once it is handled.
  const revive = lost
  let resources = lost ? null : setup()
  if (!lost && !resources) return null

  const initial = PALETTE[phaseOf(scene)]
  const current: Palette = {
    zen: [...initial.zen],
    mid: [...initial.mid],
    hor: [...initial.hor],
    glowCol: [...initial.glowCol],
    water: [...initial.water],
    haze: initial.haze,
  }
  let rough = 0.2
  let spark = 0
  let last = performance.now()
  const origin = last
  let frame = 0
  let timer = 0
  let running = false
  let interval = 0
  let drawn = false
  let reveal = 0
  let revival = 0

  const schedule = () => {
    if (interval > 0) {
      timer = window.setTimeout(() => {
        timer = 0
        frame = requestAnimationFrame(draw)
      }, interval)
    } else {
      frame = requestAnimationFrame(draw)
    }
  }
  const stop = () => {
    cancelAnimationFrame(frame)
    window.clearTimeout(timer)
    frame = 0
    timer = 0
  }
  const draw = (now: number) => {
    frame = 0
    schedule()
    if (!resources) return
    const u = resources.uniforms
    const dt = Math.min((now - last) / 1000, 0.1)
    last = now
    const phase = phaseOf(scene)
    const target = PALETTE[phase]
    const k = 1 - Math.exp(-dt / 1.1)
    for (const key of COLOR_KEYS) {
      const [r, g, b] = current[key]
      const [tr, tg, tb] = target[key]
      current[key] = [r + (tr - r) * k, g + (tg - g) * k, b + (tb - b) * k]
    }
    current.haze += (target.haze - current.haze) * k
    const traffic = readSeaTraffic() * LIVE[phase]
    rough += (0.18 + 0.7 * traffic - rough) * (1 - Math.exp(-dt / 1.4))
    spark += (traffic - spark) * (1 - Math.exp(-dt / 0.6))

    const box = scene.getBoundingClientRect()
    const sea = water.getBoundingClientRect()
    if (box.width <= 0 || sea.height <= 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const width = Math.round(sea.width * dpr)
    const height = Math.round(sea.height * dpr)
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      gl.viewport(0, 0, width, height)
    }
    const sun = sunBody.getBoundingClientRect()
    const moonBox = crescent?.getBoundingClientRect()
    const clock = seaWaterClock((now - origin) / 1000)
    gl.uniform2f(u.view, box.width, box.height)
    gl.uniform1f(u.horizon, sea.top - box.top)
    gl.uniform1f(u.dpr, dpr)
    gl.uniform1f(u.canvasH, height)
    gl.uniform1fv(u.wave, clock.waves)
    gl.uniform2f(u.ripple, clock.ripple[0], clock.ripple[1])
    gl.uniform2f(u.drift, clock.drift[0], clock.drift[1])
    gl.uniform1f(u.dither, clock.dither)
    gl.uniform4f(
      u.sun,
      sun.left - box.left + sun.width / 2,
      sun.top - box.top + sun.height / 2,
      sun.width / 2,
      sun.width > 0 ? sun.height / sun.width : 1,
    )
    gl.uniform4f(
      u.moon,
      moonBox ? moonBox.left - box.left + moonBox.width / 2 : 0,
      moonBox ? moonBox.top - box.top + moonBox.height / 2 : 0,
      moonBox ? moonBox.width / 2 : 1,
      opacity(moon),
    )
    gl.uniform1f(u.glow, opacity(sunGlow))
    gl.uniform1f(u.red, opacity(sunRed))
    gl.uniform1f(u.rough, rough)
    gl.uniform1f(u.spark, spark)
    gl.uniform1f(u.haze, current.haze)
    for (const key of COLOR_KEYS) gl.uniform3fv(u[key], current[key])
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    if (!drawn) {
      drawn = true
      // Fade in over the CSS water, then retire the CSS layers underneath.
      canvas.style.opacity = '1'
      reveal = window.setTimeout(() => {
        if (!lost) scene.dataset.water = 'gl'
      }, 700)
    }
  }
  const onLost = (event: Event) => {
    event.preventDefault()
    lost = true
    resources = null
    stop()
    window.clearTimeout(reveal)
    drawn = false
    delete scene.dataset.water
    canvas.style.opacity = '0'
    // Chromium allows a restore only after the lost event has been handled.
    if (revive) revival = window.setTimeout(() => control?.restoreContext(), 0)
  }
  const onRestored = () => {
    resources = setup()
    if (!resources) return
    lost = false
    if (running) {
      last = performance.now()
      schedule()
    }
  }
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)
  return {
    /** Draws every display frame, or about 15 fps when throttled. */
    resume(throttled = false) {
      const next = throttled ? THROTTLED_WATER_FRAME_MS : 0
      if (running && interval === next) return
      if (!running) last = performance.now()
      running = true
      interval = next
      stop()
      if (!lost) schedule()
    },
    pause() {
      running = false
      stop()
    },
    dispose() {
      running = false
      stop()
      window.clearTimeout(reveal)
      window.clearTimeout(revival)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      delete scene.dataset.water
      resources?.release()
      resources = null
      // Release the context now instead of waiting for GC: Chromium caps live contexts.
      if (!lost) control?.loseContext()
    },
  }
}
