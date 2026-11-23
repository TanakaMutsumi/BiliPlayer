'use strict';
/* B站接口客户端：Cookie 管理、扫码登录、收藏夹、搜索(WBI)、播放地址解析 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const wbi = require('./wbi');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const AUDIO_PRIORITY = [30251, 30250, 30280, 30232, 30216]; // Hi-Res > 杜比 > 192k > 128k > 64k
const AUDIO_LABEL = { 30251: 'Hi-Res', 30250: '杜比', 30280: '192kbps', 30232: '128kbps', 30216: '64kbps' };
const QN_LABEL = { 16: '360p', 32: '480p', 64: '720p', 74: '720p60', 80: '1080p', 112: '1080p+', 116: '1080p60', 120: '4K', 125: 'HDR', 126: '杜比视界', 127: '4K' };
/* B站自家/合作CDN后缀；其余第三方PCDN域名通过 /upgcxcode/ 路径特征兜底放行 */
const CDN_SUFFIXES = ['.bilivideo.com', '.bilivideo.cn', '.akamaized.net', '.szbdyd.com'];

/* 歌词检索缓存（1小时）：同歌重复播放/切歌不再连打网易搜索与LRCLIB，既快又省风控配额 */
const _lyrCache = new Map();
function lyrCacheGet(k) { const h = _lyrCache.get(k); if (h && Date.now() - h.at < 3600 * 1000) return h.v; return undefined; }
function lyrCacheSet(k, v) {
  _lyrCache.set(k, { v, at: Date.now() });
  if (_lyrCache.size > 120) _lyrCache.delete(_lyrCache.keys().next().value);
}

function goodCdnHost(u) {
  try { const h = new URL(u).hostname; return CDN_SUFFIXES.some(s => h.endsWith(s)); } catch { return false; }
}
/* 从 baseUrl + backupUrl 里挑一个稳定的CDN地址 */
function pickStreamUrl(item) {
  const urls = [item.baseUrl || item.base_url, ...((item.backupUrl || item.backup_url) || [])].filter(Boolean);
  if (!urls.length) throw new Error('未获取到可用的流地址');
  return urls.find(u => goodCdnHost(u)) || urls[0];
}

function request(url, { headers = {}, method = 'GET', timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(u, { method, headers, timeout }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.end();
  });
}

function parseSetCookies(arr) {
  const out = {};
  (arr || []).forEach(c => {
    const m = c.match(/^([^=\s]+)=([^;]*)/);
    if (m) out[m[1]] = m[2];
  });
  return out;
}

/* LRC 歌词文本 → [{t(秒), text}]，支持一行多时间戳，跳过元数据行 */
function parseLrc(lrc) {
  const lines = [];
  if (!lrc) return lines;
  const lineRe = /^((?:\[\d+:\d+(?:\.\d+)?\])+)(.*)$/;
  const tsRe = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
  for (const raw of String(lrc).split(/\r?\n/)) {
    const m = raw.match(lineRe);
    if (!m) continue;
    const text = m[2].trim();
    if (!text) continue;
    if (/^(作词|作曲|编曲|作詞|作曲|編曲|制作|製作|监制|監製|填词|填詞|谱曲|譜曲|和声|和聲|混音|母带|母帶|录音|錄音|LRC|歌词|歌詞|演唱|编配)/.test(text)) continue;
    let tm;
    tsRe.lastIndex = 0;
    while ((tm = tsRe.exec(m[1]))) {
      lines.push({ t: parseInt(tm[1]) * 60 + parseFloat(tm[2]), text });
    }
  }
  lines.sort((a, b) => a.t - b.t);
  // LRC 只有行首时间：用下一行起点当行尾；长间奏按字数收紧，
  // 避免整句歌词被摊进几十秒空白（与 Folia 的行尾估算思路一致）。
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    if (!next) { line.end = line.t + 5; continue; }
    let gap = next.t - line.t;
    const chars = Array.from(line.text).length;
    if (gap > 5 && gap > chars * 0.5 + 2) gap = chars * 0.5 + 2;
    line.end = line.t + Math.max(0.6, gap);
  }
  return lines;
}

function stripTags(s) {
  return String(s || '').replace(/<em[^>]*>/g, '').replace(/<\/em>/g, '');
}

class Bilibili {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.cookieFile = path.join(dataDir, 'cookies.json');
    this.cookies = this._load();
    this._wbi = null;
    this._viewCache = new Map();
  }

  get ua() { return UA; }

  _load() {
    try { return JSON.parse(fs.readFileSync(this.cookieFile, 'utf8')); } catch { return {}; }
  }
  _save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.cookieFile, JSON.stringify(this.cookies, null, 2));
  }
  _absorb(res) {
    const sc = parseSetCookies(res.headers['set-cookie']);
    let changed = false;
    for (const [k, v] of Object.entries(sc)) {
      if (this.cookies[k] !== v) { this.cookies[k] = v; changed = true; }
    }
    if (changed) this._save();
  }
  cookieHeader() {
    return Object.entries(this.cookies).map(([k, v]) => k + '=' + v).join('; ');
  }
  logout() {
    this.cookies = {};
    try { fs.unlinkSync(this.cookieFile); } catch {}
  }

  async warmup() {
    try { await this._ensureBuvid(); } catch (e) { console.error('[warmup]', e.message); }
  }

  /* 匿名搜索也需要 buvid3/buvid4，提前取好 */
  async _ensureBuvid() {
    if (this.cookies.buvid3 && this.cookies.buvid4) return;
    try {
      const r = await request('https://api.bilibili.com/x/frontend/finger/spi', { headers: { 'User-Agent': UA } });
      this._absorb(r);
      const j = JSON.parse(r.body.toString('utf8'));
      if (j.code === 0 && j.data) {
        this.cookies.buvid3 = j.data.b_3;
        this.cookies.buvid4 = j.data.b_4;
        this._save();
      }
    } catch (e) { console.error('[buvid]', e.message); }
  }

  _baseHeaders(referer) {
    return {
      'User-Agent': UA,
      'Referer': referer || 'https://www.bilibili.com/',
      'Accept': 'application/json, text/plain, */*',
      'Cookie': this.cookieHeader()
    };
  }

  async _get(base, params, { referer = '', sign = false } = {}) {
    let qs = '';
    if (params) {
      if (sign) {
        const key = await this._wbiKey();
        qs = '?' + wbi.signQuery(params, key);
      } else {
        qs = '?' + new URLSearchParams(params).toString();
      }
    }
    const r = await request(base + qs, { headers: this._baseHeaders(referer) });
    this._absorb(r);
    let j;
    try { j = JSON.parse(r.body.toString('utf8')); } catch { throw new Error('B站接口返回异常 (HTTP ' + r.status + ')'); }
    if (typeof j.code === 'number' && j.code !== 0) {
      const err = new Error(j.message || ('B站错误码 ' + j.code));
      err.code = j.code;
      throw err;
    }
    return j.data !== undefined ? j.data : j;
  }

  async _wbiKey() {
    if (this._wbi && Date.now() - this._wbi.t < 3600e3) return this._wbi.k;
    const d = await this._get('https://api.bilibili.com/x/web-interface/nav', null, {});
    if (!d.wbi_img) throw new Error('获取WBI密钥失败');
    const img = d.wbi_img.img_url.split('/').pop().split('.')[0];
    const sub = d.wbi_img.sub_url.split('/').pop().split('.')[0];
    this._wbi = { t: Date.now(), k: wbi.mixinKey(img + sub) };
    return this._wbi.k;
  }

  /* ---------- 用户 / 登录 ---------- */
  async userInfo() {
    const d = await this._get('https://api.bilibili.com/x/web-interface/nav', null, {});
    return {
      isLogin: !!d.isLogin,
      mid: d.mid || 0,
      uname: d.uname || '',
      face: d.face || '',
      level: (d.level_info && d.level_info.current_level) || 0,
      vip: !!d.vipStatus
    };
  }

  async qrcodeGenerate() {
    const d = await this._get('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', null, {});
    return { url: d.url, key: d.qrcode_key };
  }

  async qrcodePoll(key) {
    const d = await this._get('https://passport.bilibili.com/x/passport-login/web/qrcode/poll', { qrcode_key: key }, {});
    const code = d.code;
    const map = { 86101: '未扫描', 86090: '已扫描，请在手机上确认', 86038: '二维码已过期', 0: '登录成功' };
    let user = null;
    if (code === 0) user = await this.userInfo();
    return { status: code, ok: code === 0, expired: code === 86038, message: map[code] || d.message || '', user };
  }

  /* ---------- 收藏夹 ---------- */
  async _requireLogin() {
    const me = await this.userInfo();
    if (!me.isLogin) {
      const e = new Error('未登录，请先扫码登录');
      e.code = -101;
      throw e;
    }
    return me;
  }

  async favFolders() {
    const me = await this._requireLogin();
    const createdRaw = await this._get('https://api.bilibili.com/x/v3/fav/folder/created/list-all', { up_mid: me.mid }, {});
    const created = (createdRaw.list || []).map(f => ({ id: f.id, title: f.title, count: f.media_count }));
    const collected = [];
    for (let pn = 1; pn <= 10; pn++) {
      const d = await this._get('https://api.bilibili.com/x/v3/fav/folder/collected/list', { up_mid: me.mid, pn, ps: 20 }, {});
      (d.list || []).forEach(f => collected.push({ id: f.id, title: f.title, count: f.media_count }));
      if (!d.has_more) break;
    }
    const all = [...created, ...collected].slice(0, 80);
    // 分批补充封面（取收藏夹内第一个视频的封面）
    for (let i = 0; i < all.length; i += 5) {
      await Promise.all(all.slice(i, i + 5).map(async f => {
        try {
          const d = await this._get('https://api.bilibili.com/x/v3/fav/resource/list',
            { media_id: f.id, pn: 1, ps: 1, keyword: '', order: 'mtime', type: 0, tid: 0, platform: 'web' }, {});
          const m = d.medias && d.medias[0];
          f.cover = m ? m.cover : '';
        } catch { f.cover = ''; }
      }));
    }
    return { created, collected };
  }

  _normFav(m) {
    if (!m || !m.bvid) return null; // 过滤失效/非视频条目
    return {
      bvid: m.bvid,
      cid: m.cid || undefined,
      title: m.title,
      up: m.upper ? m.upper.name : '',
      upMid: m.upper ? m.upper.mid : undefined,
      duration: m.duration || 0,
      pic: m.cover || '',
      play: m.cnt_info ? m.cnt_info.play : 0,
      danmaku: m.cnt_info ? m.cnt_info.danmaku : 0,
      intro: m.intro || ''
    };
  }

  async favVideos(mediaId, pn = 1, ps = 20, keyword = '') {
    const d = await this._get('https://api.bilibili.com/x/v3/fav/resource/list',
      { media_id: mediaId, pn, ps, keyword: keyword || '', order: 'mtime', type: 0, tid: 0, platform: 'web' }, {});
    return {
      title: d.info ? d.info.title : '',
      total: d.info ? d.info.media_count : 0,
      hasMore: !!d.has_more,
      items: (d.medias || []).map(m => this._normFav(m)).filter(Boolean)
    };
  }

  async favAll(mediaId) {
    const items = [];
    for (let pn = 1; pn <= 50; pn++) {
      const d = await this._get('https://api.bilibili.com/x/v3/fav/resource/list',
        { media_id: mediaId, pn, ps: 20, keyword: '', order: 'mtime', type: 0, tid: 0, platform: 'web' }, {});
      const medias = (d.medias || []).map(m => this._normFav(m)).filter(Boolean);
      items.push(...medias);
      if (!d.has_more || !medias.length) break;
    }
    return items;
  }

  /* ---------- 搜索 ---------- */
  async search(keyword, pn = 1, opts = {}) {
    const q = { search_type: 'video', keyword, pn, ps: 30 };
    if (opts.order) q.order = opts.order;           // totalrank/click/pubdate/dm/stow
    if (opts.tids) q.tids = opts.tids;              // 分区：29音乐现场 31翻唱 59演奏 193MV
    const d = await this._get('https://api.bilibili.com/x/web-interface/wbi/search/type',
      q, { referer: 'https://search.bilibili.com/', sign: true });
    const items = (d.result || [])
      .filter(r => r.type === 'video')
      .map(r => ({
        bvid: r.bvid,
        aid: r.aid,
        cid: undefined,
        title: r.title,
        up: r.author || '',
        upMid: r.mid,
        duration: this._dur(r.duration),
        pic: r.pic,
        play: r.play || 0,
        danmaku: r.video_review || r.review || 0,
        tag: r.tag || '',
        hit: Array.isArray(r.hit_columns) ? r.hit_columns.join(',') : '',
        typeid: r.typeid || 0
      }));
    return { total: d.numResults || items.length, items };
  }
  /* 搜索联想热词（免WBI）：用B站自己的热度数据扩展关键词变体 */
  async suggest(term) {
    try {
      const d = await this._get('https://s.search.bilibili.com/main/suggest',
        { term, func: 'suggest', suggest_type: 'accurate', sub_type: 'tag', tag_num: 10, main_ver: 'v1' },
        { referer: 'https://search.bilibili.com/' });
      const tags = (d && d.tag) || (d && d.result && d.result.tag) || [];
      return tags.map(t => String(t.value || t.name || '').replace(/<[^>]*>/g, '')).filter(Boolean).slice(0, 10);
    } catch (e) { return []; }
  }
  /* UP主空间关键词检索（免WBI降级正路）：官方live存档/演唱会合集的主来源 */
  async upArchivesByKeyword(mid, kw) {
    const d = await this._get('https://api.bilibili.com/x/series/recArchivesByKeywords',
      { mid, keywords: kw || '', ps: 50, pn: 1, orderby: 'views' }, { referer: 'https://space.bilibili.com/' + mid + '/' });
    const arr = (d && d.archives) || [];
    return arr.map(r => ({
      bvid: r.bvid,
      aid: r.aid,
      cid: undefined,
      title: r.title || r.name || '',
      up: (r.owner && r.owner.name) || (r.author && r.author.name) || '',
      upMid: (r.owner && r.owner.mid) || (r.author && r.author.mid) || mid,
      duration: typeof r.duration === 'number' ? r.duration : this._dur(r.duration || (r.stat && r.stat.duration)),
      pic: r.pic || (r.cover && r.cover.url) || '',
      play: (r.stat && (r.stat.view || r.stat.play)) || r.view || 0,
      danmaku: 0,
      tag: '', hit: '', typeid: 0
    }));
  }

  /* 相关视频（同曲版本的重要来源：B站自己的关联推荐） */
  async relatedVideos(aid) {
    const d = await this._get('https://api.bilibili.com/x/web-interface/archive/related', { aid }, { referer: 'https://www.bilibili.com/' });
    const arr = Array.isArray(d) ? d : (d.list || []);
    return arr.map(r => ({
      bvid: r.bvid,
      aid: r.aid,
      cid: undefined,
      title: r.title,
      up: (r.owner && r.owner.name) || '',
      upMid: (r.owner && r.owner.mid) || 0,
      duration: typeof r.duration === 'number' ? r.duration : this._dur(r.duration),
      pic: r.pic,
      play: (r.stat && r.stat.view) || 0,
      danmaku: 0
    }));
  }

  _dur(s) {
    if (!s) return 0;
    if (typeof s === 'number') return s;
    const parts = String(s).split(':').map(Number);
    return parts.reduce((a, b) => a * 60 + b, 0);
  }

  /* ---------- 弹幕（list.so 为 deflate 压缩的 XML） ---------- */
  async danmaku(cid) {
    if (!/^\d+$/.test(String(cid || ''))) throw new Error('cid 无效');
    const r = await request('https://api.bilibili.com/x/v1/dm/list.so?oid=' + cid,
      { headers: this._baseHeaders('https://www.bilibili.com/'), timeout: 20000 });
    let xml = '';
    try { xml = zlib.inflateSync(r.body).toString('utf8'); }
    catch (e1) {
      try { xml = zlib.inflateRawSync(r.body).toString('utf8'); }
      catch (e2) { xml = r.body.toString('utf8'); if (!/<d /.test(xml)) xml = ''; }
    }
    const out = [];
    const re = /<d p="([^"]+)"[^>]*>([\s\S]*?)<\/d>/g;
    let m;
    while ((m = re.exec(xml)) && out.length < 9000) {
      const p = m[1].split(',');
      const mode = +p[1] || 1;
      if (mode >= 6 || mode < 1) continue; // 6倒放 7高级 8代码 9BFS 不展示
      const text = m[2].replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/[\r\n\t]+/g, ' ').trim();
      if (!text || text.length > 60) continue;
      out.push({ t: +p[0] || 0, mode, size: +p[2] || 25, color: +p[3] || 16777215, text });
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  /* ---------- UP主主页 / 评论 ---------- */
  /* UP主投稿视频列表（WBI 签名） */
  async upVideos(mid, pn = 1) {
    const d = await this._get('https://api.bilibili.com/x/space/wbi/arc/search',
      { mid, pn, ps: 20, order: 'pubdate' }, { referer: 'https://space.bilibili.com/' + mid + '/', sign: true });
    const items = ((d.list && d.list.vlist) || []).map(v => ({
      bvid: v.bvid,
      cid: undefined,
      title: v.title,
      up: v.author,
      upMid: v.mid,
      duration: this._dur(v.length),
      pic: v.pic,
      play: v.play,
      danmaku: v.video_review
    }));
    return { total: (d.page && d.page.count) || items.length, items };
  }

  /* UP主资料卡（头像/签名/粉丝数） */
  async upInfo(mid) {
    const d = await this._get('https://api.bilibili.com/x/web-interface/card', { mid, photo: true }, {});
    return {
      mid: d.card.mid,
      name: d.card.name,
      face: d.card.face,
      sign: d.card.sign || '',
      followers: d.follower || 0,
      official: (d.card.official_verify && d.card.official_verify.desc) || ''
    };
  }

  /* 视频评论（按热度排序） */
  async replies(aid, pn = 1) {
    const d = await this._get('https://api.bilibili.com/x/v2/reply',
      { type: 1, oid: aid, pn, ps: 20, sort: 1 },
      { referer: 'https://www.bilibili.com/video/av' + aid + '/' });
    const norm = r => ({
      rpid: r.rpid,
      name: r.member.uname,
      face: r.member.avatar,
      time: r.ctime,
      like: r.like,
      msg: (r.content && r.content.message) || '',
      sub: (r.replies || []).map(norm)
    });
    const items = (d.replies || []).map(norm);
    return { total: (d.page && d.page.acount) || 0, items };
  }

  /* B站字幕（含AI自动生成）转歌词行；无字幕时搜索同名歌曲借用其他视频的字幕 */
  async subtitles(bvid, cid) {
    const key = bvid + '|' + cid;
    if (!this._subCache) this._subCache = new Map();
    const cached = this._subCache.get(key);
    if (cached && Date.now() - cached.t < 600e3) return cached.d;
    const d = await this._subtitlesInner(bvid, cid);
    this._subCache.set(key, { t: Date.now(), d });
    return d;
  }

  /* 只取本视频字幕（不借别的视频/不回落网易云）：供多源歌词编排器当“本视频时间锚点” */
  async ownSubtitle(bvid, cid) {
    try {
      const lines = await this._fetchSubLines(bvid, cid);
      return { lines: lines || [], authRequired: false };
    } catch (e) {
      return { lines: [], authRequired: e && e.code === -101 };
    }
  }

  /* 拉取单个视频的字幕行，无字幕返回 null */
  async _fetchSubLines(bvid, cid) {
    const d = await this._get('https://api.bilibili.com/x/player/wbi/v2',
      { bvid, cid }, { referer: 'https://www.bilibili.com/video/' + bvid + '/', sign: true });
    const subs = (d.subtitle && d.subtitle.subtitles) || [];
    if (!subs.length) return null;
    const pick = subs.find(s => /^ai-zh/.test(s.lan || ''))
      || subs.find(s => /^zh/.test(s.lan || ''))
      || subs[0];
    let url = pick.subtitle_url || '';
    if (!url) return null;
    if (url.startsWith('//')) url = 'https:' + url;
    const r = await request(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.bilibili.com/', 'Cookie': this.cookieHeader() } });
    const j = JSON.parse(r.body.toString('utf8'));
    const lines = (j.body || [])
      .map(l => ({ t: l.from || 0, end: Number(l.to) || 0, text: (l.content || '').trim() }))
      .filter(l => l.text);
    return lines.length ? lines : null;
  }

  /* 清洗标题为搜索关键词：去掉各种括号内容与画质/版本词 */
  _titleToKeyword(title) {
    return String(title || '')
      .replace(/【[^】]*】/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/（[^）]*）/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/完整版|官方MV|官方|纯听|高清|修复|4K|60FPS|60帧|Hi-?Res|无损|音画|现场版|Live|完整|歌词/gi, ' ')
      .replace(/[「」『』"'""'']/g, ' ')
      .replace(/\s*[-–—]\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 24);
  }

  async _subtitlesInner(bvid, cid) {
    let info = null;
    let authRequired = false;
    try { info = await this.videoDetail(bvid); } catch {}
    try {
      const lines = await this._fetchSubLines(bvid, cid);
      if (lines) return { lines, sourceLabel: '本视频的B站AI字幕' };
    } catch (e) {
      if (e && e.code === -101) authRequired = true;
      console.error('[lyrics] 本视频字幕获取失败:', e.message);
    }
    // 兜底1：用清洗后的标题搜索同名歌的其他视频，借用其字幕
    try {
      const kw = info ? this._titleToKeyword(info.title) : '';
      if (kw && kw.length >= 2) {
        let s = null;
        for (let attempt = 0; attempt < 2 && !s; attempt++) {
          try { s = await this.search(kw, 1); }
          catch (e) {
            if (e && e.code === -101) authRequired = true;
            console.error('[lyrics] 兜底搜索失败:', e.message);
            if (attempt === 0) await new Promise(r => setTimeout(r, 1500)); // 风控时稍等重试
          }
        }
        if (s) {
          // 同一首歌的翻唱/live时长必然接近原视频：按时长接近度过滤排序，避免借到错误歌词
          const dur = info ? (info.duration || 0) : 0;
          const cands = s.items
            .filter(v => v.bvid !== bvid)
            .map(v => Object.assign({}, v, { dd: Math.abs((v.duration || 0) - dur) }))
            .filter(v => dur > 0 && v.dd < Math.max(20, dur * 0.3))
            .sort((a, b) => a.dd - b.dd)
            .slice(0, 5);
          for (const cand of cands) {
            try {
              const vd = await this.videoDetail(cand.bvid);
              await new Promise(r => setTimeout(r, 400)); // 候选间隔，降低风控概率
              const lines = await this._fetchSubLines(cand.bvid, vd.cid);
              if (lines && lines.length > 3) {
                return { lines, sourceLabel: '「' + stripTags(cand.title) + '」的B站AI字幕', refDuration: vd.duration || 0 };
              }
            } catch (e) { console.error('[lyrics] 候选失败:', cand.bvid, e.message); }
          }
        }
      }
    } catch (e) { console.error('[lyrics] 兜底流程异常:', e.message); }
    // 兜底2：网易云音乐歌词库（LRC，按时长匹配歌曲版本）
    if (info) {
      try {
        const ne = await this.neteaseLyrics(info.title, info.duration);
        if (ne) return { lines: ne.lines, sourceLabel: '网易云音乐' + (ne.artist ? ' · ' + ne.artist : '') };
      } catch (e) { console.error('[lyrics] 网易云歌词失败:', e.message); }
      // 兜底3：LRCLIB 开放歌词库
      try {
        const lc = await this.lrclibLyrics(info.title, info.duration);
        if (lc) return { lines: lc.lines, sourceLabel: '歌词来自 LRCLIB 开放歌词库' };
      } catch (e) { console.error('[lyrics] LRCLIB歌词失败:', e.message); }
    }
    return { lines: [], sourceLabel: '', authRequired };
  }

  /* 网易云歌词：搜索歌曲（按时长匹配版本）→ 拉LRC → 转时间轴行 */
  async neteaseLyrics(title, durationSec) {
    const kw = this._titleToKeyword(title);
    if (!kw || kw.length < 2) return null;
    const ck = 'ne|' + kw + '|' + Math.round((durationSec || 0) / 5);
    const cached = lyrCacheGet(ck);
    if (cached !== undefined) return cached;
    const s = await request('https://music.163.com/api/search/get/web?s=' + encodeURIComponent(kw) + '&type=1&limit=8',
      { headers: { 'User-Agent': UA, 'Referer': 'https://music.163.com/' } });
    const j = JSON.parse(s.body.toString('utf8'));
    const songs = (j.result && j.result.songs) || [];
    if (!songs.length) { lyrCacheSet(ck, null); return null; }
    let pick = null, bestDd = Infinity;
    for (const song of songs) {
      const dd = Math.abs((song.duration || 0) / 1000 - (durationSec || 0));
      if (dd < bestDd) { bestDd = dd; pick = song; }
    }
    if (!pick || (durationSec && bestDd > 40)) { lyrCacheSet(ck, null); return null; } // 放宽：长intro/间奏的视频时长偏长，时间轴由客户端校正
    const l = await request('https://music.163.com/api/song/lyric?id=' + pick.id + '&lv=1&tv=-1',
      { headers: { 'User-Agent': UA, 'Referer': 'https://music.163.com/' } });
    const lj = JSON.parse(l.body.toString('utf8'));
    const lrc = (lj.lrc && lj.lrc.lyric) || '';
    const lines = parseLrc(lrc);
    if (lines.length < 3) { lyrCacheSet(ck, null); return null; }
    const artist = (pick.artists || []).map(a => a.name).join('/');
    const out = { lines, artist, refDuration: (pick.duration || 0) / 1000 };
    lyrCacheSet(ck, out);
    return out;
  }

  /* LRCLIB 开放歌词库 */
  async lrclibLyrics(title, durationSec) {
    const kw = this._titleToKeyword(title);
    if (!kw || kw.length < 2) return null;
    const ck = 'lr|' + kw + '|' + Math.round((durationSec || 0) / 5);
    const cached = lyrCacheGet(ck);
    if (cached !== undefined) return cached;
    const parts = kw.split(' ');
    const track = parts[0] || kw;
    const artist = parts.slice(1).join(' ');
    const q = 'https://lrclib.net/api/search?track_name=' + encodeURIComponent(track)
      + (artist ? '&artist_name=' + encodeURIComponent(artist) : '');
    const r = await request(q, { headers: { 'User-Agent': 'BiliPlayer/0.9 (personal music player)' } });
    const arr = JSON.parse(r.body.toString('utf8'));
    if (!Array.isArray(arr) || !arr.length) { lyrCacheSet(ck, null); return null; }
    let pick = null, bestDd = Infinity;
    for (const item of arr) {
      const dd = Math.abs((item.duration || 0) - (durationSec || 0));
      if (dd < bestDd) { bestDd = dd; pick = item; }
    }
    if (!pick || (durationSec && bestDd > 40)) { lyrCacheSet(ck, null); return null; }
    const lrc = pick.syncedLyrics || '';
    const lines = parseLrc(lrc);
    if (lines.length < 3) { lyrCacheSet(ck, null); return null; }
    const out = { lines, refDuration: pick.duration || 0 };
    lyrCacheSet(ck, out);
    return out;
  }

  /* ---------- 视频信息 / 播放地址 ---------- */
  async videoDetail(bvid) {
    const c = this._viewCache.get(bvid);
    if (c && Date.now() - c.t < 600e3) return c.d;
    const d = await this._get('https://api.bilibili.com/x/web-interface/view', { bvid },
      { referer: 'https://www.bilibili.com/video/' + bvid + '/' });
    let tags = [];
    try {
      const td = await this._get('https://api.bilibili.com/x/tag/archive/tags', { bvid },
        { referer: 'https://www.bilibili.com/video/' + bvid + '/' });
      tags = (td || []).map(x => x && x.tag_name).filter(Boolean).slice(0, 24);
    } catch (e) {}
    const out = {
      bvid: d.bvid,
      aid: d.aid,
      cid: d.cid,
      title: d.title,
      desc: d.desc || '',
      tags,
      up: d.owner ? d.owner.name : '',
      upMid: d.owner ? d.owner.mid : 0,
      pic: d.pic,
      duration: d.duration,
      pages: (d.pages || []).map(p => ({ cid: p.cid, part: p.part, duration: p.duration }))
    };
    this._viewCache.set(bvid, { t: Date.now(), d: out });
    return out;
  }

  proxy(u) { return '/api/stream?u=' + encodeURIComponent(u); }

  async _playurl(params, referer) {
    return this._get('https://api.bilibili.com/x/player/playurl', params, { referer });
  }

  /* 音频：优先 DASH 音频流（Hi-Res/杜比/192k），并返回全部候选供客户端按 codec 支持回退 */
  async playAudio(bvid, cid) {
    const ref = 'https://www.bilibili.com/video/' + bvid + '/';
    let dashErr = null;
    try {
      const d = await this._playurl({ bvid, cid, fnval: 4048, fnver: 0, fourk: 1, platform: 'pc' }, ref);
      if (d.dash && d.dash.audio && d.dash.audio.length) {
        const list = d.dash.audio;
        const order = a => { const i = AUDIO_PRIORITY.indexOf(a.id); return i < 0 ? 99 : i; };
        const cand = list.slice().sort((a, b) => order(a) - order(b));
        const labelOf = a => {
          const label = AUDIO_LABEL[a.id] || ('id' + a.id);
          const kbps = Math.round((Number(a.bandwidth) || 0) / 1000);
          return label + (!/kbps/.test(label) && kbps ? ' ' + kbps + 'kbps' : '');
        };
        const usable = cand.filter(a => { try { return !!pickStreamUrl(a); } catch (e) { return false; } });
        const pick = usable[0] || cand[0];
        const make = a => ({
          id: a.id,
          quality: labelOf(a),
          url: this.proxy(pickStreamUrl(a)),
          bandwidth: Number(a.bandwidth) || 0,
          codecs: a.codecs || ''
        });
        /* 返回全部候选：客户端按 canPlayType 选第一个可解码的（杜比 ec-3 在 Chromium 上通常不支持） */
        return Object.assign({ type: 'dash-audio' }, make(pick), {
          alts: usable.slice(1).map(make)
        });
      }
      if (d.durl && d.durl.length) return { type: 'mp4', quality: 'mp4', url: this.proxy(d.durl[0].url) };
      dashErr = new Error('未获取到音频流');
    } catch (e) { dashErr = e; }
    const d = await this._playurl({ bvid, cid, qn: 64, platform: 'html5', high_quality: 1 }, ref);
    if (d.durl && d.durl.length) return { type: 'mp4', quality: 'mp4', url: this.proxy(d.durl[0].url) };
    throw dashErr || new Error('未获取到音频流');
  }

  /* 视频：html5 mp4（自带音轨，便于与“听”模式无缝切换） */
  async playVideo(bvid, cid) {
    const ref = 'https://www.bilibili.com/video/' + bvid + '/';
    const d = await this._playurl({ bvid, cid, qn: 64, platform: 'html5', high_quality: 1 }, ref);
    if (d.durl && d.durl.length) {
      return { type: 'mp4', quality: QN_LABEL[d.quality] || 'mp4', url: this.proxy(d.durl[0].url) };
    }
    if (d.dash && d.dash.video && d.dash.video.length) {
      const v = d.dash.video[0];
      return { type: 'dash-video', quality: QN_LABEL[v.id] || '', url: this.proxy(pickStreamUrl(v)) };
    }
    throw new Error('未获取到视频流');
  }

  /* DASH 视频+音频分离：video-only + audio-only，客户端双元素同步。
     优先 AVC 1080p（Chromium 兼容性最好），音频优先 30280/30232 AAC。 */
  async playVideoDash(bvid, cid) {
    const ref = 'https://www.bilibili.com/video/' + bvid + '/';
    const d = await this._playurl({ bvid, cid, fnval: 4048, fnver: 0, fourk: 1, platform: 'pc' }, ref);
    if (!d.dash || !d.dash.video || !d.dash.video.length) throw new Error('未获取到DASH视频流');
    const vs = d.dash.video;
    const as = d.dash.audio || [];
    const v = vs.find(x => x.id === 80 && /^avc1/i.test(x.codecs || '')) ||
      vs.find(x => /^avc1/i.test(x.codecs || '')) ||
      vs.slice().sort((a, b) => (b.height || 0) - (a.height || 0))[0];
    const a = as.find(x => x.id === 30280) || as.find(x => x.id === 30232) || as.find(x => x.id === 30216) || as[0];
    if (!v || !a) throw new Error('未获取到DASH音频流');
    const vq = QN_LABEL[v.id] || (v.height ? v.height + 'p' : 'video');
    const aq = AUDIO_LABEL[a.id] || ('id' + a.id);
    return {
      type: 'dash-av',
      quality: vq + ' · ' + aq,
      videoUrl: this.proxy(pickStreamUrl(v)),
      audioUrl: this.proxy(pickStreamUrl(a)),
      video: { id: v.id, width: v.width || 0, height: v.height || 0, codecs: v.codecs || '', bandwidth: Number(v.bandwidth) || 0 },
      audio: { id: a.id, codecs: a.codecs || '', bandwidth: Number(a.bandwidth) || 0 },
      duration: Number(d.dash.duration) || 0
    };
  }
}

Bilibili.CDN_SUFFIXES = CDN_SUFFIXES;

module.exports = Bilibili;
