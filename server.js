'use strict';
/* BiliPlayer 本地服务：静态页面 + B站接口代理 + 媒体流代理（默认仅监听本机，可开局域网模式）
   可独立运行（node server.js），也可被 Electron 主进程内嵌调用（startServer） */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const Bilibili = require('./src/bilibili');
const NetEase = require('./src/netease');
const AiTheme = require('./src/aitheme');
const Lyrics = require('./src/lyrics');
const { RoomServer } = require('./src/room-server');
const { CloudflaredTunnel } = require('./src/tunnel');
const QQMusic = require('./src/qqmusic');

const HOST = '127.0.0.1';
const PORT_FROM = parseInt(process.env.BP_PORT_FROM, 10) || 8899;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.BP_DATA_DIR || path.join(__dirname, 'data');
const zlib = require('zlib');
const crypto = require('crypto');

/* 出站连接复用：媒体流/图片代理不再每次重建TCP+TLS握手 */
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16, keepAliveMsecs: 30000 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 16, keepAliveMsecs: 30000 });
function agentFor(proto) { return proto === 'https:' ? httpsAgent : httpAgent; }

const bili = new Bilibili(DATA_DIR);
const ne = new NetEase(DATA_DIR);
const ai = new AiTheme(DATA_DIR);
const lyricSvc = new Lyrics(DATA_DIR, bili, ne);
const roomServer = new RoomServer();
const cloudflared = new CloudflaredTunnel();
const qq = new QQMusic(DATA_DIR);

/* ---------- 局域网模式 + 手机遥控中继 ----------
   默认只监听 127.0.0.1；开启后绑定 0.0.0.0 并生成4位PIN，
   手机端 /m/ 凭PIN遥控电脑播放（切歌/音量/进度/点歌）。 */
let curHost = HOST;
let curPort = PORT_FROM;
let serverRef = null;
let lanOn = false;
const pinFile = path.join(DATA_DIR, 'pin.txt');
let rcPin = '';
try { rcPin = fs.readFileSync(pinFile, 'utf8').trim(); } catch (e) { } // 重启后保持同一PIN，手机不用反复配对
function savePin() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(pinFile, rcPin, 'utf8'); } catch (e) { }
}
const rcState = { at: 0, data: null };
let rcCmds = [];
let rcSeq = 0;

function isLocal(req) {
  const a = req.socket && req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
function lanIPs() {
  return lanDetail().map(i => i.ip);
}
/* 详细网卡信息：标注蓝牙个人区域网（Android 蓝牙共享网络的 192.168.44.x 网段） */
function lanDetail() {
  const out = [];
  const ifs = os.networkInterfaces();
  Object.keys(ifs).forEach(name => {
    (ifs[name] || []).forEach(i => {
      if (i.family === 'IPv4' && !i.internal) {
        const isBt = /bluetooth|蓝牙/i.test(name) || /^192\.168\.4[0-9]\./.test(i.address);
        const isWifi = /wlan|wi-?fi|无线|wi_fly/i.test(name);
        out.push({ ip: i.address, name: String(name).slice(0, 40), bt: isBt, wifi: isWifi });
      }
    });
  });
  return out;
}
function rebind(host) {
  return new Promise(resolve => {
    if (curHost === host || !serverRef) return resolve(true);
    curHost = host;
    let done = false;
    const finish = ok => { if (!done) { done = true; resolve(ok); } };
    // 渲染进程的 keep-alive 长连接会让 close() 一直等，必须强断
    try { serverRef.closeAllConnections(); } catch (e) { }
    serverRef.close(() => {
      serverRef.listen(curPort, curHost, () => finish(true));
    });
    setTimeout(() => finish(false), 4000); // 超时兜底：close 回调迟迟不回也放行
  });
}
function rcCheckPin(req, u) {
  if (!lanOn) return false;
  const pin = (u.searchParams.get('pin') || '').trim();
  return pin === rcPin;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

/* ---------- AutoEQ（MIT）耳机校准数据：GitHub API + 内存缓存 ---------- */
const AUTO_SOURCES = [
  'results/oratory1990/over-ear',
  'results/oratory1990/in-ear',
  'results/oratory1990/earbud',
  'results/crinacle/over-ear',
  'results/crinacle/in-ear'
];
const _autoDirCache = new Map();
const _autoProfileCache = new Map();
function ghContents(path) {
  return new Promise((resolve, reject) => {
    const enc = String(path || '').split('/').map(encodeURIComponent).join('/');
    const url = 'https://api.github.com/repos/jaakkopasanen/AutoEq/contents/' + enc + '?ref=master';
    const req = https.get(url, {
      headers: { 'User-Agent': 'BiliPlayer/1.0', 'Accept': 'application/vnd.github+json' }
    }, res => {
      let b = '';
      res.on('data', d => { b += d; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(b); } catch (e) {}
        if (res.statusCode !== 200) {
          return reject(new Error('GitHub ' + (res.statusCode || '') + (j && j.message ? ' ' + j.message : '')));
        }
        if (!j) return reject(new Error('GitHub 返回解析失败'));
        resolve(j);
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('GitHub 请求超时')));
  });
}

/* 静态文件内存缓存（mtime失效）+ Brotli/gzip（首次请求压缩后缓存，避免每请求重复压缩CPU）+ ETag/304 */
const staticCache = new Map(); // fp -> {buf, mtimeMs, etag, gz?, br?}
const COMPRESS_TYPE = /^text\/|application\/json|application\/manifest/;

function serveStatic(res, pathname, req) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { p = '/'; }
  if (p === '/') p = '/index.html';
  if (p === '/m') { res.writeHead(302, { Location: '/m/' }); res.end(); return; }
  if (p.endsWith('/')) p = p + 'index.html'; // 目录入口（手机端 /m/）
  const fp = path.normalize(path.join(PUBLIC_DIR, p));
  if (!fp.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { ok: false, message: 'forbidden' });

  let entry = staticCache.get(fp);
  try {
    const st = fs.statSync(fp);
    if (!entry || entry.mtimeMs !== st.mtimeMs || entry.size !== st.size) {
      const buf = fs.readFileSync(fp);
      entry = { buf, mtimeMs: st.mtimeMs, size: st.size, etag: '"' + crypto.createHash('md5').update(buf).digest('hex').slice(0, 16) + '"' };
      if (staticCache.size > 60) staticCache.clear(); // 简单防膨胀
      staticCache.set(fp, entry);
    }
  } catch (e) {
    staticCache.delete(fp);
    return sendJson(res, 404, { ok: false, message: 'not found' });
  }

  const type = MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream';
  if (req && req.method === 'HEAD') {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': entry.size, ETag: entry.etag });
    return res.end();
  }
  if (req && req.headers['if-none-match'] === entry.etag) {
    res.writeHead(304, { ETag: entry.etag });
    return res.end();
  }
  const headers = {
    'Content-Type': type,
    ETag: entry.etag,
    'Cache-Control': 'no-cache', // 必须复验（本地开发文件会变），但304命中时零下载
    'X-Content-Type-Options': 'nosniff'
  };
  const ae = (req && req.headers['accept-encoding']) || '';
  const compressible = COMPRESS_TYPE.test(type) && entry.size > 1024;
  /* Brotli 优先（比gzip再小15-20%），压缩结果缓存进entry——同文件只压一次 */
  if (compressible && /\bbr\b/.test(ae)) {
    if (!entry.br) entry.br = zlib.brotliCompressSync(entry.buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
    headers['Content-Encoding'] = 'br';
    headers['Content-Length'] = entry.br.length;
    headers['Vary'] = 'Accept-Encoding';
    res.writeHead(200, headers);
    return res.end(entry.br);
  }
  if (compressible && /\bgzip\b/.test(ae)) {
    if (!entry.gz) entry.gz = zlib.gzipSync(entry.buf);
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = entry.gz.length;
    headers['Vary'] = 'Accept-Encoding';
    res.writeHead(200, headers);
    return res.end(entry.gz);
  }
  headers['Content-Length'] = entry.size;
  res.writeHead(200, headers);
  res.end(entry.buf);
}

function sendJson(res, status, obj) {
  /* API JSON 压缩：rc/state 每2秒轮询（含队列窗口约20KB），gzip 省约80%流量
     （req 通过 res._req 传入——handler 里统一挂载） */
  const buf = Buffer.from(JSON.stringify(obj), 'utf8');
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  const req = res._req;
  const canGzip = buf.length > 1024 && /\bgzip\b/.test((req && req.headers && req.headers['accept-encoding']) || '');
  if (canGzip) {
    const gz = zlib.gzipSync(buf);
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = gz.length;
    res.writeHead(status, headers);
    return res.end(gz);
  }
  headers['Content-Length'] = buf.length;
  res.writeHead(status, headers);
  res.end(buf);
}
const ok = (res, data) => sendJson(res, 200, { ok: true, data });

async function readBody(req) {
  return new Promise(resolve => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

/* ---------- 本地歌单存储（内存缓存 + 原子写入防损坏） ---------- */
const plFile = path.join(DATA_DIR, 'playlists.json');
let plCache = null;
function loadPls() {
  if (plCache) return plCache;
  try { const a = JSON.parse(fs.readFileSync(plFile, 'utf8')); plCache = Array.isArray(a) ? a : []; } catch { plCache = []; }
  return plCache;
}
function savePls(a) {
  plCache = a;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  /* 先写临时文件再原子替换：写入中途崩溃/断电不会损坏歌单文件；旧文件留 .bak 兜底 */
  const tmp = plFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(a, null, 2), 'utf8');
  try {
    if (fs.existsSync(plFile)) fs.copyFileSync(plFile, plFile + '.bak');
    fs.renameSync(tmp, plFile);
  } catch (e) { fs.writeFileSync(plFile, JSON.stringify(a, null, 2), 'utf8'); }
}

/* ---------- 媒体流代理（带 Range，支持拖动进度） ---------- */
let activeStreams = 0;
const MAX_STREAMS = 6; // 并发上限：防止局域网滥用打满带宽
function streamProxy(req, res, u) {
  const target = u.searchParams.get('u') || '';
  let tu;
  try { tu = new URL(target); } catch { return sendJson(res, 400, { ok: false, message: 'bad url' }); }
  const host = tu.hostname;
  const isNe = host.endsWith('.music.126.net');
  const isQq = host.endsWith('.qq.com') || host.endsWith('.qqmusic.qq.com') || host.endsWith('.music.tc.qq.com') || host.endsWith('.gtimg.cn');
  const okHost = isNe || isQq || Bilibili.CDN_SUFFIXES.some(s => host.endsWith(s));
  const okPath = tu.pathname.includes('/upgcxcode/'); // B站第三方PCDN的特征路径
  if (!okHost && !okPath) {
    return sendJson(res, 403, { ok: false, message: 'host not allowed: ' + host });
  }
  if (activeStreams >= MAX_STREAMS) return sendJson(res, 503, { ok: false, message: '媒体流并发已达上限' });
  const mod = tu.protocol === 'http:' ? http : https;
  const headers = {
    'Referer': isQq ? 'https://y.qq.com/' : (isNe ? 'https://music.163.com/' : 'https://www.bilibili.com/'),
    'User-Agent': bili.ua,
    'Accept': '*/*'
  };
  if (req.headers.range) headers.Range = req.headers.range;
  activeStreams++;
  /* 每个请求只扣一次并发数：客户端中断会同时触发 req 的 close 和上游的 error，
     两条路都扣的话计数会漂成负数，并发上限就形同虚设 */
  let counted = true;
  const release = () => { if (counted) { counted = false; activeStreams--; } };
  const preq = mod.request(tu, { method: 'GET', headers, agent: agentFor(tu.protocol) }, pres => {
    const h = {};
    ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'location'].forEach(k => {
      if (pres.headers[k]) h[k] = pres.headers[k]; // location：CDN 302 跳转放行给浏览器跟随
    });
    /* FLAC修正：QQ CDN给无损流的Content-Type是audio/x-ogg，浏览器按ogg解不出 → 强制audio/flac */
    if (/\.flac(\?|$)/i.test(tu.pathname + tu.search)) h['content-type'] = 'audio/flac';
    res.writeHead(pres.statusCode || 502, h);
    pres.pipe(res);
    pres.on('error', () => res.destroy());
    pres.on('end', release);
  });
  preq.setTimeout(30000, () => preq.destroy(new Error('upstream timeout')));
  preq.on('error', () => {
    release();
    if (!res.headersSent) sendJson(res, 502, { ok: false, message: '媒体流请求失败' });
    else res.destroy();
  });
  req.on('close', () => { if (!res.writableEnded) { release(); preq.destroy(); } });
  preq.end();
}

/* ---------- 封面图代理（MV 封面取色、界面主题色；只放行图片 CDN） ---------- */
const IMG_HOSTS = ['.hdslb.com', '.biliimg.com', '.music.126.net', '.126.net', '.gtimg.cn', '.qq.com'];
const imgCache = new Map();
let imgCacheBytes = 0;
const IMG_CACHE_MAX_BYTES = 32 * 1024 * 1024;
function imgCachePut(key, buf, type) {
  const old = imgCache.get(key);
  if (old) imgCacheBytes -= old.buf.length;
  imgCache.set(key, { buf: buf, type: type, at: Date.now() });
  imgCacheBytes += buf.length;
  while (imgCacheBytes > IMG_CACHE_MAX_BYTES && imgCache.size > 1) {
    const k = imgCache.keys().next().value;
    const v = imgCache.get(k);
    imgCacheBytes -= v.buf.length;
    imgCache.delete(k);
  }
}
const imageHostOk = host => IMG_HOSTS.some(s => host.endsWith(s));
function fetchImage(tu, redirects) {
  return new Promise((resolve, reject) => {
    const mod = tu.protocol === 'http:' ? http : https;
    const isNe = tu.hostname.endsWith('music.126.net');
    const isQq = tu.hostname.endsWith('gtimg.cn') || tu.hostname.endsWith('qq.com'); // QQ音乐封面在 y.gtimg.cn
    const preq = mod.get(tu, {
      headers: {
        'Referer': isQq ? 'https://y.qq.com/' : (isNe ? 'https://music.163.com/' : 'https://www.bilibili.com/'),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
      }
    }, pres => {
      if (pres.statusCode >= 300 && pres.statusCode < 400 && pres.headers.location && redirects < 3) {
        pres.resume();
        let next;
        try { next = new URL(pres.headers.location, tu); } catch { return reject(new Error('bad redirect')); }
        if (!imageHostOk(next.hostname)) return reject(new Error('redirect host not allowed'));
        resolve(fetchImage(next, redirects + 1));
        return;
      }
      if (pres.statusCode !== 200) { pres.resume(); return reject(new Error('image ' + pres.statusCode)); }
      const chunks = [];
      let size = 0;
      pres.on('data', d => {
        size += d.length;
        if (size > 10 * 1024 * 1024) { pres.destroy(); reject(new Error('image too large')); return; }
        chunks.push(d);
      });
      pres.on('end', () => resolve({ buf: Buffer.concat(chunks), type: pres.headers['content-type'] || 'image/jpeg' }));
      pres.on('error', reject);
    });
    preq.on('error', reject);
    preq.setTimeout(8000, () => preq.destroy(new Error('image timeout')));
  });
}
function serveImage(req, res, u) {
  const target = u.searchParams.get('u') || '';
  let tu;
  try { tu = new URL(target); } catch { return sendJson(res, 400, { ok: false, message: 'bad url' }); }
  if (tu.protocol !== 'http:' && tu.protocol !== 'https:') return sendJson(res, 403, { ok: false, message: 'bad protocol' });
  if (!imageHostOk(tu.hostname)) return sendJson(res, 403, { ok: false, message: 'host not allowed' });
  const key = tu.href;
  const hit = imgCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) {
    res.writeHead(200, { 'Content-Type': hit.type, 'Content-Length': hit.buf.length, 'Cache-Control': 'public, max-age=1800' });
    return res.end(hit.buf);
  }
  fetchImage(tu, 0).then(r => {
    imgCachePut(key, r.buf, r.type);
    res.writeHead(200, { 'Content-Type': r.type, 'Content-Length': r.buf.length, 'Cache-Control': 'public, max-age=1800' });
    res.end(r.buf);
  }).catch(e => {
    if (!res.headersSent) sendJson(res, 404, { ok: false, message: e.message || 'image fetch failed' });
    else res.destroy();
  });
}

/* ---------- API 路由 ---------- */
async function handleApi(req, res, pathname, u) {
  try {
    /* 局域网安全：非本机请求一律需要配对码（除连通性探测 /api/ping）
       —— 否则同网段任意设备可读写歌单/Cookie/登录接口 */
    if (!isLocal(req) && pathname !== '/api/ping' && !rcCheckPin(req, u)) {
      return sendJson(res, 403, { ok: false, message: '需要配对码' });
    }
    if (pathname === '/api/ping') return ok(res, { name: 'BiliPlayer', version: '0.2.0' });
    if (pathname === '/api/health') return ok(res, {
      uptime: Math.round(process.uptime()),
      mem: Math.round(process.memoryUsage().rss / 1048576),
      node: process.version,
      streams: activeStreams,
      imgCache: imgCache.size,
      lan: lanOn
    });
    if (pathname === '/api/info') return ok(res, { lan: lanOn, ips: lanIPs(), detail: lanDetail(), port: curPort, host: curHost });

    /* ---------- 局域网模式（连接手机） ---------- */
    if (pathname === '/api/lan/status') return ok(res, { on: lanOn, ip: lanIPs()[0] || '', ips: lanIPs(), detail: lanDetail(), port: curPort, pin: lanOn ? rcPin : '' });
    if (pathname === '/api/lan/on') {
      if (!isLocal(req)) return sendJson(res, 200, { ok: false, message: '仅允许本机开启' });
      /* PIN持久化：已有PIN则沿用（重启不失效），没有才生成新的 */
      if (!rcPin) rcPin = String(Math.floor(1000 + Math.random() * 9000));
      savePin();
      lanOn = true;
      const out = { on: true, ip: lanIPs()[0] || '', ips: lanIPs(), detail: lanDetail(), btIp: (lanDetail().find(i => i.bt) || {}).ip || '', port: curPort, pin: rcPin };
      ok(res, out);
      // 先把响应送出去，再重绑定（重绑定会断开现有连接，包括这条响应）
      setTimeout(() => rebind('0.0.0.0'), 300);
      return;
    }
    if (pathname === '/api/lan/off') {
      if (!isLocal(req)) return sendJson(res, 200, { ok: false, message: '仅允许本机关闭' });
      lanOn = false;
      /* 保留 rcPin（pin.txt）：下次开启沿用同一PIN，手机无需重新配对 */
      rcCmds = [];
      rcState.data = null;
      ok(res, { on: false });
      setTimeout(() => rebind(HOST), 300);
      return;
    }

    /* ---------- 手机遥控中继 ---------- */
    if (pathname === '/api/rc/state' && req.method === 'POST') {
      if (!isLocal(req)) return sendJson(res, 200, { ok: false, message: '状态上报仅限本机' });
      const body = await readBody(req);
      rcState.at = Date.now();
      rcState.data = body || null;
      // 清理超过3分钟的旧指令
      rcCmds = rcCmds.filter(c => Date.now() - c.at < 180000);
      return ok(res, { ok: true });
    }
    if (pathname === '/api/rc/state') {
      if (!rcCheckPin(req, u)) return sendJson(res, 200, { ok: false, message: 'PIN 不正确' });
      return ok(res, { state: rcState.data, at: rcState.at, now: Date.now() });
    }
    if (pathname === '/api/rc/cmd' && req.method === 'POST') {
      if (!rcCheckPin(req, u)) return sendJson(res, 200, { ok: false, message: 'PIN 不正确' });
      const body = await readBody(req);
      if (!body || !body.cmd) return sendJson(res, 200, { ok: false, message: 'bad cmd' });
      rcCmds.push({ id: ++rcSeq, cmd: String(body.cmd).slice(0, 24), arg: body.arg, at: Date.now() });
      if (rcCmds.length > 200) rcCmds = rcCmds.slice(-200); // 队列上限防内存膨胀
      return ok(res, { ok: true, id: rcSeq });
    }
    if (pathname === '/api/rc/cmds') {
      if (!isLocal(req)) return sendJson(res, 200, { ok: false, message: '指令拉取仅限本机' });
      const since = parseInt(u.searchParams.get('since') || '0', 10) || 0;
      return ok(res, { cmds: rcCmds.filter(c => c.id > since) });
    }
    if (pathname === '/api/ai/config') {
      if (req.method === 'POST') {
        const body = await readBody(req);
        return ok(res, ai.updateConfig(body));
      }
      return ok(res, ai.publicConfig());
    }
    if (pathname === '/api/ai/theme' && req.method === 'POST') {
      const body = await readBody(req);
      return ok(res, await ai.generate(body));
    }
    if (pathname === '/api/ai/segment' && req.method === 'POST') {
      const body = await readBody(req);
      return ok(res, await ai.segment(body));
    }
    if (pathname === '/api/ai/test' && req.method === 'POST') {
      return ok(res, await ai.test());
    }
    if (pathname === '/api/user') return ok(res, await bili.userInfo());
    if (pathname === '/api/login/qrcode') return ok(res, await bili.qrcodeGenerate());
    if (pathname === '/api/login/poll') return ok(res, await bili.qrcodePoll(u.searchParams.get('key') || ''));
    if (pathname === '/api/logout') { bili.logout(); return ok(res, {}); }

    if (pathname === '/api/fav/folders') return ok(res, await bili.favFolders());
    if (pathname === '/api/fav/videos') {
      const d = await bili.favVideos(
        u.searchParams.get('media_id'),
        parseInt(u.searchParams.get('pn') || '1', 10),
        parseInt(u.searchParams.get('ps') || '20', 10),
        u.searchParams.get('keyword') || '');
      return ok(res, d);
    }
    if (pathname === '/api/fav/all') return ok(res, { items: await bili.favAll(u.searchParams.get('media_id')) });
    if (pathname === '/api/wl/videos') return ok(res, await bili.watchLaterVideos());

    if (pathname === '/api/search') {
      const order = u.searchParams.get('order') || '';
      const tids = u.searchParams.get('tids') || '';
      return ok(res, await bili.search(u.searchParams.get('keyword') || '', parseInt(u.searchParams.get('pn')) || 1,
        { order: ['totalrank', 'click', 'pubdate', 'dm', 'stow'].includes(order) ? order : '', tids: /^\d+$/.test(tids) ? tids : '' }));
    }
    if (pathname === '/api/suggest') {
      return ok(res, { terms: await bili.suggest(u.searchParams.get('term') || '') });
    }
    /* 聚合搜索：B站 + 网易云 + QQ音乐一次返回，智能重排去重 */
    if (pathname === '/api/search/all') {
      const kw = u.searchParams.get('keyword') || '';
      if (!kw) return ok(res, { items: [] });
      const order = ['totalrank', 'click', 'pubdate', 'dm', 'stow'].includes(u.searchParams.get('order')) ? u.searchParams.get('order') : '';
      /* B站搜索（主源） */
      const biliP = await bili.search(kw, 1, { order }).catch(() => ({ items: [] }));
      const biliItems = (biliP.items || []).map(t => Object.assign({}, t, { _src: 'bili' }));
      /* 网易云搜索 */
      const neP = await ne.search(kw, 15).catch(() => []);
      const neItems = neP.map(t => ({
        nid: t.nid, title: t.title, up: t.artist, pic: t.pic,
        duration: t.duration, fee: t.fee, _src: 'ne'
      }));
      /* QQ搜索（需登录态） */
      const qqP = await qq.search(kw, 1, 15).catch(() => []);
      const qqItems = (qqP || []).map(t => ({
        qmid: t.qmid, qmMediaMid: t.mediaMid || '', title: t.title || '',
        up: t.artist || '', pic: t.pic || '', duration: t.duration || 0, _src: 'qq'
      }));
      /* 去重：同名同艺术家视为同一首 */
      const seen = new Set();
      const dedup = arr => arr.filter(t => {
        const key = (t.title || '').toLowerCase().replace(/\s+/g, '') + '|' + (t.up || '').split('/')[0].toLowerCase().slice(0, 10);
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
      const biliD = dedup(biliItems);
      const neD = dedup(neItems);
      const qqD = dedup(qqItems);
      /* 智能穿插：每3个B站插1个NE + 1个QQ */
      const merged = [];
      let bi = 0, ni = 0, qi = 0;
      while (bi < biliD.length || ni < neD.length || qi < qqD.length) {
        for (let k = 0; k < 3 && bi < biliD.length; k++, bi++) merged.push(biliD[bi]);
        if (ni < neD.length) merged.push(neD[ni++]);
        if (qi < qqD.length) merged.push(qqD[qi++]);
      }
      return ok(res, { items: merged, biliTotal: biliP.total || biliItems.length, neCount: neD.length, qqCount: qqD.length });
    }
    if (pathname === '/api/up/archives') {
      const mid = u.searchParams.get('mid') || '';
      if (!/^\d+$/.test(mid)) return sendJson(res, 200, { ok: false, message: 'mid 无效' });
      return ok(res, { items: await bili.upArchivesByKeyword(mid, u.searchParams.get('keyword') || '') });
    }
    if (pathname === '/api/nversions') {
      return ok(res, { names: await ne.versionDictionary(u.searchParams.get('title') || '', u.searchParams.get('artist') || '') });
    }
    if (pathname === '/api/video') return ok(res, await bili.videoDetail(u.searchParams.get('bvid')));
    if (pathname === '/api/subtitle') {
      return ok(res, await bili.subtitles(u.searchParams.get('bvid'), u.searchParams.get('cid')));
    }
    /* 多源歌词：B站本视频字幕 / 网易云 LRC+YRC+翻译 / 酷狗 KRC / AMLL TTML / LRCLIB */
    if (pathname === '/api/lyrics') {
      const track = {
        bvid: u.searchParams.get('bvid') || '',
        cid: u.searchParams.get('cid') || '',
        nid: u.searchParams.get('nid') || '',
        title: u.searchParams.get('title') || '',
        artist: u.searchParams.get('artist') || '',
        duration: parseFloat(u.searchParams.get('duration')) || 0
      };
      if (!track.title && !track.bvid && !track.nid) return ok(res, { lines: [], source: '', quality: 'none', reason: 'no-track' });
      return ok(res, await lyricSvc.resolve(track));
    }
    if (pathname === '/api/lyrics/offset' && req.method === 'POST') {
      const body = await readBody(req);
      const r = lyricSvc.setOffset(body.key || '', body.offsetMs);
      return ok(res, r || { saved: false });
    }
    if (pathname === '/api/lyrics/align' && req.method === 'POST') {
      const body = await readBody(req);
      const r = lyricSvc.setAlign(body.key || '', body.clear ? null : body.scale, body.offset, body.confidence);
      return ok(res, r || { saved: false });
    }
    if (pathname === '/api/lyrics/choose' && req.method === 'POST') {
      const body = await readBody(req);
      const r = lyricSvc.choose(body.key || '', body.index);
      return ok(res, r || { saved: false });
    }
    if (pathname === '/api/lyrics/clear' && req.method === 'POST') {
      const body = await readBody(req);
      return ok(res, { cleared: lyricSvc.clearCache(body.key || '') });
    }
    if (pathname === '/api/lyrics/import' && req.method === 'POST') {
      const body = await readBody(req);
      return ok(res, lyricSvc.importManual(body.key || '', String(body.text || '').slice(0, 500000), Number(body.duration) || 0));
    }
    if (pathname === '/api/lyrics/override/clear' && req.method === 'POST') {
      const body = await readBody(req);
      return ok(res, { cleared: lyricSvc.clearOverride(body.key || '') });
    }
    if (pathname === '/api/lyrics/lines' && req.method === 'POST') {
      const body = await readBody(req);
      return ok(res, { saved: lyricSvc.writeLineOffsets(body.key || '', body.offsets || {}) });
    }
    if (pathname === '/api/lyrics/lock/clear' && req.method === 'POST') {
      const body = await readBody(req);
      return ok(res, { cleared: lyricSvc.clearLock(body.key || '') });
    }
    if (pathname === '/api/lyrics/backup' && req.method === 'GET') {
      return ok(res, lyricSvc.exportManualData());
    }
    if (pathname === '/api/lyrics/restore' && req.method === 'POST') {
      const body = await readBody(req);
      return ok(res, lyricSvc.importManualData(body.data || body));
    }
    if (pathname === '/api/lyrics/manual-lines' && req.method === 'POST') {
      const body = await readBody(req);
      return ok(res, lyricSvc.saveManualLines(body.key || '', body.lines || [], {
        quality: body.quality,
        offsetMs: body.offsetMs,
        clearLineOffsets: !!body.clearLineOffsets,
        duration: body.duration
      }));
    }
    if (pathname === '/api/nlogin/qr') return ok(res, await ne.qrcodeCreate());
    if (pathname === '/api/nlogin/poll') return ok(res, await ne.qrcodePoll(u.searchParams.get('key') || ''));
    if (pathname === '/api/nuser') return ok(res, {
      user: await ne.loginStatus().catch(() => null),
      loggedIn: ne.loggedIn,
      expired: !!ne.sessionExpired,
      profile: ne.profile
    });
    if (pathname === '/api/nlogout') { await ne.logout(); return ok(res, { ok: true }); }
    if (pathname === '/api/ncookie/set') {
      const v = u.searchParams.get('value') || '';
      const user = await ne.setCookieRaw(v);
      return ok(res, { user });
    }
    if (pathname === '/api/nplaylists') {
      const u = await ne.loginStatus().catch(() => null);
      if (!u) return sendJson(res, 200, { ok: false, message: '网易云未登录' });
      return ok(res, { playlists: await ne.userPlaylists(u.userId) });
    }
    if (pathname === '/api/nplaylist') {
      return ok(res, await ne.playlistDetail(u.searchParams.get('id')));
    }
    if (pathname === '/api/nmedia') {
      const q = u.searchParams.get('quality') || '';
      const br = q === 'hires' ? 1999000 : q === '320' ? 320000 : q === '192' ? 192000 : q === '128' ? 128000 : (q === 'lossless' ? 999000 : 0);
      const d = await ne.songUrl(u.searchParams.get('id'), br || undefined);
      return ok(res, d);
    }
    /* ---- AutoEQ 耳机校准（MIT）：搜索型号 / 拉取 ParametricEQ.txt ---- */
    if (pathname === '/api/autoeq/search') {
      const q = String(u.searchParams.get('q') || '').trim().toLowerCase();
      if (!q) return ok(res, { items: [] });
      const items = [];
      let lastErr = null;
      for (const src of AUTO_SOURCES) {
        let c = _autoDirCache.get(src);
        if (!c || Date.now() - c.at > 10 * 60 * 1000) {
          try {
            const j = await ghContents(src);
            const names = (Array.isArray(j) ? j : [])
              .filter(x => x && x.type === 'dir' && x.name)
              .map(x => x.name);
            c = { at: Date.now(), names };
            _autoDirCache.set(src, c);
          } catch (e) { lastErr = e; continue; }
        }
        for (const n of c.names) {
          if (n.toLowerCase().includes(q)) items.push({ name: n, path: src + '/' + n, source: src });
          if (items.length >= 30) break;
        }
        if (items.length >= 30) break;
      }
      if (!items.length && lastErr) throw lastErr;
      return ok(res, { items: items.slice(0, 30) });
    }
    if (pathname === '/api/autoeq/profile') {
      const p = String(u.searchParams.get('path') || '').trim();
      if (!/^results\/(oratory1990|crinacle)\//.test(p) || p.includes('..') || p.length > 300) {
        return sendJson(res, 400, { ok: false, message: '非法 AutoEQ 路径' });
      }
      const hit = _autoProfileCache.get(p);
      if (hit && Date.now() - hit.at < 30 * 60 * 1000) return ok(res, hit.data);
      /* 绝大多数 AutoEQ 型号目录里的文件名就是 "<型号> ParametricEQ.txt"，
         先直接取文件可省一次目录 API 调用；命名不一致再回退列目录 */
      const model = p.split('/').filter(Boolean).pop();
      let text = '';
      try {
        const fd = await ghContents(p + '/' + model + ' ParametricEQ.txt');
        if (fd && fd.content) text = Buffer.from(fd.content, 'base64').toString('utf8');
      } catch (e) {}
      if (!text) {
        const j = await ghContents(p);
        const files = Array.isArray(j) ? j : [];
        const f = files.find(x => /ParametricEQ\.txt$/i.test(x.name || ''));
        if (!f) throw new Error('该型号没有 ParametricEQ.txt');
        /* 目录列表里的文件对象通常不带 content，需要再取一次文件本身 */
        const fileData = await ghContents(f.path || (p + '/' + f.name));
        text = fileData && fileData.content ? Buffer.from(fileData.content, 'base64').toString('utf8') : '';
      }
      if (!text) throw new Error('AutoEQ 文件为空');
      const data = { name: p.split('/').filter(Boolean).pop(), source: p.split('/')[1] || '', text };
      _autoProfileCache.set(p, { data, at: Date.now() });
      if (_autoProfileCache.size > 200) _autoProfileCache.delete(_autoProfileCache.keys().next().value);
      return ok(res, data);
    }
    /* ---- 推荐：心动 / 漫游 ---- */
    if (pathname === '/api/nheart') {
      const cnt = Math.max(1, Math.min(5, parseInt(u.searchParams.get('count'), 10) || 1));
      return ok(res, { tracks: await ne.heartbeatList(u.searchParams.get('id'), u.searchParams.get('pid'), cnt) });
    }
    if (pathname === '/api/nfm') return ok(res, { tracks: await ne.personalFm() });
    if (pathname === '/api/nfm/trash') return ok(res, { ok: await ne.fmTrash(u.searchParams.get('id')) });
    if (pathname === '/api/nlike') return ok(res, { ok: await ne.likeSong(u.searchParams.get('id'), u.searchParams.get('like') !== '0') });
    if (pathname === '/api/nsimi') return ok(res, { tracks: await ne.simiSongs(u.searchParams.get('id')) });
    if (pathname === '/api/nlyric') {
      /* 歌词结果缓存：同 nid 一小时内直接复用（切歌链路要连打 song_detail+search+lrclib，不加缓存既慢又费风控配额） */
      const lid = String(u.searchParams.get('id') || '');
      if (!global._nlyricCache) global._nlyricCache = new Map();
      const cHit = global._nlyricCache.get(lid);
      if (lid && cHit && Date.now() - cHit.at < 60 * 60 * 1000 && (cHit.data.lines || []).length) return ok(res, cHit.data);
      let t = null;
      try { t = await ne.songDetail(u.searchParams.get('id')); } catch (e) {}
      if (!t) {
        // 风控/接口失败时用客户端传来的标题兜底
        const ttl = u.searchParams.get('title') || '';
        if (!ttl) return ok(res, { lines: [], sourceLabel: '' });
        t = { nid: u.searchParams.get('id'), name: ttl, durationMs: (parseFloat(u.searchParams.get('dur')) || 0) * 1000 };
      }
      const durSec = t.durationMs / 1000;
      let ne2 = await bili.neteaseLyrics(t.name, durSec).catch(() => null);
      let label = ne2 ? '网易云歌词' : '';
      if (!ne2 || !(ne2.lines || []).length) {
        const lc = await bili.lrclibLyrics(t.name, durSec).catch(() => null);
        if (lc && (lc.lines || []).length) { ne2 = lc; label = '歌词来自 LRCLIB 开放歌词库'; }
      }
      const data = { lines: (ne2 && ne2.lines) || [], sourceLabel: label, song: t };
      if (lid && (data.lines || []).length) {
        global._nlyricCache.set(lid, { data, at: Date.now() });
        if (global._nlyricCache.size > 60) {
          let oK = null, oAt = Infinity;
          for (const [k, v] of global._nlyricCache) if (v.at < oAt) { oAt = v.at; oK = k; }
          if (oK) global._nlyricCache.delete(oK);
        }
      }
      return ok(res, data);
    }

    if (pathname === '/api/nreco') {
      return ok(res, await ne.recommendSongs());
    }

    /* ---------- QQ音乐 ---------- */
    if (pathname === '/api/qquser') return ok(res, { user: await qq.profile().catch(() => null), loggedIn: qq.loggedIn });
    if (pathname === '/api/qqlogout') { qq.logout(); return ok(res, { ok: true }); }
    if (pathname === '/api/qqcookie/merge') {
      const okM = qq.mergeCookieRaw(u.searchParams.get('value') || '');
      /* 必须带回user：登录窗口靠它判定登录完成。
         旧版merge不返回user → 登录明明成功UI却永远弹「登录未完成」，
         用户以为刚登录就掉线了。 */
      let mUser = null;
      if (okM) { try { mUser = await qq.profile(); } catch (e) { mUser = null; } }
      return ok(res, { merged: okM, user: mUser });
    }
    if (pathname === '/api/qqcookie/set') {
      const v = u.searchParams.get('value') || '';
      const user = await qq.setCookieRaw(v);
      return ok(res, { user });
    }
    if (pathname === '/api/qqsearch') {
      return ok(res, { items: await qq.search(u.searchParams.get('keyword') || '', parseInt(u.searchParams.get('pn')) || 1, 20) });
    }
    if (pathname === '/api/qqdaily') {
      if (!qq.loggedIn) return sendJson(res, 200, { ok: false, message: 'QQ音乐未登录' });
      return ok(res, await qq.dailyRecommend());
    }
    if (pathname === '/api/qqreport') {
      if (!qq.loggedIn) return sendJson(res, 200, { ok: false, message: 'QQ音乐未登录' });
      return ok(res, await qq.reportPlay(u.searchParams.get('mid') || '', parseInt(u.searchParams.get('sec')) || 0));
    }
    if (pathname === '/api/qqplaylists') {
      if (!qq.loggedIn) return sendJson(res, 200, { ok: false, message: 'QQ音乐未登录' });
      return ok(res, { playlists: await qq.userPlaylists() });
    }
    if (pathname === '/api/qqplaylist') {
      if (u.searchParams.get('first') === '1') return ok(res, await qq.playlistDetailFirst(u.searchParams.get('id')));
      return ok(res, await qq.playlistDetail(u.searchParams.get('id')));
    }
    if (pathname === '/api/qqprobe') {
      return ok(res, await qq.probeQualities(u.searchParams.get('id'), u.searchParams.get('mm') || ''));
    }
    if (pathname === '/api/qqmedia') {
      const d = await qq.songUrl(u.searchParams.get('id'), u.searchParams.get('mm'), u.searchParams.get('pref'));
      return ok(res, d); // songUrl 内部已含音质偏好/网页端兜底/paidSong 分类
    }
    if (pathname === '/api/qlyric') {
      const mid = u.searchParams.get('id') || '';
      let lines = [], label = '';
      if (mid) {
        const ql = await qq.lyric(mid).catch(() => null);
        if (ql && (ql.lines || []).length) { lines = ql.lines; label = ql.sourceLabel; }
      }
      if (!lines.length) {
        // QQ歌词拿不到时走B站AI字幕/网易云/LRCLIB同款兜底链
        const ttl = u.searchParams.get('title') || '';
        const durSec = parseFloat(u.searchParams.get('dur')) || 0;
        const bvid = u.searchParams.get('bvid') || '';
        if (bvid) {
          // B站歌曲：优先本视频的AI字幕（与播放内容最贴合），内部还带同名片借字幕兜底
          try {
            const vd = await bili.videoDetail(bvid);
            if (vd && vd.cid) {
              const sub = await bili.subtitles(bvid, vd.cid).catch(() => null);
              if (sub && (sub.lines || []).length) { lines = sub.lines; label = sub.sourceLabel || 'B站AI字幕'; }
            }
          } catch (e) { }
        }
        if (!lines.length && ttl) {
          let ne2 = await bili.neteaseLyrics(ttl, durSec).catch(() => null);
          if (ne2 && (ne2.lines || []).length) { lines = ne2.lines; label = '网易云歌词'; }
          if (!lines.length) {
            const lc = await bili.lrclibLyrics(ttl, durSec).catch(() => null);
            if (lc && (lc.lines || []).length) { lines = lc.lines; label = '歌词来自 LRCLIB 开放歌词库'; }
          }
        }
      }
      return ok(res, { lines, sourceLabel: label });
    }
    if (pathname === '/api/related') {
      return ok(res, { items: await bili.relatedVideos(u.searchParams.get('aid')) });
    }
    if (pathname === '/api/danmaku') {
      return ok(res, { list: await bili.danmaku(u.searchParams.get('cid')) });
    }

    if (pathname === '/api/up/videos') {
      const mid = (u.searchParams.get('mid') || '').trim();
      if (!/^\d+$/.test(mid)) return sendJson(res, 200, { ok: false, message: 'mid 无效' });
      return ok(res, await bili.upVideos(mid, parseInt(u.searchParams.get('pn') || '1', 10)));
    }
    if (pathname === '/api/up/info') {
      const mid = (u.searchParams.get('mid') || '').trim();
      if (!/^\d+$/.test(mid)) return sendJson(res, 200, { ok: false, message: 'mid 无效' });
      return ok(res, await bili.upInfo(mid));
    }
    if (pathname === '/api/reply') {
      try {
        return ok(res, await bili.replies(parseInt(u.searchParams.get('aid'), 10), parseInt(u.searchParams.get('pn') || '1', 10)));
      } catch (e) {
        if (e.code === -404 || e.code === 12061) return ok(res, { total: 0, items: [] }); // 评论区关闭/无评论
        throw e;
      }
    }

    if (pathname === '/api/media') {
      const bvid = u.searchParams.get('bvid');
      const cid = u.searchParams.get('cid');
      const kind = u.searchParams.get('kind') === 'video' ? 'video' : 'audio';
      const dash = u.searchParams.get('dash') === '1';
      const d = kind === 'video' ? (dash ? await bili.playVideoDash(bvid, cid) : await bili.playVideo(bvid, cid)) : await bili.playAudio(bvid, cid);
      return ok(res, d);
    }

    if (pathname === '/api/playlists') {
      if (req.method === 'GET') return ok(res, { playlists: loadPls() });
      if (req.method === 'POST') {
        const body = await readBody(req);
        const list = loadPls();
        const pl = { id: 'pl_' + Date.now().toString(36), name: (body.name || '').trim() || '新建歌单', items: [], createdAt: Date.now() };
        if (body.nePid) pl.nePid = String(body.nePid); // 网易云来源歌单 id（心动模式用）
        list.unshift(pl);
        savePls(list);
        return ok(res, { playlist: pl });
      }
    }
    let m = pathname.match(/^\/api\/playlists\/([^/]+)$/);
    if (m) {
      const list = loadPls();
      const idx = list.findIndex(p => p.id === m[1]);
      if (idx < 0) return sendJson(res, 200, { ok: false, message: '歌单不存在' });
      if (req.method === 'PUT') {
        const body = await readBody(req);
        if (body.name !== undefined) list[idx].name = String(body.name).trim() || list[idx].name;
        if (body.items !== undefined && Array.isArray(body.items)) list[idx].items = body.items;
        if (body.nePid !== undefined) {
          if (body.nePid) list[idx].nePid = String(body.nePid);
          else delete list[idx].nePid;
        }
        list[idx].updatedAt = Date.now();
        savePls(list);
        return ok(res, { playlist: list[idx] });
      }
      if (req.method === 'DELETE') {
        const removed = list.splice(idx, 1)[0];
        savePls(list);
        return ok(res, { removed: removed.id });
      }
    }

    if (pathname === '/api/room/start') {
      try {
        const info = await roomServer.start();
        let tunnel = cloudflared.status();
        if (!tunnel.active) {
          try { tunnel = await cloudflared.start(info.port); }
          catch (e) { tunnel = { active: false, url: '', port: info.port, error: (e && e.message) || String(e) }; }
        }
        return ok(res, Object.assign(info, { tunnel }));
      } catch (e) {
        return sendJson(res, 200, { ok: false, message: '房间服务启动失败：' + ((e && e.message) || e) });
      }
    }
    if (pathname === '/api/room/stop') { cloudflared.stop(); roomServer.stop(); return ok(res, { active: false }); }
    if (pathname === '/api/room/status') return ok(res, Object.assign(roomServer.status(), { tunnel: cloudflared.status() }));
    if (pathname === '/api/tunnel/start') {
      if (!roomServer.status().active) return sendJson(res, 200, { ok: false, message: '房间未启动' });
      try { return ok(res, await cloudflared.start(roomServer.status().port)); }
      catch (e) { return sendJson(res, 200, { ok: false, message: '隧道启动失败：' + ((e && e.message) || e) }); }
    }
    if (pathname === '/api/tunnel/stop') { cloudflared.stop(); return ok(res, { active: false }); }
    if (pathname === '/api/tunnel/status') return ok(res, cloudflared.status());
    if (pathname === '/api/img') return serveImage(req, res, u);
    if (pathname === '/api/stream') return streamProxy(req, res, u);

    return sendJson(res, 404, { ok: false, message: 'not found: ' + pathname });
  } catch (e) {
    const body = { ok: false, code: e.code || 0, message: e.message || String(e) };
    if (e.risk) { body.risk = true; body.retryAt = e.retryAt || 0; }
    return sendJson(res, 200, body);
  }
}

/* ---------- 静态资源（实现见上方 serveStatic：内存缓存+gzip+ETag） ---------- */

/* ---------- API 限流（LAN 滥用保护）：每IP滑动窗口，超50次/10秒返回429 ---------- */
const apiHits = new Map();
function apiRateOk(req) {
  if (isLocal(req)) return true; // 本机不限
  const ip = (req.socket && req.socket.remoteAddress) || '?';
  const now = Date.now();
  const arr = (apiHits.get(ip) || []).filter(t => now - t < 10000);
  if (arr.length >= 50) { apiHits.set(ip, arr); return false; }
  arr.push(now);
  apiHits.set(ip, arr);
  if (apiHits.size > 500) apiHits.clear();
  return true;
}

function handler(req, res) {
  res._req = req; // 供 sendJson 读取请求头（gzip协商）
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname.startsWith('/api/')) {
    if (!apiRateOk(req)) return sendJson(res, 429, { ok: false, message: '请求过于频繁，稍后再试' });
    return handleApi(req, res, u.pathname, u);
  }
  serveStatic(res, u.pathname, req);
}

function startServer(onReady) {
  let port = PORT_FROM;
  const server = http.createServer(handler);
  serverRef = server;
  server.requestTimeout = 60000;   // 慢请求兜底（防慢连接占满）
  server.headersTimeout = 45000;
  server.keepAliveTimeout = 15000; // 与手机端轮询节奏匹配
  server.on('error', e => {
    if (e.code === 'EADDRINUSE' && port < PORT_FROM + 20) {
      port++;
      curPort = port;
      server.listen(port, curHost);
    } else {
      console.error('[server error]', e.message);
      process.exit(1);
    }
  });
  server.listen(port, curHost, () => {
    curPort = port;
    if (!process.versions.electron) {
      console.log('========================================');
      console.log('  哔哩播放器 BiliPlayer 已启动');
      console.log('  请用浏览器打开: http://' + curHost + ':' + curPort);
      console.log('  关闭本窗口即退出播放器');
      console.log('========================================');
      if (process.platform === 'win32' && !process.env.BP_NO_OPEN) {
        try { exec('start "" "http://' + curHost + ':' + curPort + '"'); } catch {}
      }
    }
    bili.warmup();
    if (onReady) onReady(port);
  });
  return server;
}

if (require.main === module) {
  startServer();
  /* 独立运行时优雅退出：关闭服务器与出站连接（房间服务和隧道随 server 的 close 事件一起停） */
  process.on('SIGINT', () => {
    try { if (serverRef) serverRef.close(() => process.exit(0)); } catch (e) { }
    setTimeout(() => process.exit(0), 1500);
  });
}
module.exports = { startServer, roomServer, cloudflared };

process.on('uncaughtException', e => console.error('[uncaught]', e.message));
process.on('unhandledRejection', e => console.error('[unhandled]', (e && e.message) || e));
