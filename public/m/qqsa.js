/* 独立模式 QQ 音乐客户端：完全在手机上运行，不依赖电脑
   传输层：bHttp（原生异步 ahttp 桥，自带 CookieManager 登录态；不阻塞JS线程）
   需要 APK 独立模式（file:// 或 ?standalone=1） */
'use strict';
const QQSA = {
  uin: '0',
  ready: false,

  async init() {
    if (!(window.androidApi && window.androidApi.http)) return false;
    const raw = await window.androidApi.cookie('https://y.qq.com');
    const m = String(raw || '').match(/(?:^|;\s*)uin=(o?\d+)/);
    this.uin = m ? m[1].replace(/^o/, '') : '0';
    this.ready = this.uin !== '0' && /qm_keyst|qqmusic_key/.test(String(raw || ''));
    return this.ready;
  },

  _guid: (function () {
    let g = localStorage.getItem('bp.qsa.guid');
    if (!g) { g = String(1000000000 + Math.floor(Math.random() * 9000000000)); localStorage.setItem('bp.qsa.guid', g); }
    return g;
  })(),

  /* musicu.fcg 网关：空结果自动重试（游客/限流软保护）；相同payload并发去重 */
  _inflight: new Map(),
  async _musicu(payload, retries) {
    retries = retries === undefined ? 2 : retries;
    const key = JSON.stringify(payload);
    const hit = this._inflight.get(key);
    if (hit) return hit; // 同一请求正在路上：共享结果
    const p = (async () => {
      const attempt = async (left) => {
        const r = await window.bHttp('POST', 'https://u.y.qq.com/cgi-bin/musicu.fcg', JSON.stringify(payload));
        let j = null;
        try { j = JSON.parse(r.body); } catch (e) { }
        return { j, left };
      };
      let r = await attempt(retries);
      if (!r.j && retries > 0) { await new Promise(res => setTimeout(res, 900)); r = await attempt(0); }
      return r.j;
    })();
    this._inflight.set(key, p);
    try { return await p; } finally { this._inflight.delete(key); }
  },

  async _get(url) {
    const r = await window.bHttp('GET', url, '');
    return JSON.parse(r.body);
  },

  _strip: s => String(s || '').replace(/<em[^>]*>/g, '').replace(/<\/em>/g, ''),

  /* ---------- 账号 ---------- */
  async profile() {
    if (!this.ready) return null;
    try {
      const j = await this._get('https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_home_page.fcg?cid=205360838&reqtype=3&loginUin=' + this.uin + '&hostUin=' + this.uin + '&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0');
      const c = j && j.data && j.data.creator;
      if (c && (c.nick || c.name)) return { name: this._strip(c.nick || c.name), uin: this.uin };
    } catch (e) { }
    return { name: 'QQ用户 ' + this.uin, uin: this.uin };
  },

  /* ---------- 歌单列表（自建 + 收藏） ---------- */
  async playlists() {
    if (!this.ready) throw new Error('请先登录QQ音乐');
    const out = await this._playlistsOnce();
    if (out.length) return out;
    /* 新登录Cookie刚写入时首次请求可能拿空：等1.5秒重试一次 */
    await new Promise(r => setTimeout(r, 1500));
    await this.init(); // 重读Cookie（登录跳转链可能又补了uin等）
    const out2 = await this._playlistsOnce();
    if (out2.length) return out2;
    throw new Error('未获取到歌单（请确认QQ已登录过音乐）');
  },
  async _playlistsOnce() {
    if (!this.ready) return [];
    const uin = this.uin;
    /* 现行 musicu 模块（与PC端 qqmusic.js 一致）——老 fcg_user_created_singlist / GetCategoryContent 已下线 */
    const KEY = 'music.musicasset.PlaylistBaseRead';
    return this._musicu({
      comm: { ct: 24, cv: 0, uin },
      [KEY]: { method: 'GetPlaylistByUin', module: KEY, param: { uin: String(uin) } }
    }).then(j => {
      const seg = j && j[KEY];
      if (!seg || seg.code !== 0) return [];
      const pls = (seg.data && seg.data.v_playlist) || [];
      return pls.filter(p => p && p.tid).map(p => ({
        id: String(p.tid),
        name: this._strip(p.dirName || ('歌单' + p.tid)),
        trackCount: p.songNum || 0,
        cover: (p.picUrl || p.bigpicUrl || '').replace(/^http:\/\//, 'https://'),
        special: false
      }));
    }).catch(() => []);
  },

  /* ---------- 歌单详情（分页，首屏后由调用方补页） ---------- */
  async detailPage(tid, begin, onlysonglist, retries) {
    const KEY = 'music.srfDissInfo.DissInfo';
    const fetchOnce = async () => {
      const j = await this._musicu({
        comm: { ct: 24, cv: 0, uin: this.uin },
        [KEY]: { method: 'CgiGetDiss', module: KEY, param: { disstid: Number(tid), dirid: 0, tag: begin === 0, song_begin: begin, song_num: 100, userinfo: begin === 0, orderlist: true, onlysonglist } }
      }, retries === undefined ? 2 : retries);
      const seg = j && j[KEY];
      if (!seg || seg.code !== 0) throw new Error('QQ音乐歌单获取失败(code=' + (seg && seg.code) + ')');
      const d = seg.data || {};
      return { dirinfo: d.dirinfo || {}, total: d.total_song_num || 0, songs: d.songlist || [] };
    };
    let out = await fetchOnce();
    /* 限流特征：code=0 但列表为空且总数>0 → 退避重试（与PC端同策略） */
    if (!out.songs.length && out.total > 0 && retries === undefined) {
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise(r => setTimeout(r, 800 + attempt * 600));
        out = await fetchOnce();
        if (out.songs.length) break;
      }
      if (!out.songs.length && out.total > 0) throw new Error('QQ音乐暂时没返回歌曲（接口限流），稍后再试');
    }
    return out;
  },
  _map(s) {
    return {
      qmid: s.mid || '', title: this._strip(s.name || s.songname || s.songorig || ''), artist: (s.singer || []).map(x => x.name).join('/'),
      album: (s.album && s.album.name) || '', pic: s.album && s.album.mid ? 'https://y.gtimg.cn/music/photo_new/T002R300x300M000' + s.album.mid + '.jpg' : '',
      duration: s.interval || 0, vip: !!(s.pay && (s.pay.pay_play || s.pay.paytrackprice)), mediaMid: (s.file && s.file.media_mid) || s.mid || ''
    };
  },
  async detail(tid) {
    const out = [];
    let dirinfo = null, total = 0;
    const first = await this.detailPage(tid, 0, false);
    dirinfo = first.dirinfo; total = first.total;
    out.push(...first.songs);
    if (total > first.songs.length && first.songs.length) {
      const pages = Math.ceil(Math.min(total, 2500) / 100);
      let cursor = 1; const results = new Array(pages);
      const worker = async () => {
        while (cursor < pages) {
          const p = cursor++;
          try { results[p] = (await this.detailPage(tid, p * 100, true, 1)).songs; } catch (e) { results[p] = []; }
          await new Promise(r => setTimeout(r, 120));
        }
      };
      await Promise.all([worker(), worker()]);
      for (let p = 1; p < pages; p++) { if (!results[p] || !results[p].length) break; out.push(...results[p]); }
    }
    if (!out.length && total > 0) throw new Error('QQ音乐暂时没返回歌曲（限流），稍后重试');
    return {
      id: String((dirinfo && dirinfo.id) || tid),
      name: this._strip((dirinfo && dirinfo.title) || 'QQ音乐歌单'),
      trackCount: total || out.length,
      cover: ((dirinfo && dirinfo.picurl) || '').replace(/^http:\/\//, 'https://'),
      tracks: out.map(s => this._map(s))
    };
  },

  /* ---------- 渐进式详情：首屏一页立即返回，后续页流式回调（页面不卡顿） ---------- */
  async detailFirst(tid) {
    const first = await this.detailPage(tid, 0, false);
    return {
      id: String((first.dirinfo && first.dirinfo.id) || tid),
      name: this._strip((first.dirinfo && first.dirinfo.title) || 'QQ音乐歌单'),
      cover: ((first.dirinfo && first.dirinfo.picurl) || '').replace(/^http:\/\//, 'https://'),
      total: first.total || first.songs.length,
      tracks: first.songs.map(s => this._map(s))
    };
  },
  async detailRest(tid, from, total, onChunk) {
    const pages = Math.ceil(Math.min(total || 0, 2500) / 100);
    for (let p = 1; p < pages; p++) {
      try {
        const seg = await this.detailPage(tid, p * 100, true, 1);
        if (!seg.songs || !seg.songs.length) break;
        onChunk(seg.songs.map(s => this._map(s)));
      } catch (e) { break; }
      await new Promise(r => setTimeout(r, 120));
    }
  },

  /* ---------- 播放直链（与PC端同款：三前缀单次请求 + VIP兜底 + 10分钟缓存） ---------- */
  _vkeyCache: new Map(),
  async songUrl(mid, mediaMid, noFlac, pref) {
    const mm = mediaMid || '';
    /* 文件名必须用真实mediaMid；没有时用songmid双写让服务器自行纠正
       （单写songmid会得到指向不存在文件的purl，CDN返回-46628 file not exist） */
    const base = mm ? mm : (mid + mid);
    const ck = mid + '|' + base;
    const hit = this._vkeyCache.get(ck);
    if (hit && Date.now() - hit.at < 600000) return hit;
    const KEY = 'music.vkey.GetVkey.UrlGetVkey';
    /* 一次请求同时带 M800/M500/RS02 三个前缀 → 挑第一个有 purl 的（1次往返） */
    /* 音质阶梯：AI00=Hi-Res → F000=无损FLAC → M800=320k → M500 → RS02兜底。
       VIP会话才拿得到无损；配合m.js的3秒可播探测，起不来自动回退MP3 */
    pref = pref || (noFlac ? 'high' : 'auto');
    const names = pref === 'save'
      ? ['M500' + base + '.mp3', 'RS02' + base + '.mp3']
      : noFlac || pref === 'high'
        ? ['M800' + base + '.mp3', 'M500' + base + '.mp3', 'RS02' + base + '.mp3']
        : ['AI00' + base + '.flac', 'F000' + base + '.flac', 'M800' + base + '.mp3', 'M500' + base + '.mp3', 'RS02' + base + '.mp3'];
    const typeLabel = { AI00: 'Hi-Res无损', F000: '无损FLAC', M800: 'mp3 320k', M500: 'mp3 128k', RS02: 'mp3' };
    const j = await this._musicu({
      comm: { ct: 19, cv: 0, uin: this.uin },
      [KEY]: { method: 'UrlGetVkey', module: 'music.vkey.GetVkey', param: { filename: names, guid: this._guid, songmid: [mid], songtype: [0] } }
    }, 2);
    const seg = j && j[KEY];
    if (!seg || seg.code !== 0) {
      const c = seg ? seg.code : -1;
      const msg = String((seg && seg.data && seg.data.msg) || '');
      /* 104009/invalidq = 登录态失效（key过期），不是没会员 */
      if (c === 104009 || /invalid/i.test(msg)) {
        this._vkeyCache.clear();
        return { url: null, code: c, needLogin: true };
      }
      return { url: null, code: c };
    }
    const infos = (seg.data || {}).midurlinfo || [];
    /* 按序对应 filename[i]：顺序即音质从高到低，挑第一个有 purl 的 */
    for (let i = 0; i < infos.length; i++) {
      const mi = infos[i];
      const purl = mi.purl || '';
      if (!purl) continue;
      const pre = (names[i] || '').slice(0, 4);
      const type = typeLabel[pre] || 'mp3';
      const url = /^https?:\/\//.test(purl) ? purl : 'https://isure.stream.qqmusic.qq.com/' + purl;
      const out = { url, type, needbuy: mi.pneedbuy, flac: pre === 'AI00' || pre === 'F000' };
      this._vkeyCache.set(ck, Object.assign({ at: Date.now() }, out));
      if (this._vkeyCache.size > 120) { const fk = this._vkeyCache.keys().next().value; this._vkeyCache.delete(fk); }
      return out;
    }
    /* 全档位无 purl：走网页端通道兜底（官方网页播放器同款请求）。
       绿钻/普通用户对 VIP 歌也能拿到 320k 全曲（ct19 桌面标识会被全拒，网页端会发） */
    const fb = await this._songUrlWeb(mid, base);
    if (fb && fb.url) {
      this._vkeyCache.set(ck, Object.assign({ at: Date.now() }, fb));
      if (this._vkeyCache.size > 80) this._vkeyCache.clear();
      return fb;
    }
    const anyBuy = infos.some(mi => mi && (mi.pneedbuy === 1 || mi.result === 104003));
    const noLicense = infos.every(mi => mi && (mi.result === 101404 || mi.result === 101405));
    if (noLicense) return { url: null, code: 0, noLicense: true };
    if (anyBuy) return { url: null, code: 0, needbuy: 1, paidSong: true };
    return { url: null, code: 0, needbuy: infos[0] ? infos[0].pneedbuy : 1 };
  },

  /* ---------- 网页端兜底通道：与官方网页播放器同款 ----------
     ct=24 + GetVkeyServer/CgiGetVkey + loginflag=1 + uids。
     桌面端标识对非豪华账号全档位拒绝，网页端会发放 320k 全曲播放权 */
  async _songUrlWeb(mid, base) {
    const KEY = 'req_1';
    const names = ['M800' + base + '.mp3', 'M500' + base + '.mp3', 'RS02' + base + '.mp3', 'C400' + base + '.m4a'];
    const typeLabel = { M800: 'mp3 320k', M500: 'mp3 128k', RS02: 'mp3', C400: 'm4a 96k' };
    const j = await this._musicu({
      comm: { uin: this.uin, format: 'json', ct: 24, cv: 0 },
      [KEY]: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param: { guid: this._guid, songmid: [mid], filename: names, songtype: [0], loginflag: 1, uids: [this.uin] } }
    }, 2);
    const seg = j && j[KEY];
    if (!seg || seg.code !== 0) return null;
    const infos = ((seg.data || {}).midurlinfo) || [];
    for (let i = 0; i < infos.length; i++) {
      const mi = infos[i];
      if (!mi.purl) continue;
      const pre = (names[i] || '').slice(0, 4);
      const url = /^https?:\/\//.test(mi.purl) ? mi.purl : 'https://isure.stream.qqmusic.qq.com/' + mi.purl;
      return { url, type: typeLabel[pre] || 'mp3', flac: false, webFallback: true, needbuy: mi.pneedbuy };
    }
    return null;
  },

  /* ---------- 退出登录：把QQ全部域的Cookie置过期（与B站clearBiliAuth同思路） ---------- */
  /* ---------- 每日推荐30首：推荐流subtype 510动态歌单 → CgiGetDiss ---------- */
  async daily() {
    if (!this.ready) throw new Error('QQ音乐未登录');
    const j = await this._musicu({
      comm: { ct: 24, cv: 0, uin: this.uin },
      feed: { module: 'music.recommend.RecommendFeed', method: 'get_recommend_feed', param: { direction: 0, page: 1, v_cache: [], v_uniq: [], s_num: 0 } }
    }, 2);
    const shelves = ((((j || {}).feed || {}).data || {}).v_shelf) || [];
    let card = null;
    for (const sh of shelves) for (const nc of (sh.v_niche || [])) for (const c of (nc.v_card || [])) {
      if (c && c.subtype === 510) card = c;
    }
    if (!card || !card.id) throw new Error('QQ音乐日推入口未找到');
    const out = await this.detailPage(String(card.id), 0, false);
    if (!out.songs.length) throw new Error('QQ音乐每日推荐暂时为空（接口限流），稍后再试');
    return { label: 'QQ音乐每日30首', items: out.songs.slice(0, 30).map(s => this._map(s)) };
  },

  /* ---------- 播放时长上报（官网 listenReport 通道）：让QQ账号记上最近播放/听歌时长 ---------- */
  async reportPlay(mid, sec) {
    if (!this.ready) return { ok: false, reason: 'notlogin' };
    mid = String(mid || '').trim();
    sec = Math.max(1, Math.min(parseInt(sec) || 0, 1800));
    if (!/^[0-9A-Za-z]{5,64}$/.test(mid) || !sec) return { ok: false, reason: 'badparam' };
    this._songIdCache = this._songIdCache || {};
    let songId = this._songIdCache[mid] || '';
    if (!/^[1-9]\d*$/.test(songId)) {
      const KEY = 'music.pf_song_detail_svr';
      const j = await this._musicu({
        comm: { ct: 24, cv: 0, uin: this.uin },
        [KEY]: { method: 'get_song_detail_yqq', module: KEY, param: { song_mid: mid } }
      }, 1);
      const info = (j && j[KEY] && j[KEY].data) || {};
      const track = info.track_info || {};
      if (String(track.mid || '') !== mid) return { ok: false, reason: 'nodetail' };
      songId = String(track.id || '');
      if (!/^[1-9]\d*$/.test(songId)) return { ok: false, reason: 'noid' };
      this._songIdCache[mid] = songId;
    }
    const qs = 'Count=1&Fqq=' + this.uin + '&Fguid=' + this._guid + '&Ffromtag1=10050&Ffromtag2=' + songId +
      '&Fsong_id=' + songId + '&Fplay_time=' + sec + '&Fstart_time=' + Math.floor(Date.now() / 1000) +
      '&Ftype=3&Fversion=1&Fid1=0';
    await window.bHttp('GET', 'https://stat6.y.qq.com/pc/fcgi-bin/cgi_music_webreport.fcg?' + qs, '');
    return { ok: true, sec, songId };
  },

  async logout() {
    try {
      const expire = 'Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0';
      const hosts = ['https://y.qq.com/', 'https://u.y.qq.com/', 'https://c.y.qq.com/', 'https://i.y.qq.com/', 'https://graph.qq.com/', 'https://qq.com/'];
      for (const src of ['https://y.qq.com', 'https://graph.qq.com', 'https://qq.com']) {
        let ck = '';
        try { ck = await window.androidApi.cookie(src) || ''; } catch (e) { }
        ck.split(';').forEach(pair => {
          const name = pair.trim().split('=')[0];
          if (!name) return;
          /* 关键：要带 Domain 属性过期，否则只会新增一条host-only空Cookie，
             原 domain=.qq.com 的登录凭证（qm_keyst/psrf_*）依然生效 */
          const variants = [
            name + '=; Domain=.qq.com; Path=/; ' + expire,
            name + '=; Domain=.y.qq.com; Path=/; ' + expire,
            name + '=; Path=/; ' + expire
          ];
          variants.forEach(v => hosts.forEach(h => { try { window.androidApi.setCookie(h, v); } catch (e) { } }));
        });
      }
    } catch (e) { }
    this.uin = '0';
    this.ready = false;
    this._vkeyCache = this._vkeyCache || new Map();
    this._vkeyCache.clear();
    this._inflight = this._inflight || new Map();
    this._inflight.clear();
    try { localStorage.removeItem('bp.qqFlacBad'); } catch (e) { }
  },


  /* ---------- 歌词（LRC base64 → [{t,text}]，独立模式直接走手机Cookie） ---------- */
  _lrcParse(lrc) {
    const out = [];
    (lrc || '').split(/\r?\n/).forEach(line => {
      const tags = line.match(/\[(\d+):(\d+(?:\.\d+)?)\]/g);
      const text = line.replace(/\[[^\]]*\]/g, '').trim();
      if (!tags || !text) return;
      tags.forEach(t => {
        const mm = t.match(/\[(\d+):(\d+(?:\.\d+)?)\]/);
        if (!mm) return;
        out.push({ t: parseInt(mm[1], 10) * 60 + parseFloat(mm[2]), text });
      });
    });
    out.sort((a, b) => a.t - b.t);
    return out;
  },
  async lyric(mid) {
    try {
      /* musicu歌词模块：trans+decode 返回纯LRC base64（fcg老接口在部分WebView下返回空） */
      const j = await this._musicu({
        comm: { ct: 19, cv: 0, uin: this.uin, format: 'json' },
        req: { module: 'music.musichallSong.PlayLyricInfo', method: 'GetPlayLyricInfo', param: { songMID: mid, trans: 1, decode: 1 } }
      }, 2);
      const d = (j && j.req && j.req.data) || null;
      if (!d || !d.lyric) return null;
      /* base64 → UTF-8（浏览器无Buffer，用atob+TextDecoder） */
      const bin = atob(d.lyric);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const lrc = new TextDecoder('utf-8').decode(bytes);
      const lines = this._lrcParse(lrc).filter(l => l.text);
      return lines.length ? lines : null;
    } catch (e) { return null; }
  },
  /* ---------- 本地歌单存储（独立模式用手机存储） ---------- */
  localPls() {
    try { const a = JSON.parse(localStorage.getItem('bp.localPls') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  },
  localPlsSave(list) {
    /* localStorage 满（QuotaExceeded）时静默降级：清理封面字段后再试一次 */
    try { localStorage.setItem('bp.localPls', JSON.stringify(list)); }
    catch (e) {
      try {
        const slim = list.map(pl => Object.assign({}, pl, { items: pl.items.map(it => Object.assign({}, it, { pic: '' })) }));
        localStorage.setItem('bp.localPls', JSON.stringify(slim));
      } catch (e2) { toast && toast('存储空间不足，歌单未能保存'); }
    }
  },
  localPlCreate(name) {
    const list = this.localPls();
    const pl = { id: 'lp_' + Date.now().toString(36), name, items: [], createdAt: Date.now() };
    list.unshift(pl); this.localPlsSave(list); return pl;
  },
  localPlFind(id) { return this.localPls().find(p => p.id === id); },
  localPlSavePl(pl) {
    const list = this.localPls();
    const i = list.findIndex(p => p.id === pl.id);
    if (i >= 0) { list[i] = pl; this.localPlsSave(list); }
  },
  localPlDelete(id) { this.localPlsSave(this.localPls().filter(p => p.id !== id)); },
  localPlRemoveItem(id, idx) {
    const pl = this.localPlFind(id);
    if (pl && idx >= 0 && idx < pl.items.length) { pl.items.splice(idx, 1); this.localPlSavePl(pl); }
  },
  _key(it) {
    if (!it) return '';
    return it.bvid ? ('b' + it.bvid) : (it.nid ? ('n' + it.nid) : (it.qmid ? ('q' + it.qmid) : ''));
  },
  localPlAdd(id, item) {
    const pl = this.localPlFind(id);
    if (!pl || !item) return null;
    const k = this._key(item);
    if (!k || pl.items.some(x => this._key(x) === k)) return 'dup';
    pl.items.push(Object.assign({}, item, { title: this._strip(item.title || '') }));
    this.localPlSavePl(pl);
    return pl;
  },
  localPlCreateAdd(name, item) {
    const pl = this.localPlCreate(name);
    return this.localPlAdd(pl.id, item);
  }
};
window.QQSA = QQSA;
