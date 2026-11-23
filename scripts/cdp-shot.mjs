/* CDP 截图：node scripts/cdp-shot.mjs <expr-file> <out.png> */
import fs from 'node:fs';

const exprFile = process.argv[2];
const outFile = process.argv[3] || 'tmp/cdp-shot.png';
const expression = exprFile && fs.existsSync(exprFile) ? fs.readFileSync(exprFile, 'utf8') : '1';
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
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id !== id) return;
      ws.removeEventListener('message', onMsg);
      if (m.error) rej(new Error(JSON.stringify(m.error))); else res(m.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
await new Promise(r => setTimeout(r, 600));
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.mkdirSync('tmp', { recursive: true });
fs.writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
ws.close();
console.log(outFile);
