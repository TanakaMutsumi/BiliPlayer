'use strict';
/* BiliPlayer 本地服务：静态页面 + B站接口代理 + 媒体流代理（仅监听本机）
   可独立运行（node server.js），也可被 Electron 主进程内嵌调用（startServer） */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const Bilibili = require('./src/bilibili');
const NetEase = require('./src/netease');
const AiTheme = require('./src/aitheme');
const Lyrics = require('./src/lyrics');
const { RoomServer } = require('./src/room-server');
const { CloudflaredTunnel } = require('./src/tunnel');

const HOST = '127.0.0.1';
const PORT_FROM = parseInt(process.env.BP_PORT_FROM, 10) || 8899;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.BP_DATA_DIR || path.join(__dirname, 'data');

const bili = new Bilibili(DATA_DIR);
const ne = new NetEase(DATA_DIR);
const ai = new AiTheme(DATA_DIR);
const lyricSvc = new Lyrics(DATA_DIR, bili, ne);
const roomServer = new RoomServer();
const cloudflared = new CloudflaredTunnel();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
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

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
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

/* ---------- 本地歌单存储 ---------- */
const plFile = path.join(DATA_DIR, 'playlists.json');
function loadPls() {
  try { const a = JSON.parse(fs.readFileSync(plFile, 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; }
}
function savePls(a) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(plFile, JSON.stringify(a, null, 2), 'utf8');
}

/* ---------- 媒体流代理（带 Range，支持拖动进度） ---------- */
function streamProxy(req, res, u) {
  const target = u.searchParams.get('u') || '';
  let tu;
  try { tu = new URL(target); } catch { return sendJson(res, 400, { ok: false, message: 'bad url' }); }
  const host = tu.hostname;
  const isNe = host.endsWith('.music.126.net');
  const okHost = isNe || Bilibili.CDN_SUFFIXES.some(s => host.endsWith(s));
  const okPath = tu.pathname.includes('/upgcxcode/'); // B站第三方PCDN的特征路径
  if (!okHost && !okPath) {
    return sendJson(res, 403, { ok: false, message: 'host not allowed: ' + host });
  }
  const mod = tu.protocol === 'http:' ? http : https;
  const headers = {
    'Referer': isNe ? 'https://music.163.com/' : 'https://www.bilibili.com/',
    'User-Agent': isNe ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' : bili.ua,
    'Accept': '*/*'
  };
  if (req.headers.range) headers.Range = req.headers.range;
  const preq = mod.request(tu, { method: 'GET', headers }, pres => {
    const h = {};
    ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified'].forEach(k => {
      if (pres.headers[k]) h[k] = pres.headers[k];
    });
    res.writeHead(pres.statusCode || 502, h);
    pres.pipe(res);
    pres.on('error', () => res.destroy());
  });
  preq.on('error', () => {
    if (!res.headersSent) sendJson(res, 502, { ok: false, message: '媒体流请求失败' });
    else res.destroy();
  });
  req.on('close', () => preq.destroy());
  preq.end();
}

/* ---------- 封面图代理（MV 封面取色；只放行图片 CDN） ---------- */
const IMG_HOSTS = ['.hdslb.com', '.biliimg.com', '.music.126.net', '.126.net'];
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
    const preq = mod.get(tu, {
      headers: {
        'Referer': isNe ? 'https://music.163.com/' : 'https://www.bilibili.com/',
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
    if (pathname === '/api/ping') return ok(res, { name: 'BiliPlayer', version: '0.1.0' });
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

    if (pathname === '/api/search') {
      const order = u.searchParams.get('order') || '';
      const tids = u.searchParams.get('tids') || '';
      return ok(res, await bili.search(u.searchParams.get('keyword') || '', parseInt(u.searchParams.get('pn')) || 1,
        { order: ['totalrank', 'click', 'pubdate', 'dm', 'stow'].includes(order) ? order : '', tids: /^\d+$/.test(tids) ? tids : '' }));
    }
    if (pathname === '/api/suggest') {
      return ok(res, { terms: await bili.suggest(u.searchParams.get('term') || '') });
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

/* ---------- 静态资源 ---------- */
function serveStatic(res, pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { p = '/'; }
  if (p === '/') p = '/index.html';
  const fp = path.normalize(path.join(PUBLIC_DIR, p));
  if (!fp.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { ok: false, message: 'forbidden' });
  fs.readFile(fp, (e, buf) => {
    if (e) return sendJson(res, 404, { ok: false, message: 'not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(buf);
  });
}

function handler(req, res) {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname.startsWith('/api/')) return handleApi(req, res, u.pathname, u);
  serveStatic(res, u.pathname);
}

function startServer(onReady) {
  let port = PORT_FROM;
  const server = http.createServer(handler);
  server.on('error', e => {
    if (e.code === 'EADDRINUSE' && port < PORT_FROM + 20) {
      port++;
      server.listen(port, HOST);
    } else {
      console.error('[server error]', e.message);
      process.exit(1);
    }
  });
  server.on('close', () => { cloudflared.stop(); roomServer.stop(); });
  server.listen(port, HOST, () => {
    if (!process.versions.electron) {
      console.log('========================================');
      console.log('  哔哩播放器 BiliPlayer 已启动');
      console.log('  请用浏览器打开: http://' + HOST + ':' + port);
      console.log('  关闭本窗口即退出播放器');
      console.log('========================================');
      if (process.platform === 'win32' && !process.env.BP_NO_OPEN) {
        try { exec('start "" "http://' + HOST + ':' + port + '"'); } catch {}
      }
    }
    bili.warmup();
    if (onReady) onReady(port);
  });
  return server;
}

if (require.main === module) startServer();
module.exports = { startServer, roomServer, cloudflared };

process.on('uncaughtException', e => console.error('[uncaught]', e.message));
process.on('unhandledRejection', e => console.error('[unhandled]', (e && e.message) || e));
