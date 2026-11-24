/* 哔哩播放器 · 手机端网易云音乐客户端（独立模式直连，不依赖电脑）
   传输层：androidApi.neApi 原生桥（Java侧 weapi AES+RSA 加密 + CookieManager 登录态，绕过CORS）
   登录：原生 WebView 打开 music.163.com/m/login，MUSIC_U Cookie 落进 CookieManager 即登录
   匿名身份：官方 register_anonimous 同款流程，未登录也能搜歌/听免费歌 */
'use strict';
(function () {
  const strip = s => String(s || '').replace(/<em[^>]*>/g, '').replace(/<\/em>/g, '');

  const NESA = {};
  NESA.ready = false;   // MUSIC_U 登录态
  NESA.user = null;     // { userId, name, avatar, vipType }

  /* ---------- 原生 weapi 桥封装（异步回调 window.__neApi） ---------- */
  let _neSeq = 0;
  const _nePend = new Map();
  window.__neApi = function (cbId, resp) {
    const p = _nePend.get(cbId);
    if (!p) return;
    _nePend.delete(cbId);
    clearTimeout(p.tid);
    p.res(resp || { code: -1, body: '{}' });
  };
  function neHttp(apiPath, data, timeoutMs) {
    return new Promise(resolve => {
      if (!(window.androidApi && window.androidApi.neApi)) {
        resolve({ code: -1, body: JSON.stringify({ code: -1, message: '需要升级新版APP' }) });
        return;
      }
      const id = 'ne' + (++_neSeq) + '_' + Date.now();
      const tid = setTimeout(() => {
        _nePend.delete(id);
        resolve({ code: -1, body: JSON.stringify({ code: -1, message: '网易云请求超时' }) });
      }, timeoutMs || 15000);
      _nePend.set(id, { res: resolve, tid: tid });
      try { window.androidApi.neApi(apiPath, JSON.stringify(data || {}), id); }
      catch (e) {
        clearTimeout(tid);
        _nePend.delete(id);
        resolve({ code: -1, body: JSON.stringify({ code: -1, message: String(e) }) });
      }
    });
  }
  async function nePost(apiPath, data, timeoutMs) {
    const r = await neHttp(apiPath, data, timeoutMs);
    let body = null;
    try { body = JSON.parse(r.body); } catch (e) { }
    if (body && body.code === 200) return body;
    const msg = body && (body.message || body.msg);
    const risk = body && (body.code === -460 || body.code === 460);
    throw new Error(risk ? '网易云风控(-460)，稍后再试' : (msg ? ('网易云: ' + msg) : ('网易云接口错误 code=' + (body ? body.code : r.code))));
  }

  /* ---------- 登录态 ---------- */
  NESA.init = async function () {
    try {
      const ck = (window.androidApi && window.androidApi.cookie) ? (window.androidApi.cookie('https://music.163.com') || '') : '';
      if (/MUSIC_U=[^;\s]/.test(ck)) {
        NESA.ready = true;
        try { NESA.user = await NESA.status(); } catch (e) { NESA.user = null; }
        if (!NESA.user) NESA.ready = false; // MUSIC_U 已失效
      }
      if (!NESA.ready) { try { await NESA.anonRegister(); } catch (e) { } }
    } catch (e) { }
    return NESA.ready;
  };

  /* 匿名身份（官方 register_anonimous 同款算法）：
     username = base64(deviceId + ' ' + dllEncodeId)，其中 dllEncodeId = base64(MD5(XOR(deviceId)))
     响应 cookie 含 MUSIC_A 匿名token，种进 CookieManager 持久化 */
  NESA.anonRegister = async function () {
    const hex = '0123456789ABCDEF';
    let dev = '';
    for (let i = 0; i < 52; i++) dev += hex[Math.floor(Math.random() * 16)];
    const KEY = '3go8&$8*3*3h0k(2)2';
    let xored = '';
    for (let i = 0; i < dev.length; i++) xored += String.fromCharCode(dev.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));
    /* md5(xored) hex → bytes → base64 = dllEncodeId（全ASCII，utf8=原字节） */
    let h = md5(xored);
    let bytes = [];
    for (let i = 0; i < h.length; i += 2) bytes.push(parseInt(h.slice(i, i + 2), 16));
    const dll = btoa(String.fromCharCode.apply(null, bytes));
    const enc = btoa(dev + ' ' + dll);
    const r = await neHttp('/api/register/anonimous', { username: enc }, 12000);
    let body = null;
    try { body = JSON.parse(r.body); } catch (e) { }
    if (body && body.code === 200 && body.cookie) {
      NESA._seedCookies(body.cookie);
      return true;
    }
    return false;
  };
  /* 把接口返回的 cookie 串种进 CookieManager（music.163.com 域，持久化） */
  NESA._seedCookies = function (cookieStr) {
    if (!window.androidApi || !window.androidApi.setCookie) return;
    String(cookieStr || '').split(';').forEach(pair => {
      const p = pair.trim();
      const eq = p.indexOf('=');
      if (eq <= 0) return;
      const name = p.slice(0, eq).trim();
      let val = p.slice(eq + 1).trim();
      if (!val) return;
      if (/^[A-Za-z0-9%_\-=]+$/.test(val)) val = val.replace(/=+$/, ''); // 去掉值里意外带的尾=
      try { window.androidApi.setCookie('https://music.163.com/', name + '=' + val + '; Path=/; Max-Age=31536000'); } catch (e) { }
    });
  };

  NESA.status = async function () {
    const b = await nePost('/api/nuser/account/get', {});
    const p = b.profile;
    if (!p) throw new Error('网易云未登录');
    return { userId: p.userId, name: p.nickname, avatar: p.avatarUrl, vipType: p.vipType || 0 };
  };

  /* ---------- 歌单 ---------- */
  NESA.playlists = async function (uid) {
    const b = await nePost('/api/user/playlist', { uid: uid, limit: 100, offset: 0 });
    return (b.playlist || []).map(p => ({
      id: p.id, name: strip(p.name), trackCount: p.trackCount || 0,
      cover: p.coverImgUrl || '', userId: p.userId, special: p.specialType === 5 || p.userId !== uid
    }));
  };
  const _plIds = new Map(); // 歌单全量 trackIds 缓存（detailFirst 填充，detailRest 分页用）
  NESA._mapTrack = function (t) {
    return {
      nid: t.id,
      title: strip(t.name),
      up: ((t.ar || t.artists) || []).map(a => a.name).join('/'),
      pic: ((t.al || t.album) || {}).picUrl || '',
      duration: Math.round((t.dt || t.duration || 0) / 1000),
      fee: t.fee || 0
    };
  };
  NESA.detailFirst = async function (id) {
    const b = await nePost('/api/v6/playlist/detail', { id: id, n: 500, limit: 500, offset: 0 }, 20000);
    const pl = b.playlist || {};
    const tracks = (pl.tracks || []).map(NESA._mapTrack);
    const ids = (pl.trackIds || []).map(x => x.id).filter(Boolean);
    _plIds.set(String(id), ids);
    return {
      name: strip(pl.name),
      total: Math.min(pl.trackCount || ids.length || tracks.length, 2000),
      tracks: tracks
    };
  };
  /* 大歌单补页：按 trackIds 分批调 v3 song/detail（官方 playlist_track_all 同款链路） */
  NESA.detailRest = async function (id, have, total, onChunk) {
    const ids = _plIds.get(String(id)) || [];
    for (let off = Math.max(0, have); off < Math.min(total, ids.length); off += 500) {
      const chunk = ids.slice(off, off + 500);
      const c = '[' + chunk.map(x => '{"id":' + x + '}').join(',') + ']';
      const b = await nePost('/api/v3/song/detail', { c: c }, 20000);
      const songs = (b.songs || []).map(NESA._mapTrack);
      if (!songs.length) break;
      onChunk(songs);
      await new Promise(r => setTimeout(r, 350)); // 分页降温，避免风控
    }
    return true;
  };

  /* ---------- 搜索 ---------- */
  NESA.search = async function (kw, limit) {
    const b = await nePost('/api/cloudsearch/pc', { s: kw, type: 1, limit: limit || 30, offset: 0 }, 20000);
    return ((b.result && b.result.songs) || []).map(NESA._mapTrack);
  };

  /* ---------- 每日推荐：登录走每日30首，未登录/风控回退推荐新歌 ---------- */
  NESA.reco = async function () {
    if (NESA.ready) {
      try {
        const b = await nePost('/api/v3/discovery/recommend/songs', {}, 20000);
        const arr = (b.data && b.data.dailySongs) || [];
        if (arr.length) return { label: '每日推荐 · 基于你的口味', items: arr.slice(0, 30).map(NESA._mapTrack) };
      } catch (e) { /* 回退 */ }
    }
    const b2 = await nePost('/api/personalized/newsong', { limit: 20 }, 15000);
    const arr2 = (b2 && (b2.data || b2.result)) || [];
    return { label: '推荐新歌 · 热门上新', items: arr2.slice(0, 20).map(t => NESA._mapTrack(t.song || t)) };
  };

  /* ---------- 歌曲 ---------- */
  NESA.songUrl = async function (nid) {
    let d = null;
    try {
      const b = await nePost('/api/song/enhance/player/url/v1', { ids: '[' + nid + ']', level: 'exhigh', encodeType: 'flac' }, 12000);
      d = ((b.data || [])[0]) || null;
    } catch (e) { /* 风控/失败转旧接口 */ }
    if (!d || !d.url) {
      try {
        const b2 = await nePost('/api/song/enhance/player/url', { ids: '[' + nid + ']', br: 320000 }, 12000);
        const d2 = ((b2.data || [])[0]) || null;
        if (d2 && d2.url) return { url: d2.url, fee: d2.fee, type: d2.type || 'mp3', size: d2.size || 0, legacy: true };
      } catch (e2) { /* 两种都失败 */ }
    }
    if (!d || !d.url) return { url: null, fee: d ? d.fee : -1, code: d ? d.code : -1 };
    return { url: d.url, fee: d.fee, type: d.type || 'mp3', size: d.size || 0 };
  };

  /* ---------- 歌词（LRC 解析对齐 qqsa） ---------- */
  NESA.lyric = async function (nid) {
    const b = await nePost('/api/song/lyric', { id: nid, lv: -1, tv: -1 }, 12000);
    const lrc = (b.lrc && b.lrc.lyric) || '';
    if (!lrc) return null;
    return NESA._lrcParse(lrc);
  };
  NESA._lrcParse = function (lrc) {
    const out = [];
    String(lrc || '').split(/\r?\n/).forEach(line => {
      const ms = line.match(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g);
      if (!ms) return;
      const text = line.replace(/\[[^\]]*\]/g, '').trim();
      if (!text || /^\d+$/.test(text)) return; // 纯时间戳/纯数字行丢弃
      ms.forEach(m => {
        const mm = m.match(/\[(\d+):(\d+(?:[.:]\d+)?)\]/);
        const t = parseInt(mm[1], 10) * 60 + parseFloat(mm[2].replace(':', '.'));
        out.push({ t: t, text: text });
      });
    });
    out.sort((a, b) => a.t - b.t);
    return out.length ? out : null;
  };

  /* ---------- 登出：Domain感知过期清除（对齐 blsa.logout） ---------- */
  NESA.logout = async function () {
    const names = ['MUSIC_U', '__csrf', 'MUSIC_A', 'MUSIC_A_T', 'MUSIC_R', 'MUSIC_S_SN', 'MUSIC_SN',
      'WEVNSM', 'NMTID', '_ntes_nuid', '_ntes_nnid', 'WNMCID', 'os', 'osver', 'channel', 'appver',
      'deviceId', '__remember_me', 'ntes_kaola_ad'];
    const hosts = ['https://music.163.com/', 'https://music.163.com/m/', 'https://interface.music.163.com/'];
    names.forEach(n => {
      hosts.forEach(h => {
        try { window.androidApi.setCookie(h, n + '=; Path=/; Domain=.music.163.com; Expires=Thu, 01 Jan 1970 00:00:00 GMT'); } catch (e) { }
        try { window.androidApi.setCookie(h, n + '=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'); } catch (e) { }
      });
    });
    NESA.ready = false;
    NESA.user = null;
    return true;
  };

  window.NESA = NESA;
})();
