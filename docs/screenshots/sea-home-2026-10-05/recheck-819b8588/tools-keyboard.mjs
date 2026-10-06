import fs from 'node:fs/promises'; import {connect,sleep} from './cdp.mjs';
const c=await connect(),checks=[]; await c.send('Page.enable'); await c.send('Runtime.enable');
try {
 await c.send('Emulation.setDeviceMetricsOverride',{width:860,height:540,deviceScaleFactor:1,mobile:false});
 for(const state of ['failed','protectedOffline']) {
  await c.send('Page.navigate',{url:`http://127.0.0.1:3012/?lang=en&quality=lite&scenario=${state}&long`}); await sleep(1600);
  const closed=await c.evaluate("(()=>{const tools=document.querySelector('.tono-home__tools'),card=tools.closest('.tono-home__progress-card'),details=tools.closest('details');details.querySelector('summary').focus();return {closed:!details.open,hidden:[...tools.querySelectorAll('button')].every(b=>!b.checkVisibility()),bottom:card.getBoundingClientRect().bottom,height:card.clientHeight,primaries:[...document.querySelectorAll('.tono-home__actions button')].map(b=>b.textContent)}})()");
  checks.push({name:`long English minimum ${state}, no third row`,pass:closed.closed&&closed.hidden&&closed.bottom<=482&&closed.height>56,detail:closed});
  await c.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await c.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  const hiddenFocus=await c.evaluate("({outsideTools:!document.activeElement.closest('.tono-home__tools'),label:document.activeElement.textContent})");checks.push({name:`closed tools excluded from Tab order ${state}`,pass:hiddenFocus.outsideTools,detail:hiddenFocus});
  await c.evaluate("document.querySelector('.tono-home__tools').closest('details').querySelector('summary').focus()");
  await c.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await c.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await sleep(100);
  const opened=await c.evaluate("document.querySelector('.tono-home__tools').closest('details').open");
  checks.push({name:`technical details keyboard disclosure ${state}`,pass:opened});
  await c.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await c.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await sleep(50);
  const focus=await c.evaluate("({inTools:!!document.activeElement.closest('.tono-home__tools'),label:document.activeElement.textContent})"); checks.push({name:`disclosed tools keyboard reachable ${state}`,pass:focus.inTools,detail:focus});
  await c.evaluate("document.querySelector('.tono-home__tools').scrollIntoView({block:'end'})");
  await fs.writeFile(`/tmp/tono-pr2-recheck-20261005/technical-tools-${state}-long-en-860.png`,Buffer.from((await c.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 }
 const exceptions=c.events.filter(e=>e.method==='Runtime.exceptionThrown');
 await fs.writeFile('/tmp/tono-pr2-recheck-20261005/tools-keyboard.json',JSON.stringify({checks,exceptions},null,2));console.log({checks:checks.length,failures:checks.filter(x=>!x.pass),exceptions:exceptions.length});if(checks.some(x=>!x.pass)||exceptions.length)process.exitCode=1;
} finally { c.ws.close() }
