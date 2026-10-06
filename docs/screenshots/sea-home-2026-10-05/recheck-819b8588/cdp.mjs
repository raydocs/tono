export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function connect() {
  const targets = await (await fetch('http://127.0.0.1:9384/json')).json();
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pending = new Map(); const events = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); if(p) { pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); } } else events.push(m); };
  const send = (method, params={}) => new Promise((resolve,reject) => { const i=++id; pending.set(i,{resolve,reject}); ws.send(JSON.stringify({id:i,method,params})); });
  const evaluate = async expression => { const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  return {ws,send,evaluate,events};
}
