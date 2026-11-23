'use strict';
/* 多源歌词解析与匹配：B站字幕 / 网易云 LRC+YRC+tlyric / 酷狗 KRC / AMLL TTML / LRCLIB
   目标：统一输出 { lines:[{t,end,text,translation?,romanization?,words?}], source, quality, ... }
   仅个人本地使用；歌词版权归各权利方所有，不要把抓取结果随应用分发。 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CACHE_TTL = 30 * 24 * 3600 * 1000;
const NEG_TTL = 5 * 60 * 1000;

function request(url, { method = 'GET', headers = {}, body = null, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const mod = u.protocol === 'http:' ? http : https;
    const h = Object.assign({ 'User-Agent': UA, 'Accept': '*/*' }, headers);
    if (body != null) h['Content-Length'] = Buffer.byteLength(body);
    const req = mod.request(u, { method, headers: h, timeout }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

async function getText(url, opts) {
  const r = await request(url, opts);
  if (r.status < 200 || r.status >= 300) {
    const e = new Error('HTTP ' + r.status);
    e.status = r.status;
    throw e;
  }
  return r.body.toString('utf8');
}

async function getJson(url, opts) {
  const t = await getText(url, opts);
  try { return JSON.parse(t); } catch (e) { throw new Error('JSON 解析失败'); }
}

function parseClock(v) {
  const s = String(v || '').trim();
  if (!s) return 0;
  const p = s.split(':').map(Number);
  if (p.some(n => !isFinite(n))) return 0;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return p[0] || 0;
}

function decodeXml(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
function stripXml(s) { return decodeXml(String(s || '').replace(/<[^>]*>/g, '')); }

const CREDIT_RE = /^(作词|作曲|编曲|作詞|作曲|編曲|制作|製作|监制|監製|填词|填詞|谱曲|譜曲|和声|和聲|混音|母带|母帶|录音|錄音|LRC|歌词|歌詞|演唱|编配|原唱|原曲|出品|发行|發行|策划|企划|混音师|母带师|吉他|贝斯|鼓|键盘|弦乐|人声|词|曲|OP|SP|Vocals?|Lyrics?|Composer|Arranger|Producer|Mixing|Mastering)\s*[:：]/i;

function isCredit(text) {
  const t = String(text || '').trim();
  return !t || CREDIT_RE.test(t);
}
const hasKanaText = s => /[\u3040-\u30ff]/.test(String(s || ''));

function normText(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。！？、；：,.!?;:'"“”‘’（）()《》〈〉【】\[\]…—–\-~～·]/g, '');
}
/* 常见 B 站/中文圈别名 → 规范歌手名；只做保守扩展，避免误匹配 */
const ARTIST_ALIAS_GROUPS = [
  ['ヨルシカ', 'yorushika', '夜鹿'],
  ['ずっと真夜中でいいのに。', 'zutomayo', '真夜中'],
  ['Ado', '痛亲王'],
  ['米津玄師', '米津玄师', '八爷'],
  ['Official髭男dism', '髭男', '胡子男'],
  ['Mrs. GREEN APPLE', '绿苹果'],
  ['RADWIMPS', '拉德温普斯'],
  ['Aimer', '艾梅'],
  ['YOASOBI', '夜游'],
  ['King Gnu', '王牛'],
  ['藤井風', '藤井风'],
  ['Vaundy', '巴迪']
];
function aliasHit(n, alias) {
  const x = normText(alias);
  if (!x) return false;
  if (n === x) return true;
  /* 短英文别名（如 Ado）只做精确匹配，避免 shadow 之类误命中 */
  return (x.length >= 5 || /[\u3400-\u9fff\u3040-\u30ff]/.test(x)) && n.includes(x);
}
function canonicalArtist(name) {
  const n = normText(name);
  if (!n) return '';
  for (const g of ARTIST_ALIAS_GROUPS) {
    if (g.some(a => aliasHit(n, a))) return g[0];
  }
  return '';
}
function artistCanonicals(text) {
  const n = normText(text);
  const out = [];
  if (!n) return out;
  for (const g of ARTIST_ALIAS_GROUPS) {
    if (g.some(a => aliasHit(n, a))) out.push(g[0]);
  }
  return out;
}

/* 去掉画质/搬运/宣传词，保留 live/cover/inst/remix 等版本词 */
function cleanTitle(s) {
  return String(s || '')
    .replace(/【[^】]*】/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/（[^）]*）/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/《|》/g, ' ')
    .replace(/完整版|官方MV|官方视频|官方|纯听|高清|修复|4K|8K|60FPS|60帧|120帧|Hi-?Res|无损|FLAC|音画|试听|搬运|投稿/gi, ' ')
    .replace(/[「」『』"'“”‘’]/g, ' ')
    .replace(/\s*[-–—]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* B站标题常见 “【画质/版本】歌手《歌名》宣传语”：优先取书名号里的歌名，
   歌手从书名号前的短段取；没有书名号再按 A / B 或 A - B 拆。 */
function searchIdentity(title, artistHint) {
  const s0 = String(title || '');
  const book = s0.match(/《([^》]{1,40})》/);
  let song = '', artist = String(artistHint || '').trim();
  const handle = /^[a-z0-9_]+$/i.test(artist);
  /* 括号里常放歌手：“Lemon【米津玄師】动态鼓谱”“【MV】Lemon” */
  const brackets = [];
  const bre = /[【\[（(]([^】\]）)]{1,30})[】\]）)]/g;
  let bm;
  while ((bm = bre.exec(s0))) brackets.push(bm[1].trim());
  const BRACKET_BAD = /^(mv|live|official|tour|再演|现场|演唱会|4k|8k|hd|hq|高品|画质|前世|完整版|动态|鼓谱|谱|翻唱|cover|1080p|60fps|dvd|修复|超清|蓝光|杜比|hi-?res)/i;
  const BRACKET_BAD_ANY = /(画质|高品|字幕|双语|中日|帧|修复|完整版|无损|纯享)/i;
  let bracketArtist = '';
  for (const raw of brackets) {
    if (!raw || raw.length > 40) continue;
    const tok = raw.split(/[\s·|｜/]+/).map(x => x.replace(/原创$|原創$/i, '').trim()).filter(Boolean)
      .find(x => x && x.length <= 24 && !/^\d+$/.test(x) && !BRACKET_BAD.test(x) && !BRACKET_BAD_ANY.test(x));
    if (tok) { bracketArtist = tok; break; }
  }
  /* B 站常见：“长句宣传语”「歌名/中文名」【歌手 巡演名】。
     优先取「」/『』里的短标题（长句含标点直接排除），其次取最后一段短引号。 */
  let quoteSong = '';
  const pickQuote = (re) => {
    const out = [];
    let m;
    while ((m = re.exec(s0))) {
      const inner = m[1].trim();
      if (!inner || inner.length > 40) continue;
      if (/[，。！？；：]/.test(inner)) continue;
      if (/^(live|mv|official|完整版|高清|4k|8k|中日|双语|字幕|纯享|无损|原声|原唱|纯音乐|伴奏|off\s?vocal|instrumental|hi-?res)/i.test(inner)) continue;
      out.push(inner);
    }
    return out.length ? out[out.length - 1] : '';
  };
  quoteSong = pickQuote(/[「『]([^」』]{2,60})[」』]/g) || pickQuote(/[“"]([^”"]{2,60})[”"]/g);
  if (quoteSong && !/[\/／]/.test(quoteSong)) {
    /* 引号可能只是巡演/专辑名：“爆弾魔 - ヨルシカ 2025「盗作 再演」LIVE”。
       如果引号外还有明确的 A - B / A｜B 分隔，就放弃引号，按常规拆分。 */
    const outside = s0.replace(/[「『][^」』]*[」』]/g, ' ').replace(/[“"][^”"]*[”"]/g, ' ');
    if (/\s+[-–—]\s+|\s*[\/|｜丨]\s*/.test(outside)) quoteSong = '';
  }
  if (quoteSong) {
    const parts = quoteSong.split(/[\/／|｜]/).map(x => x.trim()).filter(Boolean);
    quoteSong = parts[0] || quoteSong;
  }
  if (book) {
    song = book[1].trim();
    const before = s0.slice(0, book.index)
      .replace(/【[^】]*】/g, ' ').replace(/\[[^\]]*\]/g, ' ')
      .replace(/（[^）]*）/g, ' ').replace(/\([^)]*\)/g, ' ').trim();
    let segs = before.split(/[\s|｜丨:：\-–—]+/).map(x => x.trim()).filter(Boolean);
    let cand = segs.length ? segs[segs.length - 1] : '';
    /* 歌名在标题最前面时，歌手通常在书名号后面：“《嘘月》ヨルシカ｜...” */
    if (!cand) {
      const after = s0.slice(book.index + book[0].length)
        .replace(/【[^】]*】/g, ' ').replace(/\[[^\]]*\]/g, ' ')
        .replace(/（[^）]*）/g, ' ').replace(/\([^)]*\)/g, ' ').trim();
      segs = after.split(/[\s|｜丨:：\-–—]+/).map(x => x.trim()).filter(Boolean);
      cand = segs.find(x => x.length >= 1 && x.length <= 24 && !/^(live|mv|official|中日|双语|字幕|神曲|开口跪)/i.test(x)) || '';
    }
    cand = cand.replace(/[（(].*?[）)]/g, '').trim();
    if (cand && cand.length <= 24) artist = cand;
  } else if (quoteSong) {
    song = cleanTitle(quoteSong);
    if (!artist || /^[a-z0-9_]+$/i.test(artist)) {
      const qi = s0.indexOf(quoteSong);
      let after = '';
      if (qi >= 0) {
        const rest = s0.slice(qi + quoteSong.length);
        const close = rest.search(/[」』”"]/);
        after = close >= 0 ? rest.slice(close + 1) : '';
      }
      after = after
        .replace(/【[^】]*】/g, ' ').replace(/\[[^\]]*\]/g, ' ')
        .replace(/（[^）]*）/g, ' ').replace(/\([^)]*\)/g, ' ').trim();
      const cand = after.split(/[\s|｜丨:：\-–—]+/).map(x => x.trim()).filter(Boolean)
        .find(x => x.length <= 24 && !/^(live|mv|official|tour|再演|现场|演唱会|中日|双语|字幕|神曲)/i.test(x));
      if (cand) artist = cand;
    }
  } else {
    /* 先按 “歌名 - 歌手 2025 TOUR” / “歌名 / 歌手” 拆，再清洗 */
    const raw = s0
      .replace(/【[^】]*】/g, ' ').replace(/\[[^\]]*\]/g, ' ')
      .replace(/（[^）]*）/g, ' ').replace(/\([^)]*\)/g, ' ');
    const rawSegs = raw.split(/\s*[\/|｜丨]\s*|\s+[-–—]+\s*|\s*--+\s*/).map(x => x.trim()).filter(Boolean);
    if (rawSegs.length >= 2) {
      const hintN = normText(artist);
      const seg0N = normText(rawSegs[0]);
      const seg1N = normText(rawSegs.slice(1).join(' '));
      if (hintN && (seg0N.includes(hintN) || hintN.includes(seg0N))) {
        /* “米津玄师 - Lemon”：提示歌手匹配第一段，第二段才是歌名 */
        song = cleanTitle(rawSegs.slice(1).join(' '));
      } else {
        song = cleanTitle(rawSegs[0]);
        let art = rawSegs.slice(1).join(' ');
        art = art.replace(/\b(19|20)\d{2}\b.*$/i, '').replace(/\b(world\s+)?tour\b.*$/i, '').replace(/巡演.*$/,'').trim();
        const artN = normText(art);
        if (art && (!artist || (!hintN.includes(artN) && !artN.includes(hintN)))) artist = art;
      }
    }
    let clean = cleanTitle(s0);
    /* “Lemon 动态鼓谱”这类：拉丁歌名后面接中文描述，切出前面的英文歌名 */
    const latin = clean.match(/^([A-Za-z0-9][A-Za-z0-9'’\-!?.&\s]{1,40})(?=[\u3040-\u30ff\u4e00-\u9fff])/);
    if (latin && latin[1].trim().length >= 2) clean = latin[1].trim();
    if (!song) {
      const parts = clean.split(/\s*[\/|｜丨]\s*|\s+[-–—]\s+/).map(x => x.trim()).filter(Boolean);
      if (parts.length >= 2) {
        song = parts[0];
        if (handle || !artist) artist = parts.slice(1).join(' ');
      } else song = clean;
    }
  }
  if (bracketArtist) {
    const bN = normText(bracketArtist), sN = normText(song), aN = normText(artist);
    if (bN && sN && !bN.includes(sN) && !sN.includes(bN)) {
      const inTitle = !!(artist && s0.includes(artist));
      if (!artist || /^[a-z0-9_]+$/i.test(artist) || artist.length > 24 || (!inTitle && !aN.includes(bN) && !bN.includes(aN))) {
        artist = bracketArtist;
      }
    }
  }
  if (!song) song = cleanTitle(s0);
  return { song: song.slice(0, 60), artist: artist.slice(0, 40) };
}

/* 同一标题生成多组“歌名/歌手”可能组合：
   B 站标题里 A - B 到底谁是歌名并不可靠，交给后面的搜索与打分仲裁。
   这样「ヨルシカ - 冬眠」「憂一乗/仅有忧伤」「盗作 再演」等不需要逐个特判。 */
function searchIdentities(title, artistHint) {
  const s0 = String(title || '');
  const base = searchIdentity(s0, artistHint);
  const out = [];
  const seen = new Set();
  const add = (song, artist, weight) => {
    song = cleanTitle(song || '').replace(/\s+/g, ' ').trim();
    artist = String(artist || '').trim();
    if (!song || song.length > 60 || isCredit(song)) return;
    if (/^(live|mv|official|完整版|高清|4k|8k|中日|双语|字幕|纯享)$/i.test(song)) return;
    const k = normText(song) + '|' + normText(artist);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ song, artist, weight: weight || 0 });
  };
  add(base.song, base.artist, 100);
  add(base.song, artistHint, 90);
  const canon = canonicalArtist(base.artist) || canonicalArtist(artistHint);
  if (canon) add(base.song, canon, 130);

  const splitParts = s => String(s || '').split(/\s+[-–—]+\s*|\s*--+\s*|\s*[\/／|｜丨]\s*/)
    .map(x => x.trim()).filter(Boolean);

  const quotes = [];
  const qre = /[「『]([^」』]{2,60})[」』]/g;
  let qm;
  while ((qm = qre.exec(s0))) quotes.push(qm[1].trim());
  const dre = /[“"]([^”"]{2,60})[”"]/g;
  while ((qm = dre.exec(s0))) quotes.push(qm[1].trim());
  for (const inner of quotes) {
    if (!inner || inner.length > 50 || /[，。！？；：]/.test(inner)) continue;
    const parts = splitParts(inner);
    if (parts.length >= 2) {
      add(parts[1], parts[0], 120); // 常见：“歌手 - 歌名”
      add(parts[0], parts[1], 110);
    }
    add(inner, base.artist || artistHint, 60);
    add(inner, artistHint, 50);
  }

  const bre2 = /[【\[（(]([^】\]）)]{1,40})[】\]）)]/g;
  while ((qm = bre2.exec(s0))) {
    const inner = qm[1].trim();
    if (!inner || /^(mv|live|官方|高清|hd|hq|4k|8k|完整版|动态|鼓谱|谱|翻唱|cover|中日|双语|字幕|纯享|1080p|60fps|现场|演唱会|dvd|修复|画质|超清|蓝光|杜比|歌词|帧|hi-?res)/i.test(inner)) continue;
    const parts = splitParts(inner);
    if (parts.length >= 2) {
      add(parts[1], parts[0], 55);
      add(parts[0], parts[1], 45);
    }
  }

  const outside = s0
    .replace(/[「『][^」』]*[」』]/g, ' ')
    .replace(/[“"][^”"]*[”"]/g, ' ')
    .replace(/[【\[（(][^】\]）)]*[】\]）)]/g, ' ');
  const segs = splitParts(outside);
  if (segs.length >= 2) {
    add(segs[0], segs[1], 40);
    add(segs[1], segs[0], 35);
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, 6);
}

const VERSION_PATTERNS = [
  ['live', /现场|live|演唱会|音乐节|巡演|concert|tour|再演|unplugged/i],
  ['cover', /翻唱|cover|翻自|歌ってみた/i],
  ['inst', /伴奏|instrumental|off\s?vocal|karaoke|纯音乐|钢琴版|吉他版|演奏版|piano|管弦乐/i],
  ['remix', /remix|混音|bootleg|flip|8d|环绕/i],
  ['mv', /\bmv\b|music video|官方视频|official video|ミュージックビデオ/i]
];
function versionSet(s) {
  const out = new Set();
  const t = String(s || '');
  for (const [k, re] of VERSION_PATTERNS) if (re.test(t)) out.add(k);
  return out;
}
function versionScore(trackV, candV) {
  const a = trackV, b = candV;
  if (a.has('inst') !== b.has('inst')) return 0;
  if (a.has('live') && b.has('live')) return 1;
  if (!a.has('live') && !b.has('live')) {
    if (a.has('cover') === b.has('cover') && a.has('remix') === b.has('remix')) return 1;
    return 0.55;
  }
  return 0.18;
}

function titleSim(a, b) {
  const x = normText(cleanTitle(a)), y = normText(cleanTitle(b));
  if (!x || !y) return 0;
  if (x.includes(y) || y.includes(x)) return Math.min(x.length, y.length) / Math.max(x.length, y.length) * 0.35 + 0.65;
  const big = t => { const set = new Set(); for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2)); return set; };
  const A = big(x), B = big(y);
  let inter = 0;
  for (const k of A) if (B.has(k)) inter++;
  const jac = inter / Math.max(1, A.size + B.size - inter);
  const words = t => t.split(/[^a-z0-9]+/).filter(w => w.length > 1 && !/^(cover|live|official|audio|video|full|mv|ver|version|remix|inst|instrumental|music|lyrics|lyric|karaoke|off|vocal|hd|hq|short|shorts|pv|size|from|the|ft|feat|prod)$/i.test(w));
  const wa = words(String(a).toLowerCase()), wb = words(String(b).toLowerCase());
  let wj = 0;
  if (wa.length && wb.length) {
    const SB = new Set(wb);
    const hit = wa.filter(w => SB.has(w)).length;
    wj = hit / Math.max(wa.length, wb.length);
  }
  return Math.max(jac, wj);
}

/* 候选标题匹配：NetEase 的 transNames/alias 里常带中文译名（败犬不需要安可） */
function candidateTitleSim(title, c) {
  let best = titleSim(title, c && c.title);
  for (const a of ((c && c.aliases) || [])) {
    if (a) best = Math.max(best, titleSim(title, a));
  }
  return best;
}

function artistTokens(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .split(/[\/&、,，;；]|\s+feat\.?\s+|\s+ft\.?\s+/i)
    .map(x => x.replace(/^cv\s*[:：]\s*/i, '').trim())
    .filter(x => x.length >= 1);
}
function artistSim(a, b) {
  const A = artistTokens(a), B = artistTokens(b);
  if (!A.length || !B.length) return 0;
  let hit = 0;
  for (const x of A) {
    if (B.some(y => x === y || x.includes(y) || y.includes(x))) hit++;
  }
  const exact = hit / Math.max(A.length, B.length);
  /* 简繁/异体字（米津玄師 vs 米津玄师）用字符重叠兜底 */
  const ca = new Set(Array.from(normText(a))), cb = new Set(Array.from(normText(b)));
  let inter = 0;
  for (const c of ca) if (cb.has(c)) inter++;
  const ratio = inter / Math.max(1, Math.min(ca.size, cb.size));
  return Math.max(exact, ratio >= 0.6 ? ratio : 0);
}

/* 歌手证据：B 站 UP 名经常不是歌手，歌手往往只出现在标题/简介里 */
function artistEvidence(track, candArtist) {
  const hay = [track.title, track.desc].filter(Boolean).join(' ');
  let best = Math.max(artistSim(track.artist || '', candArtist), artistSim(hay, candArtist));
  const cans = new Set(artistCanonicals([track.artist, track.title, track.desc].filter(Boolean).join(' ')));
  for (const c of cans) best = Math.max(best, artistSim(c, candArtist));
  return best;
}

function durationScore(trackDur, candDur, live) {
  if (!trackDur || !candDur) return 0.5;
  const d = Math.abs(trackDur - candDur);
  const tol = live ? 22 : 10;
  if (d > tol * 2.2) return 0;
  return Math.max(0, 1 - d / (tol * 2.2));
}

function splitTimeTag(prefix) {
  const out = [];
  const re = /\[(\d{1,3}):(\d{1,2}(?:\.\d+)?)\]/g;
  let m;
  while ((m = re.exec(prefix))) out.push(parseInt(m[1], 10) * 60 + parseFloat(m[2]));
  return out;
}

/* ---------- LRC（含 enhanced LRC / [offset]） ---------- */
function parseLrc(text) {
  const rawLines = String(text || '').split(/\r?\n/);
  let offset = 0;
  const lines = [];
  for (const raw of rawLines) {
    const s = raw.trim();
    if (!s) continue;
    const om = s.match(/^\[offset\s*:\s*([+-]?\d+)\]\s*$/i);
    if (om) { offset = parseInt(om[1], 10) / 1000; continue; }
    const m = s.match(/^((?:\[\d{1,3}:\d{1,2}(?:\.\d+)?\])+)(.*)$/);
    if (!m) continue;
    const times = splitTimeTag(m[1]);
    if (!times.length) continue;
    const body = m[2] || '';
    const plain = body.replace(/<[^>]*>/g, '').trim();
    if (isCredit(plain)) continue;
    const marks = [];
    const tre = /<(\d{1,3}):(\d{1,2}(?:\.\d+)?)>/g;
    let tm;
    while ((tm = tre.exec(body))) marks.push({ idx: tm.index, end: tre.lastIndex, t: parseInt(tm[1], 10) * 60 + parseFloat(tm[2]) });
    let words = null;
    if (marks.length) {
      words = [];
      for (let i = 0; i < marks.length; i++) {
        const cur = marks[i];
        const next = marks[i + 1];
        const wt = body.slice(cur.end, next ? next.idx : body.length).replace(/<[^>]*>/g, '');
        if (!wt) continue;
        words.push({ text: wt, t: cur.t + offset, end: next ? next.t + offset : 0 });
      }
      if (!words.length) words = null;
    }
    for (const t0 of times) {
      const line = { t: t0 + offset, end: 0, text: plain };
      if (words) {
        line.words = words.map(w => ({ text: w.text, t: w.t, end: w.end }));
        line.text = line.words.map(w => w.text).join('').trim() || plain;
      }
      lines.push(line);
    }
  }
  lines.sort((a, b) => a.t - b.t);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], next = lines[i + 1];
    let end = next ? next.t : line.t + 5;
    const chars = Array.from(line.text || '').length;
    if (next && end - line.t > 5 && end - line.t > chars * 0.5 + 2) end = line.t + chars * 0.5 + 2;
    line.end = Math.max(line.t + 0.6, end);
    if (line.words && line.words.length) {
      for (let j = 0; j < line.words.length; j++) {
        const w = line.words[j];
        if (!(w.end > w.t)) w.end = line.words[j + 1] ? line.words[j + 1].t : line.end;
        if (w.end > line.end) w.end = line.end;
        if (!(w.end > w.t)) w.end = Math.min(line.end, w.t + 0.3);
      }
    }
  }
  return { lines, quality: lines.some(l => l.words && l.words.length) ? 'word' : 'line', offset };
}

function parseYrc(text) {
  const lines = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const s = raw.trim();
    if (!s) continue;
    const m = s.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!m) continue;
    const lineStart = parseInt(m[1], 10) / 1000;
    const lineDur = parseInt(m[2], 10) / 1000;
    const body = m[3] || '';
    const words = [];
    const re = /\((\d+),(\d+),\d+\)([^()]*)/g;
    let wm;
    while ((wm = re.exec(body))) {
      const t = parseInt(wm[1], 10) / 1000;
      const d = parseInt(wm[2], 10) / 1000;
      const wt = wm[3];
      if (!wt) continue;
      words.push({ text: wt, t, end: t + d });
    }
    const textOnly = body.replace(/\(\d+,\d+,\d+\)/g, '').trim();
    if (isCredit(textOnly)) continue;
    const line = {
      t: lineStart,
      end: lineStart + Math.max(0.2, lineDur),
      text: (words.length ? words.map(w => w.text).join('') : textOnly).trim()
    };
    if (words.length) line.words = words;
    if (line.text) lines.push(line);
  }
  lines.sort((a, b) => a.t - b.t);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], next = lines[i + 1];
    if (!(line.end > line.t)) line.end = next ? next.t : line.t + 5;
    if (line.words) {
      for (let j = 0; j < line.words.length; j++) {
        const w = line.words[j];
        if (!(w.end > w.t)) w.end = line.words[j + 1] ? line.words[j + 1].t : line.end;
      }
    }
  }
  return { lines, quality: lines.some(l => l.words && l.words.length) ? 'word' : 'line' };
}

/* ---------- 酷狗 KRC ---------- */
function decodeKrc(contentBase64) {
  const buf = Buffer.from(String(contentBase64 || ''), 'base64');
  if (buf.length <= 4) throw new Error('KRC 内容为空');
  const key = Buffer.from('@Gaw^2tGQ61-\xce\xd2ni', 'binary');
  const body = Buffer.alloc(buf.length - 4);
  for (let i = 4; i < buf.length; i++) body[i - 4] = buf[i] ^ key[(i - 4) % key.length];
  try { return zlib.inflateSync(body).toString('utf8'); }
  catch (e) { return zlib.inflateRawSync(body).toString('utf8'); }
}

function parseKrc(text) {
  const lines = [];
  let translation = null;
  let rawIndex = -1;
  const kanaTokens = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const s = raw.trim();
    if (!s) continue;
    if (s.startsWith('[language:')) {
      try {
        const b64 = s.slice(10, -1);
        translation = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
      } catch (e) {}
      continue;
    }
    if (s.startsWith('[kana:')) {
      /* [kana:] 是“假名(开始ms,时长ms)”流；按时长贴到 KRC 逐字 word 上，避免解析 1 分隔符 */
      const body = s.slice(6, -1);
      const kre = /([^()]*)\((\d+),(\d+)\)/g;
      let km;
      while ((km = kre.exec(body))) {
        /* 第一个时间标记前会带上制作名单的假名；1/2 都是分组分隔符，只取最后一个分隔后的读音 */
        const rawKana = String(km[1] || '').split(/[12]/).pop() || '';
        const chars = Array.from(rawKana).filter(ch => /[\u3040-\u30ff\u30fc]/.test(ch));
        if (!chars.length) continue;
        const t0 = parseInt(km[2], 10) / 1000;
        const d = parseInt(km[3], 10) / 1000;
        const step = d > 0 ? d / chars.length : 0;
        chars.forEach((ch, i) => kanaTokens.push({ ch, t: t0 + step * i, end: t0 + step * (i + 1) }));
      }
      continue;
    }
    const m = s.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!m) continue;
    rawIndex++;
    const lineStart = parseInt(m[1], 10) / 1000;
    const lineDur = parseInt(m[2], 10) / 1000;
    const body = m[3] || '';
    const words = [];
    const re = /<(\d+),(\d+),\d+>([^<]*)/g;
    let wm;
    while ((wm = re.exec(body))) {
      const off = parseInt(wm[1], 10) / 1000;
      const d = parseInt(wm[2], 10) / 1000;
      const wt = wm[3];
      if (!wt) continue;
      words.push({ text: wt, t: lineStart + off, end: lineStart + off + d });
    }
    const textOnly = body.replace(/<\d+,\d+,\d+>/g, '').trim();
    if (isCredit(textOnly)) continue;
    const line = {
      t: lineStart,
      end: lineStart + Math.max(0.2, lineDur),
      text: (words.length ? words.map(w => w.text).join('') : textOnly).trim(),
      _krcIndex: rawIndex
    };
    if (words.length) line.words = words;
    if (line.text) lines.push(line);
  }
  /* 假名 token 全局分配：按到 [t,end) 区间的距离取最近，边界留 0.5ms 防浮点误判 */
  if (kanaTokens.length) {
    const allWords = [];
    for (const line of lines) for (const w of line.words || []) if (w.end > w.t) allWords.push(w);
    const readings = new Map();
    for (const k of kanaTokens) {
      let best = null, bd = Infinity;
      for (const w of allWords) {
        let d;
        if (k.t < w.t) d = w.t - k.t;
        else if (k.t >= w.end - 0.0005) d = k.t - w.end + 0.0005;
        else d = 0;
        if (d < bd) { bd = d; best = w; }
      }
      if (best && bd <= 0.12) readings.set(best, (readings.get(best) || '') + k.ch);
    }
    for (const [w, reading] of readings) {
      if (!reading || !/[\u3400-\u9fff\uf900-\ufaff]/.test(String(w.text))) continue;
      if (reading !== String(w.text).replace(/\s/g, '')) w.kana = reading;
    }
  }
  /* [language:] 是逐行罗马音/翻译数组，行数与 KRC 正文一一对应；按原始行号贴回，避免过滤制作名单后错位 */
  const langBlocks = translation && Array.isArray(translation.content) ? translation.content : [];
  const langRows = langBlocks.map(b => (Array.isArray(b && b.lyricContent) ? b.lyricContent : []));
  for (const line of lines) {
    const idx = line._krcIndex;
    if (langRows.length && idx >= 0) {
      for (const rows of langRows) {
        const row = rows[idx];
        if (!row) continue;
        const txt = (Array.isArray(row) ? row.join('') : String(row)).replace(/\s+/g, ' ').trim();
        if (!txt) continue;
        const chars = Array.from(txt);
        const cjk = chars.filter(ch => /[\u3400-\u9fff\uf900-\ufaff]/.test(ch)).length;
        if (cjk / Math.max(1, chars.length) >= 0.25) {
          if (!line.translation) line.translation = txt;
        } else if (!line.romanization) {
          line.romanization = txt;
        }
      }
    }
    delete line._krcIndex;
  }
  lines.sort((a, b) => a.t - b.t);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], next = lines[i + 1];
    if (!(line.end > line.t)) line.end = next ? next.t : line.t + 5;
    if (line.words) {
      for (let j = 0; j < line.words.length; j++) {
        const w = line.words[j];
        if (!(w.end > w.t)) w.end = line.words[j + 1] ? line.words[j + 1].t : line.end;
      }
    }
  }
  return { lines, quality: lines.some(l => l.words && l.words.length) ? 'word' : 'line', language: translation };
}

/* ---------- AMLL TTML ---------- */
function xmlAttr(attrs, name) {
  const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*"([^"]*)"', 'i');
  const m = String(attrs || '').match(re);
  return m ? decodeXml(m[1]) : '';
}

function parseTtml(text) {
  const lines = [];
  const pre = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let pm;
  while ((pm = pre.exec(String(text || '')))) {
    const attrs = pm[1];
    const inner = pm[2];
    const t = parseClock(xmlAttr(attrs, 'begin'));
    const e = parseClock(xmlAttr(attrs, 'end'));
    if (!(e > t)) continue;
    const words = [];
    let translation = '', romanization = '';
    const sre = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;
    let sm;
    while ((sm = sre.exec(inner))) {
      const sa = sm[1], si = sm[2];
      const role = (xmlAttr(sa, 'ttm:role') || '').toLowerCase();
      const txt = stripXml(si).trim();
      if (!txt) continue;
      if (role.includes('translation')) { translation = txt; continue; }
      if (role.includes('roman')) { romanization = txt; continue; }
      const st = parseClock(xmlAttr(sa, 'begin'));
      const se = parseClock(xmlAttr(sa, 'end'));
      if (!(se > st)) continue;
      words.push({ text: stripXml(si), t: st, end: se });
    }
    const plain = stripXml(inner).trim();
    if (isCredit(plain)) continue;
    const line = {
      t,
      end: e,
      text: (words.length ? words.map(w => w.text).join('') : plain).trim()
    };
    if (words.length) line.words = words;
    if (translation) line.translation = translation;
    if (romanization) line.romanization = romanization;
    if (line.text) lines.push(line);
  }
  lines.sort((a, b) => a.t - b.t);
  return { lines, quality: lines.some(l => l.words && l.words.length) ? 'word' : 'line' };
}

/* ---------- 翻译 / 罗马音 ---------- */
function parsePlainLrc(text) {
  const out = parseLrc(text);
  return out.lines.map(l => ({ t: l.t, text: l.text })).filter(l => l.text);
}
function attachTranslation(lines, transText, field = 'translation') {
  const tl = parsePlainLrc(transText);
  if (!tl.length) return;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let best = null, bd = Infinity;
    for (const x of tl) {
      const d = Math.abs(x.t - line.t);
      if (d < bd) { bd = d; best = x; }
    }
    if (best && bd <= 1.2) line[field] = best.text;
    else if (tl[i] && Math.abs(tl[i].t - line.t) <= 2.5) line[field] = tl[i].text;
  }
}

function normalizeLines(lines) {
  const out = (lines || []).filter(l => l && l.text && isFinite(l.t)).map(l => {
    const line = Object.assign({}, l);
    line.t = Math.max(0, Number(line.t) || 0);
    line.end = Number(line.end) || 0;
    if (!(line.end > line.t)) line.end = line.t + 5;
    if (Array.isArray(line.words)) {
      line.words = line.words.filter(w => w && w.text && isFinite(w.t) && isFinite(w.end) && w.end > w.t)
        .map(w => {
          const o = { text: String(w.text), t: Number(w.t), end: Number(w.end) };
          if (w.kana) o.kana = String(w.kana);
          return o;
        })
        .sort((a, b) => a.t - b.t);
      while (line.words.length && !line.words[0].text.trim()) line.words.shift();
      while (line.words.length && !line.words[line.words.length - 1].text.trim()) line.words.pop();
      if (!line.words.length) delete line.words;
    }
    line.text = String(line.text).trim();
    return line;
  }).filter(l => l.text);
  out.sort((a, b) => a.t - b.t);
  /* KRC/部分 LRC 会在开头带 “歌手-歌名”“Lemon (Single Version) - 日韩群星” 这类标题行：
     只在开头 6 秒内、无歌词标点、带破折号时丢弃，避免把标题当第一句唱。 */
  const looksHeader = l => {
    if (l.t > 6) return false;
    const s = String(l.text || '').trim();
    if (!s || s.length > 50) return false;
    if (/[，。！？、；：]/.test(s)) return false;
    if (/(single|album|version|remaster|live|伴奏|完整版)/i.test(s) && /[-–—]/.test(s)) return true;
    if (/^.{1,40}\s*[-–—]\s*.{1,40}$/.test(s)) return true;
    return false;
  };
  return out.filter(l => !looksHeader(l));
}

/* 手动导入：优先按 LRC 解析；没有时间轴就按行生成均匀估计时间，交给打点校准 */
function parseImportedText(text, duration) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return null;
  const lrc = parseLrc(raw);
  if (lrc.lines.length >= 2) {
    return { lines: normalizeLines(lrc.lines), quality: lrc.quality, plain: false };
  }
  const plain = raw.split(/\r?\n/)
    .map(s => s.trim().replace(/^\[\d{1,3}:\d{1,2}(?:\.\d+)?\]\s*/, ''))
    .filter(s => s && !/^\[(ti|ar|al|by|offset|length)\s*:/i.test(s)
      && !/^\[(verse|chorus|bridge|intro|outro|pre-chorus|hook|间奏|副歌|主歌)[^\]]*\]$/i.test(s));
  if (plain.length < 2) return null;
  const total = Number(duration) > 0 ? Number(duration) : plain.length * 5;
  const span = Math.max(plain.length - 1, 1);
  const step = (total * 0.92) / span;
  const lines = plain.map((s, i) => {
    const t = Math.round(i * step * 100) / 100;
    const dur = i < plain.length - 1 ? step * 0.92 : Math.max(2, step);
    const end = t + Math.max(1.2, Math.min(8, dur));
    return { t, end, text: s };
  });
  return { lines, quality: 'line', plain: true };
}

/* 把外部歌词文本对齐到 B 站本视频 CC 的时间轴：
   CC 时间准但文本可能有错；外部文本正确但时间轴可能是别的版本。
   行级 DP 匹配后，匹配行用 CC 时间，未匹配行用中位偏移插值。 */
function mostlyCJKText(lines) {
  const chars = Array.from((lines || []).map(l => String(l.text || '')).join(''));
  if (!chars.length) return false;
  const cjk = chars.filter(ch => /[\u3400-\u9fff\uf900-\ufaff]/.test(ch)).length;
  return cjk / chars.length >= 0.3;
}
function alignTextToCc(ccLines, extLines) {
  if (!Array.isArray(ccLines) || !Array.isArray(extLines) || !ccLines.length || !extLines.length) return null;
  const norm = s => String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()《》〈〉【】\[\]…—–\-~～]/g, '');
  const bigrams = t => { const set = new Set(); for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2)); return set; };
  const sim = (a, b) => {
    const A = norm(a), B = norm(b);
    if (!A || !B) return 0;
    if (A === B) return 1;
    if (A.includes(B) || B.includes(A)) return 0.86;
    const X = bigrams(A), Y = bigrams(B);
    let inter = 0;
    for (const x of X) if (Y.has(x)) inter++;
    return inter / Math.max(1, X.size + Y.size - inter);
  };
  const m = extLines.length, n = ccLines.length;
  const gap = -0.28;
  const solve = (opts) => {
    const dp = Array.from({ length: m + 1 }, () => new Float32Array(n + 1));
    for (let i = 1; i <= m; i++) dp[i][0] = dp[i - 1][0] + gap;
    for (let j = 1; j <= n; j++) dp[0][j] = dp[0][j - 1] + gap;
    const sims = Array.from({ length: m }, () => new Float32Array(n));
    const bases = Array.from({ length: m }, () => new Float32Array(n));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const ext = extLines[i - 1];
        const ccText = ccLines[j - 1].text;
        /* CC 经常是中文翻译，而外部歌词正文是日文：同时比正文和翻译，避免明明有 CC 却对不上 */
        const base = Math.max(sim(ext.text, ccText), ext.translation ? sim(ext.translation, ccText) : 0);
        const pos = opts.posW ? opts.posW * (1 - Math.abs(j / n - i / m)) : 0;
        const s = Math.min(1.2, base + pos);
        bases[i - 1][j - 1] = base;
        sims[i - 1][j - 1] = s;
        const pair = dp[i - 1][j - 1] + (s >= opts.pairMin ? s : -0.38);
        dp[i][j] = Math.max(pair, dp[i - 1][j] + gap, dp[i][j - 1] + gap);
      }
    }
    const pairs = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0) {
        const s = sims[i - 1][j - 1];
        const pair = dp[i - 1][j - 1] + (s >= opts.pairMin ? s : -0.38);
        if (Math.abs(dp[i][j] - pair) < 1e-5) {
          if (s >= opts.backMin) pairs.push([i - 1, j - 1, s, bases[i - 1][j - 1]]);
          i--; j--;
          continue;
        }
      }
      if (i > 0 && Math.abs(dp[i][j] - (dp[i - 1][j] + gap)) < 1e-5) i--;
      else j--;
    }
    pairs.reverse();
    if (!pairs.length) return null;
    const totalChars = extLines.reduce((a, l) => a + Math.max(1, norm(l.text).length), 0);
    const matchedChars = pairs.reduce((a, p) => a + Math.max(1, norm(extLines[p[0]].text).length), 0);
    const coverage = matchedChars / Math.max(1, totalChars);
    const avgBase = pairs.reduce((a, p) => a + (p[3] || 0), 0) / pairs.length;
    return { pairs, coverage, avgBase };
  };
  /* 先按当前严格文本相似度对；失败再试“翻译 + 位置先验”的宽松通道 */
  let picked = solve({ posW: 0, pairMin: 0.25, backMin: 0.35 });
  if (!picked || picked.coverage < 0.22) {
    const loose = solve({ posW: 0.16, pairMin: 0.16, backMin: 0.18 });
    if (loose && loose.coverage >= 0.3 && loose.avgBase >= 0.08) {
      loose.loose = true;
      picked = loose;
    } else if (!picked || picked.coverage < 0.22) {
      return null;
    }
  }
  const pairs = picked.pairs;
  const coverage = picked.coverage;
  const offsets = pairs.map(p => (Number(ccLines[p[1]].t) || 0) - (Number(extLines[p[0]].t) || 0));
  offsets.sort((a, b) => a - b);
  const median = offsets[Math.floor(offsets.length / 2)] || 0;
  const matched = new Map(pairs.map(p => [p[0], p[1]]));
  const out = extLines.map((l, idx) => {
    const line = Object.assign({}, l);
    line.ccMatched = matched.has(idx);
    if (matched.has(idx)) {
      const cc = ccLines[matched.get(idx)];
      line.t = Number(cc.t) || 0;
      line.end = Number(cc.end) || (line.t + 3);
    } else {
      line.t = Math.max(0, (Number(l.t) || 0) + median);
      line.end = Math.max(line.t + 0.4, (Number(l.end) || line.t) + median);
    }
    delete line.words;
    return line;
  });
  out.sort((a, b) => a.t - b.t);
  for (let k = 0; k < out.length; k++) {
    if (!(out[k].end > out[k].t)) out[k].end = out[k].t + (k + 1 < out.length ? Math.max(0.4, out[k + 1].t - out[k].t) : 3);
  }
  return { lines: out, coverage: +coverage.toFixed(2), matched: pairs.length, loose: !!picked.loose };
}

function applyOffset(lines, offsetMs) {
  const d = (Number(offsetMs) || 0) / 1000;
  if (!d) return lines;
  return lines.map(l => {
    const line = Object.assign({}, l, {
      t: l.t + d,
      end: (l.end || l.t) + d
    });
    if (l.words) line.words = l.words.map(w => Object.assign({}, w, { text: w.text, t: w.t + d, end: w.end + d }));
    return line;
  });
}

/* 现场版拟合：把录音室/其他版本的行时间 t 映射为 t*scale+offset */
function applyTransform(lines, scale, offset) {
  const s = Number(scale) || 1;
  const o = Number(offset) || 0;
  if (s === 1 && o === 0) return lines;
  return (lines || []).map(l => {
    const t = Math.max(0, (Number(l.t) || 0) * s + o);
    let end = Math.max(0, (Number(l.end) || Number(l.t) || 0) * s + o);
    if (!(end > t)) end = t + 0.6;
    const line = Object.assign({}, l, { t, end });
    if (Array.isArray(l.words)) {
      line.words = l.words.map(w => {
        const wt = Math.max(0, (Number(w.t) || 0) * s + o);
        let we = Math.max(0, (Number(w.end) || Number(w.t) || 0) * s + o);
        if (!(we > wt)) we = wt + 0.05;
        return Object.assign({}, w, { text: w.text, t: wt, end: we });
      });
    }
    return line;
  });
}

/* ---------- 来源实现 ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const timeoutAfter = ms => new Promise(r => setTimeout(() => r(null), ms));
const NE_PACE = { at: 0, block: 0 };
const NE_LYRIC_PACE = { at: 0, block: 0 };
const KG_PACE = { at: 0 };
let NE_USE_OLD = false;
let NE_ANON_UNTIL = 0;
const NE_SEARCH_CACHE = new Map();
const KG_SEARCH_CACHE = new Map();
const SEARCH_TTL = 60 * 60 * 1000;
let SEARCH_DISK_FILE = '';
let SEARCH_DISK_LOADED = false;
let SEARCH_SAVE_TIMER = null;
function loadSearchDisk(file) {
  if (!file) return;
  if (SEARCH_DISK_LOADED && SEARCH_DISK_FILE === file) return;
  SEARCH_DISK_FILE = file;
  SEARCH_DISK_LOADED = true;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [k, v] of Object.entries(j.ne || {})) {
      if (!v || !v.at || Date.now() - v.at > SEARCH_TTL) continue;
      const data = Array.isArray(v.data) ? v.data : [];
      if (v.rateBlocked) data.rateBlocked = true;
      NE_SEARCH_CACHE.set(k, { at: v.at, data, rateBlocked: !!v.rateBlocked });
    }
    for (const [k, v] of Object.entries(j.kg || {})) {
      if (!v || !v.at || Date.now() - v.at > SEARCH_TTL) continue;
      KG_SEARCH_CACHE.set(k, { at: v.at, data: Array.isArray(v.data) ? v.data : [] });
    }
  } catch (e) {}
}
function saveSearchDisk() {
  if (!SEARCH_DISK_FILE) return;
  try {
    const ne = {}, kg = {};
    for (const [k, v] of NE_SEARCH_CACHE) ne[k] = { at: v.at, data: v.data, rateBlocked: !!v.rateBlocked };
    for (const [k, v] of KG_SEARCH_CACHE) kg[k] = { at: v.at, data: v.data };
    const f = SEARCH_DISK_FILE;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ ne, kg }), 'utf8');
    fs.renameSync(tmp, f);
  } catch (e) {}
}
function scheduleSearchSave() {
  clearTimeout(SEARCH_SAVE_TIMER);
  SEARCH_SAVE_TIMER = setTimeout(saveSearchDisk, 800);
}

async function neSearchOnce(kw, cookie) {
  if (Date.now() < NE_PACE.block) {
    const e = new Error('NetEase 搜索冷却中'); e.code = 'RATE'; throw e;
  }
  const wait = Math.max(0, NE_PACE.at + 260 - Date.now());
  if (wait) await sleep(wait);
  NE_PACE.at = Date.now();
  if (Date.now() < NE_ANON_UNTIL) cookie = '';
  const qs = encodeURIComponent(kw) + '&type=1&limit=10';
  const headers = { Referer: 'https://music.163.com/' };
  if (cookie) headers.Cookie = cookie;
  const is405 = j => j && (j.code === 405 || /操作频繁/.test(j.msg || j.message || ''));
  let j = null;
  if (NE_USE_OLD) {
    j = await getJson('https://music.163.com/api/search/get?s=' + qs, { headers, timeout: 6000 });
  } else {
    j = await getJson('https://music.163.com/api/search/get/web?s=' + qs, { headers, timeout: 6000 });
    if (is405(j)) {
      /* /web 被限流时切到旧的 /api/search/get，两条通道的风控不是完全同步 */
      try {
        const j2 = await getJson('https://music.163.com/api/search/get?s=' + qs, { headers, timeout: 6000 });
        if (!is405(j2)) { NE_USE_OLD = true; j = j2; }
      } catch (e) {}
    }
  }
  if (is405(j) && cookie) {
    /* 登录 Cookie 有时反而更容易触发风控；匿名通道往往还能用 */
    try {
      const j3 = await getJson('https://music.163.com/api/search/get?s=' + qs,
        { headers: { Referer: 'https://music.163.com/' }, timeout: 6000 });
      if (!is405(j3)) {
        NE_USE_OLD = true;
        NE_ANON_UNTIL = Date.now() + 60000;
        j = j3;
      }
    } catch (e) {}
  }
  if (is405(j)) {
    NE_PACE.block = Date.now() + 15000;
    const e = new Error('NetEase 搜索限流'); e.code = 'RATE'; throw e;
  }
  return (j && j.result && j.result.songs) || [];
}

async function neteaseSearch(title, artist, desc, cookie) {
  const ck = 'ne|' + normText(title) + '|' + normText(artist) + '|' + (cookie ? 'L' : 'A');
  const hit = NE_SEARCH_CACHE.get(ck);
  if (hit && Date.now() - hit.at < SEARCH_TTL) {
    if (hit.rateBlocked && hit.data) hit.data.rateBlocked = true;
    return hit.data;
  }
  const idents = searchIdentities(title, artist);
  const queries = [];
  const addQ = q => { q = String(q || '').trim(); if (q && !queries.includes(q)) queries.push(q); };
  for (const id of idents) {
    addQ([id.song, id.artist].filter(Boolean).join(' '));
    addQ(id.song);
    if (queries.length >= 3) break;
  }
  const full = cleanTitle(title);
  if (full) addQ(full);
  const merged = new Map();
  const hay = [title, desc].filter(Boolean).join(' ');
  const strong = () => [...merged.values()].some(s =>
    candidateTitleSim(title, s) >= 0.5 &&
    Math.max(artistSim(artist, s.artist), artistSim(hay, s.artist)) >= 0.45
  );
  let rateBlocked = false;
  for (const kw of queries.slice(0, 2)) {
    try {
      const songs = await neSearchOnce(kw, cookie);
      for (const s of songs) {
        if (merged.has(s.id)) continue;
        merged.set(s.id, {
          source: 'netease',
          id: s.id,
          title: s.name || '',
          artist: (s.artists || []).map(a => a.name).join('/'),
          album: s.album ? s.album.name : '',
          aliases: [...(s.alias || []), ...(s.transNames || [])].filter(Boolean),
          duration: (s.duration || 0) / 1000
        });
      }
      if (strong()) break;
    } catch (e) {
      rateBlocked = true;
      break;
    }
  }
  const out = [...merged.values()];
  out.rateBlocked = rateBlocked;
  if (!rateBlocked && out.length) {
    NE_SEARCH_CACHE.set(ck, { at: Date.now(), data: out, rateBlocked });
    scheduleSearchSave();
    if (NE_SEARCH_CACHE.size > 100) NE_SEARCH_CACHE.delete(NE_SEARCH_CACHE.keys().next().value);
  }
  return out;
}

async function neteaseLyric(id, meta, cookie) {
  if (Date.now() < NE_LYRIC_PACE.block) throw new Error('NetEase 歌词冷却中');
  const wait = Math.max(0, NE_LYRIC_PACE.at + 180 - Date.now());
  if (wait) await sleep(wait);
  NE_LYRIC_PACE.at = Date.now();
  const url = 'https://music.163.com/api/song/lyric/v1?id=' + encodeURIComponent(id) + '&lv=-1&tv=-1&rv=-1&yv=-1';
  const headers = { Referer: 'https://music.163.com/' };
  if (cookie) headers.Cookie = cookie;
  let j = await getJson(url, { headers, timeout: 8000 });
  if ((j.code === 405 || /操作频繁/.test(j.msg || j.message || '')) && cookie) {
    try {
      const j2 = await getJson(url, { headers: { Referer: 'https://music.163.com/' }, timeout: 8000 });
      if (!(j2.code === 405 || /操作频繁/.test(j2.msg || j2.message || ''))) {
        j = j2;
        NE_ANON_UNTIL = Date.now() + 60000;
      }
    } catch (e) {}
  }
  if (j.code === 405 || /操作频繁/.test(j.msg || j.message || '')) {
    NE_LYRIC_PACE.block = Date.now() + 10000;
    throw new Error('NetEase 歌词限流');
  }
  let parsed = null;
  if (j.yrc && j.yrc.lyric && /\[\d+,\d+\]/.test(j.yrc.lyric)) parsed = parseYrc(j.yrc.lyric);
  if (!parsed || !parsed.lines.length) parsed = parseLrc(j.lrc && j.lrc.lyric);
  if (!parsed.lines.length) return null;
  const lines = normalizeLines(parsed.lines);
  if (lines.length === 1 && /纯音乐|请欣赏|没有填词|instrumental/i.test(lines[0].text)) {
    return {
      source: 'netease', quality: 'none', lines: [], instrumental: true,
      title: meta.title || '', artist: meta.artist || '', duration: meta.duration || 0, id: meta.id
    };
  }
  if (j.tlyric && j.tlyric.lyric) attachTranslation(lines, j.tlyric.lyric, 'translation');
  if (j.romalrc && j.romalrc.lyric) attachTranslation(lines, j.romalrc.lyric, 'romanization');
  return Object.assign({
    source: 'netease',
    quality: parsed.quality,
    lines,
    refDuration: meta.duration || 0
  }, meta);
}

async function kgSearchOnce(kw, duration) {
  const wait = Math.max(0, KG_PACE.at + 140 - Date.now());
  if (wait) await sleep(wait);
  KG_PACE.at = Date.now();
  /* 两个轴都查：带时长能压掉短视频/片段，带时长对现场长版又可能筛空。
     所以同一关键词跑“带时长”和“不带时长”两次，合并后再打分。 */
  const url = 'https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=' + encodeURIComponent(kw)
    + (duration ? '&duration=' + Math.round(duration * 1000) : '');
  const j = await getJson(url, { timeout: 6000 });
  return j.candidates || [];
}

async function kugouSearch(title, artist, duration) {
  const ck = 'kg|' + normText(title) + '|' + normText(artist);
  const hit = KG_SEARCH_CACHE.get(ck);
  if (hit && Date.now() - hit.at < SEARCH_TTL) return hit.data;
  const idents = searchIdentities(title, artist);
  const queries = [];
  const addQ = q => { q = String(q || '').trim(); if (q && !queries.includes(q)) queries.push(q); };
  for (const id of idents) {
    addQ([id.song, id.artist].filter(Boolean).join(' '));
    addQ(id.song);
    if (queries.length >= 2) break;
  }
  const merged = new Map();
  const strong = () => [...merged.values()].some(s =>
    titleSim(title, s.title) >= 0.5 &&
    Math.max(artistSim(artist, s.artist), artistSim(title, s.artist)) >= 0.45
  );
  for (let qi = 0; qi < Math.min(2, queries.length); qi++) {
    const kw = queries[qi];
    try {
      const durs = qi === 0 ? [duration, 0] : [0];
      for (const dur of durs) {
        let arr = [];
        try { arr = await kgSearchOnce(kw, dur); } catch (e) { continue; }
        for (const c of arr) {
          if (merged.has(c.id)) continue;
          merged.set(c.id, {
            source: 'kugou',
            id: c.id,
            accesskey: c.accesskey,
            title: c.song || '',
            artist: c.singer || '',
            duration: (c.duration || 0) / 1000,
            krctype: c.krctype
          });
        }
      }
      if (strong()) break;
    } catch (e) {}
  }
  const out = [...merged.values()];
  if (out.length) {
    KG_SEARCH_CACHE.set(ck, { at: Date.now(), data: out });
    scheduleSearchSave();
  }
  if (KG_SEARCH_CACHE.size > 100) KG_SEARCH_CACHE.delete(KG_SEARCH_CACHE.keys().next().value);
  return out;
}

async function kugouLyric(c) {
  const url = 'https://lyrics.kugou.com/download?ver=1&client=pc&id=' + encodeURIComponent(c.id)
    + '&accesskey=' + encodeURIComponent(c.accesskey) + '&fmt=krc&charset=utf8';
  const j = await getJson(url, { timeout: 8000 });
  if (!j.content) return null;
  const parsed = parseKrc(decodeKrc(j.content));
  if (!parsed.lines.length) return null;
  return Object.assign({
    source: 'kugou',
    quality: parsed.quality,
    lines: normalizeLines(parsed.lines),
    refDuration: c.duration || 0
  }, c);
}

function krcHasField(lines, field) {
  return Array.isArray(lines) && lines.some(l => l && l[field]);
}
function krcHasKana(lines) {
  return Array.isArray(lines) && lines.some(l => Array.isArray(l.words) && l.words.some(w => w.kana));
}
/* 同一首歌的不同 KRC 候选可能分别带翻译/罗马音/假名；按行合并，不替换正文时间轴 */
function mergeKrcMeta(primary, alt) {
  if (!primary || !alt || !Array.isArray(primary.lines) || !Array.isArray(alt.lines)) return primary;
  const sameCount = primary.lines.length === alt.lines.length;
  for (let i = 0; i < primary.lines.length; i++) {
    const l = primary.lines[i];
    let a = sameCount ? alt.lines[i] : null;
    if (!a) {
      let bd = 0.75;
      for (const x of alt.lines) {
        const d = Math.abs((Number(x.t) || 0) - (Number(l.t) || 0));
        if (d < bd) { bd = d; a = x; }
      }
    }
    if (!a) continue;
    if (!l.translation && a.translation) l.translation = a.translation;
    if (!l.romanization && a.romanization) l.romanization = a.romanization;
    if (Array.isArray(l.words) && Array.isArray(a.words) && l.words.length === a.words.length) {
      for (let j = 0; j < l.words.length; j++) {
        if (!l.words[j].kana && a.words[j].kana && String(l.words[j].text) === String(a.words[j].text)) {
          l.words[j].kana = a.words[j].kana;
        }
      }
    }
  }
  return primary;
}

async function amllLyric(ncmId, meta) {
  if (!ncmId) return null;
  const urls = [
    'https://amll-ttml-db.stevexmh.net/ncm/' + encodeURIComponent(ncmId),
    'https://amll-ttml-db.gbclstudio.cn/ncm-lyrics/' + encodeURIComponent(ncmId) + '.ttml',
    'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/refs/heads/main/ncm-lyrics/' + encodeURIComponent(ncmId) + '.ttml'
  ];
  for (const url of urls) {
    try {
      const text = await getText(url, { timeout: 3500 });
      if (!/<tt[\s>]/i.test(text)) continue;
      const parsed = parseTtml(text);
      if (parsed.lines.length < 2) continue;
      return Object.assign({}, meta, {
        source: 'amll',
        quality: parsed.quality,
        lines: normalizeLines(parsed.lines),
        refDuration: meta.duration || 0
      });
    } catch (e) {}
  }
  return null;
}

async function lrclibLyric(title, artist, duration) {
  const t = cleanTitle(title);
  if (!t) return null;
  const q = new URLSearchParams({ track_name: t });
  if (artist) q.set('artist_name', artist);
  if (duration) q.set('duration', String(Math.round(duration)));
  let j = null;
  try { j = await getJson('https://lrclib.net/api/get?' + q.toString(), { headers: { 'User-Agent': 'BiliPlayer/1.0 (personal music player)' } }); }
  catch (e) {}
  if (!j) {
    try {
      const q2 = new URLSearchParams({ track_name: t });
      if (artist) q2.set('artist_name', artist);
      const arr = await getJson('https://lrclib.net/api/search?' + q2.toString(), { headers: { 'User-Agent': 'BiliPlayer/1.0 (personal music player)' } });
      if (Array.isArray(arr) && arr.length) {
        j = arr.sort((a, b) => Math.abs((a.duration || 0) - (duration || 0)) - Math.abs((b.duration || 0) - (duration || 0)))[0];
      }
    } catch (e) {}
  }
  if (!j) return null;
  if (j.instrumental) return { source: 'lrclib', quality: 'none', lines: [], instrumental: true, title: j.trackName || t, artist: j.artistName || artist || '', duration: j.duration || duration || 0 };
  const parsed = parseLrc(j.syncedLyrics || '');
  if (!parsed.lines.length) return null;
  return {
    source: 'lrclib',
    quality: parsed.quality,
    lines: normalizeLines(parsed.lines),
    title: j.trackName || t,
    artist: j.artistName || artist || '',
    duration: j.duration || duration || 0,
    refDuration: j.duration || 0
  };
}

/* ---------- 编排 ---------- */
class Lyrics {
  constructor(dataDir, bili, ne) {
    this.dataDir = dataDir;
    this.bili = bili || null;
    this.ne = ne || null;
    this.cacheDir = path.join(dataDir, 'lyrics');
    loadSearchDisk(path.join(dataDir, 'lyrics-search.json'));
  }

  cacheKey(track) {
    if (track.bvid && track.cid) return 'bili-' + track.bvid + '-' + track.cid;
    if (track.nid) return 'ne-' + track.nid;
    const raw = [cleanTitle(track.title), track.artist || track.up || '', Math.round((Number(track.duration) || 0) / 2)].join('|');
    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 'meta-' + (h >>> 0).toString(36);
  }

  readCache(key) {
    try {
      const f = path.join(this.cacheDir, key.replace(/[^\w.-]/g, '_') + '.json');
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const ttl = j.chosen ? CACHE_TTL : NEG_TTL;
      if (!j.at || Date.now() - j.at > ttl) return null;
      return j;
    } catch (e) { return null; }
  }

  writeCache(key, entry) {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      const f = path.join(this.cacheDir, key.replace(/[^\w.-]/g, '_') + '.json');
      fs.writeFileSync(f, JSON.stringify(entry), 'utf8');
    } catch (e) {}
  }

  decorate(entry, key) {
    const off = Number(entry.offsetMs) || 0;
    const chosen = entry.chosen;
    let lines = chosen ? chosen.lines : [];
    let alignment = chosen ? chosen.alignment : '';
    let label = chosen ? chosen.sourceLabel : '';
    const vd = Number(entry.videoDuration) || 0;
    if (chosen && entry.align && Number(entry.align.scale) > 0) {
      const mapped = applyOffset(applyTransform(chosen.lines, entry.align.scale, entry.align.offset), off);
      /* 对齐 + 手动偏移把整段歌词推到视频结束之后：丢弃这次对齐，保留原歌词+手动偏移 */
      if (vd > 0 && mapped.length && mapped[0].t >= vd && chosen.lines.length) {
        lines = applyOffset(chosen.lines, off);
        alignment = 'needs-align';
        label = label.replace(/ · 现场版待校准/g, '')
          .replace(/ · 已按现场节奏对齐/g, '')
          .replace(/ · 自动对齐置信度低/g, '')
          + ' · 现场版待校准';
      } else {
        lines = mapped;
        const ac = Number(entry.align.confidence) || 0;
        alignment = ac >= 0.4 ? 'scale-offset' : 'scale-offset-low';
        label = label.replace(/ · 现场版待校准/g, '')
          .replace(/ · 已按现场节奏对齐/g, '')
          .replace(/ · 自动对齐置信度低/g, '')
          + (ac >= 0.4 ? ' · 已按现场节奏对齐' : ' · 自动对齐置信度低');
      }
    } else if (chosen) {
      lines = applyOffset(chosen.lines, off);
    }
    if (alignment === 'scale-offset-low' || alignment === 'needs-align') {
      lines = lines.map(l => Object.assign({}, l, { confidence: 'low' }));
    } else if (alignment === 'scale-offset') {
      lines = lines.map(l => Object.assign({}, l, { confidence: 'aligned' }));
    }
    const cands = (entry.candidates || []).map(c => {
      const cd = (entry.candidateData || [])[c.index];
      const preview = cd && Array.isArray(cd.lines)
        ? cd.lines.slice(0, 2).map(l => String(l.text || '').slice(0, 80))
        : [];
      return Object.assign({}, c, {
        preview,
        explain: c.explain || (cd && cd.explain) || null,
        ccCoverage: Number(c.ccCoverage) || Number(cd && cd.ccCoverage) || 0,
        ccLoose: !!(c.ccLoose || (cd && cd.ccLoose)),
        ccTranslated: !!(c.ccTranslated || (cd && cd.ccTranslated)),
        current: !!(chosen && c.source === chosen.source && String(c.id || '') === String(chosen.id || ''))
      });
    });
    return {
      key,
      lines,
      source: chosen ? chosen.source : '',
      quality: chosen ? chosen.quality : 'none',
      sourceLabel: label,
      refDuration: chosen ? chosen.refDuration : 0,
      alignment,
      align: entry.align || null,
      candidates: cands,
      locked: !!entry.locked,
      canChoose: Array.isArray(entry.candidateData) && entry.candidateData.length > 1,
      offsetMs: off,
      lineOffsets: this.readLineOffsets(key),
      instrumental: !!entry.instrumental || !!(chosen && chosen.instrumental),
      authRequired: !!entry.authRequired,
      reason: chosen ? '' : (entry.reason || 'no-match'),
      bestScore: Number(entry.bestScore) || 0,
      candidateCount: Number(entry.candidateCount) || (Array.isArray(entry.candidateData) ? entry.candidateData.length : 0),
      manual: !!entry.manual,
      stats: entry.stats || null,
      cached: true
    };
  }

  async resolve(track) {
    const t = Object.assign({}, track || {});
    if (this.bili && t.bvid) {
      try {
        const vd = await this.bili.videoDetail(t.bvid);
        t.title = t.title || vd.title;
        t.artist = t.artist || vd.up || '';
        t.duration = Number(t.duration) || vd.duration || 0;
        t.desc = [t.desc || vd.desc || '', (vd.tags || []).join(' ')].filter(Boolean).join(' ');
      } catch (e) {}
    }
    t.title = t.title || t.name || '';
    t.artist = t.artist || t.up || '';
    t.duration = Number(t.duration) || 0;
    /* 保留 UP 原始名作为线索；歌手匹配交给 artistEvidence，在完整标题/简介里找 */
    const t0 = Date.now();
    const stats = { sources: {} };
    const key = this.cacheKey(t);
    const ov = this.readOverride(key);
    if (ov) {
      const entry = {
        at: Date.now(),
        videoDuration: t.duration || 0,
        chosen: {
          source: 'manual',
          quality: ov.quality || 'line',
          sourceLabel: (ov.sourceLabel || '手动导入') + (ov.plain ? ' · 待打点' : ''),
          lines: ov.lines,
          alignment: 'manual',
          refDuration: 0
        },
        candidateData: [],
        candidates: [],
        authRequired: false,
        reason: '',
        offsetMs: Number(ov.offsetMs) || 0,
        manual: true,
        stats: { totalMs: Date.now() - t0, cacheHit: false, sources: { manual: { ms: Date.now() - t0, ok: true } } }
      };
      this.writeCache(key, entry);
      return this.decorate(entry, key);
    }
    const cached = this.readCache(key);
    const lock = this.readLock(key);
    if (cached) {
      if (!Number(cached.videoDuration) && t.duration) {
        cached.videoDuration = t.duration;
        this.writeCache(key, cached);
      }
      const cachedStats = Object.assign({}, cached.stats || {}, { cacheHit: true, totalMs: Date.now() - t0 });
      return this.decorate(Object.assign({}, cached, { stats: cachedStats }), key);
    }

    const trackV = versionSet([t.title, t.desc].filter(Boolean).join(' '));
    const live = trackV.has('live');
    const neCookie = (this.ne && this.ne.cookie) || '';
    const candidates = [];
    let authRequired = false;
    let neBlocked = false;

    const add = c => {
      if (!c) return;
      c.version = versionSet([c.title, c.artist].filter(Boolean).join(' '));
      c.score = this.score(t, c, trackV, live);
      c.sourceLabel = this.label(c);
      if (c.instrumental) {
        /* 纯音乐占位也要标题/歌手够像，避免 LRCLIB 随便搜到一首伴奏就误判整首纯音乐 */
        if (c.score >= (live ? 0.5 : 0.55)) candidates.push(c);
        return;
      }
      if (!Array.isArray(c.lines) || c.lines.length < 2) return;
      candidates.push(c);
    };

    const jobs = [];
    const timed = async (name, fn) => {
      const st = Date.now();
      let ok = false;
      try { ok = !!(await fn()); } catch (e) { ok = false; }
      stats.sources[name] = { ms: Date.now() - st, ok };
    };

    /* B站本视频字幕：时间轴天然对应本视频，优先给现场版做锚点 */
    if (this.bili && t.bvid && t.cid) {
      jobs.push(timed('bili-cc', async () => {
        try {
          const d = this.bili.ownSubtitle
            ? await this.bili.ownSubtitle(t.bvid, t.cid)
            : await this.bili.subtitles(t.bvid, t.cid);
          if (d && d.authRequired) authRequired = true;
          if (d && d.lines && d.lines.length >= 2) {
            add({
              source: 'bili-cc',
              quality: 'line',
              lines: normalizeLines(d.lines),
              title: t.title, artist: t.artist, duration: t.duration,
              refDuration: t.duration,
              exactVideo: true,
              alignment: 'video'
            });
            return true;
          }
        } catch (e) {}
        return false;
      }));
    }

    /* 网易云曲目：nid 是权威 ID，直接取歌词 + AMLL，不做标题搜索 */
    if (t.nid) {
      jobs.push(timed('netease', async () => {
        try {
          const meta = { source: 'netease', id: t.nid, title: t.title, artist: t.artist, duration: t.duration };
          const c = await neteaseLyric(t.nid, meta, neCookie);
          if (c) { c.exactNid = true; add(c); return true; }
        } catch (e) {}
        return false;
      }));
      jobs.push(timed('amll', async () => {
        try {
          const am = await Promise.race([
            amllLyric(t.nid, { id: t.nid, title: t.title, artist: t.artist, duration: t.duration }).catch(() => null),
            timeoutAfter(3500)
          ]);
          if (am) { am.exactNid = true; add(am); return true; }
        } catch (e) {}
        return false;
      }));
    } else {
      /* B 站曲目：多身份搜索 → 取前两条歌词；同时用其 ID 取 AMLL TTML */
      jobs.push(timed('netease', async () => {
        try {
          const list = await neteaseSearch(t.title, t.artist, t.desc, neCookie);
          if (list && list.rateBlocked) neBlocked = true;
          if (!list.length) return false;
          const ranked = list.map(s => Object.assign({}, s, {
            _s: candidateTitleSim(t.title, s) * 0.55 + artistEvidence(t, s.artist) * 0.25 + durationScore(t.duration, s.duration, live) * 0.2
          })).sort((a, b) => b._s - a._s);
          const pick = ranked.filter(s => s._s > 0.35).slice(0, 2);
          if (!pick.length) pick.push(ranked[0]);
          /* 先取第一条；没有歌词再取第二条。避免每次都打两条歌词接口 */
          let got = null, gotPick = null;
          for (const p of pick) {
            got = await neteaseLyric(p.id, p, neCookie).catch(() => null);
            if (got) { gotPick = p; add(got); break; }
          }
          /* 已经有逐字就不需要 AMLL；只有行级时才尝试一次 TTML */
          if (got && gotPick && got.quality !== 'word' && !got.instrumental) {
            const am = await Promise.race([
              amllLyric(gotPick.id, gotPick).catch(() => null),
              timeoutAfter(3500)
            ]);
            if (am) add(am);
          }
          return !!got;
        } catch (e) { return false; }
      }));
    }

    /* 酷狗：搜索 → 取最接近的一条 */
    jobs.push(timed('kugou', async () => {
      try {
        const list = await kugouSearch(t.title, t.artist, t.duration);
        if (!list.length) return false;
        const ranked = list.map(s => Object.assign({}, s, {
          _s: candidateTitleSim(t.title, s) * 0.55 + artistEvidence(t, s.artist) * 0.25 + durationScore(t.duration, s.duration, live) * 0.2
        })).sort((a, b) => b._s - a._s);
        const top = ranked.find(s => s._s > 0.35);
        if (!top) return false;
        const isJp = hasKanaText(t.title + ' ' + t.artist) || !!canonicalArtist(t.artist) || !!canonicalArtist(t.title);
        const topLyr = await kugouLyric(top).catch(() => null);
        let lyr = topLyr;
        /* 同一首歌不同候选可能分别带翻译/罗马音/假名：日文歌缺项时多取一条合并 */
        if (isJp && (!topLyr || !krcHasField(topLyr.lines, 'translation') || !krcHasField(topLyr.lines, 'romanization') || !krcHasKana(topLyr.lines))) {
          const alt = ranked.find(s => s !== top && s._s > 0.35
            && (!t.duration || !s.duration || Math.abs(s.duration - t.duration) <= 8));
          if (alt) {
            const altLyr = await kugouLyric(alt).catch(() => null);
            if (altLyr) lyr = topLyr ? mergeKrcMeta(topLyr, altLyr) : altLyr;
          }
        }
        if (lyr) { add(lyr); return true; }
      } catch (e) {}
      return false;
    }));

    /* LRCLIB：开放兜底 */
    jobs.push(timed('lrclib', async () => {
      try {
        const lc = await lrclibLyric(t.title, t.artist, t.duration);
        if (lc) { add(lc); return true; }
      } catch (e) {}
      return false;
    }));

    await Promise.allSettled(jobs);
    /* 本视频 CC 时间 + 外部正确文本：CC 有字幕时生成一个“文本正确、时间贴本视频”的候选 */
    const ccCand = candidates.find(c => c.source === 'bili-cc' && c.lines && c.lines.length >= 2);
    if (ccCand) {
      const exts = candidates.filter(c => c.source !== 'bili-cc' && c.lines && c.lines.length >= 2)
        .sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 2);
      for (const ext of exts) {
        const al = alignTextToCc(ccCand.lines, ext.lines);
        if (al && al.lines.length >= 2 && al.coverage >= 0.25) {
          add({
            source: 'bili-cc-align',
            quality: 'line',
            lines: al.lines,
            title: ext.title,
            artist: ext.artist,
            duration: ext.duration,
            refDuration: t.duration,
            exactVideo: true,
            alignment: 'cc',
            ccCoverage: al.coverage,
            ccLoose: !!al.loose,
            ccTranslated: mostlyCJKText(ccCand.lines) && !mostlyCJKText(ext.lines)
          });
        }
      }
    }
    candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
    let lockedC = null;
    if (lock) {
      lockedC = candidates.find(c => !c.instrumental && c.lines && c.lines.length >= 2
        && c.source === lock.source
        && String(c.id || '') === String(lock.id || '')
        && c.quality === lock.quality) || null;
      if (!lockedC) {
        lockedC = candidates.filter(c => !c.instrumental && c.lines && c.lines.length >= 2 && c.source === lock.source)
          .sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;
      }
    }
    const best = lockedC || (() => {
      const normalBest = candidates.find(c => !c.instrumental && c.lines && c.lines.length >= 2 && c.score >= (live ? 0.45 : 0.5));
      /* 现场版/原本选中 CC 时：优先“外部正确文本 + 本视频 CC 时间”，它比纯中文 CC 多了原文 */
      const ccAlignPick = candidates
        .filter(c => c.source === 'bili-cc-align' && !c.instrumental && c.lines && c.lines.length >= 2 && (c.ccCoverage || 0) >= 0.25)
        .sort((a, b) => (b.score || 0) - (a.score || 0))[0];
      return (ccAlignPick && (ccAlignPick.ccLoose || ccAlignPick.ccTranslated) && (live || (normalBest && normalBest.source === 'bili-cc'))) ? ccAlignPick : normalBest;
    })();
    let choosable = candidates.filter(c => !c.instrumental && c.lines && c.lines.length >= 2);
    if (lockedC && !choosable.includes(lockedC)) choosable.unshift(lockedC);
    if (best && !choosable.includes(best)) choosable.unshift(best);
    choosable = choosable.slice(0, 6);
    const candidateData = choosable.map(c => {
      const cd = c.refDuration || c.duration || 0;
      const na = !!(live && t.duration > 0 && Math.abs(cd - t.duration) > 20 && c.source !== 'bili-cc');
      return {
        source: c.source,
        id: c.id || '',
        title: c.title || '',
        artist: c.artist || '',
        duration: c.duration || 0,
        quality: c.quality,
        score: +(c.score || 0).toFixed(3),
        refDuration: cd,
        alignment: na ? 'needs-align' : (c.alignment || (c.quality === 'word' ? 'native' : 'line')),
        sourceLabel: c.sourceLabel,
        needsAlign: na,
        exactVideo: !!c.exactVideo,
        ccCoverage: Number(c.ccCoverage) || 0,
        ccLoose: !!c.ccLoose,
        ccTranslated: !!c.ccTranslated,
        explain: c._explain || null,
        lines: c.lines
      };
    });
    const bestIdx = best
      ? candidateData.findIndex(c => c.source === best.source && String(c.id || '') === String(best.id || '') && c.quality === best.quality)
      : -1;
    const chosenC = bestIdx >= 0 ? candidateData[bestIdx] : null;
    /* 当前源排第一：候选列表里“当前”标记不再出现在第二行 */
    if (chosenC) {
      const ci = candidateData.indexOf(chosenC);
      if (ci > 0) { candidateData.splice(ci, 1); candidateData.unshift(chosenC); }
    }
    const inst = candidates.find(c => c.instrumental);
    const usable = candidates.filter(c => !c.instrumental && c.lines && c.lines.length >= 2);
    let reason = '';
    if (!chosenC) {
      if (inst) reason = 'instrumental';
      else if (authRequired) reason = 'bili-auth';
      else if (usable.length) reason = 'low-score';
      else if (neBlocked) reason = 'rate-limited';
      else reason = 'no-source';
    }
    const entry = {
      at: Date.now(),
      videoDuration: t.duration || 0,
      locked: !!lockedC,
      stats: { totalMs: Date.now() - t0, cacheHit: false, sources: stats.sources },
      chosen: chosenC ? {
        source: chosenC.source,
        id: chosenC.id,
        quality: chosenC.quality,
        sourceLabel: chosenC.sourceLabel + (chosenC.needsAlign ? ' · 现场版待校准' : ''),
        refDuration: chosenC.refDuration,
        alignment: chosenC.alignment,
        instrumental: false,
        lines: chosenC.lines
      } : null,
      candidateData,
      instrumental: !chosenC && !!inst,
      candidates: candidateData.map((c, i) => ({
        index: i,
        source: c.source,
        id: c.id,
        title: c.title,
        artist: c.artist,
        duration: Math.round(c.duration || 0),
        quality: c.quality,
        score: c.score,
        label: c.sourceLabel,
        ccCoverage: Number(c.ccCoverage) || 0,
        ccLoose: !!c.ccLoose,
        ccTranslated: !!c.ccTranslated,
        explain: c.explain || null,
        instrumental: false
      })),
      authRequired,
      reason,
      bestScore: usable.length ? +(Math.max(...usable.map(c => c.score || 0))).toFixed(3) : 0,
      candidateCount: usable.length,
      offsetMs: 0
    };
    this.writeCache(key, entry);
    return this.decorate(entry, key);
  }

  score(track, c, trackV, live) {
    const ts = candidateTitleSim(track.title, c);
    const as = artistEvidence(track, c.artist);
    const ds = durationScore(track.duration, c.duration, live);
    const vs = versionScore(trackV, c.version || new Set());
    let q = c.quality === 'word' ? 0.08 : (c.quality === 'line' ? 0.02 : -0.08);
    if (c.source === 'amll') q += 0.04;
    if (c.source === 'bili-cc') q += 0.1;
    if (c.source === 'bili-cc-align') q += 0.14;
    if (c.exactVideo) q += 0.1;
    if (c.exactNid) q += 0.05;
    c._explain = {
      title: +ts.toFixed(2), artist: +as.toFixed(2),
      duration: +ds.toFixed(2), version: +vs.toFixed(2)
    };
    return Math.max(0, Math.min(1.3, ts * 0.38 + as * 0.18 + ds * 0.16 + vs * 0.14 + q));
  }

  label(c) {
    const q = c.quality === 'word' ? ' · 逐字' : '';
    const tr = c.lines && c.lines.some(l => l.translation) ? ' · 翻译' : '';
    if (c.source === 'bili-cc') return 'B站本视频字幕' + q;
    if (c.source === 'bili-cc-align') return 'B站字幕时间 · 外部歌词' + (c.ccLoose ? ' · 宽松匹配' : '') + tr;
    if (c.source === 'netease') return '网易云音乐' + (c.artist ? ' · ' + c.artist : '') + q + tr;
    if (c.source === 'kugou') {
      const kana = Array.isArray(c.lines) && c.lines.some(l => Array.isArray(l.words) && l.words.some(w => w.kana));
      return '酷狗歌词' + (c.artist ? ' · ' + c.artist : '') + q + tr + (kana ? ' · 假名' : '');
    }
    if (c.source === 'amll') return 'AMLL 逐字歌词' + (c.artist ? ' · ' + c.artist : '') + tr;
    if (c.source === 'lrclib') return 'LRCLIB 开放歌词库' + q;
    return c.source || '歌词';
  }

  setOffset(key, offsetMs) {
    const f = path.join(this.cacheDir, String(key || '').replace(/[^\w.-]/g, '_') + '.json');
    const val = Math.max(-600000, Math.min(600000, Number(offsetMs) || 0));
    /* 手动导入的歌词不走自动缓存清理，偏移也要写回 override，否则清缓存后会丢 */
    const ov = this.readOverride(key);
    if (ov) { ov.offsetMs = val; this.writeOverride(key, ov); }
    let j = null;
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
    j.offsetMs = val;
    j.at = Date.now();
    try { fs.writeFileSync(f, JSON.stringify(j), 'utf8'); } catch (e) {}
    return this.decorate(j, key);
  }

  setAlign(key, scale, offset, confidence) {
    const f = path.join(this.cacheDir, String(key || '').replace(/[^\w.-]/g, '_') + '.json');
    let j = null;
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
    if (scale === null || scale === undefined || scale === '') {
      delete j.align;
    } else {
      j.align = {
        scale: +Math.max(0.75, Math.min(1.25, Number(scale) || 1)).toFixed(4),
        offset: +Math.max(-600, Math.min(600, Number(offset) || 0)).toFixed(2),
        confidence: +Math.max(0, Math.min(1, Number(confidence) || 0)).toFixed(2)
      };
    }
    j.at = Date.now();
    try { fs.writeFileSync(f, JSON.stringify(j), 'utf8'); } catch (e) {}
    return this.decorate(j, key);
  }

  choose(key, index) {
    const f = path.join(this.cacheDir, String(key || '').replace(/[^\w.-]/g, '_') + '.json');
    let j = null;
    try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
    if (!Array.isArray(j.candidateData)) return null;
    const c = j.candidateData[Number(index)];
    if (!c) return null;
    j.chosen = {
      source: c.source,
      id: c.id || '',
      quality: c.quality,
      sourceLabel: c.sourceLabel + (c.needsAlign ? ' · 现场版待校准' : ''),
      refDuration: c.refDuration || c.duration || 0,
      alignment: c.alignment,
      instrumental: false,
      lines: c.lines
    };
    j.align = null;
    j.offsetMs = 0;
    j.reason = '';
    j.locked = true;
    j.lockedAt = Date.now();
    j.at = Date.now();
    try { fs.writeFileSync(f, JSON.stringify(j), 'utf8'); } catch (e) {}
    /* 锁定信息独立存一份：清缓存/重新找后仍能回到同一个源 */
    this.writeLock(key, {
      source: c.source,
      id: c.id || '',
      quality: c.quality,
      title: c.title || '',
      artist: c.artist || ''
    });
    /* 换源后旧源的逐行偏移不再适用 */
    this.writeLineOffsets(key, {});
    return this.decorate(j, key);
  }

  overrideFile(key) {
    return path.join(this.dataDir, 'lyric-overrides', String(key || '').replace(/[^\w.-]/g, '_') + '.json');
  }
  readOverride(key) {
    try {
      const j = JSON.parse(fs.readFileSync(this.overrideFile(key), 'utf8'));
      if (!j || !Array.isArray(j.lines) || j.lines.length < 2) return null;
      return j;
    } catch (e) { return null; }
  }
  writeOverride(key, data) {
    try {
      const f = this.overrideFile(key);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(Object.assign({ key, at: Date.now() }, data)), 'utf8');
      return true;
    } catch (e) { return false; }
  }
  clearOverride(key) {
    try { fs.unlinkSync(this.overrideFile(key)); return true; } catch (e) { return false; }
  }
  lockFile(key) {
    return path.join(this.dataDir, 'lyric-locks', String(key || '').replace(/[^\w.-]/g, '_') + '.json');
  }
  readLock(key) {
    try {
      const j = JSON.parse(fs.readFileSync(this.lockFile(key), 'utf8'));
      return j && j.source ? j : null;
    } catch (e) { return null; }
  }
  writeLock(key, data) {
    try {
      const f = this.lockFile(key);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(Object.assign({ key, at: Date.now() }, data)), 'utf8');
      return true;
    } catch (e) { return false; }
  }
  clearLock(key) {
    try { fs.unlinkSync(this.lockFile(key)); return true; } catch (e) { return false; }
  }
  lineFile(key) {
    return path.join(this.dataDir, 'lyric-line-offsets', String(key || '').replace(/[^\w.-]/g, '_') + '.json');
  }
  readLineOffsets(key) {
    try {
      const j = JSON.parse(fs.readFileSync(this.lineFile(key), 'utf8'));
      const out = {};
      for (const [k, v] of Object.entries((j && j.offsets) || {})) {
        if (!/^\d+$/.test(k)) continue;
        const n = Number(v);
        if (isFinite(n) && n) out[k] = Math.max(-30000, Math.min(30000, Math.round(n)));
      }
      return out;
    } catch (e) { return {}; }
  }
  writeLineOffsets(key, offsets) {
    if (!key) return false;
    const clean = {};
    for (const [k, v] of Object.entries(offsets || {})) {
      if (!/^\d+$/.test(k)) continue;
      const n = Number(v);
      if (isFinite(n) && n) clean[k] = Math.max(-30000, Math.min(30000, Math.round(n)));
    }
    try {
      const f = this.lineFile(key);
      if (!Object.keys(clean).length) {
        try { fs.unlinkSync(f); } catch (e) {}
        return true;
      }
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ key, offsets: clean, at: Date.now() }), 'utf8');
      return true;
    } catch (e) { return false; }
  }
  exportManualData() {
    const dirs = { overrides: 'lyric-overrides', locks: 'lyric-locks', lineOffsets: 'lyric-line-offsets' };
    const out = { version: 1, at: Date.now(), overrides: {}, locks: {}, lineOffsets: {} };
    for (const [kind, dirName] of Object.entries(dirs)) {
      const dir = path.join(this.dataDir, dirName);
      let files = [];
      try { files = fs.readdirSync(dir); } catch (e) {}
      for (const f of files) {
        if (!/^[\w.-]+\.json$/.test(f)) continue;
        try { out[kind][f] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) {}
      }
    }
    return out;
  }
  importManualData(data) {
    if (!data || typeof data !== 'object') return { ok: false, error: '备份格式不正确' };
    const dirs = { overrides: 'lyric-overrides', locks: 'lyric-locks', lineOffsets: 'lyric-line-offsets' };
    const counts = { overrides: 0, locks: 0, lineOffsets: 0 };
    for (const [kind, dirName] of Object.entries(dirs)) {
      const src = data[kind];
      if (!src || typeof src !== 'object') continue;
      const dir = path.join(this.dataDir, dirName);
      for (const [file, obj] of Object.entries(src)) {
        if (!/^[\w.-]+\.json$/.test(file) || !obj || typeof obj !== 'object') continue;
        if (JSON.stringify(obj).length > 2e6) continue;
        try {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, file), JSON.stringify(obj), 'utf8');
          counts[kind]++;
        } catch (e) {}
      }
    }
    return { ok: true, counts };
  }
  importManual(key, text, duration) {
    if (!key) return { ok: false, error: '缺少歌词 key' };
    const parsed = parseImportedText(text, duration);
    if (!parsed) return { ok: false, error: '没有解析到至少 2 行歌词' };
    const ov = {
      lines: parsed.lines,
      quality: parsed.quality,
      plain: parsed.plain,
      offsetMs: 0
    };
    this.writeOverride(key, ov);
    const entry = {
      at: Date.now(),
      videoDuration: Number(duration) || 0,
      chosen: {
        source: 'manual',
        id: '',
        quality: parsed.quality,
        sourceLabel: '手动导入' + (parsed.plain ? ' · 待打点' : ''),
        refDuration: 0,
        alignment: 'manual',
        lines: parsed.lines
      },
      candidateData: [],
      candidates: [],
      authRequired: false,
      reason: '',
      offsetMs: 0,
      manual: true
    };
    this.writeCache(key, entry);
    this.writeLineOffsets(key, {});
    return Object.assign({ ok: true, plain: parsed.plain }, this.decorate(entry, key));
  }
  saveManualLines(key, lines, opts = {}) {
    if (!key || !Array.isArray(lines) || !lines.length) return { ok: false, error: '没有可保存的歌词行' };
    const clean = lines.map(l => {
      const t = Math.max(0, Number(l && l.t) || 0);
      let end = Math.max(0, Number(l && l.end) || 0);
      if (!(end > t)) end = t + 3;
      const line = Object.assign({}, l, { t, end, text: String((l && l.text) || '').trim() });
      if (Array.isArray(line.words)) {
        line.words = line.words.filter(w => w && w.text && isFinite(w.t) && isFinite(w.end) && w.end > w.t)
          .map(w => Object.assign({}, w, { text: String(w.text), t: Number(w.t), end: Number(w.end) }))
          .sort((a, b) => a.t - b.t);
        if (!line.words.length) delete line.words;
      }
      return line;
    }).filter(l => l.text).sort((a, b) => a.t - b.t);
    if (!clean.length) return { ok: false, error: '没有可保存的歌词行' };
    const quality = opts.quality || (clean.every(l => Array.isArray(l.words) && l.words.length) ? 'word' : 'line');
    const offsetMs = Math.max(-600000, Math.min(600000, Number(opts.offsetMs) || 0));
    const sourceLabel = opts.sourceLabel || '手动编辑';
    this.writeOverride(key, { lines: clean, quality, plain: false, offsetMs, sourceLabel });
    const entry = {
      at: Date.now(),
      videoDuration: Number(opts.duration) || 0,
      chosen: {
        source: 'manual',
        quality,
        sourceLabel,
        lines: clean,
        alignment: 'manual',
        refDuration: 0
      },
      candidateData: [],
      candidates: [],
      authRequired: false,
      reason: '',
      offsetMs,
      manual: true
    };
    this.writeCache(key, entry);
    if (opts.clearLineOffsets) this.writeLineOffsets(key, {});
    return Object.assign({ ok: true, clearLineOffsets: !!opts.clearLineOffsets }, this.decorate(entry, key));
  }
  clearCache(key) {
    if (!key) {
      try { for (const f of fs.readdirSync(this.cacheDir)) fs.unlinkSync(path.join(this.cacheDir, f)); } catch (e) {}
      return true;
    }
    try { fs.unlinkSync(path.join(this.cacheDir, String(key).replace(/[^\w.-]/g, '_') + '.json')); return true; } catch (e) { return false; }
  }
}

module.exports = Lyrics;
module.exports.parseLrc = parseLrc;
module.exports.parseKrc = parseKrc;
module.exports.parseYrc = parseYrc;
module.exports.parseTtml = parseTtml;
module.exports.decodeKrc = decodeKrc;
module.exports.normalizeLines = normalizeLines;
module.exports.alignTextToCc = alignTextToCc;
module.exports.titleSim = titleSim;
module.exports.versionSet = versionSet;
module.exports.searchIdentity = searchIdentity;
module.exports.searchIdentities = searchIdentities;
module.exports.artistEvidence = artistEvidence;
module.exports.amllLyric = amllLyric;
module.exports.neteaseSearch = neteaseSearch;
module.exports.neteaseLyric = neteaseLyric;
module.exports.kugouSearch = kugouSearch;
module.exports.kugouLyric = kugouLyric;
module.exports.mergeKrcMeta = mergeKrcMeta;
module.exports.lrclibLyric = lrclibLyric;
