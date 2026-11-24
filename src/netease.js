'use strict';
/* 网易云客户端：直接复用 NeteaseCloudMusicApi 官方模块（社区标准实现）
   —— 自己手搓 GET 请求导致扫码永远卡在802：官方是 POST表单 + type=3 +
      iPhone客户端UA + interface.music.163.com域名 + weapi/eapi加密，
      这些细节全部由官方模块处理，这里只做薄封装 */
const fs = require('fs');
const path = require('path');
const os = require('os');

/* 官方 request.js 在 require 时读取 %TMP%/anonymous_token，先确保文件存在 */
const _anonTk = path.resolve(os.tmpdir(), './anonymous_token');
if (!fs.existsSync(_anonTk)) { try { fs.writeFileSync(_anonTk, '', 'utf-8'); } catch (e) {} }

const request = require('NeteaseCloudMusicApi/util/request.js');
const mLoginQrKey = require('NeteaseCloudMusicApi/module/login_qr_key.js');
const mLoginQrCheck = require('NeteaseCloudMusicApi/module/login_qr_check.js');
const mUserAccount = require('NeteaseCloudMusicApi/module/user_account.js');
const mUserPlaylist = require('NeteaseCloudMusicApi/module/user_playlist.js');
const mPlaylistDetail = require('NeteaseCloudMusicApi/module/playlist_detail.js');
const mPlaylistTrackAll = require('NeteaseCloudMusicApi/module/playlist_track_all.js');
const mSongUrl = require('NeteaseCloudMusicApi/module/song_url.js');       // weapi 老接口：取播放地址（网易对它风控宽松得多）

const mSongDetail = require('NeteaseCloudMusicApi/module/song_detail.js');
const mRegisterAnon = require('NeteaseCloudMusicApi/module/register_anonimous.js');
const mSearch = require('NeteaseCloudMusicApi/module/search.js');
  const mHeartbeat = require('NeteaseCloudMusicApi/module/playmode_intelligence_list.js'); // 心动模式
  const mPersonalFm = require('NeteaseCloudMusicApi/module/personal_fm.js');               // 私人漫游FM
  const mPersonalFmMode = require('NeteaseCloudMusicApi/module/personal_fm_mode.js');     // FM 模式（可带数量）
  const mRecommendSongs = require('NeteaseCloudMusicApi/module/recommend_songs.js');       // 每日推荐（漫游兜底）
  const mPersonalizedNewsong = require('NeteaseCloudMusicApi/module/personalized_newsong.js'); // 每日推荐拿不到时的兜底（打包版）
  const mFmTrash = require('NeteaseCloudMusicApi/module/fm_trash.js');                     // 漫游不喜欢
  const mLike = require('NeteaseCloudMusicApi/module/like.js');                            // 红心
  const mSimiSong = require('NeteaseCloudMusicApi/module/simi_song.js');                   // 相似歌曲

function stripTags(s) { return String(s || '').replace(/<em[^>]*>/g, '').replace(/<\/em>/g, ''); }

class NetEase {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.cookie = '';
    this.cookieFile = path.join(dataDir, 'netease_cookies.json');
    this._anonTried = false;
    this.riskUntil = 0; // 风控冷却截止时间：冷却期内快速失败，避免持续请求加深风控
    this.urlCache = new Map(); // nid -> { data, at }：直链缓存，同歌重播/快速来回切不再打 song_url（降低风控概率）
    this.profile = null;        // 账号资料（与 Cookie 分开持久化：Cookie 失效后仍可展示昵称头像）
    this.sessionExpired = false; // MUSIC_U 存在但 profile 拉不到 = 登录已过期
    this._verifyAt = 0;          // 上次登录态校验时间（节流）
    this.profileFile = path.join(dataDir, 'netease_profile.json');
    this.loadProfile();
    this.loadCookies();
  }
  loadProfile() {
    try { this.profile = JSON.parse(fs.readFileSync(this.profileFile, 'utf8')) || null; } catch {}
  }
  saveProfile() {
    try { fs.writeFileSync(this.profileFile, JSON.stringify(this.profile || null)); } catch {}
  }
  get loggedIn() { return /MUSIC_U=[^;\s]/.test(this.cookie); }
  loadCookies() {
    try {
      const j = JSON.parse(fs.readFileSync(this.cookieFile, 'utf8'));
      this.cookie = j.cookie || '';
    } catch {}
  }
  saveCookies() {
    try { fs.writeFileSync(this.cookieFile, JSON.stringify({ cookie: this.cookie }, null, 2)); } catch {}
  }
  _absorb(cookieStr) {
    const incoming = {};
    String(cookieStr || '').split(';').forEach(p => { const m = p.trim().match(/^([^=\s]+)=([^;]*)/); if (m && m[2]) incoming[m[1]] = m[2]; });
    if (incoming.MUSIC_U) {
      // 登录态切换：整体替换，清掉匿名token避免身份混淆
      const keep = {};
      ['MUSIC_U', '__csrf'].forEach(k => { if (incoming[k]) keep[k] = incoming[k]; });
      this.cookie = Object.entries(keep).map(([k, v]) => k + '=' + v).join('; ');
      this.urlCache.clear();
      this.saveCookies();
      return;
    }
    const cur = {};
    this.cookie.split(';').forEach(p => { const m = p.trim().match(/^([^=\s]+)=([^;]*)/); if (m) cur[m[1]] = m[2]; });
    Object.assign(cur, incoming);
    this.cookie = Object.entries(cur).map(([k, v]) => k + '=' + v).join('; ');
  }
  /* 匿名token：官方启动流程同款（register_anonimous），未登录也能查详情/拿直链
     接口偶发400，带重试；成功后吸收整个匿名Cookie（含MUSIC_A/MUSIC_A_T） */
  async _ensureAnonToken() {
    if (this._anonTried || (this.loggedIn && !this.sessionExpired)) return;
    this._anonTried = true;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await mRegisterAnon({ cookie: '' }, request);
        const ck = r && r.body && r.body.cookie;
        if (r && r.body && r.body.code === 200 && ck) { this._absorb(ck); this.saveCookies(); return; }
      } catch (e) { /* 重试 */ }
      await new Promise(res => setTimeout(res, 600));
    }
  }
  /* 统一调官方模块：带cookie，吸收新cookie；风控(-460/网络环境存在风险)自动退避重试 */
  async _mod(mod, query) {
    await this._ensureAnonToken();
    /* 冷却期内快速失败：风控惩罚通常是时间窗，越打越深 */
    if (Date.now() < this.riskUntil) {
      const err = new Error('网易云风控中（冷却 ' + Math.ceil((this.riskUntil - Date.now()) / 1000) + 's）');
      err.code = -460; err.risk = true;
      err.retryAt = this.riskUntil;
      throw err;
    }
    let r = null;
    const waits = [500, 1500]; // 退避两档约2s后放弃进入冷却（旧版7.7s会把切歌挂死太久）
    for (let attempt = 0; ; attempt++) {
      try {
        r = await mod(Object.assign({ cookie: this.cookie }, query || {}), request);
        break;
      } catch (e) {
        const b = (e && e.body) || {};
        const msg = String(b.message || b.msg || '');
        const risk = msg.includes('网络环境存在风险') || b.code === -460 || b.code === 460;
        if (risk) {
          /* 未登录：换匿名设备身份往往能绕过（首次尝试立即换） */
          if (attempt === 0 && !this.loggedIn) {
            this._anonTried = false;
            await this._ensureAnonToken();
            continue;
          }
          /* 已登录或换身份无效：退避等待，仍不行则进入冷却期 */
          if (attempt < waits.length) {
            await new Promise(res => setTimeout(res, waits[attempt]));
            continue;
          }
          this.riskUntil = Date.now() + 20000; // 20s 冷却（45s太久，混排歌单体验差）
          this._verifyLogin(); // 顺带校验登录态：Cookie 过期会一直触发风控，自愈后匿名通道反而能用
          const err = new Error('网易云风控中（检测到网络环境风险，稍后自动重试）');
          err.code = -460; err.risk = true; err.retryAt = this.riskUntil;
          throw err;
        }
        const err = new Error('网易云接口错误(' + (msg || b.code || (e && e.status) || 'unknown') + ')');
        err.code = b.code || (e && e.status) || 0;
        throw err;
      }
    }
    if (r && Array.isArray(r.cookie) && r.cookie.length) this._absorb(r.cookie.join('; '));
    return r ? r.body : null;
  }

  /* ---------- 扫码登录（官方 login_qr_key / login_qr_check，type=3） ---------- */
  async qrcodeCreate() {
    const body = await this._mod(mLoginQrKey);
    const unikey = body && body.data && body.data.unikey;
    if (!unikey) throw new Error('二维码生成失败');
    return { key: unikey, qr: 'https://music.163.com/login?codekey=' + unikey };
  }
  async qrcodePoll(key) {
    const body = await this._mod(mLoginQrCheck, { key });
    const code = body ? body.code : -1;
    if (code === 803) {
      this.saveCookies();
      const user = await this.loginStatus().catch(() => null);
      return { status: 803, ok: true, user };
    }
    return { status: code, ok: false, msg: { 800: '二维码已过期', 801: '等待扫码', 802: '已扫描，请在手机上确认' }[code] || ('code ' + code) };
  }
  async loginStatus() {
    if (!this.loggedIn) return null;
    let body = null;
    try {
      body = await this._mod(mUserAccount);
    } catch (e) {
      throw e; // 网络/风控错误不能当作过期
    }
    const p = body && body.profile;
    if (p) {
      this.profile = { userId: p.userId, name: p.nickname, avatar: p.avatarUrl, vipType: p.vipType || 0 };
      this.sessionExpired = false;
      this.saveProfile();
      return this.profile;
    }
    /* profile 为空 = MUSIC_U 已失效：清 Cookie 让请求回归匿名通道（失效 Cookie 反而是风控高发源） */
    this.sessionExpired = true;
    this.cookie = '';
    this._anonTried = false;
    this.urlCache.clear();
    this.saveCookies();
    return null;
  }
  /* 风控时顺带校验登录态（节流10分钟，直接用 mUserAccount 避免递归进 _mod 的冷却逻辑） */
  _verifyLogin() {
    if (!this.loggedIn) return;
    if (Date.now() - this._verifyAt < 10 * 60 * 1000) return;
    this._verifyAt = Date.now();
    mUserAccount({ cookie: this.cookie }, request).then(r => {
      const p = r && r.body && r.body.profile;
      if (!p) {
        this.sessionExpired = true;
        this.cookie = '';
        this._anonTried = false;
        this.urlCache.clear();
        this.saveCookies();
      } else {
        this.profile = { userId: p.userId, name: p.nickname, avatar: p.avatarUrl, vipType: p.vipType || 0 };
        this.sessionExpired = false;
        this.saveProfile();
      }
    }).catch(() => {});
  }
  async logout() {
    this.cookie = '';
    this._anonTried = false;
    this.sessionExpired = false;
    this.urlCache.clear();
    this.saveCookies();
  }
  /* Cookie导入登录：用户粘贴浏览器里的 MUSIC_U 值（或整个Cookie串） */
  async setCookieRaw(raw) {
    const v = String(raw || '').trim();
    if (!v) return null;
    let musicU = '';
    const mPair = v.match(/MUSIC_U=([^;\s]+)/);
    if (mPair) musicU = mPair[1];
    else if (/^[A-Za-z0-9%_-]{32,}$/.test(v)) musicU = v;
    if (!musicU) return null;
    this.cookie = 'MUSIC_U=' + musicU;
    this.urlCache.clear();
    const user = await this.loginStatus().catch(() => null);
    if (!user) { this.cookie = ''; this.saveCookies(); return null; }
    this.saveCookies();
    return user;
  }

  /* ---------- 歌单 ---------- */
  async userPlaylists(uid) {
    const body = await this._mod(mUserPlaylist, { uid, limit: 100, offset: 0 });
    return ((body && body.playlist) || []).map(p => ({
      id: p.id, name: stripTags(p.name), trackCount: p.trackCount || 0,
      cover: p.coverImgUrl || '', userId: p.userId, special: p.specialType === 5 || p.userId !== uid
    }));
  }
  _mapTrack(t) {
    return {
      nid: t.id,
      name: stripTags(t.name),
      artist: ((t.ar || t.artists) || []).map(a => a.name).join('/'),
      album: ((t.al || t.album) || {}).name || '',
      pic: ((t.al || t.album) || {}).picUrl || '',
      durationMs: t.dt || t.duration || 0,
      fee: t.fee || 0
    };
  }
  async playlistDetail(id) {
    const body = await this._mod(mPlaylistDetail, { id });
    const pl = (body && body.playlist) || {};
    const total = Math.min(pl.trackCount || 0, 2000); // 单次导入上限2000首
    let tracks = (pl.tracks || []).map(t => this._mapTrack(t));
    // 大歌单：track_all 分页补齐（detail 可能只带部分曲目）
    while (tracks.length < total) {
      const pb = await this._mod(mPlaylistTrackAll, { id, limit: 500, offset: tracks.length });
      const page = ((pb && (pb.songs || pb.tracks)) || []).map(t => this._mapTrack(t));
      if (!page.length) break;
      tracks = tracks.concat(page);
      if (page.length < 500) break;
      await new Promise(res => setTimeout(res, 400)); // 分页间降温，避免触发风控
    }
    return { id: pl.id || id, name: stripTags(pl.name) || '网易云歌单', trackCount: pl.trackCount || tracks.length, tracks };
  }
  /* 版本名词典：网易云搜索返回同歌版本树（live专辑/翻唱标题）+ top1 的 alias/tns（别名/译名）
     —— 免登录可用，是B站搜索关键词变体的廉价来源 */
  async versionDictionary(title, artist) {
    const out = [];
    try {
      const kw = ((artist || '') + ' ' + (title || '')).trim();
      if (!kw) return out;
      const body = await this._mod(mSearch, { keywords: kw, type: 1, limit: 10 });
      const songs = (body && body.result && body.result.songs) || [];
      for (const sg of songs) if (sg && sg.name) out.push(stripTags(sg.name));
      const top = songs[0];
      if (top && top.id) {
        const d = await this._mod(mSongDetail, { ids: String(top.id) });
        const t = ((d && d.songs) || [])[0];
        if (t) {
          (t.alias || []).forEach(a => a && out.push(stripTags(a)));
          (t.tns || []).forEach(a => a && out.push(stripTags(a)));
        }
      }
    } catch (e) { /* 词典是增强项，失败不影响主流程 */ }
    return Array.from(new Set(out)).slice(0, 14);
  }
  /* ---------- 搜索（聚合用） ---------- */
  async search(keyword, limit) {
    const body = await this._mod(require('NeteaseCloudMusicApi/module/search.js'), { keywords: keyword, type: 1, limit: limit || 15, offset: 0 });
    const songs = (body && body.result && body.result.songs) || [];
    return songs.map(t => ({
      nid: t.id,
      title: (t.name || '').replace(/<em[^>]*>/g, '').replace(/<\/em>/g, ''),
      artist: ((t.ar || t.artists) || []).map(a => a.name).join('/'),
      album: ((t.al || t.album) || {}).name || '',
      pic: ((t.al || t.album) || {}).picUrl || '',
      duration: Math.round((t.dt || t.duration || 0) / 1000),
      fee: t.fee || 0
    }));
  }

  /* ---------- 每日推荐：登录走每日30首，未登录/风控回退推荐新歌 ---------- */
  async recommendSongs() {
    if (this.loggedIn) {
      try {
        const d = await this._mod(mRecommendSongs, {});
        const arr = ((d && d.data && d.data.dailySongs) || []);
        if (arr.length) return { label: '每日推荐 · 基于你的口味生成', items: arr.slice(0, 30).map(t => this._mapTrack(t)) };
      } catch (e) { /* 回退到新歌 */ }
    }
    try {
      const d2 = await this._mod(mPersonalizedNewsong, { limit: 20 });
      const arr2 = (d2 && (d2.data || d2.result)) || [];
      return { label: '推荐新歌 · 热门上新', items: arr2.slice(0, 20).map(t => this._mapTrack(t.song || t)) };
    } catch (e) { return { label: '', items: [] }; }
  }

  /* ---------- 歌曲 ---------- */
  neQualityLabel(d) {
    const lv = String((d && d.level) || '');
    const type = String((d && d.type) || '');
    const br = Number(d && d.br) || 0;
    /* hires/jyeffect 必须先判断：它们的 type 也是 flac、br 也 >=900000，
       若先走 lossless/flac 分支会误标成“无损 FLAC”。 */
    if (lv === 'hires') return 'Hi-Res' + (br ? ' ' + Math.round(br / 1000) + 'kbps' : '');
    if (lv === 'jyeffect') return '高清环绕' + (br ? ' ' + Math.round(br / 1000) + 'kbps' : '');
    if (lv === 'sky') return '沉浸环绕' + (br ? ' ' + Math.round(br / 1000) + 'kbps' : '');
    if (lv === 'lossless' || /flac/i.test(type) || br >= 900000) {
      return '无损 FLAC' + (br ? ' ' + Math.round(br / 1000) + 'kbps' : '');
    }
    if (lv === 'exhigh') return '320kbps';
    if (lv === 'higher') return '192kbps';
    if (lv === 'standard') return '128kbps';
    if (br) return Math.round(br / 1000) + 'kbps';
    return type || 'mp3';
  }
  async songUrl(id, preferredBr) {
    /* 1999000 = Hi-Res（实测 weapi 可返回 24bit FLAC，约 3Mbps）；失败退无损/320k。
       2999000 会返回 jyeffect（高清环绕声），不是更高解析，暂不默认使用。 */
    const brs = preferredBr
      ? (preferredBr >= 1999000 ? [1999000, 999000, 320000]
        : preferredBr >= 999000 ? [999000, 320000]
        : [preferredBr])
      : [999000, 320000]; // 默认仍是无损；Hi-Res 需在音质选择里手动开启
    let last = null, lastErr = null;
    for (const br of brs) {
      const key = String(id) + '|' + br;
      const hit = this.urlCache.get(key);
      if (hit && Date.now() - hit.at < 8 * 60 * 1000) return hit.data; // 8分钟内同歌同档直链复用
      try {
        /* 只用 weapi song_url：eapi song_url_v1 被网易按“网络环境”专项风控（有效VIP账号也 -460），
           weapi 同账号完全放行。v1 不做兜底——它一旦风控会给全局设冷却，反而连累 weapi */
        const body = await this._mod(mSongUrl, { id, br });
        const d = (body && body.data && body.data[0]) || null;
        last = d;
        if (!d || !d.url) continue;
        const out = {
          url: d.url,
          fee: d.fee,
          type: d.type || 'mp3',
          size: d.size || 0,
          br: Number(d.br) || br,
          level: d.level || '',
          quality: this.neQualityLabel(d)
        };
        this.urlCache.set(key, { data: out, at: Date.now() });
        if (this.urlCache.size > 80) {
          let oldestK = null, oldestAt = Infinity;
          for (const [k, v] of this.urlCache) if (v.at < oldestAt) { oldestAt = v.at; oldestK = k; }
          if (oldestK) this.urlCache.delete(oldestK);
        }
        return out;
      } catch (e) {
        lastErr = e;
        if (e && e.risk) throw e; // 风控交给上层冷却，不继续换档加深
      }
    }
    return {
      url: null,
      fee: last ? last.fee : -1,
      code: last ? last.code : -1,
      error: lastErr ? (lastErr.message || String(lastErr)) : ''
    };
  }
  async songDetail(id) {
    const body = await this._mod(mSongDetail, { ids: String(id) });
    const t = ((body && body.songs) || [])[0] || null;
    if (!t) return null;
    return {
      nid: t.id,
      name: stripTags(t.name),
      artist: ((t.ar || t.artists) || []).map(x => x.name).join('/'),
      album: ((t.al || t.album) || {}).name || '',
      durationMs: t.dt || t.duration || 0,
      fee: t.fee || 0
    };
  }
  /* ---------- 推荐：心动模式 / 私人漫游 ---------- */
  _mapRecSong(t) {
    if (!t) return null;
    const s = t.songInfo || t.song || t;
    const id = s.id || s.songId;
    if (!id) return null;
    const ar = s.ar || s.artists || [];
    const al = s.al || s.album || {};
    return {
      nid: id,
      name: stripTags(s.name || s.songName || ''),
      artist: (ar || []).map(a => a && a.name).filter(Boolean).join('/'),
      pic: (al && al.picUrl) || '',
      durationMs: s.dt || s.duration || 0
    };
  }
  /* 心动模式：官方"智能播放"列表（需要歌单pid+当前歌曲id） */
  async heartbeatList(id, pid, count = 1) {
    const body = await this._mod(mHeartbeat, { id, pid, sid: id, count });
    const arr = (body && (body.data || body.songs)) || [];
    return arr.map(x => this._mapRecSong(x)).filter(Boolean);
  }
  /* 私人漫游：个人FM流（可一次取多首；失败回落每日推荐） */
  async personalFm(limit = 10) {
    try {
      const body = await this._mod(mPersonalFmMode, { mode: 'DEFAULT', limit });
      const arr = (body && (body.data || body.songs)) || [];
      const out = arr.map(x => this._mapRecSong(x)).filter(Boolean);
      if (out.length) return out;
    } catch (e) { if (e && e.risk) throw e; }
    const body2 = await this._mod(mRecommendSongs);
    const daily = (body2 && body2.data && body2.data.dailySongs) || (body2 && body2.songs) || [];
    return daily.map(x => this._mapRecSong(x)).filter(Boolean);
  }
  async fmTrash(id) {
    const body = await this._mod(mFmTrash, { id });
    return !!(body && body.code === 200);
  }
  async likeSong(id, like = true) {
    const body = await this._mod(mLike, { id, like });
    return !!(body && body.code === 200);
  }
  async simiSongs(id) {
    const body = await this._mod(mSimiSong, { id, limit: 30 });
    const arr = (body && body.songs) || [];
    return arr.map(x => this._mapRecSong(x)).filter(Boolean);
  }
}
module.exports = NetEase;
