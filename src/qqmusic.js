'use strict';
/* QQ音乐客户端：musicu.fcg 统一网关 + 登录Cookie管理
   —— 登录态来自 Electron 网页登录窗口（y.qq.com，抓 qm_keyst/uin）或手动Cookie导入。
      游客请求偶发被软限流（返回空列表）：自动退避重试；登录后走独立配额，稳定可用。
   参考社区公开实现（jsososo/QQMusicApi、listen1）的端点与参数。 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const REF = 'https://y.qq.com/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function stripTags(s) { return String(s || '').replace(/<em[^>]*>/g, '').replace(/<\/em>/g, ''); }

/* 解析LRC歌词为 [{t,text}]（与B站歌词管线同构） */
function parseLrc(raw) {
  const out = [];
  String(raw || '').split(/\r?\n/).forEach(line => {
    const tags = line.match(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g);
    if (!tags) return;
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    tags.forEach(tag => {
      const m = tag.match(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/);
      if (!m) return;
      const frac = m[3] ? (+('0.' + m[3])) : 0;
      out.push({ t: (+m[1]) * 60 + (+m[2]) + frac, text });
    });
  });
  out.sort((a, b) => a.t - b.t);
  return out.filter((l, i) => l.text || i === 0);
}

class QQMusic {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.cookieFile = path.join(dataDir, 'qq_cookies.json');
    this.cookie = '';
    this.guid = this._loadGuid();
    this._plCache = new Map(); // 歌单详情缓存（降低限流概率）
    this.loadCookies();
  }
  _loadGuid() {
    const f = path.join(this.dataDir, 'qq_guid.txt');
    try {
      const v = fs.readFileSync(f, 'utf8').trim();
      if (v) return v;
    } catch (e) { }
    const g = String(1000000000 + Math.floor(Math.random() * 9000000000));
    try { fs.mkdirSync(this.dataDir, { recursive: true }); fs.writeFileSync(f, g, 'utf8'); } catch (e) { }
    return g;
  }
  get uin() {
    const m = this.cookie.match(/(?:^|;\s*)uin=(o?\d+)/);
    return m ? m[1] : '0';
  }
  /* 纯数字uin：Cookie里是 o123456 带前缀格式，所有接口参数都要用数字版 */
  get uinNum() {
    return this.uin.replace(/^o/, '') || '0';
  }
  /* g_tk 签名：qm_keyst（登录）或 skey 计算，兜底游客值5381 */
  get gtk() {
    const m = this.cookie.match(/(?:^|;\s*)(?:qm_keyst|skey)=([^;\s]+)/);
    const s = m ? decodeURIComponent(m[1]) : '';
    let hash = 5381;
    for (let i = 0; i < s.length; i++) hash += (hash << 5) + s.charCodeAt(i);
    return hash & 0x7fffffff;
  }
  get loggedIn() {
    return this.uinNum !== '0' && /(?:qm_keyst|qqmusic_key)=[^;\s]+/.test(this.cookie);
  }

  loadCookies() {
    try {
      const j = JSON.parse(fs.readFileSync(this.cookieFile, 'utf8'));
      this.cookie = j.cookie || '';
    } catch (e) { }
  }
  saveCookies() {
    try { fs.mkdirSync(this.dataDir, { recursive: true }); fs.writeFileSync(this.cookieFile, JSON.stringify({ cookie: this.cookie }, null, 2), 'utf8'); } catch (e) { }
  }
  /* 手动导入Cookie：必须含 uin 与 qm_keyst/qqmusic_key（登录态的最低要求）
     注意：必须保存全部传入Cookie —— VIP会员验证依赖 psrf_musickey_createtime /
     psrf_qqunionid / psrf_access_token_expiresAt 等，裁剪会导致会员降级 */
  async setCookieRaw(raw) {
    const v = String(raw || '').trim();
    if (!v) return null;
    const incoming = {};
    v.split(';').forEach(p => { const m = p.trim().match(/^([^=\s]+)=([^;]*)/); if (m && m[2]) incoming[m[1]] = m[2]; });
    const uin = (incoming.uin || '').replace(/^o/, '');
    const keyst = incoming.qm_keyst || incoming.qqmusic_key || '';
    if (!uin || uin === '0' || !keyst) return null;
    this.cookie = Object.entries(incoming).map(([k, val]) => k + '=' + val).join('; ');
    const user = await this.profile().catch(() => null);
    if (!user) {
      /* profile探测失败 ≠ Cookie无效（接口限流/网络抖动都会失败）：
         保留登录态只跳过返回用户信息。旧版这里直接清空Cookie，
         而浏览器罐定时同步每2分钟就会走一次本方法 —— 接口一抖
         登录态就被误杀，表现为「刚登录几分钟就掉线」。 */
      this.saveCookies();
      return null;
    }
    this.saveCookies();
    return user;
  }

  /* ---------- 增量合并Cookie（定时同步专用） ----------
     浏览器罐里的Cookie会随时间部分消失（session cookie），整体替换会把服务端已有
     的会员凭证冲掉 → "登录几小时后会员没了"。所以同步只做合并：
       · 新Cookie里有值的键 → 更新
       · 新Cookie里没有的键 → 保留服务端原有的
       · 关键凭证（qm_keyst/psrf_*）只有当值不同且新值非空时才替换 */
  mergeCookieRaw(raw) {
    const v = String(raw || '').trim();
    if (!v) return false;
    const cur = {};
    (this.cookie || '').split(';').forEach(p => {
      const i = p.indexOf('=');
      if (i > 0) cur[p.slice(0, i).trim()] = p.slice(i + 1).trim();
    });
    const incoming = {};
    v.split(';').forEach(p => {
      const i = p.indexOf('=');
      if (i > 0) incoming[p.slice(0, i).trim()] = p.slice(i + 1).trim();
    });
    if (!incoming.uin || incoming.uin === '0') return false;
    if (!incoming.qm_keyst && !incoming.qqmusic_key && !cur.qm_keyst && !cur.qqmusic_key) return false;
    /* 合并：先带上服务端已有的全部键，再用新值覆盖 */
    const merged = Object.assign({}, cur);
    let changed = 0;
    Object.keys(incoming).forEach(k => {
      if (!incoming[k]) return;
      if (merged[k] !== incoming[k]) changed++;
      merged[k] = incoming[k];
    });
    const mergedKeys = Object.keys(merged).length;
    /* 保护：合并后键数不应明显少于原Cookie（防止异常短Cookie把凭证冲淡） */
    const curKeys = Object.keys(cur).length;
    if (curKeys > 15 && mergedKeys < curKeys) {
      console.log('[QQ] 跳过Cookie合并（键数异常 ' + mergedKeys + ' < ' + curKeys + '）');
      return false;
    }
    this.cookie = Object.entries(merged).map(([k, val]) => k + '=' + val).join('; ');
    this.saveCookies();
    if (changed) console.log('[QQ] Cookie合并更新 ' + changed + ' 项，共 ' + mergedKeys + ' 键');
    return true;
  }

  logout() { this.cookie = ''; this.saveCookies(); }

  /* 底层：musicu.fcg 统一网关（POST JSON）。空结果自动退避重试（游客软限流） */
  _musicu(payload, retries = 3) {
    return new Promise((resolve, reject) => {
      const attempt = (left) => {
        const data = JSON.stringify(payload);
        const u = new URL('https://u.y.qq.com/cgi-bin/musicu.fcg');
        const headers = {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          'Origin': 'https://y.qq.com',
          'Referer': REF,
          'User-Agent': UA,
          'Cookie': this.cookie || ''
        };
        const req = https.request(u, { method: 'POST', headers }, res => {
          let d = '';
          res.on('data', c => { d += c; });
          res.on('end', () => {
            let j = null;
            try { j = JSON.parse(d); } catch (e) { }
            const okWrap = j && (j.code === 0 || j.code === undefined);
            // 软限流的特征：HTTP 200 + 业务码0 + 数据体为空对象/空列表
            const emptyBody = (() => {
              if (!j) return true;
              const keys = Object.keys(payload).filter(k => k !== 'comm');
              for (const k of keys) {
                const seg = j[k];
                if (!seg || seg.code !== 0) return false; // 明确错误不重试
                const dd = seg.data || {};
                const lists = [];
                const walk = (o, depth) => {
                  if (depth > 4 || !o || typeof o !== 'object') return;
                  if (Array.isArray(o)) lists.push(o);
                  else Object.values(o).forEach(v => walk(v, depth + 1));
                };
                walk(dd, 0);
                if (lists.length && lists.every(l => !l.length)) return true;
                if (!lists.length && !Object.keys(dd).length) return true;
              }
              return false;
            })();
            if (okWrap && emptyBody && left > 0) {
              setTimeout(() => attempt(left - 1), 1100 + (retries - left) * 500);
              return;
            }
            resolve(j);
          });
        });
        req.on('error', () => {
          if (left > 0) { setTimeout(() => attempt(left - 1), 900); return; }
          reject(new Error('QQ音乐网络请求失败'));
        });
        req.setTimeout(15000, () => { try { req.destroy(new Error('timeout')); } catch (e) { } });
        req.write(data);
        req.end();
      };
      attempt(retries);
    });
  }

  /* 底层：GET 形式接口（c.y.qq.com 老端点） */
  _get(url, extraHeaders) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request(u, {
        method: 'GET',
        headers: Object.assign({ 'Referer': REF, 'User-Agent': UA, 'Cookie': this.cookie || '' }, extraHeaders || {})
      }, res => {
        let d = '';
        res.on('data', c => { d += c; });
        res.on('end', () => resolve(d));
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { try { req.destroy(new Error('timeout')); } catch (e) { } });
      req.end();
    });
  }

  /* ---------- 账号 ---------- */
  async profile() {
    // 1) 首页接口拿昵称头像（登录后可用）
    try {
      const d = await this._get('https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_home_page.fcg?cid=205360838&reqtype=3&loginUin=' + this.uinNum + '&hostUin=' + this.uinNum + '&g_tk=' + this.gtk + '&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0');
      const j = JSON.parse(d);
      const c = j && j.data && j.data.creator;
      if (c && (c.nick || c.name)) {
        return { name: stripTags(c.nick || c.name), avatar: c.headpic ? ('https://' + String(c.headpic).replace(/^\/\//, '')) : '', uin: this.uinNum, vip: !!(c.vip || c.vipType) };
      }
    } catch (e) { }
    // 2) 兜底：只要Cookie有效就算登录，展示QQ号
    if (this.uinNum !== '0' && /(?:qm_keyst|qqmusic_key)=[^;\s]+/.test(this.cookie)) {
      return { name: 'QQ用户 ' + this.uinNum, avatar: '', uin: this.uinNum, vip: false };
    }
    return null;
  }

  /* ---------- 搜索（版本宇宙/后续功能用） ---------- */
  async search(keyword, page = 1, size = 20) {
    const j = await this._musicu({
      comm: { ct: 19, cv: 1845, uin: this.uinNum },
      req: { method: 'DoSearchForQQMusicDesktop', module: 'music.search.SearchCgiService', param: { search_type: 0, query: String(keyword || '').slice(0, 80), page_num: page, num_per_page: size } }
    });
    const seg = j && j.req;
    if (!seg || seg.code !== 0) throw new Error('QQ音乐搜索失败(' + (seg && seg.code) + ')');
    const songs = (((seg.data || {}).body || {}).song || {}).list || [];
    return songs.map(s => this._mapSong(s));
  }
  _mapSong(s) {
    const interval = s.interval || (s.file && s.file.media_mid ? 0 : 0) || 0;
    return {
      qmid: s.mid || (s.file && s.file.media_mid) || '',
      title: stripTags(s.name || s.title || ''),
      artist: (s.singer || []).map(x => x.name).join('/'),
      album: (s.album && s.album.name) || '',
      pic: s.album && s.album.mid ? 'https://y.gtimg.cn/music/photo_new/T002R300x300M000' + s.album.mid + '.jpg' : '',
      duration: s.interval || 0,
      vip: !!(s.pay && (s.pay.pay_play || s.pay.paytrackprice || s.pay.paytrackinfo)),
      mediaMid: (s.file && s.file.media_mid) || s.mid || ''
    };
  }

  /* ---------- 歌单（现行 musicu 模块，老 fcg 接口已全部404下线） ---------- */
  async userPlaylists() {
    const uin = this.uinNum;
    if (uin === '0') throw new Error('QQ音乐未登录');
    const KEY = 'music.musicasset.PlaylistBaseRead';
    const j = await this._musicu({
      comm: { ct: 24, cv: 0, uin },
      [KEY]: { method: 'GetPlaylistByUin', module: KEY, param: { uin: String(uin) } }
    });
    const seg = j && j[KEY];
    if (!seg || seg.code !== 0) throw new Error('QQ音乐歌单获取失败(code=' + (seg && seg.code) + ')');
    const pls = (seg.data && seg.data.v_playlist) || [];
    return pls.filter(p => p && p.tid).map(p => ({
      id: String(p.tid),
      name: stripTags(p.dirName || ('歌单' + p.tid)),
      trackCount: p.songNum || 0,
      cover: (p.picUrl || p.bigpicUrl || '').replace(/^http:\/\//, 'https://'),
      special: false
    }));
  }
  async playlistDetail(tid) {
    const uin = this.uinNum;
    const KEY = 'music.srfDissInfo.DissInfo';
    const cacheKey = 'pl:' + tid;
    const hit = this._plCache.get(cacheKey);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data; // 10分钟内复用，少打接口避免限流

    const out = [];
    let dirinfo = null, total = 0;
    const PAGE = 100;
    /* 单页请求：空列表但歌单非空 → 视为限流，退避重试 */
    const fetchPage = async (begin, onlysonglist, wantRetry) => {
      let songs = [], d = {};
      for (let attempt = 0; attempt < (wantRetry ? 3 : 1); attempt++) {
        const j = await this._musicu({
          comm: { ct: 24, cv: 0, uin },
          [KEY]: { method: 'CgiGetDiss', module: KEY, param: { disstid: Number(tid), dirid: 0, tag: begin === 0, song_begin: begin, song_num: PAGE, userinfo: begin === 0, orderlist: true, onlysonglist } }
        }, 2);
        const seg = j && j[KEY];
        if (!seg || seg.code !== 0) throw new Error('QQ音乐歌单获取失败(code=' + (seg && seg.code) + ')');
        d = seg.data || {};
        if (begin === 0 && !dirinfo) dirinfo = d.dirinfo || {};
        total = d.total_song_num || total;
        songs = d.songlist || [];
        if (songs.length || !(total > 0)) break;
        await sleep(800 + attempt * 600); // 限流退避
      }
      return songs;
    };
    // 首页拿元信息与总数
    const first = await fetchPage(0, false, true);
    if (first.length) out.push(...first);
    // 其余页并发拉取（3路），大歌单从十几秒压到几秒
    const capped = Math.min(total || first.length, 2500);
    const pages = Math.ceil(capped / PAGE);
    if (pages > 1 && first.length) {
      const results = new Array(pages);
      let cursor = 1;
      const worker = async () => {
        while (cursor < pages) {
          const p = cursor++;
          try {
            results[p] = await fetchPage(p * PAGE, true, false);
          } catch (e) { results[p] = []; } // 单页失败不拖垮整体
          await sleep(120);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      for (let p = 1; p < pages; p++) {
        const songs = results[p];
        if (!songs || !songs.length) break; // 断档就停，保持顺序连续
        out.push(...songs);
      }
    }
    if (!out.length && total > 0) {
      // 歌单不是空的但一首都没拿到：明确报限流，前端会显示"重试"
      throw new Error('QQ音乐暂时没返回歌曲（接口限流），请稍后点重试');
    }
    const data = {
      id: String((dirinfo && dirinfo.id) || tid),
      name: stripTags((dirinfo && dirinfo.title) || 'QQ音乐歌单'),
      trackCount: total || out.length,
      cover: ((dirinfo && dirinfo.picurl) || '').replace(/^http:\/\//, 'https://'),
      tracks: out.map(s => this._mapSong(s))
    };
    this._plCache.set(cacheKey, { at: Date.now(), data });
    return data;
  }

  /* 快速首页：只拉第一页（约1秒），前端先渲染，其余页后台补全 */
  async playlistDetailFirst(tid) {
    const KEY = 'music.srfDissInfo.DissInfo';
    const hit = this._plCache.get('pl:' + tid);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return Object.assign({}, hit.data, { pending: false });
    const uin = this.uinNum;
    let dirinfo = null, total = 0, songs = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const j = await this._musicu({
        comm: { ct: 24, cv: 0, uin },
        [KEY]: { method: 'CgiGetDiss', module: KEY, param: { disstid: Number(tid), dirid: 0, tag: true, song_begin: 0, song_num: 100, userinfo: true, orderlist: true, onlysonglist: false } }
      }, 2);
      const seg = j && j[KEY];
      if (!seg || seg.code !== 0) throw new Error('QQ音乐歌单获取失败(code=' + (seg && seg.code) + ')');
      const d = seg.data || {};
      if (!dirinfo) dirinfo = d.dirinfo || {};
      total = d.total_song_num || 0;
      songs = d.songlist || [];
      if (songs.length || !(total > 0)) break;
      await sleep(800 + attempt * 600);
    }
    if (!songs.length && total > 0) throw new Error('QQ音乐暂时没返回歌曲（接口限流），请稍后点重试');
    return {
      id: String((dirinfo && dirinfo.id) || tid),
      name: stripTags((dirinfo && dirinfo.title) || 'QQ音乐歌单'),
      trackCount: total || songs.length,
      cover: ((dirinfo && dirinfo.picurl) || '').replace(/^http:\/\//, 'https://'),
      tracks: songs.map(s => this._mapSong(s)),
      pending: (total || songs.length) > songs.length
    };
  }

  /* ---------- 播放直链（现行 UrlGetVkey 模块） ----------
     一次请求同时带 M800/M500/RS02 三个前缀（vkey API 的 filename 是数组，
     返回的 midurlinfo 也是数组按序对应）→ 从中挑第一个有 purl 的 → 只需1次网络往返
     （之前 M800 失败后再调 RS02 要2次往返，延迟翻倍）
     VIP歌曲：M800/M500 返回空purl(needbuy=1)，RS02 能拿到可用直链
     vkey 结果缓存 10 分钟：重复播放/预解析不重复打接口 */
  async songUrl(mid, mediaMid, pref) {
    pref = pref || 'auto';
    this._vkeyCache = this._vkeyCache || new Map();
    const mm = mediaMid || '';
    const ck = mid + '|' + mm + '|' + pref; // 缓存键必须含偏好：否则 auto 的 320k 结果会被 save/high 复用
    const hit = this._vkeyCache.get(ck);
    if (hit && Date.now() - hit.at < 600000) return hit;
    const KEY = 'music.vkey.GetVkey.UrlGetVkey';
    const base = mm ? mm : (mid + mid);
    /* 音质阶梯：AI00=Hi-Res无损(会员) → F000=无损FLAC(会员) → M800=320k → M500=128k → RS02=兜底MP3。
       一次请求带全部前缀，服务端按权限/资源情况返回对应 purl，挑最优的用 */
    const names = ['AI00' + base + '.flac', 'F000' + base + '.flac', 'M800' + base + '.mp3', 'O800' + base + '.ogg', 'M500' + base + '.mp3', 'O600' + base + '.ogg', 'RS02' + base + '.mp3'];
    const typeLabel = { AI00: 'Hi-Res无损', F000: '无损FLAC', M800: 'mp3 320k', O800: 'ogg 320k', M500: 'mp3 128k', O600: 'ogg 192k', RS02: 'mp3' };
    const j = await this._musicu({
      comm: { ct: 19, cv: 0, uin: this.uinNum },
      [KEY]: { method: 'UrlGetVkey', module: 'music.vkey.GetVkey', param: { filename: names, guid: this.guid, songmid: [mid], songtype: [0] } }
    }, 2);
    const seg = j && j[KEY];
    if (!seg || seg.code !== 0) {
      const c = seg ? seg.code : -1;
      const msg = String((seg && seg.data && seg.data.msg) || '');
      /* 104009 / invalidq = 服务端不认这个登录态（key过期），不是"没会员"。
         必须区分，否则用户会一直看到"需要VIP"这种误导提示 */
      if (c === 104009 || /invalid/i.test(msg)) {
        this._vkeyCache.clear();
        return { url: null, code: c, needLogin: true };
      }
      return { url: null, code: c };
    }
    const infos = (seg.data || {}).midurlinfo || [];
    /* data.uin 为空 = 登录态没生效（同样不是会员问题） */
    /* midurlinfo[i] 按序对应 filename[i]：挑第一个有 purl 的（顺序即音质从高到低） */
    /* 音质偏好：auto=最高可用；high=320k封顶（跳过无损档）；save=128k省流（只用标准档） */
    const allow = (pre) => {
      if (pref === 'high') return pre !== 'AI00' && pre !== 'F000';
      if (pref === 'save') return pre === 'M500' || pre === 'O600' || pre === 'RS02';
      return true;
    };
    for (let i = 0; i < infos.length; i++) {
      const mi = infos[i];
      const purl = mi.purl || '';
      if (!purl) continue;
      const pre = (names[i] || '').slice(0, 4);
      if (!allow(pre)) continue;
      const type = typeLabel[pre] || 'mp3';
      const url = /^https?:\/\//.test(purl) ? purl : 'https://isure.stream.qqmusic.qq.com/' + purl;
      const r = { url, type, needbuy: mi.pneedbuy, flac: pre === 'AI00' || pre === 'F000' };
      this._vkeyCache.set(ck, Object.assign({ at: Date.now() }, r));
      if (this._vkeyCache.size > 120) { const fk = this._vkeyCache.keys().next().value; this._vkeyCache.delete(fk); }
      return r;
    }
    /* 所有档位都没 purl：走网页端通道兜底（官方网页播放器同款请求）。
       绿钻/普通用户对 VIP 歌也能拿到 320k 全曲——ct19 桌面标识下服务器会全部拒绝，
       但 ct24+GetVkeyServer+CgiGetVkey+loginflag 会按网页播放器权限发放 */
    const fb = await this._songUrlWeb(mid, base, pref);
    if (fb && fb.url) {
      this._vkeyCache.set(ck, Object.assign({ at: Date.now() }, fb));
      if (this._vkeyCache.size > 120) { const fk = this._vkeyCache.keys().next().value; this._vkeyCache.delete(fk); }
      return fb;
    }
    /* 两个通道都没 purl：区分原因，避免一律误报"需要绿钻" */
    const anyBuy = infos.some(mi => mi && (mi.pneedbuy === 1 || mi.result === 104003));
    const noLicense = infos.every(mi => mi && (mi.result === 101404 || mi.result === 101405));
    if (noLicense) return { url: null, code: 0, noLicense: true };
    if (anyBuy) return { url: null, code: 0, needbuy: 1, paidSong: true };
    return { url: null, code: 0 };
  }

  /* ---------- 网页端兜底通道：vkey.GetVkeyServer / CgiGetVkey ----------
     与官方网页播放器同款：ct=24 + loginflag=1 + uids。
     桌面端标识(ct=19)对非豪华账号全档位拒绝，网页端会发放 320k 全曲播放权 */
  async _songUrlWeb(mid, base, pref) {
    const KEY = 'req_1';
    const names = pref === 'save'
      ? ['M500' + base + '.mp3', 'RS02' + base + '.mp3', 'C400' + base + '.m4a']
      : ['M800' + base + '.mp3', 'M500' + base + '.mp3', 'RS02' + base + '.mp3', 'C400' + base + '.m4a'];
    const typeLabel = { M800: 'mp3 320k', M500: 'mp3 128k', RS02: 'mp3', C400: 'm4a 96k' };
    const j = await this._musicu({
      comm: { uin: this.uinNum, format: 'json', ct: 24, cv: 0 },
      [KEY]: { module: 'vkey.GetVkeyServer', method: 'CgiGetVkey', param: { guid: this.guid, songmid: [mid], filename: names, songtype: [0], loginflag: 1, uids: [this.uinNum] } }
    }, 1);
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
  }


  /* ---------- 播放时长上报：官网播放器 listenReport 同款通道 ----------
     让QQ账号的最近播放/听歌时长/成长值正常累计。mid→数字songId 需查详情（缓存） */
  async reportPlay(mid, seconds) {
    if (!this.loggedIn) return { ok: false, reason: 'notlogin' };
    const midS = String(mid || '').trim();
    if (!/^[0-9A-Za-z]{5,64}$/.test(midS)) return { ok: false, reason: 'badmid' };
    const sec = Math.max(1, Math.min(parseInt(seconds) || 0, 1800));
    this._songIdCache = this._songIdCache || new Map();
    let songId = this._songIdCache.get(midS) || '';
    if (!/^[1-9]\d*$/.test(songId)) {
      const j = await this._musicu({
        comm: { ct: 24, cv: 0, uin: this.uinNum },
        songinfo: { module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq', param: { song_mid: midS } }
      }, 1);
      const info = (j && j.songinfo && j.songinfo.data) || {};
      const track = info.track_info || {};
      if (String(track.mid || '') !== midS) return { ok: false, reason: 'nodetail' };
      songId = String(track.id || '');
      if (!/^[1-9]\d*$/.test(songId)) return { ok: false, reason: 'noid' };
      this._songIdCache.set(midS, songId);
      if (this._songIdCache.size > 200) this._songIdCache.delete(this._songIdCache.keys().next().value);
    }
    const qs = new URLSearchParams({
      Count: '1', Fqq: this.uinNum, Fguid: this.guid, Ffromtag1: '10050', Ffromtag2: songId,
      Fsong_id: songId, Fplay_time: String(sec), Fstart_time: String(Math.floor(Date.now() / 1000)),
      Ftype: '3', Fversion: '1', Fid1: '0'
    });
    const resp = await this._get('https://stat6.y.qq.com/pc/fcgi-bin/cgi_music_webreport.fcg?' + qs.toString());
    return { ok: true, sec, songId };
  }

  /* ---------- 音质诊断：逐档位测试本账号能用哪一档 ----------
     用途：用户"会员歌播不了"时，一眼看出是没登录、还是该档位需要豪华VIP */
  async probeQualities(mid, mediaMid) {
    const base = mediaMid || (mid + mid);
    const KEY = 'music.vkey.GetVkey';
    const names = ['AI00' + base + '.flac', 'F000' + base + '.flac', 'M800' + base + '.mp3', 'O800' + base + '.ogg', 'M500' + base + '.mp3', 'O600' + base + '.ogg', 'RS02' + base + '.mp3'];
    const label = { AI00: 'Hi-Res无损(需豪华VIP)', F000: '无损FLAC(需豪华VIP)', M800: '320k MP3(绿钻)', O800: '320k OGG(绿钻)', M500: '128k MP3(绿钻)', O600: '192k OGG(绿钻)', RS02: '标准MP3(绿钻)' };
    const j = await this._musicu({
      comm: { ct: 19, cv: 0, uin: this.uinNum, format: 'json' },
      [KEY]: { method: 'UrlGetVkey', module: 'music.vkey.GetVkey', param: { filename: names, guid: this.guid, songmid: [mid], songtype: [0] } }
    }, 1);
    const seg = j && j[KEY];
    if (!seg) return { ok: false, msg: '接口无响应' };
    const infos = ((seg.data || {}).midurlinfo) || [];
    const rows = names.map((n, i) => {
      const mi = infos[i] || {};
      const pre = n.slice(0, 4);
      return {
        quality: label[pre] || pre,
        available: !!mi.purl,
        result: mi.result || 0,
        reason: mi.purl ? '可用' : (mi.result === 22 ? '该档位无音源' : mi.result === 101404 ? '无版权/该档位不存在' : mi.result === 104003 ? '需购买' : (mi.pneedbuy === 1 ? '需会员' : '不可用'))
      };
    });
    /* 网页端兜底通道实测：官方网页播放器同款请求，非豪华账号常从这里拿到 320k 全曲 */
    try {
      const base = mediaMid || (mid + mid);
      const fb = await this._songUrlWeb(mid, base);
      rows.push({ quality: '网页通道(兜底)', available: !!(fb && fb.url), result: 0, reason: fb && fb.url ? '可用 · ' + (fb.type || 'mp3') : '不可用' });
    } catch (e) {
      rows.push({ quality: '网页通道(兜底)', available: false, result: 0, reason: '检测失败: ' + (e.message || e) });
    }
    return { ok: true, loggedIn: !!(this.cookie && /qm_keyst|qqmusic_key/.test(this.cookie)), rows };
  }

  /* ---------- 每日推荐30首：推荐流找当日动态歌单(subtype 510) → CgiGetDiss 拉曲目 ---------- */
  async dailyRecommend() {
    if (!this.loggedIn) throw new Error('QQ音乐未登录');
    const j = await this._musicu({
      comm: { ct: 24, cv: 0, uin: this.uinNum, format: 'json' },
      feed: { module: 'music.recommend.RecommendFeed', method: 'get_recommend_feed', param: { direction: 0, page: 1, v_cache: [], v_uniq: [], s_num: 0 } }
    }, 2);
    const shelves = ((((j || {}).feed || {}).data || {}).v_shelf) || [];
    let card = null;
    for (const sh of shelves) for (const nc of (sh.v_niche || [])) for (const c of (nc.v_card || [])) {
      if (c && c.subtype === 510) card = c;
    }
    if (!card || !card.id) throw new Error('QQ音乐日推入口未找到');
    const d2 = await this._musicu({
      comm: { ct: 24, cv: 0, uin: this.uinNum, format: 'json' },
      playlist: { module: 'music.srfDissInfo.DissInfo', method: 'CgiGetDiss', param: { disstid: Number(card.id), dirid: 0, tag: false, song_begin: 0, song_num: 30, userinfo: false, orderlist: true, onlysonglist: false } }
    }, 2);
    const pd = (((d2 || {}).playlist || {}).data) || {};
    const list = pd.songlist || [];
    if (!list.length) throw new Error('QQ音乐每日推荐暂时为空（接口限流），稍后再试');
    return { label: 'QQ音乐每日30首', items: list.map(s => this._mapSong(s)).slice(0, 30) };
  }

  /* ---------- 歌词（LRC → [{t,text}]） ---------- */
  async lyric(mid) {
    const d = await this._get('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=' + encodeURIComponent(mid) + '&pcachetime=' + Date.now() + '&g_tk=5381&loginUin=' + this.uinNum + '&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0');
    let j = null;
    try { j = JSON.parse(d); } catch (e) { }
    if (!j || j.retcode !== 0 || !j.lyric) return null;
    const lines = parseLrc(Buffer.from(j.lyric, 'base64').toString('utf8'));
    return { lines: lines.filter(l => l.text), sourceLabel: 'QQ音乐歌词' };
  }
}

module.exports = QQMusic;
