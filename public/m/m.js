/* 哔哩播放器 · 手机遥控端逻辑：配对 → 轮询电脑播放状态 → 发指令切歌 */
'use strict';
const $ = id => document.getElementById(id);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pic = u => { if (!u) return ''; u = String(u); return u.startsWith('//') ? 'https:' + u : u.replace(/^http:\/\//, 'https://'); };
function fmt(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  /* 超过1小时显示 时:分:秒（合集类长视频不再出现 746:10 这种分钟数） */
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
}
let toastT = 0;
let lastToastMsg = '', lastToastAt = 0;
function toast(msg, type) {
  /* 相同消息 2.5 秒内去重（连续失败/轮询提示不再刷屏） */
  const now = Date.now();
  if (msg === lastToastMsg && now - lastToastAt < 2500) return;
  lastToastMsg = msg; lastToastAt = now;
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.add('hidden'), 2000);
}

/* ---------- 配对 ---------- */
let PIN = localStorage.getItem('bp.pin') || '';
// 扫码进入时 URL 带 pin
try {
  const q = new URLSearchParams(location.search).get('pin');
  if (q && /^\d{4}$/.test(q)) { PIN = q; localStorage.setItem('bp.pin', q); }
} catch (e) { }

function showScreen(main) {
  $('scr-pin').classList.toggle('hidden', main);
  $('scr-main').classList.toggle('hidden', !main);
}

/* ---------- 独立模式（APK 内置：QQ音乐全流程在手机上，不依赖电脑） ---------- */
const STANDALONE = location.protocol === 'file:' || new URLSearchParams(location.search).has('standalone') || localStorage.getItem('bp.standalone') === '1';
if (STANDALONE) localStorage.setItem('bp.localMode', '1');

/* ---------- 遥控指令 ---------- */
async function sendCmd(cmd, arg) {
  if (STANDALONE) { toast('独立模式下无电脑可遥控'); return false; }
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch('/api/rc/cmd?pin=' + encodeURIComponent(PIN), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd, arg }), signal: ctrl.signal
    });
    clearTimeout(tid);
    const j = await r.json();
    if (!j.ok) { toast(j.message || '指令失败'); return false; }
    return true;
  } catch (e) { toast('无法连接电脑播放器'); return false; }
}

/* ---------- 状态轮询 ---------- */
let lastState = null;
let lastQueueLen = -1;
let polling = false;
async function pollState() {
  if (STANDALONE) return;
  if (!PIN || polling) return;
  polling = true;
  let j = null;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch('/api/rc/state?pin=' + encodeURIComponent(PIN), { signal: ctrl.signal });
    clearTimeout(tid);
    j = await r.json();
  } catch (e) { j = { ok: false, message: 'offline' }; }
  polling = false;
  polling = false;
  if (!j || !j.ok) {
    $('m-dot').classList.remove('on');
    if (j && /PIN/.test(j.message || '')) {
      showScreen(false);
      $('pin-err').textContent = '配对码不正确或已重新开启,请重新输入';
      PIN = ''; localStorage.removeItem('bp.pin');
    }
    return;
  }
  const d = j.data || {};
  showScreen(true);
  const fresh = d.state && (Date.now() - (d.at || 0) < 8000);
  $('m-dot').classList.toggle('on', !!fresh);
  if (!d.state) { lastState = null; if (!localMode) renderPlayer(null); return; }
  lastState = d.state;
  if (!localMode) { updateLyric(); renderMini(); }
  // 本机模式：首次进来时接住电脑的队列与当前曲（不自动播放），避免显示"未在播放"
  if (localMode) {
    if (!localQueue.length && d.state.queue && d.state.queue.length) {
      localQueue = d.state.queue.slice();
      localBase = d.state.queueOffset || 0;
      localIdx = Math.max(0, Math.min(localQueue.length - 1, (d.state.index || 0) - localBase));
      renderLocalInfo(localQueue[localIdx], false);
    }
    if (curTab === 'queue') renderQueue(d.state);
    if (curTab === 'fx') renderFx();
    return;
  }
  renderPlayer(d.state);
  if (curTab === 'queue') renderQueue(d.state);
  if (curTab === 'fx') renderFx();
}

/* ---------- 封面主题色：大彩胶与背景氛围随歌曲变化 ---------- */
const _accentCache = new Map();
let _accentFor = '';
function setAccent(c) {
  document.documentElement.style.setProperty('--np-accent', c);
  try { if (typeof NViz !== 'undefined' && NViz.refreshAccent) NViz.refreshAccent(); } catch (e) { }
}
async function applyAccent(u) {
  const key = pic(u);
  if (!key) { setAccent('#fb7299'); return; }
  if (_accentCache.has(key)) { setAccent(_accentCache.get(key)); return; }
  try {
    const r = await fetch('/api/img?u=' + encodeURIComponent(key) + (PIN ? '&pin=' + encodeURIComponent(PIN) : ''));
    if (!r.ok) throw new Error('img');
    const blob = await r.blob();
    if (!window.createImageBitmap) throw new Error('no bitmap');
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data;
    let best = null, bestScore = -1, sr = 0, sg = 0, sb = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i], G = d[i + 1], B = d[i + 2];
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      const sat = mx === 0 ? 0 : (mx - mn) / mx, val = mx / 255;
      const score = sat * 0.72 + val * 0.28;
      if (score > bestScore && mx > 36 && mn < 246) { bestScore = score; best = [R, G, B]; }
      sr += R; sg += G; sb += B; n++;
    }
    let rgb = best || [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];
    const mx2 = Math.max(rgb[0], rgb[1], rgb[2]);
    if (mx2 > 0 && mx2 < 70) { const k = 70 / mx2; rgb = rgb.map(v => Math.round(v * k)); }
    const out = 'rgb(' + rgb.join(',') + ')';
    _accentCache.set(key, out);
    if (_accentFor === key) setAccent(out);
  } catch (e) { if (_accentFor === key) setAccent('#fb7299'); }
}

/* ---------- 渲染：播放页 ---------- */
/* 遥控模式歌词：通过PC的 /api/qlyric 获取（含QQ/B站字幕/网易云/LRCLIB兜底链） */
async function loadRemoteLyric(s) {
  const k = (s.qmid || "") + (s.bvid || "") + (s.title || "");
  if (lyricFor === k) return;
  lyricFor = k; lyricLines = null; lyricIdx = -1; remoteLyrLabel = '';
  renderLyrics();
  try {
    const params = new URLSearchParams();
    if (s.qmid) params.set("id", s.qmid);
    if (s.title) params.set("title", s.title);
    if (s.dur) params.set("dur", s.dur);
    if (s.bvid) params.set("bvid", s.bvid);
    params.set("pin", PIN || ""); // 非本机请求必须带配对码
    const r = await fetch("/api/qlyric?" + params.toString());
    const j = await r.json();
    if (j.ok && j.data && j.data.lines && j.data.lines.length) {
      if (lyricFor !== k) return;
      lyricLines = j.data.lines;
      if (j.data.sourceLabel) remoteLyrLabel = j.data.sourceLabel;
      renderLyrics();
    }
  } catch (e) { }
}

function renderPlayer(s) {
  if (localMode || STANDALONE) return; // 本机/独立模式由本机引擎驱动
  const playing = !!(s && s.playing);
  document.body.classList.toggle('paused', !playing);
  $('ic-play').classList.toggle('hidden', playing);
  $('ic-pause').classList.toggle('hidden', !playing);
  if (!s || !s.title) {
    $('np-cover').removeAttribute('src');
    document.querySelector('.vinyl-cover').classList.add('noimg');
    $('np-bg-blur').style.backgroundImage = '';
    _accentFor = '';
    setAccent('#fb7299');
    $('np-title').textContent = '未在播放';
    $('np-up').textContent = '在电脑上放一首歌吧';
    $('np-quality').innerHTML = '';
    $('t-cur').textContent = '0:00'; $('t-dur').textContent = '0:00';
    setSeekFill(0);
    return;
  }
  const coverUrl = pic(s.pic);
  const img = $('np-cover');
  const vcover = document.querySelector('.vinyl-cover');
  if (img.getAttribute('src') !== coverUrl) {
    if (coverUrl) {
      vcover.classList.remove('noimg');
      img.src = coverUrl;
      // 大彩胶染色 + 背景氛围随封面变化
      _accentFor = coverUrl;
      applyAccent(coverUrl);
      $('np-bg-blur').style.backgroundImage = 'url("' + coverUrl + '")';
    } else {
      vcover.classList.add('noimg');
      img.removeAttribute('src');
      $('np-bg-blur').style.backgroundImage = '';
      _accentFor = '';
      setAccent('#fb7299');
    }
  }
  $('np-title').textContent = s.title;
  $('np-up').textContent = s.up || '';
  $('np-quality').innerHTML = s.quality ? '<span>' + esc(s.quality) + '</span>' : '';
  const dur = s.dur || 0, t = Math.min(s.time || 0, dur);
  $('t-cur').textContent = fmt(t);
  $('t-dur').textContent = fmt(dur);
  if (!$seekDragging) {
    $('seek').value = dur ? Math.round(t / dur * 1000) : 0;
    setSeekFill(dur ? t / dur : 0);
  }
  $('vol').value = s.vol !== undefined ? s.vol : 80;
  /* 遥控模式：PC换歌时自动拉取歌词（内部有 lyricFor 去重，同曲不会重复请求） */
  loadRemoteLyric(s);
}
function setSeekFill(ratio) {
  $('seek').style.setProperty('--fill', (Math.max(0, Math.min(1, ratio)) * 100) + '%');
}

/* ---------- 渲染：队列页 ---------- */
function renderQueue(s) {
  const list = $('queue-list');
  const q = s.queue || [];
  const off = s.queueOffset || 0;
  const total = s.queueLen || q.length;
  $('queue-count').textContent = total ? (total + ' 首' + (localMode ? ' · 本机播放' : '') + (total > q.length ? '（显示当前附近 ' + q.length + ' 首）' : '')) : '';
  $('queue-clear').classList.toggle('hidden', !(localMode && localQueue.length));
  if (!q.length) { list.innerHTML = '<div class="empty-tip">电脑上还没有播放队列<br>去电脑上选歌，或到「歌单」页点一首</div>'; return; }
  const hi = localMode && localQueue.length ? (localBase + localIdx) : s.index;
  list.innerHTML = q.map((t, i) => {
    const abs = off + i;
    return `
    <div class="row ${abs === hi ? 'playing' : ''}" data-idx="${abs}">
      ${t.pic ? `<img src="${esc(pic(t.pic))}" loading="lazy" onerror="this.outerHTML='<div class=\\'r-ico\\'>♪</div>'">` : '<div class="r-ico">♪</div>'}
      <div class="r-main"><div class="r-title">${esc(t.title)}</div><div class="r-sub">${esc(t.up || '')}</div></div>
      <span class="r-dur">${fmt(t.duration)}</span>
    </div>`;
  }).join('');
  /* 打开队列页自动滚到当前曲（长队列不用手动翻找） */
  const cur = list.querySelector('.row.playing');
  if (cur && curTab === 'queue') setTimeout(() => cur.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
}

/* ---------- 渲染：歌单页 ---------- */
let plsCache = null;
async function renderPls() {
  const list = $('pls-list');
  if (STANDALONE) { plsCache = QQSA.localPls(); }
  else if (!plsCache) {
    list.innerHTML = '<div class="empty-tip">加载中…</div>';
    try { plsCache = (await jget('/api/playlists')).playlists || []; }
    catch (e) { plsCache = []; }
  }
  const pls = plsCache;
  if (!pls.length) { list.innerHTML = STANDALONE ? '<div class="empty-tip">本机还没有歌单<br>点右上「＋ 新建」创建</div>' : '<div class="empty-tip">电脑上还没有歌单<br>点右上「＋ 新建」创建一个</div>'; return; }
  list.innerHTML = pls.map(p => `
    <div class="row" data-id="${esc(p.id)}" data-name="${esc(p.name)}">
      ${p.items && p.items[0] && p.items[0].pic ? `<img src="${esc(pic(p.items[0].pic))}" loading="lazy" onerror="this.outerHTML='<div class=\\'r-ico\\'>♫</div>'">` : '<div class="r-ico">♫</div>'}
      <div class="r-main"><div class="r-title">${esc(p.name)}</div><div class="r-sub">${(p.items || []).length} 首 · ${STANDALONE ? '点开即可在本机播放' : '点击选歌在电脑播放'}</div></div>
      <button class="r-more" data-more="${esc(p.id)}">⋯</button>
      <span class="r-badge">播放</span>
    </div>`).join('');
}
let curPl = null;
function renderTracks(pl) {
  curPl = pl;
  $('tracks-name').textContent = pl.name;
  $('tracks-count').textContent = (pl.items || []).length + ' 首';
  const list = $('tracks-list');
  const items = pl.items || [];
  if (items.length) {
    chunkedRender(list, items, (it, i) => `
    <div class="row" data-idx="${i}">
      ${it.pic ? `<img src="${esc(pic(it.pic))}" loading="lazy" onerror="this.outerHTML='<div class=\\'r-ico\\'>♪</div>'">` : '<div class="r-ico">♪</div>'}
      <div class="r-main"><div class="r-title">${esc(it.title)}</div><div class="r-sub">${esc(it.up || '')}</div></div>
      <button class="r-x" data-x="${i}" title="从歌单移除">✕</button>
      <span class="r-dur">${fmt(it.duration)}</span>
    <span class="q-arrows" data-qi="${start + i}">
      <span class="q-up" data-dir="-1" title="上移">▲</span>
      <span class="q-down" data-dir="1" title="下移">▼</span>
    </span>
    </div>`);
  } else list.innerHTML = '<div class="empty-tip">歌单是空的</div>';
}

/* ---------- 每日推荐 ---------- */
let recoCache = null;
let recoLoading = false;
async function loadReco(force) {
  const sec = $('reco-sec');
  if (!sec || recoLoading) return;
  const today = new Date().toISOString().slice(0, 10);
  if (recoCache && recoCache.day === today && !force) { renderReco(); return; }
  recoLoading = true;
  try { $('reco-tip').textContent = '加载中…'; } catch (e) { }
  try {
    let d = null;
    if (STANDALONE) {
      /* 已登录QQ音乐优先「QQ音乐每日30首」，失败/未登录回退网易云每日/推荐新歌 */
      try {
        const okQ = await QQSA.init();
        if (okQ) d = await QQSA.daily();
      } catch (eQ) { d = null; }
      if (!d || !(d.items || []).length) d = await NESA.reco();
    } else {
      try { d = await jget('/api/qqdaily'); } catch (eQ) { d = null; }
      if (!d || !(d.items || []).length) d = await jget('/api/nreco');
    }
    recoCache = {
      day: today, label: (d && d.label) || '每日推荐',
      items: ((d && d.items) || []).map(t => ({ nid: t.nid, qmid: t.qmid, qmMediaMid: t.qmMediaMid || t.mediaMid || '', title: t.title || t.name || '', up: t.up || t.artist || '', pic: t.pic || '', duration: t.duration || Math.round((t.durationMs || 0) / 1000), fee: t.fee || 0 }))
    };
    try { $('reco-tip').textContent = recoCache.items.length ? (recoCache.label + ' · ' + recoCache.items.length + '首') : '暂无推荐'; } catch (e) { }
  } catch (e) {
    recoCache = null;
    try { $('reco-tip').textContent = /登录/.test(e.message || '') ? '网易云未登录' : ('加载失败: ' + String(e.message || '').slice(0, 30)); } catch (e2) { }
  }
  recoLoading = false;
  renderReco();
}
function renderReco() {
  const sec = $('reco-sec'), row = $('reco-row');
  if (!sec || !row) return;
  const items = (recoCache && recoCache.items) || [];
  sec.classList.toggle('hidden', !items.length);
  if (!items.length) { row.innerHTML = ''; return; }
  row.innerHTML = items.slice(0, 30).map((it, i) => `
    <div class="reco-card" data-i="${i}">
      ${it.pic ? `<img src="${esc(pic(it.pic))}" loading="lazy" onerror="this.outerHTML='<div class=\\'reco-ph\\'>♪</div>'">` : '<div class="reco-ph">♪</div>'}
      <div class="reco-t">${esc(it.title)}</div>
      <div class="reco-a">${esc(it.up || '')}</div>
    </div>`).join('');
}
function recoPlay(idx) {
  if (!recoCache || !recoCache.items.length) return;
  localPlay(recoCache.items.map(x => (x.nid
    ? { nid: x.nid, title: x.title, up: x.up, pic: x.pic, duration: x.duration }
    : { qmid: x.qmid, qmMediaMid: x.qmMediaMid, title: x.title, up: x.up, pic: x.pic, duration: x.duration })), idx);
  try { toast('♪ ' + recoCache.items[idx].title); } catch (e) { }
  switchTab('player');
}

/* ---------- QQ音乐听歌时长上报（本机播放QQ歌时累计，换歌/播完结算） ---------- */
let _qScrob = { mid: '', sec: 0, lastT: 0 };
function qqScrobTickM() {
  if (!localMode) return;
  const it = localQueue[localIdx];
  if (!it || !it.qmid) { _qScrob.mid = ''; return; }
  if (_qScrob.mid !== it.qmid) _qScrob = { mid: it.qmid, sec: 0, lastT: LA.currentTime || 0 };
  if (LA.paused || !LA.src) { _qScrob.lastT = LA.currentTime || 0; return; }
  const cur = LA.currentTime || 0;
  let d = cur - _qScrob.lastT;
  if (d < 0 || d > 3) d = 0; // seek跳变不计入
  _qScrob.sec += d;
  _qScrob.lastT = cur;
}
function qqScrobFlushM() {
  if (!_qScrob.mid || _qScrob.sec < 10) { _qScrob = { mid: '', sec: 0, lastT: 0 }; return; }
  const mid = _qScrob.mid, sec = Math.round(Math.min(_qScrob.sec, 1800));
  _qScrob = { mid: '', sec: 0, lastT: 0 };
  if (STANDALONE && QQSA.ready) QQSA.reportPlay(mid, sec).catch(() => { });
  else if (!STANDALONE) jget('/api/qqreport?mid=' + encodeURIComponent(mid) + '&sec=' + sec).catch(() => { });
}

/* ---------- 页签 ---------- */
let curTab = 'player';
let curTabPrev = '';
const PAGES = ['player', 'queue', 'pls', 'tracks', 'fx', 'lib', 'src'];
function switchTab(tab) {
  curTab = tab;
  PAGES.forEach(t => $('pg-' + t).classList.toggle('hidden', t !== tab));
  $$('#m-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  try { if (tab !== curTabPrev && navigator.vibrate) navigator.vibrate(8); } catch (e) { } // 轻触感反馈
  curTabPrev = tab;
  if (tab === 'queue') {
    if (STANDALONE && localQueue.length) renderQueue({ queue: localQueue, index: localBase + localIdx, queueOffset: localBase, queueLen: localQueue.length });
    else if (lastState) renderQueue(lastState);
  }
  if (tab === 'pls') { plsCache = null; renderPls(); }
  if (tab === 'lib') { renderLib(); loadReco(); }
  if (tab === 'fx') renderFx();
  /* 回到曲库时保持滚动位置，其他页回顶 */
  if (tab === 'lib') setTimeout(() => { $('m-body').scrollTop = libScrollKeep || 0; }, 0);
  else { libScrollKeep = $('m-body').scrollTop; $('m-body').scrollTop = 0; }
  renderMini();
}

/* ---------- 底部操作面板 ---------- */
function showSheet(title, items) {
  const sh = $('sheet');
  sh.innerHTML = `<div class="sh-title">${esc(title)}</div>` +
    items.map((it, i) => it.input
      /* 输入项必须配一个可点的确定按钮：手机上软键盘回车往往是"换行"，只靠回车提交不了 */
      ? `<input class="sh-input" id="sh-input" placeholder="${esc(it.placeholder || '')}" value="${esc(it.value || '')}">`
        + `<button class="sh-item ${it.danger ? 'danger' : ''}" data-i="${i}">${esc(it.label || '确定')}</button>`
      : `<button class="sh-item ${it.danger ? 'danger' : ''}" data-i="${i}">${esc(it.label)}</button>`).join('') +
    `<button class="sh-cancel" id="sh-cancel">取消</button>`;
  sh.classList.remove('hidden');
  $('sheet-mask').classList.remove('hidden');
  sh.querySelectorAll('.sh-item').forEach(b => b.addEventListener('click', () => {
    const it = items[+b.dataset.i];
    const inp = $('sh-input');
    const val = inp ? inp.value.trim() : undefined;
    hideSheet();
    if (it && it.fn) it.fn(it.useInput ? val : undefined);
  }));
  $('sh-cancel').addEventListener('click', hideSheet);
  const inp = $('sh-input');
  if (inp) {
    inp.focus();
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const ok = items.find(x => x.useInput);
        const v = inp.value.trim();
        hideSheet();
        if (ok && ok.fn) ok.fn(v);
      }
    });
  }
}
function hideSheet() {
  $('sheet').classList.add('hidden');
  $('sheet-mask').classList.add('hidden');
}

/* ---------- 本机播放引擎：手机自己出声（流走电脑代理） ---------- */
let localMode = localStorage.getItem('bp.localMode') === '1' || STANDALONE;
/* 音频元素可整体替换：一旦WebAudio建图后输出静音（跨域音源），必须换新元素才能恢复声音 */
let LA = new Audio();
LA.preload = 'auto';
let localQueue = [], localIdx = 0, localResolving = false;
let audioTag = ''; // 当前实际使用的音轨标识（显示在播放页，便于确认音质）
/* 播放模式：order=列表循环  shuffle=随机  single=单曲循环（QQ音乐同款三态） */
let playMode = (function () { try { return localStorage.getItem('bp.playMode') || 'order'; } catch (e) { return 'order'; } })();
let lastLoadAt = 0;   // 最近一次加载时间：用于屏蔽切换瞬间的误报错误（防莫名切歌）
let userPaused = false; // 是否用户主动暂停（后台自动续播不能覆盖用户暂停）
let localBase = 0; // 本地队列对应电脑总队列的起始绝对下标（窗口模式非0）

function setModeBtn() {
  $('p-mode').textContent = localMode ? '🎧 播放到：手机本机' : '📱 播放到：电脑';
  $('p-mode').classList.toggle('on', localMode);
}
async function resolveSrc(it) {
  // 返回 {u, direct}：direct=true 表示手机直连CDN（不经电脑）；B站CDN强制校验Referer，浏览器无法伪造，只能经电脑转发
  if (it.nid) {
    if (STANDALONE) {
      const v = await NESA.songUrl(it.nid);
      if (!v || !v.url) {
        if (v && (v.fee === 1 || v.fee === 4)) throw new Error('这首歌需要网易云音乐VIP/黑胶VIP');
        throw new Error('网易云直链获取失败（可能已下架或无版权）');
      }
      audioTag = v.type || 'mp3';
      return { u: v.url, direct: true, tag: v.type || 'mp3' };
    }
    const d = await jget('/api/nmedia?id=' + encodeURIComponent(it.nid));
    if (!d.url) throw new Error('该歌曲需要网易云VIP或已下架');
    return { u: d.url, direct: true };
  }
  if (it.qmid) {
    if (STANDALONE) {
      let v = null;
      /* 音质偏好（bp.qqQual：auto/high/save）优先；auto 时先试无损（AI00/F000），
         3.5秒起不来自动回退MP3；回退结果记住，之后直接走MP3 */
      const qqPref = localStorage.getItem('bp.qqQual') || 'auto';
      if (qqPref === 'save') {
        v = await QQSA.songUrl(it.qmid, it.qmMediaMid || it.mediaMid || '', false, 'save');
      } else if (qqPref === 'high' || localStorage.getItem('bp.qqFlacBad')) {
        v = await QQSA.songUrl(it.qmid, it.qmMediaMid || it.mediaMid || '', true, qqPref);
      } else {
        v = await QQSA.songUrl(it.qmid, it.qmMediaMid || it.mediaMid || '', false, 'auto');
        if (v && v.flac && v.url) {
          const ok = await probeAudio(v.url, 3500);
          if (!ok) {
            localStorage.setItem('bp.qqFlacBad', '1');
            v = await QQSA.songUrl(it.qmid, it.qmMediaMid || it.mediaMid || '', true, 'high');
          }
        }
      }
      if (!v || !v.url) {
        if (v && v.needLogin) throw new Error('QQ音乐登录已过期，请重新登录QQ音乐（不是会员问题）');
        if (v && v.noLicense) throw new Error('这首歌在QQ音乐没有可用音源（可能已下架或无版权）');
        if (v && v.paidSong) throw new Error('这是付费歌曲（数字专辑），本账号暂无播放权限');
        if (v && v.needbuy) throw new Error('这首歌需要QQ音乐豪华VIP（普通绿钻不含此音质）');
        throw new Error('直链获取失败，请稍后重试或点「🔍播放诊断」');
      }
      audioTag = v.type;
      return { u: v.url, direct: true, tag: v.type };
    }
    const d = await jget('/api/qqmedia?id=' + encodeURIComponent(it.qmid) + '&mm=' + encodeURIComponent(it.qmMediaMid || it.mediaMid || ''));
    if (!d.url) throw new Error('该歌曲需要QQ音乐登录/VIP');
    audioTag = d.type || "";
    return { u: d.url, direct: true, tag: d.type };
  }
  if (it.bvid) {
    if (STANDALONE) {
      const r = await BLSA.resolve(it.bvid, it.pid ? it.cid : undefined);
      /* 多P合集：列表时长是全部分P总长，单P实际几分钟 → 首次解析展开成分P插队
         （it.pid 已存在的展开项直接按cid解析，不会重复展开） */
      if (r.pages && !it.pid) {
        const i = localQueue.indexOf(it);
        if (i >= 0) {
          const p1 = r.pages[0];
          /* 最多展开50个分P：极端合集（几百P）防队列爆长 */
          const extra = r.pages.slice(1, 50).map(pg => Object.assign({}, it, {
            cid: pg.cid, pid: pg.pid,
            title: it.title + ' · P' + pg.pid + ' ' + pg.part,
            duration: pg.duration || 0
          }));
          it.cid = p1.cid; it.pid = p1.pid;
          it.title = it.title + ' · P1 ' + p1.part;
          it.duration = p1.duration || it.duration;
          if (extra.length) localQueue.splice(i + 1, 0, ...extra);
          if (curTab === 'queue') switchTab('queue'); // 队列页刷新显示分P
        }
      }
      /* 独立模式：直连B站CDN（原生拦截器代补Referer），绝不能走 /api/stream（那指向电脑） */
      return { u: r.u, direct: true, dashAudio: r.dashAudio };
    }
    const v = await jget('/api/video?bvid=' + encodeURIComponent(it.bvid));
    const d = await jget('/api/media?bvid=' + encodeURIComponent(it.bvid) + '&cid=' + v.cid + '&kind=audio');
    return { u: d.url, direct: false };
  }
  throw new Error('没有可播放的源');
}
function streamUrl(u) { return '/api/stream?u=' + encodeURIComponent(u) + (PIN ? '&pin=' + encodeURIComponent(PIN) : ''); }
async function localPlay(items, idx) {
  localQueue = (items || []).slice(0, 1000);
  localBase = 0;
  localIdx = Math.max(0, Math.min(localQueue.length - 1, idx || 0));
  localResolving = false; // 关键：重置。上次加载若被中断会卡在 true，导致之后点歌全部无效
  skipStreak = 0;
  loadLatest();
}
/* 并发加载守卫：加载期间的新请求记为pending，当前加载结束后补载最新目标（快速连点不丢任务，索引与声音永远一致） */
let _pendingLoad = false;
function loadLatest() {
  if (localResolving) { _pendingLoad = true; return; }
  localLoad();
}
async function localLoad() {
  try { await _localLoad(); } finally {
    localResolving = false;
    if (_pendingLoad) { _pendingLoad = false; setTimeout(() => { try { localLoad(); } catch (eL) { } }, 60); }
  }
}
async function _localLoad() {
  const it = localQueue[localIdx];
  if (!it || localResolving) return;
  /* 换歌先结算上一首的QQ听歌时长 */
  try { if (_qScrob.mid && (!it.qmid || it.qmid !== _qScrob.mid)) qqScrobFlushM(); } catch (e) { }
  localResolving = true;
  lastLoadAt = Date.now();
  stopMse(); // 切歌先停掉上一首的MSE下载
  const isPreBuf = nextPre.key === itemKey(it) && !!nextPre.src;
  renderLocalInfo(it, !isPreBuf); // 预缓冲命中=秒出声，不闪加载态
  try {
    /* 预加载命中：上一首播放期间已解析好下一首直链 → 切歌零等待 */
    const k = itemKey(it);
    let src, res = null;
    if (nextPre.key === k && nextPre.src) {
      src = nextPre.src;
      res = { dashAudio: nextPre.dashAudio };
      nextPre = { key: '', src: '' };
    } else {
      const r = await resolveSrc(it);
      res = r;
      if (r.tag) audioTag = r.tag; else if (!it.bvid) audioTag = '';
      /* 只有真开了音效、且AudioContext确认可运行，才建WebAudio图；
         否则音频元素直通扬声器（绝无静音风险） */
      if (localMode && PFX.needsFx() && await PFX.prepare()) PFX.ensure();
      if (!localMode) { localResolving = false; return; }
      src = r.direct ? r.u : streamUrl(r.u); // QQ/网易云直连CDN；仅B站走电脑转发
    }
    /* 优先走DASH纯音频（码率≈203kbps，是720p合成音轨的近2倍）；
       失败则自动回落到合成音轨mp4，绝不影响出声 */
    /* 记录可交给原生后台播放的直链（MSE用的blob地址原生播不了，所以统一用合成音轨URL） */
    curPlainUrl = /^https?:/i.test(src) ? src : '';
    /* 后台换歌：绝对不碰 <audio>（后台给元素设 src 会触发 error 事件→连环切歌→handoff 被重置），
       只把直链交给原生 MediaPlayer 后立即返回，实现后台连播 */
    if (bgHandoff && document.hidden && curPlainUrl) {
      if (bgStartNative(0)) {
        skipStreak = 0;
        try { renderLocalInfo(it, false); } catch (e) { }
        try { updateMediaSession(it); } catch (e) { }
        try { loadLyric(it); } catch (e) { }
        failStreakM = 0;
        localResolving = false;
        return;
      }
    }
    if (res && res.dashAudio && await tryDashAudio(it, res.dashAudio)) {
      renderLocalInfo(it, false);
      updateMediaSession(it);
      failStreakM = 0;
      localResolving = false;
      return;
    }
    /* B站CDN走原生拦截器（带ACAO头）：元素声明anonymous拿CORS干净数据，
       否则WebAudio建图后Chromium会把跨域音源直接静音 */
    if (it.bvid) audioTag = (localStorage.getItem('bp.audioSave') === '1' ? '省流量' : '720p音轨');
    /* 切歌淡入淡出：换源前把音量渐降到0，起播后渐升回用户音量（消咔哒声/爆音） */
    try { if (LA.src && !LA.paused) await elFade(0, 110); } catch (e) { }
    const prevVol = LA.volume;
    try {
      const h = new URL(src, location.href).host;
      LA.crossOrigin = /bilivideo\.com|bilivideo\.cn|akamaized\.net/.test(h) ? 'anonymous' : '';
    } catch (e) { LA.crossOrigin = ''; }
    /* 记录可交给原生后台播放的直链（MSE的blob地址原生用不了，所以用合成音轨URL） */
    curPlainUrl = /^https?:/i.test(src) ? src : '';
    LA.src = src;
    try { LA.currentTime = 0; } catch (e) { }
    /* 音效链路一旦建立(AudioContext)声音只走WebAudio图：必须在play前确保ctx是running，
       否则"进度在走但完全没声音"（ensure()的pause唤醒hack正是这个bug的来源，已删除） */
    await PFX.resume();
    userPaused = false;
    if (bgHandoff && document.hidden) {
      /* 后台换歌：直接续给原生，不指望网页里的媒体元素能出声 */
      bgStartNative();
    } else {
      LA.volume = 0;
      LA._fading = false;
      await LA.play().catch(() => { });
      elFade(prevVol || 1, 220);
    }
    renderLocalInfo(it, false);
    updateMediaSession(it);
    loadLyric(it);
    failStreakM = 0;
    skipStreak = 0;
  } catch (e) {
    try { if (window.androidApi && androidApi.bpLog) androidApi.bpLog('LL catch: ' + (e && e.message) + ' idx=' + localIdx); } catch (e2) { }
    toast(e.message || '本机播放失败');
    /* 自动跳过播不了的歌（VIP锁/无版权/下架）：最多连跳6首，防止整条队列卡死 */
    try {
      skipStreak++;
      if (skipStreak <= 6 && localQueue.length > 1) {
        localResolving = false;
        if (_pendingLoad) { _pendingLoad = false; setTimeout(() => { try { localLoad(); } catch (e4) { } }, 400); }
        else setTimeout(() => { try { localStep(1); } catch (e3) { } }, 400);
        return;
      }
      skipStreak = 0;
    } catch (e3) { }
  }
  localResolving = false;
}
function localStep(d) {
  if (!localQueue.length) return;
  /* 单曲循环：手动下一首也要能跳走，所以只有"自动到头"才重播当前 */
  if (playMode === 'shuffle' && localQueue.length > 1 && d > 0) {
    let n = localIdx;
    while (n === localIdx) n = Math.floor(Math.random() * localQueue.length);
    localIdx = n;
  } else {
    localIdx = (localIdx + d + localQueue.length) % localQueue.length;
  }
  loadLatest();
}
/* 自动播完：按播放模式决定下一首 */
function autoNext() {
  if (!localQueue.length) return;
  if (playMode === 'single') { localLoad(); return; }
  localStep(1);
}
function renderMode() {
  const ico = $('mode-ico');
  if (!ico) return;
  /* 用SVG而不是emoji：部分手机WebView没有彩色emoji字体，会显示成方块 */
  const svg = {
    order: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>',
    single: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M12 10v4"/><path d="M11 11h1"/></svg>'
  };
  ico.innerHTML = svg[playMode] || svg.order;
  const btn = $('c-mode');
  if (btn) btn.title = { order: '列表循环', shuffle: '随机播放', single: '单曲循环' }[playMode] || '';
}

/* ---------- DASH纯音频播放（MSE）：B站1080p以上的音轨只能从DASH拿 ----------
   分片m4s不能直接喂给<audio>，这里用MediaSource边下边灌，音质≈203kbps；
   任何一步失败都返回false，调用方回落到720p合成音轨（保证一定有声音） */
let mseState = null;
function stopMse() {
  if (!mseState) return;
  mseState.aborted = true;
  try { URL.revokeObjectURL(mseState.objURL); } catch (e) { }
  mseState = null;
}
async function tryDashAudio(it, dash) {
  if (!dash || !dash.url) return false;
  if (!window.MediaSource) return false;
  /* 门槛：只有DASH音轨明显高于720p合成音轨(约128k)时才值得走MSE。
     B站音轨分档 64/132/192/Dolby/Hi-Res，很多普通视频最高只有106k，此时合成音轨更好 */
  if ((dash.bandwidth || 0) < 150000) return false;
  /* 体积保护：长合集单个分P可能上百MB，超过40MB仍用720p合成音轨（更快出声音） */
  const estMB = ((dash.bandwidth || 200000) / 8) * (it.duration || 0) / 1048576;
  if (estMB > 40) return false;
  const MIME = 'audio/mp4; codecs="' + (dash.codecs || 'mp4a.40.2') + '"';
  if (!MediaSource.isTypeSupported(MIME)) return false;
  const ms = new MediaSource();
  const objURL = URL.createObjectURL(ms);
  const st = { objURL, ms, aborted: false };
  mseState = st;
  try {
    const el = LA;
    el.crossOrigin = 'anonymous';
    el.src = objURL;
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('MSE启动超时')), 8000);
      ms.addEventListener('sourceopen', () => { clearTimeout(t); res(); }, { once: true });
    });
    const sb = ms.addSourceBuffer(MIME);
    const waitEnd = () => new Promise(r => { sb.addEventListener('updateend', r, { once: true }); });
    const resp = await fetch(dash.url);
    if (!resp.ok || !resp.body) throw new Error('音频流HTTP' + resp.status);
    const reader = resp.body.getReader();
    let started = false;
    while (!st.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (sb.updating) await waitEnd();
      try { sb.appendBuffer(value); }
      catch (e) {
        if (e && e.name === 'QuotaExceededError') {
          try { sb.remove(0, Math.max(0, el.currentTime - 5)); await waitEnd(); sb.appendBuffer(value); }
          catch (e2) { break; }
        } else break;
      }
      await waitEnd();
      if (!started) {
        started = true;
        await PFX.resume();
        el.play().catch(() => { });
      }
    }
    if (!started) throw new Error('音频流为空');
    if (!st.aborted && ms.readyState === 'open') { try { ms.endOfStream(); } catch (e) { } }
    audioTag = 'DASH ' + Math.round((dash.bandwidth || 0) / 1000) + 'k';
    return true;
  } catch (e) {
    stopMse();
    return false;
  }
}
function renderLocalInfo(it, loading) {
  const coverUrl = pic(it.pic);
  const img = $('np-cover');
  if (img.getAttribute('src') !== coverUrl) img.setAttribute('src', coverUrl || '');
  $('np-title').textContent = it.title || '';
  $('np-up').textContent = it.up || '';
  const srcTag = it.bvid
    ? (STANDALONE ? '本机播放 · B站直连' : '本机播放 · B站经电脑转发') + (audioTag ? ' · ' + audioTag : '')
    : (audioTag ? '本机直连CDN · ' + audioTag : '本机直连CDN');
  $('np-quality').innerHTML = '<span>' + (loading ? '加载中…' : srcTag) + '</span>';
  renderLocalTimes();
  renderMini();
}
/* 迷你播放条：任意页签常驻（QQ音乐式），点一下回播放页 */

/* ---------- 播放页歌词（QQ音乐式：点唱片切换 封面↔歌词） ----------
   歌词源：QQ音乐 lrc（QQSA.lyric）/ B站 AI字幕（wbi/v2 → subtitle）
   没有歌词源时显示「暂无歌词」，不影响播放 */
let lyricLines = null;   // [{t, text}] | null=无
let lyricIdx = -1;
let lyricFor = '';
let lyricMode = false;
let remoteLyrLabel = ''; // 遥控模式歌词来源标签（QQ/B站AI字幕/网易云/LRCLIB）

/* 从杂乱的B站标题里提取歌名（B站标题常带【无损】《歌名》｜UP名等噪声） */
function lyricTitleKey(title) {
  const t = String(title || '');
  const m = t.match(/《([^》]{1,40})》/); // 《》里通常就是歌名
  if (m && m[1].trim()) return m[1].trim();
  return t.replace(/【[^】]*】/g, ' ').replace(/\[[^\]]*\]/g, ' ')
    .replace(/（[^）]*）/g, ' ').replace(/\([^)]*\)/g, ' ')
    .replace(/Hi-?Res|无损|完整版|官方|MV|纯听|高清|修复|4K|60FPS|60帧|音画|现场|Live|歌词|翻唱|原唱/gi, ' ')
    .replace(/[「」『』"'“”‘’]/g, ' ').replace(/\s*[-–—|｜]\s*/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 30);
}
/* 兜底1：网易云标题搜索 → 取时长最接近的那首歌词（匿名可用） */
async function neLyricByTitle(title, dur) {
  try {
    if (typeof NESA === 'undefined') return null;
    if (!NESA.ready) { try { await NESA.init(); } catch (e) { } }
    const kw = lyricTitleKey(title);
    if (!kw) return null;
    const songs = await NESA.search(kw, 6);
    if (!songs || !songs.length) return null;
    let best = songs[0];
    if (dur > 0) {
      let bd = Infinity;
      for (const s of songs) { const d = Math.abs((s.duration || 0) - dur); if (d < bd) { bd = d; best = s; } }
    }
    const l = await NESA.lyric(best.nid);
    return (l && l.length) ? l : null;
  } catch (e) { return null; }
}
/* 兜底2：LRCLIB 开放歌词库（直连，无需登录；优先带时间轴的 syncedLyrics） */
async function lrclibByTitle(title, dur) {
  try {
    const kw = lyricTitleKey(title);
    if (!kw) return null;
    const r = await window.bHttp('GET', 'https://lrclib.net/api/search?q=' + encodeURIComponent(kw), '', 12000);
    let arr = [];
    try { arr = JSON.parse(r.body || '[]'); } catch (e) { return null; }
    if (!arr || !arr.length) return null;
    let best = arr.find(a => a && a.syncedLyrics) || null;
    if (dur > 0) {
      let bd = Infinity, bp = null;
      for (const a of arr) {
        if (!a || !a.syncedLyrics) continue;
        const d = Math.abs((a.duration || 0) - dur);
        if (d < bd) { bd = d; bp = a; }
      }
      if (bp) best = bp;
    }
    if (!best || !best.syncedLyrics) return null;
    return (typeof NESA !== 'undefined' && NESA._lrcParse) ? NESA._lrcParse(best.syncedLyrics) : null;
  } catch (e) { return null; }
}
async function loadLyric(it) {
  const k = itemKey(it);
  lyricFor = k; lyricLines = null; lyricIdx = -1; remoteLyrLabel = '';
  renderLyrics();
  let lines = null, label = '';
  const dur = it.duration || 0;
  try {
    /* 1) 首选原生歌词源 */
    if (it.qmid && QQSA.ready) { lines = await QQSA.lyric(it.qmid); if (lines && lines.length) label = 'QQ音乐歌词'; }
    else if (it.nid && typeof NESA !== 'undefined' && NESA.ready) { lines = await NESA.lyric(it.nid); if (lines && lines.length) label = '网易云歌词'; }
    else if (it.bvid && STANDALONE) { lines = await biliSubLines(it); if (lines && lines.length) label = 'B站AI字幕'; }
    if (lyricFor !== k) return; // 已切歌
    /* 2) 兜底链：网易云标题搜索 → LRCLIB（未登录/无字幕时也能有歌词，对齐PC端） */
    if (!lines || !lines.length) {
      lines = await neLyricByTitle(it.title, dur);
      if (lyricFor !== k) return;
      if (lines && lines.length) label = '网易云歌词';
    }
    if (!lines || !lines.length) {
      lines = await lrclibByTitle(it.title, dur);
      if (lyricFor !== k) return;
      if (lines && lines.length) label = 'LRCLIB 歌词库';
    }
  } catch (e) { }
  if (lyricFor !== k) return;
  remoteLyrLabel = label;
  lyricLines = (lines && lines.length) ? lines : null;
  lyricIdx = -1;
  renderLyrics();
}
async function biliSubLines(it) {
  try {
    let cid = it.cid;
    if (!cid) { const v = await BLSA._get('/x/web-interface/view', { bvid: it.bvid }); cid = v.cid; }
    if (!cid) return null;
    const v2 = await BLSA._get('/x/player/wbi/v2', { bvid: it.bvid, cid }, { wbi: true });
    const subs = (v2.subtitle && v2.subtitle.subtitles) || [];
    if (!subs.length) return null;
    const pick = subs.find(x => /zh|cn/i.test(x.lan || '')) || subs[0];
    let u = pick.subtitle_url || '';
    if (!u) return null;
    if (u.startsWith('//')) u = 'https:' + u;
    const j = JSON.parse(await window.bHttp('GET', u, ''));
    return (j.body || []).map(x => ({ t: x.from || 0, text: String(x.content || '').trim() })).filter(x => x.text);
  } catch (e) { return null; }
}
function renderLyrics() {
  const box = $('lyrics-scroll');
  if (!box) return;
  if (!lyricLines) { box.innerHTML = '<div class="lyr-line empty">暂无歌词</div>'; return; }
  const foot = remoteLyrLabel ? '<div class="lyr-foot">歌词来源：' + esc(remoteLyrLabel) + '</div>' : '';
  box.innerHTML = lyricLines.map((l, i) => '<div class="lyr-line" data-i="' + i + '">' + esc(l.text) + '</div>').join('') + foot;
  box.scrollTop = 0;
}
function updateNpLyr() {
  const el = $('np-lyr');
  if (!el) return;
  if (!lyricLines || !lyricLines.length || lyricMode) { el.classList.add('hidden'); return; }
  const t = LA.currentTime + 0.15;
  let idx = -1;
  for (let i = 0; i < lyricLines.length; i++) { if (lyricLines[i].t <= t) idx = i; else break; }
  if (idx >= 0 && lyricLines[idx].text) {
    el.textContent = lyricLines[idx].text;
    el.classList.remove('hidden');
  } else el.classList.add('hidden');
}

function updateLyric() {
  if (!lyricMode || !lyricLines || !lyricLines.length) return;
  const t = (localMode ? LA.currentTime : ((lastState || {}).time || 0)) + 0.15;
  let idx = -1;
  for (let i = 0; i < lyricLines.length; i++) { if (lyricLines[i].t <= t) idx = i; else break; }
  if (idx === lyricIdx) return;
  lyricIdx = idx;
  const box = $('lyrics-scroll');
  const on = box && box.querySelectorAll('.lyr-line.on');
  (on || []).forEach(x => { x.classList.remove('on'); x.style.removeProperty('--kfill'); });
  const el = box && box.querySelector('.lyr-line[data-i="' + idx + '"]');
  if (el) {
    el.classList.add('on');
    box.scrollTop = el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2;
  }
}
/* 卡拉OK填充：当前句按行内进度从左往右亮起（250ms 节流） */
setInterval(() => {
  if (!lyricMode || !lyricLines || lyricIdx < 0 || lyricIdx >= lyricLines.length) return;
  if (document.hidden || curTab !== "player") return;
  const now = Date.now();
  if (!updateLyric._ka || now - updateLyric._ka < 250) return;
  updateLyric._ka = now;
  const box = $('lyrics-scroll');
  const el = box && box.querySelector('.lyr-line.on');
  if (!el) return;
  const t = (localMode ? LA.currentTime : ((lastState || {}).time || 0)) + 0.15;
  const t0 = lyricLines[lyricIdx].t || 0;
  const t1 = lyricLines[lyricIdx + 1] ? lyricLines[lyricIdx + 1].t : (t0 + 8);
  const pct = Math.max(0, Math.min(1, (t - t0) / Math.max(0.5, t1 - t0)));
  el.style.setProperty('--kfill', (pct * 100).toFixed(1) + '%');
}, 250);
function toggleLyric() {
  lyricMode = !lyricMode;
  try { if (lyricMode) { const e = $('np-lyr'); if (e) e.classList.add('hidden'); } } catch (err) { }
  const v = $('vinyl'), box = $('lyrics-box');
  if (v) v.classList.toggle('lyric-mode', lyricMode);
  if (box) box.classList.toggle('hidden', !lyricMode);
  if (lyricMode) {
    if (!localMode && lastState && (lastState.qmid || lastState.bvid || lastState.title)) loadRemoteLyric(lastState);
    else {
      const it = localQueue[localIdx];
      if (it && lyricFor !== itemKey(it)) loadLyric(it);
      else renderLyrics();
    }
  }
}
function renderMini() {
  const bar = $('mini');
  if (!bar) return;
  const it = localQueue[localIdx];
  const show = !!it && curTab !== 'player';
  bar.classList.toggle('hidden', !show);
  if (!show) return;
  const img = $('mini-cover');
  const cover = pic(it.pic);
  if (img.getAttribute('src') !== cover) img.setAttribute('src', cover || '');
  $('mini-title').textContent = it.title || '';
  $('mini-up').textContent = it.up || '';
  $('mini-toggle').textContent = LA.paused ? '▶' : '⏸';
  const mp = $('mini-prog');
  if (mp) {
    const dur = isFinite(LA.duration) && LA.duration > 0 ? LA.duration : (it.duration || 0);
    mp.style.width = dur ? Math.min(100, LA.currentTime / dur * 100).toFixed(1) + '%' : '0%';
  }
}
function renderLocalTimes() {
  const dur = isFinite(LA.duration) && LA.duration > 0 ? LA.duration : (localQueue[localIdx] ? localQueue[localIdx].duration || 0 : 0);
  const t = Math.min(LA.currentTime || 0, dur || LA.currentTime || 0);
  $('t-cur').textContent = fmt(t);
  $('t-dur').textContent = fmt(dur);
  if (!$seekDragging) {
    $('seek').value = dur ? Math.round(t / dur * 1000) : 0;
    setSeekFill(dur ? t / dur : 0);
  }
  $('ic-play').classList.toggle('hidden', !LA.paused);
  $('ic-pause').classList.toggle('hidden', LA.paused);
  document.body.classList.toggle('paused', LA.paused);
  const vol = $('vol');
  if (document.activeElement !== vol) vol.value = Math.round(LA.volume * 100);
  /* 锁屏面板播放状态实时同步 */
  try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = LA.paused ? 'paused' : 'playing'; } catch (e) { }
  /* 定时关闭：三模式（normal=立即暂停 / fade=30秒渐出 / current=播完当前曲再停）
     变量声明在模块级（「独立模式定时关闭」区块），这里只做检查 */
  if (sleepUntil && sleepMode !== 'current' && Date.now() >= sleepUntil) {
    if (sleepMode === 'fade' && LA.volume > 0.03) {
      if (!sleepFadeStart) sleepFadeStart = Date.now();
      const elapsed = Date.now() - sleepFadeStart;
      const pct = Math.min(1, elapsed / 30000);
      LA.volume = Math.max(0, 1 - pct);
      if (pct >= 1) { sleepUntil = 0; sleepMode = 'normal'; sleepFadeStart = 0; userPaused = true; elFade(0, 300).then(() => { LA.pause(); LA.volume = 1; }); toast('⏰ 定时关闭 · 已暂停'); }
    } else {
      sleepUntil = 0; sleepMode = 'normal'; sleepFadeStart = 0;
      userPaused = true;
      elFade(0, 300).then(() => { LA.pause(); LA.volume = 1; });
      toast('⏰ 定时关闭 · 已暂停');
    }
  }
  /* 无缝切换：歌曲开始播放就预解析+预缓冲下一首（原来只在剩余<15秒才触发，太晚） */
  if (dur && dur - t > 0 && localQueue.length > 1 && !prefetching && nextPre.key !== itemKey(localQueue[(localIdx + 1) % localQueue.length] || {})) prefetchNext();
  /* 播完前 2 秒淡出音量（配合 localLoad 的淡入 → 无咔哒声） */
  if (dur && dur - t < 2 && dur - t > 0 && !LA._fading && LA.volume > 0.02) {
    LA._fading = true;
    elFade(0, 1800).then(() => { });
  }
  if (dur && dur - t >= 2) LA._fading = false;
}
/* 行点播路由：本机模式在手机播，遥控模式发指令给电脑 */
function playRoute(items, idx, remoteFn, remoteArg) {
  if (localMode) { localPlay(items, idx); toast('🎧 手机本机播放'); }
  else { remoteFn(remoteArg); }
}
/* 把播放器事件集中绑定：音频元素被替换（无声自愈）后重新绑定同一套逻辑 */
let failStreakM = 0;
function bindAudioEl(el) {
  el.addEventListener('ended', () => {
    /* duration异常(0/NaN)时浏览器也会误发ended → 忽略，避免"莫名切歌" */
    if (!isFinite(el.duration) || el.duration <= 0) return;
    if (el.currentTime + 1.5 < el.duration) return;
    /* 睡眠定时器"播完当前曲再停"模式：播完就停，不切下一首 */
    try { qqScrobFlushM(); } catch (e) { } // 播完先结算QQ听歌时长
    if (sleepUntil && sleepMode === 'current') {
      sleepUntil = 0; sleepMode = 'normal';
      userPaused = true;
      toast('⏰ 定时关闭 · 播完当前曲已暂停');
      return;
    }
    autoNext();
  });
  el.addEventListener('timeupdate', () => {
    if (localMode) { renderMini(); updateLyric(); }
    if (localMode && curTab === 'player') { renderLocalTimes(); updateNpLyr(); }
    try { qqScrobTickM(); } catch (e) { }
  });
  el.addEventListener('playing', () => { failStreakM = 0; if (PFX.ctx) PFX.resume(); if (localMode) renderMini(); });
  el.addEventListener('pause', () => {
    /* 后台续播：安卓WebView在页面转hidden时会把媒体自动暂停（平台行为，不是我们代码）。
       只要不是用户主动暂停，就立刻拉回播放，实现真正的后台播放 */
    if (document.hidden && !userPaused && !bgHandoff && el.src && el.currentTime > 0) {
      const now = Date.now();
      if (now - (el._bgRetryAt || 0) > 800) {
        el._bgRetryAt = now;
        setTimeout(() => {
          if (document.hidden && !userPaused && el.paused) el.play().catch(() => { });
        }, 120);
      }
    }
    if (localMode) renderMini();
  });
  el.addEventListener('error', () => {
    if (!localMode || !el.src) return;
    /* 切歌/换源瞬间的瞬时错误不当作失败：否则会连环跳歌（"莫名切歌"的根源） */
    if (Date.now() - lastLoadAt < 2500) return;
    if (el.src.indexOf('blob:') === 0) return; // MSE由自己兜底，不走自动跳歌
    failStreakM++;
    let errHost = '';
    try { errHost = new URL(el.src).host; } catch (e) { }
    /* 先原地重试一次，仍然失败才跳下一首（上限2次防死循环） */
    if (failStreakM === 1) { toast('加载卡顿，重试中…'); setTimeout(() => localLoad(), 500); return; }
    if (localQueue.length > 1 && failStreakM <= 3) { toast('加载失败(' + (errHost || '?') + ')，自动跳下一首'); setTimeout(() => localStep(1), 600); }
    else toast('音频加载失败(' + (errHost || '?') + ')');
  });
}
bindAudioEl(LA);

/* 无声音自愈：WebAudio建图后跨域音源的输出会被Chromium静音，
   检测到"进度在走但图输出0信号"就换一个新音频元素回到直通播放 */
let audioHealBusy = false;
async function healSilentAudio(reason) {
  if (audioHealBusy || !PFX.built) return;
  audioHealBusy = true;
  const it = localQueue[localIdx];
  const pos = LA.currentTime || 0, vol = LA.volume;
  const wasPlaying = !LA.paused;
  try {
    const old = LA;
    PFX.reset();                 // 拆掉音频图（旧元素连同它的MediaElementSource一起废弃）
    const fresh = new Audio();
    fresh.preload = 'auto';
    /* 回退直通：不要CORS（能直连就行），避免又踩跨域加载失败 */
    fresh.crossOrigin = '';
    bindAudioEl(fresh);
    LA = fresh;
    try { old.pause(); old.removeAttribute('src'); old.load(); } catch (e) { }
    /* 音效不可用：清掉音效状态，之后一直走直通 */
    PFX.state = { preset: 'off' };
    PFX.save();
    fxUnsupported = true;
    if (it) {
      const r = await resolveSrc(it);
      LA.src = r.direct ? r.u : streamUrl(r.u);
      LA.volume = vol;
      try { LA.currentTime = pos; } catch (e) { }
      if (wasPlaying) await LA.play().catch(() => { });
      renderLocalInfo(it, false);
    }
    toast('该音源不支持音效，已切回直通播放（' + reason + '）');
  } catch (e) { }
  audioHealBusy = false;
}
let fxUnsupported = false;

/* 静音看门狗：建图状态下每2秒抽样一次输出能量 */
setInterval(() => {
  if (!PFX.built || !PFX.meter || audioHealBusy) return;
  if (LA.paused || !LA.src) return;
  try {
    const buf = new Float32Array(PFX.meter.fftSize);
    PFX.meter.getFloatTimeDomainData(buf);
    let s = 0, mx = 0;
    for (let i = 0; i < buf.length; i++) { s += buf[i] * buf[i]; if (Math.abs(buf[i]) > mx) mx = Math.abs(buf[i]); }
    if (mx < 0.0008) {
      PFX._silentTicks = (PFX._silentTicks || 0) + 1;
      /* 连续3次(≈6秒)完全无信号才判定为"跨域静音"，避免前奏静音误判 */
      if (PFX._silentTicks >= 3) { PFX._silentTicks = 0; healSilentAudio('跨域音源'); }
    } else PFX._silentTicks = 0;
  } catch (e) { }
}, 2000);

/* ---------- 锁屏/通知栏媒体控制（MediaSession） ---------- */
function updateMediaSession(it) {
  /* 锁屏/通知栏增强：设置 action handlers */
  try {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => { userPaused = false; LA.play().catch(() => { }); });
      navigator.mediaSession.setActionHandler('pause', () => { userPaused = true; LA.pause(); });
      navigator.mediaSession.setActionHandler('previoustrack', () => { localStep(-1); });
      navigator.mediaSession.setActionHandler('nexttrack', () => { localStep(1); });
      navigator.mediaSession.setActionHandler('seekto', details => { try { LA.currentTime = details.seekTime; } catch (e) { } });
    }
  } catch (e) { }
  if (!('mediaSession' in navigator) || !it) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: it.title || '未在播放',
      artist: it.up || '',
      album: '哔哩播放器',
      artwork: it.pic ? [{ src: pic(it.pic), sizes: '512x512', type: 'image/jpeg' }] : []
    });
  } catch (e) { }
}
if ('mediaSession' in navigator) {
  try {
    navigator.mediaSession.setActionHandler('play', () => { userPaused = false; LA.play().catch(() => { }); });
    navigator.mediaSession.setActionHandler('pause', () => { userPaused = true; LA.pause(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => { if (localQueue.length) localStep(-1); });
    navigator.mediaSession.setActionHandler('nexttrack', () => { if (localQueue.length) localStep(1); });
    navigator.mediaSession.setActionHandler('seekto', d => { if (d && d.seekTime != null && isFinite(LA.duration)) { try { LA.currentTime = d.seekTime; } catch (e) { } } });
    navigator.mediaSession.setActionHandler('seekforward', d => { if (isFinite(LA.duration)) { try { LA.currentTime = Math.min(LA.duration, LA.currentTime + (d && d.seekOffset || 10)); } catch (e) { } } });
    navigator.mediaSession.setActionHandler('seekbackward', d => { try { LA.currentTime = Math.max(0, LA.currentTime - (d && d.seekOffset || 10)); } catch (e) { } });
  } catch (e) { }
}

/* ---------- 音频引擎状态守卫（旧版"暂停就suspend"会在切歌时竞态挂死→有声进度无声） ----------
   只在页面真正不可见（后台/锁屏）时挂起，恢复可见立即resume；
   注意：AudioContext 一旦建立，声音只走WebAudio图，ctx挂起=完全没声音，绝不能由pause触发 */
/* 播放开始必resume音频引擎（只resume，绝不suspend——旧版在pause时suspend导致静音） */
LA.addEventListener('playing', () => { if (PFX.ctx) PFX.resume(); });
/* ---------- 后台播放：交给原生MediaPlayer ----------
   WebView里没有 navigator.mediaSession，页面转后台后Chromium会强制暂停媒体元素，
   JS再怎么play()都会被立刻掐掉。所以后台由原生续播，回到前台再把进度交还。 */
let bgHandoff = false;      // 是否已把播放交给原生
let bgErrStreak = 0;        // 保留（兼容旧引用）
let bgLastEndedAt = 0;      // 上次 ended 时间（去重：原生可能重复回调，防连跳）
let bgWatchTimer = 0, bgIdleTicks = 0; // 后台看门狗：真实状态卡住才重试
let skipStreak = 0;         // 连续解析失败计数（自动跳过的节流）
let curPlainUrl = '';       // 当前可给原生用的直链（非blob）
function bgStartNative(posMs) {
  if (!window.androidApi || !window.androidApi.bgPlay) return false;
  const it = localQueue[localIdx];
  if (!curPlainUrl || !it) return false;
  /* 关键：换到新歌必须从 0 开始。旧代码总用 LA.currentTime（上一首的结尾位置），
     新歌会被 seek 到超出时长的位置 → 立刻结束/报错，后台只播一首就断 */
  const pos = (posMs === undefined || posMs === null) ? Math.round((LA.currentTime || 0) * 1000) : Math.max(0, Math.round(posMs));
  try {
    try { if (window.androidApi.bpLog) androidApi.bpLog('bgStartNative pos=' + pos + ' url=' + String(curPlainUrl).slice(0, 50) + ' ttl=' + String(it.title || '').slice(0, 16)); } catch (e) { }
    androidApi.bgPlay(curPlainUrl, it.title || '', it.up || '', pos);
    bgErrStreak = 0;
    return true;
  } catch (e) { return false; }
}
function bgWatchStart() {
  bgIdleTicks = 0;
  if (bgWatchTimer) return;
  bgWatchTimer = setInterval(() => {
    if (!bgHandoff || !document.hidden) { clearInterval(bgWatchTimer); bgWatchTimer = 0; return; }
    let st = null;
    try { st = JSON.parse(androidApi.bgPos()); } catch (e) { return; }
    if (!st || !st.active) return;
    const nearEnd = st.dur > 0 && st.pos >= st.dur - 2000;
    if (!st.playing && !nearEnd) {
      bgIdleTicks++;
      if (bgIdleTicks >= 3) {            // 卡住约9秒 → 重新解析并重试
        bgIdleTicks = 0; bgErrStreak++;
        if (bgErrStreak >= 3) { bgHandoff = false; bgErrStreak = 0; toast('后台播放中断，已切回前台播放'); }
        else { try { localResolving = false; localLoad(); } catch (e) { } } // 走完整解析，避免用过期URL
      }
    } else bgIdleTicks = 0;
  }, 3000);
}
function bgWatchStop() { if (bgWatchTimer) { clearInterval(bgWatchTimer); bgWatchTimer = 0; } bgIdleTicks = 0; }
function bgTakeBack() {
  if (!bgHandoff) return;
  bgHandoff = false;
  bgWatchStop();
  let st = null;
  try { st = JSON.parse(androidApi.bgPos()); } catch (e) { }
  try { androidApi.bgStop(); } catch (e) { }
  if (!st || !st.active) { PFX.resume(); return; }
  const pos = Math.max(0, (st.pos || 0) / 1000);
  /* 新歌还在准备中(dur=0)时 playing=false 是正常的，不能当成"用户暂停" */
  const preparing = !(st.dur > 0);
  userPaused = !st.playing && !preparing;
  try { LA.currentTime = pos; } catch (e) { }
  if (!userPaused) { LA.play().catch(() => { }); }
}
/* 原生通知栏/播完回调 */
window.__bgCmd = function (cmd) {
  cmd = String(cmd || '');
  if (cmd.indexOf('ended') === 0) {
    /* 去重：MediaPlayer 有时连发多次 onCompletion，不去重会连跳好几首 */
    const now = Date.now();
    if (now - bgLastEndedAt < 3000) return;
    bgLastEndedAt = now;
    autoNext();
    return;
  }
  if (cmd === 'next') { localStep(1); return; }
  if (cmd === 'toggle-done') return;
  if (cmd.indexOf('error') === 0) {
    /* -38 之类的瞬时错误（seek 不支持）实测不影响出声，只记日志，
       真正的故障由 bgWatch 看门狗按"播放位置是否推进"判定 */
    try { if (window.androidApi && androidApi.bpLog) androidApi.bpLog('bgCmd ' + cmd); } catch (e) { }
    return;
  }
};
document.addEventListener('visibilitychange', () => {
  if (typeof NViz !== 'undefined' && NViz.enabled && !NViz.raf && NViz.canvas) NViz.loop();
  if (document.visibilityState === 'hidden') {
    if (localMode && !LA.paused && LA.src) {
      bgHandoff = bgStartNative();
      if (bgHandoff) { try { LA.pause(); } catch (e) { } bgWatchStart(); }
    }
  } else {
    bgTakeBack();
    PFX.resume();
    renderMini();
  }
});
/* 用户任意一次触摸：兜底解锁被浏览器策略挡住的 AudioContext */
['pointerdown', 'touchstart', 'click'].forEach(ev => window.addEventListener(ev, () => {
  if (PFX.ctx && PFX.ctx.state !== 'running' && !LA.paused) PFX.resume();
}, { passive: true }));

/* ---------- 下一首预解析：剩余<15秒时后台解析直链，切歌零等待 ---------- */
let nextPre = { key: '', src: '' };
let preBufEl = null; // 预缓冲元素：预下载下一首音频到HTTP缓存
let prefetching = false;
let sleepUntil = 0; let sleepMode = 'normal'; let sleepFadeStart = 0;
/* 音量渐变：切歌淡入淡出（消咔哒声）；JS定时器渐变，不依赖WebAudio图 */
let fadeT = 0;
function elFade(target, ms) {
  return new Promise(res => {
    const from = LA.volume;
    if (Math.abs(from - target) < 0.02) { LA.volume = target; return res(); }
    const steps = Math.max(2, Math.round((ms || 200) / 30));
    let i = 0;
    clearInterval(fadeT);
    fadeT = setInterval(() => {
      i++;
      LA.volume = Math.max(0, Math.min(1, from + (target - from) * (i / steps)));
      if (i >= steps) { clearInterval(fadeT); LA.volume = target; res(); }
    }, 30);
  });
}
function itemKey(it) { return it ? (it.bvid ? 'b' + it.bvid + (it.pid ? '_' + it.pid : '') : it.nid ? 'n' + it.nid : it.qmid ? 'q' + it.qmid : '') : ''; }
/* 快速可播性探测：FLAC等新音源先验证再采用，起不来就走回退链（防整首卡死） */
function probeAudio(url, ms) {
  return new Promise(res => {
    const a = new Audio();
    a.preload = 'auto'; a.src = url;
    let done = false;
    const finish = v => { if (done) return; done = true; clearTimeout(t); try { a.pause(); a.removeAttribute('src'); } catch (e) { } res(v); };
    const t = setTimeout(() => finish(false), ms || 3500);
    a.addEventListener('canplay', () => finish(true), { once: true });
    a.addEventListener('error', () => finish(false), { once: true });
    a.play().catch(() => { });
  });
}
async function prefetchNext() {
  if (prefetching || !localQueue.length) return;
  const nxt = localQueue[(localIdx + 1) % localQueue.length];
  if (!nxt) return;
  const k = itemKey(nxt);
  if (nextPre.key === k && nextPre.src) return;
  prefetching = true;
  try {
    const r = await resolveSrc(nxt);
    const url = r.direct ? r.u : streamUrl(r.u);
    nextPre = { key: k, src: url, dashAudio: r.dashAudio };
    /* 预缓冲：用隐藏Audio元素预下载到浏览器HTTP缓存 → 切歌时 LA.src 同URL命中缓存，秒出声 */
    try {
      if (preBufEl) { preBufEl.src = ''; preBufEl = null; }
      preBufEl = new Audio();
      preBufEl.preload = 'auto';
      preBufEl.src = url;
      preBufEl.load();
    } catch (e) { }
  } catch (e) { nextPre = { key: '', src: '' }; }
  prefetching = false;
}

/* ---------- 独立模式定时关闭 ---------- */
function localSleep(mins, mode) {
  if (!mins) {
    sleepUntil = 0; sleepMode = 'normal'; sleepFadeStart = 0;
    toast('⏰ 定时已取消');
    return;
  }
  sleepMode = mode || 'normal';
  if (sleepMode === 'current') {
    sleepUntil = 1; // 标记激活（时间不重要，ended事件触发）
    toast('⏰ 将在播完当前曲后停止');
  } else {
    sleepUntil = Date.now() + mins * 60000;
    sleepFadeStart = 0;
    if (sleepMode === 'fade') toast('⏰ ' + mins + ' 分钟后渐出停止');
    else toast('⏰ ' + mins + ' 分钟后暂停');
  }
}


/* ---------- 网络状态提示 ---------- */
window.addEventListener('offline', () => toast('⚠ 网络已断开，播放可能中断'));
window.addEventListener('online', () => toast('网络已恢复', 'success'));

/* ---------- 手机本机音效引擎（与 PC 同一套 Web Audio 图） ---------- */
const FX_PRESETS = {
    off:      { label: '平直（关闭）', g: [0, 0, 0, 0, 0, 0, 0] },
    hifi:     { label: 'HiFi 高保真', g: [1.5, 0.5, 0, 0, 0.5, 1.5, 2.5], bass: 1, treble: 1, width: 1.3, comp: false, gain: 1 },
    sbass:    { label: '超重低音', g: [11, 9, 4, 0, -1, 0, -1], bass: 7, comp: true },
    vocalc:   { label: '清澈人声', g: [-6, -4, 3, 6, 6, 4, -2], treble: 3, comp: true },
    female:   { label: '温柔女声', g: [-4, -2, 3, 7, 6, 3, -2], treble: 4, comp: true },
    male:     { label: '浑厚男声', g: [5, 4, 2, 1, -1, -3, -5], bass: 3, comp: true },
    pure:     { label: '超纯净人声', g: [-9, -6, -1, 7, 8, 4, -5], treble: 2, comp: true },
    ethereal: { label: '空灵韵', g: [-5, -2, -2, 2, 6, 8, 6], treble: 5, reverb: 'hall', rvMix: 0.62, width: 1.6 },
    liyin3d:  { label: '3D丽音', g: [-2, 0, 2, 4, 5, 3, 0], space3d: true, space3dRate: 0.18, width: 1.7, comp: true },
    pano:     { label: '全景环绕', g: [2, 0, 0, 2, 3, 1, 2], space3d: true, space3dRate: 0.32, width: 2.0, comp: true },
    dolby:    { label: '全景声模拟', g: [2, 0, 0, 2, 4, 4, 5], space3d: true, space3dRate: 0.2, reverb: 'room', rvMix: 0.3, width: 1.8, comp: true },
    stereo:   { label: '立体声宽', g: [0, 0, 0, 0, 2, 3, 2], width: 2.2, comp: true },
    earbuds:  { label: '悦耳耳机', g: [4, 2, -1, 2, 4, 4, 2], space3d: true, space3dRate: 0.12, width: 1.5, comp: true },
    hall:     { label: '音乐厅', g: [1, 1, 0, 0, 2, 4, 3], reverb: 'hall', rvMix: 0.7, width: 1.3 },
    plaza:    { label: '音乐广场', g: [4, 3, 1, 0, 1, 3, 2], reverb: 'room', rvMix: 0.55, width: 1.4 },
    live:     { label: '演唱会', g: [5, 3, 2, 2, 4, 4, 2], bass: 3, reverb: 'hall', rvMix: 0.65, width: 1.5, comp: true },
    chicago:  { label: '芝加哥剧院', g: [2, 2, 0, 0, 3, 6, 6], reverb: 'church', rvMix: 0.66, width: 1.4 },
    musical:  { label: '音乐剧', g: [2, 2, 2, 2, 4, 4, 2], reverb: 'hall', rvMix: 0.6, width: 1.4 },
    karaoke:  { label: 'K歌跟唱', g: [-3, -2, 2, 5, 5, 3, -1], vocal: true, reverb: 'room', rvMix: 0.45, comp: true },
    phone:    { label: '电话音', g: [-18, -14, -4, 7, 10, 6, -10], comp: true },
    vinylfx:  { label: '黑胶复古', g: [5, 2, 0, -1, -2, 0, 4], bass: 3, reverb: 'studio', rvMix: 0.34 },
    cozy:     { label: '温馨卧室', g: [4, 3, 0, -2, -2, 1, 3], bass: 3, reverb: 'room', rvMix: 0.4, width: 1.3 },
    midnight: { label: '午夜慵懒', g: [7, 5, 0, -3, -4, 0, 2], bass: 5, reverb: 'room', rvMix: 0.42, width: 1.3 },
    street:   { label: '漫步街头', g: [4, 2, -2, 0, 2, 4, 4], width: 1.5, comp: true },
    smart:    { label: '智能动态', g: [3, 2, 1, 2, 3, 3, 1], comp: true, width: 1.4 },
    rhythm:   { label: '悦动节奏', g: [6, 3, -1, 3, 1, 4, 4], bass: 3, comp: true, width: 1.5 },
    heartbeat:{ label: '心跳节奏', g: [12, 8, 0, -1, 2, 0, -1], bass: 7, comp: true },
    london:   { label: '伦敦耳语', g: [-6, -3, 2, 4, 6, 8, 8], treble: 4, reverb: 'studio', rvMix: 0.34 },
    anime:    { label: '二次元提亮', g: [-3, 0, 2, 4, 7, 7, 4], treble: 6, comp: true, width: 1.4 },
    game:     { label: '游戏沉浸', g: [8, 4, 0, 2, 4, 7, 4], bass: 5, reverb: 'hall', rvMix: 0.55, width: 1.9, comp: true },
    studio:   { label: '录音棚', g: [0, 0, 0, 0, 0, 0, 0], reverb: 'studio', rvMix: 0.28, comp: true },
    rich:    { label: '醇厚人声', g: [3, 1, 0, 2, 3, 1, 0], bass: 2, norm: true, comp: true, width: 1.2 },
    punch:   { label: '冲击力', g: [9, 6, 0, -1, 2, 3, 2], subBass: true, comp: true, width: 1.3 },
    crystal: { label: '水晶通透', g: [-2, 0, 2, 4, 6, 8, 9], air: true, treble: 3, width: 1.4 },
    cinema:  { label: '影院环绕', g: [5, 2, 0, 2, 4, 5, 4], subBass: true, air: true, norm: true, reverb: 'hall', rvMix: 0.5, width: 1.8, comp: true, space3d: true, space3dRate: 0.18 },
    galaxy:  { label: '银河幻境', g: [-3, 0, 2, 4, 7, 8, 6], air: true, reverb: 'hall', rvMix: 0.68, width: 2.0, space3d: true, space3dRate: 0.22, treble: 4 },
    spatial: { label: '空间音频', g: [0, 0, 1, 3, 3, 2, 1], norm: true, width: 1.6, space3d: true, space3dRate: 0.12, comp: true },
    warmtube:{ label: '温暖电子管', g: [4, 2, 0, 1, 2, 0, -1], bass: 3, norm: true, comp: true, width: 1.1 },
    nightcore:{ label: '夜核加速', g: [2, 0, 0, 2, 5, 7, 9], air: true, treble: 5, width: 1.3 },
    bassboost:{ label: '低音炮', g: [13, 10, 5, 0, -1, 0, -2], subBass: true, bass: 8, comp: true },
    concert: { label: '现场音乐会', g: [6, 4, 1, 2, 5, 5, 3], bass: 4, reverb: 'hall', rvMix: 0.62, width: 1.7, comp: true, air: true },
    /* 风格EQ（仅均衡曲线，增益同样加大） */
    pop:       { label: '流行', g: [2, 1, 2, 4, 6, 4, 1], comp: true, eqOnly: true },
    rock:      { label: '摇滚', g: [8, 6, -2, -4, 2, 6, 8], bass: 2, comp: true, eqOnly: true },
    edm:       { label: '电子', g: [10, 6, 0, -2, 2, 8, 8], comp: true, eqOnly: true },
    jazz:      { label: '爵士', g: [6, 4, 2, -2, -2, 2, 4], eqOnly: true },
    classical: { label: '古典', g: [4, 2, 0, 0, 0, 2, 6], eqOnly: true },
    bright:    { label: '高音增强', g: [0, 0, 0, 0, 2, 8, 10], treble: 4, eqOnly: true }
  };
const FX_PRESET_FX = ['off', 'hifi', 'sbass', 'vocalc', 'female', 'male', 'pure', 'ethereal', 'liyin3d', 'pano', 'dolby', 'stereo', 'earbuds', 'hall', 'plaza', 'live', 'chicago', 'musical', 'karaoke', 'phone', 'vinylfx', 'cozy', 'midnight', 'street', 'smart', 'rhythm', 'heartbeat', 'london', 'anime', 'game', 'studio', 'rich', 'punch', 'crystal', 'cinema', 'galaxy', 'spatial', 'warmtube', 'nightcore', 'bassboost', 'concert'];
const FX_PRESET_EQ = ['pop', 'rock', 'edm', 'jazz', 'classical', 'bright'];
const FX_REVERBS = { room: '小房间', studio: '录音棚', hall: '音乐厅', church: '大教堂' };

const PFX_STATE_KEY = 'bp.fx'; // 与 PC 同 key，手机上独立存储
const PFX = {
  built: false,
  ctx: null, src: null, out: null, bands: [], bassN: null, trebleN: null,
  pan: null, lfo: null, lfoGain: null, subHP: null,
    cfSplit: null, cfMerge: null, cfDelL: null, cfDelR: null, cfLPL: null, cfLPR: null, cfXL: null, cfXR: null,
    bmLP: null, bmSum: null, exHP: null, exWS: null, exGain: null,
    wSplit: null, wSide: null, comp: null, trim: null,
    subN: null, airN: null, normC: null,
  vcDry: null, vcWet: null, rvDry: null, rvWet: null, rvConv: null,
  state: (() => {
    try { return JSON.parse(localStorage.getItem(PFX_STATE_KEY) || '{}'); } catch (e) { return {}; }
  })(),
  save() { try { localStorage.setItem(PFX_STATE_KEY, JSON.stringify(this.state)); } catch (e) { } },
  /* 是否需要WebAudio音效图：全是默认值时不建图——音频元素直通扬声器，
     这是最不容易出"没声音"的路径（createMediaElementSource一旦建立就再也回不去了） */
  needsFx() {
    const st = this.state || {};
    if (st.vocalCut) return true;
    if (st.reverb && st.reverb !== 'off') return true;
    if (st.space3d || st.comp) return true;
    if (st.bass || st.treble) return true;
    if (st.width && st.width !== 1) return true;
    if (st.gain) return true;
    if (st.subBass || st.air || st.norm) return true;
    if (Array.isArray(st.bands) && st.bands.some(v => v)) return true;
    return false;
  },
  /* 确保音频引擎在跑：play前/回到前台/触摸时调用。
     AudioContext 建立后声音只走WebAudio图，ctx处于suspended = 进度在走但完全静音 */
  async resume() {
    if (!this.ctx) return;
    try {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      /* resume可能被自动播放策略拒绝：再试一次，仍失败则给用户可执行的提示 */
      if (this.ctx.state !== 'running') {
        try { await this.ctx.resume(); } catch (e) { }
        if (this.ctx.state !== 'running' && !this._warned) {
          this._warned = 1;
          toast('音频被系统挂起：点一下屏幕即可恢复声音');
        }
      }
    } catch (e) { }
  },
  /* 只创建AudioContext，不建图（建图会永久接管音频元素输出） */
  _ctxOnly() {
    if (this.ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      /* latencyHint=playback：给足缓冲，减少低端机/720p解码时的欠载爆音 */
      try { this.ctx = new AC({ latencyHint: 'playback' }); }
      catch (e) { this.ctx = new AC(); }
      return true;
    } catch (e) { return false; }
  },
  /* 能力探测：先确认AudioContext真的能跑起来，再决定要不要建图。
     部分安卓WebView的AudioContext永远起不来，此时建图=永久静音，必须先挡住 */
  async prepare() {
    if (this.built) return true;
    if (!this._ctxOnly()) return false;
    await this.resume();
    if (this.ctx.state !== 'running') { await this.resume(); }
    return this.ctx.state === 'running';
  },
  ensure() {
    if (this.built) return true;
    /* 没探测到running就绝不建图：宁可不给音效，也不能没声音 */
    if (!this.ctx || this.ctx.state !== 'running') return false;
    try {
      this.src = this.ctx.createMediaElementSource(LA); // 一次性，之后声音只走本图
      const subHP = this.ctx.createBiquadFilter(); subHP.type = 'highpass'; subHP.frequency.value = 20; subHP.Q.value = 0.5;
      this.subHP = subHP;
      this.bands = [60, 150, 400, 1000, 2400, 6000, 12000].map(f => {
        const b = this.ctx.createBiquadFilter(); b.type = 'peaking'; b.frequency.value = f; b.Q.value = 0.9; b.gain.value = 0; return b;
      });
      this.bassN = this.ctx.createBiquadFilter(); this.bassN.type = 'lowshelf'; this.bassN.frequency.value = 110;

    /* ---- v3：交叉馈送 + 低频单声道 + 谐波激励 ---- */
    this.cfSplit = this.ctx.createChannelSplitter(2);
    this.cfMerge = this.ctx.createChannelMerger(2);
    this.cfDelL = this.ctx.createDelay(0.005); this.cfDelL.delayTime.value = 0.0003;
    this.cfDelR = this.ctx.createDelay(0.005); this.cfDelR.delayTime.value = 0.0003;
    this.cfLPL = this.ctx.createBiquadFilter(); this.cfLPL.type = 'lowpass'; this.cfLPL.frequency.value = 700;
    this.cfLPR = this.ctx.createBiquadFilter(); this.cfLPR.type = 'lowpass'; this.cfLPR.frequency.value = 700;
    this.cfXL = this.ctx.createGain(); this.cfXL.gain.value = 0;
    this.cfXR = this.ctx.createGain(); this.cfXR.gain.value = 0;
    this.cfSplit.connect(this.cfMerge, 0, 0);
    this.cfSplit.connect(this.cfMerge, 1, 1);
    this.cfSplit.connect(this.cfDelL, 0); this.cfDelL.connect(this.cfLPL); this.cfLPL.connect(this.cfXL); this.cfXL.connect(this.cfMerge, 0, 1);
    this.cfSplit.connect(this.cfDelR, 1); this.cfDelR.connect(this.cfLPR); this.cfLPR.connect(this.cfXR); this.cfXR.connect(this.cfMerge, 0, 0);
    this.bmLP = this.ctx.createBiquadFilter(); this.bmLP.type = 'lowpass'; this.bmLP.frequency.value = 100;
    this.bmSum = this.ctx.createGain(); this.bmSum.gain.value = 0;
    this.exHP = this.ctx.createBiquadFilter(); this.exHP.type = 'highpass'; this.exHP.frequency.value = 3000;
    this.exWS = this.ctx.createWaveShaper();
    (function() { const n = 256, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * 2.5); } this.exWS.curve = c; }).call(this);
    this.exGain = this.ctx.createGain(); this.exGain.gain.value = 0;
      this.trebleN = this.ctx.createBiquadFilter(); this.trebleN.type = 'highshelf'; this.trebleN.frequency.value = 6000;
      // 立体声扩展（mid/side）
      const wUp = this.ctx.createGain();
      try { wUp.channelCount = 2; wUp.channelCountMode = 'explicit'; wUp.channelInterpretation = 'speakers'; } catch (e) { }
      const wSplit = this.ctx.createChannelSplitter(2);
      const wLM = this.ctx.createGain(); wLM.gain.value = 0.5;
      const wRM = this.ctx.createGain(); wRM.gain.value = 0.5;
      const wLS = this.ctx.createGain(); wLS.gain.value = 0.5;
      const wRS = this.ctx.createGain(); wRS.gain.value = -0.5;
      const wMid = this.ctx.createGain();
      const wSideRaw = this.ctx.createGain();
      this.wSide = this.ctx.createGain(); this.wSide.gain.value = 1;
      const wSideNeg = this.ctx.createGain(); wSideNeg.gain.value = -1;
      const wOutL = this.ctx.createGain(); const wOutR = this.ctx.createGain();
      const wMerge = this.ctx.createChannelMerger(2);
      wUp.connect(wSplit);
      wSplit.connect(wLM, 0); wSplit.connect(wRM, 1);
      wSplit.connect(wLS, 0); wSplit.connect(wRS, 1);
      wLM.connect(wMid); wRM.connect(wMid);
      wLS.connect(wSideRaw); wRS.connect(wSideRaw);
      wSideRaw.connect(this.wSide);
      wMid.connect(wOutL); this.wSide.connect(wOutL);
      wMid.connect(wOutR); this.wSide.connect(wSideNeg); wSideNeg.connect(wOutR);
      wOutL.connect(wMerge, 0, 0); wOutR.connect(wMerge, 0, 1);
      // 压缩
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = 0; this.comp.knee.value = 24; this.comp.ratio.value = 1;
      this.comp.attack.value = 0.004; this.comp.release.value = 0.22;
      this.trim = this.ctx.createGain(); this.trim.gain.value = 1;
      // 3D panner
      this.pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (this.pan) {
        this.lfo = this.ctx.createOscillator(); this.lfo.type = 'sine';
        this.lfo.frequency.value = this.state.space3dRate || 0.15;
        this.lfoGain = this.ctx.createGain(); this.lfoGain.gain.value = 0;
        this.lfo.connect(this.lfoGain); this.lfoGain.connect(this.pan.pan); this.lfo.start();
      }
      // 人声消除
      this.vcDry = this.ctx.createGain(); this.vcWet = this.ctx.createGain();
      const vSplit = this.ctx.createChannelSplitter(2);
      const vL = this.ctx.createGain(); vL.gain.value = 0.95;
      const vR = this.ctx.createGain(); vR.gain.value = -0.95;
      const vSum = this.ctx.createGain();
      const vLow = this.ctx.createBiquadFilter(); vLow.type = 'lowpass'; vLow.frequency.value = 180;
      // 混响
      this.rvDry = this.ctx.createGain(); this.rvWet = this.ctx.createGain();
      this.rvConv = this.ctx.createConvolver();
      // 连接
      let head = this.src;
      head.connect(subHP); head = subHP;
      /* 超低频增强（55Hz lowshelf）：补足小音箱/手机喇叭听不到的次低频 */
      this.subN = this.ctx.createBiquadFilter(); this.subN.type = 'lowshelf'; this.subN.frequency.value = 55; this.subN.gain.value = 0;
      head.connect(this.subN); head = this.subN;
      this.bands.forEach(b => { head.connect(b); head = b; });
      /* 空气感（14kHz highshelf）：高频延伸，人声更通透 */
      this.airN = this.ctx.createBiquadFilter(); this.airN.type = 'highshelf'; this.airN.frequency.value = 14000; this.airN.gain.value = 0;
      head.connect(this.bassN); this.bassN.connect(this.trebleN); this.trebleN.connect(this.airN);
      const panIn = this.pan || this.airN;
      if (this.pan) this.airN.connect(this.pan);
      panIn.connect(this.vcDry); panIn.connect(vSplit); panIn.connect(vLow);
      vSplit.connect(vL, 0); vSplit.connect(vR, 1);
      vL.connect(vSum); vR.connect(vSum);
      vSum.connect(this.vcWet); vLow.connect(this.vcWet);
      this.vcDry.connect(this.rvDry); this.vcWet.connect(this.rvDry);
      this.vcDry.connect(this.rvConv); this.vcWet.connect(this.rvConv);
      this.rvConv.connect(this.rvWet); // 原来漏了这根线：混响wet输出悬空，所有混响预设等于没开
      this.rvDry.connect(this.out = this.ctx.createGain());
      this.rvWet.connect(this.out);
      /* 末级限幅器：EQ/音量增益叠上去后极易削波，数字过载听起来就是"电磁声/破音" */
      this.lim = this.ctx.createDynamicsCompressor();
      this.lim.threshold.value = -1.5; this.lim.knee.value = 0; this.lim.ratio.value = 20;
      this.lim.attack.value = 0.003; this.lim.release.value = 0.12;
      /* 响度归一化：慢速电平器，把忽大忽小的歌拉平（听歌不手动调音量） */
      this.normC = this.ctx.createDynamicsCompressor();
      this.normC.threshold.value = -20; this.normC.knee.value = 18; this.normC.ratio.value = 1;
      this.normC.attack.value = 0.28; this.normC.release.value = 1.1;
      this.out.connect(this.trim);
      this.trim.connect(this.normC);
      this.normC.connect(this.comp);
      this.comp.connect(this.lim);
      this.lim.connect(this.ctx.destination);
      /* 输出电平表：用于检测"跨域音源被Chromium静音"（建图后无声的根因）
         接在限幅器之后 = 量的是真正送到扬声器的信号 */
      try { this.meter = this.ctx.createAnalyser(); this.meter.fftSize = 1024; this.lim.connect(this.meter); } catch (e) { }
      this.built = true;
      /* 恢复上次的混响（IR只在setReverb里生成，不恢复则混响预设形同虚设） */
      if (this.state.reverb && this.state.reverb !== 'off') this.setReverb(this.state.reverb);
      this.apply();
      this.resume(); // Android WebView 新建的AudioContext默认suspended → 不resume就是"进度在走没声音"
      return true;
    } catch (e) {
      /* 建图半途失败：mediaElementSource 已经接管了输出，必须直连destination兜底，
         否则音频元素永远不会再发声 */
      try {
        if (this.src) { this.src.disconnect(); this.src.connect(this.ctx.destination); }
        this.built = false;
        this.apply = function () { };
      } catch (e2) { }
      return false;
    }
  },
  _makeIR(seconds, decay, preMs) {
    const rate = this.ctx.sampleRate;
    const pre = preMs ? Math.floor(rate * preMs / 1000) : 0;
    const len = Math.max(64, Math.floor(rate * seconds) + pre);
    const ir = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < pre; i++) d[i] = 0; // 预延迟静音
      /* v2：指数衰减噪声尾——比线性幂衰减顺滑，去掉"沙沙"毛刺感 */
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / (len - pre);
        d[i] = (Math.random() * 2 - 1) * Math.exp(-3.2 * t) * Math.pow(1 - t, decay * 0.4);
      }
    }
    /* v2：早期反射簇（10~45ms 的6个离散反射）→ 真实房间的空间定位感 */
    for (let k = 0; k < 6; k++) {
      const pos = pre + Math.floor(rate * (0.008 + k * 0.006 + Math.random() * 0.004));
      const amp = 0.5 * Math.pow(0.6, k);
      if (pos < len - 2) {
        ir.getChannelData(k % 2)[pos] += amp;
        ir.getChannelData((k + 1) % 2)[pos + Math.floor(rate * 0.0009)] += amp * 0.75;
      }
    }
    return ir;
  },
  apply() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, st = this.state;
    try {
      this.bands.forEach((b, i) => b.gain.setTargetAtTime(st.bands ? (st.bands[i] || 0) : 0, t, 0.05));
      this.bassN.gain.setTargetAtTime(st.bass || 0, t, 0.05);
      this.trebleN.gain.setTargetAtTime(st.treble || 0, t, 0.05);
      if (this.lfoGain) this.lfoGain.gain.setTargetAtTime(st.space3d ? 0.85 : 0, t, 0.15);
      if (this.lfo) this.lfo.frequency.setTargetAtTime(st.space3dRate || 0.15, t, 0.1);
      if (this.wSide) this.wSide.gain.setTargetAtTime(Math.max(0, Math.min(3, st.width || 1)), t, 0.08);
      /* v3：交叉馈送/低频单声道/谐波激励 参数 */
      if (this.cfXL) this.cfXL.gain.setTargetAtTime(st.crossfeed ? -0.3 : 0, t, 0.08);
      if (this.cfXR) this.cfXR.gain.setTargetAtTime(st.crossfeed ? -0.3 : 0, t, 0.08);
      if (this.bmSum) this.bmSum.gain.setTargetAtTime(st.bassMono ? 0.5 : 0, t, 0.08);
      if (this.exGain) this.exGain.gain.setTargetAtTime(st.exciter ? 0.15 : 0, t, 0.08);
      if (this.comp) {
        const on = !!st.comp;
        this.comp.ratio.setTargetAtTime(on ? 4 : 1, t, 0.1);
        this.comp.threshold.setTargetAtTime(on ? -22 : 0, t, 0.1);
        this.comp.knee.setTargetAtTime(on ? 26 : 0, t, 0.1);
      }
      if (this.subN) this.subN.gain.setTargetAtTime(st.subBass ? 6 : 0, t, 0.06);
      if (this.airN) this.airN.gain.setTargetAtTime(st.air ? 5 : 0, t, 0.06);
      if (this.normC) {
        const nOn = !!st.norm;
        this.normC.ratio.setTargetAtTime(nOn ? 2.4 : 1, t, 0.12);
        this.normC.threshold.setTargetAtTime(nOn ? -20 : 0, t, 0.12);
        this.normC.knee.setTargetAtTime(nOn ? 18 : 0, t, 0.12);
      }
      if (this.trim) this.trim.gain.setTargetAtTime(Math.min(2.2, 1 + Math.max(0, st.gain || 0) / 10 + (st.comp ? 0.18 : 0)), t, 0.08);
      if (this.vcDry) {
        this.vcDry.gain.setTargetAtTime(st.vocalCut ? 0 : 1, t, 0.06);
        this.vcWet.gain.setTargetAtTime(st.vocalCut ? 1 : 0, t, 0.06);
      }
      const mix = st.reverb === 'off' ? 0 : (st.rvMix !== undefined ? st.rvMix : 0.35);
      if (this.rvDry) this.rvDry.gain.setTargetAtTime(st.reverb === 'off' ? 1 : Math.max(0.45, 1 - mix * 0.5), t, 0.08);
      if (this.rvWet) this.rvWet.gain.setTargetAtTime(mix * 1.15, t, 0.08);
    } catch (e) { }
  },
  setReverb(name) {
    if (name !== 'off' && !FX_REVERBS[name]) name = 'off';
    this.state.reverb = name;
    if (this.rvConv && name !== 'off') {
      const spec = { room: [0.55, 3.6, 12], studio: [0.26, 5.0, 4], hall: [1.9, 2.8, 24], church: [3.4, 2.2, 36] }[name];
      try { this.rvConv.buffer = this._makeIR(spec[0], spec[1], spec[2]); } catch (e) { }
    }
    this.apply(); this.save();
  },
  preset(name) {
    const p = FX_PRESETS[name];
    if (!p) return;
    this.state.preset = name;
    this.state.bands = p.g.slice();
    this.state.bass = p.bass || 0;
    this.state.treble = p.treble || 0;
    if (p.rvMix !== undefined) this.state.rvMix = p.rvMix;
    this.state.space3d = !!p.space3d;
    if (p.space3dRate) this.state.space3dRate = p.space3dRate;
    this.state.vocalCut = !!p.vocal;
    this.state.width = p.width || 1;
    this.state.comp = !!p.comp;
    this.state.gain = p.gain || 0;
    this.state.subBass = !!p.subBass;
    this.state.air = !!p.air;
    this.state.norm = !!p.norm;
    this.setReverb(p.reverb || 'off');
    /* 选中非「平直」预设：先探测引擎可用再建图（建不起来就保持直通） */
    if (this.needsFx()) {
      this.prepare().then(ok => { if (ok && this.ensure()) { this.apply(); this.resume(); } });
    }
    this.apply(); this.save();
  },
  /* 拆掉整张音频图：音频元素一旦被MediaElementSource接管就无法恢复直通，
     所以自愈时连元素一起换（见 healSilentAudio） */
  reset() {
    try { if (this.src) this.src.disconnect(); } catch (e) { }
    try { if (this.out) this.out.disconnect(); } catch (e) { }
    try { if (this.meter) this.meter.disconnect(); } catch (e) { }
    try { if (this.ctx) this.ctx.close(); } catch (e) { }
    this.ctx = null; this.src = null; this.out = null; this.meter = null;
    this.bands = []; this.bassN = null; this.trebleN = null; this.pan = null;
    this.lfo = null; this.lfoGain = null; this.vcDry = null; this.vcWet = null;
    this.rvDry = null; this.rvWet = null; this.rvConv = null;
    this.lim = null; this.trim = null; this.comp = null;
    this.subN = null; this.airN = null; this.normC = null;
    this.built = false; this._silentTicks = 0;
  },
  /* 声音自检：独立的WebAudio测试音（不经过歌曲链路），区分"设备没声"和"播放器没声" */
  async testTone() {
    try {
      if (!this._ctxOnly()) { toast('这台设备不支持WebAudio，无法自检'); return; }
      await this.resume();
      if (this.ctx.state !== 'running') { toast('音频引擎起不来：多半是系统音量/静音键，或WebView限制'); return; }
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = 660;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.28, t + 0.05);
      g.gain.setValueAtTime(0.28, t + 2.4);
      g.gain.linearRampToValueAtTime(0, t + 2.8);
      osc.connect(g); g.connect(this.ctx.destination);
      osc.start(t); osc.stop(t + 2.9);
      toast('🔊 正在播放测试音，请留意有没有「嘀——」');
      return true;
    } catch (e) { toast('自检失败: ' + e.message); return false; }
  },
  ready: false
};

/* ---------- 播放页实时频谱可视化 ----------
   有音效图时用真实FFT（PFX.meter）；没有时用"律动合成"（按播放进度生成伪频谱）。
   绝不为了可视化去建音频图——建图=永久接管音频输出，没声音风险太高。 */
/* 从封面取色的色相生成光效配色（与PC端 vfxPalette 同款） */
function hsl2rgb(h, s, l) {
  const f = n => { const k = (n + h / 30) % 12; const a2 = s * Math.min(l, 1 - l); return Math.round(255 * (l - a2 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}
function vfxPalette(accent) {
  const r = accent[0] / 255, g = accent[1] / 255, b = accent[2] / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const l0 = (mx + mn) / 2;
  let h = 0, s = d === 0 ? 0 : d / (1 - Math.abs(2 * l0 - 1));
  if (d !== 0) {
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  if (s < 0.12) { h = 342; s = 0.72; }
  const s2 = Math.min(1, Math.max(0.4, s * 1.15));
  const l2 = Math.min(0.6, Math.max(0.42, l0));
  const mk = (dh, dl, ds) => hsl2rgb((h + dh + 360) % 360, Math.min(1, s2 * ds), Math.min(0.82, Math.max(0.42, l2 * dl)));
  return [mk(0, 1, 1), mk(14, 0.94, 1.08), mk(-18, 0.88, 0.86), mk(38, 1.06, 1.12), mk(8, 0.68, 1.3), mk(24, 1.12, 0.8)];
}
const NViz = {
  raf: 0, canvas: null, ctx: null, cols: [], t: 0, buf: null,
  accent: [251, 114, 153], N: 56, enabled: true,
  KEY: 'bp.vizOn',
  init() {
    try { this.enabled = localStorage.getItem(this.KEY) !== '0'; } catch (e) { }
    this.canvas = $('np-viz');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    if (!this.cols.length) this.cols = new Array(this.N).fill(0);
    this.applyEnabled();
    this.loop();
  },
  applyEnabled() {
    if (this.canvas) this.canvas.classList.toggle('off', !this.enabled);
    if (!this.enabled) this.stop(); else this.loop();
  },
  setEnabled(on) {
    this.enabled = !!on;
    try { localStorage.setItem(this.KEY, on ? '1' : '0'); } catch (e) { }
    this.applyEnabled();
  },
  refreshAccent() {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--np-accent').trim();
      let mm = v.match(/rgba?\((\d+)\D+(\d+)\D+(\d+)/);
      if (!mm) mm = v.match(/^#([0-9a-f]{6})$/i);
      if (mm && mm[1].length === 6) {
        const hx = mm[1];
        this.accent = [parseInt(hx.slice(0, 2), 16), parseInt(hx.slice(2, 4), 16), parseInt(hx.slice(4, 6), 16)];
      } else if (mm) {
        this.accent = [+mm[1], +mm[2], +mm[3]];
      } else {
        this.accent = [251, 114, 153]; // 品牌粉兜底
      }
      /* 换歌重染光效：清除签名让 _drawVfx 重建精灵 */
      if (this._vfx) this._vfxSig = '';
    } catch (e) { }
  },
  loop() {
    if (this.raf || !this.enabled) return;
    const step = () => { try { this.draw(); } catch (e) { } this.raf = requestAnimationFrame(step); };
    this.raf = requestAnimationFrame(step);
  },
  stop() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; } },
  draw() {
    const c = this.canvas, g = this.ctx;
    if (!c || !g) return;
    const pg = document.getElementById('pg-player');
    if (!pg || pg.classList.contains('hidden')) return; // 不在播放页不画（省电）
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    this.t += 0.016;
    /* 取真实频谱 */
    let real = null;
    try {
      if (PFX && PFX.meter && PFX.built) {
        if (!this.buf || this.buf.length !== PFX.meter.frequencyBinCount) this.buf = new Uint8Array(PFX.meter.frequencyBinCount);
        PFX.meter.getByteFrequencyData(this.buf);
        real = this.buf;
      }
    } catch (e) { real = null; }
    const playing = !document.body.classList.contains('paused');
    /* 节拍能量（低频均值→平滑），粒子尺寸随鼓点放大 */
    let lowSum = 0, lowCnt = 0;
    if (real) { for (let i = 0; i < 6; i++) { lowSum += real[i] || 0; lowCnt++; } }
    const lowN = lowCnt ? (lowSum / lowCnt) / 235 : 0;
    const tgt = Math.max(0, Math.min(1, (lowN - 0.2) * 1.8));
    this._beat = (this._beat || 0) + (tgt - (this._beat || 0)) * (tgt > (this._beat || 0) ? 0.45 : 0.14);
    const N = this.N;
    for (let i = 0; i < N; i++) {
      let v;
      if (real) {
        const bins = real.length;
        const lo = Math.floor(Math.pow(i / N, 1.45) * bins * 0.62);
        const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / N, 1.45) * bins * 0.62));
        let sum = 0, cnt = 0;
        for (let k = lo; k < hi && k < bins; k++) { sum += real[k]; cnt++; }
        v = cnt ? (sum / cnt) / 235 : 0;
      } else {
        /* 律动合成：多正弦叠加 + 播放进度驱动，视觉上接近真实频谱 */
        const tt = (LA.currentTime || 0) + this.t * 0.5;
        v = 0.18 + 0.30 * Math.abs(Math.sin(tt * 2.3 + i * 0.42)) + 0.14 * Math.abs(Math.sin(tt * 4.7 + i * 0.9));
        v *= (0.62 + 0.38 * Math.sin(tt * 0.7 + i * 0.21));
        v = Math.max(0.05, v);
      }
      if (!playing) v *= 0.3;
      const cur = this.cols[i] || 0;
      this.cols[i] = cur + (v - cur) * (v > cur ? 0.45 : 0.12);
    }
    /* 绘制底部对称频谱条 + 顶部亮点 */
    const ac = this.accent, r = ac[0], gg = ac[1], b = ac[2];
    const bw = w / N;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < N; i++) {
      const amp = Math.min(1, this.cols[i] || 0);
      const bh = amp * h * 0.40;
      if (bh < 1) continue;
      const x = i * bw;
      const grad = g.createLinearGradient(0, h, 0, h - bh);
      grad.addColorStop(0, 'rgba(' + r + ',' + gg + ',' + b + ',.04)');
      grad.addColorStop(0.45, 'rgba(' + r + ',' + gg + ',' + b + ',.34)');
      grad.addColorStop(1, 'rgba(' + Math.min(255, r + 70) + ',' + Math.min(255, gg + 55) + ',' + Math.min(255, b + 70) + ',.66)');
      g.fillStyle = grad;
      const pad = Math.max(1, bw * 0.24);
      g.fillRect(x + pad, h - bh, Math.max(1.4, bw - pad * 2), bh);
      g.fillStyle = 'rgba(255,255,255,' + (0.30 * amp) + ')';
      g.fillRect(x + pad, h - bh, Math.max(1.4, bw - pad * 2), 1.5);
    }
    g.restore();
    this._drawVfx(g, w, h, playing, this._beat || 0);
  },
  /* ===== 华丽光效层：金色光斑/弧形光带/星芒/花瓣/余烬（暖金调，随封面取色+节拍） ===== */
  _vfxN: { bokeh: 10, streak: 5, spark: 8, petal: 8, ember: 12 },
  _vfx: null,
  _vfxSig: '',
  _vfxInit() {
    const acc = this.accent;
    const pal = vfxPalette(acc);
    const spr = (w, h, fn) => { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); return c; };
    const bokehS = pal.map(c => spr(160, 160, (g) => {
      const gr = g.createRadialGradient(80, 80, 0, 80, 80, 80);
      gr.addColorStop(0, 'rgba(' + c.join(',') + ',.85)');
      gr.addColorStop(0.35, 'rgba(' + c.join(',') + ',.36)');
      gr.addColorStop(1, 'rgba(' + c.join(',') + ',0)');
      g.fillStyle = gr; g.fillRect(0, 0, 160, 160);
    }));
    const sparkS = pal.map(c => spr(120, 120, (g) => {
      const cx = 60, cy = 60;
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 14);
      gr.addColorStop(0, 'rgba(255,255,255,.95)');
      gr.addColorStop(0.5, 'rgba(' + c.join(',') + ',.55)');
      gr.addColorStop(1, 'rgba(' + c.join(',') + ',0)');
      g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, 14, 0, 6.3); g.fill();
      g.lineCap = 'round';
      for (let k = 0; k < 4; k++) {
        const ang = k * Math.PI / 2 + 0.4;
        const len = k % 2 ? 34 : 52;
        const gr2 = g.createLinearGradient(cx, cy, cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
        gr2.addColorStop(0, 'rgba(255,255,255,.9)');
        gr2.addColorStop(1, 'rgba(' + c.join(',') + ',0)');
        g.strokeStyle = gr2; g.lineWidth = 2.4;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len); g.stroke();
      }
    }));
    const petalS = pal.map(c => spr(48, 48, (g) => {
      g.translate(24, 24);
      const gr = g.createLinearGradient(-12, -12, 12, 12);
      gr.addColorStop(0, 'rgba(255,255,255,.85)');
      gr.addColorStop(1, 'rgba(' + c.join(',') + ',.8)');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(0, 0, 11, 6.5, -0.5, 0, Math.PI * 2); g.fill();
    }));
    const streakS = [0, 1, 2].map(i => spr(360, 120, (g) => {
      const c = pal[(i * 2 + 1) % pal.length];
      g.lineCap = 'round';
      for (let L = 0; L < 3; L++) {
        g.strokeStyle = 'rgba(' + c.join(',') + ',' + (L === 2 ? .5 : .16) + ')';
        g.lineWidth = L === 2 ? 5 : 16 - L * 5;
        g.beginPath(); g.moveTo(10, 80 - i * 8);
        g.bezierCurveTo(110, 20 - i * 10, 230, 105 - i * 6, 350, 42);
        g.stroke();
      }
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(10, 80 - i * 8);
      g.bezierCurveTo(110, 20 - i * 10, 230, 105 - i * 6, 350, 42);
      g.stroke();
    }));
    this._vfx = {
      pal, bokehS, sparkS, petalS, streakS,
      bokeh: [], streak: [], spark: [], petal: [], ember: []
    };
    const ri = n => Math.floor(Math.random() * n);
    const N = this._vfxN;
    for (let i = 0; i < N.bokeh; i++) this._vfx.bokeh.push({ x: Math.random(), y: Math.random(), s: 0.10 + Math.random() * 0.30, a: 0.25 + Math.random() * 0.4, vy: 0.00006 + Math.random() * 0.00022, vx: (Math.random() - .5) * 0.00012, ph: Math.random() * 6.28, si: ri(bokehS.length) });
    for (let i = 0; i < N.streak; i++) this._vfx.streak.push({ x: Math.random(), y: 0.12 + Math.random() * 0.7, s: 0.5 + Math.random() * 0.7, ang: (-14 + Math.random() * 10) * Math.PI / 180, a: 0.12 + Math.random() * 0.22, rot: (Math.random() - .5) * 0.0007, ph: Math.random() * 6.28, si: ri(streakS.length) });
    for (let i = 0; i < N.spark; i++) this._vfx.spark.push({ x: Math.random(), y: Math.random() * 0.85, p: Math.random(), dur: 0.9 + Math.random() * 1.1, s: 0.35 + Math.random() * 0.75, si: ri(sparkS.length) });
    for (let i = 0; i < N.petal; i++) this._vfx.petal.push({ x: Math.random(), y: Math.random(), rot: Math.random() * 6.28, rv: (Math.random() - .5) * 0.0012, vy: 0.00022 + Math.random() * 0.0003, vx: 0.00005 + Math.random() * 0.00016, s: 0.5 + Math.random() * 0.7, si: ri(petalS.length) });
    for (let i = 0; i < N.ember; i++) this._vfx.ember.push({ x: Math.random(), y: 0.4 + Math.random() * 0.62, r: 0.9 + Math.random() * 1.6, vy: 0.00035 + Math.random() * 0.0007, vx: (Math.random() - .5) * 0.0002, ph: Math.random() * 6.28 });
  },
  _drawVfx(g, w, h, playing, beat) {
    const sig = this.accent.join(',');
    if (!this._vfx || this._vfxSig !== sig) { this._vfxSig = sig; this._vfxInit(); }
    const V = this._vfx;
    const dt = 0.016;
    const dim = playing ? 1 : 0.35;
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const b of V.bokeh) {
      b.y -= b.vy * dt; b.x += b.vx * dt; b.ph += 0.014;
      if (b.y < -0.12) { b.y = 1.12; b.x = Math.random(); }
      const al = b.a * (0.6 + 0.4 * Math.sin(b.ph)) * dim;
      const size = b.s * h * (1 + beat * 0.25);
      g.globalAlpha = Math.min(1, al);
      g.drawImage(V.bokehS[b.si % V.bokehS.length], b.x * w - size / 2, b.y * h - size / 2, size, size);
    }
    for (const s of V.streak) {
      s.ph += 0.01; s.ang += s.rot;
      if (s.ph > 6.28) s.ph -= 6.28;
      const al = s.a * (0.45 + 0.55 * Math.sin(s.ph)) * dim * (0.7 + beat * 0.6);
      const lw = s.s * w, lh = s.s * h * 0.5;
      g.globalAlpha = Math.min(1, al);
      g.translate(s.x * w, s.y * h); g.rotate(s.ang);
      g.drawImage(V.streakS[s.si % V.streakS.length], -lw / 2, -lh / 2, lw, lh);
      g.rotate(-s.ang); g.translate(-s.x * w, -s.y * h);
    }
    for (const s of V.spark) {
      s.p += dt / s.dur;
      if (s.p >= 1) { s.p = 0; s.x = Math.random(); s.y = Math.random() * 0.85; s.dur = 0.9 + Math.random() * 1.1; }
      const k = Math.sin(s.p * Math.PI);
      const al = k * (playing ? 0.9 : 0.3);
      const size = s.s * (h * 0.09) * (0.7 + beat * 0.8);
      g.globalAlpha = Math.min(1, al);
      g.drawImage(V.sparkS[s.si % V.sparkS.length], s.x * w - size / 2, s.y * h - size / 2, size, size);
    }
    for (const p of V.petal) {
      p.y += p.vy * dt; p.x += p.vx * dt + Math.sin(p.y * 9) * 0.0002; p.rot += p.rv;
      if (p.y > 1.1) { p.y = -0.1; p.x = Math.random(); }
      const al = 0.55 * dim;
      const size = p.s * h * 0.055;
      g.globalAlpha = Math.min(1, al);
      g.translate(p.x * w, p.y * h); g.rotate(p.rot);
      g.drawImage(V.petalS[p.si % V.petalS.length], -size / 2, -size / 2, size, size);
      g.rotate(-p.rot); g.translate(-p.x * w, -p.y * h);
    }
    for (const e of V.ember) {
      e.y -= e.vy * dt; e.x += e.vx * dt; e.ph += 0.06;
      if (e.y < 0.1) { e.y = 1.05; e.x = Math.random(); }
      const al = (0.35 + 0.5 * Math.abs(Math.sin(e.ph))) * dim;
      g.globalAlpha = Math.min(1, al);
      g.fillStyle = 'rgba(255,220,150,.9)';
      g.beginPath(); g.arc(e.x * w, e.y * h, e.r * (1 + beat * 0.5), 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }
};

/* ---------- 音效页（手机一键切电脑音效） ---------- */
const FX_LIST = {
  off: '平直（关闭）', sbass: '超重低音', vocalc: '清澈人声', female: '温柔女声', male: '浑厚男声',
  pure: '超纯净人声', ethereal: '空灵韵', liyin3d: '3D丽音', pano: '全景环绕', dolby: '全景声模拟',
  stereo: '立体声宽', earbuds: '悦耳耳机', hall: '音乐厅', plaza: '音乐广场', live: '演唱会',
  chicago: '芝加哥剧院', musical: '音乐剧', karaoke: 'K歌跟唱', phone: '电话音', vinylfx: '黑胶复古',
  cozy: '温馨卧室', midnight: '午夜慵懒', street: '漫步街头', smart: '智能动态', rhythm: '悦动节奏',
  heartbeat: '心跳节奏', anime: '二次元提亮', game: '游戏沉浸', studio: '录音棚',
  rich: '醇厚人声', punch: '冲击力', crystal: '水晶通透', cinema: '影院环绕',
  galaxy: '银河幻境', spatial: '空间音频', warmtube: '温暖电子管', nightcore: '夜核加速',
  bassboost: '低音炮', concert: '现场音乐会'
};
const FX_ORDER = Object.keys(FX_LIST);
const FX_EQ = { pop: '流行', rock: '摇滚', edm: '电子', jazz: '爵士', classical: '古典', bright: '高音增强' };
function renderFx() {
  try { const ei = document.getElementById("fx-engine-info"); if (ei) { const c = PFX.ctx; ei.textContent = "音频引擎：" + (c ? (c.state + " · 采样率 " + Math.round(c.sampleRate / 1000) + "kHz · 缓冲延迟 ~" + Math.round(((c.baseLatency || 0) * 1000)) + "ms") : "直通模式（未开音效，音质更稳）") + (audioTag ? " · 音源：" + audioTag : ""); } } catch (e) { }
  const fx = (STANDALONE || localMode) ? PFX.state : ((lastState && lastState.fx) || {});
  const stPreset = fx.preset || 'off';
  const curName = (FX_PRESETS[stPreset] && FX_PRESETS[stPreset].label) || FX_LIST[stPreset] || FX_EQ[stPreset] || stPreset;
  $('fx-cur').textContent = '当前：' + curName;
  $('fx-presets').innerHTML = FX_ORDER.map(k => `<button class="fx-chip ${stPreset === k ? 'active' : ''}" data-p="${k}">${esc((FX_PRESETS[k] && FX_PRESETS[k].label) || FX_LIST[k] || k)}</button>`).join('');
  $('fx-eqs').innerHTML = Object.entries(FX_EQ).map(([k, label]) => `<button class="fx-chip ${stPreset === k ? 'active' : ''}" data-p="${k}">${esc(label)}</button>`).join('');
  $('fx-3d').classList.toggle('on', !!fx.space3d);
  $('fx-vocal').classList.toggle('on', !!fx.vocalCut);
  try { const v = document.getElementById('fx-viz'); if (v) v.classList.toggle('on', !!(NViz && NViz.enabled)); } catch (e) { }
  try { const sb = document.getElementById('fx-sub'); if (sb) sb.classList.toggle('on', !!fx.subBass); } catch (e) { }
  try { const ar = document.getElementById('fx-air'); if (ar) ar.classList.toggle('on', !!fx.air); } catch (e) { }
  try { const nm = document.getElementById('fx-norm'); if (nm) nm.classList.toggle('on', !!fx.norm); } catch (e) { }
  /* QQ音质偏好状态 */
  try {
    const qq = localStorage.getItem('bp.qqQual') || 'auto';
    const qa = document.getElementById('qqq-auto'), qh = document.getElementById('qqq-high'), qs = document.getElementById('qqq-save');
    if (qa) qa.classList.toggle('on', qq === 'auto');
    if (qh) qh.classList.toggle('on', qq === 'high');
    if (qs) qs.classList.toggle('on', qq === 'save');
  } catch (e) { }
  /* 七段均衡器：仅本机/独立模式渲染（遥控模式 EQ 由电脑端调节） */
  try {
    const row = document.getElementById('fx-eqrow');
    if (row) {
      const isLocal = STANDALONE || localMode;
      if (!isLocal) { row.innerHTML = '<div class="empty-tip" style="font-size:12px;color:#8a8d97">遥控模式：均衡器请到电脑端「音效设置」调节</div>'; }
      else {
        const bands = [60, 150, 400, 1000, 2400, 6000, 12000];
        const labels = ['60Hz', '150Hz', '400Hz', '1kHz', '2.4kHz', '6kHz', '12kHz'];
        const cur = (fx.bands || []);
        row.innerHTML = bands.map((f, i) => {
          const v = cur[i] || 0;
          return '<div class="eq-row"><span class="eq-f">' + labels[i] + '</span>' +
            '<input type="range" min="-12" max="12" step="1" value="' + v + '" data-bi="' + i + '">' +
            '<em class="' + (v > 0 ? 'pos' : '') + '">' + (v > 0 ? '+' : '') + v + 'dB</em></div>';
        }).join('');
      }
    }
  } catch (e) { }
}
/* （重复的 renderFx 已合并到上方定义） */

/* ---------- 曲库页（收藏夹 / QQ·网易云歌单 / 搜索） ---------- */
const libCache = { favs: null, qq: null, ne: null, wl: null, at: 0, TTL: 300000 };
async function jget(path) {
  /* 非本机访问服务端API需配对码（局域网安全），本机自动忽略 */
  const url = path + (path.includes('?') ? '&' : '?') + 'pin=' + encodeURIComponent(PIN || '');
  const r = await fetch(url);
  const j = await r.json();
  if (!j || !j.ok) throw new Error((j && j.message) || '请求失败');
  return j.data;
}
function libTip(id, text) { $(id).textContent = text || ''; }

/* ---------- QQ音乐播放链路一键诊断：登录→账号→歌单→详情→直链→试播 ---------- */
async function qqSelfTest() {
  const lines = [];
  const add = (s, ok) => lines.push({ s, ok });
  try {
    add('① Cookie登录态: ' + (QQSA.ready ? '有效（uin=' + QQSA.uin + '）' : '无效'), QQSA.ready);
    if (!QQSA.ready) {
      const ok2 = await QQSA.init();
      add('①b 重读Cookie: ' + (ok2 ? '有效' : '仍无效 —— 请先登录'), ok2);
      if (!ok2) return lines;
    }
    const prof = await QQSA.profile().catch(() => null);
    add('② 账号: ' + (prof && prof.name ? prof.name : '未知'), !!(prof && prof.name && prof.name.indexOf('QQ用户') !== 0));
    const pls = await QQSA.playlists();
    add('③ 歌单数: ' + pls.length, pls.length > 0);
    if (!pls.length) return lines;
    const first = pls.find(p => p.trackCount > 0) || pls[0];
    add('④ 打开「' + (first.name || '').slice(0, 10) + '」…', true);
    const head = await QQSA.detailFirst(first.id);
    add('④ 歌曲数: ' + head.tracks.length + (head.total ? ' / ' + head.total : ''), head.tracks.length > 0);
    if (!head.tracks.length) return lines;
    const t0 = head.tracks.find(t => !t.vip) || head.tracks[0];
    add('⑤ 试解析「' + (t0.title || '').slice(0, 14) + '」' + (t0.vip ? '（VIP歌曲）' : ''), true);
    const v = await QQSA.songUrl(t0.qmid, t0.mediaMid);
    if (!v || !v.url) {
      add('⑥ 直链: 失败 code=' + (v ? v.code : '超时') + (v && v.needbuy ? ' · 需要VIP' : ''), false);
      return lines;
    }
    add('⑥ 直链: ' + v.url.replace(/^https?:\/\//, '').slice(0, 44) + '…', true);
    const la = new Audio();
    la.src = v.url;
    const okPlay = await new Promise(res => {
      const good = () => res(true);
      const bad = () => res(false);
      la.addEventListener('canplay', good, { once: true });
      la.addEventListener('error', bad, { once: true });
      la.play().catch(bad);
      setTimeout(() => res(false), 9000);
    });
    try { la.pause(); la.removeAttribute('src'); } catch (e) { }
    add('⑦ 试播: ' + (okPlay ? '成功 —— 点歌即可正常播放 ✓' : '失败（CDN连接/编码问题）'), okPlay);
    if (!okPlay) {
      try {
        const nr = await window.bHttp('HEAD', v.url, '', 12000);
        let host = '';
        try { host = new URL(v.url).host; } catch (e) { }
        const hint = nr.code === 403 ? '（Referer被拒）' : nr.code === 404 ? '（直链已失效）' : nr.code === 200 ? '（能连通，播放器问题）' : '';
        add('⑧ CDN探测: HTTP ' + nr.code + ' @ ' + host + hint, nr.code === 200 || nr.code === 206);
      } catch (e) {
        add('⑧ CDN探测异常: ' + (e.message || e), false);
      }
    }
  } catch (e) {
    add('异常: ' + (e.message || String(e)), false);
  }
  return lines;
}
function showQqDiag() { showDiag('qq'); }
async function biliSelfTest() {
  const lines = [];
  const add = (s, ok) => lines.push({ s, ok });
  try {
    const okInit = await BLSA.init();
    add('① Cookie登录态: ' + (okInit ? '有效' : '未登录（游客模式，收藏夹需登录）'), true);
    const nav = await BLSA.nav().catch(e => ({ err: e.message || String(e) }));
    add('② nav接口: ' + (nav && nav.mid ? 'mid=' + nav.mid : '失败 ' + (nav && nav.err || '')), !!(nav && nav.mid));
    if (!(nav && nav.mid)) return lines;
    const favs = await BLSA.favFolders().catch(e => ({ err: e.message || String(e) }));
    if (favs && favs.err !== undefined) { add('③ 收藏夹: 失败 ' + favs.err, false); return lines; }
    add('③ 收藏夹数: ' + favs.length, favs.length > 0);
    if (!favs.length) return lines;
    const f0 = favs[0];
    const fl = await BLSA.favList(f0.id, 1);
    add('④ 「' + (f0.title || '').slice(0, 10) + '」视频数: ' + fl.items.length, fl.items.length > 0);
    if (!fl.items.length) return lines;
    const v0 = fl.items[0];
    add('⑤ 试解析「' + (v0.title || '').slice(0, 14) + '」', true);
    const r = await BLSA.resolve(v0.bvid).catch(e => ({ err: e.message || String(e) }));
    if (!r || !r.u) { add('⑥ 直链: 失败 ' + (r && r.err || ''), false); return lines; }
    add('⑥ 直链: ' + r.u.replace(/^https?:\/\//, '').slice(0, 44) + '…', true);
    const la = new Audio();
    la.src = r.u;
    const okPlay = await new Promise(res => {
      const good = () => res(true);
      const bad = () => res(false);
      la.addEventListener('canplay', good, { once: true });
      la.addEventListener('error', bad, { once: true });
      la.play().catch(bad);
      setTimeout(() => res(false), 9000);
    });
    try { la.pause(); la.removeAttribute('src'); } catch (e) { }
    add('⑦ 试播: ' + (okPlay ? '成功 —— 点歌即可正常播放 ✓' : '失败（CDN连接问题，把此截图发我）'), okPlay);
    if (!okPlay) {
      /* 原生HEAD探测CDN真实状态（无CORS干扰）：403=Referer拒 · 404=直链失效 · 200=可达 */
      try {
        const nr = await window.bHttp('HEAD', r.u, '', 12000);
        let host = '';
        try { host = new URL(r.u).host; } catch (e) { }
        const code = nr.code;
        const hint = code === 403 ? '（Referer被拒）' : code === 404 ? '（直链已失效）' : code === 200 ? '（能连通，播放器问题）' : code === -1 ? '（网络不通）' : '';
        add('⑧ CDN探测: HTTP ' + code + ' @ ' + host + hint, code === 200 || code === 206);
      } catch (e) {
        add('⑧ CDN探测异常: ' + (e.message || e), false);
      }
    }
  } catch (e) {
    add('异常: ' + (e.message || String(e)), false);
  }
  return lines;
}
function showDiag(kind) {
  const old = document.getElementById('qq-diag-panel');
  if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.id = 'qq-diag-panel';
  wrap.innerHTML = '<div class="diag-box"><div class="diag-t">' + (kind === 'bili' ? 'B站' : 'QQ音乐') + '播放诊断</div><div id="diag-lines" class="diag-lines">诊断运行中…（约需3-8秒）</div><button class="btn primary diag-close" id="diag-close">关闭</button></div>';
  document.body.appendChild(wrap);
  document.getElementById('diag-close').addEventListener('click', () => wrap.remove());
  const runner = kind === 'bili' ? biliSelfTest() : qqSelfTest();
  runner.then(lines => {
    const el = document.getElementById('diag-lines');
    if (!el) return;
    el.innerHTML = lines.map(l => `<div class="diag-line ${l.ok ? 'ok' : 'bad'}">${l.ok ? '✓' : '✗'} ${esc(l.s)}</div>`).join('');
    if (!lines.some(l => !l.ok)) { const d = document.createElement('div'); d.className = 'diag-line ok'; d.textContent = '—— 全链路正常，若仍听不了请截图发我 ——'; el.appendChild(d); }
  });
}
function srcRow(it, i) {
  return `<div class="row" data-idx="${i}">
    ${it.pic ? `<img src="${esc(pic(it.pic))}" loading="lazy" decoding="async" onerror="this.outerHTML='<div class=\\'r-ico\\'>♪</div>'">` : '<div class="r-ico">♪</div>'}
    <div class="r-main"><div class="r-title">${esc(it.title)}</div><div class="r-sub">${esc(it.up || '')}</div></div>
    <button class="r-add" data-add="${i}" aria-label="加入本机歌单" style="flex:0 0 auto;background:none;border:0;color:#fb7299;font-size:26px;line-height:1;padding:6px 16px;min-width:52px;min-height:44px;cursor:pointer;touch-action:manipulation">＋</button>
    <span class="r-dur">${fmt(it.duration)}</span>
  </div>`;
}

/* ---------- 把任意一条/整个内容源导入本机歌单（独立模式，不依赖电脑） ---------- */
function localItemOf(it) {
  if (!it) return null;
  const o = { title: it.title, up: it.up, pic: it.pic, duration: it.duration };
  if (it.bvid) { o.bvid = it.bvid; if (it.pid) { o.pid = it.pid; o.cid = it.cid; } }
  if (it.qmid) { o.qmid = it.qmid; o.qmMediaMid = it.qmMediaMid || it.mediaMid || ''; }
  if (it.nid) o.nid = it.nid;
  return o;
}
/* 一键导入：和"加入当前歌曲"共用同一个歌单选择面板 */
function addItemsToLocalSheet(items, titleText) {
  items = (items || []).map(localItemOf).filter(Boolean);
  if (!items.length) return toast('没有可导入的歌曲');
  plsCache = QQSA.localPls();
  const rows = plsCache.map(p => ({
    label: '♫ ' + p.name + '（' + (p.items || []).length + '首）',
    fn: () => {
      let ok = 0, dup = 0;
      items.forEach(it => { const r = QQSA.localPlAdd(p.id, it); if (r === 'dup') dup++; else ok++; });
      plsCache = null;
      toast('导入「' + p.name + '」完成：+' + ok + ' 首' + (dup ? '（' + dup + ' 首已存在）' : ''));
      if (curTab === 'pls') renderPls();
    }
  }));
  rows.push({
    label: '＋ 新建歌单并导入', useInput: true, input: true, placeholder: '新歌单名称（共 ' + items.length + ' 首）', fn: v => {
      if (!v || !v.trim()) return;
      const pl = QQSA.localPlCreate(v.trim());
      let ok = 0;
      items.forEach(it => { if (QQSA.localPlAdd(pl.id, it) !== 'dup') ok++; });
      plsCache = null;
      toast('已新建「' + v.trim() + '」并导入 ' + ok + ' 首');
      if (curTab === 'pls') renderPls();
    }
  });
  showSheet(titleText || '导入本机歌单', rows);
}
async function renderLib() {
  /* 搜索历史 chips */
  try {
    const hist = JSON.parse(localStorage.getItem('bp.searchHist') || '[]');
    const histEl = $('lib-search-hist');
    if (histEl) {
      if (hist.length) {
        histEl.classList.remove('hidden');
        histEl.innerHTML = '<span class="fx-sec-sub" style="align-self:center">最近：</span>' + hist.map(h => `<button class="fx-chip" data-q="${esc(h)}">${esc(h)}</button>`).join('');
      } else histEl.classList.add('hidden');
    }
  } catch (e) { }
  if (Date.now() - libCache.at < 60000 && libCache.favs !== null) { renderLibLists(); return; }
  libTip('lib-bili-tip', '加载中…'); libTip('lib-qq-tip', '加载中…'); libTip('lib-ne-tip', '加载中…');
  const sk = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
  $('lib-favs').innerHTML = sk; $('lib-qq').innerHTML = sk; $('lib-ne').innerHTML = sk;
  const jobs = [];
  if (STANDALONE) {
    jobs.push(BLSA.init().then(ok => {
      try { window._favCountCache = JSON.parse(localStorage.getItem('bp.favCounts') || '{}'); } catch (e) { window._favCountCache = {}; }
      if (!ok) { libCache.favs = []; libTip('lib-bili-tip', '未登录B站'); return null; }
      return BLSA.favFolders().then(d => { libCache.favs = d; libTip('lib-bili-tip', ''); }).catch(e => { libCache.favs = []; libTip('lib-bili-tip', e.message); });
    }));
  } else {
    jobs.push(jget('/api/fav/folders').then(d => {
      libCache.favs = [].concat(d.created || [], d.collected || []);
      try {
        var fc = window._favCountCache || {};
        var nk = {};
        libCache.favs.forEach(function(f) {
          var k2 = 'f' + f.id;
          nk[k2] = f.count;
          if (fc[k2] !== undefined && f.count > fc[k2]) f._newCount = f.count - fc[k2];
        });
        localStorage.setItem('bp.favCounts', JSON.stringify(nk));
      } catch (e) { }
      libTip('lib-bili-tip', '');
    }).catch(e => { libCache.favs = []; libTip('lib-bili-tip', /登录/.test(e.message) ? '电脑未登录B站' : e.message); }));
  }
  if (STANDALONE) {
    jobs.push(QQSA.init().then(ok => {
      if (!ok) { libCache.qq = []; libTip('lib-qq-tip', '未登录QQ音乐'); return null; }
      else { libTip('lib-qq-tip', ''); }
      return QQSA.playlists().then(d => { libCache.qq = d; libTip('lib-qq-tip', ''); }).catch(e => { libCache.qq = []; libTip('lib-qq-tip', e.message); });
    }));
    /* 网易云（独立模式）：手机直连，登录拉歌单/未登录匿名可用 */
    jobs.push(NESA.init().then(ok => {
      if (!ok) { libCache.ne = []; libTip('lib-ne-tip', '未登录网易云'); return null; }
      return NESA.playlists(NESA.user.userId).then(d => {
        libCache.ne = d.filter(p => p.trackCount > 0);
        libTip('lib-ne-tip', NESA.user.name ? ('已登录 · ' + NESA.user.name) : '');
      }).catch(e => { libCache.ne = []; libTip('lib-ne-tip', e.message); });
    }));
  } else {
    jobs.push(jget('/api/qqplaylists').then(d => {
      libCache.qq = d.playlists || [];
      libTip('lib-qq-tip', '');
    }).catch(e => { libCache.qq = []; libTip('lib-qq-tip', /未登录/.test(e.message) ? '电脑未登录QQ音乐' : e.message); }));
    jobs.push(jget('/api/nplaylists').then(d => {
      libCache.ne = (d.playlists || []).filter(p => p.trackCount > 0);
      libTip('lib-ne-tip', '');
    }).catch(e => { libCache.ne = []; libTip('lib-ne-tip', /未登录/.test(e.message) ? '电脑未登录网易云' : e.message); }));
  }
  await Promise.all(jobs);
  libCache.at = Date.now();
  renderLibLists();
}
function renderLibLists() {
  try { const lg = $('lib-qq-logout'); if (lg) lg.style.display = (STANDALONE && QQSA.ready) ? '' : 'none'; } catch (e) { }
  try { const lgb = $('lib-bili-logout'); if (lgb) lgb.style.display = (STANDALONE && BLSA.ready) ? '' : 'none'; } catch (e) { }
  try { const lgn = $('lib-ne-logout'); if (lgn) lgn.style.display = (STANDALONE && typeof NESA !== 'undefined' && NESA.ready) ? '' : 'none'; } catch (e) { }
  const favs = libCache.favs || [];
  const biliLoginBtn = STANDALONE ? '<div class="empty-tip"><button class="fx-chip active" id="lib-bili-login">登录B站</button></div>' : '<div class="empty-tip">暂无收藏夹</div>';
  const wlRow = (libCache.wl && libCache.wl.items && libCache.wl.items.length)
    ? `<div class="row" data-src="wl" data-wlname="稍后再看">
        <div class="r-ico">🕐</div>
        <div class="r-main"><div class="r-title">稍后再看</div><div class="r-sub">${libCache.wl.items.length} 个视频 · 点击浏览</div></div>
        <span class="r-badge">打开</span>
      </div>` : '';
  $('lib-favs').innerHTML = wlRow + (favs.length
    ? favs.map(f => `<div class="row" data-fid="${esc(f.id)}" data-fname="${esc(f.title)}">
        <div class="r-ico">♥</div>
        <div class="r-main"><div class="r-title">${esc(f.title)}${f._newCount ? ' <span style="color:var(--pink);font-size:11px;font-weight:700"> +' + f._newCount + ' 新</span>' : ''}</div><div class="r-sub">${f.count} 个视频 · 点击浏览</div></div>
        <span class="r-badge">打开</span>
      </div>`).join('')
    : (wlRow || biliLoginBtn));
  const qq = libCache.qq || [];
  $('lib-qq').innerHTML = qq.length
    ? qq.map(p => `<div class="row" data-src="qq" data-sid="${esc(p.id)}" data-sname="${esc(p.name)}">
        ${p.cover ? `<img src="${esc(pic(p.cover))}" loading="lazy" onerror="this.outerHTML='<div class=\\'r-ico\\'>♫</div>'">` : '<div class="r-ico">♫</div>'}
        <div class="r-main"><div class="r-title">${esc(p.name)}</div><div class="r-sub">${p.trackCount || '?'} 首 · QQ音乐</div></div>
        <span class="r-badge">打开</span>
      </div>`).join('')
    : (STANDALONE
        ? (QQSA.ready
            ? '<div class="empty-tip"><button class="fx-chip active" id="lib-qq-login">↻ 重新加载QQ歌单</button></div>'
            : '<div class="empty-tip"><button class="fx-chip active" id="lib-qq-login">登录QQ音乐</button></div>')
        : '<div class="empty-tip">电脑未登录QQ音乐</div>');
  const ne = libCache.ne || [];
  $('lib-ne').innerHTML = ne.length
    ? ne.map(p => `<div class="row" data-src="ne" data-sid="${esc(p.id)}" data-sname="${esc(p.name)}">
        ${p.cover ? `<img src="${esc(pic(p.cover))}" loading="lazy" onerror="this.outerHTML='<div class=\\'r-ico\\'>♫</div>'">` : '<div class="r-ico">♫</div>'}
        <div class="r-main"><div class="r-title">${esc(p.name)}</div><div class="r-sub">${p.trackCount || '?'} 首 · 网易云</div></div>
        <span class="r-badge">打开</span>
      </div>`).join('')
    : (STANDALONE
        ? (typeof NESA !== 'undefined' && NESA.ready
            ? '<div class="empty-tip"><button class="fx-chip active" id="lib-ne-login">↻ 重新加载网易云歌单</button></div>'
            : '<div class="empty-tip"><button class="fx-chip active" id="lib-ne-login">登录网易云</button></div>')
        : '<div class="empty-tip">电脑未登录网易云</div>');
}
let curSrc = null; // { name, items }
let srcGen = 0;    // 渐进加载代数：切走后旧补页回调自动失效
let srcWd = 0;     // 看门狗定时器：任何原因挂死60秒后必给反馈
let libScrollKeep = 0; // 曲库页滚动位置（原libScrollKeep——App未定义导致switchPage/switchTab炸断，favList挂死总根源）
/* 大列表分帧渲染：千行级列表首屏只画前150行，其余空闲时间分块追加（不阻塞交互） */
function chunkedRender(el, items, rowFn, chunk) {
  chunk = chunk || 150;
  const token = String(Math.random());
  el.dataset.renderId = token;
  if (items.length <= chunk) { el.innerHTML = items.map(rowFn).join(''); return; }
  el.innerHTML = items.slice(0, chunk).map(rowFn).join('');
  let done = chunk;
  const step = () => {
    if (el.dataset.renderId !== token) return; // 已被新一次渲染接管
    const end = Math.min(items.length, done + chunk);
    el.insertAdjacentHTML('beforeend', items.slice(done, end).map(rowFn).join(''));
    done = end;
    if (done < items.length) setTimeout(step, 0);
  };
  setTimeout(step, 0);
}
function srcAppend(items) {
  if (!curSrc || !items.length) return;
  const start = curSrc.items.length;
  curSrc.items.push(...items);
  const list = $('src-list');
  if (list.querySelector('.empty-tip')) list.innerHTML = '';
  list.insertAdjacentHTML('beforeend', items.map((it, i) => srcRow(it, start + i)).join(''));
  $('src-count').textContent = curSrc.items.length + ' 首';
}
function openLibSrc(name, items) {
  curSrc = { name, items };
  srcGen++;
  $('src-name').textContent = name;
  $('src-count').textContent = items.length + ' 首';
  const list = $('src-list');
  if (items.length) chunkedRender(list, items, (it, i) => srcRow(it, i));
  else list.innerHTML = '<div class="empty-tip">空的</div>';
  switchPage('src', 'lib');
}
async function libSearch(q) {
  const out = $('lib-search-out');  out.classList.remove('hidden');
  out.innerHTML = '<div class="empty-tip">搜索中…</div>';
  /* 搜索历史（最近6条，点击重搜） */
  localStorage.setItem('bp.lastSearch', q);
  /* 搜索联想：B站suggest API */
  fetch('/api/suggest?pin=' + (PIN || '') + '&term=' + encodeURIComponent(q)).then(r => r.json()).then(d => {
    const terms = (d.data && d.data.terms || []).slice(0, 6);
    const box = document.getElementById('sg-phone');
    if (!box) return;
    if (!terms.length) { box.classList.add('hidden'); return; }
    box.innerHTML = terms.map(t2 => '<div class="sg-item" data-sgq="' + esc(t2) + '">' + esc(t2) + '</div>').join('');
    box.classList.remove('hidden');
  }).catch(() => { });
  try {
    let hist = JSON.parse(localStorage.getItem('bp.searchHist') || '[]');
    hist = [q].concat(hist.filter(h => h !== q)).slice(0, 6);
    localStorage.setItem('bp.searchHist', JSON.stringify(hist));
    const histEl = $('lib-search-hist');
    if (histEl) {
      histEl.classList.remove('hidden');
      histEl.innerHTML = hist.map(h => `<button class="fx-chip" data-q="${esc(h)}">${esc(h)}</button>`).join('');
    }
  } catch (e) { }
  try {
    let items;
    if (STANDALONE) {
      const results = [];
      for (let p = 1; p <= 2; p++) { const r = await BLSA.search(q, p); results.push(...r); }
      /* 网易云搜索补充：手机直连（匿名可搜，VIP歌播放时提示） */
      try {
        if (typeof NESA !== 'undefined') {
          if (!NESA.ready) await NESA.init();
          const ne = await NESA.search(q, 30);
          results.push(...ne);
        }
      } catch (e) { /* 网易云失败不影响B站结果 */ }
      items = results;
    } else {
      const d = await jget('/api/search?keyword=' + encodeURIComponent(q));
      items = (d.items || []).map(it => ({ bvid: it.bvid, title: stripEm(it.title), up: it.up, pic: it.pic, duration: it.duration }));
    }
    out.classList.add('hidden');
    /* 源筛选：全部 / B站 / 网易云 */
  var srcFilter = localStorage.getItem('bp.searchSrc') || '';
  var filtered = srcFilter ? items.filter(function(x) {
    var src = x.bvid ? 'bili' : (x.nid ? 'ne' : '');
    return src === srcFilter;
  }) : items;
  var filterChips = '<div style="padding:6px 14px 0;display:flex;gap:6px;flex-wrap:wrap">' +
    [['', '全部'], ['bili', '📺 B站'], ['ne', '🎵 网易云']].map(function(sk) {
      var active = (srcFilter || '') === sk[0];
      return '<button class="fx-chip ' + (active ? 'active' : '') + '" data-searchsrc="' + sk[0] + '">' + sk[1] + '</button>';
    }).join('') + '</div>';
  openLibSrc('搜索：' + q + (srcFilter ? ' · ' + (srcFilter === 'bili' ? 'B站' : '网易云') : ''), filtered);
  var srcBar = document.createElement('div');
  srcBar.innerHTML = filterChips;
  var srcList = $('src-list');
  if (srcList && srcList.parentNode) srcList.parentNode.insertBefore(srcBar, srcList);
  } catch (e) {
    out.innerHTML = '<div class="empty-tip">' + esc(e.message) + '</div>';
  }
}
async function openSrcList(kind, id, name) {
  const gen = ++srcGen;
  /* 看门狗：桥接/接口任何环节挂死（理论上有30秒兜底，仍防未知路径）60秒后必给反馈+重试 */
  clearTimeout(srcWd);
  srcWd = setTimeout(() => {
    if (gen !== srcGen) return;
    const tip = document.querySelector('#src-list .empty-tip');
    if (tip && /加载中/.test(tip.textContent)) {
      $('src-name').textContent = name;
      $('src-list').innerHTML = '<div class="empty-tip">加载超时（60秒无响应，点重试再来一次）<br><span id="src-retry" style="color:#fb7299;text-decoration:underline;cursor:pointer">重试</span></div>';
      const r = $('src-retry');
      if (r) r.onclick = () => openSrcList(kind, id, name);
    }
  }, 60000);
  $('src-name').textContent = name + '（加载中…）';
  $('src-count').textContent = '';
  $('src-list').innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div>';
  switchPage('src', 'lib');
  try { if (window.androidApi && androidApi.bpLog) androidApi.bpLog('openSrcList过了switchPage kind=' + kind + ' SA=' + STANDALONE + ' id=' + id); } catch (e) { }
  /* QQ歌单（独立模式）：首页先渲染，后台分页流式追加，全程不阻塞界面 */
  if (kind === 'qq' && STANDALONE) {
    try {
      const head = await QQSA.detailFirst(id);
      if (gen !== srcGen) return;
      curSrc = { name, items: [], kind, id: String(id) };
      $('src-name').textContent = name;
      $('src-count').textContent = head.total + ' 首（加载中…）';
      $('src-list').innerHTML = '';
      srcAppend(head.tracks);
      QQSA.detailRest(id, head.tracks.length, head.total, chunk => {
        if (gen !== srcGen) return;
        srcAppend(chunk);
        $('src-count').textContent = curSrc.items.length + ' / ' + head.total + ' 首（加载中…）';
      }).then(() => {
        if (gen !== srcGen) return;
        $('src-count').textContent = curSrc.items.length + ' 首';
        if (!curSrc.items.length) $('src-list').innerHTML = '<div class="empty-tip">QQ音乐暂时没返回歌曲（限流），稍后重试</div>';
      });
    } catch (e) {
      $('src-name').textContent = name;
      $('src-list').innerHTML = '<div class="empty-tip">' + esc(e.message) + '</div>';
    }
    return;
  }
  /* 稍后再看（独立模式）：一次性列表 */
  if (kind === 'wl' && STANDALONE) {
    try {
      const d = await BLSA.watchLater();
      if (gen !== srcGen) return;
      curSrc = { name, items: d.items, kind: 'wl', id: 'wl' };
      $('src-name').textContent = name;
      $('src-count').textContent = d.items.length + ' 首';
      if (d.items.length) chunkedRender($('src-list'), d.items, (it, i) => srcRow(it, i));
      else $('src-list').innerHTML = '<div class="empty-tip">稍后再看是空的</div>';
    } catch (e) {
      if (gen !== srcGen) return;
      $('src-name').textContent = name;
      $('src-list').innerHTML = '<div class="empty-tip">' + esc(e.message) + '</div>';
    }
    return;
  }
  /* 网易云歌单（独立模式）：首页先渲染 + trackIds 分页流式补齐 */
  if (kind === 'ne' && STANDALONE) {
    try {
      const head = await NESA.detailFirst(id);
      if (gen !== srcGen) return;
      curSrc = { name, items: [], kind, id: String(id) };
      $('src-name').textContent = head.name || name;
      $('src-count').textContent = head.total + ' 首（加载中…）';
      $('src-list').innerHTML = '';
      srcAppend(head.tracks);
      NESA.detailRest(id, head.tracks.length, head.total, chunk => {
        if (gen !== srcGen) return;
        srcAppend(chunk);
        $('src-count').textContent = curSrc.items.length + ' / ' + head.total + ' 首（加载中…）';
      }).then(() => {
        if (gen !== srcGen) return;
        $('src-count').textContent = curSrc.items.length + ' 首';
        if (!curSrc.items.length) $('src-list').innerHTML = '<div class="empty-tip">网易云暂时没返回歌曲，稍后重试</div>';
      });
    } catch (e) {
      if (gen !== srcGen) return;
      $('src-name').textContent = name;
      $('src-list').innerHTML = '<div class="empty-tip">' + esc(e.message) + '</div>';
    }
    return;
  }
  /* B站收藏夹（独立模式）：同样首页先渲染 + 后台补页 */
  if (kind === 'fav' && STANDALONE) {
    try {
      try { if (window.androidApi && androidApi.bpLog) androidApi.bpLog('openSrcList fav分支 id=' + id); } catch (e) { }
      const r0 = await BLSA.favList(id, 1);
      if (gen !== srcGen) return;
      curSrc = { name, items: [], kind, id: String(id) };
      $('src-name').textContent = name;
      $('src-count').textContent = '';
      $('src-list').innerHTML = '';
      srcAppend(r0.items);
      if (!r0.items.length) $('src-list').innerHTML = '<div class="empty-tip">收藏夹是空的</div>';
      (async () => {
        for (let pn = 2; pn <= 10 && r0.hasMore; pn++) {
          if (gen !== srcGen) return;
          try {
            const r = await BLSA.favList(id, pn);
            if (gen !== srcGen) return;
            if (!r.items.length) break;
            srcAppend(r.items);
            if (!r.hasMore) break;
          } catch (e) { break; }
        }
      })();
    } catch (e) {
      $('src-name').textContent = name;
      $('src-list').innerHTML = '<div class="empty-tip">' + esc(e.message) + '</div>';
    }
    return;
  }
  try {
    let items = [];
    if (kind === 'fav') {
      const d = await jget('/api/fav/all?media_id=' + encodeURIComponent(id));
      items = (d.items || []).map(it => ({ bvid: it.bvid, title: stripEm(it.title), up: it.up, pic: it.pic, duration: it.duration }));
    } else if (kind === 'qq') {
      const d = await jget('/api/qqplaylist?id=' + encodeURIComponent(id));
      items = (d.tracks || []).map(t => ({ qmid: t.qmid, qmMediaMid: t.mediaMid || '', title: t.title, up: t.artist, pic: t.pic, duration: t.duration }));
    } else if (kind === 'ne') {
      const d = await jget('/api/nplaylist?id=' + encodeURIComponent(id));
      items = (d.tracks || []).map(t => ({ nid: t.nid, title: t.name, up: t.artist, pic: t.pic, duration: Math.round((t.durationMs || 0) / 1000) }));
    }
    if (gen !== srcGen) return;
    curSrc = { name, items };
    $('src-name').textContent = name;
    $('src-count').textContent = items.length + ' 首';
    if (items.length) chunkedRender($('src-list'), items, (it, i) => srcRow(it, i));
    else $('src-list').innerHTML = '<div class="empty-tip">这个歌单是空的</div>';
  } catch (e) {
    $('src-name').textContent = name;
    $('src-list').innerHTML = '<div class="empty-tip">' + esc(e.message) + '</div>';
  }
}
function switchPage(name, tabBack) {
  PAGES.forEach(t => $('pg-' + t).classList.toggle('hidden', t !== name));
  const hl = tabBack || (name === 'tracks' ? 'pls' : (name === 'src' ? 'lib' : name));
  $$('#m-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === hl));
  curTab = tabBack || (name === 'tracks' ? 'pls' : (name === 'src' ? 'lib' : name));
  /* 曲库页滚动位置保持：切到子页再回来时停在原来的地方 */
  if (name === 'lib') {
    setTimeout(() => { $('m-body').scrollTop = libScrollKeep || 0; }, 0);
  } else {
    libScrollKeep = $('m-body').scrollTop;
    $('m-body').scrollTop = 0;
  }
}

/* ---------- 绑定 ---------- */
let $seekDragging = false;
function bind() {
  $('pin-go').addEventListener('click', () => {
    const v = ($('pin-input').value || '').trim();
    if (!/^\d{4}$/.test(v)) { $('pin-err').textContent = '请输入4位配对码'; return; }
    PIN = v; localStorage.setItem('bp.pin', v);
    $('pin-err').textContent = '';
    pollState();
  });
  $('pin-standalone').addEventListener('click', () => {
    localStorage.setItem('bp.localMode', '1');
    localStorage.setItem('bp.standalone', '1');
    localStorage.removeItem('bp.pin');
    PIN = '';
    // file:// 下 location.href 相对路径不可靠，用 reload + localStorage 标记
    location.reload();
  });
  $('pin-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('pin-go').click(); });

  $('c-toggle').addEventListener('click', () => {
    if (localMode) { if (LA.paused) { userPaused = false; LA.play().catch(() => { }); } else { userPaused = true; LA.pause(); } }
    else sendCmd('toggle');
  });
  $('c-next').addEventListener('click', () => { if (localMode) localStep(1); else sendCmd('next'); });
  $('c-prev').addEventListener('click', () => { if (localMode) localStep(-1); else sendCmd('prev'); });
  /* 播放模式三态：列表循环 → 随机 → 单曲循环 */
  const cMode = $('c-mode');
  if (cMode) cMode.addEventListener('click', () => {
    playMode = playMode === 'order' ? 'shuffle' : (playMode === 'shuffle' ? 'single' : 'order');
    try { localStorage.setItem('bp.playMode', playMode); } catch (e) { }
    renderMode();
    toast({ order: '列表循环', shuffle: '随机播放', single: '单曲循环' }[playMode]);
  });

  /* 音效快捷抽屉：播放页一键切预设（不用切页） */
  const qfx = $('q-fx');
  if (qfx) qfx.addEventListener('click', () => {
    const list = ['off', 'sbass', 'vocalc', 'female', 'pure', 'ethereal', 'liyin3d', 'pano', 'dolby', 'live'];
    const cur = PFX.state.preset || 'off';
    const items = list.map(k => ({
      label: ((FX_PRESETS[k] || {}).label || k) + (cur === k ? '  ✓' : ''),
      fn: () => applyPreset(k)
    }));
    items.push({ label: '🎲 3D环绕：' + (PFX.state.space3d ? '开' : '关'), fn: () => { PFX.state.space3d = !PFX.state.space3d; PFX.save(); if (PFX.needsFx() && !PFX.built) PFX.prepare().then(ok => { if (ok && PFX.ensure()) PFX.resume(); }); PFX.apply(); } });
    items.push({ label: '🎙 人声消除：' + (PFX.state.vocalCut ? '开' : '关'), fn: () => { PFX.state.vocalCut = !PFX.state.vocalCut; PFX.save(); if (PFX.needsFx() && !PFX.built) PFX.prepare().then(ok => { if (ok && PFX.ensure()) PFX.resume(); }); PFX.apply(); } });
    items.push({ label: '⚙ 更多音效 → 音效页', fn: () => switchTab('fx') });
    showSheet('音效快捷 · 当前：' + ((FX_PRESETS[cur] || {}).label || cur), items);
  });
  /* 加入歌单（两处按钮共用） */
  const qa = $('q-add'), qa2 = $('q-add2');
  if (qa) qa.addEventListener('click', () => window.openAddSheet && window.openAddSheet());
  if (qa2) qa2.addEventListener('click', () => window.openAddSheet && window.openAddSheet());
  const qqueue = $('q-queue');
  if (qqueue) qqueue.addEventListener('click', () => switchTab('queue'));
  renderMode();

  /* ⋯ 更多选项抽屉 */
  const cMore = $('c-more');
  if (cMore) cMore.addEventListener('click', () => {
    const speeds = [0.75, 1, 1.25, 1.5, 2];
    const curRate = LA.playbackRate || 1;
    const items = [];
    /* 倍速 */
    speeds.forEach(s => {
      items.push({ label: '⚡ ' + s + 'x 播放速度' + (Math.abs(curRate - s) < 0.01 ? '  ✓' : ''), fn: () => { LA.playbackRate = s; toast('播放速度 ' + s + 'x'); } });
    });
    /* 定时关闭 */
    [15, 30, 45, 60].forEach(min => {
      items.push({ label: '⏰ ' + min + ' 分钟后暂停', fn: () => { sleepUntil = Date.now() + min * 60000; toast('⏰ ' + min + ' 分钟后暂停'); } });
    });
    items.push({ label: '⏰ 取消定时', fn: () => { sleepUntil = 0; toast('已取消定时'); } });
    /* 下载 */
    const it = localQueue[localIdx];
    if (it && it.bvid) items.push({ label: '📥 在B站打开此视频', fn: () => { try { window.open('https://www.bilibili.com/video/' + it.bvid); } catch (e) { } } });
    if (it && it.nid) items.push({ label: '🔗 复制网易云链接', fn: () => { try { const ta = document.createElement('textarea'); ta.value = 'https://music.163.com/#/song?id=' + it.nid; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); toast('链接已复制'); } catch (e) { } } });
    if (it && it.qmid) items.push({ label: '🔗 复制QQ音乐链接', fn: () => { try { const ta = document.createElement('textarea'); ta.value = 'https://y.qq.com/n/ryqq/songDetail/' + it.qmid; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); toast('链接已复制'); } catch (e) { } } });
    /* 音效快捷 */
    items.push({ label: '🎛 音效设置', fn: () => switchTab('fx') });
    showSheet('播放选项', items);
  });
  /* 唱片点击：封面↔歌词 */
  const vEl = $('vinyl');
  if (vEl && !vEl._fsBound) {
    vEl._fsBound = true;
    var _lpT = 0;
    vEl.addEventListener('touchstart', function() { _lpT = Date.now(); });
    vEl.addEventListener('touchend', function() {
      if (Date.now() - _lpT > 800) {
        var cur = parseInt(localStorage.getItem('bp.lyrSize') || '15');
        var nv = cur >= 24 ? 12 : cur + 3;
        localStorage.setItem('bp.lyrSize', nv);
        var ls = document.getElementById('lyrics-scroll');
        if (ls) ls.style.fontSize = nv + 'px';
        toast('歌词字号: ' + nv + 'px');
      }
    });
  }
  if (vEl) vEl.title = '点击切换封面/歌词';
  if (vEl) vEl.addEventListener('click', () => { if (!localMode) { if (lastState && (lastState.qmid || lastState.bvid || lastState.title)) toggleLyric(); } else if (localQueue[localIdx]) toggleLyric(); });
  /* 迷你播放条 */
  const mini = $('mini');
  if (mini) {
    mini.addEventListener('click', e => {
      if (e.target.closest('#mini-toggle') || e.target.closest('#mini-next')) return;
      switchTab('player');
    });
    $('mini-toggle').addEventListener('click', e => {
      e.stopPropagation();
      if (localMode) { if (LA.paused) { userPaused = false; LA.play().catch(() => { }); } else { userPaused = true; LA.pause(); } renderMini(); }
      else sendCmd('toggle');
    });
    $('mini-next').addEventListener('click', e => {
      e.stopPropagation();
      if (localMode) localStep(1); else sendCmd('next');
    });
  }

  const seek = $('seek');
  seek.addEventListener('input', () => {
    $seekDragging = true;
    setSeekFill(seek.value / 1000);
    if (localMode && isFinite(LA.duration)) $('t-cur').textContent = fmt(seek.value / 1000 * LA.duration);
    else if (lastState && lastState.dur) $('t-cur').textContent = fmt(seek.value / 1000 * lastState.dur);
  });
  seek.addEventListener('change', () => {
    $seekDragging = false;
    if (localMode) { if (isFinite(LA.duration) && LA.duration > 0) LA.currentTime = seek.value / 1000 * LA.duration; }
    else sendCmd('seek', seek.value / 1000);
  });
  const vol = $('vol');
  const volFill = () => { try { vol.style.setProperty('--vfill', vol.value + '%'); } catch (e) { } };
  volFill();
  vol.addEventListener('input', () => {
    volFill();
    if (localMode) { LA.volume = +vol.value / 100; localStorage.setItem('bp.localVol', vol.value); }
    else sendCmd('vol', +vol.value);
  });
  /* 点音量图标=静音/取消静音 */
  const volIco = document.querySelector('.np-quick .vol-ico');
  if (volIco) {
    volIco.style.cursor = 'pointer';
    volIco.addEventListener('click', () => {
      if (!localMode) return;
      if (LA.volume > 0) { LA._volBeforeMute = LA.volume; LA.volume = 0; vol.value = 0; }
      else { LA.volume = (LA._volBeforeMute || 0.8); vol.value = Math.round(LA.volume * 100); }
      localStorage.setItem('bp.localVol', vol.value);
    });
  }
  /* 恢复上次的手机本地音量 */
  const savedVol = parseInt(localStorage.getItem('bp.localVol') || '', 10);
  if (isFinite(savedVol) && savedVol > 0 && localMode) { LA.volume = savedVol / 100; vol.value = savedVol; }

  // 播放设备切换：电脑 ↔ 手机本机
  $('p-mode').addEventListener('click', () => {
    localMode = !localMode;
    localStorage.setItem('bp.localMode', localMode ? '1' : '0');
    setModeBtn();
    if (localMode) {
      sendCmd('pause'); // 切到本机时暂停电脑，避免两边同时出声
      if (lastState && lastState.queue && lastState.queue.length) {
        localQueue = lastState.queue.slice();
        localBase = lastState.queueOffset || 0;
        localIdx = Math.max(0, Math.min(localQueue.length - 1, (lastState.index || 0) - localBase));
        toast('🎧 切到手机本机播放');
        localLoad();
      } else { toast('🎧 本机模式 · 去曲库/歌单点一首歌'); }
      renderLocalTimes();
    } else {
      LA.pause();
      toast('📱 已切回电脑播放');
      renderPlayer(lastState || null);
    }
  });

  // 事件委托：队列/歌单/曲目行的点击
  $('queue-list').addEventListener('click', e => {
    /* 重排箭头：上移/下移 */
    const arrow = e.target.closest('.q-up, .q-down');
    if (arrow) {
      e.stopPropagation();
      const qi = +arrow.closest('.q-arrows').dataset.qi;
      const dir = +arrow.dataset.dir;
      const ni = qi + dir;
      if (ni < 0 || ni >= localQueue.length) return;
      /* 交换 */
      const tmp = localQueue[qi]; localQueue[qi] = localQueue[ni]; localQueue[ni] = tmp;
      if (localIdx === qi) localIdx = ni; else if (localIdx === ni) localIdx = qi;
      if (curTab === 'queue') switchTab('queue');
      return;
    }
  if (e.target.closest('.r-x')) return;
    const row = e.target.closest('.row');
    if (!row) return;
    if (localMode) {
      if (localQueue.length) localPlay(localQueue, Math.max(0, +row.dataset.idx - localBase));
      else if (lastState && lastState.queue) localPlay(lastState.queue, +row.dataset.idx);
    } else sendCmd('playQueue', +row.dataset.idx);
  });
  $('pls-list').addEventListener('click', e => {
    const more = e.target.closest('.r-more');
    if (more) {
      e.stopPropagation();
      const id = more.dataset.more;
      const pl = (plsCache || []).find(p => p.id === id);
      if (!pl) return;
      if (STANDALONE) {
        /* 独立模式：歌单存在手机本地，全部操作不经过电脑 */
        showSheet(pl.name, [
          { label: '▶ 播放全部', fn: () => { const items = (pl.items || []).map(it => Object.assign({}, it)); if (!items.length) return toast('歌单是空的'); localPlay(items, 0); switchTab('queue'); } },
          { label: '✎ 重命名', useInput: true, input: true, placeholder: '输入新名称', value: pl.name, fn: v => { if (!v) return; const p2 = QQSA.localPlFind(id); if (p2) { p2.name = v.trim(); QQSA.localPlSavePl(p2); plsCache = null; renderPls(); toast('已重命名'); } } },
          { label: '🗑 删除歌单', danger: true, fn: () => { QQSA.localPlDelete(id); plsCache = null; renderPls(); toast('已删除歌单'); } }
        ]);
        return;
      }
      showSheet(pl.name, [
        { label: '▶ 播放全部', fn: () => sendCmd('playPlaylist', { id, idx: 0 }) },
        { label: '✎ 重命名', useInput: true, input: true, placeholder: '输入新名称', value: pl.name, fn: v => { if (v) sendCmd('plRename', { id, name: v }); } },
        { label: '🗑 删除歌单', danger: true, fn: () => sendCmd('plDel', { id }) }
      ]);
      return;
    }
    const row = e.target.closest('.row');
    if (!row) return;
    const pl = (plsCache || []).find(p => p.id === row.dataset.id);
    if (pl) { renderTracks(pl); switchPage('tracks'); }
  });
  $('tracks-list').addEventListener('click', e => {
    const x = e.target.closest('.r-x');
    if (x) {
      e.stopPropagation();
      if (!curPl) return;
      if (STANDALONE) {
        QQSA.localPlRemoveItem(curPl.id, +x.dataset.x);
        const p2 = QQSA.localPlFind(curPl.id);
        if (p2) { renderTracks(p2); plsCache = null; toast('已从歌单移除'); }
        return;
      }
      sendCmd('plRemoveItem', { id: curPl.id, idx: +x.dataset.x });
      return;
    }
    const row = e.target.closest('.row');
    if (!row || !curPl) return;
    playRoute((curPl.items || []).map(it => Object.assign({}, it)), +row.dataset.idx, () => sendCmd('playPlaylist', { id: curPl.id, idx: +row.dataset.idx }));
    if (localMode) switchTab('queue');
  });
  $('tracks-back').addEventListener('click', () => switchPage('pls'));
  $('pl-new').addEventListener('click', () => {
    showSheet('新建歌单', [
      {
        label: '✓ 创建', useInput: true, input: true, placeholder: '歌单名称', fn: v => {
          if (!v || !v.trim()) return;
          const name = v.trim();
          if (STANDALONE) {
            /* 独立模式：建在手机本地，无需电脑 */
            QQSA.localPlCreate(name);
            plsCache = null; renderPls();
            toast('已创建本地歌单「' + name + '」');
            return;
          }
          sendCmd('plNew', { name });
        }
      }
    ]);
  });

  // 音效页
  const applyFx = (fn) => {
    if (STANDALONE || localMode) {
      fn(PFX.state);
      PFX.save();
      PFX.apply();                 // 立刻生效（含"关闭音效"要复位所有增益）
      renderFx && renderFx();
      /* 首次开音效：先探测AudioContext可用，再建图（起不来就提示，不会静音） */
      if (PFX.needsFx() && !PFX.built) {
        PFX.prepare().then(ok => {
          if (!ok) { toast('这台设备的音效引擎起不来，已保持直通播放'); return; }
          if (PFX.ensure()) { PFX.apply(); PFX.resume(); }
        });
      }
    }
    else { fn(null, true); }
  };
  const applyPreset = (k) => {
    if (STANDALONE || localMode) {
      PFX.preset(k);
      toast((FX_PRESETS[k] || {}).label || k);
      renderFx();
    } else {
      sendCmd('fxPreset', k);
      toast('已发送 · ' + (FX_PRESETS[k] || {}).label || k);
    }
  };
  $('fx-presets').addEventListener('click', e => {
    const chip = e.target.closest('.fx-chip');
    if (chip) applyPreset(chip.dataset.p);
  });
  $('fx-eqs').addEventListener('click', e => {
    const chip = e.target.closest('.fx-chip');
    if (chip) applyPreset(chip.dataset.p);
  });
  $('fx-3d').addEventListener('click', () => {
    if (STANDALONE || localMode) { applyFx(s => { s.space3d = !s.space3d; }); renderFx(); toast(PFX.state.space3d ? '3D环绕开' : '3D环绕关'); }
    else { sendCmd('fx3d'); toast('已发送'); }
  });
  $('fx-vocal').addEventListener('click', () => {
    if (STANDALONE || localMode) { applyFx(s => { s.vocalCut = !s.vocalCut; }); renderFx(); toast(PFX.state.vocalCut ? '人声消除开' : '人声消除关'); }
    else { sendCmd('fxVocal'); toast('已发送'); }
  });
  const tt = $('fx-testtone');
  if (tt) tt.addEventListener('click', () => PFX.testTone());
  /* B站音质：高音质=拉该视频可用最高档（音轨码率翻倍）；省流量=最低档 */
  const qHi = $('q-high'), qSave = $('q-save'), qHint = $('q-hint');
  function renderQ() {
    const save = localStorage.getItem('bp.audioSave') === '1';
    if (qHi) qHi.classList.toggle('on', !save);
    if (qSave) qSave.classList.toggle('on', save);
    if (qHint) qHint.textContent = '当前：' + (save ? '省流量' : '高音质');
  }
  if (qHi) qHi.addEventListener('click', () => { localStorage.setItem('bp.audioSave', '0'); renderQ(); nextPre = { key: '', src: '' }; toast('已切到高音质'); seamlessQSwitch(); });
  if (qSave) qSave.addEventListener('click', () => { localStorage.setItem('bp.audioSave', '1'); renderQ(); nextPre = { key: '', src: '' }; toast('已切到省流量'); seamlessQSwitch(); });

  /* ---------- 音质无缝切换：同一首歌在不同音质档位间平滑过渡 ----------
     播放中切音质 → 记住进度 → 淡出 → 换源 → 进度恢复 → 淡入 → 无断点 */
  let qSwitchBusy = false;
  async function seamlessQSwitch() {
    if (qSwitchBusy || !localMode || !LA.src || LA.paused) return;
    qSwitchBusy = true;
    const it = localQueue[localIdx];
    const pos = LA.currentTime || 0;
    const vol = LA.volume;
    try {
      /* 重新解析当前歌曲（quality设置已变，拿到新音质的URL） */
      const r = await resolveSrc(it);
      /* 淡出当前 */
      await elFade(0, 250);
      /* 换源并恢复进度 */
      LA.src = r.direct ? r.u : streamUrl(r.u);
      try { LA.currentTime = pos; } catch (e) { }
      audioTag = r.tag || audioTag;
      /* 淡入恢复 */
      await LA.play().catch(() => { });
      elFade(vol || 1, 300);
    } catch (e) {
      toast('音质切换失败：' + (e.message || '').slice(0, 30));
    }
    qSwitchBusy = false;
  }

  renderQ();

  // 曲库页
  $('lib-go').addEventListener('click', () => {
    const q = $('lib-q').value.trim();
    if (q) libSearch(q);
  });
  /* 搜索历史 chips：点击重搜 */
  $('lib-search-hist').addEventListener('click', e => {
    const chip = e.target.closest('[data-q]');
    if (!chip) return;
    $('lib-q').value = chip.dataset.q;
    libSearch(chip.dataset.q);
  });
  /* 队列清空（本机播放时） */
  $('queue-clear').addEventListener('click', () => {
    if (!localQueue.length) return;
    localQueue = []; localIdx = 0;
    LA.pause(); LA.removeAttribute('src');
    $('queue-clear').classList.add('hidden');
    $('queue-count').textContent = '';
    $('queue-list').innerHTML = '<div class="empty-tip">队列已清空<br><span style="color:var(--t3b)">去「曲库」点一首歌吧</span></div>';
    toast('本机队列已清空');
  });
  let _searchT = 0;
$('lib-q').addEventListener('keydown', e => { if (e.key !== 'Enter') return; const n = Date.now(); if (n - _searchT < 800) return; _searchT = n; $('lib-go').click(); e.target.blur(); });
  $('lib-favs').addEventListener('click', e => {
    const row = e.target.closest('.row');
    if (!row) return;
    if (row.dataset.src === 'wl') { openSrcList('wl', 'wl', row.dataset.wlname || '稍后再看'); return; }
    const fid = row.dataset.fid, fname = row.dataset.fname;
    if (STANDALONE) { openSrcList('fav', fid, fname); return; }
    showSheet(fname, [
      { label: '📂 浏览视频', fn: () => openSrcList('fav', fid, fname) },
      { label: '▶ 直接播放全部', fn: async () => { toast('加载中…'); try { if (STANDALONE) { let all = [], pn = 1, more = true; while (more && pn <= 10) { const r = await BLSA.favList(fid, pn); all = all.concat(r.items); more = r.hasMore && pn < 10; pn++; } if (!all.length) return toast('收藏夹是空的'); localPlay(all, 0); switchTab('queue'); return; } const d = await jget('/api/fav/all?media_id=' + encodeURIComponent(fid)); const items = (d.items || []).map(it => ({ bvid: it.bvid, title: stripEm(it.title), up: it.up, pic: it.pic, duration: it.duration })); if (!items.length) return toast('收藏夹是空的'); playRoute(items, 0, () => sendCmd('playItems', { items, idx: 0 })); if (localMode) switchTab('queue'); } catch (err) { toast(err.message); } } }
    ]);
  });
  $('lib-qq').addEventListener('click', e => {
    const row = e.target.closest('.row');
    if (row) openSrcList('qq', row.dataset.sid, row.dataset.sname);
  });
  document.getElementById('lib-ne').parentNode.addEventListener('click', e => {
    if (e.target.id === 'lib-ne-logout' || e.target.closest('#lib-ne-logout')) {
      if (confirm('退出当前网易云账号？将清除网易云Cookie')) {
        NESA.logout().then(() => {
          libCache.ne = null; libCache.at = 0;
          libTip('lib-ne-tip', '');
          toast('已退出网易云登录');
          renderLib();
        });
      }
      return;
    }
    if (e.target.id === 'lib-ne-login' || e.target.closest('#lib-ne-login')) {
      /* 未登录时打开登录页；已登录时按钮=重新拉取歌单 */
      if (window.androidApi && window.androidApi.openNeLogin && !(NESA && NESA.ready)) window.androidApi.openNeLogin();
      else {
        libCache.ne = null; libCache.at = 0;
        libTip('lib-ne-tip', '刷新中…');
        renderLib().then(() => toast((libCache.ne || []).length ? '网易云歌单已加载' : '未拉到歌单，稍后再试'));
      }
      return;
    }
    const row = e.target.closest('.row');
    if (row) openSrcList('ne', row.dataset.sid, row.dataset.sname);
  });
  $('src-list').addEventListener('click', e => {
    const add = e.target.closest('.r-add');
    if (add) {
      /* 行内 ＋：任意一首都能直接导入本机歌单（不必先播放） */
      e.stopPropagation();
      if (!curSrc) return;
      const it = curSrc.items[+add.dataset.add];
      if (!it) return;
      addItemsToLocalSheet([it], '加入本机歌单 · ' + (it.title || '').slice(0, 12));
      return;
    }
    const row = e.target.closest('.row');
    if (!row || !curSrc) return;
    playRoute(curSrc.items, +row.dataset.idx, () => sendCmd('playItems', { items: curSrc.items, idx: +row.dataset.idx }));
    if (localMode) switchTab('queue');
  });
  const srcImp = $('src-import');
  if (srcImp) srcImp.addEventListener('click', async () => {
    /* 整个收藏夹 / QQ歌单 / 搜索结果 一键导入本机歌单（手机本地，不依赖电脑） */
    if (!curSrc) return toast('列表还是空的');
    let items = curSrc.items.slice();
    if (STANDALONE && curSrc.id) {
      try {
        if (curSrc.kind === 'qq') {
          /* QQ歌单是分页流式加载的：导入前拉完整，否则只导到已加载的那几页 */
          toast('正在读取完整歌单…');
          const full = await QQSA.detail(curSrc.id);
          items = (full.tracks || []).map(t => ({ qmid: t.qmid, qmMediaMid: t.mediaMid || '', title: t.title, up: t.artist, pic: t.pic, duration: t.duration }));
        } else if (curSrc.kind === 'fav' && curSrc.items.length >= 20) {
          /* 收藏夹：把剩余分页也补齐 */
          toast('正在读取完整收藏夹…');
          const seen = new Set(items.map(x => x.bvid));
          for (let pn = 2; pn <= 20; pn++) {
            let r;
            try { r = await BLSA.favList(curSrc.id, pn); } catch (e) { break; }
            if (!r.items.length) break;
            r.items.forEach(x => { if (!seen.has(x.bvid)) { seen.add(x.bvid); items.push(x); } });
            if (!r.hasMore) break;
          }
        }
      } catch (e) { toast('读取完整列表失败，改为导入已加载部分'); }
    }
    if (!items.length) return toast('列表还是空的');
    addItemsToLocalSheet(items, '导入「' + curSrc.name + '」全部 ' + items.length + ' 首');
  });
  $('src-back').addEventListener('click', () => switchPage('lib', 'lib'));
  document.getElementById('bili-diag').addEventListener('click', () => showDiag('bili'));
  const biliLogoutBtn = document.getElementById('lib-bili-logout');
  if (biliLogoutBtn) biliLogoutBtn.addEventListener('click', () => {
    if (confirm('退出B站账号？将清除B站Cookie（保留buvid风控标识）')) {
      BLSA.logout().then(() => {
        libCache.favs = null; libCache.at = 0;
        libTip('lib-bili-tip', '');
        toast('已退出B站登录');
        renderLib();
      });
    }
  });
  document.getElementById('lib-qq').parentNode.addEventListener('click', e => {
    if (e.target.id === 'qq-diag' || e.target.closest('#qq-diag')) { showQqDiag(); return; }
    if (e.target.id === 'lib-qq-logout' || e.target.closest('#lib-qq-logout')) {
      if (confirm('退出当前QQ音乐账号？')) {
        QQSA.logout().then(() => {
          libCache.qq = null; libCache.at = 0;
          libTip('lib-qq-tip', '');
          toast('已退出QQ音乐登录');
          renderLib();
        });
      }
      return;
    }
    if (e.target.id === 'lib-qq-login' || e.target.closest('#lib-qq-login')) {
      /* 已登录时按钮=重新拉取歌单；未登录时打开登录页 */
      if (window.androidApi && window.androidApi.openQQLogin && !(QQSA && QQSA.ready)) window.androidApi.openQQLogin();
      else {
        libCache.qq = null; libCache.at = 0;
        libTip('lib-qq-tip', '刷新中…');
        renderLib().then(() => toast(QQSA.ready && (libCache.qq || []).length ? 'QQ歌单已加载' : '未拉到歌单，稍后再试'));
      }
    }
  });
  document.getElementById('lib-favs').parentNode.addEventListener('click', e => {
    if (e.target.id === 'lib-bili-login' || e.target.closest('#lib-bili-login')) { if (window.androidApi && window.androidApi.openBiliLogin) window.androidApi.openBiliLogin(); }
  });
  try { if (typeof renderFx === 'function') renderFx(); } catch (e) { }
  try { const fv = document.getElementById('fx-viz'); if (fv) fv.addEventListener('click', () => { NViz.setEnabled(!NViz.enabled); fv.classList.toggle('on', NViz.enabled); toast('频谱可视化 ' + (NViz.enabled ? '已开启' : '已关闭')); }); } catch (e) { }
  /* 搜索联想：输入触发 + 点击跳搜 + 失焦隐藏 */
  try {
    var _sgP = document.getElementById('sg-phone');
    if (_sgP) {
      _sgP.addEventListener('click', function(e) {
        var item = e.target.closest('.sg-item');
        if (!item) return;
        _sgP.classList.add('hidden');
        $('lib-q').value = item.dataset.sgq;
        $('lib-go').click();
      });
      $('lib-q').addEventListener('input', function() {
        var v2 = this.value.trim();
        if (v2.length < 2) { _sgP.classList.add('hidden'); return; }
        clearTimeout(window._sgPT);
        window._sgPT = setTimeout(function() {
          fetch('/api/suggest?pin=' + (PIN || '') + '&term=' + encodeURIComponent(v2)).then(function(r) { return r.json(); }).then(function(d) {
            var terms = (d.data && d.data.terms || []).slice(0, 6);
            if (!terms.length) { _sgP.classList.add('hidden'); return; }
            _sgP.innerHTML = terms.map(function(t2) { return '<div class="sg-item" data-sgq="' + esc(t2) + '">' + esc(t2) + '</div>'; }).join('');
            _sgP.classList.remove('hidden');
          }).catch(function() { });
        }, 300);
      });
      document.addEventListener('click', function(e) {
        if (!e.target.closest('.searchbox') && !e.target.closest('#sg-phone')) _sgP.classList.add('hidden');
      });
    }
  } catch (e) { }
  /* 歌词点击跳转：点任意句直接跳到那句的时间 */
  try {
    $('lyrics-scroll').addEventListener('click', e => {
      const el = e.target.closest('.lyr-line[data-i]');
      if (!el || !lyricLines) return;
      const i = +el.dataset.i;
      const t0 = lyricLines[i] ? lyricLines[i].t : 0;
      if (STANDALONE || localMode) {
        try { LA.currentTime = t0; } catch (err) { }
        if (LA.paused) LA.play().catch(() => { });
        userPaused = false;
      } else {
        const dur = (lastState || {}).dur || 0;
        if (dur > 0) sendCmd('seek', Math.min(1, t0 / dur));
      }
      toast('跳到「' + String(lyricLines[i] ? lyricLines[i].text : '').slice(0, 12) + '」');
    });
  } catch (e) { }
  /* 七段均衡器：拖动即时生效（apply），松手落盘（save） */
  try {
    const eqRow = document.getElementById('fx-eqrow');
    if (eqRow) {
      let _eqT = 0;
      eqRow.addEventListener('input', e => {
        const r = e.target.closest('input[data-bi]');
        if (!r) return;
        const _n = Date.now(); if (_n - _eqT < 30) return; _eqT = _n;
        const i = +r.dataset.bi;
        if (!PFX.state.bands) PFX.state.bands = [0, 0, 0, 0, 0, 0, 0];
        PFX.state.bands[i] = +r.value;
        const em = r.parentNode.querySelector('em');
        if (em) { em.textContent = (+r.value > 0 ? '+' : '') + r.value + 'dB'; em.classList.toggle('pos', +r.value > 0); }
        if (PFX.needsFx()) PFX.prepare().then(ok => { if (ok && PFX.ensure()) { PFX.apply(); PFX.resume(); } });
        PFX.apply();
      });
      let _eqSaveT = 0;
      eqRow.addEventListener('change', () => { clearTimeout(_eqSaveT); _eqSaveT = setTimeout(() => PFX.save(), 300); });
    }
  } catch (e) { }
  /* QQ音质偏好按钮 */
  try {
    const qmap = { 'qqq-auto': 'auto', 'qqq-high': 'high', 'qqq-save': 'save' };
    Object.keys(qmap).forEach(bid => {
      const el = document.getElementById(bid);
      if (!el) return;
      el.addEventListener('click', () => {
        localStorage.setItem('bp.qqQual', qmap[bid]);
        renderFx();
        toast(qmap[bid] === 'save' ? 'QQ音乐音质：128k省流' : qmap[bid] === 'high' ? 'QQ音乐音质：320k封顶' : 'QQ音乐音质：自动·最高可用');
      });
    });
  } catch (e) { }
  /* 音效增强开关：超低频 / 空气感 / 响度归一化
     本机模式改本地引擎；遥控模式发指令给电脑（开关状态随 renderFx 从电脑状态同步） */
  try {
    const mkNe = (id, key, cmd, label) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('click', () => {
        if (STANDALONE || localMode) {
          applyFx(x => { x[key] = !x[key]; });
          renderFx();
          toast(label + (PFX.state[key] ? '开' : '关'));
        } else {
          sendCmd(cmd);
          toast('已发送 · 电脑' + label);
        }
      });
    };
    mkNe('fx-sub', 'subBass', 'fxSub', '超低频增强');
    mkNe('fx-air', 'air', 'fxAir', '空气感');
    mkNe('fx-norm', 'norm', 'fxNorm', '响度归一化');
  } catch (e) { }
  {
    const ra = $('reco-all'), rr = $('reco-refresh'), row = $('reco-row');
    if (ra) ra.addEventListener('click', () => recoPlay(0));
    if (rr) rr.addEventListener('click', () => loadReco(true));
    if (row) row.addEventListener('click', e => { const c = e.target.closest('.reco-card'); if (c) recoPlay(+c.dataset.i); });
  }
  $('lib-roam').addEventListener('click', () => { sendCmd('roam'); toast('已发送 · 电脑随机漫游'); switchTab('queue'); });
  $('lib-sleep').addEventListener('click', () => {
    /* 本机模式：手机本地定时暂停；遥控模式：指令给电脑 */
    if (STANDALONE || localMode) {
      showSheet('定时关闭', [
        { label: '播完当前曲再停', fn: () => localSleep(0, 'current') },
        { label: '— 分钟模式 —', header: true },
        ...[15, 30, 45, 60, 90].map(mins => ({ label: mins + ' 分钟后暂停', fn: () => localSleep(mins, 'normal') })),
        { label: '— 渐出模式 —', header: true },
        ...[30, 60].map(mins => ({ label: mins + ' 分钟后渐出停止', fn: () => localSleep(mins, 'fade') })),
        { label: '取消定时', fn: () => localSleep(0) }
      ]);
    } else {
      showSheet('定时关闭（电脑暂停播放）', [15, 30, 45, 60, 90].map(m => ({ label: m + ' 分钟', fn: () => { sendCmd('sleep', { min: m }); toast('已发送 · ' + m + ' 分钟后暂停'); } })).concat([{ label: '取消定时', fn: () => { sendCmd('sleep', { min: 0 }); toast('已发送 · 取消定时'); } }]));
    }
  });
  $('lib-dm').addEventListener('click', () => { sendCmd('dmToggle'); toast('已发送 · 弹幕开关'); });

  // 播放页：加入歌单（p-add旧按钮已移除，逻辑抽成函数给新按钮用）
  window.openAddSheet = async () => {
    if (STANDALONE) {
      /* 独立模式：加入手机本地歌单 */
      const cur = localQueue[localIdx];
      if (!cur) return toast('先放一首歌');
      const item = { bvid: cur.bvid, pid: cur.pid, cid: cur.cid, nid: cur.nid, qmid: cur.qmid, qmMediaMid: cur.qmMediaMid,
        title: cur.title, up: cur.up, pic: cur.pic, duration: cur.duration };
      plsCache = QQSA.localPls();
      const rows = plsCache.map(p => ({
        label: '♫ ' + p.name + '（' + (p.items || []).length + '首）',
        fn: () => {
          const r = QQSA.localPlAdd(p.id, item);
          if (r === 'dup') toast('这首已经在「' + p.name + '」里了');
          else { plsCache = null; toast('已加入「' + p.name + '」'); }
        }
      }));
      rows.push({
        label: '＋ 新建歌单并加入', useInput: true, input: true, placeholder: '新歌单名称', fn: v => {
          if (!v || !v.trim()) return;
          const pl = QQSA.localPlCreate(v.trim());
          QQSA.localPlAdd(pl.id, item);
          plsCache = null;
          toast('已新建「' + v.trim() + '」并加入');
        }
      });
      showSheet('把当前歌曲加入本机歌单', rows);
      return;
    }
    if (!plsCache) { try { plsCache = (await jget('/api/playlists')).playlists || []; } catch (err) { plsCache = []; } }
    showSheet('把当前歌曲加入歌单', plsCache.map(p => ({ label: '♫ ' + p.name + '（' + (p.items || []).length + '首）', fn: () => { sendCmd('plAddCur', { id: p.id }); toast('已发送'); } }))
      .concat([{ label: '＋ 新建歌单并加入', useInput: true, input: true, placeholder: '新歌单名称', fn: v => { if (v) { sendCmd('plAddCurNew', { name: v }); toast('已发送'); } } }]));
  };

  $$('#m-tabs button').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
}
/* 注意：switchPage 的唯一实现是前面那个（带 tabBack、支持 src/fx/lib 页）。
   这里曾有一个旧版残留定义，函数声明提升会覆盖新版，导致打开搜索结果/歌单详情时页面不切换。 */

/* 搜索源筛选 */
function setSearchSrc(src) {
  localStorage.setItem('bp.searchSrc', src);
  var q = localStorage.getItem('bp.lastSearch') || '';
  if (q) libSearch(q);
}

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { });
  });
}

/* ---------- 独立模式初始化 ---------- */
async function initStandalone() {
  if (!(window.androidApi && window.androidApi.http)) {
    toast('独立模式仅APK支持');
    showScreen(true);
    return;
  }
  showScreen(true); // 独立模式直接进主界面，不需要配对码
  const mname = document.querySelector('.m-name');
  if (mname) mname.textContent = '哔哩播放器 · 独立';
  const lq = document.getElementById('lib-q');
  if (lq) lq.placeholder = '搜B站视频 / 网易云歌曲';
  const apkCap = document.getElementById('lib-apk-cap');
  if (apkCap) apkCap.style.display = 'none';
  const apkBtn = document.getElementById('lib-apk-btn');
  if (apkBtn) apkBtn.style.display = 'none';
  const pmode = document.getElementById('p-mode');
  if (pmode) pmode.classList.add('hidden'); // 独立模式没有"电脑"可切
  $$('#m-tabs button').forEach(btn => { if (btn.dataset.tab === 'fx') btn.classList.remove('hidden'); }); // 手机PFX引擎有音效
  const ok = await QQSA.init();
  /* 网易云匿名/登录态预初始化（不阻塞，失败不影响QQ/B站） */
  NESA.init().catch(() => { });
  libCache.qq = null; libCache.at = 0; // 登录返回后强制曲库重新拉取（Cookie刚写入）
  renderStandaloneLib();
  if (curTab === 'pls') renderPls();
  const ver = window.androidApi && androidApi.version ? 'v' + androidApi.version() : 'web版';
  if (!ok) toast('独立模式' + ver + ' · 请到「曲库」页登录QQ音乐');
  else toast('独立模式' + ver + ' · QQ音乐已就绪', 'success');
  renderLocalTimes();
}
function renderStandaloneLib() {
  // 曲库页：B站/QQ/网易云 独立全部可用
  libCache.favs = null; // 触发重载（BLSA）
}

/* ---------- 启动 ---------- */
/* bind 里任何一个元素缺失都不该阻断启动（否则会停在配对页，像"必须连电脑"） */
try { bind(); } catch (e) { console.error("[bind]", e); try { if (window.androidApi && androidApi.bpLog) androidApi.bpLog("bind错误: " + e.message); } catch (e2) { } }
setModeBtn();
try { NViz.init(); } catch (e) { }
if (STANDALONE) {
  showScreen(true); // 独立模式直接进主界面，同步调用不等异步
  initStandalone();
} else {
  showScreen(!!PIN);
  pollState();
  setInterval(pollState, 2000);
}

document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-searchsrc]');
  if (!btn) return;
  setSearchSrc(btn.dataset.searchsrc);
});
