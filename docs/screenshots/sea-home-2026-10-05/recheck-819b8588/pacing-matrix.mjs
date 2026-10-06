import fs from 'node:fs/promises'
import { connect, sleep } from './cdp.mjs'
const c = await connect()
const dir = '/tmp/tono-pr2-recheck-20261005'
await c.send('Page.enable')
await c.send('Runtime.enable')
await c.send('Page.stopScreencast')
const browser = await c.send('Browser.getVersion')
const rows = []
const prefs = () => c.evaluate("JSON.parse(localStorage.getItem('tono-ui-preferences'))")
const waitComplete = async revision => {
  const start = Date.now()
  while (Date.now() - start < 18000) {
    const p = await prefs()
    if (p?.revision === revision && p.measured && p.report?.visibleMs >= 3000) return p
    await sleep(150)
  }
  throw Error(`Probe did not finish revision ${revision}`)
}
const nav = async (url, width, height) => {
  await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await c.send('Page.navigate', { url })
  await sleep(1300)
  const p = await prefs()
  if (!p) throw Error('Missing preview preferences')
  await waitComplete(p.revision)
  await sleep(400)
}
const measure = async (name, scene, sheet, quality, readout, remeasure) => {
  const previous = await prefs()
  await c.evaluate(`document.querySelector(${JSON.stringify(remeasure)}).click()`)
  await sleep(50)
  const armed = await prefs()
  if (armed.revision <= previous.revision || armed.measured) throw Error('Re-arm was not fresh')
  const startedAt = new Date().toISOString()
  const p = await waitComplete(armed.revision)
  const dom = await c.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(readout)}),s=document.querySelector('.tono-home__sheet'),e=document.querySelector('.sea-scene');return {readout:r.textContent,complete:r.getAttribute('data-probe-complete'),sheet:s?.getAttribute('data-open')==='true',sceneSize:e?{width:e.clientWidth,height:e.clientHeight}:null,visible:document.visibilityState,animations:document.getAnimations().filter(a=>a.playState==='running').length}})()`)
  if (dom.complete !== 'true' || dom.visible !== 'visible' || p.motion !== quality || dom.sheet !== sheet) throw Error(`Wrong state ${name}: ${JSON.stringify(dom)}`)
  rows.push({ name, scene, sheet, quality, startedAt, revision: p.revision, report: p.report, ...dom })
  console.log(JSON.stringify(rows.at(-1)))
  await fs.writeFile(`${dir}/pacing-${name}.png`, Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  await sleep(400)
}
try {
  for (const quality of ['full', 'lite']) {
    await nav(`file:///tmp/tono-pr2-review-20261005/s2-scene-bundle/index.html?lang=zh&quality=${quality}&phase=connected`,920,664)
    await measure(`scene-${quality}`,true,false,quality,'.sea-preview-readout','[data-remeasure]')
    for (const layout of ['default','fullbleed']) {
      await nav(`http://127.0.0.1:3012/?lang=zh&quality=${quality}&scenario=connected&diagnostics${layout==='fullbleed'?'&full':''}`,920,600)
      await measure(`home-${layout}-${quality}-closed`,false,false,quality,'[data-testid="tono-home-preview-readout"]','[data-preview-remeasure]')
      await c.evaluate("document.querySelector('.tono-home__telemetry button').click()")
      await sleep(650)
      await measure(`home-${layout}-${quality}-open`,false,true,quality,'[data-testid="tono-home-preview-readout"]','[data-preview-remeasure]')
      if (layout === 'default') {
        await c.send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape'})
        await sleep(650)
        await measure(`home-${layout}-${quality}-closed-repeat`,false,false,quality,'[data-testid="tono-home-preview-readout"]','[data-preview-remeasure]')
      }
    }
  }
  await c.send('Page.navigate',{url:'about:blank'})
  await sleep(500)
  const blank = await c.evaluate("new Promise(resolve=>{let last=null,elapsed=0,frames=[];const frame=now=>{if(last!==null){const d=now-last;frames.push(d);elapsed+=d}last=now;if(elapsed>=3000){const s=[...frames].sort((a,b)=>a-b);resolve({fps:frames.length*1000/elapsed,p95:s[Math.ceil(s.length*.95)-1],samples:frames.length,visibleMs:elapsed,visible:document.visibilityState})}else requestAnimationFrame(frame)};requestAnimationFrame(frame)})")
  const errors=c.events.filter(e=>e.method==='Runtime.exceptionThrown')
  const result={browser,method:'Existing preview bounded 3-second rAF probe, fresh revision per sample; tracing and screencast off; capture only after probe; 920x600 home; scene viewport 920x664 / content 920x600. Same Chrome page. Default home scene has 200px sidebar; fullbleed home matches scene dimensions. Blank is a separately bounded 3s control, not production code.',rows,blank,exceptions:errors}
  await fs.writeFile(`${dir}/pacing-matrix.json`,JSON.stringify(result,null,2))
  console.log(JSON.stringify({blank,exceptions:errors.length}))
  if(errors.length) process.exitCode=1
} finally { c.ws.close() }
