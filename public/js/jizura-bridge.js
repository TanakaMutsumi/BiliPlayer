/* JIZURA 文字 PV runtime bridge (MIT engine vendored at /vendor/jizura).
   Lazy-loads the engine, builds one plan per song, and draws it from the
   current playback time every animation frame. */
(function () {
  const ENGINE = '/vendor/jizura/jizura-engine.js';
  const SCRIPTS = [
    '01_util.js','02_fonts.js','02b_lang.js','03_text.js','04_styles.js','05_anim.js','05b_registry.js',
    '06_layouts.js','07_decor.js','08_planner.js','08b_omakase.js','09_render.js','10_audio.js','11_export.js',
    '11p_bgcamB.js','11p_decor.js','11p_decorB.js','11p_enter.js','11p_enterB.js','11p_exit.js','11p_exitB.js',
    '11p_fxB.js','11p_horror1.js','11p_horror2.js','11p_horror3.js','11p_kinetic1.js','11p_kinetic2.js',
    '11p_kinetic3.js','11p_layoutsA.js','11p_layoutsB.js','11p_layoutsC.js','11p_layoutsD.js','11p_looks.js',
    '11p_styles.js','11p_treattrans.js','11p_typo1.js','11p_typo2.js','11p_typo3.js',
    '11p_x2_bg.js','11p_x2_camtr.js','11p_x2_decA.js','11p_x2_decB.js','11p_x2_decC.js','11p_x2_entA.js',
    '11p_x2_entB.js','11p_x2_entC.js','11p_x2_exA.js','11p_x2_exB.js','11p_x2_exC.js','11p_x2_fx.js',
    '11p_x2_hold.js','11p_x2_horrorA.js','11p_x2_horrorB.js','11p_x2_kineticA.js','11p_x2_kineticB.js',
    '11p_x2_layA.js','11p_x2_layB.js','11p_x2_layC.js','11p_x2_layD.js','11p_x2_treat.js','11p_x2_typoA.js',
    '11p_x2_typoB.js','11p_x2_waA.js','11p_x2_waB.js','11q_sets.js'
  ];
  const PRESETS = [
    { id: 'auto', label: '随机', theme: null, style: '', mood: '' },
    { id: 'calm', label: '静谧', theme: 'ballad', style: 'specimen', mood: 'calm' },
    { id: 'noir', label: '黑白', theme: 'lyricpv', style: 'noir', mood: 'editorial' },
    { id: 'paper', label: '纸感', theme: 'lyricpv', style: 'paper', mood: 'editorial' },
    { id: 'wa', label: '和风', theme: 'wa', style: '', mood: 'calm' },
    { id: 'pop', label: '流行', theme: 'pop', style: 'magenta', mood: 'pop' },
    { id: 'kinetic', label: '动感', theme: 'kinetic', style: '', mood: 'graphic' },
    { id: 'mono', label: '极简', theme: 'ballad', style: 'mono', mood: 'calm' }
  ];
  const STYLE_ZH = {
    noir: '黑白噪点', crimson: '绯红信号', caution: '警戒黄', magenta: '品红流行',
    paper: '纸感墨水', hud: '暗色HUD', mint: '薄荷终端', specimen: '标本', transit: '通勤',
    blueprint: '蓝图', rouge: '胭脂渐变', mono: '单色RGB', hrRuin: '废墟', hrNightRec: '深夜录像',
    hrCurse: '诅咒信件', sakura: '樱花', ocean: '深海', sunset: '晚霞渐变', forest: '森林手帖',
    vapor: '蒸汽波', newsprint: '报纸', synth80: '80s合成器', kraft: '牛皮纸', candy: '糖果',
    acid: '酸性', sumi: '墨与朱', gold: '金夜'
  };
  const MOOD_ZH = {
    glitch: '故障', calm: '静谧', pop: '流行', graphic: '图形', editorial: '编辑',
    emotional: '情绪', horror: '恐怖', chaos: '全部混合'
  };
  const ASPECTS = ['16:9', '4:3', '1:1', '9:16'];
  const NO_LYRICS = '[00:00.50][間奏]';
  const MIN_PART_LINES = 3, MAX_PART_LINES = 8, MIN_REPEAT_RUN = 2, INTERLUDE_MIN_S = 6;
  let cfg = null;
  let enginePromise = null;
  let renderer = null;
  let plan = null;
  let normalPlan = null;
  let chorusPlan = null;
  let chorusKey = '';
  let chorusBuilding = false;
  let canvas = null;
  let ctx = null;
  let canvasB = null;
  let ctxB = null;
  let fadeUntil = 0;
  let buildSeq = 0;
  let host = null;
  let raf = 0;
  let fallbackTimer = 0;
  let buildKey = '';
  let building = false;
  let seed = 0;
  let trackKey = '';
  let lastDraw = -1;
  let lastW = 0;
  let lastH = 0;
  let lastError = null;
  let lastBuildMs = 0;
  let lastRenderMs = 0, renderTotal = 0, renderCount = 0, avgRenderMs = 0;
  let fontBound = false;
  let chorus = false;
  let draws = 0, builds = 0, lastReason = '';
  let prebuilt = null;
  let prebuildTries = 0, prebuildError = '', prebuildStage = '', prebuiltHits = 0, prebuiltUsedTrack = '';
  let emptyEl = null;
  let loading = false;
  let perfLevel = 0, perfAt = 0, perfFrames = 0, perfLow = 0, perfHigh = 0, fps = 0, lastRafAt = 0, perfWarmUntil = 0;
  let nextFrameAt = 0;
  let lastBuildCheck = 0;
  const TARGET_FRAME_MS = 1000 / 60;
  const planCache = new Map();
  const st = {
    preset: read('bp.jizuraPreset', 'auto'),
    style: read('bp.jizuraStyle', ''),
    mood: read('bp.jizuraMood', ''),
    fx: readJson('bp.jizuraFx', {}),
    locked: read('bp.jizuraLock', '0') === '1',
    titleCard: read('bp.jizuraTitle', '1') !== '0',
    overlay: read('bp.jizuraOverlay', '0') === '1',
    fusion: read('bp.jizuraFusion', '0') === '1',
    themeColors: read('bp.jizuraThemeColors', '0') === '1',
    favorites: readJson('bp.jizuraFavs', []),
    history: [],
    historyIndex: -1
  };
  if (!PRESETS.some(p => p.id === st.preset)) st.preset = 'auto';

  function read(k, d) { try { return localStorage.getItem(k) == null ? d : localStorage.getItem(k); } catch (e) { return d; } }
  function write(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) {} }
  function readJson(k, d) { try { const v = JSON.parse(localStorage.getItem(k) || ''); return v == null ? d : v; } catch (e) { return d; } }
  function saveJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function h(s) {
    let x = 0x811c9dc5;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 0x01000193);
    return x >>> 0;
  }
  const keyOf = it => it ? (it.bvid ? 'b' + it.bvid : (it.nid ? 'n' + it.nid : (it.title || ''))) : '';
  const tag = t => {
    const m = Math.floor(t / 60), s = t - m * 60;
    return '[' + String(m).padStart(2, '0') + ':' + s.toFixed(2).padStart(5, '0') + ']';
  };
  function escapeMarkup(s) {
    return String(s || '').replace(/^#/, '＃').replace(/\|/g, '｜').replace(/\*/g, '＊').replace(/\//g, '／');
  }

  /* ---- full LRC -> JIZURA section conversion (adapted from jizura-sync, MIT) ---- */
  function lrcToJizura(lrc) {
    const rows = [];
    for (const raw of String(lrc || '').replace(/\r/g, '').split('\n')) {
      const m = raw.match(/^((?:\[\d+:\d+(?:[.:]\d+)?\])+)(.*)$/);
      if (!m) continue;
      const times = [...m[1].matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)].map(t => +t[1] * 60 + parseFloat(t[2].replace(':', '.')));
      const text = escapeMarkup(m[2].trim());
      for (const t of times) rows.push({ t, text });
    }
    rows.sort((a, b) => a.t - b.t);
    const sung = [];
    let blank = false, interlude = null;
    rows.forEach((r, i) => {
      if (r.text) { sung.push({ t: r.t, text: r.text, blank, interlude }); blank = false; interlude = null; return; }
      if (sung.length) blank = true;
      const next = rows[i + 1];
      if (next && next.t - r.t >= INTERLUDE_MIN_S && interlude === null) interlude = r.t;
    });
    if (!sung.length) return { lyrics: NO_LYRICS, lines: 0, parts: 0 };
    const breaks = partBreaks(sung);
    const out = [];
    sung.forEach((s, i) => {
      if (i > 0 && breaks[i]) out.push('');
      if (s.interlude !== null) out.push(tag(s.interlude) + '[間奏]');
      out.push(tag(s.t) + s.text);
    });
    if (interlude !== null) out.push('', tag(interlude) + '[間奏]');
    return { lyrics: out.join('\n'), lines: sung.length, parts: 1 + breaks.filter((b, i) => b && i > 0).length };
  }
  function partBreakGap(rows) {
    const iv = rows.slice(1).map((r, i) => r.t - rows[i].t).sort((a, b) => a - b);
    if (!iv.length) return Infinity;
    return Math.max(4, 1.8 * iv[iv.length >> 1]);
  }
  function partBreaks(sung) {
    const n = sung.length, br = new Array(n).fill(0);
    const set = (i, s) => { if (i > 0 && i < n) br[i] = Math.max(br[i], s); };
    const gap = partBreakGap(sung);
    sung.forEach((s, i) => {
      if (s.interlude !== null) set(i, 4);
      if (s.blank) set(i, 3);
      if (i > 0 && s.t - sung[i - 1].t >= gap) set(i, 2);
    });
    const norm = t => t.replace(/[\s、。，．,.!！?？…・「」『』（）()"'“”‘’~〜ー―-]/g, '').toLowerCase();
    const first = new Map();
    const rep = sung.map((s, i) => {
      const k = norm(s.text);
      if (k.length < 2) return -1;
      if (first.has(k)) return first.get(k);
      first.set(k, i);
      return -1;
    });
    for (let a = 0; a < n;) {
      if (rep[a] < 0) { a++; continue; }
      let b = a;
      while (b + 1 < n && rep[b + 1] === rep[b] + 1) b++;
      if (b - a + 1 >= MIN_REPEAT_RUN) {
        const len = b - a + 1;
        for (const i of [a, b + 1, rep[a], rep[a] + len]) set(i, 2);
      }
      a = b + 1;
    }
    for (;;) {
      const starts = [0, ...br.flatMap((s, i) => (s ? [i] : []))];
      let fixed = false;
      for (let p = 0; p < starts.length && !fixed; p++) {
        const a = starts[p], b = p + 1 < starts.length ? starts[p + 1] : n;
        if (b - a >= MIN_PART_LINES) continue;
        const before = a > 0 && br[a] < 4 ? br[a] : Infinity;
        const after = b < n && br[b] < 4 ? br[b] : Infinity;
        if (before === Infinity && after === Infinity) continue;
        br[before <= after ? a : b] = 0;
        fixed = true;
      }
      if (!fixed) break;
    }
    const split = (a, b) => {
      if (b - a + 1 <= MAX_PART_LINES) return;
      let k = -1, best = -1;
      for (let j = a + MIN_PART_LINES; j <= b - MIN_PART_LINES + 1; j++) {
        const d = sung[j].t - sung[j - 1].t;
        if (d > best) { best = d; k = j; }
      }
      if (k < 0) return;
      br[k] = 1;
      split(a, k - 1); split(k, b);
    };
    let start = 0;
    for (let i = 1; i <= n; i++) if (i === n || br[i]) { split(start, i - 1); start = i; }
    return br.map(Boolean);
  }
  function linesToJizura(lines) {
    const rows = (lines || []).map(l => ({ t: Math.max(0, Number(l.t) || 0), text: String(l.text || '').trim() }))
      .filter(l => l.text).sort((a, b) => a.t - b.t);
    if (!rows.length) return NO_LYRICS;
    const out = [];
    let prev = null;
    for (const l of rows) {
      if (prev && l.t - prev.t > INTERLUDE_MIN_S) out.push(tag(prev.t + 0.5));
      out.push(tag(l.t) + escapeMarkup(l.text));
      prev = l;
    }
    const r = lrcToJizura(out.join('\n'));
    return r.lyrics || NO_LYRICS;
  }

  function active() {
    if (!cfg || !cfg.getStyle || !cfg.isMVOn || !cfg.isMVOn()) return false;
    return cfg.getStyle() === 'jizura';
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.charset = 'utf-8';
      s.onload = res;
      s.onerror = () => rej(new Error('JIZURA script failed: ' + src));
      document.head.appendChild(s);
    });
  }
  function ensureEngine() {
    if (window.J) { applyLocalFonts(window.J); return Promise.resolve(window.J); }
    if (enginePromise) return enginePromise;
    enginePromise = loadScript(ENGINE).then(() => {
      if (!window.J) throw new Error('JIZURA engine did not expose J');
      applyLocalFonts(window.J);
      return window.J;
    }).catch(() => SCRIPTS.reduce((p, file) => p.then(() => loadScript('/vendor/jizura/src/' + file)), Promise.resolve()).then(() => {
      if (!window.J) throw new Error('JIZURA engine did not expose J');
      return window.J;
    })).catch(e => { enginePromise = null; throw e; });
    return enginePromise;
  }
  function applyLocalFonts(J) {
    try {
      for (const k of ['dela', 'mono', 'gothic_black', 'gothic_bold', 'gothic_med', 'gothic_light']) if (J.FONTS && J.FONTS[k]) J.FONTS[k].gf = null;
      for (const k of ['mincho_black', 'mincho_bold', 'mincho', 'mincho_light']) if (J.FONTS && J.FONTS[k]) { J.FONTS[k].gf = null; J.FONTS[k].family = '"Noto Serif JP"'; }
    } catch (e) {}
  }
  function aspectFor() {
    const hostEl = getHost();
    const r = hostEl ? hostEl.clientWidth / Math.max(1, hostEl.clientHeight) : 16 / 9;
    let best = ASPECTS[0], bd = Infinity;
    for (const a of ASPECTS) {
      const [w, hh] = a.split(':').map(Number);
      const d = Math.abs(Math.log(r / (w / hh)));
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
  function getHost() {
    host = (cfg && cfg.getHost && cfg.getHost()) || document.getElementById('mv-jizura');
    return host;
  }
  function makeCanvas() {
    const hEl = getHost();
    if (!hEl) return false;
    if (!canvas || !canvas.isConnected || !canvasB || !canvasB.isConnected) {
      hEl.innerHTML = '';
      canvas = document.createElement('canvas');
      canvas.className = 'jizura-canvas jizura-a';
      hEl.appendChild(canvas);
      ctx = canvas.getContext('2d');
      canvasB = document.createElement('canvas');
      canvasB.className = 'jizura-canvas jizura-b';
      hEl.appendChild(canvasB);
      ctxB = canvasB.getContext('2d');
      emptyEl = null;
    }
    if (!emptyEl || !emptyEl.isConnected) {
      emptyEl = document.createElement('div');
      emptyEl.className = 'jizura-empty';
      hEl.appendChild(emptyEl);
    }
    hEl.classList.toggle('jizura-overlay', st.overlay);
    hEl.classList.toggle('jizura-fusion', st.fusion);
    hEl.classList.toggle('jizura-chorus', !!(chorus && chorusPlan));
    hEl.classList.toggle('jizura-perf', perfLevel > 0);
    return !!ctx && !!ctxB;
  }
  function syncLyricHint(lines, busy) {
    if (!emptyEl || !emptyEl.isConnected) return;
    const instrumental = !!(cfg && cfg.getInstrumental && cfg.getInstrumental());
    const empty = !busy && !loading && (instrumental || !Array.isArray(lines) || !lines.length);
    const on = empty ? '1' : '0';
    if (emptyEl.dataset.on === on) return;
    emptyEl.dataset.on = on;
    emptyEl.textContent = empty ? '暂无歌词 · 纯音乐' : '';
    emptyEl.classList.toggle('show', empty);
  }
  function currentPreset() { return PRESETS.find(p => p.id === st.preset) || PRESETS[0]; }
  function setBackdrop(it) {
    const h = getHost();
    if (!h) return;
    const cov = it && it.pic ? String(it.pic) : '';
    // 纯歌词模式不再铺封面，让画布真正透出底层 MV 背景；封面融合才保留封面。
    const showCover = !!cov && (!st.overlay || st.fusion);
    const url = showCover ? cov : '';
    // 每帧重写 backgroundImage 会触发整块 host 重绘，缓存 URL 后只在实际变化时更新。
    if ((h.dataset.coverUrl || '') !== url) {
      h.dataset.coverUrl = url;
      h.style.backgroundImage = url ? 'url("' + url.replace(/"/g, '%22') + '")' : '';
    }
    h.classList.toggle('has-cover', !!url);
  }
  function seedFor(it) {
    const k = keyOf(it);
    try {
      const stored = localStorage.getItem('bp.jizuraSeed.' + k);
      if (stored) return Number(stored) >>> 0;
    } catch (e) {}
    return h(k + '|' + (it && it.title || ''));
  }
  function saveSeed() { try { localStorage.setItem('bp.jizuraSeed.' + trackKey, String(seed)); } catch (e) {} saveHistory(); }
  function saveHistory() {
    if (!trackKey) return;
    try { localStorage.setItem('bp.jizuraHistory.' + trackKey, JSON.stringify({ list: st.history.slice(-20), index: st.historyIndex })); } catch (e) {}
  }
  function trackSeed(it) {
    const k = keyOf(it);
    try {
      const h = JSON.parse(localStorage.getItem('bp.jizuraHistory.' + k) || 'null');
      if (h && Array.isArray(h.list) && h.list.length) {
        return Number(h.list[Math.max(0, Math.min(h.list.length - 1, Number(h.index) || 0))]) >>> 0;
      }
    } catch (e) {}
    return seedFor(it);
  }
  function loadHistory(it) {
    const k = keyOf(it);
    let h = null;
    try { h = JSON.parse(localStorage.getItem('bp.jizuraHistory.' + k) || 'null'); } catch (e) {}
    if (h && Array.isArray(h.list) && h.list.length) {
      st.history = h.list.map(x => Number(x) >>> 0);
      st.historyIndex = Math.max(0, Math.min(st.history.length - 1, Number(h.index) || 0));
      seed = st.history[st.historyIndex];
    } else {
      seed = seedFor(it);
      st.history = [seed];
      st.historyIndex = 0;
    }
  }
  function options() {
    const J = window.J;
    return {
      presets: PRESETS.map(p => ({ id: p.id, label: p.label })),
      styles: J ? Object.keys(J.STYLES).map(k => ({ id: k, label: STYLE_ZH[k] || J.STYLES[k].name || k })) : [],
      moods: J ? Object.keys(J.MOODS).map(k => ({ id: k, label: MOOD_ZH[k] || J.MOODS[k].name || k })) : []
    };
  }
  function getState() {
    const it = cfg && cfg.getTrack && cfg.getTrack();
    const key = keyOf(it);
    const bpm = Math.round(Number(cfg && cfg.getBpm && cfg.getBpm()) || 0);
    const tempo = cfg && cfg.getBpmSegments ? cfg.getBpmSegments() : null;
    const tempoBpms = Array.isArray(tempo) ? tempo.map(s => Number(s && s.bpm) || 0).filter(Boolean) : [];
    const keyInfo = cfg && cfg.getKey ? cfg.getKey() : null;
    return {
      seed, locked: st.locked, preset: st.preset, style: st.style, mood: st.mood,
      fx: st.fx, titleCard: st.titleCard, overlay: st.overlay,
      favorite: !!(it && st.favorites.some(f => f.key === key && f.seed === seed)),
      favoritesForTrack: it ? st.favorites.filter(f => f.key === key).slice(0, 8) : [],
      historyIndex: st.historyIndex, historyLength: st.history.length,
      hasPlan: !!plan, hasChorusPlan: !!chorusPlan, themeColors: st.themeColors, fusion: st.fusion, lastBuildMs,
      lastRenderMs: Math.round(lastRenderMs * 10) / 10, avgRenderMs: Math.round(avgRenderMs * 10) / 10, options: options(),
      bpm, tempoSegments: tempoBpms.length, bpmMin: tempoBpms.length ? Math.round(Math.min.apply(null, tempoBpms)) : bpm,
      bpmMax: tempoBpms.length ? Math.round(Math.max.apply(null, tempoBpms)) : bpm,
      fps, perfLevel,
      keyName: keyInfo && keyInfo.name || '', keyLabel: keyInfo && keyInfo.label || '',
      keyConfidence: keyInfo && Number(keyInfo.confidence) || 0,
      prebuilt: !!prebuilt, prebuildTries, prebuildError, prebuildStage, prebuiltHits,
      configured: !!cfg, active: active(), raf: !!raf, building, buildKey, cache: planCache.size, draws, builds, lastReason,
      cfgStyle: cfg && cfg.getStyle ? cfg.getStyle() : '',
      cfgMVOn: cfg && cfg.isMVOn ? !!cfg.isMVOn() : false
    };
  }
  function notify() {
    try { if (cfg && cfg.onUpdate) cfg.onUpdate(getState()); } catch (e) {}
  }
  function resetPlan() { plan = null; buildKey = ''; lastDraw = -1; }
  function fail(e) {
    lastError = e || new Error('JIZURA failure');
    try { console.warn('[JIZURA]', lastError && lastError.stack || lastError); } catch (err) {}
    try { if (cfg && cfg.onFailure) cfg.onFailure('jizura', lastError); } catch (err) {}
    stop();
  }
  function setLoading(on, text) {
    loading = !!on;
    const h = getHost();
    if (!h) return;
    h.classList.toggle('jizura-loading', !!on);
    if (on) h.dataset.loadingText = text || '正在生成 JIZURA 画面…';
  }
  function linesSig(lines) {
    if (!Array.isArray(lines) || !lines.length) return '0';
    let x = 0x811c9dc5;
    for (const ln of lines) {
      const s = String(ln && ln.t || 0) + '|' + String(ln && ln.text || '');
      for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 0x01000193);
    }
    return lines.length + ':' + (x >>> 0);
  }
  function preSigFor(it, lines, o) {
    const preset = o.preset || currentPreset();
    // 预构建只用于首帧兜底：时长/配色/BPM/aspect 允许和正式 plan 不同，正式 plan 会很快替换。
    return [keyOf(it), it.title || '', linesSig(lines), o.seed, preset.id, st.style, st.mood,
      JSON.stringify(st.fx), st.titleCard, st.overlay, st.fusion, st.themeColors].join('|');
  }
  function planKeyFor(it, lines, o) {
    const preset = o.preset || currentPreset();
    const duration = Math.max(1, Number(o.duration) || Number(it.duration) || 60);
    const bs = (o.beats || []).filter(t => Number.isFinite(t) && t >= 0 && t < duration);
    const beatSig = bs.length ? (bs.length + ':' + bs[0] + ':' + bs[bs.length - 1]) : '0';
    return [cfg.getStyle(), keyOf(it), it.title || '', (lines || []).length,
      (lines && lines[0] && lines[0].t) || 0, (lines && lines[lines.length - 1] && lines[lines.length - 1].t) || 0,
      o.seed, preset.id, st.style, st.mood, JSON.stringify(st.fx), st.titleCard, st.overlay, st.fusion, st.themeColors,
      JSON.stringify(o.colors || null), o.bpm || 0, o.phase || 0, beatSig, o.aspect || aspectFor(),
      linesSig(lines), Math.round(duration)].join('|');
  }
  function createPlanData(J, it, lines, o) {
    const preset = o.preset || currentPreset();
    const duration = Math.max(1, Number(o.duration) || Number(it.duration) || 60);
    const lyrics = linesToJizura(lines);
    const base = Object.assign(J.defaultProject(), {
      extra: true, typo: true, kinetic: true, horror: false,
      title: st.titleCard ? (it.title || '') : '',
      artist: st.titleCard ? (it.up || it.artist || '') : '',
      lyrics, aspect: o.aspect || aspectFor(), fps: 60, seed: o.seed,
      keyBg: 'off'
    });
    const look = J.omakase(base, J.rng(o.seed), preset.theme || null);
    const project = Object.assign(base, look, {
      style: st.style || look.style,
      mood: st.mood || look.mood,
      unify: true,
      timing: Object.assign({}, base.timing, { bpm: o.bpm || 0, snap: (o.bpm || 0) > 0 }),
      fx: Object.assign({}, look.fx, st.fx, st.titleCard ? {} : { hud: 'off' })
    });
    project.enabled = Object.assign({}, J.defaultProject().enabled, look.enabled);
    if (st.themeColors && o.colors) {
      const tc = o.colors;
      project.colors = Object.assign({}, project.colors, {
        enabled: false, accentOn: true, accent: tc.accent, ghostA: tc.ghostA, ghostB: tc.ghostB
      });
    }
    const useBeats = (o.beats || []).filter(t => Number.isFinite(t) && t >= 0 && t < duration);
    const plan = J.plan(project, { duration, beats: useBeats.length ? useBeats : null });
    return { plan, project, useBeats, duration, lyrics };
  }

  function build() {
    builds++;
    if (building || !active()) { lastReason = building ? 'building' : 'inactive'; return; }
    lastError = null;
    const it = cfg.getTrack && cfg.getTrack();
    const lines = cfg.getLines && cfg.getLines();
    if (!it) { lastReason = 'no-track'; return; }
    setBackdrop(it);
    if (!trackKey || trackKey !== keyOf(it)) {
      trackKey = keyOf(it);
      loadHistory(it);
    }
    if (!seed) seed = seedFor(it);
    const preset = currentPreset();
    const aspect = aspectFor();
    const bpm = Math.max(0, Number(cfg.getBpm && cfg.getBpm()) || 0);
    const phase = Math.max(0, Number(cfg.getBpmPhase && cfg.getBpmPhase()) || 0);
    const colors = (cfg.getColors && cfg.getColors()) || null;
    const durationHint = Math.max(1, Number(cfg.getDuration && cfg.getDuration()) || Number(it.duration) || 60);
    const rawBeats = cfg.getBeats && cfg.getBeats();
    const beats = Array.isArray(rawBeats) ? rawBeats.filter(x => Number.isFinite(x) && x >= 0 && x < durationHint).slice() : [];
    if (!beats.length && bpm > 0) for (let t = phase; t < durationHint; t += 60 / bpm) beats.push(t);
    const nextKey = planKeyFor(it, lines, { seed, preset, aspect, bpm, phase, beats, colors, duration: durationHint });
    if (nextKey === buildKey && plan) return;
    if (planCache.has(nextKey)) {
      plan = planCache.get(nextKey);
      normalPlan = plan;
      chorusPlan = null; chorusKey = '';
      buildKey = nextKey;
      renderer = renderer || new window.J.Renderer();
      lastDraw = -1;
      makeCanvas();
      setLoading(false);
      notify();
      return;
    }
    // 下一首预构建：先立即画出预构建 plan，再在后台用当前 BPM/配色重建。
    const preSig = preSigFor(it, lines, { seed, preset, aspect, duration: durationHint });
    if (prebuilt && prebuilt.sig === preSig && prebuilt.plan && prebuilt.trackKey !== prebuiltUsedTrack) {
      plan = prebuilt.plan;
      normalPlan = plan;
      lastDraw = -1;
      makeCanvas();
      lastReason = 'prebuilt';
      prebuiltHits++;
      prebuiltUsedTrack = prebuilt.trackKey;
      notify();
    }
    building = true;
    const seq = ++buildSeq;
    setLoading(true, (lines || []).length ? '正在生成 JIZURA 画面…' : '等待歌词…');
    notify();
    ensureEngine().then(async J => {
      if (!active()) return;
      await new Promise(r => setTimeout(r, 20));
      if (seq !== buildSeq || !active()) return;
      try {
        const bt = performance.now();
        const data = createPlanData(J, it, lines, { seed, preset, aspect, bpm, phase, beats, colors, duration: durationHint });
        lastBuildMs = Math.round(performance.now() - bt);
        if (seq !== buildSeq || !active()) return;
        plan = data.plan;
        normalPlan = plan;
        chorusPlan = null; chorusKey = '';
        if (host) host.classList.remove('jizura-chorus');
        scheduleChorusPlan(J, data.project, data.duration, data.useBeats, nextKey);
        renderer = renderer || new J.Renderer();
        buildKey = nextKey;
        planCache.set(nextKey, plan);
        if (planCache.size > 4) planCache.delete(planCache.keys().next().value);
        lastDraw = -1;
        makeCanvas();
        setLoading(false);
        try { J.ensureFonts(data.lyrics + ' ' + (it.title || '') + ' ' + (it.up || ''), J.fontsOfPlan(plan)).catch(() => {}); } catch (e) {}
        if (!fontBound && document.fonts && document.fonts.addEventListener) {
          fontBound = true;
          document.fonts.addEventListener('loadingdone', () => { lastDraw = -1; });
        }
        notify();
      } catch (e) { fail(e); }
    }).catch(fail).finally(() => { building = false; setLoading(false); });
  }
  function prebuild(it, lines, opts) {
    prebuildTries++;
    prebuildError = '';
    if (!it || !Array.isArray(lines) || !lines.length) { prebuildError = 'no-lines'; return false; }
    if (!cfg || cfg.getStyle() !== 'jizura') { prebuildError = 'inactive'; return false; }
    const preset = currentPreset();
    const aspect = aspectFor();
    const seedVal = Number.isFinite(opts && opts.seed) ? opts.seed : trackSeed(it);
    const bpm = Math.max(0, Number(opts && opts.bpm) || 0);
    const phase = Math.max(0, Number(opts && opts.phase) || 0);
    const duration = Math.max(1, Number(opts && opts.duration) || Number(it.duration) || 60);
    const beats = Array.isArray(opts && opts.beats) ? opts.beats.filter(t => Number.isFinite(t) && t >= 0 && t < duration) : [];
    const colors = (opts && opts.colors) || null;
    const sig = preSigFor(it, lines, { seed: seedVal, preset, aspect, duration });
    if (prebuilt && prebuilt.sig === sig) { prebuildStage = 'cached'; return true; }
    let done = false;
    const run = () => {
      if (done) return;
      if (building) { prebuildStage = 'wait-build'; setTimeout(run, 700); return; }
      if (!cfg || cfg.getStyle() !== 'jizura') { prebuildStage = 'skip-style'; return; }
      done = true;
      prebuildStage = 'engine';
      ensureEngine().then(J => {
        if (!cfg || cfg.getStyle() !== 'jizura') { prebuildStage = 'skip-style'; return; }
        try {
          prebuildStage = 'creating';
          const data = createPlanData(J, it, lines, { seed: seedVal, preset, aspect, bpm, phase, beats, colors, duration });
          const key = planKeyFor(it, lines, { seed: seedVal, preset, aspect, bpm, phase, beats, colors, duration });
          prebuilt = { sig, trackKey: keyOf(it), plan: data.plan, at: Date.now() };
          prebuiltUsedTrack = '';
          planCache.set(key, data.plan);
          if (planCache.size > 4) planCache.delete(planCache.keys().next().value);
          prebuildStage = 'built';
          notify();
        } catch (e) { prebuildError = String(e && e.message || e); prebuildStage = 'error'; }
      }).catch(e => { prebuildError = String(e && e.message || e); prebuildStage = 'engine-error'; });
    };
    prebuildStage = 'scheduled';
    if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 3000 });
    setTimeout(run, 1200);
    return true;
  }
  function scheduleChorusPlan(J, project, duration, beats, key) {
    if (chorusBuilding || chorusPlan || !active()) return;
    chorusBuilding = true;
    const run = () => {
      if (chorusPlan) return;
      try {
        if (!active() || buildKey !== key) return;
        const fx = Object.assign({}, project.fx, {
          glitch: Math.min(1, (Number(project.fx.glitch) || 0.5) + 0.25),
          density: Math.min(1, (Number(project.fx.density) || 0.5) + 0.12),
          motion: Math.min(1, (Number(project.fx.motion) || 0.5) + 0.12)
        });
        const cp = Object.assign({}, project, { fx });
        chorusPlan = J.plan(cp, { duration, beats: beats.length ? beats : null });
        chorusKey = key;
        if (chorus) { plan = chorusPlan; lastDraw = -1; fadeUntil = performance.now() + 450; if (host) host.classList.add('jizura-chorus'); }
        notify();
      } catch (e) { /* chorus plan is optional */ }
      finally { chorusBuilding = false; }
    };
    if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 2200 });
    setTimeout(run, 1400);
  }
  function sizeCanvas(p) {
    if (!p || !canvas || !canvasB || !host) return false;
    const cw = host.clientWidth, ch = host.clientHeight;
    if (!cw || !ch) return false;
    const scale = Math.min(cw / p.W, ch / p.H);
    const base = cfg && cfg.getLowPower && cfg.getLowPower() ? 1 : 2;
    const cap = Math.min(base, perfLevel >= 4 ? 0.85 : perfLevel >= 3 ? 1 : perfLevel >= 2 ? 1.15 : perfLevel >= 1 ? 1.5 : base);
    const dpr = Math.max(0.75, Math.min(cap, window.devicePixelRatio || 1));
    const w = Math.max(2, Math.round(p.W * scale * dpr));
    const hh = Math.max(2, Math.round(p.H * scale * dpr));
    const sw = Math.round(p.W * scale) + 'px', sh = Math.round(p.H * scale) + 'px';
    for (const c of [canvas, canvasB]) {
      if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
      if (c.style.width !== sw) c.style.width = sw;
      if (c.style.height !== sh) c.style.height = sh;
    }
    return true;
  }
  function renderPlan(p, c, x, t) {
    if (!p || !c || !x || !window.J) return;
    try {
      renderer = renderer || new window.J.Renderer();
      const rt = performance.now();
      renderer.frame(x, p, Math.min(t, Math.max(0, p.duration - 0.001)), {
        scale: c.width / p.W,
        fast: !!(cfg.getLowPower && cfg.getLowPower()) || perfLevel >= 1,
        // 引擎自带透明通道：跳过背景/扫描线/辉光，只保留歌词与安全区特效。
        transparent: !!(st.overlay || st.fusion)
      });
      lastRenderMs = performance.now() - rt;
      renderTotal += lastRenderMs; renderCount++;
      avgRenderMs = renderTotal / renderCount;
      if (renderCount > 600) { renderTotal *= 0.5; renderCount *= 0.5; }
    } catch (e) { fail(e); }
  }
  function noteFrame(now) {
    if (document.hidden || !document.hasFocus()) return;
    if (now < perfWarmUntil) { perfAt = now; perfFrames = 0; return; }
    if (!perfAt || now - perfAt > 2500) { perfAt = now; perfFrames = 0; return; }
    perfFrames++;
    const dt = now - perfAt;
    if (dt < 1100) return;
    fps = Math.round(perfFrames * 1000 / dt);
    perfAt = now; perfFrames = 0;
    if (fps < 45) { perfLow += 2; perfHigh = 0; }
    else if (fps < 55) { perfLow++; perfHigh = 0; }
    else if (fps >= 59) { perfHigh++; perfLow = 0; }
    else { perfLow = perfHigh = 0; }
    if (perfLow >= 2 && perfLevel < 4) {
      perfLevel++; perfLow = 0; lastDraw = -1;
      if (host) host.classList.add('jizura-perf');
    } else if (perfHigh >= 4 && perfLevel > 0) {
      perfLevel--; perfHigh = 0; lastDraw = -1;
      if (perfLevel === 0 && host) host.classList.remove('jizura-perf');
    }
  }
  function draw() {
    draws++;
    if (!active()) { lastReason = 'draw-inactive'; return; }
    const now = performance.now();
    const cur = cfg.getTrack && cfg.getTrack();
    // 计划键/歌词签名不需要每帧重算：换歌立即检查，其余 200ms 一次。
    if (!normalPlan || !plan || (cur && keyOf(cur) !== trackKey) || now - lastBuildCheck > 200) {
      build();
      lastBuildCheck = now;
    }
    const normal = normalPlan || plan;
    if (!normal) return;
    if (!makeCanvas()) return;
    if (!sizeCanvas(normal)) return;
    syncLyricHint(cfg.getLines && cfg.getLines(), building);
    const t = Math.max(0, Number(cfg.getTime && cfg.getTime()) || 0);
    if (lastDraw === t && lastW === canvas.width && lastH === canvas.height) return;
    lastDraw = t; lastW = canvas.width; lastH = canvas.height;
    renderPlan(normal, canvas, ctx, t);
    const useChorus = !!(chorus && chorusPlan);
    const fading = performance.now() < fadeUntil;
    if (chorusPlan && (useChorus || fading)) renderPlan(chorusPlan, canvasB, ctxB, t);
    if (host) host.classList.toggle('jizura-chorus', useChorus);
  }
  function loop(now) {
    if (!active()) { stop(); return; }
    const t = now || performance.now();
    lastRafAt = t;
    // 目标 60fps：高刷屏上跳过高刷帧，避免无意义的额外渲染和帧时间抖动。
    if (nextFrameAt && t < nextFrameAt - 2) {
      raf = requestAnimationFrame(loop);
      return;
    }
    if (!nextFrameAt || t - nextFrameAt > 100) nextFrameAt = t;
    nextFrameAt += TARGET_FRAME_MS;
    draw();
    lastRafAt = performance.now();
    noteFrame(t);
    raf = requestAnimationFrame(loop);
  }
  function start() {
    if (!raf) raf = requestAnimationFrame(loop);
    nextFrameAt = 0;
    lastBuildCheck = 0;
    perfWarmUntil = performance.now() + 2500;
    lastRafAt = performance.now();
    if (!fallbackTimer) fallbackTimer = setInterval(() => {
      if (!active()) return;
      // 可见时 rAF 正常就不再额外画；隐藏窗口/掉帧时才用 250ms 兜底。
      if (document.hidden || performance.now() - lastRafAt > 450) draw();
    }, 250);
  }
  function stop() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = 0; }
    lastDraw = -1;
    lastW = lastH = 0;
    lastRafAt = 0;
    nextFrameAt = 0;
    lastBuildCheck = 0;
    perfAt = 0; perfFrames = 0; fps = 0;
    loading = false;
    buildSeq++;
    canvas = null; ctx = null; canvasB = null; ctxB = null;
    emptyEl = null;
    if (host) {
      host.classList.remove('jizura-loading');
      host.classList.remove('jizura-chorus');
      host.classList.remove('jizura-perf');
    }
  }
  function reroll() {
    if (!cfg || st.locked) return false;
    const it = cfg.getTrack && cfg.getTrack();
    if (!it) return false;
    st.history = st.history.slice(0, st.historyIndex + 1);
    seed = (seed + 1) >>> 0;
    st.history.push(seed);
    st.historyIndex = st.history.length - 1;
    saveSeed();
    resetPlan();
    start();
    notify();
    return true;
  }
  function stepHistory(dir) {
    if (!cfg || st.locked) return;
    const next = st.historyIndex + dir;
    if (next < 0 || next >= st.history.length) return;
    st.historyIndex = next;
    seed = st.history[next];
    saveSeed();
    resetPlan();
    start();
    notify();
  }
  function setPreset(id) {
    const p = PRESETS.find(x => x.id === id) || PRESETS[0];
    st.preset = p.id;
    st.style = p.style || '';
    st.mood = p.mood || '';
    write('bp.jizuraPreset', st.preset);
    write('bp.jizuraStyle', st.style);
    write('bp.jizuraMood', st.mood);
    resetPlan(); start(); notify();
  }
  function setStyle(key) { st.style = key || ''; write('bp.jizuraStyle', st.style); resetPlan(); start(); notify(); }
  function setMood(key) { st.mood = key || ''; write('bp.jizuraMood', st.mood); resetPlan(); start(); notify(); }
  function setFx(key, value) {
    if (!['motion', 'glitch', 'chroma', 'decor', 'density', 'texture'].includes(key)) return;
    st.fx[key] = Math.max(0, Math.min(1, Number(value) || 0));
    saveJson('bp.jizuraFx', st.fx);
    resetPlan(); start(); notify();
  }
  function toggleLock() { st.locked = !st.locked; write('bp.jizuraLock', st.locked ? '1' : '0'); notify(); }
  function applyFavorite(value) {
    const n = Number(value) >>> 0;
    if (!n) return;
    seed = n;
    st.history = st.history.slice(0, st.historyIndex + 1);
    st.history.push(seed);
    st.historyIndex = st.history.length - 1;
    saveSeed();
    resetPlan();
    start();
    notify();
  }
  function removeFavorite(value) {
    const n = Number(value) >>> 0;
    st.favorites = st.favorites.filter(f => f.seed !== n);
    saveJson('bp.jizuraFavs', st.favorites);
    notify();
  }
  function toggleFavorite() {
    const it = cfg && cfg.getTrack && cfg.getTrack();
    if (!it) return;
    const key = keyOf(it);
    const idx = st.favorites.findIndex(f => f.key === key && f.seed === seed);
    if (idx >= 0) st.favorites.splice(idx, 1);
    else st.favorites.unshift({ key, title: it.title || '', seed, preset: st.preset, at: Date.now() });
    st.favorites = st.favorites.slice(0, 30);
    saveJson('bp.jizuraFavs', st.favorites);
    notify();
  }
  function setTitleCard(on) { st.titleCard = !!on; write('bp.jizuraTitle', st.titleCard ? '1' : '0'); resetPlan(); start(); notify(); }
  function setOverlay(on) { st.overlay = !!on; write('bp.jizuraOverlay', st.overlay ? '1' : '0'); resetPlan(); start(); notify(); }
  function setFusion(on) { st.fusion = !!on; write('bp.jizuraFusion', st.fusion ? '1' : '0'); resetPlan(); start(); notify(); }
  function setThemeColors(on) { st.themeColors = !!on; write('bp.jizuraThemeColors', st.themeColors ? '1' : '0'); resetPlan(); start(); notify(); }
  function setChorus(on) {
    chorus = !!on;
    const use = !!(chorus && chorusPlan);
    if (host) host.classList.toggle('jizura-chorus', use);
    plan = use ? chorusPlan : (normalPlan || plan);
    fadeUntil = performance.now() + 450;
    lastDraw = -1;
    if (host) { host.classList.add('jizura-cut'); setTimeout(() => host && host.classList.remove('jizura-cut'), 360); }
    notify();
  }

  window.JizuraBridge = {
    configure(c) {
      cfg = c;
      if (!raf) start();
      notify();
    },
    preload() { ensureEngine().then(() => notify()).catch(() => {}); },
    prebuild,
    refresh() { if (!active()) { stop(); return; } resetPlan(); start(); notify(); },
    sync() { if (active()) { start(); } else { stop(); } notify(); },
    setStyle() { if (active()) { start(); notify(); } else { stop(); } },
    reroll, prev: () => stepHistory(-1), next: () => stepHistory(1),
    setPreset, setStyleKey: setStyle, setMood, setFx,
    toggleLock, toggleFavorite, applyFavorite, removeFavorite, setTitleCard, setOverlay, setFusion, setThemeColors, setChorus,
    getState, getOptions: options, getLastError: () => lastError,
    stop
  };
})();
