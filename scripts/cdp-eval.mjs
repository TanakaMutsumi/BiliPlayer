/* 通过 Electron CDP 在页面里执行一段 JS：node scripts/cdp-eval.mjs <expr-file>
   需要应用以 --remote-debugging-port=9222 --remote-allow-origins=* 启动。 */
import fs from 'node:fs';

const exprFile = process.argv[2];
if (!exprFile) { console.error('usage: node scripts/cdp-eval.mjs <expr-file>'); process.exit(1); }
const expression = fs.readFileSync(exprFile, 'utf8');
const cdpPort = process.env.CDP_PORT || 9222;
const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json/list')).json();
const page = list.find(t => t.type === 'page' && String(t.url).includes('127.0.0.1')) || list.find(t => t.type === 'page');
if (!page) { console.error('no page target'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
function send(method, params) {
  return new Promise((res, rej) => {
    const id = ++seq;
    const onMsg = ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id !== id) return;
      ws.removeEventListener('message', onMsg);
      if (m.error) rej(new Error(JSON.stringify(m.error)));
      else res(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const r = await send('Runtime.evaluate', {
  expression, awaitPromise: true, returnByValue: true, userGesture: true, allowUnsafeEvalBlockedByCSP: true
});
ws.close();
if (r.exceptionDetails) {
  console.error(JSON.stringify(r.exceptionDetails, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(r.result && r.result.value, null, 2));
