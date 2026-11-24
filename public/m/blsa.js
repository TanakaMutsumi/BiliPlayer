/* B站独立客户端：登录(WebView Cookie) → WBI签名 → 收藏夹/搜索/播放解析
   传输层走 androidApi.http 原生桥（绕过CORS），音频CDN由原生拦截器补 Referer */
'use strict';
const BLSA = {
  mid: 0, wbi: null, _wbiAt: 0, _midCached: null,
  /* 登录态必须现读Cookie：启动时算一次会永远停在"游客"（登录发生在之后） */
  get ready() {
    try {
      const ck = (window.androidApi && window.androidApi.cookie) ? window.androidApi.cookie('https://www.bilibili.com') : '';
      return /SESSDATA=/.test(ck || '');
    } catch (e) { return false; }
  },

  async init() {
    if (!(window.androidApi && window.androidApi.http)) return false;
    /* 游客风控：无buvid的搜索会被B站风控返回空 → 领一个buvid种入CookieManager（每次启动刷新，长效Cookie） */
    try {
      const spi = await window.bHttp('GET', 'https://api.bilibili.com/x/frontend/finger/spi', '', 8000);
      const d = (JSON.parse(spi.body || '{}').data) || {};
      if (d.b_3) {
        window.androidApi.setCookie('https://api.bilibili.com/', 'buvid3=' + d.b_3);
        if (d.b_4) window.androidApi.setCookie('https://api.bilibili.com/', 'buvid4=' + d.b_4);
      }
    } catch (e) { }
    const ck = await window.androidApi.cookie('https://www.bilibili.com');
    try { await this.loadWbi(); } catch (e) { /* wbi 失败时搜索/播放解析会提示 */ }
    return /SESSDATA=/.test(ck || '');
  },

  async loginCheck() {
    try {
      const ck = await window.androidApi.cookie('https://www.bilibili.com');
      return /SESSDATA/.test(ck);
    } catch (e) { return false; }
  },

  async nav() {
    let j = await this._raw('https://api.bilibili.com/x/web-interface/nav');
    if (j.code === -101) {
      /* 注意：以前这里会自动清空所有登录Cookie（除buvid），一旦某次请求被风控或
         Cookie尚未落盘，就会把用户刚登录的账号清掉 → "登录了还是游客"。
         现在只重试一次，绝不动用户凭证；确实失效时由用户在设置里手动退出登录 */
      await new Promise(r => setTimeout(r, 600));
      j = await this._raw('https://api.bilibili.com/x/web-interface/nav');
    }
    if (j.code !== 0) throw new Error('B站nav失败(' + j.code + ')');
    return j.data || {};
  },

  async clearBiliAuth() {
    try {
      /* 从多域枚举全部Cookie：SESSDATA挂在.bilibili.com，只在api域枚举会漏 */
      let all = '';
      for (const src of ['https://api.bilibili.com', 'https://www.bilibili.com', 'https://passport.bilibili.com']) {
        try { all += (await window.androidApi.cookie(src) || '') + '; '; } catch (e) { }
      }
      const expire = 'Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0';
      const hosts = ['https://api.bilibili.com/', 'https://www.bilibili.com/', 'https://passport.bilibili.com/', 'https://account.bilibili.com/', 'https://bilibili.com/'];
      const seen = new Set();
      all.split(';').forEach(pair => {
        const name = pair.trim().split('=')[0];
        if (!name || seen.has(name)) return;
        seen.add(name);
        if (name.startsWith('buvid')) return; // buvid保留（风控需要）
        /* 关键：带Domain三形态过期，否则host-only空Cookie清不掉domain=.bilibili.com的凭证 */
        const variants = [
          name + '=; Domain=.bilibili.com; Path=/; ' + expire,
          name + '=; Domain=.biliapi.net; Path=/; ' + expire,
          name + '=; Path=/; ' + expire
        ];
        variants.forEach(v => hosts.forEach(h => { try { window.androidApi.setCookie(h, v); } catch (e) { } }));
      });
    } catch (e) { }
  },

  /* ---------- 退出登录：清凭证+重置会话状态 ---------- */
  async logout() {
    await this.clearBiliAuth();
    this.mid = 0;
    this._midCached = null;
    this.wbi = null;
    this._wbiAt = 0;
    this._viewCache = this._viewCache || new Map();
    this._viewCache.clear();
  },

  /* ---------- WBI 签名（mixin key 表 + md5；8小时TTL + 失败强制刷新） ----------
     nav对游客返回-101，但响应体里仍带 wbi_img 密钥 —— 无论code都要提取！ */
  async loadWbi(force) {
    if (!force && this.wbi && Date.now() - this._wbiAt < 8 * 3600 * 1000) return;
    const j = await this._raw('https://api.bilibili.com/x/web-interface/nav');
    const wbi = (j.data && j.data.wbi_img) || {};
    const img = String(wbi.img_url || '').split('/').pop().split('.')[0];
    const sub = String(wbi.sub_url || '').split('/').pop().split('.')[0];
    const raw = img + sub;
    if (raw.length < 64) throw new Error('WBI密钥获取失败');
    const T = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
    this.wbi = { mixin: T.map(i => raw[i]).join('').slice(0, 32) };
    this._wbiAt = Date.now();
  },
  _wbiSign(params) {
    if (!this.wbi) throw new Error('WBI未初始化');
    const wts = Math.floor(Date.now() / 1000);
    const o = Object.assign({}, params, { wts });
    const keys = Object.keys(o).sort();
    const q = keys.map(k => k + '=' + encodeURIComponent(String(o[k]).replace(/[!'()*]/g, ''))).join('&');
    o.w_rid = md5(q + this.wbi.mixin);
    return o;
  },

  /* ---------- 传输（自动重试1次：偶发网络抖动/风控不再挂死） ---------- */
  async _raw(url, retries) {
    const _lg = function (m) { try { if (window.androidApi && androidApi.bpLog) androidApi.bpLog(m); } catch (e) { } };
    for (let attempt = 0; attempt <= (retries || 1); attempt++) {
      _lg('_raw尝试' + attempt + ' ' + String(url).slice(0, 90));
      const outer = await window.bHttp('GET', url, '');
      _lg('_raw返回 attempt' + attempt + ' code=' + (outer && outer.code) + ' bodyLen=' + ((outer && outer.body) || '').length + ' err=' + (outer && outer.err));
      if (outer && outer.body) {
        let r;
        try { r = JSON.parse(outer.body); } catch (e) { r = null; }
        if (r) return typeof r === 'string' ? JSON.parse(r) : r;
        /* 有body但不是JSON → 接口异常，重试 */
      }
      if (attempt < (retries || 1)) await new Promise(res => setTimeout(res, 1200));
    }
    throw new Error('B站接口无响应（网络波动或风控），稍后重试');
  },
  async _get(path, params, opts) {
    try { if (window.androidApi && androidApi.bpLog) androidApi.bpLog('_get进入 ' + path); } catch (e) { }
    const prefix = (opts && opts.prefix) || 'https://api.bilibili.com';
    const p = (opts && opts.wbi && this.wbi) ? this._wbiSign(params) : params;
    const q = Object.entries(p || {}).filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    const j = await this._raw(prefix + path + (q ? '?' + q : ''));
    if (j.code !== 0) throw new Error('B站接口错误(code=' + j.code + '): ' + (j.message || ''));
    return j.data;
  },

  /* ---------- 收藏夹 ---------- */
  async favFolders() {
    if (!this._midCached) {
      const nav = await this.nav();
      this._midCached = nav.mid;
    }
    const d = await this._get('/x/v3/fav/folder/created/list-all', { up_mid: this._midCached, type: 2 });
    return (d.list || []).map(f => ({ id: f.id, title: f.title, count: f.media_count }));
  },  /* ---------- 稍后再看：/x/v2/history/toview/web（需登录） ---------- */
  async watchLater() {
    const d = await this._get('/x/v2/history/toview/web');
    const list = (d.list || []).filter(x => x.bvid).map(x => ({
      bvid: x.bvid, title: x.title, up: (x.upper && x.upper.name) || '', pic: x.pic, duration: x.duration || 0
    }));
    return { items: list, count: d.count || list.length };
  },

  async favList(mediaId, pn) {
    try { if (window.androidApi && androidApi.bpLog) androidApi.bpLog('favList进入 mediaId=' + mediaId + ' pn=' + pn); } catch (e) { }
    const d = await this._get('/x/v3/fav/resource/list', { media_id: mediaId, pn: pn || 1, ps: 20, type: 2 });
    try { if (window.androidApi && androidApi.bpLog) androidApi.bpLog('favList返回 ' + ((d.medias || []).length) + '条'); } catch (e) { }
    const items = (d.medias || []).filter(m => m.type === 2).map(m => ({
      bvid: m.bvid, title: m.title, up: m.upper && m.upper.name || '', pic: m.cover, duration: m.duration
    }));
    return { items, hasMore: !!d.has_more };
  },

  /* ---------- 搜索（优先非WBI端点：WBI搜索对游客常被风控返回 v_voucher 空结果） ---------- */
  async search(kw, pn) {
    const params = { search_type: 'video', keyword: kw, page: pn || 1, order: 'totalrank', duration: 0 };
    const parse = d => ((d && d.result) || []).filter(r => r && r.bvid);
    let list = [];
    /* 1) 非WBI端点（实测对游客稳定返回结果；WBI端点会返回 v_voucher 风控空结果） */
    try { list = parse(await this._get('/x/web-interface/search/type', params)); } catch (e) { }
    /* 2) 兜底：WBI端点（非WBI将来若失效时再试） */
    if (!list.length) {
      try {
        await this.loadWbi(true);
        list = parse(await this._get('/x/web-interface/wbi/search/type', params, { wbi: true }));
      } catch (e) { }
    }
    return list.map(r => ({
      bvid: r.bvid,
      title: String(r.title || '').replace(/<em[^>]*>/g, '').replace(/<\/em>/g, ''),
      up: r.author || '',
      pic: String(r.pic || '').startsWith('//') ? 'https:' + r.pic : (r.pic || ''),
      duration: this._parseDur(r.duration)
    }));
  },
  _parseDur(s) {
    return String(s).split(':').map(Number).reverse().reduce((a, v, i) => a + v * Math.pow(60, i), 0);
  },

  /* ---------- 播放解析：bvid → 音频直链（需拦截器补 Referer）
     多P合集：首次解析（未传cid）额外返回 pages 分P列表，调用方展开队列；
     传 cid 则直接解析该分P（列表时长=合集总长，单P实际只有几分钟） ---------- */
  async resolve(bvid, wantCid) {
    const v = await this._get('/x/web-interface/view', { bvid });
    if (!v.cid) throw new Error('B站视频信息获取失败');
    const pages = (v.pages && v.pages.length > 1) ? v.pages : null;
    const cid = wantCid || v.cid;
    /* 音质：qn 给最大值让服务端按权限回落到能给的最高档
       （游客 720p，登录/VIP 自动更高）。以前写死 qn:0 = 只要最低档，
       合成音轨只有 64kbps，是"音质差+发闷"的主因 */
    let qn = 120;
    try { if (localStorage.getItem('bp.audioSave') === '1') qn = 16; } catch (e) { }
    const p = await this._get('/x/player/wbi/playurl',
      { bvid, cid, fnval: 0, fnver: 0, qn, platform: 'pc', high_quality: 1 }, { wbi: true });
    const pick = urls => {
      const good = urls.filter(u => u && !/mirrorcoso|mirrorcos|pcdn|mcdn|szbdyd/i.test(u));
      return good[0] || urls.find(u => u) || '';
    };
    let u;
    if (p.durl && p.durl.length) u = pick(p.durl.map(x => x.url));
    else {
      const dash = (p.dash && p.dash.audio) || [];
      if (dash.length) {
        const best = dash.reduce((a, b) => (b.bandwidth > a.bandwidth ? b : a), dash[0]);
        u = pick([best.base_url].concat(best.backup_url || []));
      }
    }
    if (!u) throw new Error('B站音频获取失败');
    const out = { u, direct: true, quality: p.quality || 0 };

    /* 纯音频DASH（m4s）：码率是720p合成音轨的近2倍（实测~203kbps）。
       Audio元素播不了分片m4s，但可以走MSE——上层据此决定是否启用 */
    try {
      if (localStorage.getItem('bp.audioSave') !== '1') {
        const d2 = await this._get('/x/player/wbi/playurl',
          { bvid, cid, fnval: 16, fnver: 0, qn: 120, platform: 'pc', fourk: 1 }, { wbi: true });
        const aud = (d2.dash && d2.dash.audio) || [];
        if (aud.length) {
          const best = aud.reduce((a, b) => (b.bandwidth > a.bandwidth ? b : a), aud[0]);
          const au = pick([best.base_url].concat(best.backup_url || []));
          if (au) out.dashAudio = { url: au, bandwidth: best.bandwidth || 0, codecs: best.codecs || 'mp4a.40.2' };
        }
      }
    } catch (e) { /* DASH不可用就用720p合成音轨 */ }
    if (pages && !wantCid) {
      out.pages = pages.map((pg, i) => ({ pid: i + 1, cid: pg.cid, part: pg.part || ('P' + (i + 1)), duration: pg.duration || 0 }));
    }
    return out;
  }
};
window.BLSA = BLSA;
