/* 哔哩播放器 主逻辑 */
/* global Api, Player, qrcode */

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pic = u => {
  if (!u) return '';
  u = String(u);
  if (u.startsWith('//')) return 'https:' + u;
  return u.replace(/^http:\/\//, 'https://');
};
function fmt(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
}
function nfmt(n) {
  n = Number(n) || 0;
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return String(n);
}
function highlight(t) {
  const e = esc(t);
  return e.replace(/&lt;em class=&quot;keyword&quot;&gt;/g, '<em class="hl">').replace(/&lt;\/em&gt;/g, '</em>');
}
/* 搜索结果标题带着 <em class="keyword"> 高亮标记，进队列/歌单/播放页前要洗掉 */
/* B站接口返回的标题常带HTML实体（&quot;等）且含<em>高亮标签：去标签+解码实体 */
const _unentEl = typeof document !== 'undefined' ? document.createElement('textarea') : null;
const stripEm = t => {
  let s = String(t || '').replace(/<em[^>]*>/g, '').replace(/<\/em>/g, '');
  if (_unentEl) { _unentEl.innerHTML = s; s = _unentEl.value; }
  return s;
};

/* ---------- 图标 ---------- */
const ICON = {
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  roam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15.6 8.4l-2.3 5.5-5.5 2.3 2.3-5.5z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg>',
  film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="15" rx="3"/><path d="M7 2l3 3M17 2l-3 3"/><path d="M10 10.5v4l3.5-2z" fill="currentColor" stroke="none"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72c0 .8.87 1.3 1.56.88l11-6.86a1.04 1.04 0 0 0 0-1.76l-11-6.86A1.04 1.04 0 0 0 8 5.14z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6a1 1 0 0 1 2 0v12a1 1 0 0 1-2 0z"/><path d="M18.5 6.2v11.6c0 .8-.9 1.3-1.6.9l-9-5.8a1.05 1.05 0 0 1 0-1.8l9-5.8c.7-.4 1.6.1 1.6.9z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6a1 1 0 0 1 2 0v12a1 1 0 0 1-2 0z"/><path d="M5.5 6.2v11.6c0 .8.9 1.3 1.6.9l9-5.8a1.05 1.05 0 0 0 0-1.8l-9-5.8c-.7-.4-1.6.1-1.6.9z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  queue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h9M4 18h9"/><path d="M17 12.5v6l5-3z" fill="currentColor" stroke="none"/></svg>',
  loop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
  one: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><text x="9.5" y="15.8" font-size="10" fill="currentColor" stroke="none" font-weight="bold">1</text></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/></svg>',
  vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4z" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  headphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>',
  music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  tv: '<svg viewBox="0 0 24 24" fill="none" stroke="#fb7299" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="14" rx="4"/><path d="M7 2.5l3 3M17 2.5l-3 3"/><circle cx="9" cy="12" r="1" fill="#fb7299" stroke="none"/><circle cx="15" cy="12" r="1" fill="#fb7299" stroke="none"/><path d="M9.5 15.5c1.5 1.2 3.5 1.2 5 0"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h3a2 2 0 0 1 1.6.8l1 1.4a1 1 0 0 0 .8.4h4.6A2.5 2.5 0 0 1 20 8.1v9.4a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.4" fill="currentColor" stroke="none"/></svg>',
  fs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  fsExit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>',
  comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  like: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.3a2 2 0 0 0 2-1.7l1.4-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>',
  palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a10 10 0 1 1 10-10c0 2.5-2 4-4 4h-2a2 2 0 0 0-1.5 3.3c.3.4.5.8.5 1.2a1.7 1.7 0 0 1-1.7 1.7z"/><circle cx="7.5" cy="11.5" r="1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="17.5" cy="11.5" r="1" fill="currentColor" stroke="none"/></svg>'
};

/* ---------- 状态 ---------- */
const state = {
  user: null,
  playlists: [],
  folders: null,
  foldersLoading: false,
  view: { name: 'favfolders' },
  currentItems: [],
  pageMeta: { pn: 0, hasMore: false, total: 0 },
  searchQ: '',
  searchErr: '',
  folder: null,
  playlist: null,
  selectMode: false,
  selection: new Set(),
  loginToken: 0,
  neLoginToken: 0,
  neLoginTimer: null,
  neExpired: false, // 网易云登录已过期（Cookie失效）：展示灰态+重新登录入口
  loginTimer: null,
  miniClosed: false,
  history: [],
  cdMode: true,
  up: null,
  replies: null,
  lyrics: null,
  npqTab: 'queue',
  npInfoTab: 'lyric',
  _pmCb: null,
  _cmCb: null,
  _dragIdx: null
};
const App = { _lastKey: '', _scrubbing: false, popItems: [], replyToken: 0, _ovlTimer: null, lyricsToken: 0, lyricIdx: -1, lyricNudgeIdx: -1, _lyricScrollHold: 0, _lyricSnapTimer: 0, cd: { cur: 0, openIdx: -1, viewH: 0, pad: 130, timer: 0, animT: 0, anim: false, drag: false, dragMoved: false, userUntil: 0, lastBg: '', onDown: null, onMove: null, onUp: null, onKey: null } };
/* ---------- 心动模式 / 漫游 状态 ---------- */
App.heart = { on: false, every: 2, count: 0, seen: new Set(), busy: false, recs: 0 };
try { App.heart.on = localStorage.getItem('bp.heartOn') === '1'; } catch (e) {}
App.roam = { active: false, seen: new Set(), fetching: false, prev: null, source: '' };
App.tapSync = { active: false, idx: 0, snapshots: [], tapped: new Set() };
App.lyricLowOnly = false;

/* ---------- 动态歌词 MV（第一版：流光） ---------- */
App.mv = {
  on: false, layer: null, style: 'flow',
  video: false, videoKey: '', videoTimer: 0, videoGen: 0, videoUrls: new Map(), videoFail: null,
  mood: 'auto', tone: 'dark',
  aiConfig: null, aiTheme: null, aiCache: new Map(), aiLoadingKey: '', aiTimer: 0, aiErrorAt: 0,
  segments: null, segmentsKey: '', segCache: new Map(), segLoadingKey: '', segErrorAt: 0, segTimer: 0,
  bpmInfo: null, bpmCache: new Map(), bpmLoadingKey: '', bpmTimer: 0,
  tune: { flowKeep: 2, flowVine: 1, flowPreview: true, vWait: 0.5, vCols: 6, vGap: 26 },
  director: false, directorTimer: 0, directorTrack: '', lowPower: false, autoPerf: true, sectionSwitch: false, subtitle: true, subTrans: true, subRoma: true, directorBase: '', directorChorus: '', sectionBusy: false, lastChorus: false, sectionTimer: 0, pendingSection: '', sectionCooldownUntil: 0, foliaError: null
};
try { App.mv.director = localStorage.getItem('bp.mvDirector') === '1'; } catch (e) {}
try { App.mv.lowPower = localStorage.getItem('bp.mvLowPower') === '1'; } catch (e) {}
try { App.mv.sectionSwitch = localStorage.getItem('bp.mvSectionSwitch') === '1'; } catch (e) {}
try { App.mv.subtitle = localStorage.getItem('bp.mvSubtitle') !== '0'; } catch (e) {}
try {
  /* 旧版本只有一个总开关：新开关没有记录时继承总开关，避免升级后突然全部显示 */
  const st = localStorage.getItem('bp.mvSubTrans');
  const sr = localStorage.getItem('bp.mvSubRoma');
  App.mv.subTrans = st === null ? App.mv.subtitle : st !== '0';
  App.mv.subRoma = sr === null ? App.mv.subtitle : sr !== '0';
  App.mv.subtitle = App.mv.subTrans || App.mv.subRoma;
} catch (e) {}
try {
  const t = JSON.parse(localStorage.getItem('bp.mvTune') || '{}');
  for (const k of Object.keys(App.mv.tune)) if (t[k] !== undefined) App.mv.tune[k] = t[k];
} catch (e) {}
const MV_STYLE_DEFS = [
  { id: 'flow', label: '流光', desc: '逐词漂浮' },
  { id: 'fume', label: '浮名', desc: '整版漫游' },
  { id: 'diorama', label: '星屑', desc: '立体景深' },
  { id: 'chat', label: '对话', desc: 'Folia 原版渲染' },
  { id: 'cinema', label: '光影', desc: 'Folia 原版渲染' },
  { id: 'hanabi', label: '花火', desc: '爆炸大字' },
  { id: 'vertical', label: '纵向', desc: '竖排歌词' },
  { id: 'poem', label: '向籁', desc: 'Folia 原版渲染' },
  { id: 'cloud', label: '云阶', desc: 'Folia 原版渲染' },
  { id: 'confess', label: '倾诉', desc: 'Folia 原版渲染' },
  { id: 'fog', label: '雾笼', desc: 'Folia 原版渲染' },
  { id: 'lumiere', label: '绘光', desc: 'Folia 原版渲染' },
  { id: 'tempera', label: '淡彩', desc: 'Folia 原版渲染' },
  { id: 'ring', label: '回环', desc: 'Folia 原版渲染' },
  { id: 'cadenza', label: '心象', desc: 'Folia 原版渲染' },
  { id: 'monet', label: '莫奈', desc: 'Folia 原版渲染' },
  { id: 'pvharu', label: '春日', desc: 'PV Tool 试点' },
  { id: 'pvcyber', label: '赛博', desc: 'PV Tool 试点' },
  { id: 'pvweb', label: '蛛网', desc: 'PV Tool 试点' },
];
const MV_STYLE_IDS = new Set(MV_STYLE_DEFS.map(x => x.id));
const MV_MOODS = ['auto', 'dream', 'night', 'rain', 'warm', 'neon', 'cover', 'lineart'];
const MV_MOOD_LABEL = { auto: '自动', dream: '梦幻', night: '星夜', rain: '雨夜', warm: '暖光', neon: '霓虹', cover: '封面', lineart: '线稿' };
try {
  App.mv.on = localStorage.getItem('bp.mvOn') === '1';
  App.mv.video = localStorage.getItem('bp.mvVideo') === '1';
  const ms = localStorage.getItem('bp.mvStyle');
  if (MV_STYLE_IDS.has(ms)) App.mv.style = ms;
  const mm = localStorage.getItem('bp.mvMood');
  if (MV_MOODS.includes(mm)) App.mv.mood = mm;
  if (localStorage.getItem('bp.mvTone') === 'light') App.mv.tone = 'light';
} catch (e) {}
function mvBindApi() {
  return {
    layer: document.getElementById('mv-layer'),
    getLines: () => (state.lyrics && state.lyrics.lines) || [],
    getSegments: () => App.mv.segments,
    getBpm: () => App.mv.bpmInfo,
    getLoading: () => !state.lyrics || !!state.lyrics.loading,
    getTime: () => { try { return Player.activeEl().currentTime || 0; } catch (e) { return 0; } },
    getDuration: () => {
      try {
        const el = Player.activeEl();
        if (el && isFinite(el.duration) && el.duration > 0) return el.duration;
      } catch (e) {}
      return (Player.S.track && Player.S.track.duration) || 0;
    },
    getTrack: () => Player.S.track || {},
    getPlaying: () => !!Player.S.playing,
    getSpectrum: () => { try { return Player.getSpectrum(); } catch (e) { return null; } },
    getColor: () => VIZ.color || '#fb7299',
    getStyle: () => App.mv.style,
    getCoverUrl: () => pic((Player.S.track && Player.S.track.pic) || ''),
    getMoodOverride: () => App.mv.mood,
    getAiTheme: () => App.mv.aiTheme,
    getTone: () => App.mv.tone,
    getTrackKey: () => {
      const t = Player.S.track;
      if (!t) return '';
      return (t.bvid || ('n' + t.nid) || '') + '|' + (t.title || '');
    }
  };
}
function mvMoodText() { return '背景·' + (MV_MOOD_LABEL[App.mv.mood] || '自动'); }
function updateMVMoodBtn() { $$('.mv-mood-btn').forEach(b => { b.textContent = mvMoodText(); }); }
function toggleMVMood() {
  const i = MV_MOODS.indexOf(App.mv.mood);
  App.mv.mood = MV_MOODS[(i + 1) % MV_MOODS.length];
  try { localStorage.setItem('bp.mvMood', App.mv.mood); } catch (e) {}
  if (window.LyricMV) LyricMV.setMoodManual(App.mv.mood);
  updateMVMoodBtn();
  toast('动态MV背景：' + (App.mv.mood === 'auto' ? '自动识别' : MV_MOOD_LABEL[App.mv.mood]), App.mv.mood === 'auto' ? '' : 'success');
}

/* ---------- AI 主题：用户自带 Key，按歌曲生成 mood/色板 ---------- */
function aiTrackKey(t) {
  if (!t) return '';
  return (t.bvid ? 'b' + t.bvid : (t.nid ? 'n' + t.nid : '')) + '|' + (t.title || '');
}
async function loadAiConfig(force) {
  if (!force && App.mv.aiConfig) return App.mv.aiConfig;
  try {
    App.mv.aiConfig = await Api.get('ai/config');
  } catch (e) {
    if (force) throw e;
  }
  return App.mv.aiConfig;
}
function updateMVToneBtn() {
  const b = document.querySelector('.mv-tone-btn');
  if (!b) return;
  const th = App.mv.aiTheme && App.mv.aiTheme.theme;
  const can = !!(th && th.light && th.dark);
  b.style.display = can ? '' : 'none';
  b.textContent = App.mv.tone === 'light' ? '☀' : '☾';
  b.title = can ? (App.mv.tone === 'light' ? '切换到暗色主题' : '切换到亮色主题') : 'AI 主题才有日/夜切换';
}
function updateAiTag() {
  const tag = document.getElementById('mv-ai-tag');
  if (tag) {
    const th = App.mv.aiTheme && App.mv.aiTheme.theme;
    if (th) {
      const tt = th[App.mv.tone] || th.dark || th.light || {};
      tag.textContent = '✨ ' + (tt.name || th.name) + (App.mv.segments ? ' · 分词' : '');
      tag.title = (tt.description || th.description || '') + (App.mv.segments ? ' · AI 按语义切分歌词' : '') + (App.mv.bpmInfo ? ' · ' + Math.round(App.mv.bpmInfo.bpm) + ' BPM' : '');
      tag.classList.remove('hidden');
    } else {
      tag.textContent = '';
      tag.title = '';
      tag.classList.add('hidden');
    }
  }
  updateMVToneBtn();
}
function toggleMVTone() {
  const th = App.mv.aiTheme && App.mv.aiTheme.theme;
  if (!th || !th.light || !th.dark) { toast('这首歌还没有 AI 日/夜主题', ''); return; }
  App.mv.tone = App.mv.tone === 'light' ? 'dark' : 'light';
  try { localStorage.setItem('bp.mvTone', App.mv.tone); } catch (e) {}
  if (window.LyricMV) LyricMV.setTone(App.mv.tone);
  document.body.classList.toggle('mv-light-tone', App.mv.on && App.mv.tone === 'light');
  updateAiTag();
  toast(App.mv.tone === 'light' ? '已切换到 AI 亮色主题' : '已切换到 AI 暗色主题', 'success');
}
function toggleMVSubtitle(kind) {
  const roma = kind === 'roma';
  if (roma) App.mv.subRoma = !App.mv.subRoma;
  else App.mv.subTrans = !App.mv.subTrans;
  App.mv.subtitle = !!(App.mv.subTrans || App.mv.subRoma);
  try {
    localStorage.setItem(roma ? 'bp.mvSubRoma' : 'bp.mvSubTrans', (roma ? App.mv.subRoma : App.mv.subTrans) ? '1' : '0');
    localStorage.setItem('bp.mvSubtitle', App.mv.subtitle ? '1' : '0');
  } catch (e) {}
  $$('.mv-tone-btn[data-action="mv-subtitle"]').forEach(b => b.classList.toggle('active', App.mv.subTrans));
  $$('.mv-tone-btn[data-action="mv-sub-roma"]').forEach(b => b.classList.toggle('active', App.mv.subRoma));
  syncMVSubtitle();
  const on = roma ? App.mv.subRoma : App.mv.subTrans;
  toast((roma ? 'MV 罗马音：' : 'MV 翻译：') + (on ? '开' : '关'), on ? 'success' : '');
}
function applyAiTheme(key, theme) {
  App.mv.aiTheme = theme ? { key: key, theme: theme } : null;
  if (!theme || !theme.light) {
    App.mv.tone = 'dark';
    try { localStorage.setItem('bp.mvTone', 'dark'); } catch (e) {}
  }
  if (window.LyricMV) LyricMV.setAiTheme(theme || null, key || '');
  document.body.classList.toggle('mv-light-tone', !!App.mv.on && App.mv.tone === 'light' && !!theme);
  updateAiTag();
  scheduleDirector();
}
async function maybeLoadAiTheme(force) {
  const t = Player.S.track;
  if (!t) { applyAiTheme('', null); return; }
  if (!App.mv.on) {
    if (App.mv.aiTheme) applyAiTheme('', null);
    return;
  }
  const key = aiTrackKey(t);
  if (!key) return;
  if (App.mv.aiTheme && App.mv.aiTheme.key === key) { updateAiTag(); return; }
  if (App.mv.aiCache.has(key)) { applyAiTheme(key, App.mv.aiCache.get(key)); return; }
  const cfg = await loadAiConfig();
  if (!cfg || !cfg.enabled || !cfg.hasKey) { applyAiTheme(key, null); return; }
  if (!force && state.lyrics && state.lyrics.loading && !(state.lyrics.lines || []).length) {
    clearTimeout(App.mv.aiTimer);
    App.mv.aiTimer = setTimeout(() => maybeLoadAiTheme(true), 2600);
    return;
  }
  if (App.mv.aiLoadingKey === key) return;
  App.mv.aiLoadingKey = key;
  const lines = (state.lyrics && state.lyrics.lines) || [];
  const lyrics = lines.slice(0, 80).map(l => l.text).join('\n').slice(0, 1800);
  try {
    const r = await Api.post('ai/theme', { key: key, title: t.title || '', artist: t.up || '', lyrics: lyrics });
    const theme = r && r.theme;
    if (!theme) throw new Error('AI 主题为空');
    App.mv.aiCache.set(key, theme);
    if (aiTrackKey(Player.S.track) !== key) return;
    applyAiTheme(key, theme);
  } catch (e) {
    if (aiTrackKey(Player.S.track) !== key) return;
    if (e && e.code !== 'AI_OFF' && e.code !== 'AI_NO_KEY' && Date.now() - (App.mv.aiErrorAt || 0) > 12000) {
      App.mv.aiErrorAt = Date.now();
      toast('AI 主题生成失败：' + (e.message || e), '');
    }
    applyAiTheme(key, null);
  } finally {
    if (App.mv.aiLoadingKey === key) App.mv.aiLoadingKey = '';
  }
}
function aiSegKey(t, lines) {
  if (!t) return '';
  const s = (t.bvid || ('n' + (t.nid || ''))) + '|' + (lines || []).map(l => String(l.text || '')).join('\u0001');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return 'seg_' + (h >>> 0).toString(36);
}
function applyAiSegments(key, segs) {
  if (!Array.isArray(segs)) return;
  App.mv.segments = segs;
  App.mv.segmentsKey = key;
  if (window.LyricMV && LyricMV.refreshLine) LyricMV.refreshLine();
  updateAiTag();
}
/* 让 AI 按语义把整行切成词/词组，再交给逐词时间分配。
   AI 只决定“切在哪”，文本切片仍以原歌词为准；失败时自动回退本地分词。 */
async function maybeLoadAiSegments(force) {
  if (!App.mv.on) return;
  const t = Player.S.track;
  const lines = (state.lyrics && state.lyrics.lines) || [];
  if (!t || lines.length < 2) return;
  const key = aiSegKey(t, lines);
  if (!key) return;
  if (App.mv.segmentsKey === key) return;
  if (App.mv.segCache.has(key)) { applyAiSegments(key, App.mv.segCache.get(key)); return; }
  const cfg = await loadAiConfig();
  if (!cfg || !cfg.enabled || !cfg.hasKey) return;
  if (App.mv.segLoadingKey === key) return;
  App.mv.segLoadingKey = key;
  try {
    const r = await Api.post('ai/segment', { lines: lines.map(l => String(l.text || '')) });
    if (!r || !Array.isArray(r.lines)) throw new Error('AI 分词为空');
    App.mv.segCache.set(key, r.lines);
    if (!App.mv.on) return;
    if (aiSegKey(Player.S.track, (state.lyrics && state.lyrics.lines) || []) !== key) return;
    applyAiSegments(key, r.lines);
  } catch (e) {
    if (e && e.code !== 'AI_OFF' && e.code !== 'AI_NO_KEY') console.warn('[AI分词]', e.message || e);
  } finally {
    if (App.mv.segLoadingKey === key) App.mv.segLoadingKey = '';
  }
}
function applyBpmInfo(key, info) {
  App.mv.bpmInfo = info ? Object.assign({}, info, { key: key }) : null;
  if (window.LyricMV && LyricMV.setBpm) LyricMV.setBpm(App.mv.bpmInfo);
  updateAiTag();
  scheduleDirector();
}
/* BPM 辅助：只影响词头落点，不改变歌词行时间轴；失败时完全回退原权重分配 */
async function maybeLoadBpm(force) {
  if (!App.mv.on) return;
  const t = Player.S.track;
  if (!t || !t.bvid || !t.cid) return;
  const key = t.bvid + '|' + t.cid;
  if (App.mv.bpmInfo && App.mv.bpmInfo.key === key) return;
  if (App.mv.bpmCache.has(key)) { applyBpmInfo(key, App.mv.bpmCache.get(key)); return; }
  if (App.mv.bpmLoadingKey === key) return;
  App.mv.bpmLoadingKey = key;
  try {
    const ch = await chromaOf({ bvid: t.bvid, cid: t.cid });
    const info = detectBpm(ch);
    if (!info || !(info.bpm > 0)) throw new Error('没有检测到稳定节拍');
    App.mv.bpmCache.set(key, info);
    if (!App.mv.on || Player.S.track !== t) return;
    applyBpmInfo(key, info);
  } catch (e) {
    console.warn('[BPM]', e.message || e);
  } finally {
    if (App.mv.bpmLoadingKey === key) App.mv.bpmLoadingKey = '';
  }
}
async function openAiSettings() {
  let c = null;
  try { c = await loadAiConfig(true); } catch (e) {}
  c = c || { enabled: false, provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hasKey: false, keyHint: '' };
  showModal(`<h3>AI 主题</h3>
    <div class="ai-form">
      <label class="ai-row"><span>启用</span><input type="checkbox" id="ai-enabled" ${c.enabled ? 'checked' : ''}></label>
      <label class="ai-row"><span>协议</span><select id="ai-provider">
        <option value="openai" ${c.provider === 'openai' ? 'selected' : ''}>OpenAI 兼容（OpenAI / DeepSeek / Kimi / GLM / Qwen…）</option>
        <option value="gemini" ${c.provider === 'gemini' ? 'selected' : ''}>Google Gemini</option>
      </select></label>
      <label class="ai-row"><span>接口地址</span><input id="ai-base" value="${esc(c.baseUrl || '')}" placeholder="https://api.openai.com/v1"></label>
      <label class="ai-row"><span>模型</span><input id="ai-model" value="${esc(c.model || '')}" placeholder="gpt-4o-mini"></label>
      <label class="ai-row"><span>API Key</span><input id="ai-key" type="password" placeholder="${c.hasKey ? '已保存（…' + esc(c.keyHint) + '），留空保持不变' : 'sk-…'}"></label>
      <div class="ai-note">歌曲标题、歌手和歌词会发送到你填写的 AI 服务，用于生成主题与按语义切分歌词（逐词节奏）；结果缓存 30 天。Key 只保存在本机 data/ai_config.json。不填 Key 或请求失败时自动回退到离线规则与本地分词。</div>
      <div class="ai-status" id="ai-status"></div>
      <div class="m-row"><button class="btn" data-action="ai-test">测试连接</button><button class="btn primary" data-action="ai-save">保存</button><button class="btn ghost" data-action="modal-close">取消</button></div>
    </div>`);
}
async function saveAiSettings(close) {
  const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const cfg = {
    enabled: !!(document.getElementById('ai-enabled') && document.getElementById('ai-enabled').checked),
    provider: (document.getElementById('ai-provider') || {}).value || 'openai',
    baseUrl: val('ai-base'),
    model: val('ai-model'),
    apiKey: val('ai-key')
  };
  try {
    const r = await Api.post('ai/config', cfg);
    App.mv.aiConfig = r;
    App.mv.aiCache.clear();
    App.mv.aiTheme = null;
    App.mv.segCache.clear();
    App.mv.segments = null;
    App.mv.segmentsKey = '';
    if (window.LyricMV) { LyricMV.setAiTheme(null, ''); if (LyricMV.refreshLine) LyricMV.refreshLine(); }
    updateAiTag();
    toast('AI 设置已保存', 'success');
    if (close) closeModal();
    maybeLoadAiTheme(true);
    clearTimeout(App.mv.segTimer);
    App.mv.segTimer = setTimeout(() => maybeLoadAiSegments(true), 600);
    App.mv.bpmTimer = setTimeout(() => maybeLoadBpm(true), 1500);
    return r;
  } catch (e) {
    toast('AI 设置保存失败：' + (e.message || e), 'error');
    throw e;
  }
}
async function testAiSettings() {
  const st = document.getElementById('ai-status');
  if (st) st.textContent = '测试中…（最多 20 秒）';
  try {
    await saveAiSettings(false);
    const r = await Api.post('ai/test', {});
    if (st) st.textContent = '连接成功 · ' + r.latencyMs + 'ms · ' + r.model;
    toast('AI 连接成功（' + r.latencyMs + 'ms）', 'success');
  } catch (e) {
    if (st) st.textContent = '连接失败：' + (e.message || e);
  }
}
function mvStyleLabel(id) {
  const d = MV_STYLE_DEFS.find(x => x.id === id);
  return d ? d.label : '流光';
}
const DIRECTOR_SAFE = ['lumiere','hanabi','poem','tempera','confess','cloud','ring','cadenza','fog','chat','cinema','monet','flow','vertical'];
function directorMood() {
  if (App.mv.mood && App.mv.mood !== 'auto') return App.mv.mood;
  const th = App.mv.aiTheme && App.mv.aiTheme.theme;
  const txt = th ? ((th.name || '') + ' ' + (th.description || '')) : '';
  if (/雨|rain|雾|fog/i.test(txt)) return 'rain';
  if (/夜|月|星|梦|night|dream|moon/i.test(txt)) return 'night';
  if (/霓虹|街|都|neon|city/i.test(txt)) return 'neon';
  if (/花|夏|暖|纸|warm|flower|summer/i.test(txt)) return 'warm';
  return 'dream';
}
function directorPick(force) {
  if (!App.mv.director) return;
  const track = Player.S.track || {};
  const tkey = String(track.bvid || track.nid || track.title || '');
  if (!force && App.mv.directorTrack === tkey) return;
  if (!force && !App.mv.aiTheme && !App.mv.bpmInfo) return;
  const mood = directorMood();
  const bpm = Number(App.mv.bpmInfo && App.mv.bpmInfo.bpm) || 0;
  let pool;
  if (bpm > 128 || mood === 'neon') pool = ['hanabi','cadenza','ring','confess','monet'];
  else if (bpm > 0 && bpm < 82) pool = ['poem','cloud','vertical','monet','fog'];
  else if (mood === 'rain') pool = ['fog','cinema','poem','vertical'];
  else if (mood === 'night') pool = ['lumiere','hanabi','fog','cadenza','ring'];
  else if (mood === 'warm') pool = ['tempera','cinema','monet','flow','confess'];
  else pool = ['ring','cloud','flow','monet','poem','confess'];
  pool = pool.filter(x => DIRECTOR_SAFE.includes(x));
  const t = Player.S.track || {};
  const th = App.mv.aiTheme && App.mv.aiTheme.theme;
  let h = 2166136261;
  const src = String(t.bvid || t.nid || t.title || '') + '|' + String(th && th.name || '') + '|' + mood + '|' + Math.round(bpm / 8);
  for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 16777619); }
  let pick = pool[(h >>> 0) % pool.length] || 'flow';
  if (!force && pick === App.mv.style && pool.length > 1) pick = pool[((h >>> 0) + 1) % pool.length];
  if (App.mv.style === pick) { App.mv.directorTrack = tkey; return; }
  App.mv.directorTrack = tkey;
  App.mv.directorBase = pick;
  App.mv.directorChorus = pickChorusStyle(pick, mood, bpm);
  setMVStyle(pick);
  if (window.LyricMV && LyricMV.setTune) {
    if (pick === 'flow') LyricMV.setTune({ flowVine: bpm > 120 ? 1.6 : (bpm && bpm < 82 ? 0.75 : 1), flowPreview: mood === 'dream' || mood === 'rain' });
    else if (pick === 'vertical') LyricMV.setTune({ vWait: mood === 'rain' ? .62 : .5, vCols: bpm > 120 ? 5 : 6 });
  }
}
function scheduleDirector() {
  if (!App.mv.director) return;
  clearTimeout(App.mv.directorTimer);
  App.mv.directorTimer = setTimeout(() => directorPick(), 1600);
}
function pickChorusStyle(base, mood, bpm) {
  const pool = (bpm > 128 || mood === 'neon') ? ['hanabi','cadenza','ring','confess','lumiere'] : ['ring','cadenza','confess','hanabi','lumiere','tempera'];
  const list = pool.filter(x => x !== base && DIRECTOR_SAFE.includes(x));
  if (!list.length) return base;
  const t = Player.S.track || {};
  const src = String(t.bvid || t.nid || t.title || '') + '|chorus|' + mood;
  let h = 2166136261;
  for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 16777619); }
  return list[(h >>> 0) % list.length];
}
function crossfadeTo(style) {
  if (!style || App.mv.style === style) return;
  if (style === App.mv.directorChorus && Date.now() < App.mv.sectionCooldownUntil) return;
  if (App.mv.sectionBusy) { App.mv.pendingSection = style; return; }
  if (style === App.mv.directorChorus) App.mv.sectionCooldownUntil = Date.now() + 12000;
  const el = document.getElementById('mv-transition');
  App.mv.sectionBusy = true;
  if (el) el.classList.add('show');
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (el) el.classList.remove('show');
    App.mv.sectionBusy = false;
    const next = App.mv.pendingSection;
    App.mv.pendingSection = '';
    if (next && next !== App.mv.style) crossfadeTo(next);
  };
  clearTimeout(App.mv.sectionTimer);
  App.mv.sectionTimer = setTimeout(finish, 4200);
  setTimeout(() => {
    setMVStyle(style, true);
    setTimeout(finish, 1050);
  }, 220);
}
function setSectionSwitch(on, quiet) {
  App.mv.sectionSwitch = !!on;
  try { localStorage.setItem('bp.mvSectionSwitch', App.mv.sectionSwitch ? '1' : '0'); } catch (e) {}
  const b = document.querySelector('[data-action="mv-section"]');
  if (b) b.classList.toggle('active', App.mv.sectionSwitch);
  if (!quiet) { try { toast(App.mv.sectionSwitch ? '副歌段落切换已开启' : '副歌段落切换已关闭', ''); } catch (e) {} }
  if (App.mv.sectionSwitch && document.body.classList.contains('mv-chorus') && App.mv.directorChorus) crossfadeTo(App.mv.directorChorus);
  else if (!App.mv.sectionSwitch && App.mv.directorBase && App.mv.style !== App.mv.directorBase) crossfadeTo(App.mv.directorBase);
}
function setLowPower(on, quiet) {
  if (!on && !quiet) App.mv.autoPerf = false;
  App.mv.lowPower = !!on;
  try { localStorage.setItem('bp.mvLowPower', App.mv.lowPower ? '1' : '0'); } catch (e) {}
  document.body.classList.toggle('mv-low-power', App.mv.lowPower);
  const b = document.querySelector('[data-action="mv-lowpower"]');
  if (b) { b.classList.toggle('active', App.mv.lowPower); b.textContent = App.mv.lowPower ? '省电' : '性能'; }
  if (window.LyricMV && LyricMV.setLowPower) LyricMV.setLowPower(App.mv.lowPower);
  if (window.FoliaBridge && FoliaBridge.setLowPower) FoliaBridge.setLowPower(App.mv.lowPower);
  if (!quiet) { try { toast(App.mv.lowPower ? '性能模式已开启' : '性能模式已关闭', ''); } catch (e) {} }
}
function setDirector(on, quiet) {
  App.mv.director = !!on;
  try { localStorage.setItem('bp.mvDirector', App.mv.director ? '1' : '0'); } catch (e) {}
  const b = document.querySelector('[data-action="mv-director"]');
  if (b) { b.classList.toggle('active', App.mv.director); b.textContent = App.mv.director ? '已开启' : '开启'; }
  if (App.mv.director) {
    if (!quiet) { try { toast('AI 导演已开启：按情绪 / BPM 自动选样式', 'success'); } catch (e) {} }
    directorPick(true);
  } else if (!quiet) {
    try { toast('AI 导演已关闭，恢复手动样式', ''); } catch (e) {}
    if (App.mv.directorBase && App.mv.style !== App.mv.directorBase) crossfadeTo(App.mv.directorBase);
  }
}
function updateTunePanel() {
  const box = document.getElementById('mv-tune');
  if (!box) return;
  const st = App.mv.style;
  const show = st === 'flow' || st === 'vertical';
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const title = document.getElementById('mv-tune-title');
  if (title) title.textContent = mvStyleLabel(st);
  box.querySelectorAll('[data-tune-group]').forEach(g => g.classList.toggle('hidden', g.dataset.tuneGroup !== st));
  box.querySelectorAll('[data-tune]').forEach(inp => {
    const k = inp.dataset.tune;
    const v = App.mv.tune[k];
    if (inp.type === 'checkbox') inp.checked = !!v;
    else inp.value = v;
    const em = box.querySelector('[data-val="' + k + '"]');
    if (em) em.textContent = k === 'flowVine' ? Number(v).toFixed(1) : (k === 'vWait' ? Number(v).toFixed(2) : v);
  });
}
function setMVStyle(style, keepTransition) {
  if (!keepTransition) {
    clearTimeout(App.mv.sectionTimer);
    App.mv.sectionBusy = false;
    App.mv.pendingSection = '';
    const tr = document.getElementById('mv-transition');
    if (tr) tr.classList.remove('show');
  }
  App.mv.style = MV_STYLE_IDS.has(style) ? style : 'flow';
  try { localStorage.setItem('bp.mvStyle', App.mv.style); } catch (e) {}
  if (App.mv.on && window.LyricMV) {
    LyricMV.setStyle(App.mv.style);
    LyricMV.step(); // 立即重建当前行，切样式不等到下一帧
  }
  const name = document.getElementById('mv-style-name');
  if (name) name.textContent = mvStyleLabel(App.mv.style);
  if (window.LyricMV && LyricMV.setTune) LyricMV.setTune(App.mv.tune);
  updateTunePanel();
  $$('.mv-style-card').forEach(b => b.classList.toggle('active', b.dataset.style === App.mv.style));
  const panel = document.getElementById('mv-style-panel');
  if (panel) panel.classList.add('hidden');
  if (window.FoliaBridge) FoliaBridge.setStyle(App.mv.style);
  syncMVSubtitle();
  syncMVInstrumental();
}
function toggleMVStylePanel() {
  const panel = document.getElementById('mv-style-panel');
  if (!panel) return;
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) updateTunePanel();
}

/* MV 背景视频：B站曲目把原视频静音垫在歌词后，按音频时钟对齐 */
function mvVideoEl() { return document.getElementById('mv-video'); }
function mvVideoPause() {
  const v = mvVideoEl();
  if (v) {
    try { v.pause(); } catch (e) {}
    delete v.dataset.mvKey;
  }
  if (App.mv.videoTimer) { clearInterval(App.mv.videoTimer); App.mv.videoTimer = 0; }
  const layer = document.getElementById('mv-layer');
  if (layer) layer.classList.remove('has-video');
  App.mv.videoKey = '';
  App.mv.videoGen++;
}
function mvVideoTick(force) {
  const v = mvVideoEl();
  if (!v || !App.mv.on || !App.mv.video || !v.src) return;
  if (document.hidden && !force) { try { v.pause(); } catch (e) {} return; }
  const a = Player.activeEl();
  if (!a || !a.src) { try { v.pause(); } catch (e) {} return; }
  if (a.paused) { if (!v.paused) v.pause(); return; }
  if (v.paused && v.readyState >= 2) v.play().catch(() => {});
  if (v.readyState < 2 || !isFinite(v.duration) || v.duration <= 0) return;
  try {
    if (v.playbackRate !== a.playbackRate) v.playbackRate = a.playbackRate || 1;
    let target = a.currentTime || 0;
    if (v.duration < ((a.duration || 0) - 0.5)) target = target % v.duration;
    if (Math.abs(v.currentTime - target) > 0.4) v.currentTime = target;
  } catch (e) {}
}
async function mvVideoLoad(key) {
  const v = mvVideoEl();
  if (!v) return;
  const gen = ++App.mv.videoGen;
  App.mv.videoKey = key;
  v.dataset.mvKey = key;
  const parts = key.split('|');
  let url = '';
  const hit = App.mv.videoUrls.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) url = hit.url;
  if (!url) {
    try {
      const d = await Api.get('media', { bvid: parts[0], cid: parts[1], kind: 'video' });
      if (gen !== App.mv.videoGen) return;
      url = d.url || '';
      if (url) {
        App.mv.videoUrls.set(key, { url: url, at: Date.now() });
        if (App.mv.videoUrls.size > 60) App.mv.videoUrls.delete(App.mv.videoUrls.keys().next().value);
      }
    } catch (e) {
      if (gen !== App.mv.videoGen) return;
      delete v.dataset.mvKey;
      App.mv.videoKey = '';
      App.mv.videoFail = { key: key, at: Date.now() };
      toast('MV背景视频加载失败，继续使用动态背景', '');
      return;
    }
  }
  if (gen !== App.mv.videoGen || !App.mv.on || !App.mv.video) return;
  App.mv.videoFail = null;
  const layer = document.getElementById('mv-layer');
  try {
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.src = url;
    v.load();
    v.oncanplay = () => {
      if (gen !== App.mv.videoGen) return;
      if (layer) layer.classList.add('has-video');
      mvVideoTick();
    };
    v.onerror = () => {
      if (gen !== App.mv.videoGen) return;
      if (layer) layer.classList.remove('has-video');
      delete v.dataset.mvKey;
      App.mv.videoKey = '';
      App.mv.videoFail = { key: key, at: Date.now() };
    };
    if (!App.mv.videoTimer) App.mv.videoTimer = setInterval(mvVideoTick, 500);
  } catch (e) {}
}
function syncMVVideo() {
  if (!window.LyricMV) return;
  const t = Player.S.track;
  const want = !!(App.mv.on && App.mv.video && state.view.name === 'nowplaying'
    && Player.S.mode !== 'video' && t && t.bvid && t.cid);
  const v = mvVideoEl();
  if (!want || !v) { mvVideoPause(); return; }
  const key = t.bvid + '|' + t.cid;
  const failed = App.mv.videoFail && App.mv.videoFail.key === key && Date.now() - App.mv.videoFail.at < 30000;
  if (v.dataset.mvKey !== key && !failed) mvVideoLoad(key);
  if (!App.mv.videoTimer) App.mv.videoTimer = setInterval(mvVideoTick, 500);
  mvVideoTick();
}
function toggleMVVideo() {
  const t = Player.S.track;
  if (!t || !t.bvid || !t.cid) { toast('当前歌曲没有B站视频，继续使用动态背景', ''); return; }
  App.mv.video = !App.mv.video;
  App.mv.videoFail = null;
  try { localStorage.setItem('bp.mvVideo', App.mv.video ? '1' : '0'); } catch (e) {}
  $$('.mv-video-btn').forEach(b => b.classList.toggle('active', App.mv.video));
  syncMVVideo();
  syncMVSubtitle();
  toast(App.mv.video ? 'MV背景已开启' : 'MV背景已关闭', App.mv.video ? 'success' : '');
}
/* 只在“正在播放 + 纯听 + 有歌 + 开关打开”时运行；其余情况立即停 rAF */
function syncMV() {
  const on = !!(App.mv.on && state.view.name === 'nowplaying' && Player.S.track && Player.S.mode !== 'video');
  document.body.classList.toggle('mv-on', on);
  if (!window.LyricMV) return;
  const layer = document.getElementById('mv-layer');
  if (on && layer) {
    if (App.mv.layer !== layer) {
      App.mv.layer = layer;
      LyricMV.bind(mvBindApi());
    }
    LyricMV.start();
    maybeLoadAiSegments(false);
    maybeLoadBpm(false);
  } else {
    LyricMV.stop();
    if (App.mv.layer && !App.mv.layer.isConnected) App.mv.layer = null;
  }
  syncMVVideo();
  if (window.FoliaBridge) FoliaBridge.sync();
  const FOLIA_STYLES = new Set(['lumiere', 'hanabi', 'poem', 'tempera', 'confess', 'cloud', 'fog', 'ring', 'cadenza', 'chat', 'cinema', 'monet', 'pvharu', 'pvcyber', 'pvweb']);
  const foliaStyle = on && FOLIA_STYLES.has(App.mv.style) ? App.mv.style : '';
  if (App._foliaCheckStyle !== foliaStyle) {
    clearTimeout(App._foliaCheck);
    App._foliaCheck = 0;
    App._foliaCheckStyle = foliaStyle;
  }
  if (foliaStyle) {
    const h0 = document.getElementById('mv-folia-lumiere');
    if (h0 && (h0.querySelector('canvas') || h0.childElementCount > 0)) document.body.classList.remove('mv-folia-failed');
    if (!App._foliaCheck) {
      App._foliaCheck = setTimeout(() => {
        App._foliaCheck = 0;
        const h = document.getElementById('mv-folia-lumiere');
        const ok = h && (h.querySelector('canvas') || h.childElementCount > 0);
        const failed = !ok;
        document.body.classList.toggle('mv-folia-failed', failed);
        if (failed) toast('MV 渲染器 8 秒内未就绪，已回退动态背景', '');
      }, 8000);
    }
  } else {
    document.body.classList.remove('mv-folia-failed');
  }
  document.body.classList.toggle('mv-light-tone', !!on && !!window.LyricMV && LyricMV.debug().tone === 'light');
  updateAiTag();
}
function toggleMV() {
  App.mv.on = !App.mv.on;
  try { localStorage.setItem('bp.mvOn', App.mv.on ? '1' : '0'); } catch (e) {}
  if (App.mv.on) {
    state.npInfoTab = 'lyric';
    loadLyricsIfNeeded();
  }
  if (!App.mv.on) document.body.classList.remove('mv-chorus');
  syncMV();
  syncMVSubtitle();
  syncMVInstrumental();
  if (App.mv.on) { maybeLoadAiTheme(false); scheduleDirector(); }
  toast(App.mv.on ? '动态MV已开启' : '动态MV已关闭', App.mv.on ? 'success' : '');
}

function recKey(it) { return it && (it.nid ? 'n' + it.nid : (it.bvid ? 'b' + it.bvid : '')); }
function recItemFromNe(r, kind) {
  return { nid: r.nid, ne: true, title: stripEm(r.name), up: r.artist || '', pic: r.pic || '', duration: Math.round((r.durationMs || 0) / 1000), rec: kind };
}
function recItemFromBili(it, kind) {
  return { bvid: it.bvid, aid: it.aid, title: stripEm(it.title), up: it.up || '', upMid: it.upMid, pic: it.pic || '', duration: it.duration || 0, rec: kind };
}
function shuffleArr(a) { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = x[i]; x[i] = x[j]; x[j] = t; } return x; }
function currentNePid() {
  const cur = Player.cur ? Player.cur() : null;
  if (!cur) return '';
  for (const pl of state.playlists || []) {
    if (!pl.nePid) continue;
    if ((pl.items || []).some(it => (cur.nid && it.nid === cur.nid) || (cur.bvid && it.bvid === cur.bvid))) return String(pl.nePid);
  }
  return '';
}
/* 心动推荐来源：官方心动(需歌单pid) → 相似歌曲 → B站related */
async function fetchHeartRecs(t, count) {
  const seen = App.heart.seen;
  if (!t) return [];
  if (t.nid) {
    const pid = currentNePid();
    if (pid) {
      try {
        const d = await Api.get('nheart', { id: t.nid, pid, count: Math.max(1, count) });
        if (d.tracks && d.tracks.length) return d.tracks;
      } catch (e) { if (e && e.risk) throw e; }
    }
    try {
      const d = await Api.get('nsimi', { id: t.nid });
      if (d.tracks && d.tracks.length) return shuffleArr(d.tracks.filter(x => !seen.has('n' + x.nid))).slice(0, Math.max(3, count * 3));
    } catch (e) { if (e && e.risk) throw e; }
  }
  if (t.bvid) {
    let aid = t.aid;
    if (!aid) { try { const v = await Api.get('video', { bvid: t.bvid }); aid = v.aid; t.aid = aid; } catch (e) {} }
    if (aid) { try { const d = await Api.get('related', { aid }); return d.items || []; } catch (e) {} }
  }
  return [];
}
async function maybeHeartbeat(force) {
  const H = App.heart;
  if (!H.on || H.busy || App.roam.active) return;
  const S = Player.S;
  if (!S.track || S.track.rec) return; // 推荐曲不再触发推荐，避免链式
  if (!force) { H.count++; if (H.count < H.every) return; }
  H.count = 0;
  if (H.recs >= 40) return;
  H.busy = true;
  try {
    const recs = await fetchHeartRecs(S.track, 1);
    let item = null;
    for (const r of recs) {
      if (!r) continue;
      const k = r.nid ? 'n' + r.nid : (r.bvid ? 'b' + r.bvid : '');
      if (!k || H.seen.has(k)) continue;
      if (S.queue.some(q => recKey(q) === k)) continue;
      H.seen.add(k);
      item = r.nid ? recItemFromNe(r, 'heart') : recItemFromBili(r, 'heart');
      break;
    }
    if (item) {
      Player.insertAfterCurrent([item]);
      H.recs++;
      toast('💗 心动推荐：' + item.title, '');
      if (state.view.name === 'nowplaying') renderView();
    }
  } catch (e) {
    if (e && e.risk) toast('网易云风控中，心动推荐暂停一会儿', '');
  } finally { H.busy = false; }
}
function heartUI() {
  document.querySelectorAll('[data-action="heart-toggle"]').forEach(b => b.classList.toggle('active', App.heart.on));
  const pb = document.getElementById('pb-heart');
  if (pb) { pb.classList.toggle('on', App.heart.on); pb.title = App.heart.on ? '心动模式：开（点击关闭）' : '心动模式：关（点击开启）'; }
}
function toggleHeart(force) {
  App.heart.on = typeof force === 'boolean' ? force : !App.heart.on;
  App.heart.count = 0;
  try { localStorage.setItem('bp.heartOn', App.heart.on ? '1' : '0'); } catch (e) {}
  heartUI();
  toast(App.heart.on ? '心动模式已开启：每 2 首插入一首同风格推荐' : '心动模式已关闭', App.heart.on ? 'success' : '');
  if (App.heart.on && Player.S.track && !Player.S.track.rec) maybeHeartbeat(true);
}
/* 漫游：拉一批（FM优先，失败降级B站related），replace=替换队列 / 否则追加 */
async function roamFetch(count, replace) {
  const R = App.roam;
  if (!R.active || R.fetching) return false;
  R.fetching = true;
  try {
    let items = [];
    let source = 'ne';
    try {
      const d = await Api.get('nfm');
      const list = (d.tracks || []).filter(t => !R.seen.has('n' + t.nid));
      items = shuffleArr(list).slice(0, count).map(t => { R.seen.add('n' + t.nid); return recItemFromNe(t, 'roam'); });
    } catch (e) {
      if (e && e.risk) toast('网易云风控中，漫游降级为B站电台', '');
      source = 'bili';
    }
    if (!items.length) {
      source = 'bili';
      const seed = Player.S.track;
      let aid = seed && seed.aid;
      if (!aid && seed && seed.bvid) { try { const v = await Api.get('video', { bvid: seed.bvid }); aid = v.aid; seed.aid = aid; } catch (e) {} }
      if (!aid) { const last = Player.S.queue[Player.S.queue.length - 1]; aid = last && last.aid; }
      if (aid) {
        try {
          const d = await Api.get('related', { aid });
          items = (d.items || []).filter(x => x.bvid && !R.seen.has('b' + x.bvid)).slice(0, count)
            .map(x => { R.seen.add('b' + x.bvid); return recItemFromBili(x, 'roam'); });
        } catch (e) {}
      }
    }
    if (!items.length) return false;
    R.source = source;
    if (replace) {
      Player.setQueue(items, 0);
      Player.S.source = null;
      Player.playCurrent().catch(() => {});
    } else {
      Player.setQueue(Player.S.queue.concat(items), Player.S.index);
      if (state.view.name === 'nowplaying') renderView();
    }
    updateRoamUI();
    return true;
  } finally { R.fetching = false; }
}
function updateRoamUI() {
  const pb = document.getElementById('pb-roam');
  if (pb) { pb.classList.toggle('on', App.roam.active); pb.title = App.roam.active ? '漫游中（点击退出）' : '漫游（私人FM）'; }
  document.querySelectorAll('[data-action="roam-toggle"]').forEach(b => b.classList.toggle('active', App.roam.active));
  document.body.classList.toggle('roam-on', App.roam.active);
}
function startRoam() {
  if (App.roam.active) { stopRoam(); return; }
  App.roam = { active: true, seen: new Set(), fetching: false, prev: { queue: Player.S.queue.slice(), index: Player.S.index, source: Player.S.source }, source: '' };
  updateRoamUI();
  toast('进入漫游…', '');
  roamFetch(10, true).then(ok => {
    if (!ok) { stopRoam(true); toast('漫游启动失败（网易云未登录或受限），已返回原队列', 'error'); }
    else if (state.view.name === 'nowplaying') renderView();
  });
}
function stopRoam(silent) {
  if (!App.roam.active) return;
  const prev = App.roam.prev;
  App.roam = { active: false, seen: new Set(), fetching: false, prev: null, source: '' };
  if (prev && prev.queue && prev.queue.length) {
    Player.setQueue(prev.queue, Math.max(0, Math.min(prev.index, prev.queue.length - 1)));
    Player.S.source = prev.source || null;
    Player.playCurrent().catch(() => {});
  }
  updateRoamUI();
  if (!silent) toast('已退出漫游，回到原歌单', '');
  if (state.view.name === 'nowplaying') renderView();
}
async function roamLike() {
  const t = Player.S.track;
  if (!t || !t.nid) { toast('当前歌曲不支持红心', ''); return; }
  try {
    const d = await Api.get('nlike', { id: t.nid, like: 1 });
    toast(d.ok ? '已红心：' + t.title : '收藏失败', d.ok ? 'success' : 'error');
  } catch (e) { errToast(e); }
}
async function roamDislike() {
  const t = Player.S.track;
  if (t && t.nid) { try { await Api.get('nfm/trash', { id: t.nid }); } catch (e) {} }
  const S = Player.S;
  if (S.queue.length > 1) {
    S.queue.splice(S.index, 1);
    if (S.index >= S.queue.length) S.index = 0;
    Player.playCurrent().catch(() => {});
  } else {
    roamFetch(10, true);
  }
  toast('已减少此类推荐', '');
  if (state.view.name === 'nowplaying') renderView();
}

/* ---------- 基础 UI ---------- */
const modalRoot = () => $('#modal-root');
const popRoot = () => $('#pop-root');

function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 320);
  }, type === 'error' ? 3600 : 2300);
}
function errToast(e) {
  toast((e && e.message) || '请求失败', e && e.code === -101 ? '' : 'error');
  if (e && e.code === -101) { state.folders = null; render(); openLogin(); }
}

function showModal(html, cls) {
  if (!cls && html.includes("ver-head")) cls = "wide"; // 版本宇宙弹窗自动加宽
  modalRoot().innerHTML = `<div class="modal-mask"><div class="modal${cls ? " " + cls : ""}">${html}<button class="m-close" data-action="modal-close">${ICON.close}</button></div></div>`;
}
function closeModal() {
  modalRoot().innerHTML = '';
  state._pmCb = null; state._cmCb = null;
  if (state.loginTimer) { clearInterval(state.loginTimer); state.loginTimer = null; }
  state.loginToken++;
}
function promptModal(title, def, cb) {
  showModal(`<h3>${esc(title)}</h3>
    <div class="m-row"><input class="m-input" id="pm-input" placeholder="输入名称" maxlength="40" value="${esc(def || '')}"></div>
    <div class="m-row"><button class="btn ghost" style="flex:1;justify-content:center" data-action="modal-close">取消</button>
    <button class="btn primary" style="flex:1;justify-content:center" data-action="pm-ok">确定</button></div>`);
  state._pmCb = cb;
  setTimeout(() => {
    const i = $('#pm-input');
    if (!i) return;
    i.focus(); i.select();
    i.addEventListener('keydown', e => { if (e.key === 'Enter') { const b = $('[data-action="pm-ok"]'); if (b) b.click(); } });
  }, 60);
}
function confirmModal(text, cb) {
  showModal(`<h3>提示</h3><p style="text-align:center;color:var(--t2);line-height:1.8">${text}</p>
    <div class="m-row"><button class="btn ghost" style="flex:1;justify-content:center" data-action="modal-close">取消</button>
    <button class="btn danger" style="flex:1;justify-content:center" data-action="cm-ok">确定</button></div>`);
  state._cmCb = cb;
}
function closePops() {
  if (popRoot().innerHTML) { popRoot().innerHTML = ''; updateVideoMount(); return true; }
  return false;
}

/* ---------- 渲染入口 ---------- */
function go(name, params = {}) {
  const cur = state.view;
  if (cur.name !== name || JSON.stringify(Object.assign({}, cur, { name: null })) !== JSON.stringify(Object.assign({}, params, { name: null }))) {
    state.history.push(cur);
    if (state.history.length > 20) state.history.shift();
  }
  state.view = Object.assign({ name }, params);
  window.scrollTo(0, 0);
  $('#view').scrollTop = 0;
  render();
}
function goBack() {
  const prev = state.history.pop();
  if (prev && prev.name && prev.name !== 'nowplaying') {
    state.view = prev;
    window.scrollTo(0, 0);
    $('#view').scrollTop = 0;
    render();
  } else {
    go('favfolders');
  }
}
/* 纯听页沉浸模式：主区域整体转深色 */
let _bgPreload = new Image();      // 常驻预加载器：新图加载完成前全窗口层保留旧图
function syncImmersive() {
  const on = state.view.name === 'nowplaying' && Player.S.mode !== 'video' && !!Player.S.track;
  document.body.classList.toggle('immersive', !!on);
  /* 透明侧栏：播放页封面背景升级为全窗口层（np-stage 内的同一张图改为隐藏，由 body 层呈现），
     侧栏文字随封面明暗自适应反白 */
  const glassBg = SIDEBG.mode === 'clear' && on;
  document.body.classList.toggle('np-fullbg', glassBg);
  const root = document.documentElement;
  if (glassBg) {
    const want = Player.S.track && Player.S.track.pic ? pic(Player.S.track.pic) : '';
    const cur = root.style.getPropertyValue('--np-fullbg-img');
    // 目标图与当前层不一致：先预加载，onload 后再切（避免白底闪现）；失败保留旧图
    const curUrl = cur ? cur.replace(/^url\("/, '').replace(/"\)$/, '') : '';
    const apply = () => {
      if (document.body.classList.contains('np-fullbg')) root.style.setProperty('--np-fullbg-img', `url("${want}")`);
    };
    if (want && want !== curUrl) {
      if (_bgPreload.src === want && _bgPreload.complete) {
        /* 关键：图片已缓存时不会再触发 onload。返回播放页时必须同步套用，否则层里没有图 → 整页白屏 */
        if (_bgPreload.naturalWidth > 0) apply();
      } else {
        _bgPreload.onload = () => { _bgPreload.onload = null; apply(); };
        _bgPreload.onerror = () => { _bgPreload.onerror = null; }; // 失败保留旧图
        _bgPreload.src = want;
      }
    } else if (!want && !curUrl) {
      root.style.removeProperty('--np-fullbg-img');
    } else if (want) {
      root.style.setProperty('--np-fullbg-img', `url("${want}")`); // 已缓存一致
    }
  } else {
    root.style.removeProperty('--np-fullbg-img');
    _bgPreload.onload = null; _bgPreload.onerror = null;
  }
  const side = document.getElementById('sidebar');
  if (glassBg && side) {
    // 直接根据沉浸页整体偏暗的底色反白（封面经 blur+brightness(.8) 后近似恒暗）
    side.classList.add('np-fused-dark');
    side.classList.remove('np-fused-light');
  } else if (side) {
    side.classList.remove('np-fused-dark', 'np-fused-light');
  }
  syncMV();
}

function render() {
  renderSidebar();
  renderTopbar();
  renderView();
  renderImportBar();
  updateVideoMount();
  syncImmersive();
}

function renderSidebar() {
  const navMap = { favfolders: 'favfolders', favdetail: 'favfolders', search: 'search', nowplaying: 'nowplaying' };
  $$('.nav-item').forEach(el => {
    el.classList.toggle('active', navMap[state.view.name] === el.dataset.view);
  });
  $('#pl-list').innerHTML = state.playlists.map(pl => `
    <div class="pl-item ${state.view.name === 'pldetail' && state.playlist && state.playlist.id === pl.id ? 'active' : ''}"
         data-action="pl-open" data-id="${pl.id}" title="${esc(pl.name)}">
      ${ICON.music}<span>${esc(pl.name)}</span><em>${pl.items.length}</em>
    </div>`).join('') || `<div style="padding:8px 12px;font-size:12px;color:var(--t3)">还没有歌单</div>`;
}

function renderTopbar() {
  const v = state.view;
  let crumb = '';
  if (v.name === 'favdetail') {
    crumb = `<span class="back" data-action="back">${ICON.back}</span> 我的收藏 <span class="crumb-sub">/ ${esc(v.title || '')}</span>`;
  } else if (v.name === 'pldetail') {
    crumb = `<span class="back" data-action="back">${ICON.back}</span> 我的歌单 <span class="crumb-sub">/ ${esc(v.title || '')}</span>`;
  } else if (v.name === 'upspace') {
    crumb = `<span class="back" data-action="back">${ICON.back}</span> UP主页 <span class="crumb-sub">/ ${esc(v.title || '')}</span>`;
  } else if (v.name === 'search') {
    crumb = state.searchQ ? `搜索结果 <span class="crumb-sub">“${esc(state.searchQ)}”</span>` : `搜索`;
  } else if (v.name === 'nowplaying') {
    crumb = `正在播放`;
  } else if (v.name === 'playlists') {
    crumb = `我的歌单`;
  } else {
    crumb = `我的收藏`;
  }
  $('#crumb').innerHTML = crumb;

  const tr = $('#top-right');
  if (state.user && state.user.isLogin) {
    tr.innerHTML = `<div class="userchip" data-action="user-menu" title="点击退出登录">
      <img src="${esc(pic(state.user.face))}" onerror="this.style.visibility='hidden'">
      <div><div class="u-name">${esc(state.user.uname)}</div><div class="u-lv">LV${state.user.level}${state.user.vip ? ' · 大会员' : ''}</div></div>
    </div>`;
  } else {
    tr.innerHTML = `<button class="btn-login" style="width:auto;padding:7px 20px" data-action="login-open">扫码登录</button>`;
  }
  if (state.user && state.user.isLogin) {
    $('#side-user').innerHTML = `<div class="userchip" data-action="user-menu" title="${esc(state.user.uname)} · 点击退出">
      <img src="${esc(pic(state.user.face))}" onerror="this.style.visibility='hidden'">
      <div><div class="u-name">${esc(state.user.uname)}</div><div class="u-lv">点击退出</div></div></div>`;
  } else {
    $('#side-user').innerHTML = `<button class="btn-login" data-action="login-open">登录B站</button>`;
  }
  renderNEUser();
  // 搜索框与当前搜索状态保持一致（正在输入时不覆盖）
  const si = $('#search-input');
  if (document.activeElement !== si && si.value !== state.searchQ) si.value = state.searchQ;
}

/* ---------- 视图 ---------- */
function renderView() {
  Player.unmountVideo();
  const v = state.view;
  let html = '';
  if (v.name === 'favfolders') html = viewFavFolders();
  else if (v.name === 'favdetail') html = viewFavDetail();
  else if (v.name === 'search') html = viewSearch();
  else if (v.name === 'upspace') html = viewUpspace();
  else if (v.name === 'playlists') html = viewPlaylists();
  else if (v.name === 'pldetail') html = viewPlDetail();
  else if (v.name === 'nowplaying') html = viewNowplaying();
  $('#view').innerHTML = `<div class="view-fade">${html}</div>`;
  if (v.name === 'pldetail' && state.cdMode && state.playlist && state.playlist.items.length) {
    setupRlStage();
  } else {
    stopRlStage();
  }
  if (v.name === 'nowplaying' && Player.S.mode === 'video') {
    const m = $('#np-video');
    if (m) Player.mountVideo(m);
    setupNowplayingVideo();
  } else if (v.name === 'nowplaying' && Player.S.track) {
    setupNowplayingAudio();
  }
  mountDmLayer(); // 弹幕层：纯听挂舞台，看视频挂视频容器；离开本页自动停止
  refreshVersionsBadge(); // 版本宇宙角标（切到本页时同步）
  vizTick();
  updatePlayingMarks();
  syncMV(); // 歌词到达时会单独调 renderView()（不走 render），这里补一次绑定，避免 MV 指向被替换掉的旧 DOM
}

/* ---------- 音频波浪可视化（可自定义颜色/形态） ---------- */
const VIZ_COLOR = { line: '#fb7299', lineLight: '#ffb3cb' };
let VIZRGB = [251, 114, 153], VIZRGBL = [255, 179, 203];
const rgbaB = a => `rgba(${VIZRGB.join(',')},${a})`;
const rgbaL = a => `rgba(${VIZRGBL.join(',')},${a})`;
const Viz = { raf: 0, cols: null, t: 0, ro: null, progress: 0 };
const VIZ_COLS = 72;

/* 自定义配置（颜色共享；播放栏/纯听页律动条形态独立），保存在本地 */
const VIZ_DEFAULTS = {
  color: '#fb7299', sens: 1, smooth: 1, blur: 24, lyricSize: 14, cdBlur: 26, mvSubSize: 15, mvSubBottom: 13,
  bar: { height: 1, density: 1, sigma: 1 },
  stage: { height: 1, density: 1 }
};
let VIZ = JSON.parse(JSON.stringify(VIZ_DEFAULTS));
function hexToRgb(hex) {
  let m = String(hex || '').replace('#', '');
  if (m.length === 3) m = m.split('').map(c => c + c).join('');
  const nv = parseInt(m, 16);
  return [(nv >> 16) & 255, (nv >> 8) & 255, nv & 255];
}
function mixWhite(hex, k) {
  const [r, g, b] = hexToRgb(hex);
  const f = c => Math.round(c + (255 - c) * k);
  return [f(r), f(g), f(b)];
}
function applyVizColor() {
  const base = VIZ.color || '#fb7299';
  VIZRGB = hexToRgb(base);
  VIZRGBL = mixWhite(base, .45);
  VIZ_COLOR.line = `rgb(${VIZRGB.join(',')})`;
  VIZ_COLOR.lineLight = `rgb(${VIZRGBL.join(',')})`;
  document.documentElement.style.setProperty('--viz', VIZ_COLOR.line);
  document.documentElement.style.setProperty('--viz-light', VIZ_COLOR.lineLight);
  if (DM.buckets) drawDmHeat(); // 主题色变化时热力图同步换色
}
/* 颜色 + 歌词大小 + 背景模糊 全量应用 */
function applyVizAppearance() {
  applyVizColor();
  document.documentElement.style.setProperty('--np-blur', (VIZ.blur !== undefined ? VIZ.blur : 24) + 'px');
  document.documentElement.style.setProperty('--cd-blur', (VIZ.cdBlur !== undefined ? VIZ.cdBlur : 26) + 'px');
  document.documentElement.style.setProperty('--lyric-size', (VIZ.lyricSize !== undefined ? VIZ.lyricSize : 14) + 'px');
  document.documentElement.style.setProperty('--mv-sub-size', (VIZ.mvSubSize !== undefined ? VIZ.mvSubSize : 15) + 'px');
  document.documentElement.style.setProperty('--mv-sub-bottom', (VIZ.mvSubBottom !== undefined ? VIZ.mvSubBottom : 13) + '%');
}
function vizLoad() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('bp.viz') || '{}'); } catch {}
  VIZ = JSON.parse(JSON.stringify(VIZ_DEFAULTS));
  // 共享键
  ['color', 'sens', 'smooth', 'blur', 'lyricSize', 'cdBlur', 'mvSubSize', 'mvSubBottom'].forEach(k => { if (saved[k] !== undefined) VIZ[k] = saved[k]; });
  // 旧版扁平键迁移到新结构
  if (saved.height !== undefined) VIZ.bar.height = saved.height;
  if (saved.density !== undefined) { VIZ.bar.density = saved.density; VIZ.stage.density = saved.density; }
  if (saved.sigma !== undefined) VIZ.bar.sigma = saved.sigma;
  // 新结构键
  if (saved.bar && typeof saved.bar === 'object') Object.assign(VIZ.bar, saved.bar);
  if (saved.stage && typeof saved.stage === 'object') Object.assign(VIZ.stage, saved.stage);
  applyVizAppearance();
}
function vizSave() { localStorage.setItem('bp.viz', JSON.stringify(VIZ)); }

/* ---------- 侧栏背景自定义：默认 / 纯白 / 透明 / 毛玻璃 / 自定义颜色 ---------- */
const SIDEBG_DEFAULTS = { mode: 'default', color: '#fb7299' };
let SIDEBG = JSON.parse(JSON.stringify(SIDEBG_DEFAULTS));
function sideBgLoad() {
  try {
    const s = JSON.parse(localStorage.getItem('bp.sideBg') || 'null');
    if (s && s.mode) SIDEBG = Object.assign({}, SIDEBG_DEFAULTS, s);
  } catch (e) {}
}
function sideBgSave() { try { localStorage.setItem('bp.sideBg', JSON.stringify(SIDEBG)); } catch (e) {} }
/* 侧栏/底栏收起状态（持久化） */
function applyCollapse() {
  document.body.classList.toggle('side-collapsed', localStorage.getItem('bp.sideCollapsed') === '1');
  document.body.classList.toggle('pb-collapsed', localStorage.getItem('bp.pbCollapsed') === '1');
}
function toggleSidebar() {
  const on = localStorage.getItem('bp.sideCollapsed') === '1';
  localStorage.setItem('bp.sideCollapsed', on ? '0' : '1');
  applyCollapse();
}
function togglePb() {
  const on = localStorage.getItem('bp.pbCollapsed') === '1';
  localStorage.setItem('bp.pbCollapsed', on ? '0' : '1');
  applyCollapse();
}
function sideBgDark(color) {
  // 深色底自动切白字（亮度 < 0.55）
  try {
    const [r, g, b] = hexToRgb(color);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.55;
  } catch (e) { return false; }
}
function applySideBg() {
  const el = document.getElementById('sidebar');
  if (!el) return;
  el.classList.remove('sidebg-white', 'sidebg-clear', 'sidebg-glass', 'sidebg-color', 'sidebg-dark');
  if (SIDEBG.mode === 'white') el.classList.add('sidebg-white');
  else if (SIDEBG.mode === 'clear') el.classList.add('sidebg-clear');
  else if (SIDEBG.mode === 'glass') el.classList.add('sidebg-glass');
  else if (SIDEBG.mode === 'color') {
    el.classList.add('sidebg-color');
    el.style.setProperty('--side-custom', SIDEBG.color || '#ffffff');
    if (sideBgDark(SIDEBG.color)) el.classList.add('sidebg-dark');
  }
}
function sideBgMarkOpts() {
  $$('.sb-opt').forEach(el => el.classList.toggle('active', (el.dataset.mode || '') === SIDEBG.mode));
}

function stopVisualizer() {
  if (Viz.raf) { cancelAnimationFrame(Viz.raf); Viz.raf = 0; }
}
/* 渲染循环按需启停：底部播放条或纯听页舞台可见时运行 */
function vizTick() {
  const barActive = !document.getElementById('playerbar').classList.contains('hidden');
  const stageActive = !!document.getElementById('stage-viz');
  if (barActive || stageActive) {
    if (!Viz.raf) {
      const loop = () => { updateVizData(); drawVisualizer(); drawBarViz(); drawStageViz(); Viz.raf = requestAnimationFrame(loop); };
      Viz.raf = requestAnimationFrame(loop);
    }
  } else {
    stopVisualizer();
  }
}
/* 纯听页舞台底部：整宽竖向柱状律动条（装饰） */
function drawStageViz() {
  if (document.body.classList.contains('mv-on')) return; // 动态MV 自带背景律动，旧舞台条不再绘制
  const canvas = document.getElementById('stage-viz');
  if (!canvas) return;
  const stage = document.getElementById('np-stage');
  if (!stage) return;
  const w = stage.clientWidth, h = canvas.clientHeight || stage.clientHeight * 0.42;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const cols = vizColsReady();
  const bars = Math.max(24, Math.floor(w / (12 * (VIZ.stage.density || 1))));
  const step = w / bars;
  const bw = Math.max(2, step * 0.5);
  const baseH = h * 0.88 * (VIZ.stage.height || 1);
  const g = ctx.createLinearGradient(0, h - baseH, 0, h);
  g.addColorStop(0, rgbaB(.06));
  g.addColorStop(1, rgbaB(.5));
  ctx.fillStyle = g;
  for (let i = 0; i < bars; i++) {
    const f = ((i + 0.5) / bars) * (VIZ_COLS - 1);
    const i0 = Math.floor(f), i1 = Math.min(VIZ_COLS - 1, i0 + 1), fr = f - i0;
    const v = Math.min(1, (cols[i0] * (1 - fr) + cols[i1] * fr) * 1.25);
    const hgt = Math.max(2, v * baseH);
    const x = i * step + (step - bw) / 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, h - hgt, bw, hgt, [2, 2, 0, 0]);
    else ctx.rect(x, h - hgt, bw, hgt);
    ctx.fill();
  }
}
function vizColsReady() {
  if (!Viz.cols || Viz.cols.length !== VIZ_COLS) Viz.cols = new Array(VIZ_COLS).fill(0);
  return Viz.cols;
}
/* 每帧更新一次列振幅（低频权重更高，快起慢落） */
function updateVizData() {
  const cols = vizColsReady();
  Viz.t += 0.016;
  const data = Player.getSpectrum ? Player.getSpectrum() : null;
  const playing = Player.S.playing;
  for (let i = 0; i < VIZ_COLS; i++) {
    let v;
    if (data && playing) {
      const bins = data.length;
      const lo = Math.floor(Math.pow(i / VIZ_COLS, 1.5) * bins * 0.62);
      const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / VIZ_COLS, 1.5) * bins * 0.62));
      let sum = 0, c = 0;
      for (let b = lo; b < hi && b < bins; b++) { sum += data[b]; c++; }
      v = Math.min(1, (sum / c) / 215 * VIZ.sens);
    } else if (playing) {
      v = 0.22 + 0.18 * Math.abs(Math.sin(Viz.t * 2.1 + i * 0.33)); // 无分析器时的备用律动
    } else {
      v = 0;
    }
    const cur = cols[i];
    cols[i] = cur + (v - cur) * (v > cur ? 0.38 : Math.max(0.04, 0.12 / VIZ.smooth));
  }
}
function drawVisualizer() {
  const canvas = document.getElementById('np-audio-viz');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const cols = vizColsReady();
  const cy = h * 0.52;
  const maxAmp = h * 0.30;
  const n = VIZ_COLS;
  const colAt = (i, scale) => Math.max(1.5, Viz.cols[((i % n) + n) % n] * maxAmp * scale);
  const drawWave = (offset, scale, stroke, fill, glow) => {
    ctx.beginPath();
    for (let i = 0; i < n; i++) { // 上边缘
      const x = (i / (n - 1)) * w, y = cy - colAt(i + offset, scale);
      if (i === 0) ctx.moveTo(x, y);
      else {
        const px = ((i - 1) / (n - 1)) * w, py = cy - colAt(i - 1 + offset, scale);
        ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
      }
    }
    for (let i = n - 1; i >= 0; i--) { // 下边缘（镜像）
      const x = (i / (n - 1)) * w, y = cy + colAt(i + offset, scale);
      const nx = ((i + 1) / (n - 1)) * w, ny = cy + colAt(i + 1 + offset, scale);
      ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
    }
    ctx.closePath();
    if (fill) {
      const g = ctx.createLinearGradient(0, cy - maxAmp, 0, cy + maxAmp);
      g.addColorStop(0, rgbaB(.42));
      g.addColorStop(0.5, rgbaB(.14));
      g.addColorStop(1, rgbaB(.42));
      ctx.fillStyle = g;
      ctx.fill();
    }
    if (stroke) {
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = stroke;
      if (glow) { ctx.shadowColor = VIZ_COLOR.line; ctx.shadowBlur = 20; }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  };
  drawWave(9, 0.55, rgbaL(.38), false, false); // 背景回声层
  drawWave(0, 1, VIZ_COLOR.lineLight, true, true);          // 主波浪
}

/* 底部播放条：竖向峰柱状频谱，整体呈正态分布轮廓，控制按钮浮在其上 */
function drawBarViz() {
  const canvas = document.getElementById('pb-wave');
  if (!canvas) return;
  const bar = document.getElementById('playerbar');
  const w = bar.clientWidth, h = bar.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const cols = vizColsReady();
  const bars = Math.max(16, Math.floor(w / (8 * (VIZ.bar.density || 1)))); // 依宽度与柱距定条数
  const step = w / bars;
  const bw = Math.max(2, step * 0.62);
  const sigma = 0.24 * (VIZ.bar.sigma || 1); // 正态分布 σ
  const maxH = h * 0.95 * (VIZ.bar.height || 1);
  for (let i = 0; i < bars; i++) {
    const t = ((i + 0.5) / bars) * 2 - 1; // -1..1
    const env = Math.exp(-(t * t) / (2 * sigma * sigma));
    // 从 72 列平滑数据插值
    const f = ((i + 0.5) / bars) * (VIZ_COLS - 1);
    const i0 = Math.floor(f), i1 = Math.min(VIZ_COLS - 1, i0 + 1), fr = f - i0;
    const v = Math.min(1, (cols[i0] * (1 - fr) + cols[i1] * fr) * 1.35);
    const hgt = Math.max(2, v * maxH * (0.16 + 0.84 * env));
    const x = i * step + (step - bw) / 2;
    const played = ((i + 0.5) / bars) <= Viz.progress;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, h - hgt, bw, hgt, [2.5, 2.5, 0, 0]);
    else ctx.rect(x, h - hgt, bw, hgt);
    if (played) {
      const g = ctx.createLinearGradient(0, h - hgt, 0, h);
      g.addColorStop(0, `rgb(${VIZRGBL.join(',')})`);
      g.addColorStop(1, `rgb(${VIZRGB.join(',')})`);
      ctx.fillStyle = g;
      ctx.fill();
    } else {
      ctx.fillStyle = rgbaB(.26);
      ctx.fill();
    }
  }
}

/* ---- 播放页视频区：点击暂停、双击全屏、全屏控制层 ---- */
function setupNowplayingVideo() {
  const wrap = $('#np-video-wrap');
  if (!wrap) return;
  $('#np-video').addEventListener('click', () => Player.toggle());
  wrap.addEventListener('dblclick', toggleVideoFs);
  $('#np-ovl-play').innerHTML = Player.S.playing ? ICON.pause : ICON.play;
  $('#np-ovl-fs').innerHTML = document.fullscreenElement ? ICON.fsExit : ICON.fs;
  $('#np-ovl-play').addEventListener('click', () => Player.toggle());
  $('#np-ovl-fs').addEventListener('click', toggleVideoFs);
  const track = $('#np-ovl-track');
  track.addEventListener('pointerdown', e => {
    App._scrubbing = true;
    ovlSeek(e);
    const mv = ev => ovlSeek(ev);
    const up = () => { App._scrubbing = false; window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  });
  wrap.addEventListener('mousemove', pokeOvl);
  if (document.fullscreenElement) wrap.classList.add('is-fs');
}

function ovlSeek(e) {
  const track = $('#np-ovl-track');
  if (!track) return;
  const r = track.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  Player.seek(ratio * (Player.activeEl().duration || 0));
}

function toggleVideoFs() {
  const wrap = $('#np-video-wrap');
  if (!wrap) return;
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    wrap.requestFullscreen().catch(() => toast('当前环境不支持全屏'));
  }
}

/* 全屏时控制层/鼠标自动隐藏 */
function pokeOvl() {
  const wrap = $('#np-video-wrap');
  if (!wrap || !document.fullscreenElement) return;
  wrap.classList.add('ovl-show');
  clearTimeout(App._ovlTimer);
  App._ovlTimer = setTimeout(() => {
    const w = $('#np-video-wrap');
    if (w) w.classList.remove('ovl-show');
  }, 2600);
}

function emptyState(main, sub, btnHtml) {
  return `<div class="empty">${ICON.tv}<p>${main}</p>${sub ? `<div class="sub">${sub}</div>` : ''}${btnHtml || ''}</div>`;
}

/* ---- 我的收藏（收藏夹列表） ---- */
function viewFavFolders() {
  if (!state.user || !state.user.isLogin) {
    return emptyState('登录后导入你的B站收藏夹', '用哔哩哔哩APP扫码即可，账号数据只保存在本机',
      `<button class="btn primary" data-action="login-open">${ICON.heart} 扫码登录</button>`);
  }
  if (state.foldersLoading) return emptyState('正在获取收藏夹…');
  if (!state.folders) return emptyState('加载失败', '点击重试', `<button class="btn" data-action="refresh-folders">重新加载</button>`);
  const { created, collected } = state.folders;
  if (!created.length && !collected.length) return emptyState('还没有收藏夹', '去B站收藏一些喜欢的视频吧');
  const card = (f, kind) => `
    <div class="folder-card" data-action="folder-open" data-id="${f.id}" data-title="${esc(f.title)}">
      <div class="folder-cover">${f.cover ? `<img src="${esc(pic(f.cover))}" onerror="this.remove()">` : ICON.folder}</div>
      <div class="folder-info"><b>${esc(f.title)}</b><span>${f.count} 个视频</span></div>
      <span class="fc-tag t-${kind}">${kind === 'created' ? '创建' : '订阅'}</span>
    </div>`;
  return `<div class="toolbar">
      <div class="tb-title">我的收藏夹</div>
      <div class="tb-sub">${created.length} 创建 · ${collected.length} 订阅</div>
      <div class="sp"></div>
      <button class="btn ghost" data-action="refresh-folders">刷新</button>
    </div>
    <div class="folder-grid">${created.map(f => card(f, 'created')).join('')}${collected.map(f => card(f, 'collected')).join('')}</div>`;
}

async function loadFolders() {
  if (!state.user || !state.user.isLogin || state.foldersLoading) return;
  state.foldersLoading = true;
  renderView();
  try {
    state.folders = await Api.get('fav/folders');
  } catch (e) {
    state.folders = null;
    toast(e.message, e.code === -101 ? '' : 'error');
    if (e.code === -101) { state.user = { isLogin: false }; renderTopbar(); renderView(); return; }
  }
  state.foldersLoading = false;
  renderView();
}

/* ---- 视频卡片 ---- */
function cardHtml(it, idx) {
  const sel = state.selection.has(idx);
  const playingNow = Player.S.source === state.currentItems && Player.S.index === idx && Player.S.track;
  return `<div class="card ${sel ? 'selected' : ''} ${playingNow ? 'playing' : ''}" data-action="card" data-idx="${idx}">
    <div class="cover">
      <img src="${esc(pic(it.pic))}" loading="lazy" onerror="this.style.display='none'">
      <span class="dur">${fmt(it.duration)}</span>
      ${state.selectMode ? `<label class="ck"><input type="checkbox" data-action="select" data-idx="${idx}" ${sel ? 'checked' : ''}></label>` : ''}
      ${!state.selectMode ? `<button class="cover-play" data-action="play" data-idx="${idx}" title="播放">${ICON.play}</button>` : ''}
      ${!state.selectMode ? `<button class="cover-add" data-action="add" data-idx="${idx}" title="加入歌单">${ICON.plus}</button>` : ''}
    </div>
    <div class="card-title" title="${esc(it.title)}">${highlight(it.title)}</div>
    <div class="card-meta">
      <span class="up ${it.upMid ? 'up-link' : ''}" ${it.upMid ? `data-action="up-open" data-mid="${it.upMid}" data-up="${esc(it.up)}" title="查看UP主页"` : ''}>${esc(it.up)}</span>
      <span>${nfmt(it.play)}播放</span>
    </div>
  </div>`;
}

function gridToolbar(title, sub, extra) {
  return `<div class="toolbar">
    <div class="tb-title">${esc(title)}</div><div class="tb-sub">${sub}</div><div class="sp"></div>
    ${extra || ''}
    <button class="btn primary" data-action="play-all">${ICON.play} 播放全部</button>
    <button class="btn" data-action="select-mode">${state.selectMode ? '退出选择' : '批量选择'}</button>
  </div>`;
}

/* ---- 收藏夹详情 ---- */
function viewFavDetail() {
  const f = state.folder;
  if (!f) return emptyState('请从“我的收藏”选择一个收藏夹');
  const extra = `<button class="btn" data-action="fav-import-all">${ICON.list} 整夹导入歌单</button>`;
  let body;
  if (!state.currentItems.length && state.pageMeta.pn === 0) body = emptyState('加载中…');
  else if (!state.currentItems.length) body = emptyState('收藏夹是空的');
  else body = `<div class="grid">${state.currentItems.map((it, i) => cardHtml(it, i)).join('')}</div>` +
    (state.pageMeta.hasMore ? `<div class="load-more-wrap"><button class="btn" data-action="load-more">加载更多</button></div>` : '');
  return gridToolbar(f.title, `共 ${state.pageMeta.total || state.currentItems.length} 个视频`, extra) + body;
}

async function openFolder(id, title) {
  state.folder = { id, title };
  state.currentItems = [];
  state.pageMeta = { pn: 0, hasMore: false, total: 0 };
  state.selectMode = false; state.selection.clear();
  go('favdetail', { title });
  await loadMoreFav();
}
async function loadMoreFav() {
  if (!state.folder) return;
  try {
    const d = await Api.get('fav/videos', { media_id: state.folder.id, pn: state.pageMeta.pn + 1, ps: 20 });
    state.currentItems = state.currentItems.concat(d.items);
    state.pageMeta = { pn: state.pageMeta.pn + 1, hasMore: d.hasMore, total: d.total };
  } catch (e) { state.pageMeta.hasMore = false; errToast(e); }
  render();
}

/* ---- UP主主页 ---- */
function viewUpspace() {
  const u = state.up;
  let header = '';
  if (u) {
    header = `<div class="up-head">
      <img class="up-face" src="${esc(pic(u.face))}" onerror="this.style.visibility='hidden'">
      <div class="up-hinfo">
        <div class="up-hname">${esc(u.name || state.view.title || '')}</div>
        <div class="up-hsub">${u.followers != null ? nfmt(u.followers) + ' 粉丝' : ''}${u.sign ? ' · ' + esc(u.sign) : ''}</div>
      </div>
    </div>`;
  }
  let body;
  if (!state.currentItems.length && state.pageMeta.pn === 0) body = emptyState('加载中…');
  else if (!state.currentItems.length) body = emptyState('这个UP主还没有投稿视频');
  else body = `<div class="grid">${state.currentItems.map((it, i) => cardHtml(it, i)).join('')}</div>` +
    (state.pageMeta.hasMore ? `<div class="load-more-wrap"><button class="btn" data-action="load-more">加载更多</button></div>` : '');
  return header + gridToolbar(`${state.view.title || 'UP主'} 的投稿`, `共 ${state.pageMeta.total || state.currentItems.length} 个视频`, '') + body;
}

async function openUp(mid, up) {
  state.up = { mid, name: up, loading: true };
  state.currentItems = [];
  state.pageMeta = { pn: 0, hasMore: false, total: 0 };
  state.selectMode = false; state.selection.clear();
  go('upspace', { mid, title: up });
  loadUpInfo(mid);
  await loadMoreUp();
}

async function loadUpInfo(mid) {
  try {
    const d = await Api.get('up/info', { mid });
    if (state.up && state.up.mid === mid) {
      Object.assign(state.up, d, { loading: false });
      if (state.view.name === 'upspace') renderView();
    }
  } catch { if (state.up && state.up.mid === mid) state.up.loading = false; }
}

async function loadMoreUp() {
  if (!state.up) return;
  try {
    const d = await Api.get('up/videos', { mid: state.up.mid, pn: state.pageMeta.pn + 1 });
    state.currentItems = state.currentItems.concat(d.items);
    state.pageMeta = { pn: state.pageMeta.pn + 1, hasMore: d.items.length >= 20, total: d.total };
  } catch (e) { state.pageMeta.hasMore = false; errToast(e); }
  render();
}

/* ---- 搜索 ---- */
function viewSearch() {
  if (!state.searchQ) {
    return emptyState('搜索B站视频', '找到想听的，加入歌单，以后直接播');
  }
  let body;
  if (state.searchErr && !state.currentItems.length) {
    body = emptyState('搜索失败', esc(state.searchErr) + '（确认播放器服务还在运行）', `<button class="btn primary" style="margin-top:12px" data-action="search-retry">重试</button>`);
  } else if (!state.currentItems.length && state.pageMeta.pn === 0) body = emptyState('搜索中…');
  else if (!state.currentItems.length) body = emptyState('没有找到相关视频', '换个关键词试试');
  else body = `<div class="grid">${state.currentItems.map((it, i) => cardHtml(it, i)).join('')}</div>` +
    (state.pageMeta.hasMore ? `<div class="load-more-wrap"><button class="btn" data-action="load-more">加载更多</button></div>` : '');
  return gridToolbar(`“${state.searchQ}”`, state.searchErr ? '搜索失败' : `约 ${nfmt(state.pageMeta.total)} 条结果`, '') + body;
}
async function doSearch(q) {
  q = (q || '').trim();
  if (!q) {
    // 清空关键词回车 = 回到初始搜索页
    state.searchQ = '';
    state.currentItems = [];
    state.pageMeta = { pn: 0, hasMore: false, total: 0 };
    state.selectMode = false; state.selection.clear();
    go('search');
    return;
  }
  state.searchQ = q;
  state.searchErr = '';
  state.currentItems = [];
  state.pageMeta = { pn: 0, hasMore: false, total: 0 };
  state.selectMode = false; state.selection.clear();
  $('#search-input').value = q;
  go('search', { q });
  await loadMoreSearch();
}
async function loadMoreSearch() {
  if (!state.searchQ) return;
  try {
    const d = await Api.get('search', { keyword: state.searchQ, pn: state.pageMeta.pn + 1 });
    state.searchErr = '';
    state.currentItems = state.currentItems.concat(d.items);
    state.pageMeta = { pn: state.pageMeta.pn + 1, hasMore: d.items.length >= 20, total: d.total };
  } catch (e) {
    const code = e && e.code;
    state.searchErr = (code === -412 || code === -352)
      ? 'B站搜索被限流了，请等半分钟再试'
      : ((e && e.message) || '搜索失败');
    state.pageMeta.hasMore = false;
    errToast(e);
  }
  render();
}

/* ---- 歌单 ---- */
function viewPlaylists() {
  const card = pl => `
    <div class="folder-card" data-action="pl-open" data-id="${pl.id}">
      <div class="folder-cover" style="background:linear-gradient(135deg,#ffd9e5,#d5f3fa)">${ICON.music}</div>
      <div class="folder-info"><b>${esc(pl.name)}</b><span>${pl.items.length} 个视频</span></div>
      <button class="mini-btn" data-action="pl-del" data-id="${pl.id}" title="删除歌单" style="color:var(--t3)">${ICON.trash}</button>
    </div>`;
  return `<div class="toolbar">
      <div class="tb-title">我的歌单</div><div class="tb-sub">${state.playlists.length} 个</div><div class="sp"></div>
      <button class="btn primary" data-action="pl-new">${ICON.plus} 新建歌单</button>
      ${state.neUser ? `<button class="btn" data-action="ne-import-open">导入网易云歌单</button>` : ''}
    </div>
    <div class="folder-grid">
      ${state.playlists.map(card).join('')}
      <div class="folder-card" data-action="pl-new" style="justify-content:center;border:1px dashed var(--line);color:var(--t3);min-height:88px">${ICON.plus}&nbsp; 新建歌单</div>
    </div>`;
}

function viewPlDetail() {
  const pl = state.playlist;
  if (!pl) return emptyState('请从左侧选择一个歌单');
  const totalSec = pl.items.reduce((a, b) => a + (b.duration || 0), 0);
  const toolbar = `<div class="toolbar">
      <div class="tb-title">${esc(pl.name)}</div>
      <div class="tb-sub">${pl.items.length} 个视频 · 约 ${Math.max(1, Math.round(totalSec / 60))} 分钟</div>
      <div class="sp"></div>
      <button class="btn ${state.cdMode ? 'primary' : ''}" data-action="pl-view" data-mode="cd" title="3D唱片架">${ICON.film} CD架</button>
      <button class="btn ${state.cdMode ? '' : 'primary'}" data-action="pl-view" data-mode="list" title="列表视图">${ICON.list} 列表</button>
      <button class="btn primary" data-action="play-all" ${pl.items.length ? '' : 'disabled'}>${ICON.play} 播放全部</button>
      <button class="btn" data-action="pl-rename">${ICON.edit} 重命名</button>
      <button class="btn danger" data-action="pl-del" data-id="${pl.id}">${ICON.trash} 删除歌单</button>
    </div>`;
  if (!pl.items.length) return toolbar + emptyState('歌单还是空的', '去搜索或收藏夹里找视频加进来吧',
    `<button class="btn primary" data-action="nav" data-view="search">去搜索</button>`);

  if (state.cdMode) {
    return `<div class="rlstage" id="cdstage">
      <div class="cdbg" id="cdbg"><div class="cdbg-layer"></div><div class="cdbg-layer"></div></div>
      <div class="cdscroller" id="cdscroller"><div class="cdtrack" id="cdtrack"></div></div>
      <div class="rl-head">
        <div class="cap">MUSIC DATABASE / ${esc(stripEm(pl.name))}</div>
        <div class="rl-head-name">${esc(stripEm(pl.name))}</div>
        <div class="rl-links">
          <span data-action="back">← 返回上一级</span>
          <span data-action="play-all">播放全部 →</span>
          <span data-action="pl-view" data-mode="list">列表视图</span>
          <span data-action="pl-rename">重命名</span>
          <span data-action="pl-del" data-id="${pl.id}">删除歌单</span>
        </div>
      </div>
      <div class="rl-info" id="cdinfo"></div>
      <div class="rl-nav">
        <div class="rl-nav-seg">TRACK&nbsp;&nbsp;<b id="rl-row">01</b>&nbsp;/&nbsp;${String(pl.items.length).padStart(2, '0')}</div>
        <div class="rl-nav-seg">滚轮 / 拖动浏览 · 点击CD播放</div>
      </div>
    </div>`;
  }
  const rows = pl.items.map((it, i) => `
    <div class="prow ${Player.S.track && Player.S.track.bvid === it.bvid ? 'playing' : ''}" draggable="true" data-action="prow" data-idx="${i}">
      <div class="p-idx">${i + 1}</div>
      <img class="p-thumb" src="${esc(pic(it.pic))}" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="p-main"><div class="p-title">${esc(it.title)}</div>
        <div class="p-up ${it.upMid ? 'up-link' : ''}" ${it.upMid ? `data-action="up-open" data-mid="${it.upMid}" data-up="${esc(it.up)}" title="查看UP主页"` : ''}>${esc(it.up)}</div>
      </div>
      <div class="p-dur">${fmt(it.duration)}</div>
      <button class="p-del" data-action="pl-del-item" data-idx="${i}" title="移除">${ICON.trash}</button>
    </div>`).join('');
  return toolbar + `<div class="plist">${rows}</div>`;
}

async function createPlaylist(name) {
  const d = await Api.post('playlists', { name });
  state.playlists.unshift(d.playlist);
  renderSidebar();
  return d.playlist;
}
async function savePlaylist(pl) {
  await Api.put('playlists/' + pl.id, { name: pl.name, items: pl.items });
}
function openPlaylist(id) {
  const pl = state.playlists.find(p => p.id === id);
  if (!pl) return;
  state.playlist = pl;
  state.currentItems = pl.items;
  state.selectMode = false; state.selection.clear();
  go('pldetail', { title: pl.name });
}

/* ---------- 歌单 CD 架视图（竖排CD盒 · 原生滚动吸附 · 抽出式选中） ---------- */
const CD_CASE = 158;  // 盒子正面尺寸（正方形，封面铺满）
const CD_GAP = 26;    // 盒间距
const CD_STEP = CD_CASE + CD_GAP;
const CD_FOLLOW_IDLE = 5000; // 用户停止操作这么久后，货架才跟回正在播放的歌

function cdMarkUser() { App.cd.userUntil = Date.now() + CD_FOLLOW_IDLE; }
/* CD架背景：当前选中视频的封面，两层交叉淡入切换 */
function cdSetBg(cov) {
  if (cov === App.cd.lastBg) return;
  App.cd.lastBg = cov;
  const wrap = document.getElementById('cdbg');
  if (!wrap) return;
  const layers = wrap.children;
  const showB = wrap.dataset.show === 'b';
  const cur = layers[showB ? 1 : 0], nxt = layers[showB ? 0 : 1];
  if (!cov) { cur.style.opacity = 0; nxt.style.opacity = 0; wrap.dataset.show = 'a'; return; }
  nxt.style.backgroundImage = `url("${cov}")`;
  nxt.style.opacity = 1;
  cur.style.opacity = 0;
  wrap.dataset.show = showB ? 'a' : 'b';
}

function cdTopFor(i) { return App.cd.pad + i * CD_STEP; }
function cdScrollTopFor(i) {
  return Math.max(0, cdTopFor(i) - (App.cd.viewH - CD_CASE) / 2);
}
function cdCaseHtml(it, idx) {
  const cov = esc(pic(it.pic));
  const playing = Player.S.track && Player.S.track.bvid === it.bvid;
  return `<div class="cdcase${idx === App.cd.cur ? ' cur' : ''}${App.cd.openIdx === idx ? ' open' : ''}${playing ? ' playing' : ''}" data-action="cd-click" data-idx="${idx}" style="top:${cdTopFor(idx)}px">
    <div class="cdside"></div>
    <div class="cdtray"><div class="cddisc" style="background-image:url('${cov}')"></div></div>
    <div class="cdlid">
      <div class="cdfront"><img src="${cov}" alt="" draggable="false" loading="lazy" onerror="this.style.visibility='hidden'"><span class="cdno">${String(idx + 1).padStart(2, '0')}</span></div>
      <div class="cdback"><span>${esc(stripEm(it.title))}</span></div>
    </div>
  </div>`;
}
function renderCdShelf() {
  const track = document.getElementById('cdtrack');
  const sc = document.getElementById('cdscroller');
  const pl = state.playlist;
  if (!track || !sc || !pl) return;
  const n = pl.items.length;
  App.cd.viewH = sc.clientHeight || 520;
  App.cd.pad = Math.max(110, (App.cd.viewH - CD_CASE) / 2);
  track.style.height = (App.cd.pad * 2 + (n - 1) * CD_STEP + CD_CASE) + 'px';
  let html = '';
  for (let i = 0; i < n; i++) html += cdCaseHtml(pl.items[i], i);
  track.innerHTML = html;
  updateCdInfo();
  cdScrollToIndex(Math.max(0, Math.min(App.cd.cur, n - 1)), false);
}
function cdSetCur(idx) {
  if (idx === App.cd.cur) return;
  App.cd.cur = idx;
  App.cd.openIdx = -1; // 换选中时合上盒盖
  $$('#cdtrack .cdcase').forEach(e => {
    const i = +e.dataset.idx;
    e.classList.toggle('cur', i === idx);
    e.classList.toggle('open', false);
  });
  updateCdInfo();
  const rn = document.getElementById('rl-row');
  if (rn) rn.textContent = String(idx + 1).padStart(2, '0');
}
function cdToggleOpen(idx) {
  App.cd.openIdx = App.cd.openIdx === idx ? -1 : idx;
  $$('#cdtrack .cdcase').forEach(e => e.classList.toggle('open', +e.dataset.idx === App.cd.openIdx));
  updateCdInfo();
}
function updateCdInfo() {
  const pl = state.playlist;
  const info = document.getElementById('cdinfo');
  if (!pl || !info) return;
  const idx = App.cd.cur;
  const it = pl.items[idx];
  if (!it) { info.innerHTML = ''; cdSetBg(''); return; }
  cdSetBg(it.pic ? pic(it.pic) : '');
  const playing = Player.S.track && Player.S.track.bvid === it.bvid;
  const open = App.cd.openIdx === idx;
  info.innerHTML = `<div class="rl-info-no">MUSIC DATABASE / ${esc(stripEm(pl.name))}</div>
    <div class="rl-info-title">${esc(stripEm(it.title))}</div>
    <div class="rl-line"></div>
    <div class="rl-meta">NO.${String(idx + 1).padStart(2, '0')} / ${esc(it.up)} · ${fmt(it.duration)}${playing ? ' · <b class="cdnp">正在播放</b>' : ''}</div>
    <button class="rl-play" data-action="cd-play" data-idx="${idx}">${ICON.play} 播放这首</button>
    <div class="rl-open-tip">${open ? '再点一次CD开始播放，进入CD机' : '点击选中的CD打开盒盖 · ↑↓ 或滚轮切换'}</div>`;
}
function cdAnimateScroll(sc, top) {
  clearTimeout(App.cd.animT);
  const from = sc.scrollTop, dist = top - from;
  if (Math.abs(dist) < 2) { sc.scrollTop = top; App.cd.anim = false; return; }
  const t0 = performance.now(), DUR = 420;
  App.cd.anim = true;
  const step = () => {
    const p = Math.min(1, (performance.now() - t0) / DUR);
    const e = 1 - Math.pow(1 - p, 3);
    sc.scrollTop = from + dist * e;
    if (p < 1) App.cd.animT = setTimeout(step, 16);
    else { App.cd.anim = false; sc.scrollTop = top; }
  };
  App.cd.animT = setTimeout(step, 16);
}
function cdSnap() {
  const sc = document.getElementById('cdscroller');
  if (!sc || App.cd.drag || App.cd.anim) return;
  cdAnimateScroll(sc, cdScrollTopFor(App.cd.cur));
}
function cdScrollToIndex(i, smooth = true) {
  const sc = document.getElementById('cdscroller');
  if (!sc) return;
  if (smooth) cdAnimateScroll(sc, cdScrollTopFor(i));
  else { clearTimeout(App.cd.animT); App.cd.anim = false; sc.scrollTop = cdScrollTopFor(i); }
}
function cdSetTrack(idx, smooth = true) {
  const n = state.playlist ? state.playlist.items.length : 0;
  if (!n) return;
  idx = Math.max(0, Math.min(n - 1, idx));
  cdSetCur(idx);
  cdScrollToIndex(idx, smooth);
}
function cdOnScroll() {
  const sc = document.getElementById('cdscroller');
  const n = state.playlist ? state.playlist.items.length : 0;
  if (!sc || !n || App.cd.drag) return;
  if (App.cd.anim) return; // 动画期间以动画目标为准，不用瞬时位置改写选中
  cdMarkUser(); // 用户在滚动浏览：暂停自动跟回
  const center = sc.scrollTop + App.cd.viewH / 2;
  let idx = Math.round((center - App.cd.pad - CD_CASE / 2) / CD_STEP);
  idx = Math.max(0, Math.min(n - 1, idx));
  cdSetCur(idx);
  clearTimeout(App.cd.timer);
  App.cd.timer = setTimeout(cdSnap, 450);
}
function setupRlStage() {
  const stage = document.getElementById('cdstage');
  const sc = document.getElementById('cdscroller');
  const pl = state.playlist;
  if (!stage || !sc || !pl) return;
  let start = 0;
  if (Player.S.track) {
    const pi = pl.items.findIndex(it => it.bvid === Player.S.track.bvid);
    if (pi >= 0) start = pi;
  }
  App.cd.cur = start;
  App.cd.openIdx = -1;
  App.cd.lastBg = '';
  App.cd.drag = false;
  renderCdShelf();
  // 鼠标拖动浏览（按住左键上下拖，松手吸附）
  let dragY = 0, dragTop = 0;
  App.cd.onDown = e => {
    if (e.button !== 0) return;
    dragY = e.clientY; dragTop = sc.scrollTop;
    App.cd.drag = true; App.cd.dragMoved = false;
  };
  App.cd.onMove = e => {
    if (!App.cd.drag) return;
    const dy = e.clientY - dragY;
    if (Math.abs(dy) > 4) { App.cd.dragMoved = true; cdMarkUser(); }
    if (App.cd.dragMoved) sc.scrollTop = dragTop - dy;
  };
  App.cd.onUp = () => {
    if (!App.cd.drag) return;
    App.cd.drag = false;
    if (App.cd.dragMoved) {
      // 松手：按当前位置算出该停在哪一格并吸附
      const n = pl.items.length;
      const center = sc.scrollTop + App.cd.viewH / 2;
      let idx = Math.round((center - App.cd.pad - CD_CASE / 2) / CD_STEP);
      cdSetTrack(Math.max(0, Math.min(n - 1, idx)));
      setTimeout(() => { App.cd.dragMoved = false; }, 60);
    }
  };
  sc.addEventListener('scroll', cdOnScroll, { passive: true });
  sc.addEventListener('pointerdown', App.cd.onDown);
  window.addEventListener('pointermove', App.cd.onMove);
  window.addEventListener('pointerup', App.cd.onUp);
  App.cd.onKey = e => {
    if (state.view.name !== 'pldetail' || !state.cdMode) return;
    if (e.key === 'ArrowUp') { e.preventDefault(); cdMarkUser(); cdSetTrack(App.cd.cur - 1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); cdMarkUser(); cdSetTrack(App.cd.cur + 1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (App.cd.openIdx === App.cd.cur) { playFromItems(App.cd.cur); go('nowplaying'); }
      else cdToggleOpen(App.cd.cur);
    }
  };
  document.addEventListener('keydown', App.cd.onKey);
}
function stopRlStage() {
  const sc = document.getElementById('cdscroller');
  if (sc) {
    sc.removeEventListener('scroll', cdOnScroll);
    if (App.cd.onDown) sc.removeEventListener('pointerdown', App.cd.onDown);
  }
  if (App.cd.onMove) { window.removeEventListener('pointermove', App.cd.onMove); App.cd.onMove = null; }
  if (App.cd.onUp) { window.removeEventListener('pointerup', App.cd.onUp); App.cd.onUp = null; }
  if (App.cd.onKey) { document.removeEventListener('keydown', App.cd.onKey); App.cd.onKey = null; }
  clearTimeout(App.cd.timer);
  clearTimeout(App.cd.animT);
  App.cd.anim = false;
  App.cd.onDown = null;
  App.cd.drag = false;
}

/* ---- 正在播放 ---- */
function viewNowplaying() {
  const S = Player.S;
  const queueRows = S.queue.map((it, i) => `
    <div class="qrow ${i === S.index ? 'playing' : ''}" data-action="queue-jump" data-idx="${i}">
      <div class="q-idx">${i === S.index ? '▶' : i + 1}</div>
      <img src="${esc(pic(it.pic))}" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="q-main"><div class="q-title">${esc(it.title)}</div><div class="q-up">${esc(it.up)}${it.rec ? `<span class="q-rec ${it.rec}">${it.rec === 'heart' ? '💗心动' : '🧭漫游'}</span>` : ''}</div></div>
      <div class="q-dur">${fmt(it.duration)}</div>
    </div>`).join('');
  const aid = S.track && S.track.aid;
  const replyCount = state.replies && state.replies.aid === aid && state.replies.total ? ' ' + nfmt(state.replies.total) : '';
  const aside = `<aside class="np-queue">
      <div class="npq-tabs">
        <button class="npq-tab ${state.npqTab === 'queue' ? 'active' : ''}" data-action="npq-tab" data-tab="queue">播放队列</button>
        <button class="npq-tab ${state.npqTab === 'reply' ? 'active' : ''}" data-action="npq-tab" data-tab="reply">${ICON.comment} 评论${replyCount}</button>
      </div>
      <div class="npq-list">${state.npqTab === 'queue' ? queueRows : commentsBody()}</div>
    </aside>`;
  if (!S.track) {
    return `<div class="np">${emptyState('还没有在播放的内容', '从收藏夹或搜索里挑一个视频开始吧',
      `<div style="display:flex;gap:10px"><button class="btn primary" data-action="nav" data-view="favfolders">我的收藏</button>
       <button class="btn" data-action="nav" data-view="search">去搜索</button></div>`)}</div>`;
  }

  /* ---- 纯听模式：网易云风格沉浸页（黑胶 + 歌词/简介） ---- */
  if (S.mode !== 'video') {
    const infoBody = state.npInfoTab === 'intro'
      ? `<p class="nt-desc">${S.track.desc ? esc(S.track.desc) : '这个视频没有填写简介'}</p>`
      : lyricsBody();
    return `<div class="np np-audio">
      <div class="np-stage ${S.playing ? 'is-playing' : ''}" id="np-stage">
        <div class="np-bg"><img class="np-bg-img" src="${esc(pic(S.track.pic))}" onerror="this.style.display='none'"><div class="np-bg-shade"></div></div>
        <canvas id="stage-viz" class="stage-viz"></canvas>
        <div class="mv-layer" id="mv-layer" aria-hidden="true">
          <video id="mv-video" class="mv-video" muted playsinline preload="auto"></video>
          <canvas id="mv-gl" class="mv-gl"></canvas>
          <canvas id="mv-bg" class="mv-bg"></canvas>
          <canvas id="mv-vine" class="mv-vine"></canvas>
          <div class="mv-vignette"></div>
          <div class="mv-lumiere" id="mv-lumiere"></div>
          <div class="mv-folia-host" id="mv-folia-lumiere"></div>
          <div class="mv-grade" id="mv-grade"></div>
          <div class="mv-fx" id="mv-fx"></div>
          <div class="mv-top">
            <div class="mv-meta"><b id="mv-title">${esc(stripEm(S.track.title))}</b><span id="mv-artist">${esc(S.track.up)}</span><span class="mv-ai-tag hidden" id="mv-ai-tag"></span></div>
            <div class="mv-styles">
              <button class="mv-style-current" data-action="mv-style-open">
                <span>样式</span><b id="mv-style-name">${mvStyleLabel(App.mv.style)}</b><i>▾</i>
              </button>
            </div>
            <div class="mv-tools">
              <button class="mv-ai-btn" data-action="ai-open">✨AI</button>
              <button class="mv-tone-btn" data-action="mv-tone" title="AI 主题日/夜">${App.mv.tone === 'light' ? '☀' : '☾'}</button>
              <button class="mv-tone-btn ${App.mv.subTrans ? 'active' : ''}" data-action="mv-subtitle" title="MV 翻译">译</button>
              <button class="mv-tone-btn ${App.mv.subRoma ? 'active' : ''}" data-action="mv-sub-roma" title="MV 罗马音">罗</button>
              <button class="mv-mood-btn" data-action="mv-mood">${mvMoodText()}</button>
              <button class="mv-video-btn ${App.mv.video && S.track.bvid ? 'active' : ''}" data-action="mv-video" ${S.track.bvid && S.track.cid ? '' : 'disabled title="当前歌曲没有B站视频"'}>MV背景</button>
              <button class="mv-exit" data-action="mv-toggle">✕ 退出动态MV</button>
            </div>
          </div>
          <div class="mv-style-panel hidden" id="mv-style-panel" data-action="mv-style-close">
            <div class="mv-director" data-action="mv-style-keep">
              <div><b>AI 导演</b><small>按歌曲情绪、BPM 和段落自动选择样式</small></div>
              <div class="mv-director-actions">
                <button class="mv-lowpower-btn ${App.mv.sectionSwitch ? 'active' : ''}" data-action="mv-section" title="副歌切换一套样式，并用淡入淡出遮罩过渡">段落</button>
                <button class="mv-lowpower-btn ${App.mv.lowPower ? 'active' : ''}" data-action="mv-lowpower" title="降低渲染分辨率，减少粒子与模糊">性能</button>
                <button class="mv-director-btn ${App.mv.director ? 'active' : ''}" data-action="mv-director">${App.mv.director ? '已开启' : '开启'}</button>
              </div>
            </div>
            <div class="mv-style-grid" data-action="mv-style-keep">
              ${MV_STYLE_DEFS.map(d => `<button class="mv-style-card ${App.mv.style === d.id ? 'active' : ''}" data-action="mv-style" data-style="${d.id}">
                <span class="style-thumb thumb-${d.id}"><em>${d.label}</em></span>
                <b>${d.label}</b><small>${d.desc}</small>
              </button>`).join('')}
            </div>
            <div class="mv-tune" id="mv-tune" data-action="mv-style-keep">
              <div class="mv-tune-head">样式微调 <b id="mv-tune-title">${mvStyleLabel(App.mv.style)}</b></div>
              <div class="mv-tune-group" data-tune-group="flow">
                <label><span>保留旧句</span><input type="range" min="0" max="3" step="1" data-tune="flowKeep" value="${App.mv.tune.flowKeep}"><em data-val="flowKeep">${App.mv.tune.flowKeep}</em></label>
                <label><span>藤蔓强度</span><input type="range" min="0" max="2" step="0.1" data-tune="flowVine" value="${App.mv.tune.flowVine}"><em data-val="flowVine">${Number(App.mv.tune.flowVine).toFixed(1)}</em></label>
                <label class="mv-tune-check"><input type="checkbox" data-tune="flowPreview" ${App.mv.tune.flowPreview ? 'checked' : ''}>整句预显</label>
              </div>
              <div class="mv-tune-group" data-tune-group="vertical">
                <label><span>等待列亮度</span><input type="range" min="0.2" max="0.9" step="0.05" data-tune="vWait" value="${App.mv.tune.vWait}"><em data-val="vWait">${Number(App.mv.tune.vWait).toFixed(2)}</em></label>
                <label><span>每列字数</span><input type="range" min="3" max="10" step="1" data-tune="vCols" value="${App.mv.tune.vCols}"><em data-val="vCols">${App.mv.tune.vCols}</em></label>
                <label><span>列距</span><input type="range" min="10" max="60" step="2" data-tune="vGap" value="${App.mv.tune.vGap}"><em data-val="vGap">${App.mv.tune.vGap}</em></label>
              </div>
            </div>
          </div>
          <div class="mv-lyrics">
            <div class="mv-prev" id="mv-prev"></div>
            <div class="mv-cur" id="mv-cur"></div>
            <div class="mv-next" id="mv-next"></div>
          </div>
          <div class="mv-chat" id="mv-chat"></div>
          <div class="mv-world" id="mv-world"></div>
          <div class="mv-instrumental" id="mv-instrumental" aria-hidden="true">
            <span class="mi-note mi-n1">♪</span><span class="mi-note mi-n2">♫</span><span class="mi-note mi-n3">♪</span><span class="mi-note mi-n4">♬</span>
            <div class="mi-center"><b>♪</b><span>音乐</span></div>
          </div>
          <div class="mv-subtitle" id="mv-subtitle" aria-hidden="true"></div>
          <div class="mv-transition" id="mv-transition"></div>
        </div>
        <div class="np-vinyl-wrap">
          <svg class="np-tonearm" viewBox="0 0 100 150">
            <circle cx="20" cy="20" r="16" fill="#d8d9dd"/>
            <circle cx="20" cy="20" r="7" fill="#a9abb0"/>
            <path d="M20 20 L62 110" stroke="#e8e9ec" stroke-width="9" stroke-linecap="round"/>
            <rect x="52" y="102" width="22" height="32" rx="5" fill="#dfe0e4" transform="rotate(24 62 110)"/>
          </svg>
          <div class="np-vinyl"><div class="vp-cover"><img src="${esc(pic(S.track.pic))}" onerror="this.style.display='none'"></div></div>
        </div>
        <div class="np-trackinfo">
          <h2 class="nt-title">${esc(stripEm(S.track.title))}</h2>
          <div class="nt-sub">
            ${S.track.upMid
              ? `<span class="up-link" data-action="up-open" data-mid="${S.track.upMid}" data-up="${esc(S.track.up)}" title="查看UP主页">${esc(S.track.up)}</span>`
              : `<span>${esc(S.track.up)}</span>`}
            ${S.quality ? `<span class="badge">音频 ${S.quality}</span>` : ''}
            <span>${fmt(Player.activeEl().duration || S.track.duration)}</span>
          </div>
          <div class="nt-tabs">
            <button class="nt-tab ${state.npInfoTab === 'lyric' ? 'active' : ''}" data-action="np-info-tab" data-tab="lyric">歌词</button>
            <button class="nt-tab ${state.npInfoTab === 'intro' ? 'active' : ''}" data-action="np-info-tab" data-tab="intro">简介</button>
          </div>
          <div class="nt-body-wrap"><div class="nt-body" id="nt-body">${infoBody}</div>
            <button class="lyric-back" id="lyric-back" data-action="lyric-back">${ICON.back} 回到当前句</button>
          </div>
          <div class="nt-actions">
            <button class="btn primary" data-action="np-mode">${ICON.film} 看视频</button>
            <button class="btn ${App.mv.on ? 'active' : ''}" data-action="mv-toggle">✨ 动态MV</button>
            <button class="btn ${App.heart.on ? 'active' : ''}" data-action="heart-toggle">${ICON.heart} 心动</button>
            <button class="btn ${App.roam.active ? 'active' : ''}" data-action="roam-toggle">${ICON.roam} 漫游</button>
            <button class="btn roam-only" data-action="roam-like">♥ 喜欢</button>
            <button class="btn roam-only" data-action="roam-dislike">👎 不喜欢</button>
            <button class="btn" id="ver-btn" data-action="versions-open">${ICON.music} 版本宇宙<em class="ver-n"></em></button>
            <button class="btn" data-action="fx-open">🎛 音效</button>
            <button class="btn" data-action="room-open">👥 一起听</button>
            <button class="btn ${DM.on ? '' : 'ghost'}" data-action="dm-toggle">${ICON.comment} 弹幕${DM.on ? '开' : '关'}</button>
            <button class="btn" data-action="add-current">${ICON.plus} 加入歌单</button>
            <button class="btn" data-action="external">${ICON.external} 在B站打开</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  /* ---- 看视频模式 ---- */
  const media = `<div class="np-video-wrap" id="np-video-wrap">
        <div id="np-video" style="width:100%;height:100%"></div>
        <div class="np-ovl" id="np-ovl">
          <div class="np-ovl-progress" id="np-ovl-track"><div class="np-ovl-fill" id="np-ovl-fill"></div><div class="np-ovl-thumb" id="np-ovl-thumb"></div></div>
          <div class="np-ovl-row">
            <button class="pb-btn" id="np-ovl-play" title="播放/暂停"></button>
            <span class="np-ovl-time" id="np-ovl-time"></span>
            <div class="np-ovl-sp"></div>
            <button class="pb-btn" id="np-ovl-fs" title="退出全屏"></button>
          </div>
        </div>
      </div>`;
  return `<div class="np">
    <div class="np-left">
      ${media}
      <div class="np-meta">
        <h2>${esc(S.track.title)}</h2>
        <div class="np-sub">
          ${S.track.upMid
            ? `<span class="up-link" data-action="up-open" data-mid="${S.track.upMid}" data-up="${esc(S.track.up)}" title="查看UP主页">${esc(S.track.up)}</span>`
            : `<span>${esc(S.track.up)}</span>`}
          ${S.quality ? `<span class="badge">${S.quality}</span>` : ''}
          <span>${fmt(Player.activeEl().duration || S.track.duration)}</span>
        </div>
        <div class="np-actions">
          <button class="btn primary" data-action="np-mode">${ICON.headphone} 只听声音</button>
          <button class="btn" data-action="np-fullscreen">${ICON.fs} 全屏播放</button>
          <button class="btn ${App.heart.on ? 'active' : ''}" data-action="heart-toggle">${ICON.heart} 心动</button>
          <button class="btn ${App.roam.active ? 'active' : ''}" data-action="roam-toggle">${ICON.roam} 漫游</button>
          <button class="btn roam-only" data-action="roam-like">♥ 喜欢</button>
          <button class="btn roam-only" data-action="roam-dislike">👎 不喜欢</button>
          <button class="btn" id="ver-btn" data-action="versions-open">${ICON.music} 版本宇宙<em class="ver-n"></em></button>
          <button class="btn" data-action="fx-open">🎛 音效</button>
            <button class="btn" data-action="room-open">👥 一起听</button>
          <button class="btn ${DM.on ? '' : 'ghost'}" data-action="dm-toggle">${ICON.comment} 弹幕${DM.on ? '开' : '关'}</button>
          <button class="btn" data-action="npq-tab" data-tab="reply">${ICON.comment} 评论</button>
          <button class="btn" data-action="add-current">${ICON.plus} 加入歌单</button>
          <button class="btn" data-action="external">${ICON.external} 在B站打开</button>
        </div>
      </div>
    </div>
    ${aside}
  </div>`;
}

function shiftLyricLines(lines, delta) {
  const d = Number(delta) || 0;
  if (!d) return lines;
  return (lines || []).map(l => {
    const n = Object.assign({}, l, {
      t: Math.max(0, (Number(l.t) || 0) + d),
      end: Math.max(0, (Number(l.end) || Number(l.t) || 0) + d)
    });
    if (Array.isArray(l.words)) n.words = l.words.map(w => Object.assign({}, w, {
      text: w.text,
      t: Math.max(0, (Number(w.t) || 0) + d),
      end: Math.max(0, (Number(w.end) || Number(w.t) || 0) + d)
    }));
    return n;
  });
}
/* 不截断的位移：保留负时间，保证先 -30s 再 +90s 能回到正确位置 */
function shiftLyricLinesRaw(lines, delta) {
  const d = Number(delta) || 0;
  if (!d) return lines;
  return (lines || []).map(l => {
    const n = Object.assign({}, l, {
      t: (Number(l.t) || 0) + d,
      end: (Number(l.end) || Number(l.t) || 0) + d
    });
    if (Array.isArray(l.words)) n.words = l.words.map(w => Object.assign({}, w, {
      text: w.text,
      t: (Number(w.t) || 0) + d,
      end: (Number(w.end) || Number(w.t) || 0) + d
    }));
    return n;
  });
}
/* 逐行微调：{ [lineIndex]: deltaMs }，叠加在整首偏移之后 */
function applyLineOffsets(lines, offsets) {
  if (!offsets) return lines;
  return (lines || []).map((l, i) => {
    const d = Math.max(-30000, Math.min(30000, Number(offsets[i]) || 0)) / 1000;
    if (!d) return l;
    const n = Object.assign({}, l, {
      t: (Number(l.t) || 0) + d,
      end: (Number(l.end) || Number(l.t) || 0) + d
    });
    if (Array.isArray(l.words)) n.words = l.words.map(w => Object.assign({}, w, {
      text: w.text,
      t: (Number(w.t) || 0) + d,
      end: (Number(w.end) || Number(w.t) || 0) + d
    }));
    return n;
  });
}
function loadLineOffsets(key) {
  try {
    const o = JSON.parse(localStorage.getItem('bp.lyricLineOffsets.' + key) || '{}') || {};
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (!/^\d+$/.test(k)) continue;
      const n = Number(v);
      if (isFinite(n) && n) out[k] = Math.max(-30000, Math.min(30000, Math.round(n)));
    }
    return out;
  } catch (e) { return {}; }
}
function saveLineOffsets(key, offsets) {
  const clean = {};
  for (const [k, v] of Object.entries(offsets || {})) {
    const n = Number(v);
    if (/^\d+$/.test(k) && isFinite(n) && n) clean[k] = Math.round(n);
  }
  try {
    if (Object.keys(clean).length) {
      localStorage.setItem('bp.lyricLineOffsets.' + key, JSON.stringify(clean));
      localStorage.removeItem('bp.lyricLineOffsetsCleared.' + key);
    } else {
      localStorage.removeItem('bp.lyricLineOffsets.' + key);
      /* 记录“已明确清空”，避免下次启动又把服务端旧偏移拉回来 */
      localStorage.setItem('bp.lyricLineOffsetsCleared.' + key, '1');
    }
  } catch (e) {}
  syncLineOffsetsToServer(key, clean);
}
function syncLineOffsetsToServer(key, offsets, serverKey) {
  if (!key) return;
  const sk = serverKey || ((state.lyrics && state.lyrics.key === key && state.lyrics.cacheKey) || key);
  App._lineSave = App._lineSave || {};
  clearTimeout(App._lineSave[key]);
  App._lineSave[key] = setTimeout(() => {
    delete App._lineSave[key];
    try { Api.post('lyrics/lines', { key: sk, offsets }).catch(() => {}); } catch (e) {}
  }, 400);
}
/* 回退逐行偏移：在已有渲染行上减掉偏移，避免影响全局 baseLines */
function removeLineOffsets(lines, offsets) {
  if (!offsets) return lines;
  const inv = {};
  for (const [k, v] of Object.entries(offsets)) inv[k] = -Number(v);
  return applyLineOffsets(lines, inv);
}
function recomputeLyricLines(L) {
  const base = (L && L.baseLines) || [];
  const g = ((Number(L && L.offsetMs) || 0) / 1000);
  const shifted = g ? shiftLyricLinesRaw(base, g) : base;
  return applyLineOffsets(shifted, (L && L.lineOffsets) || {});
}
function scrollToLyricLine(i) {
  const wrap = document.getElementById('nt-body');
  if (!wrap) return;
  const el = wrap.querySelector('.nt-line[data-li="' + i + '"]');
  if (!el) return;
  const target = el.offsetTop - wrap.clientHeight / 2 + el.offsetHeight / 2;
  wrap.scrollTop = Math.max(0, Math.min(wrap.scrollHeight - wrap.clientHeight, target));
}
function selectLyricLine(i) {
  const L = state.lyrics;
  if (!L || !L.lines || !L.lines[i]) return;
  App.lyricNudgeIdx = i;
  App._lyricScrollHold = Date.now() + 15000;
  clearTimeout(App._lyricSnapTimer);
  App._lyricSnapTimer = setTimeout(() => snapToActiveLyric(), 15000);
  const back = document.getElementById('lyric-back');
  if (back) back.classList.add('show');
  renderView();
  requestAnimationFrame(() => scrollToLyricLine(i));
}
function lineOffsetTarget() {
  return App.lyricNudgeIdx >= 0 ? App.lyricNudgeIdx : App.lyricIdx;
}
function changeLineOffset(deltaSec) {
  const L = state.lyrics;
  if (!L || !L.lines || !L.lines.length) return;
  const idx = lineOffsetTarget();
  if (idx < 0 || idx >= L.lines.length) {
    toast('先播放到要调整的歌词行，或点选一行', 'error');
    return;
  }
  const d = Number(deltaSec) || 0;
  if (!d) return;
  const offs = Object.assign({}, L.lineOffsets || {});
  const cur = Number(offs[idx]) || 0;
  const next = Math.max(-30000, Math.min(30000, Math.round(cur + d * 1000)));
  if (next === cur) return;
  if (next) offs[idx] = next; else delete offs[idx];
  L.lineOffsets = offs;
  saveLineOffsets(L.key, offs);
  L.lines = recomputeLyricLines(L);
  App.lyricNudgeIdx = idx;
  App._lyricScrollHold = Date.now() + 15000;
  clearTimeout(App._lyricSnapTimer);
  App._lyricSnapTimer = setTimeout(() => snapToActiveLyric(), 15000);
  const back = document.getElementById('lyric-back');
  if (back) back.classList.add('show');
  if (window.FoliaBridge) FoliaBridge.refresh();
  if (window.LyricMV && LyricMV.refreshLine) LyricMV.refreshLine();
  App.lyricIdx = -1;
  renderView();
  syncLyricHighlight(false);
  syncMVSubtitle();
  requestAnimationFrame(() => scrollToLyricLine(idx));
}
function resetLineOffset() {
  const L = state.lyrics;
  if (!L) return;
  const idx = lineOffsetTarget();
  if (idx < 0) return;
  const cur = Number((L.lineOffsets || {})[idx]) || 0;
  if (cur) changeLineOffset(-cur / 1000);
}
function snapLineToBeat() {
  const L = state.lyrics;
  const info = App.mv.bpmInfo;
  if (!L || !L.lines || !L.lines.length) return;
  if (!info || !(info.bpm > 0)) { toast('还没有节拍信息，先开启动态MV稍等', ''); return; }
  const idx = lineOffsetTarget();
  if (idx < 0) { toast('先点选一行歌词', 'error'); return; }
  const t = Number(L.lines[idx].t) || 0;
  const beat = 60 / info.bpm;
  const phase = Number(info.phase) || 0;
  const target = phase + Math.round((t - phase) / beat) * beat;
  const delta = target - t;
  if (Math.abs(delta) < 0.02) { toast('已经在节拍上', ''); return; }
  changeLineOffset(delta);
  toast('已吸附到最近节拍 ' + (delta > 0 ? '+' : '') + delta.toFixed(2) + 's', 'success');
}
function shiftLineOffsetsFrom(deltaSec) {
  const L = state.lyrics;
  if (!L || !L.lines || !L.lines.length) return;
  const idx = lineOffsetTarget();
  if (idx < 0) { toast('先点选一行歌词', 'error'); return; }
  const d = Math.round((Number(deltaSec) || 0) * 1000);
  if (!d) return;
  const offs = Object.assign({}, L.lineOffsets || {});
  for (let i = idx; i < L.lines.length; i++) {
    const next = Math.max(-30000, Math.min(30000, (Number(offs[i]) || 0) + d));
    if (next) offs[i] = next; else delete offs[i];
  }
  L.lineOffsets = offs;
  saveLineOffsets(L.key, offs);
  L.lines = recomputeLyricLines(L);
  App.lyricNudgeIdx = idx;
  if (window.FoliaBridge) FoliaBridge.refresh();
  if (window.LyricMV && LyricMV.refreshLine) LyricMV.refreshLine();
  renderView();
  syncLyricHighlight(true);
  toast('从第 ' + (idx + 1) + ' 行起偏移 ' + (d > 0 ? '+' : '') + (d / 1000).toFixed(1) + 's（' + (L.lines.length - idx) + ' 行）', 'success');
}
function lyricBaseLines(L) {
  if (Array.isArray(L.baseLines) && L.baseLines.length) return L.baseLines.map(l => Object.assign({}, l));
  const g = (Number(L.offsetMs) || 0) / 1000;
  const unshifted = shiftLyricLinesRaw(L.lines || [], -g);
  return removeLineOffsets(unshifted, L.lineOffsets || {}).map(l => Object.assign({}, l));
}
function openLineEditor() {
  const L = state.lyrics;
  if (!L || !L.lines || !L.lines.length) return;
  const idx = lineOffsetTarget();
  if (idx < 0 || idx >= L.lines.length) { toast('先点选一行歌词', 'error'); return; }
  const text = L.lines[idx].text || '';
  showModal(`<h3>编辑第 ${idx + 1} 行</h3>
    <div class="ly-import-note">修改文本会转成手动歌词；拆分/合并/删除会清空逐行偏移。</div>
    <textarea id="ly-line-edit-text" class="ly-import-text" style="height:120px" spellcheck="false">${esc(text)}</textarea>
    <div class="ly-import-actions">
      <button class="btn ghost" data-action="modal-close">取消</button>
      <button class="btn ghost" data-action="ly-line-edit-del" data-idx="${idx}">删除</button>
      <button class="btn ghost" data-action="ly-line-edit-merge" data-idx="${idx}">合并下一行</button>
      <button class="btn ghost" data-action="ly-line-edit-split" data-idx="${idx}">拆分</button>
      <button class="btn primary" data-action="ly-line-edit-save" data-idx="${idx}">保存</button>
    </div>`, 'wide');
}
async function saveLineEdit(action, idx) {
  const L = state.lyrics;
  if (!L) return;
  const ta = document.getElementById('ly-line-edit-text');
  const text = ta ? ta.value : '';
  const base = lyricBaseLines(L);
  idx = Math.max(0, Math.min(base.length - 1, Number(idx) || 0));
  if (!base[idx]) return;
  let clearLineOffsets = false;
  if (action === 'save') {
    base[idx].text = text.trim();
    if (!base[idx].text) { toast('歌词不能为空', 'error'); return; }
    delete base[idx].words;
  } else if (action === 'split') {
    const raw = text;
    let cut = ta && ta.selectionStart > 0 && ta.selectionStart < raw.length ? ta.selectionStart : Math.floor(raw.length / 2);
    let a = raw.slice(0, cut).trim(), b = raw.slice(cut).trim();
    if (!a || !b) { toast('拆分点需要两边都有文字', 'error'); return; }
    const line = base[idx];
    const end = Number(line.end) > Number(line.t) ? Number(line.end) : Number(line.t) + 3;
    const mid = Math.max(Number(line.t) + 0.2, Math.min(end - 0.2, Number(line.t) + (end - Number(line.t)) * a.length / Math.max(1, a.length + b.length)));
    const l1 = { t: Number(line.t), end: mid, text: a };
    const l2 = { t: mid, end, text: b };
    base.splice(idx, 1, l1, l2);
    clearLineOffsets = true;
  } else if (action === 'merge') {
    const next = base[idx + 1];
    if (!next) { toast('已经是最后一行', 'error'); return; }
    base[idx] = Object.assign({}, base[idx], {
      text: String(base[idx].text || '') + String(next.text || ''),
      end: Math.max(Number(base[idx].end) || 0, Number(next.end) || 0)
    });
    delete base[idx].words;
    delete base[idx].translation;
    delete base[idx].romanization;
    base.splice(idx + 1, 1);
    clearLineOffsets = true;
  } else if (action === 'del') {
    if (base.length <= 1) { toast('至少保留一行', 'error'); return; }
    base.splice(idx, 1);
    clearLineOffsets = true;
  } else return;
  const quality = base.every(l => Array.isArray(l.words) && l.words.length) ? 'word' : 'line';
  const key = L.cacheKey || L.key;
  try {
    const d = await Api.post('lyrics/manual-lines', {
      key, lines: base, quality, offsetMs: Number(L.offsetMs) || 0,
      clearLineOffsets, duration: Number((Player.S.track || {}).duration) || 0
    });
    if (!d || !d.lines || !d.lines.length) { toast((d && d.error) || '保存失败', 'error'); return; }
    if (clearLineOffsets) {
      L.lineOffsets = {};
      saveLineOffsets(L.key, {});
    }
    const nextL = Object.assign({}, L, {
      cacheKey: d.key || key,
      baseLines: base,
      manual: true,
      source: 'manual',
      quality,
      sourceLabel: d.sourceLabel || '手动编辑',
      alignment: 'manual',
      align: null,
      candidates: [],
      canChoose: false,
      locked: false,
      reason: '',
      loading: false,
      aligning: false,
      preAlign: null,
      noAutoAlign: false
    });
    nextL.lines = recomputeLyricLines(nextL);
    state.lyrics = nextL;
    App.lyricNudgeIdx = Math.min(idx, nextL.lines.length - 1);
    if (App._alignTried) App._alignTried.clear();
    closeModal();
    if (window.FoliaBridge) FoliaBridge.refresh();
    if (window.LyricMV && LyricMV.refreshLine) LyricMV.refreshLine();
    renderView();
    syncLyricHighlight(true);
    syncMVSubtitle();
    toast('歌词已更新为手动版本', 'success');
  } catch (e) { errToast(e); }
}
/* tap-to-sync：播放到每句开头按空格，把该行钉到当前时间 */
function tapSyncStart() {
  const L = state.lyrics;
  if (!L || !L.lines || !L.lines.length) { toast('还没有歌词，无法打点', 'error'); return; }
  const idx = Math.max(0, Math.min(L.lines.length - 1, lineOffsetTarget() >= 0 ? lineOffsetTarget() : 0));
  App.tapSync = { active: true, idx, snapshots: [], tapped: new Set() };
  App.lyricLowOnly = false;
  App.lyricNudgeIdx = idx;
  App._lyricScrollHold = Date.now() + 3600000;
  clearTimeout(App._lyricSnapTimer);
  renderView();
  requestAnimationFrame(() => scrollToLyricLine(idx));
  toast('打点同步：播放到句首按空格；只打关键行，完成时自动插值；Esc 结束', '');
}
function tapSyncMark() {
  const L = state.lyrics, T = App.tapSync;
  if (!T.active || !L || !L.lines) return;
  if (T.idx >= L.lines.length) { tapSyncDone(); return; }
  const cur = (() => { try { return Player.activeEl().currentTime || 0; } catch (e) { return 0; } })();
  const globalSec = (Number(L.offsetMs) || 0) / 1000;
  const baseLine = L.baseLines && L.baseLines[T.idx];
  const baseT = baseLine ? Number(baseLine.t) || 0 : (Number(L.lines[T.idx].t) || 0) - globalSec;
  const prev = Number((L.lineOffsets || {})[T.idx]) || 0;
  const next = Math.max(-30000, Math.min(30000, Math.round((cur - (baseT + globalSec)) * 1000)));
  T.snapshots.push({ idx: T.idx, prev, wasTapped: T.tapped.has(T.idx) });
  T.tapped.add(T.idx);
  const offs = Object.assign({}, L.lineOffsets || {});
  if (next) offs[T.idx] = next; else delete offs[T.idx];
  L.lineOffsets = offs;
  saveLineOffsets(L.key, offs);
  L.lines = recomputeLyricLines(L);
  T.idx++;
  App.lyricNudgeIdx = Math.min(T.idx, L.lines.length - 1);
  App._lyricScrollHold = Date.now() + 3600000;
  if (window.FoliaBridge) FoliaBridge.refresh();
  if (window.LyricMV && LyricMV.refreshLine) LyricMV.refreshLine();
  renderView();
  requestAnimationFrame(() => scrollToLyricLine(App.tapSync.idx));
}
function tapSyncUndo() {
  const L = state.lyrics, T = App.tapSync;
  if (!T.active || !T.snapshots.length) return;
  const s = T.snapshots.pop();
  if (s.wasTapped) T.tapped.add(s.idx); else T.tapped.delete(s.idx);
  const offs = Object.assign({}, L.lineOffsets || {});
  if (s.prev) offs[s.idx] = s.prev; else delete offs[s.idx];
  L.lineOffsets = offs;
  saveLineOffsets(L.key, offs);
  L.lines = recomputeLyricLines(L);
  T.idx = s.idx;
  App.lyricNudgeIdx = s.idx;
  App._lyricScrollHold = Date.now() + 3600000;
  if (window.FoliaBridge) FoliaBridge.refresh();
  if (window.LyricMV && LyricMV.refreshLine) LyricMV.refreshLine();
  renderView();
  requestAnimationFrame(() => scrollToLyricLine(s.idx));
}
function tapSyncDone() {
  const L = state.lyrics, T = App.tapSync;
  if (!T.active) return;
  T.active = false;
  T.snapshots = [];
  /* 关键行打点后，相邻锚点之间按原歌词时间比例插值（等价于局部线性 scale+offset） */
  let filled = 0;
  if (L && Array.isArray(L.lines) && T.tapped && T.tapped.size >= 2) {
    const anchors = Array.from(T.tapped)
      .filter(i => i >= 0 && i < L.lines.length)
      .sort((a, b) => a - b);
    const base = Array.isArray(L.baseLines) ? L.baseLines : [];
    const g = (Number(L.offsetMs) || 0) / 1000;
    const offs = Object.assign({}, L.lineOffsets || {});
    for (let k = 0; k + 1 < anchors.length; k++) {
      const a = anchors[k], b = anchors[k + 1];
      if (b - a <= 1) continue;
      const ta = Number(L.lines[a].t) || 0;
      const tb = Number(L.lines[b].t) || 0;
      const ba = base[a] ? (Number(base[a].t) || 0) : ta - g;
      const bb = base[b] ? (Number(base[b].t) || 0) : tb - g;
      const span = bb - ba;
      const offA = Number(offs[a]) || 0;
      const offB = Number(offs[b]) || 0;
      for (let i = a + 1; i < b; i++) {
        if (T.tapped.has(i)) continue;
        const bi = base[i] ? (Number(base[i].t) || 0) : (Number(L.lines[i].t) || 0) - g;
        const ratio = span > 0.001
          ? Math.max(0, Math.min(1, (bi - ba) / span))
          : (i - a) / (b - a);
        const off = Math.max(-30000, Math.min(30000, Math.round(offA + ratio * (offB - offA))));
        if (off) offs[i] = off; else delete offs[i];
        filled++;
      }
    }
    if (filled) {
      L.lineOffsets = offs;
      saveLineOffsets(L.key, offs);
      L.lines = recomputeLyricLines(L);
      if (window.FoliaBridge) FoliaBridge.refresh();
      if (window.LyricMV && LyricMV.refreshLine) LyricMV.refreshLine();
    }
  }
  App._lyricScrollHold = 0;
  renderView();
  syncLyricHighlight(false);
  syncMVSubtitle();
  const tapped = T.tapped ? T.tapped.size : 0;
  toast(filled
    ? `打点完成 · 插值 ${filled} 行`
    : (tapped >= 2 ? '打点完成' : (tapped ? `打点完成 · ${tapped} 个锚点（至少 2 个才插值）` : '打点同步已结束')),
    'success');
}
/* 按音频起音估算整首偏移：只给建议，用户确认后应用 */
async function estimateLyricOffset() {
  const L = state.lyrics;
  const t = Player.S.track;
  if (!L || !L.baseLines || L.baseLines.length < 4) {
    toast('歌词太少，无法估算', 'error');
    return;
  }
  if (!t || !t.bvid || !t.cid) {
    toast('只有 B 站视频可以按音频估算偏移', 'error');
    return;
  }
  if (App._estBusy) { toast('正在分析中…', ''); return; }
  App._estBusy = true;
  try {
    toast('正在分析音频起音…', '');
    const ch = await chromaOf({ bvid: t.bvid, cid: t.cid });
    const h = ch && ch.hopSec, onset = ch && ch.onset;
    const n = onset ? onset.length : 0;
    if (!(h > 0) || n < 20) throw new Error('音频分析失败');
    const rad = Math.max(1, Math.round(0.35 / h));
    const onSm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let k = -rad; k <= rad; k++) {
        const j = i + k;
        if (j >= 0 && j < n) { s += onset[j]; c++; }
      }
      onSm[i] = c ? s / c : 0;
    }
    const use = L.baseLines.filter(l => Number(l.t) >= 0.5);
    if (use.length < 4) throw new Error('歌词太少');
    const dur = Number(t.duration) || 0;
    const first = Number(use[0].t) || 0;
    const maxOff = Math.max(30, Math.min(420, dur > 0 ? dur - first - 5 : 300));
    const scoreAt = off => {
      let sum = 0, c = 0;
      for (const l of use) {
        const tt = Number(l.t) + off;
        if (tt < 0 || (dur > 0 && tt > dur)) continue;
        const idx = Math.round(tt / h);
        if (idx >= 0 && idx < n) { sum += onSm[idx]; c++; }
      }
      return c >= Math.max(4, Math.floor(use.length * 0.6)) ? sum / c : -1;
    };
    const s0 = scoreAt(0);
    let best = { off: 0, score: s0 };
    for (let off = -30; off <= maxOff + 1e-9; off += 0.5) {
      const sc = scoreAt(off);
      if (sc > best.score) best = { off: +off.toFixed(2), score: sc };
    }
    for (let off = best.off - 1; off <= best.off + 1 + 1e-9; off += 0.1) {
      const sc = scoreAt(off);
      if (sc > best.score) best = { off: +off.toFixed(2), score: sc };
    }
    const improved = best.score > 0 && (s0 <= 0 || best.score > s0 * 1.03 || best.score - s0 > 0.01);
    if (!improved || Math.abs(best.off) < 0.8) {
      toast('没有找到明显偏移，可以手动输入', '');
      return;
    }
    const conf = Math.max(0, Math.min(1, s0 > 0 ? (best.score - s0) / Math.max(best.score, 1e-6) : 0.35));
    const sign = best.off > 0 ? '+' : '';
    const curOff = (Number(L.offsetMs) || 0) / 1000;
    showModal(`<h3>自动估算偏移</h3>
      <div class="ly-est">
        <p>建议整首偏移：<b>${sign}${best.off.toFixed(1)}s</b></p>
        <p>应用后首行约 <b>${fmt(first + best.off)}</b> · 置信度 <b>${Math.round(conf * 100)}%</b></p>
        <p class="ly-est-tip">按音频起音估算，低置信时请试听后决定；应用后仍可继续手动微调。</p>
        <div class="ly-est-actions">
          <button class="btn ghost" data-action="ly-preview" data-off="${curOff.toFixed(2)}">试听当前</button>
          <button class="btn ghost" data-action="ly-preview" data-off="${best.off.toFixed(2)}">试听建议</button>
          <button class="btn primary" data-action="ly-apply-est" data-off="${best.off.toFixed(2)}">应用建议</button>
        </div>
      </div>`, 'wide');
  } catch (e) {
    toast('估算失败：' + (e && e.message || e), 'error');
  } finally {
    App._estBusy = false;
  }
}
function applyEstimatedOffset(offSec) {
  const L = state.lyrics;
  if (!L) return;
  const target = Number(offSec) || 0;
  const cur = (Number(L.offsetMs) || 0) / 1000;
  closeModal();
  if (Math.abs(target - cur) < 0.001) { toast('偏移已经相同', ''); return; }
  changeLyricOffset(target - cur);
  toast('已应用建议偏移 ' + (target >= 0 ? '+' : '') + target.toFixed(1) + 's', 'success');
}
/* 校准试听：跳到当前/建议偏移下的当前句前 1.2s 播放，方便 A/B 对比 */
function previewLyricOffset(offSec) {
  const L = state.lyrics;
  if (!L || !L.lines || !L.lines.length) { toast('还没有歌词', 'error'); return; }
  const idx = Math.max(0, Math.min(L.lines.length - 1, lineOffsetTarget() >= 0 ? lineOffsetTarget() : (App.lyricIdx >= 0 ? App.lyricIdx : 0)));
  const base = (L.baseLines && L.baseLines[idx]) || L.lines[idx];
  const useOff = Number.isFinite(Number(offSec)) ? Number(offSec) : (Number(L.offsetMs) || 0) / 1000;
  const lineAdj = (Number((L.lineOffsets || {})[idx]) || 0) / 1000;
  const el = Player.activeEl();
  const dur = Number(el.duration) || Number((Player.S.track || {}).duration) || 0;
  let target = Math.max(0, (Number(base.t) || 0) + useOff + lineAdj - 1.2);
  if (dur > 0) target = Math.min(target, Math.max(0, dur - 0.6));
  try {
    el.currentTime = target;
    if (el.paused) el.play().catch(() => {});
  } catch (e) {}
  toast('试听第 ' + (idx + 1) + ' 行 · 偏移 ' + (useOff >= 0 ? '+' : '') + useOff.toFixed(1) + 's', '');
}
function saveLyricOffset(key, offsetMs) {
  if (!key) return Promise.resolve();
  const p = (App._offSave || Promise.resolve())
    .catch(() => {})
    .then(() => Api.post('lyrics/offset', { key, offsetMs }))
    .catch(() => {});
  App._offSave = p;
  return p;
}
function changeLyricOffset(deltaSec) {
  const L = state.lyrics;
  if (!L || !L.lines || !L.lines.length) return;
  const d = Number(deltaSec) || 0;
  if (!d) return;
  const cur = Number(L.offsetMs) || 0;
  const next = Math.max(-600000, Math.min(600000, Math.round(cur + d * 1000)));
  if (next === cur) return;
  const base = L.baseLines || shiftLyricLinesRaw(L.lines, -cur / 1000);
  L.baseLines = base;
  L.offsetMs = next;
  L.lines = applyLineOffsets(next ? shiftLyricLinesRaw(base, next / 1000) : base, L.lineOffsets || {});
  try { localStorage.setItem('bp.lyricOffset.' + (L.key || ''), String(L.offsetMs)); } catch (e) {}
  if (window.FoliaBridge) FoliaBridge.refresh();
  if (window.LyricMV && LyricMV.refreshLine) LyricMV.refreshLine();
  saveLyricOffset(L.cacheKey || L.key, L.offsetMs);
  if (state.view.name === 'nowplaying' && state.npInfoTab === 'lyric') renderView();
  syncLyricHighlight(true);
  syncMVSubtitle();
}
function parseLyricOffsetValue(v) {
  let s = String(v || '').trim().replace(/[，,]/g, '.').replace(/[＋]/g, '+').replace(/[−–—]/g, '-').replace(/s$/i, '');
  if (!s) return null;
  const m = s.match(/^([+-]?)(\d{1,3}):(\d{1,2}(?:\.\d+)?)$/);
  if (m) {
    const sec = parseInt(m[2], 10) * 60 + parseFloat(m[3]);
    return m[1] === '-' ? -sec : sec;
  }
  const n = Number(s);
  return isFinite(n) ? n : null;
}
function applyLyricOffsetInput() {
  const inp = document.getElementById('ly-offset-input');
  const L = state.lyrics;
  if (!inp || !L || !L.lines || !L.lines.length) return;
  const sec = parseLyricOffsetValue(inp.value);
  if (sec == null) {
    toast('请输入秒数，如 90 或 1:30', 'error');
    inp.focus();
    return;
  }
  const target = Math.max(-600, Math.min(600, sec));
  const cur = (Number(L.offsetMs) || 0) / 1000;
  const delta = target - cur;
  if (Math.abs(delta) < 0.001) {
    toast('偏移未变化', '');
    return;
  }
  changeLyricOffset(delta);
  toast('歌词偏移 ' + (target >= 0 ? '+' : '') + target.toFixed(1) + 's', 'success');
}
function resetLyricOffset() {
  const L = state.lyrics;
  if (!L) return;
  const off = Number(L.offsetMs) || 0;
  if (off) changeLyricOffset(-off / 1000);
}
function cancelLyricAlign() {
  const L = state.lyrics;
  if (!L) return;
  const key = L.cacheKey || L.key;
  L.noAutoAlign = true;
  Api.post('lyrics/align', { key, clear: true }).catch(() => {});
  if (Array.isArray(L.preAlign) && L.preAlign.length) {
    L.lines = L.preAlign;
  } else if (L.align && Number(L.align.scale) > 0) {
    const s = Number(L.align.scale) || 1;
    const o = Number(L.align.offset) || 0;
    const inv = t => Math.max(0, ((Number(t) || 0) - o) / s);
    L.lines = L.lines.map(l => {
      const n = Object.assign({}, l, { t: inv(l.t), end: inv(l.end) });
      if (!(n.end > n.t)) n.end = n.t + 0.6;
      if (Array.isArray(l.words)) n.words = l.words.map(w => {
        const t = inv(w.t);
        let e = inv(w.end);
        if (!(e > t)) e = t + 0.05;
        return Object.assign({}, w, { text: w.text, t, end: e });
      });
      return n;
    });
  }
  const uo = Number(L.offsetMs) || 0;
  const baseNow = uo ? shiftLyricLinesRaw(L.lines, -uo / 1000) : L.lines;
  L.baseLines = L.preAlignBase || removeLineOffsets(baseNow, L.lineOffsets || {});
  L.preAlign = null;
  L.preAlignBase = null;
  L.align = null;
  L.alignment = 'needs-align';
  L.sourceLabel = String(L.sourceLabel || '')
    .replace(/ · 已按现场节奏对齐/g, '')
    .replace(/ · 自动对齐置信度低/g, '')
    + ' · 现场版待校准';
  if (window.FoliaBridge) FoliaBridge.refresh();
  if (window.LyricMV && LyricMV.refreshLine) LyricMV.refreshLine();
  if (state.view.name === 'nowplaying' && state.npInfoTab === 'lyric') renderView();
  syncLyricHighlight(true);
}
function reloadLyrics() {
  const L = state.lyrics;
  const key = L && (L.cacheKey || L.key);
  const run = () => {
    if (App._alignTried) App._alignTried.clear();
    if (L) saveLineOffsets(L.key, {});
    Promise.resolve(key ? Api.post('lyrics/clear', { key }) : null)
      .catch(() => {})
      .then(() => loadLyricsIfNeeded(true));
  };
  if (L && L.manual) {
    confirmModal('这会清除手动导入的歌词并重新在线搜索，继续吗？', () => {
      const k = L.cacheKey || L.key;
      Api.post('lyrics/override/clear', { key: k }).catch(() => {}).then(run);
    });
    return;
  }
  run();
}
function clearManualLyrics() {
  const L = state.lyrics;
  if (!L) return;
  const key = L.cacheKey || L.key;
  saveLineOffsets(L.key, {});
  Api.post('lyrics/override/clear', { key }).catch(() => {})
    .then(() => Api.post('lyrics/clear', { key }).catch(() => {}))
    .then(() => loadLyricsIfNeeded(true));
}
/* 恢复自动匹配：手动歌词、锁定源、缓存、逐行偏移一起清掉；这是唯一的“完全回到自动”入口 */
function restoreAutoLyrics() {
  const L = state.lyrics;
  if (!L) return;
  const key = L.cacheKey || L.key;
  saveLineOffsets(L.key, {});
  Promise.all([
    Api.post('lyrics/override/clear', { key }).catch(() => {}),
    Api.post('lyrics/lock/clear', { key }).catch(() => {}),
    Api.post('lyrics/clear', { key }).catch(() => {})
  ]).then(() => loadLyricsIfNeeded(true));
}
function openLyricImport() {
  const L = state.lyrics;
  if (!L) return;
  showModal(`<h3>导入歌词</h3>
    <div class="ly-import-note">支持带时间轴的 LRC；也可以直接粘贴纯文本，导入后会自动进入打点同步。</div>
    <textarea id="ly-import-text" class="ly-import-text" spellcheck="false" placeholder="[00:12.34]第一句歌词&#10;[00:16.20]第二句歌词&#10;..."></textarea>
    <div class="ly-import-actions">
      <button class="btn ghost" data-action="modal-close">取消</button>
      <button class="btn primary" data-action="ly-import-do">导入</button>
    </div>`, 'wide');
  const ta = document.getElementById('ly-import-text');
  if (ta) setTimeout(() => ta.focus(), 50);
}
async function importLyricText() {
  const L = state.lyrics;
  if (!L) { toast('还没有歌曲信息', 'error'); return; }
  const ta = document.getElementById('ly-import-text');
  const text = ta ? ta.value : '';
  if (!text.trim()) { toast('先粘贴歌词', 'error'); return; }
  const key = L.cacheKey || L.key;
  if (!key || /\|$/.test(key)) { toast('视频信息还没就绪，稍后再试', 'error'); return; }
  try {
    const d = await Api.post('lyrics/import', { key, text, duration: Number((Player.S.track || {}).duration) || 0 });
    if (!d || !d.lines || !d.lines.length) { toast((d && d.error) || '没有解析到歌词', 'error'); return; }
    if (App._alignTried) App._alignTried.clear();
    state.lyrics = Object.assign({}, L, {
      cacheKey: d.key || key,
      lines: d.lines,
      baseLines: d.lines,
      source: 'manual',
      quality: d.quality || 'line',
      sourceLabel: d.sourceLabel || '手动导入',
      alignment: d.alignment || 'manual',
      align: null,
      candidates: [],
      canChoose: false,
      locked: false,
      manual: true,
      offsetMs: 0,
      lineOffsets: {},
      refDuration: 0,
      authRequired: false,
      instrumental: false,
      reason: '',
      loading: false,
      aligning: false,
      preAlign: null,
      noAutoAlign: false
    });
    try { localStorage.setItem('bp.lyricOffset.' + L.key, '0'); } catch (e) {}
    saveLineOffsets(L.key, {});
    App.lyricNudgeIdx = d.plain ? 0 : -1;
    App.tapSync.active = false;
    closeModal();
    if (window.FoliaBridge) FoliaBridge.refresh();
    if (window.LyricMV && LyricMV.refreshLine) LyricMV.refreshLine();
    renderView();
    syncLyricHighlight(true);
    syncMVSubtitle();
    toast(d.plain ? '歌词已导入 · 进入打点同步' : '歌词已导入', 'success');
    if (d.plain) setTimeout(() => tapSyncStart(), 350);
  } catch (e) { errToast(e); }
}
function lrcClock(t) {
  const cs = Math.max(0, Math.round((Number(t) || 0) * 100));
  const m = Math.floor(cs / 6000), s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(c).padStart(2, '0');
}
function lrcStamp(t) { return '[' + lrcClock(t) + ']'; }
function srtStamp(t) {
  const total = Math.max(0, Math.round((Number(t) || 0) * 1000));
  const h = Math.floor(total / 3600000), m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000), ms = total % 1000;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + ',' + String(ms).padStart(3, '0');
}
function assStamp(t) {
  const cs = Math.max(0, Math.round((Number(t) || 0) * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100), c = cs % 100;
  return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(c).padStart(2, '0');
}
function lyricToLrc(lines, enhanced) {
  const t = Player.S.track || {};
  const out = ['[ti:' + (t.title || t.name || '') + ']', '[ar:' + (t.up || t.artist || '') + ']', '[by:BiliPlayer]', ''];
  for (const l of lines || []) {
    if (enhanced && Array.isArray(l.words) && l.words.length) {
      out.push(lrcStamp(l.t) + l.words.map(w => '<' + lrcClock(w.t) + '>' + w.text).join(''));
    } else {
      out.push(lrcStamp(l.t) + l.text);
    }
  }
  return out.join('\n');
}
function lyricToSrt(lines) {
  return (lines || []).map((l, i) => {
    const end = Number(l.end) > Number(l.t) ? l.end : Number(l.t) + 3;
    return (i + 1) + '\n' + srtStamp(l.t) + ' --> ' + srtStamp(end) + '\n' + l.text + '\n';
  }).join('\n');
}
function lyricToAss(lines) {
  const t = Player.S.track || {};
  const head = '[Script Info]\nTitle: ' + (t.title || '') + '\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n' +
    '[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n' +
    'Style: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,0,2,40,40,60,1\n\n' +
    '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n';
  return head + (lines || []).map(l => {
    const end = Number(l.end) > Number(l.t) ? l.end : Number(l.t) + 3;
    const text = String(l.text || '').replace(/[{}]/g, '').replace(/\n/g, '\\N');
    return 'Dialogue: 0,' + assStamp(l.t) + ',' + assStamp(end) + ',Default,,0,0,0,,' + text;
  }).join('\n');
}
function downloadLyricFile(kind) {
  const L = state.lyrics;
  if (!L || !L.lines || !L.lines.length) { toast('还没有歌词', 'error'); return; }
  const t = Player.S.track || {};
  const base = String(t.title || t.name || 'lyrics').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'lyrics';
  let text = '', ext = 'txt', mime = 'text/plain';
  if (kind === 'lrc') { text = lyricToLrc(L.lines, false); ext = 'lrc'; }
  else if (kind === 'elrc') { text = lyricToLrc(L.lines, true); ext = 'lrc'; }
  else if (kind === 'srt') { text = lyricToSrt(L.lines); ext = 'srt'; }
  else if (kind === 'ass') { text = lyricToAss(L.lines); ext = 'ass'; }
  else return;
  const blob = new Blob([text], { type: mime + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = base + '.' + ext;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('已导出 ' + ext.toUpperCase(), 'success');
}
function downloadTextFile(name, text, mime) {
  const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function backupLyricData() {
  try {
    const d = await Api.get('lyrics/backup');
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    downloadTextFile('BiliPlayer-lyrics-backup-' + stamp + '.json', JSON.stringify(d, null, 2), 'application/json');
    const counts = [d.overrides, d.locks, d.lineOffsets].map(x => Object.keys(x || {}).length);
    toast('歌词数据已备份：手动 ' + counts[0] + ' · 锁定 ' + counts[1] + ' · 偏移 ' + counts[2], 'success');
  } catch (e) { errToast(e); }
}
function openLyricRestore() {
  showModal(`<h3>恢复歌词数据</h3>
    <div class="ly-import-note">粘贴之前导出的 JSON。恢复会覆盖现有手动歌词、锁定源和逐行偏移。</div>
    <textarea id="ly-restore-text" class="ly-import-text" style="height:220px" spellcheck="false" placeholder='{"version":1,"overrides":{},"locks":{},"lineOffsets":{}}'></textarea>
    <div class="ly-import-actions">
      <button class="btn ghost" data-action="modal-close">取消</button>
      <button class="btn primary" data-action="ly-restore-do">恢复</button>
    </div>`, 'wide');
}
function restoreLyricData() {
  const ta = document.getElementById('ly-restore-text');
  const text = ta ? ta.value : '';
  if (!text.trim()) { toast('先粘贴备份 JSON', 'error'); return; }
  let data = null;
  try { data = JSON.parse(text); } catch (e) { toast('JSON 格式不正确', 'error'); return; }
  confirmModal('这会覆盖现有手动歌词、锁定源和逐行偏移，继续吗？', () => {
    Api.post('lyrics/restore', { data })
      .then(r => {
        const c = (r && r.counts) || {};
        return Api.post('lyrics/clear', {}).catch(() => {}).then(() => c);
      })
      .then(c => {
        toast('已恢复：手动 ' + (c.overrides || 0) + ' · 锁定 ' + (c.locks || 0) + ' · 偏移 ' + (c.lineOffsets || 0), 'success');
        loadLyricsIfNeeded(true);
      })
      .catch(errToast);
  });
}
/* 校准向导：把 CC → 整体偏移 → 关键行打点串成一个流程，只给操作入口，不自动改时间轴 */
function openLyricExport() {
  const L = state.lyrics;
  if (!L || !L.lines || !L.lines.length) { toast('还没有歌词', 'error'); return; }
  const hasWords = L.lines.some(l => Array.isArray(l.words) && l.words.length);
  showModal(`<h3>导出歌词</h3>
    <div class="ly-src-note">当前 ${L.lines.length} 行 · ${L.quality === 'word' ? '逐字' : '行级'}${L.manual ? ' · 手动导入' : ''}</div>
    <div class="ly-export-grid">
      <button class="btn" data-action="ly-export" data-kind="lrc">LRC 行级</button>
      <button class="btn" data-action="ly-export" data-kind="elrc" ${hasWords ? '' : 'disabled'}>增强 LRC 逐字</button>
      <button class="btn" data-action="ly-export" data-kind="srt">SRT 字幕</button>
      <button class="btn" data-action="ly-export" data-kind="ass">ASS 字幕</button>
    </div>`, 'wide');
}
function openCalibrateWizard() {
  const L = state.lyrics;
  if (!L || !L.lines || !L.lines.length) { toast('还没有歌词，先找歌词或导入', 'error'); return; }
  const t = Player.S.track || {};
  const cands = L.candidates || [];
  const cc = cands.find(c => c.source === 'bili-cc-align') || cands.find(c => c.source === 'bili-cc');
  const ccCurrent = L.source === 'bili-cc' || L.source === 'bili-cc-align';
  const off = (Number(L.offsetMs) || 0) / 1000;
  const lineCount = Object.keys(L.lineOffsets || {}).length;
  const canEst = !!(t.bvid && t.cid && L.baseLines && L.baseLines.length >= 4);
  const ccState = ccCurrent ? 'done' : (cc ? 'ready' : (L.authRequired ? 'blocked' : 'none'));
  const ccText = ccCurrent
    ? '当前就是用本视频字幕的时间轴'
    : cc
      ? '发现「' + (cc.label || cc.source) + '」，可换到它'
      : (L.authRequired ? 'B 站未登录，读不到本视频字幕' : '本视频没有可用 CC 字幕');
  const alignText = L.alignment === 'scale-offset' ? '已按现场音频自动对齐'
    : L.alignment === 'scale-offset-low' ? '已自动对齐，但置信度较低'
      : L.alignment === 'needs-align' ? '与原曲时长差较大，还没有对齐'
        : L.alignment === 'manual' ? '手动导入 / 手动校准' : '还没有做整体对齐';
  const offText = off ? '当前整体偏移 ' + (off > 0 ? '+' : '') + off.toFixed(1) + 's' : '当前没有整体偏移';
  const tapText = lineCount ? '已有 ' + lineCount + ' 行单独偏移' : '还没有关键行打点';
  const stepClass = s => 'ly-cal-step ' + s;
  const stateChip = (s, doneText, readyText, noneText) => {
    if (s === 'done') return `<span class="ly-cal-chip done">${doneText}</span>`;
    if (s === 'ready') return `<span class="ly-cal-chip ready">${readyText}</span>`;
    if (s === 'blocked') return `<span class="ly-cal-chip blocked">${noneText}</span>`;
    return `<span class="ly-cal-chip none">${noneText}</span>`;
  };
  showModal(`<h3>歌词校准向导</h3>
    <div class="ly-cal-list">
      <div class="${stepClass(ccState)}">
        <div class="ly-cal-num">1</div>
        <div class="ly-cal-main">
          <b>用本视频字幕时间</b>
          <span>${esc(ccText)}</span>
        </div>
        <div class="ly-cal-act">
          ${ccCurrent ? stateChip('done', '已完成') : cc ? `<button class="btn primary" data-action="ly-cal-cc" data-idx="${cc.index}">切换</button>` : L.authRequired ? '<button class="btn" data-action="login-open">登录</button>' : stateChip('none', '', '', '无 CC')}
        </div>
      </div>
      <div class="${stepClass(off || L.alignment === 'scale-offset' || L.alignment === 'scale-offset-low' ? 'done' : (canEst ? 'ready' : 'none'))}">
        <div class="ly-cal-num">2</div>
        <div class="ly-cal-main">
          <b>整体偏移</b>
          <span>${esc(alignText)} · ${esc(offText)}</span>
          <em>${canEst ? '按本视频音频起音估算，只给建议，应用前会确认' : '需要 B 站视频和 cid 才能按音频估算'}</em>
        </div>
        <div class="ly-cal-act">
          ${canEst ? '<button class="btn" data-action="ly-cal-estimate">估算</button>' : stateChip('none', '', '', '不可用')}
          ${off ? '<button class="btn ghost" data-action="ly-cal-offset-reset">归零</button>' : ''}
        </div>
      </div>
      <div class="${stepClass(lineCount ? 'done' : 'ready')}">
        <div class="ly-cal-num">3</div>
        <div class="ly-cal-main">
          <b>关键句打点</b>
          <span>${esc(tapText)}</span>
          <em>播放到关键句开头按空格；不用每句都打，完成时自动插值</em>
        </div>
        <div class="ly-cal-act">
          <button class="btn" data-action="ly-cal-tap">${lineCount ? '重新打点' : '开始打点'}</button>
        </div>
      </div>
    </div>
    <div class="ly-cal-foot">
      <span>顺序建议：先换成本视频时间，再修整体偏移，最后补关键句；工具条的 ±0.2s 和逐行微调仍可随时用。</span>
      <div class="ly-cal-btns">
        ${L.align ? '<button class="btn ghost" data-action="ly-cal-cancel-align">取消自动对齐</button>' : ''}
        <button class="btn" data-action="modal-close">完成</button>
      </div>
    </div>`, 'wide');
}
function lyricDiagData() {
  const L = state.lyrics || {};
  const t = Player.S.track || {};
  const lines = L.lines || [];
  return {
    track: { title: t.title || '', artist: t.up || '', bvid: t.bvid || '', cid: t.cid || '', nid: t.nid || '', duration: t.duration || 0 },
    lyric: {
      key: L.key || '', cacheKey: L.cacheKey || '', source: L.source || '', quality: L.quality || '',
      sourceLabel: L.sourceLabel || '', alignment: L.alignment || '', align: L.align || null,
      offsetMs: L.offsetMs || 0, lineOffsets: L.lineOffsets || {}, refDuration: L.refDuration || 0,
      lines: lines.length, first: lines[0] ? lines[0].t : null, last: lines.length ? lines[lines.length - 1].t : null,
      authRequired: !!L.authRequired, instrumental: !!L.instrumental, locked: !!L.locked, reason: L.reason || '',
      bestScore: Number(L.bestScore) || 0, candidateCount: Number(L.candidateCount) || (L.candidates || []).length,
      manual: !!L.manual,
      stats: L.stats || null
    },
    candidates: L.candidates || [],
    mv: { style: App.mv.style, foliaError: App.mv.foliaError || null }
  };
}
function lyricReasonText(r) {
  return ({
    'no-source': '音源无结果', 'low-score': '候选分数低', 'rate-limited': '接口风控',
    'bili-auth': 'B 站未登录', 'instrumental': '纯音乐', 'no-match': '无匹配',
    'cid-failed': 'cid 获取失败', 'no-track': '缺少歌曲信息'
  })[r] || r || 'ok';
}
function lyricDiagText() { return JSON.stringify(lyricDiagData(), null, 2); }
function copyPlainText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  ta.remove();
  return Promise.resolve();
}
function copyLyricDiagnostics() {
  copyPlainText(lyricDiagText()).then(() => toast('诊断信息已复制', 'success')).catch(() => toast('复制失败', 'error'));
}
function openLyricDiagnostics() {
  const L = state.lyrics;
  if (!L) { toast('还没有歌词数据', 'error'); return; }
  const d = lyricDiagData();
  const st = d.lyric.stats;
  let reqText = '—';
  if (st) {
    const parts = Object.entries(st.sources || {}).map(([k, v]) => k + ' ' + v.ms + 'ms' + (v.ok ? '' : ' ×'));
    reqText = (st.cacheHit ? '缓存命中' : '实时') + (st.totalMs != null ? ' · ' + st.totalMs + 'ms' : '') + (parts.length ? ' · ' + parts.join(' / ') : '');
  }
  const cands = (L.candidates || []).map(c => {
    const ex = c.explain ? ` title="标题 ${c.explain.title} · 歌手 ${c.explain.artist} · 时长 ${c.explain.duration} · 版本 ${c.explain.version}"` : '';
    return `<div class="ly-diag-cand ${c.current ? 'current' : ''}"${ex}>
    <span>${esc(c.source || '')}</span>
    <b>${esc(c.title || '')}</b>
    <em>${esc(c.artist || '')}</em>
    <i>${c.quality === 'word' ? '逐字' : c.quality === 'line' ? '行级' : '文本'} · ${c.duration ? fmt(c.duration) : '—'} · ${c.score}</i>
    ${c.current ? '<u>当前</u>' : ''}
  </div>`;
  }).join('');
  showModal(`<h3>歌词诊断</h3>
    <div class="ly-diag">
      <div class="ly-diag-row"><span>歌曲</span><b>${esc(d.track.title)}</b></div>
      <div class="ly-diag-row"><span>歌手/UP</span><b>${esc(d.track.artist)}</b></div>
      <div class="ly-diag-row"><span>视频</span><b>${esc(d.track.bvid || ('n' + d.track.nid))} / ${esc(String(d.track.cid || ''))}</b></div>
      <div class="ly-diag-row"><span>来源</span><b>${esc(d.lyric.sourceLabel || d.lyric.source || '—')}</b></div>
      <div class="ly-diag-row"><span>质量</span><b>${esc(d.lyric.quality || 'none')}</b></div>
      <div class="ly-diag-row"><span>对齐</span><b>${esc(d.lyric.alignment || '—')}${d.lyric.align ? ' · scale ' + d.lyric.align.scale + ' / offset ' + d.lyric.align.offset + ' / conf ' + d.lyric.align.confidence : ''}</b></div>
      <div class="ly-diag-row"><span>偏移</span><b>${d.lyric.offsetMs}ms · 逐行 ${Object.keys(d.lyric.lineOffsets).length} 行</b></div>
      <div class="ly-diag-row"><span>行数</span><b>${d.lyric.lines}${d.lyric.first != null ? ' · ' + fmt(d.lyric.first) + ' → ' + fmt(d.lyric.last) : ''}</b></div>
      <div class="ly-diag-row"><span>缓存 key</span><b>${esc(d.lyric.cacheKey || '—')}</b></div>
      <div class="ly-diag-row"><span>请求</span><b>${esc(reqText)}</b></div>
      ${d.mv && d.mv.foliaError ? `<div class="ly-diag-row"><span>MV 错误</span><b>${esc(d.mv.foliaError.style || '')} · ${esc(d.mv.foliaError.source || '')} · ${esc(d.mv.foliaError.message || '')}</b></div>` : ''}
      <div class="ly-diag-row"><span>状态</span><b>${d.lyric.locked ? '已锁定 · ' : ''}${d.lyric.manual ? '手动导入 · ' : ''}${d.lyric.authRequired ? 'B站未登录 · ' : ''}${d.lyric.instrumental ? '纯音乐 · ' : ''}${esc(lyricReasonText(d.lyric.reason))}${d.lyric.candidateCount ? ' · 候选 ' + d.lyric.candidateCount + (d.lyric.bestScore ? ' · 最高 ' + Math.round(d.lyric.bestScore * 100) : '') : ''}</b></div>
      <div class="ly-diag-head">候选源</div>
      ${cands || '<div class="ly-diag-empty">没有候选</div>'}
      <div class="ly-diag-actions">
        <button class="btn" data-action="ly-diag-copy">复制诊断</button>
        <button class="btn" data-action="ly-diag-reload">清缓存并重试</button>
        <button class="btn" data-action="ly-backup">备份歌词数据</button>
        <button class="btn" data-action="ly-restore-open">恢复歌词数据</button>
      </div>
    </div>`, 'wide');
}
function openLyricSources() {
  const L = state.lyrics;
  const list = (L && L.candidates) || [];
  if (!list.length) return;
  const rows = list.map(c => {
    const lab = String(c.label || c.source || '');
    const q = c.quality === 'word' ? '逐字' : (c.quality === 'line' ? '行级' : '文本');
    const meta = (lab.includes('逐字') || lab.includes('行级') ? lab : lab + ' · ' + q) + (c.duration ? ' · ' + fmt(c.duration) : '') + (c.ccCoverage ? ' · CC ' + Math.round(c.ccCoverage * 100) + '%' : '');
    const preview = Array.isArray(c.preview) && c.preview.length
      ? `<span class="ly-src-preview">${c.preview.map(x => esc(x)).join(' / ')}</span>` : '';
    const ex = c.explain ? ` title="标题 ${c.explain.title} · 歌手 ${c.explain.artist} · 时长 ${c.explain.duration} · 版本 ${c.explain.version}"` : '';
    return `<button class="ly-src-row ${c.current ? 'current' : ''}"${ex} data-action="ly-choose" data-idx="${c.index}">
      <span class="ly-src-main"><b>${esc(c.title || c.source || '')}</b><em>${esc(c.artist || '')}</em>${preview}</span>
      <span class="ly-src-meta">${esc(meta)}</span>
      ${c.current ? '<span class="ly-src-cur">当前</span>' : ''}
    </button>`;
  }).join('');
  showModal(`<h3>选择歌词源</h3>
    <div class="ly-src-note">选择后会锁定这个源（清缓存/重新找仍保持）；点“恢复自动匹配”会清除锁定、手动歌词、缓存和逐行偏移。</div>
    <div class="ly-src-list">${rows}</div>
    <div class="ly-src-tools"><button class="btn" data-action="ly-auto">恢复自动匹配</button></div>`, 'wide');
}
function chooseLyricSource(idx) {
  const L = state.lyrics;
  if (!L) return;
  const key = L.cacheKey || L.key;
  Api.post('lyrics/choose', { key, index: idx }).then(d => {
    if (!d || !d.lines || !d.lines.length) { toast('这个来源没有可用歌词', 'error'); return; }
    if (App._alignTried) App._alignTried.clear();
    state.lyrics = Object.assign({}, L, {
      cacheKey: d.key || key,
      lines: d.lines,
      baseLines: d.lines,
      source: d.source || '',
      quality: d.quality || '',
      sourceLabel: d.sourceLabel || '',
      alignment: d.alignment || '',
      align: d.align || null,
      candidates: d.candidates || L.candidates || [],
      canChoose: !!d.canChoose,
      locked: !!d.locked,
      manual: !!d.manual,
      stats: d.stats || null,
      offsetMs: Number(d.offsetMs) || 0,
      lineOffsets: {},
      refDuration: Number(d.refDuration) || 0,
      authRequired: !!d.authRequired,
      aligning: false,
      preAlign: null,
      noAutoAlign: false,
      reason: d.reason || '',
      bestScore: Number(d.bestScore) || 0,
      candidateCount: Number(d.candidateCount) || 0
    });
    try { localStorage.setItem('bp.lyricOffset.' + state.lyrics.key, '0'); } catch (e) {}
    saveLineOffsets(state.lyrics.key, {});
    App.lyricNudgeIdx = -1;
    if (window.FoliaBridge) FoliaBridge.refresh();
    if (window.LyricMV && LyricMV.refreshLine) LyricMV.refreshLine();
    closeModal();
    if (state.view.name === 'nowplaying' && state.npInfoTab === 'lyric') renderView();
    syncLyricHighlight(true);
    toast('已切换歌词源', 'success');
    if (state.lyrics.alignment === 'needs-align') {
      setTimeout(() => maybeAlignLiveLyrics(Player.S.track, d, App.lyricsToken), 500);
    }
  }).catch(errToast);
}
function lineConfidence(l, L) {
  if (l.ccMatched === true) return 'cc';
  if (l.ccMatched === false) return 'est';
  if (l.confidence === 'low' || L.alignment === 'scale-offset-low' || L.alignment === 'needs-align') return 'low';
  return '';
}
function lyricLineHtml(l) {
  if (Array.isArray(l.words) && l.words.some(w => w && w.kana)) {
    return l.words.map(w => w && w.kana
      ? `<ruby>${esc(w.text)}<rt>${esc(w.kana)}</rt></ruby>`
      : esc((w && w.text) || '')).join('');
  }
  return esc(l.text);
}
function lyricsBody() {
  const L = state.lyrics;
  if (!L) return `<p class="nt-desc">搜索歌词中…</p>`;
  if (L.loading) return `<p class="nt-desc">搜索歌词中…</p>`;
  if (!L.lines || !L.lines.length) {
    let msg = '暂无歌词';
    let hint = '这首歌还没有可用的歌词';
    if (L.authRequired || L.reason === 'bili-auth') {
      msg = 'B 站未登录';
      hint = '登录 B 站后可读取本视频字幕；外部歌词源也没找到匹配版本';
    } else if (L.instrumental) {
      msg = '纯音乐 / 间奏';
      hint = '没有检测到歌词，MV 会跟随节奏律动';
    } else if (L.reason === 'low-score') {
      msg = '候选版本都不匹配';
      hint = `找到 ${L.candidateCount || 0} 个候选，但标题/歌手/时长分数偏低（最高 ${Math.round((L.bestScore || 0) * 100)} 分）`;
    } else if (L.reason === 'no-source') {
      msg = '没有找到歌词';
      hint = '所有歌词源都没有返回可用结果；可以换个视频版本或稍后重试';
    } else if (L.reason === 'rate-limited') {
      msg = '歌词源暂时风控';
      hint = '网易云/酷狗请求过于频繁，等 30 秒左右再点“重新找”';
    } else if (L.reason === 'cid-failed') {
      msg = '无法获取视频信息';
      hint = '视频 cid 获取失败；先确认能正常播放，再重新找歌词';
    } else if (L.reason === 'no-match') {
      hint = '没有找到匹配这个版本的歌词';
    }
    const actions = [
      (L.authRequired || L.reason === 'bili-auth') ? '<button class="nt-tool" data-action="login-open">登录 B 站</button>' : '',
      L.canChoose ? `<button class="nt-tool" data-action="ly-sources">换源（${(L.candidates || []).length}）</button>` : '',
      '<button class="nt-tool" data-action="ly-import-open">导入歌词</button>',
      '<button class="nt-tool" data-action="ly-reload">重新找</button>',
      '<button class="nt-tool" data-action="ly-diag">诊断</button>'
    ].filter(Boolean).join('');
    return `<div class="nt-nolyric-box">${ICON.music}<p>${msg}</p><span>${hint}</span><div class="nt-nolyric-actions">${actions}</div></div>`;
  }
  const quality = L.quality === 'word' ? '逐字' : (L.quality === 'line' ? '行级' : '');
  const off = (Number(L.offsetMs) || 0) / 1000;
  const lowCount = L.lines.reduce((n, l) => {
    const c = lineConfidence(l, L);
    return n + (c === 'est' || c === 'low' ? 1 : 0);
  }, 0);
  const tapPanel = App.tapSync.active ? `<div class="nt-tapsync">
    <b>打点同步</b>
    <span>第 ${Math.min(App.tapSync.idx + 1, L.lines.length)} / ${L.lines.length} 行 · 已打 ${App.tapSync.tapped ? App.tapSync.tapped.size : 0} 点 · 点歌词行可切目标</span>
    <button class="nt-tool" data-action="ly-tap-mark">打点（空格）</button>
    <button class="nt-tool" data-action="ly-tap-undo">撤销</button>
    <button class="nt-tool" data-action="ly-tap-done">完成</button>
  </div>` : '';
  const tools = `<div class="nt-tools">
    ${quality ? `<span class="nt-badge ${L.quality === 'word' ? 'word' : ''}">${quality}</span>` : ''}
    ${L.aligning ? '<span class="nt-badge">对齐中…</span>' : ''}
    ${L.alignment === 'scale-offset' ? '<span class="nt-badge word">已对齐</span>' : ''}
    ${L.alignment === 'scale-offset-low' ? '<span class="nt-badge">低置信</span>' : ''}
    ${L.locked ? '<span class="nt-badge">已锁定</span>' : ''}
    ${L.manual ? '<span class="nt-badge word">手动导入</span>' : ''}
    <button class="nt-tool" data-action="ly-offset" data-d="-0.2">−0.2s</button>
    <input class="nt-offset-input" id="ly-offset-input" value="${off.toFixed(1)}" placeholder="秒 / 分:秒" title="输入秒数，如 90 或 1:30" inputmode="decimal" autocomplete="off">
    <button class="nt-tool" data-action="ly-offset-apply">应用</button>
    <button class="nt-tool" data-action="ly-preview">试听</button>
    <button class="nt-tool" data-action="ly-offset" data-d="0.2">+0.2s</button>
    <button class="nt-tool" data-action="ly-offset-reset">归零</button>
    ${Player.S.track && Player.S.track.bvid && Player.S.track.cid ? '<button class="nt-tool" data-action="ly-estimate">估偏移</button>' : ''}
    ${!App.tapSync.active ? '<button class="nt-tool" data-action="ly-tap-start">打点</button>' : ''}
    <button class="nt-tool" data-action="ly-calibrate">校准</button>
    ${lowCount ? `<button class="nt-tool" data-action="ly-low-only">${App.lyricLowOnly ? '显示全部' : '只看低置信（' + lowCount + '）'}</button>` : ''}
    ${L.align ? '<button class="nt-tool" data-action="ly-cancel-align">取消对齐</button>' : ''}
    ${L.canChoose ? '<button class="nt-tool" data-action="ly-sources">换源</button>' : ''}
    <button class="nt-tool" data-action="ly-import-open">导入</button>
    <button class="nt-tool" data-action="ly-export-open">导出</button>
    ${L.manual ? '<button class="nt-tool" data-action="ly-manual-clear">清除手动</button>' : ''}
    ${(L.locked || L.manual) ? '<button class="nt-tool" data-action="ly-auto">恢复自动</button>' : ''}
    <button class="nt-tool" data-action="ly-diag">诊断</button>
    <button class="nt-tool" data-action="ly-reload">重新找</button>
  </div>`;
  const src = L.sourceLabel ? `<div class="nt-src">歌词来源：${esc(L.sourceLabel)}${L.locked ? ' · 已锁定' : ''}${(L.source === 'bili-cc-align' || L.alignment === 'scale-offset-low' || L.alignment === 'needs-align' || L.lines.some(l => l.ccMatched !== undefined)) ? '<span class="nt-conf-legend"><i class="cc"></i>CC匹配<i class="est"></i>估算<i class="low"></i>低置信</span>' : ''}</div>` : '';
  const lineTarget = App.lyricNudgeIdx >= 0 ? App.lyricNudgeIdx : App.lyricIdx;
  const lineOff = lineTarget >= 0 ? (Number((L.lineOffsets || {})[lineTarget]) || 0) : 0;
  const lineTools = `<div class="nt-tools nt-tools-line">
    <span class="nt-off">${lineTarget >= 0 ? '行 ' + (lineTarget + 1) + ' · ' + (lineOff > 0 ? '+' : '') + (lineOff / 1000).toFixed(1) + 's' : '点选歌词行'}</span>
    <button class="nt-tool" data-action="ly-line-offset" data-d="-0.5">行 −0.5s</button>
    <button class="nt-tool" data-action="ly-line-offset" data-d="0.5">行 +0.5s</button>
    <button class="nt-tool" data-action="ly-line-offset-reset">行归零</button>
    <button class="nt-tool" data-action="ly-line-shift-rest" data-d="-0.5">此后 −0.5s</button>
    <button class="nt-tool" data-action="ly-line-shift-rest" data-d="0.5">此后 +0.5s</button>
    <button class="nt-tool" data-action="ly-line-snap-beat">吸附节拍</button>
    ${lineTarget >= 0 && !App.tapSync.active ? '<button class="nt-tool" data-action="ly-line-edit">编辑</button>' : ''}
  </div>`;
  let warnText = '';
  if (L.alignment === 'needs-align') warnText = '现场版与原曲时长差较大，时间轴可能不准，可点“校准”按 CC → 整体偏移 → 打点处理';
  else if (L.alignment === 'scale-offset-low') warnText = '自动对齐置信度较低，建议试听后点“校准”或用 ±0.2s 微调';
  const dur = Number((Player.S.track && Player.S.track.duration) || 0);
  if (!warnText && dur && L.lines.length && Number(L.lines[0].t) >= dur) {
    warnText = `当前偏移下所有歌词都在视频结束之后（首行 ${fmt(L.lines[0].t)} / 视频 ${fmt(dur)}），请减小偏移或点“归零”`;
  } else if (!warnText && L.lines.length && Number(L.lines[L.lines.length - 1].end || 0) < 0) {
    warnText = '当前偏移下所有歌词都在视频开始之前，请增大偏移或点“归零”';
  }
  const warn = warnText ? `<div class="nt-warn">${warnText}</div>` : '';
  const body = L.lines.map((l, i) => {
    const ld = Number((L.lineOffsets || {})[i]) || 0;
    const conf = lineConfidence(l, L);
    const lowConf = conf === 'est' || conf === 'low';
    const confTitle = conf === 'cc' ? '本视频 CC 直接匹配' : conf === 'est' ? 'CC 未覆盖，按中位偏移估算；点击可定位' : conf === 'low' ? '自动对齐置信度低，建议打点校准；点击可定位' : '';
    const confHtml = conf ? `<span class="nt-conf ${conf}" data-action="ly-conf-jump" data-li="${i}" title="${confTitle}"></span>` : '';
    return `<p class="nt-line ${lowConf ? 'low-conf' : ''} ${i === App.lyricIdx ? 'active' : ''} ${i === App.lyricNudgeIdx ? 'selected' : ''} ${App.tapSync.active && i === App.tapSync.idx ? 'tapsync-target' : ''}" data-li="${i}" data-action="ly-line">${lyricLineHtml(l)}${confHtml}${l.translation ? `<span class="nt-trans">${esc(l.translation)}</span>` : ''}${ld ? `<span class="nt-line-off">${ld > 0 ? '+' : ''}${(ld / 1000).toFixed(1)}s</span>` : ''}</p>`;
  }).join('');
  return `${tapPanel}${tools}${lineTools}${warn}<div class="nt-lyrics${App.lyricLowOnly ? ' low-only' : ''}">${body}</div>${src}`;
}
/* 歌词时间轴自动校正：外部LRC（网易云/LRCLIB/借用字幕）的时间轴是别的版本排的——
   用视频自身的onset包络与歌词行位置做(偏移×缩放)互相关搜索，把时间轴拉回本视频 */
async function syncLyricTimeline(bvid, cid, lines, videoDur, refDuration) {
  try {
    if (!lines || lines.length < 4) return null;
    const ch = await chromaOf({ bvid, cid });
    const h = ch.hopSec, onset = ch.onset;
    const nV = onset.length;
    const sm = (arr, rSec) => {
      const r = Math.max(1, Math.round(rSec / h));
      const o = new Float32Array(arr.length);
      for (let i = 0; i < arr.length; i++) {
        let s2 = 0, c = 0;
        for (let k = -r; k <= r; k++) { const idx = i + k; if (idx >= 0 && idx < arr.length) { s2 += arr[idx]; c++; } }
        o[i] = s2 / c;
      }
      return o;
    };
    const onSm = sm(onset, 0.35);
    const use = lines.filter(l => l.t >= 2);
    if (use.length < 3) return null;
    const scoreAt = off => {
      let s2 = 0, c = 0;
      for (const l of use) {
        const idx = Math.round((l.t + off) / h);
        if (idx >= 0 && idx < nV) { s2 += onSm[idx]; c++; }
      }
      return c >= Math.max(3, Math.floor(use.length * 0.5)) ? s2 / c : -1;
    };
    // 物理候选：0（无需偏移）/ 前置差（视频时长-录音室时长）/ 折中——onset打分只负责在候选间选择+±3秒精修
    const cand = [0];
    const diff = (videoDur || 0) - (refDuration || 0);
    if (Math.abs(diff) > 1.5) { cand.push(diff); cand.push(diff / 2); }
    const s0 = scoreAt(0);
    let best = { score: s0, off: 0 };
    for (const c0 of cand) {
      for (let fine = -3; fine <= 3.01; fine += 0.2) {
        const off = c0 + fine;
        const sc = scoreAt(off);
        if (sc > best.score) best = { score: sc, off };
      }
    }
    // 置信：相对零偏移有明确改善才动时间轴
    if (best.off === 0) return null;
    if (best.score < s0 * 1.1 && best.score - s0 < 0.03) return null;
    return lines.map(l => ({
      t: Math.max(0, Math.round((l.t + best.off) * 100) / 100),
      end: l.end > 0 ? Math.max(0, Math.round((l.end + best.off) * 100) / 100) : l.end,
      text: l.text
    }));
  } catch (e) { return null; }
}
/* 现场版对齐：在 onset 包络上搜索 t -> t*scale+offset，把外部 LRC 拉到本视频的演唱进度。
   只接受相对 (1,0) 有明确改善的结果；失败保留“现场版待校准”，交给手动校准。 */
async function alignLyricTimeline(bvid, cid, lines, videoDur, refDuration) {
  try {
    if (!bvid || !cid || !lines || lines.length < 6) return null;
    const ch = await chromaOf({ bvid, cid });
    const h = ch && ch.hopSec;
    const onset = ch && ch.onset;
    if (!(h > 0) || !onset || onset.length < 20) return null;
    const nV = onset.length;
    const rad = Math.max(1, Math.round(0.35 / h));
    const onSm = new Float32Array(nV);
    for (let i = 0; i < nV; i++) {
      let s = 0, c = 0;
      for (let k = -rad; k <= rad; k++) {
        const j = i + k;
        if (j >= 0 && j < nV) { s += onset[j]; c++; }
      }
      onSm[i] = c ? s / c : 0;
    }
    const vd = Number(videoDur) || 0;
    const use = lines.filter(l => Number(l.t) >= 0.8 && (!vd || Number(l.t) < vd));
    if (use.length < 4) return null;
    const scoreAt = (scale, off) => {
      let sum = 0, c = 0;
      for (const l of use) {
        const tt = Number(l.t) * scale + off;
        if (tt < 0 || (vd && tt > vd)) continue;
        const idx = Math.round(tt / h);
        if (idx >= 0 && idx < nV) { sum += onSm[idx]; c++; }
      }
      return c >= Math.max(3, Math.floor(use.length * 0.55)) ? sum / c : -1;
    };
    const s0 = scoreAt(1, 0);
    if (!(s0 > 0)) return null;
    const diff = (vd && refDuration) ? vd - refDuration : 0;
    const scales = new Set([1]);
    /* 不能只用 视频时长/参考时长 附近：现场常常是“前奏更长 + 唱得更快”，
       比例会落到 0.8~1.2 的任意位置，直接全区间粗搜。 */
    for (let s = 0.82; s <= 1.18 + 1e-9; s += 0.01) scales.add(+s.toFixed(3));
    const centers = [0];
    if (Math.abs(diff) > 1.5) centers.push(diff);
    const offs = new Set();
    for (const c0 of centers) {
      for (let o = -18; o <= 18 + 1e-9; o += 0.5) offs.add(+(c0 + o).toFixed(2));
    }
    let best = { scale: 1, off: 0, score: s0 };
    for (const sc of scales) {
      for (const off of offs) {
        const v = scoreAt(sc, off);
        if (v > best.score) best = { scale: sc, off, score: v };
      }
    }
    for (let sc = best.scale - 0.012; sc <= best.scale + 0.012 + 1e-9; sc += 0.002) {
      for (let off = best.off - 1; off <= best.off + 1 + 1e-9; off += 0.1) {
        const v = scoreAt(sc, off);
        if (v > best.score) best = { scale: +sc.toFixed(4), off: +off.toFixed(2), score: v };
      }
    }
    if (best.scale < 0.82 || best.scale > 1.18) return null;
    if (!(best.score > s0 * 1.06 && best.score - s0 > 0.015)) return null;
    const map = t => {
      const x = (Number(t) || 0) * best.scale + best.off;
      return Math.max(0, vd ? Math.min(vd, x) : x);
    };
    const out = lines.map(l => {
      const n = Object.assign({}, l, { t: map(l.t), end: map(l.end) });
      if (!(n.end > n.t)) n.end = n.t + 0.8;
      if (Array.isArray(l.words)) {
        n.words = l.words.map(w => {
          const t = map(w.t);
          let e = map(w.end);
          if (!(e > t)) e = t + 0.05;
          return Object.assign({}, w, { text: w.text, t, end: e });
        });
      }
      return n;
    }).filter(l => !vd || l.t < vd - 0.05);
    if (out.length < 4) return null;
    for (let i = 1; i < out.length; i++) if (out[i].t + 0.001 < out[i - 1].t) return null;
    const conf = Math.max(0, Math.min(1, (best.score - s0) / Math.max(best.score, 1e-6)));
    return {
      lines: out,
      scale: +best.scale.toFixed(4),
      offset: +best.off.toFixed(2),
      score: +best.score.toFixed(4),
      baseline: +s0.toFixed(4),
      confidence: +conf.toFixed(2)
    };
  } catch (e) { return null; }
}
async function maybeAlignLiveLyrics(t, d, token) {
  const L = state.lyrics;
  if (!L || L.noAutoAlign || Number(L.offsetMs) || L.alignment !== 'needs-align' || !t.bvid || !t.cid) return;
  const ak = (L.cacheKey || L.key) + '|' + Math.round(d.refDuration || 0) + '|' + Math.round(t.duration || 0);
  if (!App._alignTried) App._alignTried = new Set();
  if (App._alignTried.has(ak)) return;
  App._alignTried.add(ak);
  L.aligning = true;
  if (state.view.name === 'nowplaying' && state.npInfoTab === 'lyric') renderView();
  try {
    const userOff = Number(L.offsetMs) || 0;
    let base = userOff ? shiftLyricLinesRaw(L.lines, -userOff / 1000) : L.lines;
    base = removeLineOffsets(base, L.lineOffsets || {});
    const r = await alignLyricTimeline(t.bvid, t.cid, base, Number(t.duration) || 0, Number(d.refDuration) || 0);
    if (token !== App.lyricsToken || state.lyrics !== L) return;
    if (!r) return;
    L.preAlign = L.lines.map(l => Object.assign({}, l, {
      words: Array.isArray(l.words) ? l.words.map(w => Object.assign({}, w)) : undefined
    }));
    L.preAlignBase = L.baseLines;
    L.baseLines = r.lines;
    L.lines = applyLineOffsets(userOff ? shiftLyricLinesRaw(r.lines, userOff / 1000) : r.lines, L.lineOffsets || {});
    const low = Number(r.confidence) < 0.4;
    L.alignment = low ? 'scale-offset-low' : 'scale-offset';
    L.align = { scale: r.scale, offset: r.offset, confidence: r.confidence };
    L.sourceLabel = String(L.sourceLabel || '')
      .replace(/ · 现场版待校准/g, '')
      .replace(/ · 已按现场节奏对齐/g, '')
      .replace(/ · 自动对齐置信度低/g, '')
      + (low ? ' · 自动对齐置信度低' : ' · 已按现场节奏对齐');
    Api.post('lyrics/align', { key: L.cacheKey || L.key, scale: r.scale, offset: r.offset, confidence: r.confidence }).catch(() => {});
    if (window.FoliaBridge) FoliaBridge.refresh();
    if (window.LyricMV && LyricMV.refreshLine) LyricMV.refreshLine();
    if (state.view.name === 'nowplaying' && state.npInfoTab === 'lyric') renderView();
    syncLyricHighlight(true);
    syncMVSubtitle();
    try { toast(low ? '现场歌词已自动对齐（置信度较低，可手动校准）' : '歌词已按现场节奏对齐', low ? '' : 'success'); } catch (e) {}
  } catch (e) {
    console.warn('[lyrics] 现场对齐失败', e && e.message || e);
  } finally {
    if (state.lyrics === L) L.aligning = false;
    if (state.view.name === 'nowplaying' && state.npInfoTab === 'lyric') renderView();
  }
}
function prefetchNextLyrics() {
  const q = Player.S.queue || [];
  const next = q[Player.S.index + 1];
  if (!next || (!next.bvid && !next.nid)) return;
  const key = next.nid ? ('n' + next.nid) : (next.bvid + '|' + (next.cid || ''));
  if (App._lyricPrefetchKey === key) return;
  App._lyricPrefetchKey = key;
  setTimeout(() => {
    Api.get('lyrics', {
      bvid: next.bvid || '', cid: next.cid || '', nid: next.nid || '',
      title: next.title || next.name || '', artist: next.up || next.artist || '',
      duration: next.duration || 0
    }).catch(() => {});
  }, 1500);
}
async function loadLyricsIfNeeded(force) {
  const t = Player.S.track;
  if (!t) return;
  const pendingKey = t.nid ? ('n' + t.nid) : (t.bvid ? (t.bvid + '|') : '');
  if (!pendingKey) return;
  if (!t.cid && !t.nid) {
    /* B 站条目刚切过来时 cid 还没解析：先清掉上一首歌词，补 cid 后再加载 */
    if (force || !state.lyrics || state.lyrics.key !== pendingKey) {
      const token = ++App.lyricsToken;
      state.lyrics = { key: pendingKey, lines: null, loading: true, pendingCid: true };
      App.lyricNudgeIdx = -1;
      App.lyricLowOnly = false;
      App.tapSync.active = false;
      App.tapSync.snapshots = [];
      if (App.tapSync.tapped) App.tapSync.tapped.clear();
      App._lyricScrollHold = 0;
      App.mv.segments = null;
      App.mv.segmentsKey = '';
      App.mv.bpmInfo = null;
      clearTimeout(App.mv.segTimer);
      clearTimeout(App.mv.bpmTimer);
      if (window.LyricMV && LyricMV.setBpm) LyricMV.setBpm(null);
      if (state.view.name === 'nowplaying' && state.npInfoTab === 'lyric') renderView();
      if (App._lyricCidFor !== t.bvid || Date.now() - (App._lyricCidAt || 0) > 10000) {
        App._lyricCidFor = t.bvid;
        App._lyricCidAt = Date.now();
        Player.ensureCid(t).then(() => {
          if (App._lyricCidFor === t.bvid) { App._lyricCidFor = ''; App._lyricCidAt = 0; }
          if (Player.S.track === t && t.cid && token === App.lyricsToken) loadLyricsIfNeeded(force);
        }).catch(() => {
          if (App._lyricCidFor === t.bvid) { App._lyricCidFor = ''; App._lyricCidAt = 0; }
          if (Player.S.track === t && token === App.lyricsToken) {
            state.lyrics = { key: pendingKey, lines: [], loading: false, reason: 'cid-failed' };
            if (state.view.name === 'nowplaying' && state.npInfoTab === 'lyric') renderView();
          }
        });
      }
    }
    return;
  }
  const key = t.nid ? ('n' + t.nid) : (t.bvid + '|' + t.cid);
  if (!force && state.lyrics && state.lyrics.key === key) return;
  const token = ++App.lyricsToken;
  state.lyrics = { key, lines: null, loading: true };
  App.lyricNudgeIdx = -1;
  App.lyricLowOnly = false;
  App.tapSync.active = false;
  App.tapSync.snapshots = [];
  if (App.tapSync.tapped) App.tapSync.tapped.clear();
  App._lyricScrollHold = 0;
  App.mv.segments = null;
  App.mv.segmentsKey = '';
  App.mv.bpmInfo = null;
  clearTimeout(App.mv.segTimer);
  clearTimeout(App.mv.bpmTimer);
  if (window.LyricMV && LyricMV.setBpm) LyricMV.setBpm(null);
  if (state.view.name === 'nowplaying' && state.npInfoTab === 'lyric') renderView();
  try {
    let d = null;
    try {
      d = await Api.get('lyrics', {
        bvid: t.bvid, cid: t.cid, nid: t.nid,
        title: t.title || t.name || '', artist: t.up || t.artist || '',
        duration: t.duration || 0
      });
    } catch (e) { d = null; }
    let lines;
    const v2 = !!(d && (d.quality || d.candidates || d.source || d.reason));
    if (v2) {
      lines = d.lines || [];
    } else {
      /* 旧服务/旧缓存兜底：保持原链路 */
      d = t.nid
        ? await Api.get('nlyric', { id: t.nid, title: t.title || t.name || '', artist: t.up || '', dur: t.duration || 0 })
        : await Api.get('subtitle', { bvid: t.bvid, cid: t.cid });
      lines = d.lines || [];
      // 外部来源（借用/网易云/LRCLIB）的时间轴是别的版本排的：自动校正到本视频
      const srcLabel = d.sourceLabel || '';
      if (lines.length >= 4 && srcLabel && !srcLabel.includes('本视频') && !t.nid) {
        try {
          const fixed = await syncLyricTimeline(t.bvid, t.cid, lines, t.duration, d.refDuration);
          if (fixed) { lines = fixed; d.sourceLabel += ' · 已自动对齐时间轴'; }
        } catch (e) {}
      }
    }
    if (token !== App.lyricsToken) return;
    const serverOff = Number(d.offsetMs) || 0;
    let localRaw = null;
    try { localRaw = localStorage.getItem('bp.lyricOffset.' + key); } catch (e) {}
    const hasLocal = localRaw !== null;
    let localOff = Number(localRaw) || 0;
    localOff = Math.max(-600000, Math.min(600000, localOff));
    /* 本机记录优先：服务端写入可能被旧请求覆盖/竞态，localStorage 是同步写 */
    const useOff = hasLocal ? localOff : serverOff;
    const rawLines = serverOff ? shiftLyricLinesRaw(lines, -serverOff / 1000) : lines;
    const localLineOffsets = loadLineOffsets(key);
    let lineTomb = false;
    try { lineTomb = localStorage.getItem('bp.lyricLineOffsetsCleared.' + key) === '1'; } catch (e) {}
    const lineOffsets = (Object.keys(localLineOffsets).length || lineTomb)
      ? localLineOffsets
      : Object.assign({}, d.lineOffsets || {});
    if (!Object.keys(localLineOffsets).length && !lineTomb && Object.keys(lineOffsets).length) {
      try { localStorage.setItem('bp.lyricLineOffsets.' + key, JSON.stringify(lineOffsets)); } catch (e) {}
    } else if (Object.keys(localLineOffsets).length && !Object.keys(d.lineOffsets || {}).length) {
      /* 旧版本只存了 localStorage：首次加载时迁移到服务端 */
      syncLineOffsetsToServer(key, localLineOffsets, d.key || key);
    }
    const linesForState = applyLineOffsets(useOff ? shiftLyricLinesRaw(rawLines, useOff / 1000) : rawLines, lineOffsets);
    if (!hasLocal) {
      try { localStorage.setItem('bp.lyricOffset.' + key, String(serverOff)); } catch (e) {}
    }
    state.lyrics = {
      key, cacheKey: d.key || key, lines: linesForState, loading: false,
      sourceLabel: d.sourceLabel || '',
      source: d.source || '',
      quality: d.quality || '',
      alignment: d.alignment || '',
      offsetMs: useOff,
      lineOffsets,
      refDuration: Number(d.refDuration) || 0,
      candidates: d.candidates || [],
      canChoose: !!d.canChoose,
      locked: !!d.locked,
      manual: !!d.manual,
      stats: d.stats || null,
      authRequired: !!d.authRequired,
      instrumental: !!d.instrumental,
      reason: d.reason || '',
      bestScore: Number(d.bestScore) || 0,
      candidateCount: Number(d.candidateCount) || 0
    };
    state.lyrics.baseLines = rawLines;
    prefetchNextLyrics();
    if (hasLocal && localOff !== serverOff) {
      saveLyricOffset(d.key || key, useOff);
    }
    if (!useOff && d.alignment === 'needs-align' && t.bvid && t.cid && lines.length >= 6) {
      setTimeout(() => maybeAlignLiveLyrics(t, d, token), 500);
    }
    if (window.FoliaBridge) FoliaBridge.refresh();
    syncMVSubtitle();
    syncMVInstrumental();
    maybeLoadAiTheme(true);
    clearTimeout(App.mv.segTimer);
    App.mv.segTimer = setTimeout(() => maybeLoadAiSegments(true), 600);
    App.mv.bpmTimer = setTimeout(() => maybeLoadBpm(true), 1500);
  } catch (e) {
    if (token !== App.lyricsToken) return;
    state.lyrics = { key, lines: [], loading: false };
  }
  App.lyricIdx = -1;
  if (state.view.name === 'nowplaying' && state.npInfoTab === 'lyric') {
    renderView();
    syncLyricHighlight(true);
  }
}
/* 歌词当前行高亮 + 自动滚动（用户滚动手势后 5 秒内不抢，期间显示“回到当前句”） */
/* MV 翻译/罗马音：独立于各 Folia/vendor 运行时，统一显示在当前句下方 */
function syncMVSubtitle() {
  const el = document.getElementById('mv-subtitle');
  if (!el) return;
  const on = !!(App.mv.on && (App.mv.subTrans || App.mv.subRoma) && state.view.name === 'nowplaying'
    && Player.S.mode !== 'video' && state.lyrics && state.lyrics.lines && state.lyrics.lines.length);
  if (!on) { el.classList.remove('show'); el.dataset.txt = ''; return; }
  let cur = 0;
  try { cur = Player.activeEl().currentTime || 0; } catch (e) {}
  const lines = state.lyrics.lines;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) if (Number(lines[i].t) <= cur + 0.25) idx = i;
  if (idx < 0) { el.classList.remove('show'); el.dataset.txt = ''; return; }
  const line = lines[idx];
  const trans = App.mv.subTrans && line.translation ? String(line.translation) : '';
  const roma = App.mv.subRoma && line.romanization ? String(line.romanization) : '';
  const txt = trans || roma;
  if (!txt) { el.classList.remove('show'); el.dataset.txt = ''; return; }
  if (el.dataset.txt !== txt) {
    el.dataset.txt = txt;
    el.innerHTML = (trans ? `<span class="mv-sub-trans">${esc(trans)}</span>` : '') +
      (roma ? `<span class="mv-sub-roma">${esc(roma)}</span>` : '');
  }
  el.classList.add('show');
}
/* 纯音乐/无歌词行：Folia 运行时没有内容，切到旧动态背景 + 音符层，避免空黑 */
function syncMVInstrumental() {
  const on = !!(App.mv.on && state.view.name === 'nowplaying'
    && state.lyrics && state.lyrics.instrumental);
  document.body.classList.toggle('mv-instrumental', on);
  if (on && window.LyricMV && LyricMV.resize) LyricMV.resize();
}
function syncLyricHighlight(force) {
  if (!document.body.classList.contains('immersive')) return;
  if (state.npInfoTab !== 'lyric' || !state.lyrics || !state.lyrics.lines || !state.lyrics.lines.length) return;
  const cur = Player.activeEl().currentTime || 0;
  const lines = state.lyrics.lines;
  let act = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].t <= cur + 0.25) act = i;
  if (act === App.lyricIdx && !force) return;
  App.lyricIdx = act;
  const wrap = document.getElementById('nt-body');
  if (!wrap) return;
  wrap.querySelectorAll('.nt-line').forEach(el => el.classList.toggle('active', +el.dataset.li === act));
  if (force || Date.now() > (App._lyricScrollHold || 0)) {
    const el = wrap.querySelector('.nt-line.active');
    if (el) {
      /* Electron 里 scrollIntoView({behavior:'smooth'}) 在滚动容器内会失效，直接算 scrollTop */
      const target = el.offsetTop - wrap.clientHeight / 2 + el.offsetHeight / 2;
      wrap.scrollTop = Math.max(0, Math.min(wrap.scrollHeight - wrap.clientHeight, target));
    }
  }
}
/* 用户滚走后：5 秒无操作自动跳回当前句；或点“回到当前句”立即跳回 */
function markLyricUserScroll() {
  App._lyricScrollHold = Date.now() + 5000;
  const btn = document.getElementById('lyric-back');
  if (btn) btn.classList.add('show');
  clearTimeout(App._lyricSnapTimer);
  App._lyricSnapTimer = setTimeout(() => snapToActiveLyric(), 5000);
}
function snapToActiveLyric() {
  clearTimeout(App._lyricSnapTimer);
  App._lyricScrollHold = 0;
  const btn = document.getElementById('lyric-back');
  if (btn) btn.classList.remove('show');
  App.lyricIdx = -1;
  syncLyricHighlight(true);
}
/* 简介缺失时补拉视频信息 */
function fetchTrackDesc() {
  const t = Player.S.track;
  if (!t || t.descFetched) return;
  t.descFetched = true;
  Api.get('video', { bvid: t.bvid }).then(d => {
    if (Player.S.track === t && !t.desc) t.desc = d.desc || '';
    if (state.view.name === 'nowplaying' && Player.S.mode !== 'video' && state.npInfoTab === 'intro') renderView();
  }).catch(() => {});
}
function setupNowplayingAudio() {
  if (!Player.S.track) return;
  fetchTrackDesc();
  loadLyricsIfNeeded();
  const body = document.getElementById('nt-body');
  if (body) {
    // 只把明确的用户手势当作“用户在浏览歌词”，程序自动滚动不算
    body.addEventListener('wheel', markLyricUserScroll, { passive: true });
    body.addEventListener('touchmove', markLyricUserScroll, { passive: true });
    body.addEventListener('pointerdown', markLyricUserScroll);
    body.addEventListener('scroll', () => {
      const btn = document.getElementById('lyric-back');
      if (btn) btn.classList.toggle('show', Date.now() < (App._lyricScrollHold || 0));
    }, { passive: true });
  }
}

/* ---- 评论区 ---- */
function fmtDate(t) {
  const d = new Date(t * 1000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function cmtHtml(c, isSub) {
  const subs = (!isSub && c.sub && c.sub.length)
    ? `<div class="c-subs">${c.sub.map(s => cmtHtml(s, true)).join('')}</div>` : '';
  return `<div class="cmt ${isSub ? 'cmt-subitem' : ''}">
    <img src="${esc(pic(c.face))}" loading="lazy" onerror="this.style.visibility='hidden'">
    <div class="c-main">
      <div class="c-head"><span class="c-name">${esc(c.name)}</span><span class="c-time">${fmtDate(c.time)}</span></div>
      <div class="c-msg">${esc(c.msg)}</div>
      ${c.like ? `<div class="c-like">${ICON.like} ${nfmt(c.like)}</div>` : ''}
      ${subs}
    </div>
  </div>`;
}
function commentsBody() {
  const r = state.replies;
  if (!r || r.needAid) return emptyState('正在获取视频信息…');
  if (r.loading && !r.items.length) return emptyState('加载评论中…');
  if (!r.items.length) return emptyState('还没有评论');
  return `<div class="cmt-total">共 ${nfmt(r.total)} 条评论</div>` +
    r.items.map(c => cmtHtml(c, false)).join('') +
    (r.hasMore ? `<div class="load-more-wrap"><button class="btn" data-action="reply-more">${r.loading ? '加载中…' : '加载更多评论'}</button></div>` : '');
}
async function loadRepliesIfNeeded(force) {
  const aid = Player.S.track && Player.S.track.aid;
  if (!aid) return; // aid 尚未解析出来，等 onChange 下一拍再试
  if (!force && state.replies && state.replies.aid === aid) return; // 已是该视频的评论
  if (state.replies && state.replies.loading && state.replies.aid === aid) return; // 正在加载中
  const token = ++App.replyToken; // 防止快速切歌时旧响应覆盖新评论
  state.replies = { aid, items: [], total: 0, pn: 0, hasMore: true, loading: true };
  if (state.view.name === 'nowplaying' && state.npqTab === 'reply') renderView();
  try {
    const d = await Api.get('reply', { aid, pn: 1 });
    if (token !== App.replyToken) return;
    state.replies = { aid, items: d.items, total: d.total, pn: 1, hasMore: d.items.length >= 20, loading: false };
  } catch (e) {
    if (token !== App.replyToken) return;
    state.replies.loading = false;
    state.replies.hasMore = false;
    errToast(e);
  }
  if (state.view.name === 'nowplaying' && state.npqTab === 'reply') renderView();
}
async function loadMoreReplies() {
  const r = state.replies;
  if (!r || !r.hasMore || r.loading) return;
  r.loading = true;
  if (state.view.name === 'nowplaying') renderView();
  try {
    const d = await Api.get('reply', { aid: r.aid, pn: r.pn + 1 });
    r.items = r.items.concat(d.items);
    r.pn++;
    r.total = d.total;
    r.hasMore = d.items.length >= 20;
  } catch (e) { r.hasMore = false; errToast(e); }
  r.loading = false;
  if (state.view.name === 'nowplaying') renderView();
}

/* ---------- 播放控制 ---------- */
function playFromItems(idx) {
  const items = state.currentItems.filter(it => it && (it.bvid || it.nid));
  if (!items.length || idx >= state.currentItems.length || idx < 0) return;
  const queue = state.currentItems.map(it => Object.assign({}, it, { title: stripEm(it.title) }));
  Player.setQueue(queue, idx);
  Player.S.source = state.currentItems;
  state.miniClosed = false;
  Player.playCurrent().catch(() => {});
}

function updatePlayingMarks() {
  const S = Player.S;
  const isSource = S.source === state.currentItems;
  $$('#view .card').forEach(el => el.classList.toggle('playing', isSource && +el.dataset.idx === S.index));
  $$('#view .prow').forEach(el => {
    const it = state.currentItems[+el.dataset.idx];
    const hit = !!(S.track && it && ((it.nid && it.nid === S.track.nid) || (it.bvid && it.bvid === S.track.bvid)));
    el.classList.toggle('playing', hit);
  });
}

/* ---------- 底部播放条 ---------- */
function bindPlayerBar() {
  if (!document.getElementById('dm-heat')) {
    const hc = document.createElement('canvas');
    hc.id = 'dm-heat';
    const tr = document.getElementById('pb-track');
    if (tr) tr.appendChild(hc);
  }
  $('#pb-play').innerHTML = ICON.play;
  $('#pb-prev').innerHTML = ICON.prev;
  $('#pb-next').innerHTML = ICON.next;
  $('#pb-queue').innerHTML = ICON.queue;
  $('#pb-mode-audio').innerHTML = ICON.headphone;
  $('#pb-mode-video').innerHTML = ICON.film;
  $('#pb-volico').innerHTML = ICON.vol;
  $('#pb-playmode').innerHTML = ICON.loop;
  $('#pb-vizset').innerHTML = ICON.palette;
  const pbWidget = $('#pb-widget'), pbLyric = $('#pb-desklyric');

  if (pbWidget) { pbWidget.innerHTML = ICON.tv; pbWidget.title = '迷你播放器（点击开关）'; pbWidget.onclick = () => toggleDeskWidget('widget'); }
  if (pbLyric) { pbLyric.innerHTML = ICON.music; pbLyric.title = '桌面歌词（点击开关）'; pbLyric.onclick = () => toggleDeskWidget('desk-lyrics'); }
  const pbHeart = $('#pb-heart'), pbRoam = $('#pb-roam');
  if (pbHeart) { pbHeart.innerHTML = ICON.heart; pbHeart.onclick = () => toggleHeart(); }
  if (pbRoam) { pbRoam.innerHTML = ICON.roam; pbRoam.onclick = () => startRoam(); }
  heartUI(); updateRoamUI();
  $('#pb-vizset').addEventListener('click', openVizSettings);

  $('#pb-play').addEventListener('click', () => Player.toggle());
  $('#pb-prev').addEventListener('click', () => Player.step(-1).catch(() => {}));
  $('#pb-next').addEventListener('click', () => Player.step(1).catch(() => {}));
  $('#pb-playmode').addEventListener('click', () => {
    const order = ['list', 'one', 'random'];
    const next = order[(order.indexOf(Player.S.playmode) + 1) % 3];
    Player.setPlaymode(next);
    toast(next === 'list' ? '列表循环' : next === 'one' ? '单曲循环' : '随机播放');
  });
  $('#pb-mode-audio').addEventListener('click', () => Player.setMode('audio'));
  $('#pb-mode-video').addEventListener('click', async () => {
    state.miniClosed = false;
    await Player.setMode('video');
    go('nowplaying');
  });
  $('#pb-queue').addEventListener('click', () => toggleQueuePop());
  const vr = $('#pb-volrange');
  vr.addEventListener('input', () => { Player.setVolume(vr.value / 100); AudioFX.setVolume(vr.value / 100); updateVolumeIcon(); });

  // 进度条拖动
  const track = $('#pb-track');
  const seekTo = e => {
    const r = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    Viz.progress = ratio;
    Player.seek(ratio * (Player.activeEl().duration || 0));
  };
  track.addEventListener('pointerdown', e => {
    App._scrubbing = true;
    seekTo(e);
    const mv = ev => seekTo(ev);
    const up = () => { App._scrubbing = false; window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  });
}

function updateVolumeIcon() {
  const v = Player.volume();
  $('#pb-volrange').value = Math.round(v * 100);
}

function updateBar(S) {
  syncImmersive();
  const bar = $('#playerbar');
  if (!S.track) { bar.classList.add('hidden'); $('#pb-toggle').classList.add('hidden'); document.body.classList.remove('pb-on'); vizTick(); return; }
  bar.classList.remove('hidden');
  $('#pb-toggle').classList.remove('hidden');
  document.body.classList.add('pb-on');
  const el = Player.activeEl();
  const coverUrl = pic(S.track.pic) || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"%3E%3Crect fill="%23f0f0f0" width="24" height="24"/%3E%3C/svg%3E';
  if ($('#pb-cover').getAttribute('src') !== coverUrl) $('#pb-cover').src = coverUrl;
  $('#pb-title').textContent = S.track.title || '';
  $('#pb-up').textContent = S.track.up || '';
  const playBtn = $('#pb-play');
  playBtn.innerHTML = S.playing ? ICON.pause : ICON.play;
  playBtn.classList.toggle('loading', !!S.loading);
  const dur = isFinite(el.duration) && el.duration > 0 ? el.duration : (S.track.duration || 0);
  const cur = el.currentTime || (el.src ? 0 : (S.resumeAt || 0)); // 恢复的会话还没加载媒体，显示上次进度
  if (!App._scrubbing) {
    Viz.progress = dur ? cur / dur : 0;
    $('#pb-line-fill').style.width = (Viz.progress * 100) + '%';
    $('#pb-thumb').style.left = (Viz.progress * 100) + '%';
    $('#pb-cur').textContent = fmt(cur);
    $('#pb-dur').textContent = fmt(dur);
  }
  vizTick();
  if (DM.buckets) drawDmHeat(); // 进度条热力图随窗口尺寸/配色刷新
  const pmIcons = { list: ICON.loop, one: ICON.one, random: ICON.shuffle };
  const pmTitles = { list: '列表循环', one: '单曲循环', random: '随机播放' };
  const pmBtn = $('#pb-playmode');
  pmBtn.innerHTML = pmIcons[S.playmode];
  pmBtn.title = pmTitles[S.playmode];
  $('#pb-mode-audio').classList.toggle('active', S.mode === 'audio');

  $('#pb-mode-video').classList.toggle('active', S.mode === 'video');
  const stage = document.getElementById('np-stage');
  if (stage) stage.classList.toggle('is-playing', !!S.playing);
  syncImmersive();
  syncLyricHighlight();

  // 全屏控制层同步
  const ovlTrack = $('#np-ovl-track');
  if (ovlTrack) {
    if (!App._scrubbing) {
      const pct = dur ? (cur / dur * 100) : 0;
      $('#np-ovl-fill').style.width = pct + '%';
      $('#np-ovl-thumb').style.left = pct + '%';
      $('#np-ovl-time').textContent = fmt(cur) + ' / ' + fmt(dur);
    }
    $('#np-ovl-play').innerHTML = S.playing ? ICON.pause : ICON.play;
  }
}

function updateVideoMount() {
  const S = Player.S;
  const mini = $('#mini-video');
  if (S.mode !== 'video' || !S.track || state.miniClosed) {
    mini.classList.add('hidden');
    Player.unmountVideo();
    return;
  }
  if (state.view.name === 'nowplaying') {
    mini.classList.add('hidden');
    const m = $('#np-video');
    if (m) Player.mountVideo(m); else Player.unmountVideo();
  } else {
    mini.classList.remove('hidden');
    Player.mountVideo($('#mini-box'));
  }
}

/* ---------- 队列浮层 ---------- */
function toggleQueuePop() {
  if (closePops()) return;
  const S = Player.S;
  if (!S.queue.length) { toast('播放队列是空的'); return; }
  popRoot().innerHTML = `<div class="queuepop">
    <div class="npq-head">播放队列 <span>${S.queue.length} 首 · <button class="mini-btn" data-action="queue-clear">清空</button></span></div>
    <div class="npq-list">${S.queue.map((it, i) => `
      <div class="qrow ${i === S.index ? 'playing' : ''}" data-action="queue-jump" data-idx="${i}">
        <div class="q-idx">${i === S.index ? '▶' : i + 1}</div>
        <img src="${esc(pic(it.pic))}" loading="lazy" onerror="this.style.visibility='hidden'">
        <div class="q-main"><div class="q-title">${esc(it.title)}</div><div class="q-up">${esc(it.up)}${it.rec ? `<span class="q-rec ${it.rec}">${it.rec === 'heart' ? '💗心动' : '🧭漫游'}</span>` : ''}</div></div>
        <div class="q-dur">${fmt(it.duration)}</div>
        <button class="p-del" style="opacity:1" data-action="queue-remove" data-idx="${i}">${ICON.close}</button>
      </div>`).join('')}</div>
  </div>`;
  $('#mini-video').classList.add('hidden'); // 避免与队列浮层重叠
}
function stopPlayback() {
  const S = Player.S;
  try { Player.audio.pause(); Player.video.pause(); } catch {}
  Player.audio.removeAttribute('src');
  Player.video.removeAttribute('src');
  S.queue = []; S.index = -1; S.track = null; S.source = null; S.playing = false;
  updateBar(S);
  updateVideoMount();
  renderView();
}

/* ---------- 加入歌单浮层 ---------- */
function openPlPop(anchor, items) {
  items = items.filter(Boolean);
  if (!items.length) return;
  App.popItems = items;
  const inPl = pl => items.every(it => pl.items.some(x => x.bvid === it.bvid));
  popRoot().innerHTML = `<div class="plpop">
    <div class="plpop-head">加入歌单（已选 ${items.length} 个视频）</div>
    ${state.playlists.length ? state.playlists.map(pl => `
      <div class="plpop-item ${inPl(pl) ? 'inpl' : ''}" data-action="import-to" data-pl="${pl.id}">
        ${ICON.music}<span>${esc(pl.name)}</span><em>${inPl(pl) ? '✓ 已在内' : pl.items.length + ' 首'}</em>
      </div>`).join('') : `<div class="plpop-empty">还没有歌单，在下面新建一个吧</div>`}
    <div class="plpop-new"><input id="plpop-newname" placeholder="新歌单名称" maxlength="40"><button data-action="import-new">创建并加入</button></div>
  </div>`;
  const pop = popRoot().firstElementChild;
  const r = anchor.getBoundingClientRect();
  let left = Math.min(r.left, window.innerWidth - 266);
  let top = r.bottom + 6;
  pop.style.visibility = 'hidden';
  pop.style.display = 'block';
  requestAnimationFrame(() => {
    const ph = pop.offsetHeight;
    if (top + ph > window.innerHeight - 90) top = Math.max(8, r.top - ph - 6);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    pop.style.visibility = 'visible';
    const input = $('#plpop-newname');
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') $('[data-action="import-new"]').click(); });
  });
}

async function importItems(plId, items) {
  const pl = state.playlists.find(p => p.id === plId);
  if (!pl) return;
  const fresh = items
    .filter(it => it.bvid && !pl.items.some(x => x.bvid === it.bvid))
    .map(it => Object.assign({}, it, { title: stripEm(it.title) }));
  if (!fresh.length) { toast('这些视频都已经在歌单里了'); return; }
  pl.items = pl.items.concat(fresh);
  try {
    await savePlaylist(pl);
    toast(`已把 ${fresh.length} 个视频加入「${pl.name}」`, 'success');
    closePops();
    renderSidebar();
    if (state.view.name === 'pldetail' && state.playlist && state.playlist.id === pl.id) renderView();
  } catch (e) { errToast(e); }
}

/* ---------- 批量选择 ---------- */
function selectionSnapshot() {
  return Array.from(state.selection).sort((a, b) => a - b).map(i => state.currentItems[i]).filter(Boolean);
}
function renderImportBar() {
  const bar = $('#importbar');
  const show = state.selectMode && state.selection.size > 0;
  bar.classList.toggle('hidden', !show);
  if (!show) return;
  bar.innerHTML = `<span>已选 <b>${state.selection.size}</b> 个视频</span>
    <button class="ib-btn" data-action="import-open">加入歌单</button>
    <button class="ib-plain" data-action="select-all">全选</button>
    <button class="ib-plain" data-action="select-clear">取消选择</button>`;
}

/* ---------- 登录 ---------- */
function openLogin() {
  const token = ++state.loginToken;
  if (state.loginTimer) { clearInterval(state.loginTimer); state.loginTimer = null; }
  showModal(`<h3>登录哔哩哔哩账号</h3>
    <div class="qr-box">
      <div class="qr-img" id="qr-img"><div class="spin" style="border-color:#f3d4de;border-top-color:var(--pink)"></div></div>
      <div class="qr-status" id="qr-status"><span class="dot"></span>正在生成二维码…</div>
      <div class="qr-tip">打开「哔哩哔哩」APP → 右上角扫一扫<br>扫描二维码并在手机上确认登录</div>
    </div>`);
  setStatus('正在生成二维码…', '');
  (async () => {
    try {
      const d = await Api.get('login/qrcode');
      if (token !== state.loginToken) return;
      const box = $('#qr-img');
      if (!box) return;
      if (window.qrcode) {
        const qr = qrcode(0, 'M');
        qr.addData(d.url);
        qr.make();
        box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0 });
      } else {
        box.innerHTML = `<div class="qr-fallback">二维码组件未加载，<br>请直接打开链接扫码：<br><a href="${esc(d.url)}" target="_blank">${esc(d.url)}</a></div>`;
      }
      setStatus('等待扫码…', '');
      pollLogin(d.key, token);
    } catch (e) {
      if (token !== state.loginToken) return;
      const s = $('#qr-status');
      if (s) s.innerHTML = `生成失败：${esc(e.message)} <button class="mini-btn" data-action="qr-refresh">重试</button>`;
      s.className = 'qr-status warn';
    }
  })();

  function setStatus(text, cls, extraHtml) {
    const s = $('#qr-status');
    if (!s) return;
    s.className = 'qr-status ' + (cls || '');
    s.innerHTML = (cls === '' ? '<span class="dot"></span>' : '') + text + (extraHtml || '');
  }
  function pollLogin(key, tk) {
    state.loginTimer = setInterval(async () => {
      try {
        const r = await Api.get('login/poll', { key });
        if (tk !== state.loginToken) return;
        if (r.ok) {
          clearInterval(state.loginTimer); state.loginTimer = null;
          setStatus('登录成功！', 'ok');
          state.user = r.user;
          setTimeout(() => {
            closeModal();
            toast('欢迎回来，' + (state.user.uname || 'B站用户'), 'success');
            render();
            if (state.view.name === 'favfolders') loadFolders();
          }, 700);
        } else if (r.expired) {
          clearInterval(state.loginTimer); state.loginTimer = null;
          setStatus('二维码已过期', 'warn', ' <button class="mini-btn" data-action="qr-refresh">刷新二维码</button>');
        } else if (r.status === 86090) {
          setStatus('已扫描，请在手机上确认', 'ok');
        }
      } catch {}
    }, 1500);
  }
}

/* 桌面组件toggle：点一下开、再点一下关 */
let deskWidgetOpen = { widget: false, 'desk-lyrics': false };
function toggleDeskWidget(kind) {
  if (deskWidgetOpen[kind]) {
    // 已开着 → 广播关闭命令，组件自己关
    if (DESK_BC) DESK_BC.postMessage({ type: 'cmd', cmd: 'close-' + kind });
    deskWidgetOpen[kind] = false;
  } else {
    const url = 'http://127.0.0.1:' + (location.port || '8900') + '/' + (kind === 'widget' ? 'widget.html' : 'desk-lyrics.html');
    window.open(url, kind === 'widget' ? 'widget' : 'desk-lyrics');
    deskWidgetOpen[kind] = true;
  }
}
function openDeskWidget(kind) {
  let url = 'http://127.0.0.1:' + (location.port || '8900') + '/' + (kind === 'widget' ? 'widget.html' : 'desk-lyrics.html');
  if (kind === 'widget') {
    try { if (localStorage.getItem('bp.widgetTall') === '1') url += '?tall=1'; } catch (e) {}
  }
  window.open(url, kind === 'widget' ? 'widget' : 'desk-lyrics');
  deskWidgetOpen[kind] = true;
}
/* ---------- 网易云音乐：登录区 / 扫码弹窗 / 歌单导入 ---------- */
async function neLogout() {
  try { await Api.get('nlogout'); } catch (e) {}
  state.neUser = null;
  renderNEUser();
  toast('已退出网易云登录', 'success');
}
function renderNEUser() {
  const box = $('#ne-user');
  if (!box) return;
  const acts = $('#ne-actions');
  if (state.neExpired && state.neUser) {
    /* 登录已过期：保留头像昵称（灰态），点击重新扫码；不再提供歌单导入（需登录） */
    box.innerHTML = `<div class="userchip ne-expired" data-action="ne-relogin" title="网易云登录已过期，点击重新登录">
      ${state.neUser.avatar ? `<img src="${esc(state.neUser.avatar)}" alt="">` : ''}
      <div><div class="u-name">${esc(state.neUser.name)}</div><div class="u-lv">登录已过期 · 点击重新登录</div></div></div>`;
    if (acts) acts.innerHTML = `<button class="btn" data-action="ne-relogin" style="width:100%;justify-content:center;padding:6px 0;font-size:12px">重新登录网易云</button>`;
    return;
  }
  if (state.neUser) {
    box.innerHTML = `<div class="userchip" data-action="ne-menu" title="${esc(state.neUser.name)} · 点击退出">
      ${state.neUser.avatar ? `<img src="${esc(state.neUser.avatar)}" onerror="this.style.visibility='hidden'">` : ''}
      <div><div class="u-name">${esc(state.neUser.name)}</div><div class="u-lv">网易云已登录 · 点击退出</div></div></div>`;
    if (acts) acts.innerHTML = `<button class="btn" data-action="ne-import-open" style="width:100%;justify-content:center;padding:6px 0;font-size:12px">${ICON.plus || '+'} 导入网易云歌单</button>`;
  } else {
    box.innerHTML = `<button class="btn-login" data-action="ne-login-open">登录网易云</button>`;
    if (acts) acts.innerHTML = '';
  }
}
function openNELogin() {
  const token = ++state.neLoginToken;
  if (state.neLoginTimer) { clearInterval(state.neLoginTimer); state.neLoginTimer = null; }
  const startTime = Date.now();
  const hasWebLogin = !!(window.appAPI && window.appAPI.openNEWebLogin);
  showModal(`<h3>登录网易云音乐账号</h3>
    ${hasWebLogin ? `<button class="btn primary" data-action="ne-weblogin-open" style="width:100%;justify-content:center;padding:11px;font-size:14px">一键登录（推荐 · 弹出网易云登录页）</button>
    <div class="qr-tip" style="margin:8px 0 4px">点击后弹出网易云音乐官网登录页，用扫码/手机号任意方式登录，<b>成功后自动完成，无需其他操作</b></div>
    <div style="text-align:center;color:var(--t3);font-size:11px;margin:10px 0;letter-spacing:2px">—— 或使用以下方式 ——</div>` : ''}
    <div class="qr-box">
      <div class="qr-img" id="ne-qr-img"><div class="spin" style="border-color:#e60026;border-top-color:#e60026"></div></div>
      <div class="qr-status" id="ne-qr-status"><span class="dot"></span>正在生成二维码…</div>
      <div class="qr-tip">打开「网易云音乐」APP → 左上角 ≡ → 扫一扫<br>扫描后请在手机上点「确认登录」</div>
    </div>
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(0,0,0,.08)">
      <div style="font-size:12px;color:var(--t3);margin-bottom:8px">以上都不行？手动Cookie导入（最后手段）：</div>
      <div style="font-size:11.5px;color:var(--t3);margin-bottom:8px;line-height:1.6">
        ① 电脑浏览器打开 <b>music.163.com</b> 并登录<br>
        ② 按 F12 → Application → Cookies → 复制 <b>MUSIC_U</b> 的值<br>
        ③ 粘贴到下面并点击导入
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input id="ne-cookie-input" type="text" placeholder="粘贴MUSIC_U的值" style="flex:1;padding:7px 10px;border:1px solid var(--line);border-radius:6px;font-size:12px">
        <button class="btn" data-action="ne-cookie-import" style="padding:7px 14px;font-size:12px">导入</button>
      </div>
    </div>`);
  (async () => {
    try {
      const d = await Api.get('nlogin/qr');
      if (token !== state.neLoginToken) return;
      const box = $('#ne-qr-img');
      if (!box) return;
      if (window.qrcode) {
        const qr = qrcode(0, 'M');
        qr.addData(d.qr);
        qr.make();
        box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0 });
      } else {
        box.innerHTML = `<div class="qr-fallback">二维码组件未加载</div>`;
      }
      $('#ne-qr-status').innerHTML = '<span class="dot"></span>等待扫码…';
      pollNE(d.key, token);
    } catch (e) {
      if (token !== state.neLoginToken) return;
      const s2 = $('#ne-qr-status');
      if (s2) s2.innerHTML = `生成失败：${esc(e.message)} <button class="mini-btn" data-action="ne-login-open">重试</button>`;
    }
  })();
  function pollNE(key, tk) {
    state.neLoginTimer = setInterval(async () => {
      try {
        const r = await Api.get('nlogin/poll', { key });
        if (tk !== state.neLoginToken) return;
        const s2 = $('#ne-qr-status');
        if (!s2) return;
        if (r.status === 802) {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          s2.innerHTML = `<span class="dot" style="background:#e8a020"></span>已扫描 · 请在手机上点「确认登录」（${elapsed}s）`;
        } else if (r.status === 801) {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          s2.innerHTML = `<span class="dot"></span>等待扫码…（${elapsed}s）`;
        }
        if (r.ok) {
          clearInterval(state.neLoginTimer); state.neLoginTimer = null;
          s2.innerHTML = '✓ 登录成功！';
          state.neUser = r.user || { name: '网易云用户' };
          state.neExpired = false;
          setTimeout(() => {
            closeModal();
            render();
            toast('网易云登录成功：' + ((r.user && r.user.name) || '网易云用户'), 'success');
          }, 600);
        } else if (r.status === 800) {
          clearInterval(state.neLoginTimer); state.neLoginTimer = null;
          s2.innerHTML = '二维码已过期 <button class="mini-btn" data-action="ne-login-open">刷新二维码</button>';
        }
        // 超时提示
        const elapsedSec = Math.round((Date.now() - startTime) / 1000);
        if (elapsedSec > 120 && !s2.dataset.timeoutWarned) {
          s2.dataset.timeoutWarned = '1';
          toast('二维码登录超时，请尝试刷新二维码', '');
        }
      } catch {}
    }, 1000);
  }
}
async function openNEImport() {
  if (!state.neUser) { toast('请先登录网易云账号', 'error'); return; }
  showModal(`<h3>导入网易云歌单</h3><div id="ne-imp-body"><div class="spin" style="border-color:#e60026;border-top-color:#e60026;margin:20px auto"></div><p style="text-align:center;color:var(--t3)">正在获取网易云歌单…</p></div>
    <div class="m-row"><button class="btn ghost" style="flex:1;justify-content:center" data-action="modal-close">取消</button></div>`);
  try {
    const d = await Api.get('nplaylists');
    const pls = (d.playlists || []).filter(p => p.trackCount > 0);
    const body = $('#ne-imp-body');
    if (!body) return;
    body.innerHTML = pls.length ? `<div class="ne-pl-list">` + pls.map(p => `
      <div class="ver-row" data-action="ne-import-pick" data-id="${p.id}" data-name="${esc(p.name)}" style="cursor:pointer">
        <img src="${esc(pic(p.cover))}" onerror="this.style.visibility='hidden'">
        <div class="ver-main"><div class="ver-title">${esc(p.name)}</div>
        <div class="ver-meta">${p.trackCount} 首${p.special ? ' · 收藏的歌单' : ''}</div></div>
        <span style="color:var(--pink)">${ICON.plus}</span>
      </div>`).join('') + `</div>` : '<p style="text-align:center;color:var(--t3)">没有可导入的歌单</p>';
  } catch (e) { errToast(e); }
}
async function neImportPick(id, name) {
  // 第二步：选择导入方式与目标（融合：直链进新歌单 / 合并到已有歌单）
  const opts = `<h3>导入「${esc(name)}」</h3>
    <div style="font-size:13px;color:var(--t2);margin:2px 0 8px">导入方式</div>
    <label style="display:flex;gap:9px;align-items:flex-start;margin-bottom:9px;cursor:pointer;padding:9px 11px;border:1.5px solid var(--pink);border-radius:10px;background:rgba(251,114,153,.05)">
      <input type="radio" name="ne-mode" value="direct" checked style="margin-top:3px">
      <span><b style="font-size:13px">网易云直链（推荐）</b><br><span style="font-size:11.5px;color:var(--t3)">整单秒完成，保留网易云原曲直接播放，不做B站匹配</span></span>
    </label>
    <label style="display:flex;gap:9px;align-items:flex-start;margin-bottom:14px;cursor:pointer;padding:9px 11px;border:1px solid var(--line);border-radius:10px">
      <input type="radio" name="ne-mode" value="match" style="margin-top:3px">
      <span><b style="font-size:13px">匹配B站视频</b><br><span style="font-size:11.5px;color:var(--t3)">逐首在B站搜索替代源（慢，仅适合不想用网易云直链时）</span></span>
    </label>
    <div style="font-size:13px;color:var(--t2);margin:0 0 8px">导入到</div>
    <select id="ne-target" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:#fff">
      <option value="new">新建歌单「${esc(name)} · 网易云」</option>
      ${state.playlists.map(p => `<option value="${p.id}">合并到「${esc(p.name)}」（${p.items.length}首）</option>`).join('')}
    </select>
    <div style="text-align:center;margin-top:12px"><button class="btn" style="width:100%;justify-content:center" data-action="ne-pick-open" data-id="${esc(id)}" data-name="${esc(name)}">只选其中几首加入现有歌单…</button></div>
    <div class="m-row" style="margin-top:12px"><button class="btn ghost" style="flex:1;justify-content:center" data-action="modal-close">取消</button>
    <button class="btn primary" style="flex:1.4;justify-content:center" data-action="ne-import-go" data-id="${esc(id)}" data-name="${esc(name)}">开始导入</button></div>`;
  showModal(opts);
  return;
}
async function neImportRun(id, name, target, mode) {
  showModal(`<h3>导入「${esc(name)}」</h3><div id="ne-imp-body"><p style="text-align:center">正在获取曲目…</p></div>`);
  const body = $('#ne-imp-body');
  if (!body) return;
  let tracks = [];
  try { tracks = (await Api.get('nplaylist', { id })).tracks || []; } catch (e) { return errToast(e); }
  if (!tracks.length) { body.innerHTML = '<p style="text-align:center;color:var(--t3)">这个歌单是空的</p>'; return; }
  const norm = t => stripEm(String(t || '')).toLowerCase().replace(/\s+/g, '');
  let results = [];
  let matched = 0, direct = 0, failed = 0, skipped = 0;

  /* 目标歌单与去重键 */
  let targetPl = null, existing = [], existNids = new Set(), existNorms = [];
  if (target !== 'new') {
    targetPl = state.playlists.find(p => p.id === target);
    if (!targetPl) { body.innerHTML = '<p style="text-align:center;color:var(--t3)">目标歌单不存在</p>'; return; }
    existing = (targetPl.items || []).slice();
    existing.forEach(it => {
      if (it.nid) existNids.add('n' + it.nid);
      if (it.bvid) existNids.add('b' + it.bvid);
      const nt = norm(it.title);
      if (nt.length >= 3) existNorms.push(nt);
    });
  }
  const isDup = t => {
    if (existNids.has('n' + t.nid)) return true;
    const nt = norm(t.name);
    if (nt.length < 3) return false;
    return existNorms.some(e => e === nt || (e.includes(nt) && nt.length >= 3) || (nt.includes(e) && e.length >= 3));
  };

  if (mode === 'direct') {
    /* 直链快导：整单一次成形，网易云原曲直接进歌单 */
    for (const t of tracks) {
      if (isDup(t)) { skipped++; continue; }
      results.push({ nid: t.nid, ne: true, title: t.name, up: t.artist, pic: t.pic || '', duration: Math.round(t.durationMs / 1000) });
      direct++;
    }
  } else {
    /* 匹配模式：逐首搜B站，搜不到的回落网易云直链 */
    let done = 0;
    const render = () => { body.innerHTML = `<p style="text-align:center">正在匹配… ${done}/${tracks.length}（B站 ${matched} · 直链 ${direct} · 重复 ${skipped} · 失败 ${failed}）</p>
      <div style="height:8px;background:rgba(0,0,0,.08);border-radius:4px;overflow:hidden"><div style="height:100%;width:${Math.round(done / Math.max(1, tracks.length) * 100)}%;background:var(--pink)"></div></div>`; };
    render();
    for (const t of tracks) {
      if (isDup(t)) { skipped++; done++; render(); continue; }
      const dur = Math.round(t.durationMs / 1000);
      let pick = null;
      try {
        const d = await Api.get('search', { keyword: (t.artist ? t.artist + ' ' : '') + t.name });
        const cands = (d.items || []).filter(x => {
          const nt = stripEm(x.title).toLowerCase().replace(/\s+/g, '');
          return nt.includes(t.name.toLowerCase().replace(/\s+/g, ''));
        });
        if (cands.length) {
          cands.sort((a, b) => {
            const da = Math.abs((a.duration || 0) - dur), db = Math.abs((b.duration || 0) - dur);
            const wa = da <= 20 ? 0 : da <= 35 ? 1 : 2, wb = db <= 20 ? 0 : db <= 35 ? 1 : 2;
            return wa - wb || (b.play || 0) - (a.play || 0);
          });
          pick = cands[0];
        }
      } catch (e) {}
      if (pick && !existNids.has('b' + pick.bvid)) {
        results.push({ bvid: pick.bvid, title: stripEm(pick.title), up: pick.up, upMid: pick.upMid, pic: pick.pic, duration: pick.duration || dur, ne: false });
        matched++;
      } else {
        if (pick) { skipped++; }
        else {
          let url = null;
          try {
            const u = await Api.get('nmedia', { id: t.nid });
            url = u.url || null;
          } catch (e) {
            /* 风控时直链探测不可靠：先按"直链可用"收进歌单（播放时再解析），避免误判失败 */
            if (e && e.risk) url = 'risk-deferred';
          }
          if (url) { results.push({ nid: t.nid, ne: true, title: t.name, up: t.artist, pic: t.pic || '', duration: dur }); direct++; }
          else failed++;
        }
      }
      done++; render();
      await new Promise(r2 => setTimeout(r2, 120));
    }
  }

  try {
    if (targetPl) {
      /* 融合：追加进已有歌单 */
      const items = existing.concat(results);
      await Api.put('playlists/' + targetPl.id, { name: targetPl.name, items });
      targetPl.items = items;
      renderSidebar();
      closeModal();
      toast(`融合完成：新增 ${results.length} 首 · 跳过重复 ${skipped} 首 → 「${targetPl.name}」共 ${items.length} 首`, 'success');
      openPlaylist(targetPl.id);
    } else {
      const d = await Api.post('playlists', { name: name + ' · 网易云', nePid: id });
      const pl = d.playlist;
      pl.items = results;
      await Api.put('playlists/' + pl.id, { name: pl.name, items: results });
      state.playlists.unshift(pl);
      renderSidebar();
      closeModal();
      const sum = mode === 'direct'
        ? `直链导入 ${direct} 首${skipped ? ' · 跳过重复 ' + skipped + ' 首' : ''}`
        : `B站匹配 ${matched} 首 · 网易云直链 ${direct} 首${failed ? ' · 失败 ' + failed + ' 首' : ''}`;
      toast(`导入完成：${sum}`, 'success');
      openPlaylist(pl.id);
    }
  } catch (e) { errToast(e); }
}
/* ---------- 网易云歌单：逐首挑选加入现有歌单 ---------- */
async function nePickOpen(id, name) {
  showModal(`<h3>选歌导入「${esc(name)}」</h3><div id="ne-pick-body"><div class="spin" style="border-color:#e60026;border-top-color:#e60026;margin:20px auto"></div><p style="text-align:center;color:var(--t3)">正在获取曲目…</p></div>`);
  try {
    const d = await Api.get('nplaylist', { id });
    const tracks = (d && d.tracks) || [];
    const body = $('#ne-pick-body');
    if (!body) return;
    if (!tracks.length) { body.innerHTML = '<p style="text-align:center;color:var(--t3)">这个歌单是空的</p>'; return; }
    App._nePick = { id, name, tracks };
    const pls = state.playlists || [];
    const targetOpts = pls.map(p => `<option value="${p.id}">加入「${esc(p.name)}」（${p.items.length}首）</option>`).join('')
      + `<option value="new">新建歌单「${esc(name)} · 网易云」</option>`;
    body.innerHTML = `
      <div class="ne-pick-bar"><label class="ne-pick-all"><input type="checkbox" id="ne-pick-all"> 全选</label><span id="ne-pick-count">已选 0 首</span></div>
      <div class="ne-pick-search"><input id="ne-pick-search" type="search" placeholder="搜索歌曲名或歌手…" autocomplete="off"></div>
      <div class="ne-pick-list">${tracks.map((t, i) => `
        <label class="ne-pick-row" data-search="${esc((String(t.name || '') + ' ' + String(t.artist || '')).toLowerCase())}">
          <input type="checkbox" data-nepick data-i="${i}">
          <span class="np-idx">${i + 1}</span>
          <span class="np-main"><span class="np-title">${esc(stripEm(t.name))}</span>
          <span class="np-sub">${esc(t.artist || '')}${t.durationMs ? ' · ' + fmt(Math.round(t.durationMs / 1000)) : ''}</span></span>
        </label>`).join('')}</div>
      <div class="ne-pick-empty hidden" id="ne-pick-empty">没有匹配的歌曲</div>
      <div style="font-size:13px;color:var(--t2);margin:12px 0 8px">加入歌单</div>
      <select id="ne-pick-target" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font-size:13px;background:#fff">${targetOpts}</select>
      <div class="m-row" style="margin-top:14px"><button class="btn ghost" style="flex:1;justify-content:center" data-action="modal-close">取消</button>
      <button class="btn primary" style="flex:1.4;justify-content:center" data-action="ne-pick-go" data-name="${esc(name)}">加入歌单</button></div>`;
    nePickCount();
  } catch (e) { errToast(e); }
}
function nePickFilter(q) {
  const words = String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  let visible = 0;
  document.querySelectorAll('.ne-pick-row').forEach(row => {
    const hay = String(row.dataset.search || '');
    const hit = !words.length || words.every(w => hay.includes(w));
    row.style.display = hit ? '' : 'none';
    if (hit) visible++;
  });
  const empty = $('#ne-pick-empty');
  if (empty) empty.classList.toggle('hidden', visible > 0);
  nePickCount();
}
function nePickCount() {
  const boxes = Array.from(document.querySelectorAll('input[data-nepick]'));
  const n = boxes.filter(x => x.checked).length;
  const el = $('#ne-pick-count');
  if (el) el.textContent = '已选 ' + n + ' 首';
  const all = $('#ne-pick-all');
  const visible = boxes.filter(x => x.closest('.ne-pick-row')?.style.display !== 'none');
  if (all) {
    const vn = visible.filter(x => x.checked).length;
    all.disabled = visible.length === 0;
    all.checked = visible.length > 0 && vn === visible.length;
    all.indeterminate = vn > 0 && vn < visible.length;
  }
}
async function nePickRun(name) {
  const p = App._nePick;
  if (!p) return;
  const sel = Array.from(document.querySelectorAll('input[data-nepick]:checked')).map(x => +x.dataset.i);
  if (!sel.length) { toast('请先勾选要加入的歌曲', ''); return; }
  const targetVal = (($('#ne-pick-target') || {}).value) || 'new';
  let targetPl = null;
  if (targetVal !== 'new') {
    targetPl = (state.playlists || []).find(x => x.id === targetVal);
    if (!targetPl) { toast('目标歌单不存在', 'error'); return; }
  }
  const norm = t => stripEm(String(t || '')).toLowerCase().replace(/\s+/g, '');
  const existNids = new Set();
  const existNorms = [];
  ((targetPl && targetPl.items) || []).forEach(it => {
    if (it.nid) existNids.add('n' + it.nid);
    if (it.bvid) existNids.add('b' + it.bvid);
    const nt = norm(it.title);
    if (nt.length >= 3) existNorms.push(nt);
  });
  const isDup = t => {
    if (existNids.has('n' + t.nid)) return true;
    const nt = norm(t.name);
    if (nt.length < 3) return false;
    return existNorms.some(e => e === nt || (e.includes(nt) && nt.length >= 3) || (nt.includes(e) && e.length >= 3));
  };
  const add = [];
  let skipped = 0;
  for (const i of sel) {
    const t = p.tracks[i];
    if (!t) continue;
    if (isDup(t)) { skipped++; continue; }
    add.push({ nid: t.nid, ne: true, title: stripEm(t.name), up: t.artist || '', pic: t.pic || '', duration: Math.round((t.durationMs || 0) / 1000) });
  }
  if (!add.length) {
    closeModal();
    toast(`选中的 ${sel.length} 首都已在目标歌单里（跳过重复 ${skipped} 首）`, '');
    return;
  }
  try {
    if (targetPl) {
      const items = (targetPl.items || []).concat(add);
      await Api.put('playlists/' + targetPl.id, { name: targetPl.name, items });
      targetPl.items = items;
      renderSidebar();
      closeModal();
      toast(`已加入 ${add.length} 首到「${targetPl.name}」${skipped ? ' · 跳过重复 ' + skipped + ' 首' : ''} · 共 ${items.length} 首`, 'success');
      openPlaylist(targetPl.id);
    } else {
      const d = await Api.post('playlists', { name: name + ' · 网易云', nePid: (App._nePick && App._nePick.id) || '' });
      const pl = d.playlist;
      pl.items = add;
      await Api.put('playlists/' + pl.id, { name: pl.name, items: add });
      state.playlists.unshift(pl);
      renderSidebar();
      closeModal();
      toast(`已新建「${pl.name}」并加入 ${add.length} 首${skipped ? ' · 跳过重复 ' + skipped + ' 首' : ''}`, 'success');
      openPlaylist(pl.id);
    }
  } catch (e) { errToast(e); }
}
async function doLogout() {
  try { await Api.post('logout'); } catch {}
  state.user = { isLogin: false };
  state.folders = null;
  if (state.view.name === 'favdetail') state.view = { name: 'favfolders' };
  render();
  toast('已退出登录');
}

/* ---------- 导入整夹 ---------- */
function importWholeFolder() {
  const f = state.folder;
  if (!f) return;
  confirmModal(`将收藏夹「${esc(f.title)}」的全部视频导入为新歌单？`, async () => {
    closeModal();
    toast('正在获取收藏夹全部视频…');
    try {
      const { items } = await Api.get('fav/all', { media_id: f.id });
      if (!items.length) { toast('该收藏夹没有可导入的视频', 'error'); return; }
      const pl = await createPlaylist(f.title);
      pl.items = items;
      await savePlaylist(pl);
      toast(`已导入 ${items.length} 个视频到「${pl.name}」`, 'success');
      openPlaylist(pl.id);
    } catch (e) { errToast(e); }
  });
}

/* ---------- 波形自定义面板 ---------- */
const VIZ_SWATCHES = ['#fb7299', '#ff8fb1', '#f25d5d', '#ff9f43', '#e8c341', '#67c23a', '#2ad4b0', '#00aeec', '#6c8cff', '#9b6bff'];
const VIZ_SLIDERS = {
  'bar.height': { label: '峰高度', min: 50, max: 150, toVal: v => v / 100, fmt: v => Math.round(v * 100) + '%' },
  'bar.density': { label: '柱间距', min: 60, max: 180, toVal: v => v / 100, fmt: v => Math.round(v * 100) + '%' },
  'bar.sigma': { label: '峰形宽度', min: 50, max: 200, toVal: v => v / 100, fmt: v => Math.round(v * 100) + '%' },
  'stage.height': { label: '峰高度', min: 50, max: 150, toVal: v => v / 100, fmt: v => Math.round(v * 100) + '%' },
  'stage.density': { label: '柱间距', min: 60, max: 180, toVal: v => v / 100, fmt: v => Math.round(v * 100) + '%' },
  'sens': { label: '灵敏度', min: 60, max: 200, toVal: v => v / 100, fmt: v => Math.round(v * 100) + '%' },
  'smooth': { label: '平滑度', min: 50, max: 250, toVal: v => v / 100, fmt: v => Math.round(v * 100) + '%' },
  'lyricSize': { label: '歌词大小', min: 10, max: 24, toVal: v => v, fmt: v => Math.round(v) + 'px' },
  'mvSubSize': { label: 'MV字幕大小', min: 12, max: 28, toVal: v => v, fmt: v => Math.round(v) + 'px' },
  'mvSubBottom': { label: 'MV字幕高度', min: 4, max: 42, toVal: v => v, fmt: v => Math.round(v) + '%' },
  'blur': { label: '播放页背景模糊', min: 0, max: 60, toVal: v => v, fmt: v => Math.round(v) + 'px' },
  'cdBlur': { label: 'CD架背景模糊', min: 0, max: 60, toVal: v => v, fmt: v => Math.round(v) + 'px' }
};
function vizGet(path) { return path.split('.').reduce((o, k) => (o ? o[k] : undefined), VIZ); }
function vizSet(path, val) {
  const ks = path.split('.');
  let o = VIZ;
  for (let i = 0; i < ks.length - 1; i++) { if (typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; }
  o[ks[ks.length - 1]] = val;
}
function vizSliderRow(k) {
  const s = VIZ_SLIDERS[k];
  const cur = vizGet(k) !== undefined ? vizGet(k) : 0;
  return `<div class="vs-slider"><span>${s.label}</span>
    <input type="range" data-viz="${k}" min="${s.min}" max="${s.max}" value="${Math.round(cur)}">
    <em id="vs-val-${k.replace('.', '-')}">${s.fmt(cur)}</em>
  </div>`;
}
function openVizSettings() {
  showModal(`<h3>外观自定义</h3>
    <div class="vs-sec">
      <div class="vs-label">侧栏背景（默认 / 纯白 / 透明 / 毛玻璃 / 自定义颜色）</div>
      <div class="sb-opts">
        <button class="sb-opt ${SIDEBG.mode === 'default' ? 'active' : ''}" data-action="sidebg" data-mode="default">默认</button>
        <button class="sb-opt ${SIDEBG.mode === 'white' ? 'active' : ''}" data-action="sidebg" data-mode="white">纯白</button>
        <button class="sb-opt ${SIDEBG.mode === 'clear' ? 'active' : ''}" data-action="sidebg" data-mode="clear">透明</button>
        <button class="sb-opt ${SIDEBG.mode === 'glass' ? 'active' : ''}" data-action="sidebg" data-mode="glass">毛玻璃</button>
        <label class="sb-opt sb-color ${SIDEBG.mode === 'color' ? 'active' : ''}" data-action="sidebg" data-mode="color" title="自定义颜色">
          <input type="color" id="sidebg-input" value="${SIDEBG.color || '#fb7299'}">
          <span>自定义</span>
        </label>
      </div>
    </div>
    <div class="vs-sec">
      <div class="vs-label">颜色（点击色板或右侧＋取任意颜色，两处波形共用）</div>
      <div class="vs-swatches">
        ${VIZ_SWATCHES.map(c => `<button class="vs-sw ${VIZ.color.toLowerCase() === c ? 'active' : ''}" data-action="viz-color" data-color="${c}" style="background:${c}"></button>`).join('')}
        <label class="vs-picker"><input type="color" id="viz-color-input" value="${VIZ.color}"></label>
      </div>
    </div>
    <div class="vs-sec">
      <div class="vs-label">底部播放栏 · 竖向峰</div>
      ${['bar.height', 'bar.density', 'bar.sigma'].map(vizSliderRow).join('')}
    </div>
    <div class="vs-sec">
      <div class="vs-label">纯听页 · 舞台律动条</div>
      ${['stage.height', 'stage.density'].map(vizSliderRow).join('')}
    </div>
    <div class="vs-sec">
      <div class="vs-label">灵敏度 / 平滑度（两处共用）</div>
      ${['sens', 'smooth'].map(vizSliderRow).join('')}
    </div>
    <div class="vs-sec">
      <div class="vs-label">歌词与播放页背景（背景为视频封面）</div>
      ${['lyricSize', 'mvSubSize', 'mvSubBottom', 'blur'].map(vizSliderRow).join('')}
    </div>
    <div class="vs-sec">
      <div class="vs-label">CD架背景（当前选中视频的封面，与播放页分开）</div>
      ${['cdBlur'].map(vizSliderRow).join('')}
    </div>
    <div class="m-row">
      <button class="btn ghost" style="flex:1;justify-content:center" data-action="viz-reset">恢复默认</button>
      <button class="btn primary" style="flex:1;justify-content:center" data-action="modal-close">完成</button>
    </div>`);
}
function vizMarkSwatch() {
  $$('.vs-sw').forEach(el => el.classList.toggle('active', (el.dataset.color || '').toLowerCase() === VIZ.color.toLowerCase()));
}

/* ---------- 事件绑定 ---------- */
function bindEvents() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target && e.target.id === 'ly-offset-input') {
      e.preventDefault();
      applyLyricOffsetInput();
    }
  });
  document.addEventListener('click', e => {
    const inPop = e.target.closest('.plpop, .queuepop');
    const onTrigger = e.target.closest('[data-action="add"], [data-action="import-open"], [data-action="pb-queue"], #pb-queue, [data-action="add-current"]');
    if (!inPop && !onTrigger) closePops();

    const t = e.target.closest('[data-action]');
    if (!t) return;
    const a = t.dataset.action;
    const idx = t.dataset.idx !== undefined ? +t.dataset.idx : -1;

    switch (a) {
      case 'nav': go(t.dataset.view); break;
      case 'back': goBack(); break;
      case 'up-open': if (t.dataset.mid) openUp(t.dataset.mid, t.dataset.up || ''); break;
      case 'npq-tab': {
        const tab = t.dataset.tab;
        if (state.npqTab !== tab) {
          state.npqTab = tab;
          if (state.view.name === 'nowplaying') renderView();
          if (tab === 'reply') loadRepliesIfNeeded();
        }
        break;
      }
      case 'reply-more': loadMoreReplies(); break;
      case 'search-go': doSearch($('#search-input').value.trim()); break;
      case 'search-retry':
        state.searchErr = '';
        state.pageMeta = { pn: 0, hasMore: false, total: 0 };
        loadMoreSearch();
        break;
      case 'folder-open': openFolder(+t.dataset.id, t.dataset.title); break;
      case 'refresh-folders': state.folders = null; loadFolders(); break;
      case 'card':
        if (state.selectMode) toggleSelect(idx);
        else playFromItems(idx);
        break;
      case 'play': playFromItems(idx); break;
      case 'play-all': if (state.currentItems.length) playFromItems(0); break;
      case 'add': openPlPop(t, [state.currentItems[idx]]); break;
      case 'add-current': openPlPop(t, [Player.S.track]); break;
      case 'select-mode':
        state.selectMode = !state.selectMode;
        state.selection.clear();
        render();
        break;
      case 'select-all':
        state.currentItems.forEach((_, i) => state.selection.add(i));
        $$('#view .card').forEach(el => { el.classList.add('selected'); const c = el.querySelector('input[type=checkbox]'); if (c) c.checked = true; });
        renderImportBar();
        break;
      case 'select-clear':
        state.selection.clear();
        $$('#view .card').forEach(el => { el.classList.remove('selected'); const c = el.querySelector('input[type=checkbox]'); if (c) c.checked = false; });
        renderImportBar();
        break;
      case 'import-open': openPlPop(t, selectionSnapshot()); break;
      case 'import-to': importItems(t.dataset.pl, App.popItems); break;
      case 'import-new': {
        const name = ($('#plpop-newname') || {}).value || '';
        if (!name.trim()) { toast('先给歌单起个名字', 'error'); return; }
        createPlaylist(name.trim()).then(pl => importItems(pl.id, App.popItems)).catch(e => errToast(e));
        break;
      }
      case 'fav-import-all': importWholeFolder(); break;
      case 'load-more':
        if (state.view.name === 'favdetail') loadMoreFav();
        else if (state.view.name === 'upspace') loadMoreUp();
        else loadMoreSearch();
        break;
      case 'pl-new':
        promptModal('新建歌单', '', async name => {
          try { const pl = await createPlaylist(name); toast('已创建「' + pl.name + '」', 'success'); openPlaylist(pl.id); }
          catch (e) { errToast(e); }
        });
        break;
      case 'pl-open': openPlaylist(t.dataset.id); break;
      case 'pl-del':
        confirmModal(`确定删除歌单「${esc((state.playlists.find(p => p.id === t.dataset.id) || {}).name || '')}」？里面的视频列表将一并删除。`, async () => {
          try {
            await Api.del('playlists/' + t.dataset.id);
            state.playlists = state.playlists.filter(p => p.id !== t.dataset.id);
            if (state.playlist && state.playlist.id === t.dataset.id) { state.playlist = null; state.currentItems = []; go('playlists'); }
            else render();
            toast('歌单已删除');
          } catch (e) { errToast(e); }
        });
        break;
      case 'pl-rename':
        promptModal('重命名歌单', state.playlist ? state.playlist.name : '', async name => {
          if (!state.playlist) return;
          state.playlist.name = name;
          try { await savePlaylist(state.playlist); render(); toast('已重命名', 'success'); } catch (e) { errToast(e); }
        });
        break;
      case 'prow': playFromItems(idx); break;
      case 'pl-del-item': {
        const pl = state.playlist;
        if (!pl) break;
        pl.items.splice(idx, 1);
        state.currentItems = pl.items;
        savePlaylist(pl).then(() => { renderView(); renderSidebar(); }).catch(e => errToast(e));
        break;
      }
      case 'queue-jump':
        Player.S.index = idx;
        state.miniClosed = false;
        Player.playCurrent().catch(() => {});
        closePops();
        break;
      case 'queue-remove': removeQueueItem(idx); break;
      case 'queue-clear': stopPlayback(); closePops(); break;
      case 'np-mode':
        (async () => {
          state.miniClosed = false;
          await Player.setMode(Player.S.mode === 'audio' ? 'video' : 'audio');
          renderView(); updateVideoMount();
        })();
        break;
      case 'heart-toggle': toggleHeart(); break;
      case 'roam-toggle': startRoam(); break;
      case 'roam-like': roamLike(); break;
      case 'roam-dislike': roamDislike(); break;
      case 'np-fullscreen': toggleVideoFs(); break;
      case 'pl-view': {
        const m = t.dataset.mode === 'cd';
        if (state.cdMode !== m) { state.cdMode = m; render(); }
        break;
      }
      case 'cd-click': {
        if (App.cd.dragMoved) break; // 拖动结束后的click不算点击
        const idx = +t.dataset.idx;
        if (idx !== App.cd.cur) { cdMarkUser(); cdSetTrack(idx); break; }
        if (App.cd.openIdx === idx) { // 盒盖已开：再点=播放并进入CD机
          playFromItems(idx);
          go('nowplaying');
          break;
        }
        cdToggleOpen(idx); // 第一次点：开盒盖动画
        break;
      }
      case 'cd-play': {
        playFromItems(+t.dataset.idx);
        go('nowplaying');
        break;
      }
      case 'lyric-back': snapToActiveLyric(); break;
      case 'dm-toggle': {
        DM.on = !DM.on;
        localStorage.setItem('bp.dm', DM.on ? '1' : '0');
        renderView();
        toast(DM.on ? '弹幕已开启' : '弹幕已关闭');
        break;
      }
      case 'versions-open': openVersions(); break;
      case 'fx-open': openFxPanel(); break;
      case 'room-open': if (window.Room) Room.openPanel(); break;
      case 'ver-play': {
        const it = findSwitchable(t.dataset.bvid);
        if (!it) break;
        const ni = { bvid: it.bvid, title: stripEm(it.title), up: it.up, upMid: it.upMid, pic: it.pic, duration: it.duration, aid: it.aid };
        if (Player.S.index >= 0) applyVersionSwitch(Player.S.index, ni); // 平行宇宙：占住当前队列位置（记住原版）
        else Player.setQueue([ni], 0);
        Player.S.track = ni;
        Player.playCurrent().catch(() => {});
        closeModal();
        toast('已切换版本 · ' + stripEm(it.title).slice(0, 22), 'success');
        break;
      }
      case 'ver-seamless': {
        const it = findSwitchable(t.dataset.bvid);
        if (it) seamlessTo(it);
        break;
      }
      case 'seam-mode': {
        if (t.dataset.mode && t.dataset.mode !== seamMode()) {
          localStorage.setItem('bp.seamMode', t.dataset.mode);
          openVersions(); // 重渲染弹窗刷新选中态
          toast(t.dataset.mode === 'instant' ? '已切换为立即衔接' : '已切换为渐变缓冲');
        }
        break;
      }
      case 'ver-add': {
        const it = findSwitchable(t.dataset.bvid);
        if (it) openPlPop(t, [{ bvid: it.bvid, title: stripEm(it.title), up: it.up, upMid: it.upMid, pic: it.pic, duration: it.duration }]);
        break;
      }
      case 'np-info-tab': {
        const tab = t.dataset.tab;
        if (state.npInfoTab !== tab) {
          state.npInfoTab = tab;
          if (state.view.name === 'nowplaying') renderView();
          if (tab === 'lyric') loadLyricsIfNeeded();
        }
        break;
      }
      case 'ly-offset': changeLyricOffset(parseFloat(t.dataset.d) || 0); break;
      case 'ly-line': {
        const i = +t.dataset.li;
        const L = state.lyrics;
        if (App.tapSync && App.tapSync.active && L && L.lines && i >= 0 && i < L.lines.length) {
          /* 打点模式：点某行可直接把目标移过去，方便只补关键段 */
          App.tapSync.idx = i;
          App.lyricNudgeIdx = i;
          App._lyricScrollHold = Date.now() + 3600000;
          clearTimeout(App._lyricSnapTimer);
          renderView();
          requestAnimationFrame(() => scrollToLyricLine(i));
        } else {
          selectLyricLine(i);
        }
        break;
      }
      case 'ly-tap-start': tapSyncStart(); break;
      case 'ly-tap-mark': tapSyncMark(); break;
      case 'ly-tap-undo': tapSyncUndo(); break;
      case 'ly-tap-done': tapSyncDone(); break;
      case 'ly-preview': previewLyricOffset(parseFloat(t.dataset.off)); break;
      case 'ly-low-only':
        App.lyricLowOnly = !App.lyricLowOnly;
        renderView();
        if (App.lyricLowOnly) { const first = document.querySelector('.nt-line.low-conf'); if (first) first.scrollIntoView({ block: 'center' }); }
        break;
      case 'ly-conf-jump': {
        const ci = +t.dataset.li;
        selectLyricLine(ci);
        toast('已定位第 ' + (ci + 1) + ' 行低置信歌词', '');
        break;
      }
      case 'ly-line-offset': changeLineOffset(parseFloat(t.dataset.d) || 0); break;
      case 'ly-line-offset-reset': resetLineOffset(); break;
      case 'ly-line-shift-rest': shiftLineOffsetsFrom(parseFloat(t.dataset.d) || 0); break;
      case 'ly-line-snap-beat': snapLineToBeat(); break;
      case 'ly-line-edit': openLineEditor(); break;
      case 'ly-line-edit-save': saveLineEdit('save', t.dataset.idx); break;
      case 'ly-line-edit-split': saveLineEdit('split', t.dataset.idx); break;
      case 'ly-line-edit-merge': saveLineEdit('merge', t.dataset.idx); break;
      case 'ly-line-edit-del': saveLineEdit('del', t.dataset.idx); break;
      case 'ly-estimate': estimateLyricOffset(); break;
      case 'ly-calibrate': openCalibrateWizard(); break;
      case 'ly-cal-cc': chooseLyricSource(+t.dataset.idx); break;
      case 'ly-cal-estimate': closeModal(); estimateLyricOffset(); break;
      case 'ly-cal-offset-reset': closeModal(); resetLyricOffset(); break;
      case 'ly-cal-tap': closeModal(); tapSyncStart(); break;
      case 'ly-cal-cancel-align': closeModal(); cancelLyricAlign(); break;
      case 'ly-apply-est': applyEstimatedOffset(parseFloat(t.dataset.off) || 0); break;
      case 'ly-offset-apply': applyLyricOffsetInput(); break;
      case 'ly-offset-reset': resetLyricOffset(); break;
      case 'ly-cancel-align': cancelLyricAlign(); break;
      case 'ly-sources': openLyricSources(); break;
      case 'ly-import-open': openLyricImport(); break;
      case 'ly-import-do': importLyricText(); break;
      case 'ly-export-open': openLyricExport(); break;
      case 'ly-export': downloadLyricFile(t.dataset.kind); break;
      case 'ly-manual-clear': clearManualLyrics(); break;
      case 'ly-auto': closeModal(); restoreAutoLyrics(); break;
      case 'ly-diag': openLyricDiagnostics(); break;
      case 'ly-diag-copy': copyLyricDiagnostics(); break;
      case 'ly-diag-reload': closeModal(); reloadLyrics(); break;
      case 'ly-backup': backupLyricData(); break;
      case 'ly-restore-open': openLyricRestore(); break;
      case 'ly-restore-do': restoreLyricData(); break;
      case 'ly-choose': chooseLyricSource(t.dataset.idx); break;
      case 'ly-reload': reloadLyrics(); break;
      case 'external':
        if (Player.S.track) window.open('https://www.bilibili.com/video/' + Player.S.track.bvid, '_blank');
        break;
      case 'mini-go': state.miniClosed = false; go('nowplaying'); break;
      case 'mini-close': state.miniClosed = true; Player.video.pause(); updateVideoMount(); break;
      case 'login-open': openLogin(); break;
      case 'ne-login-open': openNELogin(); break;
      case 'ne-relogin': openNELogin(); break;
      case 'ne-menu': neLogout(); break;
      case 'ne-import-pick': neImportPick(t.dataset.id, t.dataset.name); break;
      case 'ne-pick-open': nePickOpen(t.dataset.id, t.dataset.name); break;
      case 'ne-pick-go': nePickRun(t.dataset.name); break;
      case 'ne-import-go': {
        const mode = (document.querySelector('input[name="ne-mode"]:checked') || {}).value || 'direct';
        const target = ($('#ne-target') || {}).value || 'new';
        neImportRun(t.dataset.id, t.dataset.name, target, mode);
        break;
      }
      case 'ne-weblogin-open': {
        if (!(window.appAPI && window.appAPI.openNEWebLogin)) { toast('网页登录仅桌面版可用', 'error'); return; }
        const s2 = $('#ne-qr-status');
        if (s2) s2.innerHTML = '<span class="dot" style="background:#e60026"></span>已弹出网易云登录页，请在窗口中登录…';
        window.appAPI.onNELoginDone(r => {
          if (r && r.user) {
            state.neUser = r.user;
            state.neExpired = false;
            render();
            closeModal();
            toast('网易云登录成功：' + (r.user.name || ''), 'success');
          } else {
            const s3 = $('#ne-qr-status');
            if (s3) s3.innerHTML = '登录未完成，请重试或改用下方Cookie导入';
          }
        });
        window.appAPI.openNEWebLogin();
        break;
      }
      case 'ne-cookie-import': {
        const inp = document.getElementById('ne-cookie-input');
        const val = inp ? inp.value.trim() : '';
        if (!val || val.length < 32) { toast('请输入有效的MUSIC_U值', 'error'); return; }
        Api.get('ncookie/set?value=' + encodeURIComponent(val)).then(r => {
          if (r.user) {
            state.neUser = r.user;
            state.neExpired = false;
            render();
            closeModal();
            toast('网易云登录成功：' + (r.user.name || ''), 'success');
          } else { toast('Cookie无效或已过期，请重新获取', 'error'); }
        }).catch(e => errToast(e));
        break;
      }
      case 'ne-import-open': openNEImport(); break;
      case 'qr-refresh': openLogin(); break;
      case 'user-menu':
        confirmModal(`退出当前B站账号（${esc(state.user && state.user.uname || '')}）？`, doLogout);
        break;
      case 'modal-close': closeModal(); break;
      case 'viz-open': openVizSettings(); break;
      case 'mv-toggle': toggleMV(); break;
      case 'mv-style': if (App.mv.director) setDirector(false, true); setMVStyle(t.dataset.style); break;
      case 'mv-director': setDirector(!App.mv.director); break;
      case 'mv-lowpower': setLowPower(!App.mv.lowPower); break;
      case 'mv-section': setSectionSwitch(!App.mv.sectionSwitch); break;
      case 'mv-style-open': toggleMVStylePanel(); break;
      case 'mv-style-close': { const p = document.getElementById('mv-style-panel'); if (p && !p.classList.contains('hidden')) p.classList.add('hidden'); break; }
      case 'mv-video': toggleMVVideo(); break;
      case 'mv-mood': toggleMVMood(); break;
      case 'mv-tone': toggleMVTone(); break;
      case 'mv-subtitle': toggleMVSubtitle('trans'); break;
      case 'mv-sub-roma': toggleMVSubtitle('roma'); break;
      case 'ai-open': openAiSettings(); break;
      case 'ai-save': saveAiSettings(true).catch(() => {}); break;
      case 'ai-test': testAiSettings(); break;
      case 'side-toggle': toggleSidebar(); break;
      case 'pb-toggle': togglePb(); break;
      case 'sidebg': {
        SIDEBG.mode = t.dataset.mode || 'default';
        applySideBg(); sideBgSave(); sideBgMarkOpts();
        break;
      }
      case 'viz-color':
        VIZ.color = t.dataset.color;
        applyVizColor(); vizSave(); vizMarkSwatch();
        break;
      case 'viz-reset':
        VIZ = Object.assign({}, VIZ_DEFAULTS);
        applyVizAppearance(); vizSave();
        openVizSettings();
        toast('已恢复默认设置', 'success');
        break;
      case 'pm-ok': {
        const v = ($('#pm-input') || {}).value || '';
        if (!v.trim()) { toast('名称不能为空', 'error'); return; }
        const cb = state._pmCb;
        closeModal();
        cb && cb(v.trim());
        break;
      }
      case 'cm-ok': { const cb = state._cmCb; closeModal(); cb && cb(); break; }
    }
  });

  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'ne-pick-all') {
      document.querySelectorAll('input[data-nepick]').forEach(x => {
        if (x.closest('.ne-pick-row')?.style.display !== 'none') x.checked = t.checked;
      });
      nePickCount();
      return;
    }
    if (t.matches && t.matches('input[data-nepick]')) { nePickCount(); return; }
    if (t.id === 'viz-color-input') {
      VIZ.color = t.value;
      applyVizColor(); vizSave(); vizMarkSwatch();
      return;
    }
    if (t.id === 'sidebg-input') {
      SIDEBG.color = t.value;
      SIDEBG.mode = 'color';
      applySideBg(); sideBgSave(); sideBgMarkOpts();
      return;
    }
    if (t.id === 'ai-provider') {
      const base = document.getElementById('ai-base');
      const model = document.getElementById('ai-model');
      if (base && model) {
        if (t.value === 'gemini') {
          if (!base.value || /api\.openai\.com/.test(base.value)) base.value = 'https://generativelanguage.googleapis.com';
          if (!model.value || /^gpt-/.test(model.value)) model.value = 'gemini-2.0-flash';
        } else {
          if (!base.value || /generativelanguage\.googleapis\.com/.test(base.value)) base.value = 'https://api.openai.com/v1';
          if (!model.value || /^gemini-/.test(model.value)) model.value = 'gpt-4o-mini';
        }
      }
      return;
    }
    if (t.matches && t.matches('input[type=checkbox][data-action="select"]')) {
      const i = +t.dataset.idx;
      if (t.checked) state.selection.add(i); else state.selection.delete(i);
      const card = t.closest('.card');
      if (card) card.classList.toggle('selected', t.checked);
      renderImportBar();
    }
  });

  $('#search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch(e.target.value.trim());
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (App.tapSync && App.tapSync.active) { tapSyncDone(); return; }
      closeModal(); closePops();
    }
    const tag = (e.target.tagName || '').toLowerCase();
    if (e.code === 'Space' && tag !== 'input' && tag !== 'textarea' && Player.S.track) {
      e.preventDefault();
      if (App.tapSync && App.tapSync.active) { tapSyncMark(); return; }
      Player.toggle();
    }
  });

  // 任何真实交互都尝试恢复音频上下文（波浪可视化依赖它运行）
  document.addEventListener('pointerdown', () => { if (Player.resumeAudio) Player.resumeAudio(); }, { capture: true });

  // 播放页自定义滑杆（拖动实时生效；键支持 bar.height 这类点路径）
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset && t.dataset.viz) {
      const k = t.dataset.viz;
      const spec = VIZ_SLIDERS[k];
      if (!spec) return;
      const raw = parseInt(t.value, 10);
      vizSet(k, spec.toVal(raw));
      const em = document.getElementById('vs-val-' + k.replace('.', '-'));
      if (em) em.textContent = spec.fmt(vizGet(k));
      applyVizAppearance();
      vizSave();
    }
  });

  // 全屏状态变化：同步图标与控制层
  document.addEventListener('fullscreenchange', () => {
    const wrap = $('#np-video-wrap');
    if (!wrap) return;
    const fs = !!document.fullscreenElement;
    wrap.classList.toggle('is-fs', fs);
    const fb = $('#np-ovl-fs');
    if (fb) fb.innerHTML = fs ? ICON.fsExit : ICON.fs;
    pokeOvl();
  });

  // 歌单详情拖拽排序
  document.addEventListener('dragstart', e => {
    const row = e.target.closest && e.target.closest('.prow[draggable]');
    if (!row || state.view.name !== 'pldetail') return;
    state._dragIdx = +row.dataset.idx;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', ''); } catch {}
  });
  document.addEventListener('dragover', e => {
    const row = e.target.closest && e.target.closest('.prow[draggable]');
    if (!row || state._dragIdx === null) return;
    e.preventDefault();
    $$('.prow.dragover').forEach(x => x.classList.remove('dragover'));
    row.classList.add('dragover');
  });
  document.addEventListener('drop', e => {
    const row = e.target.closest && e.target.closest('.prow[draggable]');
    if (!row || state._dragIdx === null || state.view.name !== 'pldetail') return;
    e.preventDefault();
    const to = +row.dataset.idx;
    const pl = state.playlist;
    if (pl && state._dragIdx !== to) {
      const [moved] = pl.items.splice(state._dragIdx, 1);
      pl.items.splice(to, 0, moved);
      savePlaylist(pl).catch(err => errToast(err));
      renderView();
    }
  });
  document.addEventListener('dragend', () => {
    state._dragIdx = null;
    $$('.prow.dragging').forEach(x => x.classList.remove('dragging'));
    $$('.prow.dragover').forEach(x => x.classList.remove('dragover'));
  });
}

function toggleSelect(idx) {
  if (state.selection.has(idx)) state.selection.delete(idx); else state.selection.add(idx);
  const el = $(`#view .card[data-idx="${idx}"]`);
  if (el) el.classList.toggle('selected', state.selection.has(idx));
  renderImportBar();
}

/* ---------- 桌面组件（迷你播放器 / 桌面歌词）跨窗口同步 ----------
   主窗口广播播放状态，组件窗口（Electron置顶窗/浏览器标签）渲染并回传命令 */
const DESK_BC = ('BroadcastChannel' in window) ? new BroadcastChannel('biliplayer') : null;
let deskLast = 0;
function deskBroadcast(force) {
  if (!DESK_BC) return;
  const now = Date.now();
  if (!force && now - deskLast < 400) return;
  deskLast = now;
  const S = Player.S;
  const el = Player.activeEl();
  const lines = (state.lyrics && state.lyrics.lines) || [];
  // 自算当前行：不依赖歌词tab是否打开（桌面歌词任何视图都准确）
  const tNow = el ? (el.currentTime || 0) : 0;
  let li = -1;
  for (let k = 0; k < lines.length; k++) if (lines[k].t <= tNow + 0.25) li = k;
  const line = lines[li] ? lines[li].text : '';
  const lineNext = lines[li + 1] ? lines[li + 1].text : '';
  DESK_BC.postMessage({
    type: 'state',
    title: S.track ? stripEm(S.track.title) : '',
    artist: S.track ? S.track.up || '' : '',
    cover: S.track ? pic(S.track.pic) : '',
    time: el ? (el.currentTime || 0) : 0,
    dur: (isFinite(el && el.duration) && el.duration > 0) ? el.duration : (S.track ? S.track.duration || 0 : 0),
    playing: !!S.playing,
    shuffle: S.playmode === 'random',
    tall: !!(window.__deskTall),
    line, lineNext
  });
}
function deskCommands() {
  if (!DESK_BC) return;
  DESK_BC.onmessage = e => {
    const m = e.data || {};
    if (m.type === 'widget-ready') { deskWidgetOpen[m.kind] = true; return; }
    if (m.type === 'widget-closed') { deskWidgetOpen[m.kind] = false; return; }
    if (m.type !== 'cmd') return;
    if (m.cmd === 'toggle') Player.toggle();
    else if (m.cmd === 'next') { Player.step(1); }
    else if (m.cmd === 'shuffle') { const modes = ['list', 'one', 'random']; const cur = modes.indexOf(S.playmode); Player.setPlaymode(modes[(cur + 1) % 3]); }
    else if (m.cmd === 'mute') { Player.setVolume(Player.volume() > 0 ? 0 : 0.8); AudioFX.setVolume(Player.volume()); }
    else if (m.cmd === 'close-widget') { if (DESK_BC) DESK_BC.postMessage({ type: 'widget-closed', kind: 'widget' }); }
    else if (m.cmd === 'prev') { Player.step(-1); }
    else if (m.cmd === 'seek' && typeof m.pct === 'number') {
      const el = Player.activeEl();
      if (el && isFinite(el.duration) && el.duration > 0) Player.seek(m.pct * el.duration);
    }
    else if (m.cmd === 'layout') { window.__deskTall = !!m.tall; }
  };
}
/* ---------- 播放会话持久化（断点续播） ---------- */
App._sessKey = '';
function saveSession(force) {
  const S = Player.S;
  if (!S.queue.length || S.index < 0 || !S.track) return;
  const el = Player.activeEl();
  const t = el && el.src && isFinite(el.currentTime) && el.currentTime > 0 ? el.currentTime : (S.resumeAt || 0);
  const key = (S.track.bvid || ('n' + S.track.nid)) + '|' + Math.round(t / 2); // 时间变化≥2秒或切歌才真正写盘
  if (!force && key === App._sessKey) return;
  App._sessKey = key;
  try {
    localStorage.setItem('bp.session', JSON.stringify({ queue: S.queue, index: S.index, time: t, slotOrig: S.slotOrig, at: Date.now() }));
  } catch (e) { /* 存储满则放弃本次 */ }
}
function restoreSession() {
  let sess = null;
  try { sess = JSON.parse(localStorage.getItem('bp.session') || 'null'); } catch (e) {}
  if (!sess || !Array.isArray(sess.queue) || !sess.queue.length) return false;
  if (!(sess.index >= 0 && sess.index < sess.queue.length)) return false;
  const it = sess.queue[sess.index];
  if (!it || (!it.bvid && !it.nid)) return false;
  Player.setQueue(sess.queue, sess.index);
  Player.S.slotOrig = sess.slotOrig || null; // 恢复原版记忆
  Player.S.track = it;               // 先把界面填上，媒体等用户点播放再加载
  Player.S.resumeAt = isFinite(sess.time) && sess.time > 1 ? sess.time : 0;
  updateBar(Player.S);
  updatePlayingMarks();
  return true;
}

/* ---------- 弹幕层（云合唱 · canvas） ---------- */
const DM = {
  on: localStorage.getItem('bp.dm') !== '0',
  cid: null, list: [], loading: false,
  cache: new Map(),
  canvas: null, ctx: null, raf: 0, W: 0, H: 0,
  flying: [], lastT: -1, spawnIdx: 0, lastFrame: 0,
  buckets: null
};
async function loadDanmaku(cid) {
  if (!cid || DM.cid === cid) return;
  DM.cid = cid;
  DM.list = DM.cache.get(cid) || [];
  DM.lastT = -1;
  DM.flying.length = 0;
  computeDmHeat();
  drawDmHeat();
  if (DM.cache.has(cid)) { dmMaybeStart(); return; }
  DM.loading = true;
  try {
    const d = await Api.get('danmaku', { cid });
    DM.cache.set(cid, d.list);
    if (DM.cid === cid) {
      DM.list = d.list;
      DM.lastT = -1;
      DM.flying.length = 0;
      computeDmHeat();
      drawDmHeat();
      dmMaybeStart();
    }
  } catch (e) { /* 拉不到弹幕就安静跳过 */ }
  DM.loading = false;
}
function mountDmLayer() {
  if (state.view.name !== 'nowplaying') { dmStop(); return; }
  const host = Player.S.mode === 'video'
    ? document.getElementById('np-video')
    : document.getElementById('np-stage');
  if (!host) { dmStop(); return; }
  let c = document.getElementById('dm-layer');
  if (!c) {
    c = document.createElement('canvas');
    c.id = 'dm-layer';
    c.className = 'dm-layer';
  }
  if (c.parentElement !== host) host.appendChild(c);
  DM.canvas = c;
  DM.ctx = c.getContext('2d');
  dmResize();
  if (DM.on && DM.list.length) dmLoopStart();
  else { dmStop(); DM.ctx.clearRect(0, 0, DM.W, DM.H); }
}
function dmMaybeStart() {
  if (state.view.name === 'nowplaying' && DM.on && DM.list.length && DM.canvas) dmLoopStart();
}
function dmResize() {
  const c = DM.canvas;
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  DM.W = c.clientWidth || 0;
  DM.H = c.clientHeight || 0;
  c.width = Math.max(1, DM.W * dpr);
  c.height = Math.max(1, DM.H * dpr);
  DM.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function dmLoopStart() {
  if (DM.raf) return;
  DM.lastFrame = performance.now();
  const step = () => {
    DM.raf = 0;
    const c = DM.canvas;
    if (!c || !c.isConnected || !DM.on) { dmStop(); return; }
    if (c.clientWidth !== DM.W || c.clientHeight !== DM.H) dmResize();
    dmDraw();
    DM.raf = requestAnimationFrame(step);
  };
  DM.raf = requestAnimationFrame(step);
}
function dmStop() {
  if (DM.raf) cancelAnimationFrame(DM.raf);
  DM.raf = 0;
}
function dmFontScale(size) { return size >= 36 ? 19 : size >= 30 ? 17 : 14.5; }
function dmSpawn(dm) {
  if (DM.flying.length > 48) return;
  const ctx = DM.ctx;
  const fs = dmFontScale(dm.size);
  ctx.font = `600 ${fs}px 'PingFang SC','Microsoft YaHei',sans-serif`;
  const w = Math.ceil(ctx.measureText(dm.text).width) + 4;
  if (dm.mode === 4 || dm.mode === 5) { // 底部/顶部固定弹幕
    if (DM.flying.filter(f => f.fixed && f.mode === dm.mode).length >= 2) return;
    DM.flying.push({ dm, w, mode: dm.mode, fixed: true, age: 0, x: Math.max(4, (DM.W - w) / 2), y: dm.mode === 5 ? 12 : DM.H - fs - 16 });
    return;
  }
  const laneH = fs + 8;
  const lanes = Math.max(1, Math.floor((DM.H - 16) / laneH));
  const tails = new Array(lanes).fill(-1e9);
  DM.flying.forEach(f => {
    if (f.fixed) return;
    const l = Math.min(lanes - 1, Math.max(0, Math.floor(f.y / laneH)));
    tails[l] = Math.max(tails[l], f.x + f.w);
  });
  let lane = -1;
  for (let i = 0; i < lanes; i++) {
    const l = ((dm._lo = (dm._lo || 0) + 1) + i) % lanes;
    if (tails[l] < DM.W - 24) { lane = l; break; }
  }
  if (lane < 0) return; // 泳道全满，丢弃这条
  DM.flying.push({ dm, w, x: DM.W + 4, y: lane * laneH + 4, speed: (DM.W + w) / 8.5 });
}
function dmDraw() {
  const ctx = DM.ctx;
  if (!ctx) return;
  ctx.clearRect(0, 0, DM.W, DM.H);
  if (!DM.on || !DM.list.length) { if (DM.flying.length) DM.flying.length = 0; return; }
  const el = Player.activeEl();
  const t = el.currentTime || 0;
  const now = performance.now();
  const dt = Math.min(50, now - (DM.lastFrame || now)) / 1000;
  DM.lastFrame = now;
  if (DM.lastT < 0 || t < DM.lastT - 0.5) { // 首帧/回跳：重建出生指针
    DM.flying.length = 0;
    let lo = 0, hi = DM.list.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (DM.list[mid].t < t) lo = mid + 1; else hi = mid; }
    DM.spawnIdx = lo;
  } else if (t > DM.lastT + 1.5) { // 快进：跳过中间的弹幕
    DM.flying.length = 0;
    while (DM.spawnIdx < DM.list.length && DM.list[DM.spawnIdx].t <= t) DM.spawnIdx++;
  }
  DM.lastT = t;
  if (Player.S.playing) {
    let born = 0;
    while (DM.spawnIdx < DM.list.length && DM.list[DM.spawnIdx].t <= t && born < 14) {
      dmSpawn(DM.list[DM.spawnIdx++]);
      born++;
    }
    DM.flying.forEach(f => {
      if (f.fixed) { f.age += dt; return; }
      f.x -= f.speed * dt;
    });
    DM.flying = DM.flying.filter(f => (f.fixed ? f.age < 4.2 : f.x + f.w > -10));
  }
  ctx.textBaseline = 'top';
  for (const f of DM.flying) {
    const fs = dmFontScale(f.dm.size);
    ctx.font = `600 ${fs}px 'PingFang SC','Microsoft YaHei',sans-serif`;
    ctx.globalAlpha = f.fixed && f.age > 3.4 ? 0.95 * (4.2 - f.age) / 0.8 : 0.95;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.strokeText(f.dm.text, f.x, f.y);
    ctx.fillStyle = '#' + (f.dm.color || 0xffffff).toString(16).padStart(6, '0');
    ctx.fillText(f.dm.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}
/* 高能热力图：弹幕密度曲线叠在底部进度条上 */
function computeDmHeat() {
  const el = Player.activeEl();
  const dur = (Player.S.track && Player.S.track.duration) || (isFinite(el.duration) && el.duration) || 1;
  const N = 110;
  const b = new Array(N).fill(0);
  for (const d of DM.list) {
    const i = Math.min(N - 1, Math.max(0, Math.floor(d.t / dur * N)));
    b[i]++;
  }
  DM.buckets = b;
}
function drawDmHeat() {
  const c = document.getElementById('dm-heat');
  if (!c) return;
  const track = document.getElementById('pb-track');
  if (!track) return;
  const W = track.clientWidth, H = 22;
  if (!W) return;
  const dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(W * dpr) || !c._sized) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c._sized = true; }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!DM.buckets || !DM.list.length) return;
  const b = DM.buckets;
  const max = Math.max(...b, 1);
  const bw = W / b.length;
  const sorted = [...b].sort((a, x) => x - a);
  const hot = Math.max(2, sorted[Math.floor(sorted.length * 0.08)] || 2); // 前8%的密度算高能
  for (let i = 0; i < b.length; i++) {
    if (!b[i]) continue;
    const v = Math.min(1, b[i] / max);
    const h = 3 + v * (H - 4);
    ctx.fillStyle = b[i] >= hot ? `rgba(${VIZRGB.join(',')},.92)` : `rgba(${VIZRGB.join(',')},.32)`;
    ctx.fillRect(i * bw + 0.5, H - h, Math.max(1, bw - 1.2), h);
  }
}

/* ---------- 版本宇宙（同曲多版本聚合） ---------- */
const VERSIONS = { cache: new Map(), bvid: null, loading: false, core: '', groups: [] };
const VERSION_RULES = [
  { key: 'live', label: '现场 / Live', re: /现场|live|演唱会|音乐节|巡演|concert|tour|再演|音乐现场/i },
  { key: 'mv', label: 'MV / 官方视频', re: /\bmv\b|music video|官方视频|official video|ミュージックビデオ/i },
  { key: 'cover', label: '翻唱 / Cover', re: /翻唱|cover|翻自/i },
  { key: 'inst', label: '伴奏 / 演奏版', re: /伴奏|instrumental|off ?vocal|卡拉 ?ok|karaoke|纯音乐|钢琴版|吉他版|演奏版|piano|管弦乐/i },
  { key: 'remix', label: 'REMIX / 混音 / 8D', re: /remix|混音|bootleg|flip|8d|环绕/i },
  { key: 'pure', label: '纯享版', re: /纯享/ },
  { key: 'remaster', label: '重制 / 修复', re: /remaster|重置版?|修复版?|4k修复|高清修复|重制版?/i }
];
/* 黑名单：CJK词直接子串；ASCII词token边界（修 /mad/i 误伤 Madonna）；
   移除 合集/串烧/medley —— 官方合辑常同时含录音室+live版，是召回目标不是垃圾 */
const VERSION_BLOCK_CJK = /教学|教程|曲谱|琴谱|鼓谱|吉他谱|翻跳|舞蹈|宅舞|跳舞|舞见|reaction|反应|剪辑|卡点|踩点|鬼畜|音mad|沙雕|盘点|乐评|解说|科普|赏析|解读|听懂|合集|串烧|歌单|一小段|唱了一段|弹了一段|哼了一段|片段|切片|弹唱谱|谱子|top\s?\d/i;
const VERSION_BLOCK_TOK = /(^|[^a-z])(mad|amv|medley)([^a-z]|$)/i;
function versionBlocked(title) { return VERSION_BLOCK_CJK.test(title) || VERSION_BLOCK_TOK.test(title); }
const VER_MARK = /(live|现场|演唱会|巡演|音乐节|concert|unplugged|acoustic|翻唱|cover|翻自|歌ってみた|伴奏|instrumental|off\s?vocal|karaoke|纯音乐|钢琴|吉他|演奏|remix|混音|ver\.?|version|tv\s?size|movie|mv|4k|8k|无损|flac|纯享|remaster|修复|重制)/i;
/* 歌名/歌手解析：不再默认"破折号前=歌名"。
   返回 { cores, song, artist, alt, ambiguous }：
   - 《》优先取歌名；歌手从剩余短段提取，有 artistHint（网易云歌手）时按提示裁决
   - 无《》且两段式标题（A - B）：有提示按提示判；无提示标记 ambiguous，由调用方用网易云词典仲裁
   - cores 依次为：主歌名、副顺序歌名（可能其实是歌手，仅作搜索轴）、歌名+歌手 */
function coreSongCandidates(title, artistHint) {
  const s0 = stripEm(title);
  const clean = seg => seg
    .replace(/\b(4k|8k|高清|修复|60帧|120帧|无损|flac|hi-?res|mv|完整版?|官方|现场版?|纯享)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  const normTxt = t => String(t || '').toLowerCase().replace(/\s+/g, '');
  const ah = String(artistHint || '').trim();
  const ahN = normTxt(ah);
  /* 歌名优先级：书名号 > 靠前的直角引号（排除「原声」「纯享」等标记） > 分段 */
  const mBook = s0.match(/《([^》]{2,40})》/);
  let quoteSong = '';
  if (!mBook) {
    const qre = /[「『]([^」』]{2,40})[」』]/g;
    let qm;
    while ((qm = qre.exec(s0))) {
      const inner = qm[1].trim();
      if (SONG_MARKERS.test(inner)) continue;
      if (qm.index > s0.length * 0.28) break; // 只有很靠前的引号才可能是歌名，靠后的多半是巡演名/专辑名
      quoteSong = inner;
      break;
    }
  }
  /* 去括号信息，并把「原声」这类标记引号删掉（歌名引号保留给分段处理） */
  const s = s0
    .replace(/【[^】]*】/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/（[^）]*）/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/《[^》]*》/g, ' ')
    .replace(/[「『]([^」』]{1,20})[」』]/g, (mm, inner) => SONG_MARKERS.test(inner.trim()) ? ' ' : mm);
  /* 分隔符：竖线/带空格的横线/双横线/空格斜杠/中文字符之间的斜杠（丨是汉字"竖"，B站标题常用它当分隔符） */
  const SEP = /\s*[|｜丨]\s*|\s+[-–—]+\s+|\s*--+\s*|\s+\/\s+|(?<=[\u3040-\u30ff\u4e00-\u9fff])\s*\/\s*(?=[\u3040-\u30ff\u4e00-\u9fff])/;
  const prep = seg => seg
    .replace(/^(?:(?:m|track|no\.?|#)\s*[-.:：]?\s*)?\d{1,3}[.\-:：]?\s+/i, ' ') // 去掉 M-01 / 01. / Track 3 之类
    .replace(/^[“"][^”"]{1,40}[”"]\s*/, ' ') // 开头引号噱头
    .replace(/\s+/g, ' ').trim();
  const segs = s.split(SEP).map(clean).map(prep).filter(Boolean);
  let song = '', artist = '', alt = '', ambiguous = false;
  if (mBook) song = mBook[1].trim();
  else if (quoteSong) song = quoteSong.split(/[\/／]/)[0].trim();
  if (song) {
    const cand = segs.filter(x => x !== song && !x.includes(song) && x.length >= 2 && x.length <= 40 && !VER_MARK.test(x));
    artist = cand.length ? artistFromSeg(cand[0]) : '';
    if (quoteSong) {
      const idx = s0.indexOf(quoteSong);
      const after = s0.slice(idx + quoteSong.length).replace(/^[」』]\s*/, ' ').trim();
      const a2 = artistFromSeg(after.slice(0, 40));
      if (a2) artist = a2;
    }
    if (!artist && ahN) {
      const hit = segs.find(x => { const n = normTxt(x); return n && (n.includes(ahN) || ahN.includes(n)); });
      if (hit) artist = artistFromSeg(hit) || '';
    }
  } else if (segs.length >= 2) {
    const a = segs[0], b = segs[1];
    const aN = normTxt(a), bN = normTxt(b);
    const aIsArtist = ahN && aN && (aN.includes(ahN) || ahN.includes(aN));
    const bIsArtist = ahN && bN && (bN.includes(ahN) || ahN.includes(bN));
    if (aIsArtist && !bIsArtist) { song = b; artist = a; }
    else if (bIsArtist && !aIsArtist) { song = a; artist = b; }
    else { song = a; alt = b; ambiguous = true; }
  } else {
    song = segs[0] || '';
  }
  // 网易云曲目：单段标题也把已知歌手补上（用于门控的歌手证据）
  if (!artist && ah && ah.length <= 20) artist = ah;
  if (song.length > 40) song = song.slice(0, 40).trim();
  const out = [];
  const push = k => { k = (k || '').trim(); if (k.length >= 2 && !out.includes(k)) out.push(k); };
  push(song);
  if (alt && alt !== song) push(alt.split(/\s+/).slice(0, 5).join(' '));
  if (song && artist && !artist.includes(song) && !song.includes(artist)) push(song + ' ' + artist);
  return { cores: out.slice(0, 4), song, artist, alt, ambiguous };
}
function classifyVersion(title, it, artistTok) {
  for (const r of VERSION_RULES) if (r.re.test(title)) return r;
  const isStudio = (artistTok && ((it && it.up || '').toLowerCase().includes(artistTok)))
    || /官方|original|本家|official/i.test(title + ' ' + ((it && it.tag) || ''));
  if (isStudio) return { key: 'studio', label: '录音室 / 官方' };
  return { key: 'other', label: '其他版本' };
}
/* 标题相似度：包含=1；否则字符bigram Jaccard（CJK友好）与词Jaccard取max。
   英文词相似度忽略 cover/live 等通用词——否则两个不相干的视频只因都带 "cover" 就满分 */
const TITLE_STOP = new Set(['cover', 'live', 'official', 'audio', 'video', 'full', 'mv', 'ver', 'version', 'remix', 'inst', 'instrumental', 'music', 'lyrics', 'lyric', 'karaoke', 'off', 'vocal', 'hd', 'hq', 'shorts', 'short', 'pv', 'size', 'from', 'the', 'ft', 'feat', 'prod']);
function titleSim(a, b) {
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) return 1;
  const big = t => { const set = new Set(); for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2)); return set; };
  const A = big(a), B = big(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const jac = inter / Math.max(1, A.size + B.size - inter);
  const words = t => t.split(/[^a-z0-9]+/).filter(w => w.length > 1 && !TITLE_STOP.has(w));
  const wa = words(a), wb = words(b);
  let wj = 0;
  if (wa.length && wb.length) { const SB = new Set(wb); const hit = wa.filter(w => SB.has(w)).length; wj = hit / Math.max(wa.length, wb.length); }
  return Math.max(jac, wj);
}
/* 搜索令牌桶：cap=2，每550ms补1个（≈3.6次/秒，B站对搜索限流敏感，宁可慢一点） */
const VER_TK = { tokens: 2, last: Date.now() };
async function verToken() {
  for (;;) {
    const now = Date.now();
    const add = Math.floor((now - VER_TK.last) / 550);
    if (add > 0) { VER_TK.tokens = Math.min(2, VER_TK.tokens + add); VER_TK.last += add * 550; }
    if (VER_TK.tokens > 0) { VER_TK.tokens--; return; }
    await new Promise(r => setTimeout(r, 80));
  }
}
/* 日文新字体→简体 常见字映射：B站标题常把「爆弾魔」写成「爆弹魔」，只靠原字会漏 */
const JP2CN = { '弾': '弹', '霊': '灵', '転': '转', '変': '变', '楽': '乐', '桜': '樱', '涙': '泪', '聴': '听', '鉄': '铁', '図': '图', '広': '广', '気': '气', '駅': '驿', '沢': '泽', '浜': '滨', '絵': '绘', '実': '实', '発': '发', '経': '经', '続': '续', '戦': '战', '単': '单', '売': '卖', '読': '读', '闘': '斗', '竜': '龙', '黒': '黑', '撃': '击', '払': '拂', '仮': '假', '価': '价', '両': '两', '剣': '剑', '剤': '剂', '剰': '剩', '労': '劳', '効': '效', '勧': '劝', '歩': '步', '渉': '涉', '険': '险', '験': '验', '権': '权', '観': '观', '覚': '觉', '伝': '传', '辺': '边', '顔': '颜', '頭': '头', '題': '题', '鳥': '鸟', '魚': '鱼', '馬': '马', '車': '车', '東': '东' };
function jpVariant(s) {
  let out = '', hit = false;
  for (const ch of String(s || '')) { if (JP2CN[ch]) { out += JP2CN[ch]; hit = true; } else out += ch; }
  return hit ? out : '';
}
/* 统一归一化（NFKC/小写/去标点）。注意连字符必须转义：\\- 会被解析成 [\\-–] 范围，把 ASCII 字母全删掉 */
const verNorm = t => stripEm(t).normalize('NFKC').toLowerCase().replace(/[\s\u3000]+/g, '').replace(/[。、・·,.!！?？:：;；'’"“”()（）\[\]【】《》<>「」『』@#%&*+\/\\\-–—_|~～★☆♪♫]/g, '');
/* 网易云版本词典缓存（仲裁与扩展共用，10分钟） */
const verDictCache = new Map();
async function verDict(title, artist) {
  const k = title + '|' + (artist || '');
  const h = verDictCache.get(k);
  if (h && Date.now() - h.at < 10 * 60 * 1000) return h.d;
  const d = await Api.get('nversions', { title: String(title || '').slice(0, 30), artist: String(artist || '').slice(0, 30) }).catch(() => null);
  verDictCache.set(k, { d, at: Date.now() });
  if (verDictCache.size > 40) verDictCache.delete(verDictCache.keys().next().value);
  return d;
}
/* 从标题分段提取歌手名：取第一个"非年份、非版本词"的短词（"ヨルシカ 2025「盗作 再演」LIVE"→ヨルシカ） */
function artistFromSeg(seg) {
  const words = String(seg || '').replace(/[「」『』【】\[\]]/g, ' ').split(/\s+/).filter(Boolean);
  for (const raw of words) {
    const w = raw.replace(/^[-–—_|:：·.,，。'"“”]+|[-–—_|:：·.,，。'"“”]+$/g, '');
    if (w.length < 2 || w.length > 20) continue;
    if (/^(19|20)\d{2}$/.test(w)) continue;
    if (/字幕|歌词|翻译|熟肉|搬运|自制|剪辑|压制|中字/i.test(w)) continue; // 制作信息不是歌手
    if (VER_MARK.test(w)) continue;
    return w;
  }
  return '';
}
/* 引号内是"标记"而非歌名（「原声」「纯享」等） */
const SONG_MARKERS = /^(原声|纯享|完整版|官方|高清|修复|无损|hi-?res|4k|8k|1080p|中日|中字|歌词|动态歌词|字幕|music\s?video|mv|live|现场|完整|片段|试听)$/i;
async function loadVersionsIfNeeded() {
  const S = Player.S;
  const vKey = S.track ? (S.track.bvid || (S.track.nid ? 'n' + S.track.nid : '')) : '';
  if (!S.track || !vKey || VERSIONS.bvid === vKey) return;
  // 切换过版本的槽位：沿用原版的标题上下文搜索，保证版本列表（含原版）不消失
  const so = S.slotOrig;
  const baseTrack = (so && so.slot === S.index && so.item) ? so.item : S.track;
  const artistGuess = ((baseTrack.up || '').trim());
  const cand = coreSongCandidates(baseTrack.title, S.track.nid ? artistGuess : '');
  let cores = cand.cores, song = cand.song, artist = cand.artist;
  if (!cores.length || !song) return;
  VERSIONS.bvid = vKey;
  VERSIONS.groups = [];
  VERSIONS.core = song;
  VERSIONS.stats = null;
  refreshVersionsBadge();
  const cacheKey = vKey;
  if (VERSIONS.cache.has(cacheKey)) {
    const c = VERSIONS.cache.get(cacheKey);
    if (Date.now() - (c.at || 0) < (c.ttl || 30 * 60 * 1000)) {
      VERSIONS.core = c.core;
      VERSIONS.groups = c.groups;
      VERSIONS.stats = c.stats || null;
      VERSIONS.lastRisk = !!(c.stats && (c.stats.risk || c.stats.skipped));
      refreshVersionsBadge();
      return;
    }
    VERSIONS.cache.delete(cacheKey);
  }
  VERSIONS.loading = true;
  try {
    /* ---- 双顺序仲裁：A - B 谁才是歌名（无《》且无歌手提示时，用网易云词典命中数裁决） ---- */
    if (cand.ambiguous && cand.alt && !cand.artist) {
      try {
        const nA = verNorm(cand.song), nB = verNorm(cand.alt);
        const [dA, dB] = await Promise.all([verDict(cand.song, ''), verDict(cand.alt, '')]);
        const cnt = (d, n) => (d && Array.isArray(d.names)) ? d.names.filter(x => verNorm(x).includes(n)).length : 0;
        const sA = dA ? cnt(dA, nA) : 0, sB = dB ? cnt(dB, nB) : 0;
        if (sB > sA + 1) {
          song = cand.alt; artist = artistFromSeg(cand.song);
          cores = [song]; if (artist) cores.push(song + ' ' + artist);
          VERSIONS.core = song;
        } else if (sA > sB + 1) {
          artist = artistFromSeg(cand.alt);
          cores = [song]; if (artist) cores.push(song + ' ' + artist);
        }
      } catch (e) {}
    }
    const pool = [], seen = new Set();
    const POOL_CAP = 400; // 收集阶段不截断（旧版池满会挤掉后续搜索轴）
    const addItems = arr => { for (const it of (arr || [])) { if (it && it.bvid && !seen.has(it.bvid) && pool.length < POOL_CAP) { seen.add(it.bvid); pool.push(it); } } };
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const norm = verNorm;
    const normCore = norm(song);
    /* ---- 关键词扩展：desc原曲 / 网易云版本词典 / B站suggest热词（全部容错） ---- */
    const extraKws = [];
    if (S.track.bvid) {
      try {
        const vd = await Api.get('video', { bvid: S.track.bvid });
        const dm = ((vd && vd.desc) || '').match(/(原曲|original|原唱|作曲)[:：]\s*([^\n,，;；]{2,30})/i);
        if (dm && dm[2]) extraKws.push(dm[2].trim());
      } catch (e) {}
    }
    try {
      const d = await verDict(song, artist || '');
      for (const nm of ((d && d.names) || [])) {
        const cn = stripEm(nm).replace(/\s+/g, ' ').trim();
        if (!cn || norm(cn) === normCore) continue;
        if (VER_MARK.test(cn) || norm(cn).includes(normCore) || normCore.includes(norm(cn))) extraKws.push(cn);
        // 变体词根：剥离括号与版本词后的主干（如"爆弾魔 (Re-Recording)"→"爆弾魔"），解日文/繁简变体
        const stem = cn.replace(/[（(][^）)]*[）)]/g, ' ').replace(new RegExp(VER_MARK.source, 'gi'), ' ').replace(/\s+/g, ' ').trim();
        if (stem && stem !== cn && stem.length >= 2 && !extraKws.includes(stem)) extraKws.push(stem);
        if (extraKws.length >= 8) break;
      }
    } catch (e) {}
    try {
      const sg = await Api.get('suggest', { term: song });
      for (const t of (sg.terms || [])) {
        if (VER_MARK.test(t) || (artist && t.toLowerCase().includes(artist.toLowerCase())) || norm(t).includes(normCore)) extraKws.push(t);
        const stem = t.replace(/[（(][^）)]*[）)]/g, ' ').replace(new RegExp(VER_MARK.source, 'gi'), ' ').replace(/\s+/g, ' ').trim();
        if (stem && stem !== t && stem.length >= 2 && !extraKws.includes(stem)) extraKws.push(stem);
        if (extraKws.length >= 10) break;
      }
    } catch (e) {}
    /* ---- 搜索调度：令牌桶 + 全局预算12次 + 412冷却（风控不原地重试） ---- */
    let calls = 0, riskHit = false, skipped = false;
    const axisStats = { ok: 0, fail: 0, risk: 0 };
    const axisLists = [];
    const doSearch = async (kw, opts, w, tag) => {
      if (calls >= 12) return false;
      if (Date.now() < (VERSIONS.searchCoolUntil || 0)) { skipped = true; return false; }
      calls++;
      const q = Object.assign({ keyword: kw, pn: 1 }, opts || {});
      delete q._w; delete q._tag; delete q._ex;
      let d = null;
      for (let attempt = 0; attempt < 2 && !d; attempt++) {
        await verToken();
        try { d = await Api.get('search', q); }
        catch (e) {
          const code = e && e.code;
          if (code === -412 || code === -352 || (e && e.risk)) {
            VERSIONS.searchCoolUntil = Date.now() + 90 * 1000; // 该端点冷却90秒
            riskHit = true; axisStats.risk++;
            return false;
          }
          if (attempt === 0) await sleep(300 + Math.random() * 500); // 瞬态错误：full jitter 重试一次
        }
      }
      if (d && Array.isArray(d.items) && d.items.length) {
        axisLists.push({ w, items: d.items, tag });
        addItems(d.items);
        axisStats.ok++;
      } else axisStats.fail++;
      if (VERSIONS.bvid !== vKey) throw new Error('abort');
      return true;
    };
    const searchedExtras = [];
    const jobs = [
      { keyword: song, pn: 1, _w: 1.0, _tag: 'core' },
      { keyword: song, tids: 31, _w: 0.85, _tag: 'cover' },   // 翻唱分区
      { keyword: song, tids: 29, _w: 0.8, _tag: 'live' },     // 音乐现场分区
      { keyword: song, tids: 193, _w: 0.8, _tag: 'mv' },      // MV分区
      { keyword: song, pn: 2, _w: 0.9, _tag: 'core2' },
      (cores[1] && cores[1] !== song) ? { keyword: cores[1], pn: 1, _w: 0.75, _tag: 'alt' } : null,
      ...extraKws.slice(0, 2).map((k, i) => ({ keyword: k, pn: 1, _w: i === 0 ? 0.8 : 0.7, _ex: k, _tag: 'alias' })),
      { keyword: song + ' 纯享', pn: 1, _w: 0.6, _tag: 'pure' },
      { keyword: song, order: 'pubdate', _w: 0.6, _tag: 'pubdate' } // 冷门新翻唱
    ].filter(Boolean);
    if (jobs.length < 11) jobs.push({ keyword: song + ' live', pn: 1, _w: 0.65, _tag: 'live2' });
    if (jobs.length < 12) jobs.push({ keyword: song + ' 翻唱', pn: 1, _w: 0.65, _tag: 'cover2' });
    for (const j of jobs) {
      try {
        const ok = await doSearch(j.keyword, j, j._w, j._tag);
        if (ok && j._ex) searchedExtras.push(j._ex);
      } catch (e) { if (String(e.message) === 'abort') return; }
    }
    /* ---- related一跳 + 二跳lite（只对标题命中core的高分种子展开） ---- */
    if (S.track.aid) {
      try {
        const rel = await Api.get('related', { aid: S.track.aid });
        if (rel.items && rel.items.length) { axisLists.push({ w: 0.55, items: rel.items, tag: 'related' }); addItems(rel.items); }
      } catch (e) {}
    }
    const seeds = pool.filter(x => x.aid && x.aid !== S.track.aid && norm(stripEm(x.title)).includes(normCore)).slice(0, 2);
    for (const sd of seeds) {
      try {
        const rel = await Api.get('related', { aid: sd.aid });
        const filt = (rel.items || []).filter(x => norm(stripEm(x.title)).includes(normCore));
        if (filt.length) { axisLists.push({ w: 0.5, items: filt, tag: 'related2' }); addItems(filt); }
      } catch (e) {}
      await sleep(120);
    }
    /* ---- UP主空间回溯：官方live存档/演唱会合集的主来源（免WBI接口，风控低） ---- */
    const artistTok = (artist || '').toLowerCase();
    const upScore = {};
    for (const x of pool) {
      if (!x.upMid || !norm(stripEm(x.title)).includes(normCore)) continue;
      const bonus = artistTok && (x.up || '').toLowerCase().includes(artistTok) ? 1000 : 0;
      upScore[x.upMid] = (upScore[x.upMid] || 0) + 1 + bonus;
    }
    const topUps = Object.keys(upScore).sort((a, b) => upScore[b] - upScore[a]).slice(0, 2);
    for (const mid of topUps) {
      try {
        const d = await Api.get('up/archives', { mid, keyword: song });
        if (d.items && d.items.length) { axisLists.push({ w: 0.65, items: d.items, tag: 'up' }); addItems(d.items); }
      } catch (e) {}
      await sleep(150);
    }
    if (VERSIONS.bvid !== vKey) return; // 途中切歌
    /* ---- RRF 融合：S=Σ w/(60+rank)，命中轴越多越可信（共识奖励） ---- */
    const rrf = new Map(), hitN = new Map();
    for (const L of axisLists) {
      for (let i = 0; i < L.items.length; i++) {
        const it = L.items[i];
        if (!it || !it.bvid) continue;
        rrf.set(it.bvid, (rrf.get(it.bvid) || 0) + L.w / (60 + i + 1));
        hitN.set(it.bvid, (hitN.get(it.bvid) || 0) + 1);
      }
    }
    const fused = b => (rrf.get(b) || 0) * (1 + 0.15 * Math.max(0, (hitN.get(b) || 1) - 1));
    const ordered = pool.slice().sort((a, b) => fused(b.bvid) - fused(a.bvid));
    /* ---- 转载去重：同(UP+时长±2s)或同(标题+时长±2s)，按融合序保留首个 ---- */
    const dedup = new Set();
    const poolD = [];
    for (const it of ordered) {
      const nt = norm(stripEm(it.title));
      const k1 = (it.upMid || '') + ':' + Math.round((it.duration || 0) / 2);
      const k2 = nt + ':' + Math.round((it.duration || 0) / 2);
      if (dedup.has(k1) || dedup.has(k2)) continue;
      dedup.add(k1); dedup.add(k2);
      poolD.push(it);
    }
    /* ---- 门控：标题匹配 + 多证据（歌手/时长/高相似），短核心需两个独立证据 ---- */
    const stripVerMarks = t => t
      .replace(/[（(][^）)]*[）)]/g, mm => (VER_MARK.test(mm) ? ' ' : mm))
      .replace(/【[^】]*】/g, mm => (VER_MARK.test(mm) ? ' ' : mm));
    // 额外词只有"包含歌名核心"的变体才能参与独立匹配；纯歌手/专辑词只用于搜索轴
    const metaSrc = [song].concat(searchedExtras.filter(k => {
      const n = norm(k), nc = norm(song);
      return n && nc && (n.includes(nc) || nc.includes(n));
    }));
    // 日文新字体变体也作为匹配锚（爆弾魔→爆弹魔）
    const jpVar = jpVariant(song);
    if (jpVar && jpVar !== song && !metaSrc.includes(jpVar)) metaSrc.push(jpVar);
    const coreMetas = metaSrc.map(c => {
      const n = norm(c);
      return { n, words: c.split(/\s+/).filter(w => w.length > 1).map(w => w.toLowerCase()), prefix: n.length >= 6 ? n.slice(0, Math.ceil(n.length * 0.6)) : '' };
    });
    const auxWords = cores.slice(1).flatMap(c => c.split(/\s+/).filter(w => w.length > 1).map(w => w.toLowerCase()));
    const srcDur = baseTrack.duration || 0; // 锚定原版时长（切到 live 版后不漂）
    const coreShort = norm(song).length <= 2; // 仅2字以内算"短核心"（冬眠/夏这类歧义大）；3~4字CJK已足够具体
    const groups = {};
    let count = 0;
    const odd = [];
    for (const it of poolD) {
      if (it.bvid === S.track.bvid) continue;
      const title = stripEm(it.title);
      if (versionBlocked(title)) continue;
      const hasVer = VER_MARK.test(title);
      const r = srcDur && it.duration ? it.duration / srcDur : 1;
      const minR = hasVer ? 0.4 : 0.55, maxR = hasVer ? 2.2 : 1.8;
      if (srcDur && it.duration && (r < minR || r > maxR)) continue;
      const nTitle = norm(stripVerMarks(title));
      let matched = false, bestScore = 0, bestSim = 0, via = '';
      for (const cm of coreMetas) {
        if (nTitle.includes(cm.n)) { matched = true; bestSim = 1; via = 'inc:' + cm.n; break; }
        const hits = cm.words.filter(w => nTitle.includes(w)).length;
        if (cm.words.length && hits / cm.words.length >= 0.6) { matched = true; bestSim = Math.max(bestSim, 0.9); via = 'words:' + cm.n; break; }
        if (cm.prefix && nTitle.includes(cm.prefix)) { matched = true; bestSim = Math.max(bestSim, 0.85); via = 'prefix:' + cm.n; break; }
        const sim = titleSim(nTitle, cm.n);
        const durS = (r >= 0.55 && r <= 1.8) ? 1 : (r >= 0.4 && r <= 2.2) ? 0.5 : 0;
        const upHit = artistTok && (it.up || '').toLowerCase().includes(artistTok) ? 1 : 0;
        const auxHit = auxWords.length ? (auxWords.filter(w => nTitle.includes(w)).length / auxWords.length) : 0;
        const tagLow = (it.tag || '').toLowerCase();
        const tagHit = (cm.n.length >= 4 && tagLow.includes(cm.n.slice(0, 6))) || (artistTok && tagLow.includes(artistTok)) ? 1 : 0;
        const hitTitle = /title/.test(it.hit || '') ? 1 : 0;
        bestSim = Math.max(bestSim, sim);
        bestScore = Math.max(bestScore, 0.45 * sim + 0.2 * durS + 0.15 * upHit + 0.1 * tagHit + 0.1 * hitTitle + 0.15 * Math.min(1, auxHit * 2));
      }
      if (!matched && (bestScore < 0.78 || bestSim < 0.65)) continue; // 打分通道（阈值收紧）
      const upL = (it.up || '').toLowerCase(), tagL2 = (it.tag || '').toLowerCase();
      const artistEv = !!(artistTok && (upL.includes(artistTok) || tagL2.includes(artistTok) || (artist && nTitle.includes(norm(artist)))));
      const durClose = !!(srcDur && it.duration && r >= 0.85 && r <= 1.18);
      const durNear = !!(srcDur && it.duration && r >= 0.75 && r <= 1.35);
      const strongSim = bestSim >= 0.85;
      let evOk;
      if (coreShort) {
        // 短歌名歧义大：至少两个独立证据（歌手 / 时长贴合 / 高相似）
        const ev = (artistEv ? 1 : 0) + ((durClose || (hasVer && durNear)) ? 1 : 0) + (strongSim ? 1 : 0);
        evOk = ev >= 2;
      } else {
        evOk = artistEv || durClose || strongSim || (hasVer && durNear);
      }
      if (!evOk) continue;
      if (count >= 120) break;
      if (odd.length < 8 && !nTitle.includes(norm(song))) odd.push({ t: title.slice(0, 50), via, sim: +bestSim.toFixed(2), art: artistEv, durC: durClose, hasVer, r: +r.toFixed(2) });
      const r2 = classifyVersion(title, it, artistTok);
      (groups[r2.key] = groups[r2.key] || { key: r2.key, label: r2.label, items: [] }).items.push(it);
      count++;
    }
    VERSIONS.lastOdd = odd;
    const ORDER = ['live', 'studio', 'mv', 'cover', 'inst', 'remix', 'remaster', 'pure', 'other'];
    const arr = Object.values(groups);
    arr.forEach(g => g.items.sort((a, b) => (b.play || 0) - (a.play || 0)));
    arr.sort((a, b) => (ORDER.indexOf(a.key) - ORDER.indexOf(b.key)) || (b.items.length - a.items.length));
    VERSIONS.groups = arr;
    VERSIONS.stats = { axes: axisStats.ok, fail: axisStats.fail, risk: riskHit, skipped, pool: pool.length, kept: count };
    VERSIONS.lastRisk = riskHit || skipped;
    // 限流/跳过：只缓存5分钟；空结果只缓存1分钟（方便用户点重试）
    const ttl = (riskHit || skipped) ? 5 * 60 * 1000 : (count === 0 ? 60 * 1000 : 30 * 60 * 1000);
    VERSIONS.cache.set(cacheKey, { core: VERSIONS.core, groups: arr, at: Date.now(), ttl, stats: VERSIONS.stats });
  } catch (e) { /* 搜索失败不打扰 */ }
  VERSIONS.loading = false;
  refreshVersionsBadge();
}
/* ---------- 音效面板（预设/均衡器/高级） ---------- */
function fxIsActive() {
  const s = AudioFX.state;
  return s.preset !== 'original' || s.eq.bass !== 0 || s.eq.treble !== 0 || s.eq.bands.some(v => v !== 0) ||
    Math.abs(s.width - 1) > 0.001 || s.env !== 'none' || s.rotate !== 'off' || s.tube > 0 || s.tape > 0 ||
    s.exciter > 0 || s.night || s.pitch !== 0 || s.vocal !== 'normal' || (s.crossfeed || 0) > 0 || (s.crossfeedMid || 0) > 0 || (s.preamp || 0) !== 0 || s.monoBass || Math.abs((s.speed || 1) - 1) > 0.001 || s.bypass || !!s.headphone || (s.deEsser || 0) > 0 || (s.transient || 0) > 0 || (s.transientSustain || 0) > 0 || (s.loudness || 0) > 0 || (s.dynEq || 0) > 0 || (s.reverbDuck || 0) > 0 || Math.abs((s.widthHigh == null ? 1 : s.widthHigh) - 1) > 0.01 || (s.bassExciter || 0) > 0;
}
function fxRefreshBadge() {
  document.querySelectorAll('[data-action="fx-open"]').forEach(b => b.classList.toggle('has', fxIsActive()));
}
function fmtDb(v) { v = +v; return (v > 0 ? '+' : '') + v; }
function audioQualitySetting() { try { return localStorage.getItem('bp.audioQuality') || 'auto'; } catch (e) { return 'auto'; } }
function fxDiagHtml() {
  const d = Player.audioDebug();
  const m = AudioFX.meter();
  const fxd = AudioFX.debug();
  const s = AudioFX.state;
  const t = Player.S.track || {};
  const row = (k, v) => `<div class="fx-diag-row"><span>${esc(k)}</span><b>${esc(String(v))}</b></div>`;
  const lat = d.baseLatency != null ? (d.baseLatency * 1000).toFixed(1) + 'ms' : '—';
  const outLat = d.outputLatency != null ? (d.outputLatency * 1000).toFixed(1) + 'ms' : '—';
  const fxLat = AudioFX.latency ? AudioFX.latency() : { limiter: 0, transient: 0, pitch: 0, totalFx: 0 };
  const bufMs = ((d.baseLatency || 0) + (d.outputLatency || 0)) * 1000;
  const loud = d.activeLoud ? (d.activeLoud.gDb >= 0 ? '+' : '') + d.activeLoud.gDb.toFixed(2) + 'dB' + (d.activeLoud.locked ? ' · 已锁定' : ' · 测量中') + ' · 目标 ' + d.activeLoud.target + ' LUFS' + (d.activeLoud.lufs != null ? ' · 测量 ' + d.activeLoud.lufs + ' LUFS' : '') : '—';
  return '<div class="fx-diag">' +
    row('歌曲', t.name || t.title || '—') +
    row('音质', Player.S.quality || '—') +
    row('采样率', d.sampleRate ? d.sampleRate + 'Hz' : '—') +
    row('缓冲延迟', lat + ' / 输出 ' + outLat) +
    row('总延迟', '≈' + Math.round(fxLat.totalFx + bufMs) + 'ms（音效 ' + fxLat.totalFx + ' + 缓冲 ' + Math.round(bufMs) + '）') +
    row('切歌淡化', (Player.fadeMs() <= 0 ? '近无缝（20ms）' : Player.fadeMs() + 'ms')) +
    row('响度增益', loud) +
    row('性能模式', fxd.perfMode ? '开 · IR 混响 / 动态 EQ 关 / 4x 限制器' : '关') +
    row('原始峰值', d.activeLoud && d.activeLoud.peak ? d.activeLoud.peak.toFixed(3) + ' · 增益上限 ' + (d.activeLoud.peakCapDb >= 0 ? '+' : '') + d.activeLoud.peakCapDb.toFixed(2) + 'dB · 峰值上限 ' + d.activeLoud.peakCeil + 'dBFS' : '—') +
    row('输出峰值', m.peak.toFixed(3) + ' · 最大 ' + m.maxPeak.toFixed(3) + (m.clip ? ' · 削波' : '')) +
    row('峰值限制器', fxd.limiterReady ? 'lookahead 已加载' + (fxd.limiterVer ? ' · ' + fxd.limiterVer : '') + (fxd.limiterPhases ? ' · ' + fxd.limiterPhases + 'x' : '') : '直通/未加载') +
    row('限制器衰减', fxd.limiterGrDb != null ? (fxd.limiterGrDb > -0.05 ? '0dB（未介入）' : fxd.limiterGrDb.toFixed(1) + 'dB') : '—') +
    row('ISP 输入峰值', fxd.limiterPeakMaxDb != null ? 'max ' + fxd.limiterPeakMaxDb.toFixed(2) + ' dBTP · 当前 ' + (fxd.limiterPeakDb != null ? fxd.limiterPeakDb.toFixed(2) : '—') + ' dBTP · 阈值 -1.0（限幅前，8x 近似）' : '—') +
    row('预放大', (s.preamp > 0 ? '+' : '') + (s.preamp || 0) + 'dB') +
    row('预设补偿', (s.presetTrim > 0 ? '+' : '') + (s.presetTrim || 0) + 'dB') +
    row('夜听压缩', s.night ? '强度 ' + Math.round((s.nightAmount == null ? 1 : s.nightAmount) * 100) + '% · 3段 · L/M/H ' + (fxd.nightReduction || [0,0,0]).join(' / ') + 'dB' : '关') +
    row('耳机校准', fxd.headphone ? fxd.headphone.name + ' · ' + fxd.headphone.preamp + 'dB · ' + fxd.headphone.filters + ' filters' : '关') +
    row('自动响度', s.autoLevel ? '开 · ' + (fxd.autoDb >= 0 ? '+' : '') + fxd.autoDb.toFixed(1) + 'dB' : '关') +
    row('交叉馈送', Math.round((s.crossfeed || 0) * 100) + '% · 延迟 ' + (fxd.cfDelayMs != null ? fxd.cfDelayMs : '—') + 'ms / 截止 ' + (fxd.cfFreq != null ? fxd.cfFreq : '—') + 'Hz') +
    row('中频交叉', Math.round((s.crossfeedMid || 0) * 100) + '%') +
    row('去齿音', (s.deEsser || 0) > 0 ? Math.round(s.deEsser * 100) + '% · ' + (fxd.deFreq || 5000) + 'Hz · 高频衰减 ' + (fxd.deReduction || 0) + 'dB · ' + (fxd.deEngine === 'worklet' ? 'worklet' : 'graph') : '关') +
    row('瞬态塑形', (s.transient || 0) > 0 || (s.transientSustain || 0) > 0 ? '打击 ' + Math.round((s.transient || 0) * 100) + '% · 收敛 ' + Math.round((s.transientSustain || 0) * 100) + '% · ' + (s.transientHigh ? '仅高频' : '全频') + ' ' + (fxd.transientFreq || 2000) + 'Hz · ' + (fxd.transientReady ? '已加载/2ms 前视' : '未加载/直通') : '关') +
    row('等响度补偿', (s.loudness || 0) > 0 ? Math.round(s.loudness * 100) + '% · 音量 ' + Math.round((fxd.volLevel || 0) * 100) + '% · 低音 ' + (fxd.loudBass >= 0 ? '+' : '') + fxd.loudBass + 'dB / 高音 ' + (fxd.loudTreble >= 0 ? '+' : '') + fxd.loudTreble + 'dB' : '关') +
    row('动态 EQ', (s.dynEq || 0) > 0 ? Math.round(s.dynEq * 100) + '% · ' + (fxd.dynEqReady ? 'L/M/H ' + (fxd.dynEqGr || [0,0,0]).join(' / ') + 'dB' : '加载中/未加载') : '关') +
    row('低频激励', (s.bassExciter || 0) > 0 ? Math.round(s.bassExciter * 100) + '% · ' + (fxd.bassFreq || 120) + 'Hz · drive ' + (fxd.bassDrive != null ? fxd.bassDrive : '—') + 'x · wet ' + (fxd.bassWet != null ? fxd.bassWet : '—') : '关') +
    row('混响引擎', fxd.fdnReady ? (fxd.reverbEngine === 'fdn' ? 'FDN 算法' : '卷积 IR') : '卷积 IR（FDN 加载中/失败）') +
    row('混响湿声', fxd.wet ? '前延迟 ' + (fxd.envPreMs != null ? fxd.envPreMs : '—') + 'ms · HP ' + fxd.wetHp + 'Hz / LP ' + Math.round(fxd.wetLp / 1000) + 'kHz · 湿量 ' + fxd.wet : '关') +
    row('早期反射', fxd.fdnParams ? Math.round(fxd.fdnParams.erMix * 100) + '%' : '—') +
    row('混响避让', (s.reverbDuck || 0) > 0 ? Math.round(s.reverbDuck * 100) + '% · ' + (fxd.duckReady ? (fxd.duckDb > -0.05 ? '未介入' : fxd.duckDb.toFixed(1) + 'dB') : '加载中/未加载') : '关') +
    row('低频单声道', s.monoBass ? '开' : '关') +
    row('高频宽度', Math.round((s.widthHigh == null ? 1 : s.widthHigh) * 100) + '% · 高频侧 ' + (fxd.sideHigh >= 0 ? '+' : '') + (fxd.sideHigh != null ? fxd.sideHigh : '—') + 'dB') +
    row('当前预设', s.preset || 'original') +
    row('A/B 旁通', s.bypass ? '开（只听原声）' : '关') +
    row('变调', (s.pitch ? (s.pitch > 0 ? '+' : '') + s.pitch + ' 半音' : '关') + ' · 引擎 ' + (fxd.pitchEngine || 'soundtouch') + (fxd.pitchMetrics && fxd.pitchMetrics.latency ? ' ' + fxd.pitchMetrics.latency + 's' : '') + ' · underrun ' + fxd.pitchMetrics.underrunCount + ' · 缓冲 ' + fxd.pitchMetrics.framesBuffered) +
    '</div>' +
    '<div class="fx-advrow"><button class="btn" data-fxdiag-refresh>刷新</button><button class="btn" data-fxdiag-reset>重置峰值</button><button class="btn" data-fxdiag-selftest>限制器自检</button></div>' +
    '<div class="fx-note">响度增益受原始峰值约束（不超过 -1.5dBFS），避免为拉响而让末级限制器持续压缩；输出峰值超过 1.000 才说明限幅仍未压住。</div>';
}
function fxTabHtml(tab) {
  const S = AudioFX.state;
  if (tab === 'presets') {
    const cur = AudioFX.state.preset;
    const customs = AudioFX.listCustomPresets();
    const curCustomId = String(cur || '').startsWith('custom:') ? String(cur).slice(7) : '';
    const curCustom = customs.find(x => x.id === curCustomId);
    const customTip = curCustom
      ? '<div class="fx-custom-tip">当前为自定义预设：<b>' + esc(curCustom.name) + '</b></div>'
      : (cur === 'custom' ? '<div class="fx-custom-tip">当前为自定义组合（滑杆/下拉改动过）——点任意卡片可整体切换</div>' : '');
    const bypassTip = '<div class="fx-advrow"><button class="btn" data-fxbypass>' + (AudioFX.state.bypass ? '取消旁通（恢复音效）' : 'A/B 旁通（听原声）') + '</button><span style="font-size:11px;color:var(--t3)">旁通只绕过音效，不改音量/响度归一</span></div>';
    const customHtml = '<div class="fx-custom">' +
      '<div class="fx-custom-head">自定义预设</div>' +
      '<div class="fx-custom-save"><input id="fx-custom-name" maxlength="24" placeholder="给当前音效起个名字"><button class="btn" data-fxc-save>保存当前</button></div>' +
      '<div class="fx-advrow"><button class="btn" data-fxc-export>导出预设</button><button class="btn" data-fxc-import>导入预设</button></div>' +
      (customs.length
        ? '<div class="fx-custom-list">' + customs.map(x =>
            '<div class="fx-custom-item' + (x.id === curCustomId ? ' active' : '') + '"><span>' + esc(x.name) + '</span>' +
            '<button class="btn" data-fxc-apply="' + x.id + '">应用</button><button class="btn" data-fxc-del="' + x.id + '">删除</button></div>').join('') + '</div>'
        : '<div class="fx-note">还没有保存的自定义预设。</div>') +
      '</div>';
    return bypassTip + customTip + customHtml + '<div class="fx-cards">' + Object.entries(AudioFX.PRESETS).map(([k, p]) => `
      <div class="fx-card ${cur === k ? 'active' : ''}" data-fxp="${k}">
        <div class="fx-card-name">${esc(p.label)}${cur === k ? ' ✓' : ''}</div>
        <div class="fx-card-desc">${esc(p.desc)}</div>
      </div>`).join('') + '</div>' +
      '<div class="fx-note">点卡片即生效；滑杆细调在「均衡器」「高级」页。戴耳机体验环绕类效果更佳。</div>';
  }
  if (tab === 'eq') {
    const hp = AudioFX.state.headphone;
    const hpActive = hp
      ? '<div class="fx-hp-active">当前校准：<b>' + esc(hp.name) + '</b> · ' + esc(hp.source || 'custom') + ' · Preamp ' + hp.preamp + 'dB · ' + hp.filters.length + ' filters<button class="btn" data-fxhp-clear>关闭</button></div>'
      : '<div class="fx-hp-active">未开启耳机校准</div>';
    const hpAmountVal = hp ? (hp.amount == null ? 1 : hp.amount) : 1;
    const hpAmount = hp ? '<div class="fx-hp-amount">强度 <input type="range" min="0" max="1" step="0.05" value="' + hpAmountVal + '" data-fxhp-amount><b>' + Math.round(hpAmountVal * 100) + '%</b></div>' : '';
    const envP = AudioFX.ENV_PRESETS[AudioFX.state.env] || AudioFX.ENV_PRESETS.hall;
    const fsz = AudioFX.state.fdnSize != null ? AudioFX.state.fdnSize : envP.size;
    const fdc = AudioFX.state.fdnDecay != null ? AudioFX.state.fdnDecay : envP.decay;
    const fdp = AudioFX.state.fdnDamping != null ? AudioFX.state.fdnDamping : (envP.damping != null ? envP.damping : 0.3);
    const fer = AudioFX.state.fdnEr != null ? AudioFX.state.fdnEr : 0.3;
    const fdnCtl = AudioFX.state.fdnReverb !== false
      ? '<div class="fx-advrow">FDN 大小<input type="range" min="0.5" max="1.5" step="0.05" value="' + fsz + '" data-fxkind="fdnSize"><b class="fx-fsz">' + Number(fsz).toFixed(2) + '</b></div>' +
        '<div class="fx-advrow">FDN 衰减<input type="range" min="0.5" max="8" step="0.1" value="' + fdc + '" data-fxkind="fdnDecay"><b class="fx-fdc">' + Number(fdc).toFixed(1) + 's</b></div>' +
        '<div class="fx-advrow">FDN 阻尼<input type="range" min="0" max="1" step="0.05" value="' + fdp + '" data-fxkind="fdnDamping"><b class="fx-fdp">' + Math.round(fdp * 100) + '%</b></div>' +
        '<div class="fx-advrow">早期反射<input type="range" min="0" max="1" step="0.05" value="' + fer + '" data-fxkind="fdnEr"><b class="fx-fer">' + Math.round(fer * 100) + '%</b></div>' +
        '<div class="fx-advrow"><button class="btn" data-fxfdn-auto>跟随预设参数</button></div>'
      : '';
    const duckVal = AudioFX.state.reverbDuck || 0;
    const duckCtl = AudioFX.state.env !== 'none'
      ? '<div class="fx-advrow">混响避让<input type="range" min="0" max="1" step="0.05" value="' + duckVal + '" data-fxkind="reverbDuck"><b class="fx-rdv">' + Math.round(duckVal * 100) + '%</b></div>'
      : '';
    const preVal = AudioFX.state.envPre != null ? Math.round(AudioFX.state.envPre) : Math.round(envP.pre * 1000);
    const preCtl = AudioFX.state.env !== 'none'
      ? '<div class="fx-advrow">混响前延迟<input type="range" min="0" max="120" step="1" value="' + preVal + '" data-fxkind="envPre"><b class="fx-pre">' + preVal + 'ms</b></div>' +
        '<div class="fx-advrow"><button class="btn" data-fxpre-auto>跟随预设前延迟</button></div>'
      : '';
    const hpBlock = '<div class="fx-hp">' +
      '<div class="fx-hp-head">耳机校准 <span>AutoEQ · MIT</span></div>' +
      hpActive + hpAmount +
      '<div class="fx-hp-search"><input id="fx-hp-q" placeholder="搜索型号，如 Sony WH-1000XM4"><button class="btn" data-fxhp-search>搜索</button></div>' +
      '<div id="fx-hp-results" class="fx-hp-results"></div>' +
      '<div class="fx-note">也可直接粘贴 AutoEQ 的 ParametricEQ.txt；校准开启时自动响度暂停，A/B 旁通按 Preamp 等响。</div>' +
      '<textarea id="fx-hp-text" placeholder="Preamp: -6.1 dB&#10;Filter 1: ON PK Fc 105 Hz Gain -4.2 dB Q 0.70"></textarea>' +
      '<div class="fx-advrow"><button class="btn" data-fxhp-import>导入参数</button><button class="btn" data-fxhp-clear>清除校准</button></div>' +
      '</div>';
    const sec = (title, body, open) => '<details class="fx-sec"' + (open ? ' open' : '') + '><summary>' + title + '</summary><div class="fx-sec-body">' + body + '</div></details>';
    const eqBody = '<div class="fx-eqrow">' + AudioFX.EQ_FREQS.map((f, i) => `
      <div class="fx-vslider">
        <span class="fx-val">${fmtDb(AudioFX.state.eq.bands[i])}</span>
        <input type="range" min="-12" max="12" step="1" value="${AudioFX.state.eq.bands[i] || 0}" data-fxband="${i}">
        <span class="fx-freq">${f >= 1000 ? (f / 1000) + 'k' : f}</span>
      </div>`).join('') + '</div>' +
      '<div class="fx-shelv">' +
        '<label>低音 <input type="range" min="-10" max="10" step="0.5" value="' + AudioFX.state.eq.bass + '" data-fxkind="eqbass"><b class="fx-bv">' + fmtDb(AudioFX.state.eq.bass) + '</b></label>' +
        '<label>高音 <input type="range" min="-10" max="10" step="0.5" value="' + AudioFX.state.eq.treble + '" data-fxkind="eqtreble"><b class="fx-tv">' + fmtDb(AudioFX.state.eq.treble) + '</b></label>' +
      '</div>';
    const tf = AudioFX.state.transientFreq == null ? 2000 : AudioFX.state.transientFreq;
    const df = AudioFX.state.deFreq == null ? 5000 : AudioFX.state.deFreq;
    const bf = AudioFX.state.bassFreq == null ? 120 : AudioFX.state.bassFreq;
    const dynBandDefs = [
      ['Low', '低频', 180, 80, 300, 0.9, 0.4, 3, -11, -24, -4],
      ['Mid', '中频', 1200, 600, 2000, 1.3, 0.4, 3, -13, -24, -4],
      ['High', '高频', 3500, 2000, 6000, 1.2, 0.4, 3, -15, -24, -4]
    ];
    const dynBandHtml = dynBandDefs.map(([k, label, f, fmin, fmax, q, qmin, qmax, th, thmin, thmax]) => {
      const fv = AudioFX.state['dynEqF' + k] == null ? f : AudioFX.state['dynEqF' + k];
      const qv = AudioFX.state['dynEqQ' + k] == null ? q : AudioFX.state['dynEqQ' + k];
      const thv = AudioFX.state['dynEqTh' + k] == null ? th : AudioFX.state['dynEqTh' + k];
      const lk = k.toLowerCase();
      return '<div class="fx-shelv">' +
        '<label>' + label + ' 频率 <input type="range" min="' + fmin + '" max="' + fmax + '" step="' + (k === 'Low' ? 5 : 25) + '" value="' + fv + '" data-fxkind="dynEqF' + k + '"><b class="fx-df' + lk + '">' + fv + 'Hz</b></label>' +
        '<label>' + label + ' Q <input type="range" min="' + qmin + '" max="' + qmax + '" step="0.05" value="' + qv + '" data-fxkind="dynEqQ' + k + '"><b class="fx-dq' + lk + '">' + Number(qv).toFixed(2) + '</b></label>' +
        '<label>' + label + ' 阈值 <input type="range" min="' + thmin + '" max="' + thmax + '" step="1" value="' + thv + '" data-fxkind="dynEqTh' + k + '"><b class="fx-dt' + lk + '">' + thv + 'dB</b></label>' +
      '</div>';
    }).join('');
    const dynBody = '<div class="fx-shelv">' +
        '<label>瞬态打击 <input type="range" min="0" max="1" step="0.05" value="' + (AudioFX.state.transient || 0) + '" data-fxkind="transient"><b class="fx-trv">' + Math.round((AudioFX.state.transient || 0) * 100) + '%</b></label>' +
        '<label>尾音收敛 <input type="range" min="0" max="1" step="0.05" value="' + (AudioFX.state.transientSustain || 0) + '" data-fxkind="transientSustain"><b class="fx-tsv">' + Math.round((AudioFX.state.transientSustain || 0) * 100) + '%</b></label>' +
        '<label>等响度补偿 <input type="range" min="0" max="1" step="0.05" value="' + (AudioFX.state.loudness || 0) + '" data-fxkind="loudness"><b class="fx-ldv">' + Math.round((AudioFX.state.loudness || 0) * 100) + '%</b></label>' +
      '</div>' +
      '<label class="fx-tgl">瞬态仅高频（避免低频抽吸，含 2ms 前视）<input type="checkbox" data-fxkind="transientHigh"' + (AudioFX.state.transientHigh ? ' checked' : '') + '></label>' +
      '<div class="fx-shelv">' +
        '<label>动态 EQ <input type="range" min="0" max="1" step="0.05" value="' + (AudioFX.state.dynEq || 0) + '" data-fxkind="dynEq"><b class="fx-deqv">' + Math.round((AudioFX.state.dynEq || 0) * 100) + '%</b></label>' +
        '<label>低频激励 <input type="range" min="0" max="1" step="0.05" value="' + (AudioFX.state.bassExciter || 0) + '" data-fxkind="bassExciter"><b class="fx-bev">' + Math.round((AudioFX.state.bassExciter || 0) * 100) + '%</b></label>' +
        '<label>去齿音 <input type="range" min="0" max="1" step="0.05" value="' + (AudioFX.state.deEsser || 0) + '" data-fxkind="deEsser"><b class="fx-dev">' + Math.round((AudioFX.state.deEsser || 0) * 100) + '%</b></label>' +
      '</div>' +
      '<div class="fx-shelv">' +
        '<label>低频 180Hz <input type="range" min="0" max="1" step="0.05" value="' + (AudioFX.state.dynEqLow == null ? 1 : AudioFX.state.dynEqLow) + '" data-fxkind="dynEqLow"><b class="fx-deql">' + Math.round((AudioFX.state.dynEqLow == null ? 1 : AudioFX.state.dynEqLow) * 100) + '%</b></label>' +
        '<label>中频 1.2k <input type="range" min="0" max="1" step="0.05" value="' + (AudioFX.state.dynEqMid == null ? 1 : AudioFX.state.dynEqMid) + '" data-fxkind="dynEqMid"><b class="fx-deqm">' + Math.round((AudioFX.state.dynEqMid == null ? 1 : AudioFX.state.dynEqMid) * 100) + '%</b></label>' +
        '<label>高频 3.5k <input type="range" min="0" max="1" step="0.05" value="' + (AudioFX.state.dynEqHigh == null ? 1 : AudioFX.state.dynEqHigh) + '" data-fxkind="dynEqHigh"><b class="fx-deqh">' + Math.round((AudioFX.state.dynEqHigh == null ? 1 : AudioFX.state.dynEqHigh) * 100) + '%</b></label>' +
      '</div>' +
      '<details class="fx-sub"><summary>分频点 / 高级参数</summary><div class="fx-shelv">' +
        '<label>瞬态分频 <input type="range" min="1000" max="4000" step="100" value="' + tf + '" data-fxkind="transientFreq"><b class="fx-tfq">' + tf + 'Hz</b></label>' +
        '<label>去齿音分频 <input type="range" min="4000" max="8000" step="250" value="' + df + '" data-fxkind="deFreq"><b class="fx-dfq">' + df + 'Hz</b></label>' +
        '<label>低频截止 <input type="range" min="80" max="160" step="5" value="' + bf + '" data-fxkind="bassFreq"><b class="fx-bfq">' + bf + 'Hz</b></label>' +
      '</div>' +
      '<div class="fx-sub-title">动态 EQ 每段参数</div>' + dynBandHtml +
      '</details>' +
      '<label class="fx-tgl">低频单声道（&lt;120Hz）<input type="checkbox" data-fxkind="monoBass"' + (AudioFX.state.monoBass ? ' checked' : '') + '></label>';
    const spaceBody = '<div class="fx-shelv">' +
        '<label>环绕强度 <input type="range" min="0" max="1.5" step="0.05" value="' + AudioFX.state.width + '" data-fxkind="width"><b class="fx-wv">' + Math.round(AudioFX.state.width * 100) + '%</b></label>' +
        '<label>环绕深度 <input type="range" min="0" max="1" step="0.05" value="' + AudioFX.state.depth + '" data-fxkind="depth"><b class="fx-dv">' + Math.round(AudioFX.state.depth * 100) + '%</b></label>' +
        '<label>高频宽度 <input type="range" min="0.5" max="1.5" step="0.05" value="' + (AudioFX.state.widthHigh == null ? 1 : AudioFX.state.widthHigh) + '" data-fxkind="widthHigh"><b class="fx-whv">' + Math.round((AudioFX.state.widthHigh == null ? 1 : AudioFX.state.widthHigh) * 100) + '%</b></label>' +
      '</div>' +
      '<div class="fx-shelv">' +
        '<label>耳机交叉馈送 <input type="range" min="0" max="1" step="0.05" value="' + (AudioFX.state.crossfeed || 0) + '" data-fxkind="crossfeed"><b class="fx-cfv">' + Math.round((AudioFX.state.crossfeed || 0) * 100) + '%</b></label>' +
        '<label>中频交叉 <input type="range" min="0" max="1" step="0.05" value="' + (AudioFX.state.crossfeedMid || 0) + '" data-fxkind="crossfeedMid"><b class="fx-cfmv">' + Math.round((AudioFX.state.crossfeedMid || 0) * 100) + '%</b></label>' +
      '</div>' +
      '<div class="fx-shelv">' +
        '<label>交叉延迟 <input type="range" min="0.1" max="0.6" step="0.05" value="' + (AudioFX.state.cfDelay == null ? 0.3 : AudioFX.state.cfDelay) + '" data-fxkind="cfDelay"><b class="fx-cfd">' + (AudioFX.state.cfDelay == null ? 0.3 : AudioFX.state.cfDelay) + 'ms</b></label>' +
        '<label>交叉截止 <input type="range" min="400" max="1000" step="25" value="' + (AudioFX.state.cfFreq == null ? 700 : AudioFX.state.cfFreq) + '" data-fxkind="cfFreq"><b class="fx-cff">' + (AudioFX.state.cfFreq == null ? 700 : AudioFX.state.cfFreq) + 'Hz</b></label>' +
      '</div>' +
      '<div class="fx-advrow"><button class="btn" data-fxbs2b>BS2B 标准（0.3ms / 700Hz / 45%）</button></div>';
    const reverbBody = '<div class="fx-envrow">环境音效<select id="fx-env">' +
        [['none', '无'], ['bathroom', '浴室'], ['room', '客厅'], ['theatre', '剧院'], ['hall', '音乐厅'], ['church', '教堂']].map(([v, n2]) =>
          '<option value="' + v + '"' + (AudioFX.state.env === v ? ' selected' : '') + '>' + n2 + '</option>').join('') +
      '</select><button class="btn" data-fxreset="eq">重置</button></div>' +
      '<label class="fx-tgl">算法混响（FDN·实验）<input type="checkbox" data-fxkind="fdnReverb"' + (AudioFX.state.fdnReverb !== false ? ' checked' : '') + '></label>' +
      fdnCtl + preCtl + duckCtl +
      '<div class="fx-note">环绕强度=声场宽度；环绕深度=空间混响量。环境音效选「无」即关闭混响；FDN 含早期反射，湿声已做 180Hz 低切与 10kHz 柔化。</div>';
    return sec('耳机校准', hpBlock, false) + sec('均衡', eqBody, true) + sec('动态', dynBody, true) + sec('空间', spaceBody, false) + sec('混响', reverbBody, false);
  }
  if (tab === 'diag') return fxDiagHtml();
  // adv
  return '<div class="fx-advrow">倍速<input type="range" min="0.5" max="2" step="0.05" value="' + AudioFX.state.speed + '" data-fxkind="speed">' +
    '<b class="fx-sv">' + (AudioFX.state.speed || 1).toFixed(2) + 'x</b>' +
    [0.75, 1, 1.25, 1.5, 2].map(v => '<button class="btn" data-fxspeed="' + v + '">' + v + 'x</button>').join('') + '</div>' +
    '<label class="fx-tgl">夜听模式（3 段压缩，小声更清楚）<input type="checkbox" data-fxkind="night"' + (AudioFX.state.night ? ' checked' : '') + '></label>' +
    '<div class="fx-advrow">夜听强度<input type="range" min="0" max="1" step="0.05" value="' + (AudioFX.state.nightAmount == null ? 1 : AudioFX.state.nightAmount) + '" data-fxkind="nightAmount"><b class="fx-nav">' + Math.round((AudioFX.state.nightAmount == null ? 1 : AudioFX.state.nightAmount) * 100) + '%</b></div>' +
    '<label class="fx-tgl">省电模式（IR 混响 / 关动态 EQ / 4x 限制器）<input type="checkbox" data-fxkind="perfMode"' + (AudioFX.state.perfMode ? ' checked' : '') + '></label>' +
    '<div class="fx-advrow">目标响度<select id="fx-loud-target">' +
      [-12, -14, -16, -18].map(v => '<option value="' + v + '"' + (Math.abs(Player.loudTarget() - v) < 0.01 ? ' selected' : '') + '>' + v + ' LUFS</option>').join('') +
    '</select>峰值上限<select id="fx-loud-peak">' +
      [-1.5, -2, -3].map(v => '<option value="' + v + '"' + (Math.abs(Player.loudPeakCeil() - v) < 0.01 ? ' selected' : '') + '>' + v + ' dBFS</option>').join('') +
    '</select></div>' +
    '<div class="fx-note">目标响度只影响逐轨归一；峰值上限为采样峰值，真峰值由末级限制器兜底。</div>' +
    '<div class="fx-advrow">切歌淡入淡出<input type="range" min="0" max="3000" step="100" value="' + Player.fadeMs() + '" data-fxkind="fadeMs"><b class="fx-fms">' + (Player.fadeMs() <= 0 ? '近无缝' : Player.fadeMs() + 'ms') + '</b></div>' +
    '<div class="fx-note">0=近无缝（20ms 微淡化防爆音）；自动切歌的淡化不会超过剩余时长。</div>' +
    '<label class="fx-tgl">变调（实验·升降key）<input type="range" min="-6" max="6" step="1" value="' + AudioFX.state.pitch + '" data-fxkind="pitch"><b class="fx-pv">' + (AudioFX.state.pitch > 0 ? '+' : '') + AudioFX.state.pitch + '</b></label>' +
    '<label class="fx-tgl">高质量变调引擎（Signalsmith·实验·延迟更高）<input type="checkbox" data-fxpengine' + (localStorage.getItem('bp.pitchEngine') === 'signalsmith' ? ' checked' : '') + '></label>' +
    '<div class="fx-advrow">人声<select id="fx-vocal">' +
      [['normal', '正常'], ['center', '人声突出（实验）'], ['side', '消人声（实验）']].map(([v, n2]) =>
        '<option value="' + v + '"' + (AudioFX.state.vocal === v ? ' selected' : '') + '>' + n2 + '</option>').join('') +
    '</select></div>' +
    '<div class="fx-advrow">预放大<input type="range" min="-12" max="6" step="1" value="' + (AudioFX.state.preamp || 0) + '" data-fxkind="preamp"><b class="fx-pgv">' + ((AudioFX.state.preamp || 0) > 0 ? '+' : '') + (AudioFX.state.preamp || 0) + 'dB</b></div>' +
    '<label class="fx-tgl">音效自动响度（慢速，防预设音量跳变）<input type="checkbox" data-fxkind="autoLevel"' + (AudioFX.state.autoLevel ? ' checked' : '') + '></label>' +
    '<div class="fx-advrow">网易云音质<select id="fx-quality">' +
      [['auto', '自动（按网络）'], ['hires', 'Hi-Res（实验·文件较大）'], ['lossless', '自动无损（推荐）'], ['320', '320kbps'], ['192', '192kbps'], ['128', '128kbps']].map(([v, n2]) =>
        '<option value="' + v + '"' + (audioQualitySetting() === v ? ' selected' : '') + '>' + n2 + '</option>').join('') +
    '</select><span style="font-size:11px;color:var(--t3)">下一首生效</span></div>' +
    '<label class="fx-tgl">看视频 DASH 1080p（实验·双流同步）<input type="checkbox" data-bpdashvideo' + (localStorage.getItem('bp.dashVideo') === '1' ? ' checked' : '') + '></label>' +
    '<div class="fx-advrow"><button class="btn" data-fxreset="all">全部恢复默认</button></div>' +
    '<div class="fx-note">倍速≠1.00 时无缝切换自动改用高兼容路径（精度略降）；变调组件加载失败会自动还原为0。</div>';
}
function bindFxEvents(tab, rerender) {
  const body = document.getElementById('fx-body');
  if (!body) return;
  if (tab === 'diag') {
    const rf = body.querySelector('[data-fxdiag-refresh]');
    if (rf) rf.onclick = rerender;
    const rs = body.querySelector('[data-fxdiag-reset]');
    if (rs) rs.onclick = () => { AudioFX.resetMeter(); rerender(); };
    const st = body.querySelector('[data-fxdiag-selftest]');
    if (st) st.onclick = async () => {
      st.disabled = true; st.textContent = '自检中…';
      const r = await AudioFX.selfTest();
      st.disabled = false; st.textContent = '限制器自检';
      if (r.ok) toast('限制器自检通过：热峰 ' + r.hot + ' / 低峰 ' + r.low, 'success');
      else toast('限制器自检失败：' + (r.error || ('热峰 ' + r.hot + ' / 低峰 ' + r.low)), 'error');
      rerender();
    };
    return;
  }
  if (tab === 'presets') {
    const bb = body.querySelector('[data-fxbypass]');
    if (bb) bb.onclick = () => { AudioFX.set({ bypass: !AudioFX.state.bypass }); fxRefreshBadge(); rerender(); };
    body.querySelectorAll('[data-fxp]').forEach(c => c.onclick = () => { AudioFX.setPreset(c.dataset.fxp); fxRefreshBadge(); rerender(); });
    const cSave = body.querySelector('[data-fxc-save]');
    if (cSave) cSave.onclick = () => {
      const inp = body.querySelector('#fx-custom-name');
      const id = AudioFX.saveCustomPreset(inp && inp.value);
      if (!id) { toast('请输入预设名称', 'error'); return; }
      toast('已保存自定义预设', 'success'); fxRefreshBadge(); rerender();
    };
    body.querySelectorAll('[data-fxc-apply]').forEach(b => b.onclick = () => {
      if (AudioFX.applyCustomPreset(b.dataset.fxcApply)) { toast('已应用自定义预设', 'success'); fxRefreshBadge(); rerender(); }
    });
    body.querySelectorAll('[data-fxc-del]').forEach(b => b.onclick = () => {
      if (!confirm('删除这个自定义预设？')) return;
      AudioFX.deleteCustomPreset(b.dataset.fxcDel); fxRefreshBadge(); rerender();
    });
    const cExport = body.querySelector('[data-fxc-export]');
    if (cExport) cExport.onclick = () => {
      try {
        const blob = new Blob([AudioFX.exportCustomPresets()], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'bili-fx-presets.json'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('已导出自定义预设', 'success');
      } catch (e) { toast('导出失败：' + ((e && e.message) || e), 'error'); }
    };
    const cImport = body.querySelector('[data-fxc-import]');
    if (cImport) cImport.onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        if (!f) return;
        try {
          const n = AudioFX.importCustomPresets(await f.text());
          toast('已导入 ' + n + ' 个自定义预设', 'success');
          fxRefreshBadge(); rerender();
        } catch (e) { toast('导入失败：' + ((e && e.message) || e), 'error'); }
      };
      inp.click();
    };
  }
  if (tab === 'eq') {
    body.querySelectorAll('[data-fxband]').forEach(inp => inp.oninput = () => {
      const bands = AudioFX.state.eq.bands.slice();
      bands[+inp.dataset.fxband] = +inp.value;
      AudioFX.setEq({ bands });
      const v = inp.parentElement.querySelector('.fx-val');
      if (v) v.textContent = fmtDb(+inp.value);
    });
    const shelv = (kind, cls, fmt) => {
      const inp = body.querySelector('[data-fxkind="' + kind + '"]');
      if (inp) inp.oninput = () => {
        const patch = {}; patch[kind] = +inp.value;
        AudioFX.setEq(patch);
        const b = inp.parentElement.querySelector('.' + cls);
        if (b) b.textContent = fmt(+inp.value);
      };
    };
    shelv('eqbass', 'fx-bv', fmtDb); shelv('eqtreble', 'fx-tv', fmtDb);
    const width = body.querySelector('[data-fxkind="width"]');
    if (width) width.oninput = () => {
      AudioFX.set({ width: +width.value, vocal: 'normal' });
      const b = width.parentElement.querySelector('.fx-wv');
      if (b) b.textContent = Math.round(width.value * 100) + '%';
    };
    const widthHigh = body.querySelector('[data-fxkind="widthHigh"]');
    if (widthHigh) widthHigh.oninput = () => {
      AudioFX.set({ widthHigh: +widthHigh.value });
      const b = widthHigh.parentElement.querySelector('.fx-whv');
      if (b) b.textContent = Math.round(widthHigh.value * 100) + '%';
    };
    const depth = body.querySelector('[data-fxkind="depth"]');
    if (depth) depth.oninput = () => {
      AudioFX.set({ depth: +depth.value });
      const b = depth.parentElement.querySelector('.fx-dv');
      if (b) b.textContent = Math.round(depth.value * 100) + '%';
    };
    const cf = body.querySelector('[data-fxkind="crossfeed"]');
    if (cf) cf.oninput = () => {
      AudioFX.set({ crossfeed: +cf.value });
      const b = cf.parentElement.querySelector('.fx-cfv');
      if (b) b.textContent = Math.round(cf.value * 100) + '%';
    };
    const cfm = body.querySelector('[data-fxkind="crossfeedMid"]');
    if (cfm) cfm.oninput = () => {
      AudioFX.set({ crossfeedMid: +cfm.value });
      const b = cfm.parentElement.querySelector('.fx-cfmv');
      if (b) b.textContent = Math.round(cfm.value * 100) + '%';
    };
    const cfd = body.querySelector('[data-fxkind="cfDelay"]');
    if (cfd) cfd.oninput = () => {
      AudioFX.set({ cfDelay: +cfd.value });
      const b = cfd.parentElement.querySelector('.fx-cfd'); if (b) b.textContent = cfd.value + 'ms';
    };
    const cff = body.querySelector('[data-fxkind="cfFreq"]');
    if (cff) cff.oninput = () => {
      AudioFX.set({ cfFreq: +cff.value });
      const b = cff.parentElement.querySelector('.fx-cff'); if (b) b.textContent = cff.value + 'Hz';
    };
    const bs2b = body.querySelector('[data-fxbs2b]');
    if (bs2b) bs2b.onclick = () => { AudioFX.set({ crossfeed: 0.45, crossfeedMid: 0, cfDelay: 0.3, cfFreq: 700 }); rerender(); };
    const de = body.querySelector('[data-fxkind="deEsser"]');
    if (de) de.oninput = () => {
      AudioFX.set({ deEsser: +de.value });
      const b = body.querySelector('.fx-dev');
      if (b) b.textContent = Math.round(de.value * 100) + '%';
      fxRefreshBadge();
    };
    const trA = body.querySelector('[data-fxkind="transient"]');
    if (trA) trA.oninput = () => {
      AudioFX.set({ transient: +trA.value });
      const b = body.querySelector('.fx-trv'); if (b) b.textContent = Math.round(trA.value * 100) + '%';
      fxRefreshBadge();
    };
    const trS = body.querySelector('[data-fxkind="transientSustain"]');
    if (trS) trS.oninput = () => {
      AudioFX.set({ transientSustain: +trS.value });
      const b = body.querySelector('.fx-tsv'); if (b) b.textContent = Math.round(trS.value * 100) + '%';
      fxRefreshBadge();
    };
    const trH = body.querySelector('[data-fxkind="transientHigh"]');
    if (trH) trH.onchange = () => { AudioFX.set({ transientHigh: !!trH.checked }); fxRefreshBadge(); };
    const tfEl = body.querySelector('[data-fxkind="transientFreq"]');
    if (tfEl) tfEl.oninput = () => {
      AudioFX.set({ transientFreq: +tfEl.value });
      const b = body.querySelector('.fx-tfq'); if (b) b.textContent = tfEl.value + 'Hz';
    };
    const dfEl = body.querySelector('[data-fxkind="deFreq"]');
    if (dfEl) dfEl.oninput = () => {
      AudioFX.set({ deFreq: +dfEl.value });
      const b = body.querySelector('.fx-dfq'); if (b) b.textContent = dfEl.value + 'Hz';
    };
    const bfEl = body.querySelector('[data-fxkind="bassFreq"]');
    if (bfEl) bfEl.oninput = () => {
      AudioFX.set({ bassFreq: +bfEl.value });
      const b = body.querySelector('.fx-bfq'); if (b) b.textContent = bfEl.value + 'Hz';
    };
    const bindDynBand = (kind, cls, fmt) => {
      const el = body.querySelector('[data-fxkind="' + kind + '"]');
      if (!el) return;
      el.oninput = () => {
        const patch = {}; patch[kind] = +el.value;
        AudioFX.set(patch);
        const b = body.querySelector('.' + cls); if (b) b.textContent = fmt(el.value);
      };
    };
    ['Low', 'Mid', 'High'].forEach(k => {
      const lk = k.toLowerCase();
      bindDynBand('dynEqF' + k, 'fx-df' + lk, v => v + 'Hz');
      bindDynBand('dynEqQ' + k, 'fx-dq' + lk, v => Number(v).toFixed(2));
      bindDynBand('dynEqTh' + k, 'fx-dt' + lk, v => v + 'dB');
    });
    const ld = body.querySelector('[data-fxkind="loudness"]');
    if (ld) ld.oninput = () => {
      AudioFX.set({ loudness: +ld.value });
      const b = body.querySelector('.fx-ldv'); if (b) b.textContent = Math.round(ld.value * 100) + '%';
      fxRefreshBadge();
    };
    const bindDyn = (kind, cls) => {
      const el = body.querySelector('[data-fxkind="' + kind + '"]');
      if (!el) return;
      el.oninput = () => {
        const patch = {}; patch[kind] = +el.value;
        AudioFX.set(patch);
        const b = body.querySelector('.' + cls); if (b) b.textContent = Math.round(el.value * 100) + '%';
        fxRefreshBadge();
      };
    };
    bindDyn('dynEq', 'fx-deqv'); bindDyn('dynEqLow', 'fx-deql');
    bindDyn('dynEqMid', 'fx-deqm'); bindDyn('dynEqHigh', 'fx-deqh');
    const beEl = body.querySelector('[data-fxkind="bassExciter"]');
    if (beEl) beEl.oninput = () => {
      AudioFX.set({ bassExciter: +beEl.value });
      const b = body.querySelector('.fx-bev'); if (b) b.textContent = Math.round(beEl.value * 100) + '%';
      fxRefreshBadge();
    };
    const mb = body.querySelector('[data-fxkind="monoBass"]');
    if (mb) mb.onchange = () => AudioFX.set({ monoBass: !!mb.checked });
    const envSel = document.getElementById('fx-env');
    if (envSel) envSel.onchange = () => { AudioFX.set({ env: envSel.value }); };
    const fdn = body.querySelector('[data-fxkind="fdnReverb"]');
    if (fdn) fdn.onchange = () => { AudioFX.set({ fdnReverb: fdn.checked }); fxRefreshBadge(); };
    const fszEl = body.querySelector('[data-fxkind="fdnSize"]');
    if (fszEl) fszEl.oninput = () => {
      AudioFX.set({ fdnSize: +fszEl.value });
      const b = body.querySelector('.fx-fsz'); if (b) b.textContent = (+fszEl.value).toFixed(2);
    };
    const fdcEl = body.querySelector('[data-fxkind="fdnDecay"]');
    if (fdcEl) fdcEl.oninput = () => {
      AudioFX.set({ fdnDecay: +fdcEl.value });
      const b = body.querySelector('.fx-fdc'); if (b) b.textContent = (+fdcEl.value).toFixed(1) + 's';
    };
    const fdpEl = body.querySelector('[data-fxkind="fdnDamping"]');
    if (fdpEl) fdpEl.oninput = () => {
      AudioFX.set({ fdnDamping: +fdpEl.value });
      const b = body.querySelector('.fx-fdp'); if (b) b.textContent = Math.round(fdpEl.value * 100) + '%';
    };
    const fdnAuto = body.querySelector('[data-fxfdn-auto]');
    if (fdnAuto) fdnAuto.onclick = () => { AudioFX.set({ fdnSize: null, fdnDecay: null, fdnDamping: null, fdnEr: null }); rerender(); };
    const ferEl = body.querySelector('[data-fxkind="fdnEr"]');
    if (ferEl) ferEl.oninput = () => {
      AudioFX.set({ fdnEr: +ferEl.value });
      const b = body.querySelector('.fx-fer'); if (b) b.textContent = Math.round(ferEl.value * 100) + '%';
    };
    const rdvEl = body.querySelector('[data-fxkind="reverbDuck"]');
    if (rdvEl) rdvEl.oninput = () => {
      AudioFX.set({ reverbDuck: +rdvEl.value });
      const b = body.querySelector('.fx-rdv'); if (b) b.textContent = Math.round(rdvEl.value * 100) + '%';
      fxRefreshBadge();
    };
    const preEl = body.querySelector('[data-fxkind="envPre"]');
    if (preEl) preEl.oninput = () => {
      AudioFX.set({ envPre: +preEl.value });
      const b = body.querySelector('.fx-pre'); if (b) b.textContent = preEl.value + 'ms';
    };
    const preAuto = body.querySelector('[data-fxpre-auto]');
    if (preAuto) preAuto.onclick = () => { AudioFX.set({ envPre: null }); rerender(); };
    const hpQ = body.querySelector('#fx-hp-q');
    const hpResults = body.querySelector('#fx-hp-results');
    const doHpSearch = async () => {
      const q = (hpQ && hpQ.value || '').trim();
      if (!q || !hpResults) return;
      hpResults.innerHTML = '<div class="fx-hp-empty">搜索中…</div>';
      try {
        const d = await Api.get('autoeq/search', { q });
        const items = (d && d.items) || [];
        if (!items.length) { hpResults.innerHTML = '<div class="fx-hp-empty">未找到，可直接粘贴 ParametricEQ.txt</div>'; return; }
        hpResults.innerHTML = items.map(it => '<button class="fx-hp-item" data-path="' + esc(it.path) + '">' + esc(it.name) + ' <span>' + esc(it.source) + '</span></button>').join('');
        hpResults.querySelectorAll('[data-path]').forEach(btn => {
          btn.onclick = async () => {
            btn.disabled = true;
            try {
              const p = await Api.get('autoeq/profile', { path: btn.dataset.path });
              AudioFX.setHeadphoneFromText(p.name, p.text, p.source);
              toast('已应用耳机校准：' + p.name, 'success');
              fxRefreshBadge(); rerender();
            } catch (e) {
              btn.disabled = false;
              toast('获取 AutoEQ 失败：' + ((e && e.message) || e), 'error');
            }
          };
        });
      } catch (e) {
        hpResults.innerHTML = '<div class="fx-hp-empty">搜索失败：' + esc((e && e.message) || String(e)) + '</div>';
      }
    };
    const hpSearch = body.querySelector('[data-fxhp-search]');
    if (hpSearch) hpSearch.onclick = doHpSearch;
    if (hpQ) hpQ.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); doHpSearch(); } };
    const hpImport = body.querySelector('[data-fxhp-import]');
    if (hpImport) hpImport.onclick = () => {
      const ta = body.querySelector('#fx-hp-text');
      const text = ta ? ta.value : '';
      if (!text.trim()) { toast('请先粘贴 ParametricEQ.txt', 'error'); return; }
      try {
        AudioFX.setHeadphoneFromText('自定义 AutoEQ', text, 'custom');
        toast('已导入耳机校准', 'success');
        fxRefreshBadge(); rerender();
      } catch (e) {
        toast('导入失败：' + ((e && e.message) || e), 'error');
      }
    };
    body.querySelectorAll('[data-fxhp-clear]').forEach(b => b.onclick = () => {
      AudioFX.setHeadphone(null);
      toast('已关闭耳机校准', 'success');
      fxRefreshBadge(); rerender();
    });
    const hpAmt = body.querySelector('[data-fxhp-amount]');
    if (hpAmt) hpAmt.oninput = () => {
      AudioFX.setHeadphoneAmount(+hpAmt.value);
      const b = hpAmt.parentElement.querySelector('b');
      if (b) b.textContent = Math.round(hpAmt.value * 100) + '%';
    };
    const rst = body.querySelector('[data-fxreset="eq"]');
    if (rst) rst.onclick = () => { AudioFX.setEq({ bass: 0, treble: 0, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }); rerender(); };
  }
  if (tab === 'adv') {
    const sp = body.querySelector('[data-fxkind="speed"]');
    if (sp) sp.oninput = () => {
      AudioFX.setSpeed(+sp.value); Player.applyUserSpeed();
      const b = body.querySelector('.fx-sv'); if (b) b.textContent = (+sp.value).toFixed(2) + 'x';
      fxRefreshBadge();
    };
    body.querySelectorAll('[data-fxspeed]').forEach(c => c.onclick = () => {
      AudioFX.setSpeed(+c.dataset.fxspeed); Player.applyUserSpeed();
      if (sp) sp.value = c.dataset.fxspeed;
      const b = body.querySelector('.fx-sv'); if (b) b.textContent = (+c.dataset.fxspeed).toFixed(2) + 'x';
      fxRefreshBadge();
    });
    const pre = body.querySelector('[data-fxkind="preamp"]');
    if (pre) pre.oninput = () => {
      AudioFX.set({ preamp: +pre.value });
      const b = body.querySelector('.fx-pgv');
      if (b) b.textContent = ((+pre.value) > 0 ? '+' : '') + (+pre.value) + 'dB';
      fxRefreshBadge();
    };
    const night = body.querySelector('[data-fxkind="night"]');
    if (night) night.onchange = () => { AudioFX.set({ night: night.checked }); fxRefreshBadge(); };
    const na = body.querySelector('[data-fxkind="nightAmount"]');
    if (na) na.oninput = () => {
      AudioFX.set({ nightAmount: +na.value });
      const b = body.querySelector('.fx-nav'); if (b) b.textContent = Math.round(na.value * 100) + '%';
      fxRefreshBadge();
    };
    const pm = body.querySelector('[data-fxkind="perfMode"]');
    if (pm) pm.onchange = () => {
      AudioFX.set({ perfMode: pm.checked });
      toast(pm.checked ? '省电模式：IR 混响 / 动态 EQ 关闭 / 限制器 4x' : '已恢复高性能模式', 'success');
      fxRefreshBadge();
    };
    const lt = body.querySelector('#fx-loud-target');
    if (lt) lt.onchange = () => { Player.setLoudTarget(+lt.value); toast('目标响度 ' + lt.value + ' LUFS', 'success'); };
    const lp = body.querySelector('#fx-loud-peak');
    if (lp) lp.onchange = () => { Player.setLoudPeakCeil(+lp.value); toast('峰值上限 ' + lp.value + ' dBFS', 'success'); };
    const fms = body.querySelector('[data-fxkind="fadeMs"]');
    if (fms) fms.oninput = () => {
      Player.setFadeMs(+fms.value);
      const b = body.querySelector('.fx-fms');
      if (b) b.textContent = (+fms.value <= 0 ? '近无缝' : fms.value + 'ms');
    };
    const al = body.querySelector('[data-fxkind="autoLevel"]');
    if (al) al.onchange = () => { AudioFX.set({ autoLevel: al.checked }); fxRefreshBadge(); };
    const dv = body.querySelector('[data-bpdashvideo]');
    if (dv) dv.onchange = () => {
      try { localStorage.setItem('bp.dashVideo', dv.checked ? '1' : '0'); } catch (e) {}
      toast(dv.checked ? 'DASH 1080p 已开启（下次看视频生效）' : 'DASH 1080p 已关闭', 'success');
    };
    const pitch = body.querySelector('[data-fxkind="pitch"]');
    if (pitch) pitch.oninput = () => {
      const v = +pitch.value;
      const b = body.querySelector('.fx-pv'); if (b) b.textContent = (v > 0 ? '+' : '') + v;
      AudioFX.setPitch(v).then(pok => {
        if (!pok) { toast('变调组件加载失败，已还原为 0', 'error'); pitch.value = 0; const b2 = body.querySelector('.fx-pv'); if (b2) b2.textContent = '0'; }
        fxRefreshBadge();
      });
    };
    const pe = body.querySelector('[data-fxpengine]');
    if (pe) pe.onchange = () => {
      AudioFX.setPitchEngine(pe.checked ? 'signalsmith' : 'soundtouch');
      toast(pe.checked ? '已切换 Signalsmith 变调（下次变调生效，延迟约 0.1s）' : '已切换 SoundTouch 变调', 'success');
      fxRefreshBadge(); rerender();
    };
    const voc = document.getElementById('fx-vocal');
    if (voc) voc.onchange = () => { AudioFX.set({ vocal: voc.value }); fxRefreshBadge(); };
    const qual = document.getElementById('fx-quality');
    if (qual) qual.onchange = () => {
      try { localStorage.setItem('bp.audioQuality', qual.value); } catch (e) {}
      toast('网易云音质已设为 ' + qual.options[qual.selectedIndex].text + '，下一首生效', 'success');
    };
    const rst = body.querySelector('[data-fxreset="all"]');
    if (rst) rst.onclick = () => {
      AudioFX.setPreset('original'); AudioFX.setSpeed(1); Player.applyUserSpeed();
      AudioFX.set({ night: false, vocal: 'normal', width: 1, depth: 0, env: 'none' });
      AudioFX.setPitch(0);
      fxRefreshBadge(); rerender();
    };
  }
}
function openFxPanel() {
  let curTab = 'presets';
  const render = () => {
    showModal('<div class="ver-head"><h3>🎛 音效</h3><div class="fx-tabs">' +
      '<button class="seg ' + (curTab === 'presets' ? 'active' : '') + '" data-fxtab="presets">音效</button>' +
      '<button class="seg ' + (curTab === 'eq' ? 'active' : '') + '" data-fxtab="eq">均衡器</button>' +
      '<button class="seg ' + (curTab === 'adv' ? 'active' : '') + '" data-fxtab="adv">高级</button>' +
      '<button class="seg ' + (curTab === 'diag' ? 'active' : '') + '" data-fxtab="diag">诊断</button>' +
      '</div></div><div id="fx-body">' + fxTabHtml(curTab) + '</div>', 'wide');
    document.querySelectorAll('[data-fxtab]').forEach(b => b.onclick = () => { curTab = b.dataset.fxtab; render(); });
    bindFxEvents(curTab, render);
    fxRefreshBadge();
  };
  render();
}
function refreshVersionsBadge() {
  if (state.view.name !== 'nowplaying') return;
  const btn = document.getElementById('ver-btn');
  if (!btn) return;
  const n = VERSIONS.groups.reduce((a, g) => a + g.items.length, 0);
  btn.querySelector('em').textContent = n ? String(n) : '';
  btn.classList.toggle('has', n > 0);
}
function findVersion(bvid) {
  for (const g of VERSIONS.groups) {
    const it = g.items.find(x => x.bvid === bvid);
    if (it) return it;
  }
  return null;
}
/* 切换版本时记忆槽位原始版本；切回原版时清除记忆 */
function applyVersionSwitch(idx, ni) {
  const cur = Player.S.queue[idx];
  if (!Player.S.slotOrig || Player.S.slotOrig.slot !== idx) {
    Player.S.slotOrig = { slot: idx, item: cur }; // 记住切换前的原版
  }
  Player.S.queue[idx] = ni;
  if (Player.S.slotOrig && Player.S.slotOrig.item && Player.S.slotOrig.item.bvid === ni.bvid) {
    Player.S.slotOrig = null; // 切回原版：清除记忆
  }
}
/* 按bvid找可切换的条目：版本列表 或 原版记忆 */
function findSwitchable(bvid) {
  const v = findVersion(bvid);
  if (v) return v;
  const so = Player.S.slotOrig;
  if (so && so.slot === Player.S.index && so.item && so.item.bvid === bvid) return so.item;
  return null;
}
/* ---------- 无缝衔接：预武装（预取地址/歌词→整曲时间映射→hover预缓冲） ---------- */
const SEAM = {
  prep: new Map() // "源bvid|目标bvid" -> { item(cid已补), url, quality, map(锚点表), ready, failed }
};
const prepKey = bvid => ((Player.S.track && Player.S.track.bvid) || '?') + '|' + bvid;
SEAM.dropStale = () => {
  const cur = (Player.S.track && Player.S.track.bvid) || '?';
  for (const k of Array.from(SEAM.prep.keys())) if (!k.startsWith(cur + '|')) SEAM.prep.delete(k);
};
async function fetchLyricsFor(item) {
  try {
    const d = await Api.get('subtitle', { bvid: item.bvid, cid: item.cid });
    return (d.lines || []).filter(l => l.text && String(l.text).trim());
  } catch (e) { return []; }
}
/* 整曲时间映射：源歌词每行 → 目标同句行，得锚点表 [[srcT,dstT]...]（副歌重复按相对位置取最近） */
function buildTimeMap(srcLines, dstLines) {
  const norm = s => (s || '').toLowerCase().replace(/[\s，。！？、·'"“”‘’~～\-—–_()（）[\]【】《》<>:：;；,.!？?]/g, '');
  const dstNorm = (dstLines || []).map(l => norm(l.text));
  const anchors = [];
  (srcLines || []).forEach((l, i) => {
    const key = norm(l.text);
    if (key.length < 3) return;
    const occ = [];
    dstNorm.forEach((t, j) => { if (t === key) occ.push(j); });
    if (!occ.length) return;
    const rel = srcLines.length ? i / Math.max(1, srcLines.length - 1) : 0;
    let best = occ[0], bd = 1e9;
    for (const j of occ) {
      const d = Math.abs(j / Math.max(1, dstLines.length - 1) - rel);
      if (d < bd) { bd = d; best = j; }
    }
    anchors.push([l.t, dstLines[best].t]);
  });
  anchors.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const a of anchors) {
    if (!out.length || a[0] - out[out.length - 1][0] > 2) out.push(a); // 太近的锚点合并
  }
  return out;
}
/* 任意时刻的跨版本换算：锚点间线性插值，头尾平移，无锚点按总时长比例 */
function mapTime(srcT, map, srcDur, dstDur) {
  if (!map || !map.length) {
    return srcDur && dstDur ? Math.max(0, Math.min(dstDur - 4, srcT / srcDur * dstDur)) : srcT;
  }
  const endSafe = dstDur ? Math.max(0, dstDur - 4) : Infinity;
  const sv = segValue(map, srcT);
  if (sv != null) return Math.max(0, Math.min(endSafe, sv));
  if (srcT <= map[0][0]) return Math.max(0, srcT + (map[0][1] - map[0][0]));
  let lo = 0, hi = map.length - 1;
  if (srcT >= map[hi][0]) return Math.max(0, Math.min(endSafe, srcT + (map[hi][1] - map[hi][0])));
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (map[mid][0] <= srcT) lo = mid; else hi = mid; }
  const s0 = map[lo], s1 = map[hi];
  const frac = s1[0] > s0[0] ? (srcT - s0[0]) / (s1[0] - s0[0]) : 0;
  return Math.max(0, Math.min(endSafe, s0[1] + (s1[1] - s0[1]) * frac));
}
/* 弹窗打开后逐行后台预备：cid→播放地址→目标歌词→时间映射；行上亮状态点 */
async function prepareSeamless(rows) {
  const srcTrack = Player.S.track;
  if (!srcTrack) return;
  for (const it of rows) {
    if (SEAM.prep.has(prepKey(it.bvid))) { updateSeamDots(); continue; }
    SEAM.prep.set(prepKey(it.bvid), { item: it, ready: false });
    updateSeamDots();
    try {
      const ni = { bvid: it.bvid, title: stripEm(it.title), up: it.up, upMid: it.upMid, pic: it.pic, duration: it.duration, aid: it.aid };
      await Player.ensureCid(ni);
      const m = await Api.get('media', { bvid: ni.bvid, cid: ni.cid, kind: 'audio' });
      const dstLines = await fetchLyricsFor(ni);
      const srcLines = (state.lyrics && state.lyrics.lines) || [];
      const map = buildTimeMap(srcLines, dstLines);
      SEAM.prep.set(prepKey(it.bvid), { item: ni, url: m.url, quality: m.quality || '', map, ready: true });
    } catch (e) {
      SEAM.prep.set(prepKey(it.bvid), { item: it, ready: false, failed: true });
    }
    updateSeamDots();
    await new Promise(r => setTimeout(r, 120)); // 错开发起
  }
}
function updateSeamDots() {
  document.querySelectorAll('.ver-row').forEach(row => {
    const p = SEAM.prep.get(prepKey(row.dataset.bvid));
    const dot = row.querySelector('.seam-dot');
    if (!dot || !p) return;
    dot.classList.toggle('ok', !!p.ready);
    dot.classList.toggle('fail', !!p.failed);
    dot.classList.toggle('aud', !!p.audioMap); // 金点=已按音频波形精对齐
  });
}
/* 无缝衔接的两种手感（用户可选）：
   instant=预武装秒切（交叉提前1.8s开始，结束正好落在锚点句）
   smooth=渐变缓冲（上一版手感：点击后短暂准备，交叉从锚点句本身开始淡入） */
function seamMode() { return localStorage.getItem('bp.seamMode') || 'instant'; }
/* ---------- 音频自对齐：色度特征 + 多尺度DTW（粗到精） + 变调估计 ----------
   变调：整曲池化色度循环互相关估计半音移位，目标特征先旋转再对齐
   漂移：粗对齐(0.57s)定全局走向 → 精对齐(0.19s)限制在粗路径±2.5秒带内——
   结构差异（长前奏/间奏/变奏/改曲）由粗对齐吸收，误差不会随歌曲后段累积 */
const AALIGN = { cache: new Map(), computing: new Set(), bufs: [] };
/* 解码后的AudioBuffer保留（供ABSN采样级交接），LRU=2首；低内存设备不保留 */
function aalignKeepBuffer(key, ab) {
  if (navigator.deviceMemory && navigator.deviceMemory <= 2) return;
  const e = AALIGN.cache.get(key);
  if (!e) return;
  e.buffer = ab;
  const i = AALIGN.bufs.indexOf(key);
  if (i >= 0) AALIGN.bufs.splice(i, 1);
  AALIGN.bufs.push(key);
  while (AALIGN.bufs.length > 2) {
    const old = AALIGN.bufs.shift();
    const oe = AALIGN.cache.get(old);
    if (oe) oe.buffer = null;
  }
}
function aalignBufferOf(item) {
  const e = AALIGN.cache.get(item.bvid + '|' + (item.cid || ''));
  return (e && e.buffer) || null;
}
function fftInplace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + half] * cr - im[i + k + half] * ci;
        const bi = re[i + k + half] * ci + im[i + k + half] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + half] = ar - br; im[i + k + half] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}
function chromaFromBuffer(ab) {
  const sr = ab.sampleRate;
  const N = 8192, half = N >> 1;
  const hop = Math.round(sr * 0.093); // ≈0.093秒一帧：窗口不变（音高分辨率无损），时间粒度翻倍
  const L = ab.length;
  const c0 = ab.getChannelData(0);
  const mono = new Float32Array(L);
  if (ab.numberOfChannels > 1) {
    const c1 = ab.getChannelData(1);
    for (let i = 0; i < L; i++) mono[i] = (c0[i] + c1[i]) * 0.5;
  } else mono.set(c0);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
  const binPc = new Int8Array(half);
  for (let k = 1; k < half; k++) {
    const f = k * sr / N;
    if (f < 55 || f > 2093) { binPc[k] = -1; continue; }
    binPc[k] = ((Math.round(12 * Math.log2(f / 440) + 69) % 12) + 12) % 12;
  }
  const frames = Math.max(1, Math.floor((L - N) / hop) + 1);
  const re = new Float32Array(N), im = new Float32Array(N);
  const out = new Array(frames);
  const rms = new Float32Array(frames);
  const onset = new Float32Array(frames); // 谱通量包络：锚点精修到节拍级用
  const prevMag = new Float32Array(half);
  const prevMag2 = new Float32Array(half);
  const curMag = new Float32Array(half);
  for (let fi = 0; fi < frames; fi++) {
    const f0 = fi * hop;
    let e = 0;
    for (let i = 0; i < N; i++) { const s = mono[f0 + i] * win[i]; re[i] = s; im[i] = 0; e += s * s; }
    rms[fi] = Math.sqrt(e / N);
    fftInplace(re, im);
    let flux = 0;
    const v = out[fi] || (out[fi] = new Float32Array(12));
    for (let k = 1; k < half; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      curMag[k] = mag;
      const base = prevMag[k] > prevMag2[k] ? prevMag[k] : prevMag2[k]; // SuperFlux最大滤波：抑制颤音假onset
      const inc = mag - base;
      if (inc > 0) flux += inc;
      const pc = binPc[k];
      if (pc >= 0) v[pc] += Math.sqrt(Math.sqrt(mag));
    }
    prevMag2.set(prevMag);
    prevMag.set(curMag);
    onset[fi] = flux;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += v[i];
    if (sum > 0) for (let i = 0; i < 12; i++) v[i] /= sum;
  }
  // 叠加差分特征（delta ×2.5）+ 24维L2归一化：和声变化时刻可辨，速度差异唯一
  const feats = new Array(frames);
  for (let fi = 0; fi < frames; fi++) {
    const nxt = out[Math.min(frames - 1, fi + 1)], prv = out[Math.max(0, fi - 1)];
    const f = new Float32Array(24);
    for (let k = 0; k < 12; k++) { f[k] = out[fi][k]; f[12 + k] = (nxt[k] - prv[k]) * 2.5; }
    let n2 = 0;
    for (let k = 0; k < 24; k++) n2 += f[k] * f[k];
    n2 = Math.sqrt(n2) || 1;
    for (let k = 0; k < 24; k++) f[k] /= n2;
    feats[fi] = f;
  }
  return { frames: feats, hopSec: hop / sr, rms, onset };
}
/* 从谱通量包络估计 BPM + 节拍相位：给歌词词头做“软对齐”，不改变行时间轴 */
function detectBpm(ch) {
  const onset = ch && ch.onset;
  const hop = ch && ch.hopSec;
  if (!onset || !hop || onset.length < 24) return null;
  const n = onset.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += onset[i];
  mean /= n;
  const vals = new Float32Array(n);
  for (let i = 0; i < n; i++) vals[i] = Math.max(0, onset[i] - mean * 0.75);
  let best = { bpm: 120, score: -Infinity };
  const scores = [];
  for (let bpm = 60; bpm <= 190; bpm += 0.5) {
    const period = 60 / bpm / hop;
    if (period < 1.5 || period > n - 2) continue;
    let sc = 0;
    for (let k = 1; k <= 3; k++) {
      const lag = period * k;
      if (lag >= n - 2) break;
      let sum = 0, cnt = 0;
      for (let i = 0; i < n - 2; i += 2) {
        const j = i + lag;
        const j0 = Math.floor(j);
        const f = j - j0;
        if (j0 + 1 >= n) break;
        sum += vals[i] * (vals[j0] * (1 - f) + vals[j0 + 1] * f);
        cnt++;
      }
      if (cnt) sc += (sum / cnt) * (k === 1 ? 1 : 0.45 / k);
    }
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.7, 2));
    const score = sc * (0.72 + 0.28 * prior);
    scores.push(score);
    if (score > best.score) best = { bpm: bpm, score: score };
  }
  if (!Number.isFinite(best.score) || best.score <= 0) return null;
  const sorted = scores.slice().sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] || 0;
  const confidence = best.score / (Math.abs(med) + 1e-6);
  const bpm = Math.round(best.bpm * 10) / 10;
  const period = 60 / bpm / hop;
  let phase = 0, bestPhase = -1;
  const steps = Math.max(8, Math.round(period * 8));
  for (let s = 0; s < steps; s++) {
    const ph = period * s / steps;
    let sum = 0, cnt = 0;
    for (let k = 0; ph + k * period < n; k++) {
      const idx = Math.floor(ph + k * period);
      sum += onset[idx] || 0;
      cnt++;
    }
    const sc = cnt ? sum / cnt : 0;
    if (sc > bestPhase) { bestPhase = sc; phase = ph; }
  }
  return { bpm: bpm, beat: 60 / bpm, phase: phase * hop, confidence: +confidence.toFixed(2) };
}

async function chromaOf(item) {
  const key = item.bvid + '|' + (item.cid || '');
  if (AALIGN.cache.has(key)) return AALIGN.cache.get(key);
  if (AALIGN.computing.has(key)) {
    while (AALIGN.computing.has(key)) await new Promise(r => setTimeout(r, 150));
    return AALIGN.cache.get(key);
  }
  AALIGN.computing.add(key);
  try {
    const d = await Api.get('media', { bvid: item.bvid, cid: item.cid, kind: 'audio' });
    const audioUrl = d.url.startsWith('/api/') ? d.url : '/api/stream?u=' + encodeURIComponent(d.url);
    const resp = await fetch(audioUrl);
    const buf = await resp.arrayBuffer();
    const ctx = new OfflineAudioContext(2, 44100, 44100);
    const ab = await ctx.decodeAudioData(buf);
    const ch = chromaFromBuffer(ab);
    AALIGN.cache.set(key, ch);
    aalignKeepBuffer(key, ab);
    return ch;
  } finally { AALIGN.computing.delete(key); }
}
/* 变调估计：12个移位各算抽样帧的色度距离均值，取最小者——比池化互相关判别力强 */
function estimateShift(chA, chB) {
  const step = Math.max(1, Math.floor(Math.min(chA.frames.length, chB.frames.length) / 120));
  const dist = k => {
    let s = 0, c = 0;
    for (let i = 0; i < Math.min(chA.frames.length, chB.frames.length); i += step) {
      const va = chA.frames[i], vb = chB.frames[i];
      let d = 0;
      for (let q = 0; q < 12; q++) { const e = va[q] - vb[(q + k) % 12]; d += e * e; }
      s += d; c++;
    }
    return s / Math.max(1, c);
  };
  let best = 0, bestD = Infinity;
  for (let k = 0; k < 12; k++) { const dd = dist(k); if (dd < bestD) { bestD = dd; best = k; } }
  const d0 = dist(0);
  return { shift: best, confident: best === 0 || (bestD < d0 * 0.82 && best <= 5) };
}
/* 色度循环移位（变调补偿）：chroma半部与delta半部都移 */
function rotateChroma(ch, k) {
  if (!k) return ch;
  const rot = f => {
    const w = new Float32Array(f.length);
    for (let i = 0; i < 12; i++) { w[(i + k) % 12] = f[i]; w[12 + ((i + k) % 12)] = f[12 + i]; }
    return w;
  };
  return { frames: ch.frames.map(rot), hopSec: ch.hopSec, rms: ch.rms, onset: ch.onset };
}
function downsampleChroma(ch, factor) {
  const fr = ch.frames, n = fr.length, m = Math.max(1, Math.floor(n / factor));
  const out = [], rms = [];
  for (let i = 0; i < m; i++) {
    const v = new Float32Array(fr[0].length);
    for (let j = 0; j < factor; j++) {
      const idx = i * factor + j;
      if (idx >= n) break;
      const f = fr[idx];
      for (let k = 0; k < v.length; k++) v[k] += f[k];
    }
    for (let k = 0; k < v.length; k++) v[k] /= factor;
    out.push(v);
    let e = 0, c = 0;
    for (let j = 0; j < factor; j++) { const idx = i * factor + j; if (idx < n) { e += ch.rms[idx] * ch.rms[idx]; c++; } }
    rms.push(Math.sqrt(e / Math.max(1, c)));
  }
  const onset = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    let e = 0, c = 0;
    for (let j = 0; j < factor; j++) { const idx = i * factor + j; if (idx < ch.onset.length) { e += ch.onset[idx]; c++; } }
    onset[i] = c ? e / c : 0;
  }
  return { frames: out, hopSec: ch.hopSec * factor, rms, onset };
}
/* DTW核心：饱和归一化配对代价 + 线性gap + 可选带约束（bandFn(i)→[lo,hi]目标帧范围）。
   BACK矩阵记录步型，回溯零浮点比较 */
function dtwCore(A, B, bandFn, maxAnchors = 100, cap = 1600, onsetW = 0) {
  let a = A.frames, b = B.frames, hA = A.hopSec, hB = B.hopSec;
  let rA = A.rms, rB = B.rms;
  let kA = 1, kB = 1;
  if (a.length > cap) { kA = Math.ceil(a.length / cap); a = a.filter((_, i) => i % kA === 0); rA = rA.filter((_, i) => i % kA === 0); hA *= kA; }
  if (b.length > cap) { kB = Math.ceil(b.length / cap); b = b.filter((_, i) => i % kB === 0); rB = rB.filter((_, i) => i % kB === 0); hB *= kB; }
  /* onset包络代价项（onsetW>0时）：节奏是非周期的，可解色度在重复段落上的周期别名（coarse滑移） */
  let oAn = null, oBn = null;
  if (onsetW > 0 && A.onset && B.onset) {
    let oA = A.onset, oB = B.onset;
    if (kA > 1) oA = oA.filter((_, i) => i % kA === 0);
    if (kB > 1) oB = oB.filter((_, i) => i % kB === 0);
    const medO = arr => { const v = Array.from(arr).sort((x, y) => x - y); return v[v.length >> 1] || 1; };
    const mA = medO(oA), mB = medO(oB);
    oAn = new Float32Array(oA.length); oBn = new Float32Array(oB.length);
    for (let i = 0; i < oA.length; i++) oAn[i] = Math.min(4, oA[i] / mA);
    for (let j = 0; j < oB.length; j++) oBn[j] = Math.min(4, oB[j] / mB);
  }
  const n = a.length, m = b.length, W = m + 1;
  const GAP = 1.6;
  const raw = (i, j) => {
    const vA = a[i], vB = b[j];
    let d = 0;
    for (let k = 0; k < vA.length; k++) { const e = vA[k] - vB[k]; d += e * e; }
    return d;
  };
  // 静默判定用相对阈值（每首歌自身的响度中位数）
  const medR = arr => { const v = Array.from(arr).sort((x, y) => x - y); return v[Math.floor(v.length / 2)] || 0.02; };
  // 显式转布尔：rA/rB可能是Float32Array（map返回0/1数字）或普通数组（true/false），类型不一致会让!==误判
  const thrA = medR(rA) * 0.08, thrB = medR(rB) * 0.08;
  const silA = Array.from(rA, x => x < thrA);
  const silB = Array.from(rB, x => x < thrB);
  // σ=每帧±3秒窗内最小距离的中位数：好匹配的典型代价，与tempo偏移/时长差无关
  const ratioJ = (m * hB) / Math.max(0.001, n * hA);
  const bW = Math.max(2, Math.round(3 / hB));
  const step = Math.max(1, Math.floor(Math.min(n, m) / 50));
  const samples = [];
  for (let k = 0; k < n; k += step) {
    const jc = Math.round(k * ratioJ);
    let mn = Infinity;
    for (let j = Math.max(0, jc - bW); j <= Math.min(m - 1, jc + bW); j++) { const v = raw(k, j); if (v < mn) mn = v; }
    if (mn < Infinity) samples.push(mn);
  }
  samples.sort((x, y) => x - y);
  const sigma = Math.max(1e-6, samples[Math.floor(samples.length / 2)] || 1);
  // 饱和归一化只作用在色度上；"静默≠有声"是确定性不可配（+2.0线性惩罚，不饱和）——
  // 否则DTW会把源曲内容拉长铺满静默intro，造成累积漂移
  // σ归一化线性代价：配对≈1.0、错配≥3、gap=1.6，三段分离与内容尺度无关
  const dist = (i, j) => raw(i, j) / sigma + ((silA[i] !== silB[j]) ? 2.0 : 0) + (oAn ? onsetW * Math.abs(oAn[i] - oBn[j]) : 0);
  const D = new Float32Array((n + 1) * W);
  const BACK = new Uint8Array((n + 1) * W);
  D[0] = 0;
  for (let i = 1; i <= n; i++) { D[i * W] = i * GAP; BACK[i * W] = 1; }
  for (let j = 1; j <= m; j++) { D[j] = j * GAP; BACK[j] = 2; }
  for (let i = 1; i <= n; i++) {
    const base = i * W, prev = (i - 1) * W;
    let lo = 1, hi = m, cc = -1;
    if (bandFn) { const b = bandFn(i - 1); lo = Math.max(1, b[0] + 1); hi = Math.min(m, b[1] + 1); cc = b[2]; }
    for (let j = 1; j <= m; j++) {
      let best = D[base + j - 1] + GAP, st = 2;
      if (j - 1 >= lo && j - 1 <= hi) {
        // 带内居中倾向：色度信号模糊时路径回归粗对齐中心，等代价游走被抑制
        const centerPen = cc >= 0 ? 0.12 * Math.abs((j - 1) - cc) / Math.max(1, hi - lo) : 0;
        const cDiag = D[prev + j - 1] + dist(i - 1, j - 1) + centerPen;
        if (cDiag <= best) { best = cDiag; st = 0; }
      }
      const cUp = D[prev + j] + GAP;
      if (cUp <= best) { best = cUp; st = 1; }
      D[base + j] = best; BACK[base + j] = st;
    }
  }
  let i = n, j = m;
  const anchors = [];
  while (i > 0 || j > 0) {
    const st = i > 0 && j > 0 ? BACK[i * W + j] : (i > 0 ? 1 : 2);
    if (st === 0) {
      i--; j--;
      if (!(i === 0 && j === 0)) anchors.push([i * hA, j * hB]);
    } else if (st === 1) i--;
    else j--;
    if (i === 0 && j === 0) break;
  }
  anchors.push([0, 0]);
  anchors.reverse();
  // 返回完整单调路径：0.093秒粒度，插删边界的不连续原样保留（不做降采样插值）
  return anchors;
}
/* 精对齐带约束：由粗路径插值出每个精源帧允许的目标帧范围（±bandSec） */
function bandFromCoarse(coarse, hCoarse, nFine, hFine, mFine, bandSec) {
  const sorted = coarse.slice().sort((a, b) => a[0] - b[0]);
  const lo = new Int32Array(nFine), hi = new Int32Array(nFine), ce = new Int32Array(nFine);
  let ai = 0;
  const bf = Math.max(1, Math.round(bandSec / hFine));
  for (let i = 0; i < nFine; i++) {
    const t = i * hFine;
    while (ai < sorted.length - 1 && sorted[ai + 1][0] < t) ai++;
    const s0 = sorted[ai], s1 = sorted[Math.min(ai + 1, sorted.length - 1)];
    const frac = s1[0] > s0[0] ? (t - s0[0]) / (s1[0] - s0[0]) : 0;
    const dT = s0[1] + (s1[1] - s0[1]) * frac;
    const c = Math.round(dT / hFine);
    lo[i] = Math.max(0, c - bf);
    hi[i] = Math.min(mFine - 1, c + bf);
    ce[i] = c;
  }
  return i => [lo[i], hi[i], ce[i]];
}
/* 局部速度比：锚点邻域的 dst/src 时间推进比（变速跟拍用），限幅防gap段离谱值 */
function slopeAt(map, srcT, fallback = 1) {
  if (!map || map.length < 8) return fallback;
  const segs = map.segments;
  if (segs && segs.length) {
    for (const sg of segs) {
      if (srcT >= sg.s0 && srcT <= sg.s1 && sg.ok) {
        const sl = sg.slope;
        return (sl >= 0.85 && sl <= 1.18) ? sl : fallback;
      }
    }
  }
  let ai = 0;
  while (ai < map.length - 2 && map[ai + 1][0] < srcT) ai++;
  let k = ai + 1;
  while (k < map.length - 1 && map[k][0] - map[ai][0] < 1.0) k++;
  const dS = map[k][0] - map[ai][0], dD = map[k][1] - map[ai][1];
  if (dS < 0.5) return fallback;
  const sl = dD / dS;
  if (sl < 0.85 || sl > 1.18) return fallback;
  return sl;
}
/* 锚点精修：用谱通量(onset)包络互相关把每个锚点校正到节拍级（±0.5秒搜索窗，0.093秒步长） */
function refineAnchorsWithOnsets(anchors, envA, hA, envB, hB) {
  if (!envA || !envB) return anchors;
  const halfW = Math.round(0.6 / hA);
  // 搜索窗±0.28s：精DTW残差通常<1hop，宽窗会在周期性节拍上锁到相邻峰（歧义反噬）；
  // 窄窗置信不足时自适应重试宽窗（更严门槛），救精DTW偶发跳变
  const searchN = Math.max(2, Math.round(0.28 / hB));
  const searchW = Math.round(0.55 / hB);
  const ncc = (si, di, search) => {
    let bestLag = 0, bestC = -Infinity, energy = 0;
    for (let k = -halfW; k <= halfW; k++) energy += envA[si + k] * envA[si + k];
    energy = Math.sqrt(energy) || 1e-9;
    const scores = new Float32Array(search * 2 + 1);
    for (let lag = -search; lag <= search; lag++) {
      let c = 0, e2 = 0;
      for (let k = -halfW; k <= halfW; k++) { const bv = envB[di + k + lag]; c += envA[si + k] * bv; e2 += bv * bv; }
      const score = c / (Math.sqrt(e2) * energy + 1e-9);
      scores[lag + search] = score;
      if (score > bestC) { bestC = score; bestLag = lag; }
    }
    return { bestLag, bestC, scores, search };
  };
  const out = [];
  for (const [sT, dT] of anchors) {
    const si = Math.round(sT / hA), di = Math.round(dT / hB);
    if (si - halfW < 0 || si + halfW >= envA.length || di - searchW < 0 || di + searchW >= envB.length) { out.push([sT, dT]); continue; }
    const r1 = ncc(si, di, searchN);
    const { bestLag, bestC, scores, search } = r1;
    /* 置信门：相关性不足就不动锚点（保持精DTW输出=不引入反噬） */
    if (bestC < 0.45) { out.push([sT, dT]); continue; }
    /* 亚帧：峰值三点抛物线插值（Benesty 2004 亚采样TDE标准法），门控失败即保持整数lag */
    let sub = 0;
    const li = bestLag + search;
    if (bestLag > -search && bestLag < search) {
      const a = scores[li - 1], b = scores[li], c2 = scores[li + 1];
      const den = a - 2 * b + c2;
      if (den < -1e-9) {
        const d = 0.5 * (a - c2) / den;
        if (isFinite(d) && Math.abs(d) <= 0.6) sub = d;
      }
    }
    out.push([sT, dT + (bestLag + sub) * hB]);
  }
  // 单调化：dst必须递增（精修可能引入小回退，丢弃回退点）
  const clean = [];
  for (const a of out) {
    if (clean.length && a[1] <= clean[clean.length - 1][1]) continue;
    clean.push(a);
  }
  const lastS = anchors[anchors.length - 1];
  if (!clean.length || clean[clean.length - 1][0] < lastS[0]) clean.push(lastS.slice());
  if (clean[0] && clean[0][0] > 0.001) clean.unshift([0, 0]);
  /* 孤立跳变剔除：锚点偏离±3锚点插值>0.15s即替换（修精DTW偶发的1-2锚点跳变） */
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < clean.length - 1; i++) {
      const pi = Math.max(0, i - 3), qi = Math.min(clean.length - 1, i + 3);
      if (qi - pi < 2) continue;
      const p = clean[pi], q = clean[qi], a = clean[i];
      if (q[0] - p[0] < 0.001) continue;
      const est = p[1] + (q[1] - p[1]) * (a[0] - p[0]) / (q[0] - p[0]);
      if (Math.abs(a[1] - est) > 0.15) a[1] = est;
    }
  }
  return clean;
}
/* 分段线性TimeMap：沿精修锚点按斜率变化切段，段内中位数鲁棒拟合(slope,offset)，
   消除长曲累计漂移（ChronoSync piecewise-linear 模型）；残差超限的段标记bad→消费端回退锚点插值 */
function fitSegments(anchors) {
  if (!anchors || anchors.length < 6) return null;
  const slopeAtI = i => {
    const a = anchors[Math.max(0, i - 1)], b = anchors[Math.min(anchors.length - 1, i + 1)];
    const dS = b[0] - a[0];
    return dS > 0.3 ? (b[1] - a[1]) / dS : null;
  };
  const med = arr => { const v = arr.slice().sort((x, y) => x - y); return v[v.length >> 1]; };
  const segs = [];
  let start = 0;
  let curSlope = slopeAtI(start + 1) || 1;
  const push = (a, b) => {
    if (b - a < 3) return false;
    const slopes = [], offs = [];
    for (let i = a + 1; i < b; i++) {
      const dS = anchors[i][0] - anchors[i - 1][0];
      if (dS > 0.15 && dS < 12) slopes.push((anchors[i][1] - anchors[i - 1][1]) / dS);
    }
    if (!slopes.length) return false;
    const sl = med(slopes);
    if (sl < 0.8 || sl > 1.25) return false;
    for (let i = a; i < b; i++) offs.push(anchors[i][1] - sl * anchors[i][0]);
    const off = med(offs);
    let maxRes = 0;
    for (let i = a; i < b; i++) maxRes = Math.max(maxRes, Math.abs(anchors[i][1] - (sl * anchors[i][0] + off)));
    segs.push({ s0: anchors[a][0], s1: anchors[b - 1][0], slope: sl, offset: off, ok: maxRes < 0.25 });
    return true;
  };
  for (let i = start + 2; i < anchors.length; i++) {
    const sp = slopeAtI(i);
    const span = anchors[i][0] - anchors[start][0];
    if (sp != null && curSlope && (Math.abs(sp - curSlope) > 0.03 * Math.abs(curSlope) || span > 20)) {
      if (push(start, i)) { start = i; curSlope = sp; }
    }
  }
  push(start, anchors.length);
  const good = segs.filter(x => x.ok);
  if (good.length < 2) return null;
  /* 交叉验证：留出偶数锚点，段模型 vs 邻锚插值比预测误差；段模型明显更优才启用，
     否则锚点插值本身就够（噪锚点上段模型反而放大误差） */
  const odd = anchors.filter((_, i) => i % 2 === 1);
  const even = anchors.filter((_, i) => i % 2 === 0);
  const interpOdd = t => {
    let lo = 0, hi = odd.length - 1;
    if (!odd.length) return null;
    if (t <= odd[0][0]) return odd[0][1] + (t - odd[0][0]);
    if (t >= odd[hi][0]) return odd[hi][1] + (t - odd[hi][0]);
    while (hi - lo > 1) { const m2 = (lo + hi) >> 1; if (odd[m2][0] <= t) lo = m2; else hi = m2; }
    const s0 = odd[lo], s1 = odd[hi];
    const f = s1[0] > s0[0] ? (t - s0[0]) / (s1[0] - s0[0]) : 0;
    return s0[1] + (s1[1] - s0[1]) * f;
  };
  const tmp = { segments: segs };
  const lastS = anchors[anchors.length - 1][0];
  let eS = 0, eL = 0, n2 = 0;
  for (const a of even) {
    if (a[0] < 2 || a[0] > lastS - 2) continue;
    const vs = segValue(tmp, a[0]);
    const vl = interpOdd(a[0]);
    if (vs == null || vl == null) continue;
    eS += Math.abs(vs - a[1]); eL += Math.abs(vl - a[1]); n2++;
  }
  if (!n2) return null;
  return eS < eL * 0.8 ? segs : null;
}
/* 分段模型取值：段内直线，段边界0.5秒内与邻段线性_blend_保证连续；不可用返回null */
function segValue(map, srcT) {
  const segs = map && map.segments;
  if (!segs || !segs.length) return null;
  let i = segs.length - 1;
  for (let k = 0; k < segs.length; k++) { if (srcT < segs[k].s1) { i = k; break; } }
  const seg = segs[i];
  if (!seg.ok) return null;
  let v = seg.slope * srcT + seg.offset;
  const BL = 0.5;
  if (i > 0 && segs[i - 1].ok && srcT - seg.s0 < BL) {
    const vp = segs[i - 1].slope * srcT + segs[i - 1].offset;
    const w = (srcT - seg.s0) / BL;
    v = vp + (v - vp) * w;
  } else if (i < segs.length - 1 && segs[i + 1].ok && seg.s1 - srcT < BL) {
    const vn = segs[i + 1].slope * srcT + segs[i + 1].offset;
    const w = (seg.s1 - srcT) / BL;
    v = vn + (v - vn) * w;
  }
  return v;
}
/* 完整音频对齐管线：变调补偿 → 粗对齐 → 带约束精对齐 */
async function computeAudioMap(srcItem, dstItem) {
  const ca = await chromaOf(srcItem);
  const cbRaw = await chromaOf(dstItem);
  const { shift, confident } = estimateShift(ca, cbRaw);
  const cb = confident ? rotateChroma(cbRaw, shift) : cbRaw;
  const CA = downsampleChroma(ca, 6), CB = downsampleChroma(cb, 6);
  const coarse = dtwCore(CA, CB, null, 60, 1600, 1.2); // onset项解周期别名
  const bandFn = bandFromCoarse(coarse, CA.hopSec, ca.frames.length, ca.hopSec, cb.frames.length, 2.5);
  const fine = dtwCore(ca, cb, bandFn, 100, 4000);
  const map = refineAnchorsWithOnsets(fine, ca.onset, ca.hopSec, cb.onset, cb.hopSec);
  map.segments = fitSegments(map);
  map.isAudio = true;
  return { map, shift };
}
/* 局部子序列对齐：以粗对齐为中心，在双版本局部窗口内独立DTW——
   全局路径在重复段落"抄近路"造成的累积漂移，到这里被完全丢弃：
   落点精度只取决于局部窗口内的匹配质量，与歌曲位置无关 */
function localAlign(chA, chB, srcT, dstTCoarse) {
  const hA = chA.hopSec, hB = chB.hopSec;
  const nA = chA.frames.length, nB = chB.frames.length;
  if (!chA.frames || !chB.frames) return null;
  const wS = Math.round(9 / hA);          // 源窗口 ±9秒
  const padB = Math.round(45 / hB);       // 目标搜索窗 ±45秒（容忍粗对齐的大偏差）
  const siC = Math.round(srcT / hA), diC = Math.round(dstTCoarse / hB);
  const i0 = Math.max(0, siC - wS), i1 = Math.min(nA - 1, siC + wS);
  const j0 = Math.max(0, diC - padB), j1 = Math.min(nB - 1, diC + padB);
  if (i1 - i0 < 30 || j1 - j0 < 60) return null;
  const a = chA.frames, b = chB.frames;
  const medR = arr => { const v = Array.from(arr).sort((x, y) => x - y); return v[Math.floor(v.length / 2)] || 0.02; };
  const silA = Array.from(chA.rms, x => x < medR(chA.rms) * 0.08);
  const silB = Array.from(chB.rms, x => x < medR(chB.rms) * 0.08);
  const raw = (i, j) => {
    const vA = a[i], vB = b[j];
    let d = 0;
    for (let k = 0; k < vA.length; k++) { const e = vA[k] - vB[k]; d += e * e; }
    return d;
  };
  // σ：每帧±2秒窗内最小距离的中位数（与tempo偏移无关）
  const bW2 = Math.max(2, Math.round(2 / hB));
  const step = Math.max(1, Math.floor((i1 - i0) / 40));
  const samples = [];
  for (let i = i0; i <= i1; i += step) {
    const jc = Math.round(diC + (i - siC) * hA / hB);
    let mn = Infinity;
    for (let j = Math.max(j0, jc - bW2); j <= Math.min(j1, jc + bW2); j++) { const v = raw(i, j); if (v < mn) mn = v; }
    if (mn < Infinity) samples.push(mn);
  }
  samples.sort((x, y) => x - y);
  const sigma = Math.max(1e-6, samples[Math.floor(samples.length / 2)] || 1);
  // σ归一化线性代价：配对≈1.0、错配≥3、gap=1.6，三段分离与内容尺度无关
  const dist = (i, j) => raw(i, j) / sigma + ((silA[i] !== silB[j]) ? 2.0 : 0);
  const h = i1 - i0 + 1, w = j1 - j0 + 1, W = w + 1;
  const GAP = 1.6;
  const D = new Float32Array((h + 1) * W);
  const BACK = new Uint8Array((h + 1) * W);
  for (let j = 0; j <= w; j++) D[j] = 0;         // 自由起点：可在目标窗任意处进入
  for (let i = 1; i <= h; i++) {
    const base = i * W, prev = (i - 1) * W;
    const ii = i0 + i - 1;
    for (let j = 1; j <= w; j++) {
      const jj = j0 + j - 1;
      const cDiag = D[prev + j - 1] + dist(ii, jj);
      const cUp = D[prev + j] + GAP;
      const cLeft = D[base + j - 1] + GAP;
      if (cDiag <= cUp && cDiag <= cLeft) { D[base + j] = cDiag; BACK[base + j] = 0; }
      else if (cUp <= cLeft) { D[base + j] = cUp; BACK[base + j] = 1; }
      else { D[base + j] = cLeft; BACK[base + j] = 2; }
    }
  }
  // 回溯：从最后一行的最优终点出发
  let bestJ = 1, bestV = Infinity;
  for (let j = 1; j <= w; j++) { if (D[h * W + j] < bestV) { bestV = D[h * W + j]; bestJ = j; } }
  let i = h, j = bestJ;
  const path = [];
  while (i > 0 && j > 0) {
    path.push([i0 + i - 1, j0 + j - 1]);
    const st = BACK[i * W + j];
    if (st === 0) { i--; j--; }
    else if (st === 1) i--;
    else j--;
  }
  path.reverse();
  if (!path.length) return null;
  // 取最接近 siC 的路径点 → 精修落点
  let bi = path[0], bd = Math.abs(path[0][0] - siC);
  for (const p of path) { const d = Math.abs(p[0] - siC); if (d < bd) { bd = d; bi = p; } }
  const dstT = bi[1] * hB;
  // 斜率：siC±1.5秒范围内路径的首尾
  const near = path.filter(p => Math.abs(p[0] - siC) <= Math.round(1.5 / hA));
  let slope = 1;
  if (near.length >= 2) {
    const p0 = near[0], p1 = near[near.length - 1];
    const dS = (p1[0] - p0[0]) * hA, dD = (p1[1] - p0[1]) * hB;
    if (dS > 0.3) { const sl = dD / dS; if (sl >= 0.85 && sl <= 1.18) slope = sl; }
  }
  return { dstT, slope };
}
/* 背景精对齐：变调补偿+粗到精，结果写入 p.audioMap（金点） */
async function refineSeamlessAudio(bvid) {
  const p = SEAM.prep.get(prepKey(bvid));
  if (!p || !p.ready || p.audioMap || p.audioPromise) return;
  const src = Player.S.track;
  if (!src || !src.bvid) return;
  p.audioPromise = (async () => {
    try {
      const r = await computeAudioMap({ bvid: src.bvid, cid: src.cid }, p.item);
      p.audioMap = r.map;
      p.shift = r.shift;
      updateSeamDots();
    } catch (e) { /* 音频对齐失败退回歌词映射 */ }
    finally { p.audioPromise = null; }
  })();
  return p.audioPromise;
}
function armSeamless(bvid) {
  const p = SEAM.prep.get(prepKey(bvid));
  if (p && p.ready) refineSeamlessAudio(bvid); // 顺手启动音频精对齐（背景，不阻塞）
  if (seamMode() !== 'instant') return; // 渐变缓冲模式不做预武装，保留自然准备节奏
  if (!p || !p.ready) return;
  const to = Player.otherEl();
  const srcT = Player.activeEl().currentTime || 0;
  const map = bestMapFor(p);
  const dstT = mapTime(srcT, map, Player.S.track ? Player.S.track.duration || 0 : 0, p.item.duration || 0);
  const at = Math.max(0, dstT); // 同句交叉：预缓冲到对齐点本身
  if (to.src === p.url && Math.abs((to.currentTime || 0) - at) < 3 && to.readyState >= 2) return; // 已就位
  to.src = p.url;
  try { to.currentTime = at; } catch (e) {}
  to.pause();
}
/* 选最优映射：音频DTW > 歌词锚点 > 时长比例 */
function bestMapFor(p) {
  return (p && p.audioMap) ? p.audioMap : (p ? p.map : null);
}
async function seamlessTo(it) {
  const idx = Player.S.index;
  if (idx < 0 || !it) return;
  try {
    const mode = seamMode();
    const fadeMs = mode === 'instant' ? 80 : Math.max(20, Player.fadeMs()); // 立即切入=80ms微交叉；渐变=用户设定时长
    const srcEl = Player.activeEl();
    const srcT = srcEl.currentTime || 0;
    const srcDur = Player.S.track ? Player.S.track.duration || 0 : 0;
    const dstDur = it.duration || 0;
    const p = SEAM.prep.get(prepKey(it.bvid));
    // prep里的item已补cid（VERSIONS原始行没有）：缓冲/队列都用它，避免cid缺失导致buffer查找落空
    if (p && p.item && p.item.cid) it = p.item;
    const map = bestMapFor(p); // 音频DTW > 歌词锚点 > 时长比例（三级回退）
    const durOk = !p || !p.item || !p.item.duration || !srcDur ||
      Math.abs(p.item.duration - srcDur) / Math.max(1, srcDur) <= 0.2;
    const useMap = !!map && (!map.isAudio || durOk);
    const mapFn = t => useMap
      ? mapTime(t, map, srcDur, dstDur)
      : (srcDur && dstDur ? Math.max(0, Math.min(dstDur - 3, t / srcDur * dstDur)) : t);
    let slope = srcDur && dstDur ? dstDur / srcDur : 1;
    if (useMap) {
      const sl = slopeAt(map, srcT);
      if (sl >= 0.85 && sl <= 1.18) slope = sl;
    }
    const dstT = mapFn(srcT); // 对齐点=切换发起瞬间：交叉窗内两轨唱同一句，结束无内容回跳

    // 记住原版 + 替换队列项
    applyVersionSwitch(idx, Player.S.queue[idx]);
    Player.S.queue[idx] = it;
    if (Player.S.slotOrig && Player.S.slotOrig.item && Player.S.slotOrig.item.bvid === it.bvid) Player.S.slotOrig = null;

    // 采样级路径：hover已解码的AudioBuffer在缓存里 → ABSN交接
    const buf = (it.bvid && it.cid) ? aalignBufferOf(it) : null;
    let ok = false;
    if (buf) {
      ok = await Player.crossfadeToBuffer(it, {
        fadeMs, slope, eqSwap: true, buffer: buf, url: p && p.url, mode,
        offsetAt: mapFn, srcPos: () => (Player.activeEl().currentTime || 0)
      }).catch(() => false);
    }
    // 回退：element路径（seek卫生+回读补偿+延迟补偿已在player内）
    if (!ok) {
      ok = await Player.crossfadeTo(Player.S.queue[idx], dstT, {
        fadeMs, slope, eqSwap: true, url: p && p.url, startOffset: 0, mode,
        srcPos: () => (srcEl.currentTime || 0), tsSampled: srcT
      }).catch(() => false);
    }
    closeModal();
    if (ok) toast('无缝衔接 · ' + (mode === 'instant' ? '立即切入' : '同句交叉') + ' @ ' + fmt(Math.round(dstT)), 'success');
    else {
      // 交叉失败：直接从这个位置开始播
      Player.S.resumeAt = dstT;
      Player.S.track = it;
      await Player.playCurrent().catch(() => {});
      toast('已切换版本 · 从 ' + fmt(Math.round(dstT)) + ' 处开始', 'success');
    }
  } catch (e) { errToast(e); }
}
function openVersions() {
  const so0 = Player.S.slotOrig;
  const origHere0 = so0 && so0.slot === Player.S.index && so0.item && so0.item.bvid !== (Player.S.track && Player.S.track.bvid) ? so0.item : null;
  if (!VERSIONS.groups.length && !origHere0) {
    if (VERSIONS.loading) { toast('正在搜索这首歌的其他版本…', ''); return; }
    /* 空结果：允许用户手动重搜（15秒节流）。限流导致的空结果要明确告知，而不是误报"没有版本" */
    const now = Date.now();
    const wasRisk = !!VERSIONS.lastRisk;
    if (!App._verRetryAt || now - App._verRetryAt > 15000) {
      App._verRetryAt = now;
      VERSIONS.searchCoolUntil = 0; // 用户主动重试：清掉冷却，再试一次
      const t = Player.S.track;
      const key = t ? (t.bvid || (t.nid ? 'n' + t.nid : '')) : '';
      if (key) VERSIONS.cache.delete(key);
      VERSIONS.bvid = null;
      loadVersionsIfNeeded();
      toast(wasRisk ? '上次搜索被限流，正在重新尝试…' : '正在重新搜索…', '');
    } else {
      toast(wasRisk ? 'B站搜索被限流了，稍等半分钟再点这个按钮' : '没找到这首歌的其他版本', wasRisk ? '' : 'error');
    }
    return;
  }
  const mode = seamMode();
  const so = Player.S.slotOrig;
  const origHere = origHere0;
  const origSec = origHere ? `
    <div class="vs-sec"><div class="vs-label">原版本（歌单里的那首，可切回）</div>
      <div class="ver-row" data-bvid="${origHere.bvid}">
        <img src="${esc(pic(origHere.pic))}" loading="lazy" onerror="this.style.visibility='hidden'">
        <div class="ver-main">
          <div class="ver-title" title="${esc(stripEm(origHere.title))}">${esc(stripEm(origHere.title))}</div>
          <div class="ver-meta">${esc(origHere.up || '')} · 原始版本</div>
        </div>
        <button class="btn" data-action="ver-seamless" data-bvid="${origHere.bvid}" title="交叉淡化切回原版"><i class="seam-dot"></i>无缝</button>
        <button class="btn primary" data-action="ver-play" data-bvid="${origHere.bvid}">切换</button>
      </div></div>` : '';
  const rows = g => g.items.slice(0, 8).map(it => `
    <div class="ver-row" data-bvid="${it.bvid}">
      <img src="${esc(pic(it.pic))}" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="ver-main">
        <div class="ver-title" title="${esc(stripEm(it.title))}">${esc(stripEm(it.title))}</div>
        <div class="ver-meta">${esc(it.up)} · ${nfmt(it.play || 0)}播放 · ${fmt(it.duration)}</div>
      </div>
      <button class="btn" data-action="ver-seamless" data-bvid="${it.bvid}" title="${mode === 'instant' ? '悬停预缓冲，点击立即交叉淡化（结束正好落在当前唱到的句子）' : '点击后短暂准备，交叉淡化从当前唱到的句子开始'}"><i class="seam-dot"></i>无缝</button>
      <button class="btn primary" data-action="ver-play" data-bvid="${it.bvid}">切换</button>
      <button class="btn" data-action="ver-add" data-bvid="${it.bvid}" title="加入歌单">${ICON.plus}</button>
    </div>`).join('') + (g.items.length > 8 ? `<div class="ver-more">该分组还有 ${g.items.length - 8} 个版本未展示</div>` : '');
  const modeSeg = `<div class="seam-mode" title="无缝衔接的手感">
      <button class="seg ${mode === 'instant' ? 'active' : ''}" data-action="seam-mode" data-mode="instant">立即衔接</button>
      <button class="seg ${mode === 'smooth' ? 'active' : ''}" data-action="seam-mode" data-mode="smooth">渐变缓冲</button>
    </div>`;
  showModal(`<div class="ver-head"><h3>${ICON.music} 版本宇宙 · ${esc(VERSIONS.core)}</h3>${modeSeg}</div>
    ${VERSIONS.stats ? `<div class="ver-stats">来源 ${VERSIONS.stats.axes} 轴${(VERSIONS.stats.risk || VERSIONS.stats.skipped) ? '（部分被限流，稍后重试）' : ''} · 候选 ${VERSIONS.stats.pool} · 收录 ${VERSIONS.stats.kept}</div>` : ''}
    ${origSec}
    <div class="ver-groups">${VERSIONS.groups.map(g => `
      <div class="vs-sec"><div class="vs-label">${esc(g.label)} · ${g.items.length}个</div>${rows(g)}</div>`).join('')}</div>
    <div class="m-row"><button class="btn primary" style="flex:1;justify-content:center" data-action="modal-close">完成</button></div>`);
  // 无缝预武装：逐行后台预备（地址/歌词/时间映射），行上绿点=就绪；悬停即预缓冲
  const displayRows = (origHere ? [origHere] : []).concat(VERSIONS.groups.flatMap(g => g.items.slice(0, 8)));
  prepareSeamless(displayRows);
  document.querySelectorAll('.vs-sec').forEach(wrap => wrap.addEventListener('pointerover', e => {
    const row = e.target.closest('.ver-row');
    if (row && row.dataset.bvid) armSeamless(row.dataset.bvid);
  }, { passive: true }));
}

/* ---------- 播放器回调 ---------- */
function bindPlayerHooks() {
  Player.hooks.onChange = (S, extra) => {
    /* 加载失败：响亮报错并自动跳下一首，绝不"没反应" */
    if (extra && extra.error) {
      const err = extra.error;
      /* 风控：不立刻跳歌，先冷却重试当前歌；连续2次风控则跳下一首（混排歌单里可能跳到B站歌） */
      if (err && err.risk) {
        App.riskStreak = (App.riskStreak || 0) + 1;
        const waitMs = Math.max(2000, Math.min(30000, (err.retryAt || 0) - Date.now() + 1500));
        if (!App.riskToastAt || Date.now() - App.riskToastAt > 8000) {
          App.riskToastAt = Date.now();
          toast('网易云风控中，' + Math.ceil(waitMs / 1000) + '秒后自动重试（无需操作）', '');
        }
        const nid = Player.S.track && Player.S.track.nid;
        if (!App.riskRetryTimer) {
          App.riskRetryTimer = setTimeout(() => {
            App.riskRetryTimer = null;
            const t = Player.S.track;
            /* 用户已切到别的歌就不重试旧的 */
            if (t && t.nid && String(t.nid) === String(nid)) Player.playCurrent().catch(() => {});
          }, waitMs);
        }
        /* 连续风控：别在一棵树上吊死，跳下一首（可能是B站歌） */
        if (App.riskStreak >= 2) {
          App.riskStreak = 0;
          if (App.riskRetryTimer) { clearTimeout(App.riskRetryTimer); App.riskRetryTimer = null; }
          const n = S.queue.length;
          if (n > 1) setTimeout(() => { Player.step(1).catch(() => {}); }, 400);
        }
        updateBar(S);
        return;
      }
      App.failStreak = (App.failStreak || 0) + 1;
      const ttl = (S.track && (S.track.title || S.track.name)) || '当前歌曲';
      const why = (err && err.message) || '加载失败';
      /* 去重：跳歌链会连环失败（不同歌名同原因），1.5s内同原因只报一次 */
      if (App.lastErrKey !== why || Date.now() - (App.lastErrAt || 0) > 1500) {
        App.lastErrKey = why; App.lastErrAt = Date.now();
        toast('「' + ttl + '」' + why, 'error');
      }
      const n = S.queue.length;
      if (n > 1 && App.failStreak <= Math.min(n, 20)) {
        setTimeout(() => { Player.step(1).catch(() => {}); }, 600);
      } else {
        if (n > 1) toast('连续多首无法播放，已停止（可能是无版权/VIP限制）', 'error');
        App.failStreak = 0;
      }
    }
    if (extra && extra.loaded) {
      App.failStreak = 0; App.riskStreak = 0;
      if (App.riskRetryTimer) { clearTimeout(App.riskRetryTimer); App.riskRetryTimer = null; }
      if (App.roam.active) {
        const remain = Player.S.queue.length - Player.S.index - 1;
        if (remain <= 2) roamFetch(10, false); // 漫游：快播完自动续批
      } else {
        maybeHeartbeat(false); // 心动：每 N 首插入一首推荐
      }
    }
    updateBar(S);
    const key = ((S.track && (S.track.bvid || ('n' + S.track.nid))) || '') + '|' + S.mode;
    /* 歌词身份包含 cid：B 站条目先到 bvid、后补 cid，补上后要重新加载一次 */
    const lyrId = S.track ? (S.track.nid ? ('n' + S.track.nid) : (S.track.bvid ? (S.track.bvid + '|' + (S.track.cid || '')) : '')) : '';
    if (lyrId && lyrId !== App._lastLyricId) {
      App._lastLyricId = lyrId;
      loadLyricsIfNeeded();
    }
    if (key !== App._lastKey) {
      App._lastKey = key;
      SEAM.dropStale(); // 换歌后旧源的配对映射全部失效（键=源|目标）
      state.miniClosed = false;
      updatePlayingMarks();
      if (state.view.name === 'nowplaying') renderView();
      updateVideoMount();
      loadRepliesIfNeeded(); // 切歌即预取该视频的评论
      clearTimeout(App.mv.aiTimer);
      App.mv.aiTheme = null;
      updateAiTag();
      maybeLoadAiTheme(false);
      if (S.track && S.track.cid) loadDanmaku(S.track.cid);   // 切歌即预取弹幕（云合唱）
      loadVersionsIfNeeded();                                  // 切歌即搜同曲版本（版本宇宙）
      if (state.npInfoTab === 'hot' && state.view.name === 'nowplaying') loadRepliesIfNeeded();
    }
    if (extra.loaded && Player.S.track && Player.S.track.cid) loadDanmaku(Player.S.track.cid);
    syncLyricHighlight();
    syncMVSubtitle();
    syncMVInstrumental();
    deskBroadcast(true); // 桌面组件立即同步
    saveSession(false); // 断点续播：切歌/进度推进时按需写盘
    // CD架跟随正在播放的歌：用户浏览时（宽限期内）不打扰，停止操作后再跟回
    if (state.view.name === 'pldetail' && state.cdMode && Player.S.track && state.playlist
        && Date.now() > App.cd.userUntil) {
      const tB = Player.S.track;
      const pi = state.playlist.items.findIndex(it => (tB.nid ? it.nid === tB.nid : it.bvid && it.bvid === tB.bvid));
      if (pi >= 0 && pi !== App.cd.cur) cdSetTrack(pi);
    }
    // 评论页打开时自动跟随当前视频（含 aid 延迟解析出来的情况）
    if (state.view.name === 'nowplaying' && state.npqTab === 'reply' && S.track && S.track.aid &&
        (!state.replies || state.replies.needAid || (!state.replies.loading && state.replies.aid !== S.track.aid))) {
      loadRepliesIfNeeded();
    }
    /* 错误提示已在函数开头统一处理（含风控分支与去重），此处不再重复弹 */
  };
}

/* ---------- 初始化 ---------- */
async function init() {
  // 静态图标
  const navLabels = { favfolders: '我的收藏', search: '搜索', nowplaying: '正在播放' };
  $$('.nav-item').forEach(el => {
    el.innerHTML = ICON[el.dataset.icon] + '<span>' + (navLabels[el.dataset.view] || '') + '</span>';
  });
  bindEvents();
  document.body.classList.toggle('mv-low-power', !!App.mv.lowPower);
  if (window.LyricMV && LyricMV.setLowPower) LyricMV.setLowPower(App.mv.lowPower);
  window.addEventListener('bp-low-fps', () => {
    if (!App.mv.autoPerf || App.mv.lowPower) return;
    setLowPower(true, true);
    try { toast('检测到帧率偏低，已自动开启性能模式', ''); } catch (e) {}
  });
  window.addEventListener('bp-mv-chorus', (e) => {
    const on = !!(e && e.detail && e.detail.on) && App.mv.on;
    document.body.classList.toggle('mv-chorus', on);
    if (App.mv.lastChorus === on) return;
    App.mv.lastChorus = on;
    if (window.FoliaBridge && FoliaBridge.setPvFx) FoliaBridge.setPvFx(on);
    if (App.mv.director && App.mv.sectionSwitch) {
      if (on) crossfadeTo(App.mv.directorChorus);
      else if (App.mv.directorBase) crossfadeTo(App.mv.directorBase);
    }
    if (App.mv.director && window.LyricMV && LyricMV.setTune) {
      if (App.mv.style === 'flow') LyricMV.setTune({ flowVine: on ? 1.65 : 1, flowPreview: true });
      else if (App.mv.style === 'vertical') LyricMV.setTune({ vWait: on ? .68 : .5 });
    }
  });
  window.addEventListener('bp-style-fallback', (e) => {
    const st = e && e.detail && e.detail.style;
    if (!st || App.mv.style !== st) return;
    try { toast('这个样式内容为空，已切回流光', ''); } catch (err) {}
    setMVStyle('flow');
  });
  document.addEventListener('input', (e) => {
    const inp = e.target && e.target.closest ? e.target.closest('[data-tune]') : null;
    if (!inp) return;
    const k = inp.dataset.tune;
    if (!(k in App.mv.tune)) return;
    App.mv.tune[k] = inp.type === 'checkbox' ? inp.checked : Number(inp.value);
    try { localStorage.setItem('bp.mvTune', JSON.stringify(App.mv.tune)); } catch (err) {}
    updateTunePanel();
    if (window.LyricMV && LyricMV.setTune) LyricMV.setTune(App.mv.tune);
  });
  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'ne-pick-search') nePickFilter(e.target.value);
  });
  bindPlayerBar();
  bindPlayerHooks();
  vizLoad();
  sideBgLoad();
  loadAiConfig();
  if (window.FoliaBridge) {
    FoliaBridge.configure({
      getStyle: () => App.mv.style,
      isMVOn: () => !!(App.mv.on && state.view.name === 'nowplaying' && Player.S.track && Player.S.mode !== 'video'),
      getTrack: () => Player.S.track,
      getLines: () => (state.lyrics && state.lyrics.lines) || [],
      getLyricKey: () => {
        const L = state.lyrics;
        return L ? [L.source, L.quality, L.offsetMs, L.lines && L.lines.length, JSON.stringify(L.lineOffsets || {})].join('|') : '';
      },
      getSegments: () => App.mv.segments,
      getTime: () => { try { return Player.activeEl().currentTime || 0; } catch (e) { return 0; } },
      getDuration: () => { try { return Player.activeEl().duration || 0; } catch (e) { return 0; } },
      getPlaying: () => !!Player.S.playing,
      getTheme: () => App.mv.aiTheme,
      getTone: () => App.mv.tone,
      getBpm: () => (App.mv.bpmInfo && App.mv.bpmInfo.bpm) || 120,
      getLowPower: () => !!App.mv.lowPower,
      getSpectrum: () => { try { return Player.getSpectrum(); } catch (e) { return null; } },
      getHost: () => document.getElementById('mv-folia-lumiere'),
      onRuntimeError: (err) => {
        App.mv.foliaError = err || null;
        try { console.warn('[Folia runtime]', err && err.source, err && err.message); } catch (e) {}
      },
      onFailure: (style, err) => {
        if (App.mv.style !== style) return;
        try { toast(err ? '这个样式运行出错，已切回流光' : '这个样式加载失败，已切回流光', ''); } catch (e) {}
        setMVStyle('flow');
      }
    });
  }
  applySideBg();
  applyCollapse();
  window.addEventListener('beforeunload', () => saveSession(true));
  window.addEventListener('pagehide', () => saveSession(true));
  deskCommands();
  setInterval(() => deskBroadcast(false), 500);

  const vol = parseFloat(localStorage.getItem('bp.vol'));
  Player.setVolume(isFinite(vol) ? vol : 0.8);
  AudioFX.setVolume(Player.volume());
  updateVolumeIcon();

  // 断点续播：恢复上次队列与进度（点播放才真正加载媒体）
  let resumed = null;
  if (restoreSession()) {
    const t = Player.S.resumeAt || 0;
    resumed = { title: stripEm(Player.S.track.title || ''), time: t };
  }

  try { state.user = await Api.get('user'); } catch { state.user = { isLogin: false }; }
  try { const nd = await Api.get('nuser'); state.neUser = nd.user || (nd.expired ? (nd.profile || null) : null); state.neExpired = !!nd.expired; } catch { state.neUser = null; state.neExpired = false; }
  try {
    state.playlists = (await Api.get('playlists')).playlists || [];
    // 旧数据迁移：清洗搜索标题里残留的高亮标签
    let dirty = false;
    state.playlists.forEach(pl => pl.items.forEach(it => { const s = stripEm(it.title); if (s !== it.title) { it.title = s; dirty = true; } }));
    if (dirty) state.playlists.forEach(pl => Api.put('playlists/' + pl.id, { items: pl.items }).catch(() => {}));
  } catch {}
  render();
  if (resumed) {
    toast(resumed.time > 1
      ? `已恢复上次播放「${resumed.title.slice(0, 18)}」· 从 ${fmt(resumed.time)} 继续`
      : `已恢复上次播放「${resumed.title.slice(0, 18)}」`, 'success');
  }
  if (state.user && state.user.isLogin && state.view.name === 'favfolders') loadFolders();
}

init();
