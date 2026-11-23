/* 动态歌词 MV（第一版：流光）
   纯原生实现：Canvas2D 背景 + 粒子 + 频谱律动，DOM 逐字高亮。
   由 app.js 提供歌词/播放时间/频谱/主题色，自身不读写播放器状态。
   设计原则：只在 body.mv-on 时运行；离开正在播放页/切视频/关闭时立即停 rAF。 */
(function () {
  'use strict';

  const M = {
    api: null,
    layer: null,
    canvas: null,
    ctx: null,
    prev: null,
    cur: null,
    next: null,
    title: null,
    artist: null,
    raf: 0,
    running: false,
    w: 0,
    h: 0,
    dpr: 1,
    chars: [],
    words: [],
    idx: -2,
    mode: '',
    linesRef: null,
    particles: [],
    blobs: [],
    bass: 0,
    color: '',
    rgb: [251, 114, 153],
    lastPaint: 0,
    lastTs: 0,
    lastMetaAt: 0,
    frames: 0,
    style: 'flow',
    palette: null,
    paletteKey: '',
    paletteBusy: '',
    coverArt: null,
    mood: 'dream',
    moodPrev: null,
    moodFade: 1,
    moodManual: 'auto',
    moodKey: '',
    moodCache: new Map(),
    aiTheme: null,
    aiPalette: null,
    aiKey: '',
    tone: 'dark',
    aiAnim: 'normal',
    aiWordColors: [],
    aiBg: null,
    aiInk: null,
    aiSecondary: null,
    bg: { stars: [], rain: [], dust: [] },
    fx: { fireworks: [], embers: [], fireflies: [], bokeh: [], ripples: [], lastLevel: 0, energy: 0, beat: 0, lastBurst: 0, nextBurst: 0, lightning: null, nextLightning: 0 },
    chorusSet: null,
    isChorus: false,
    bpmInfo: null,
    paragraphs: null,
    paraOf: null,
    paraKind: null,
    paraStart: null,
    paraShots: null,
    fxEl: null,
    bands: { bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0 },
    gl: { canvas: null, gl: null, prog: null, buf: null, u: {}, ready: false, failed: false, w: 0, h: 0 },
    scroll: null,
    fume: { world: null, layout: [], byLine: [], els: [], sel: null, idx: -2, linesRef: null, lastW: 0, lastH: 0, cam: null },
    chat: { box: null, rows: [], map: new Map(), idx: -2, key: '', align: 0 },
    vine: null, vctx: null, vineSnaps: [], vineLast: null,
    tune: { flowKeep: 2, flowVine: 1, flowPreview: true, vWait: 0.5, vCols: 6, vGap: 26 },
    healthAt: 0, healthFail: 0, lastChorus: false, lowPower: false,
    perfStart: 0, perfAt: 0, perfFrames: 0, perfLow: 0, perfFired: false
  };

  const CJK = /[\u2e80-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/;
  const PUNC = /[，。！？、；：,.!?;:'"“”‘’（）()《》〈〉【】\[\]…—–\-~～]/;
  const STYLES = { flow: 1, fume: 1, diorama: 1, chat: 1, cinema: 1, hanabi: 1, vertical: 1, poem: 1, cloud: 1, confess: 1, fog: 1, lumiere: 1, tempera: 1, ring: 1, cadenza: 1, monet: 1, pvharu: 1, pvcyber: 1, pvweb: 1 };
  const FOLIA_STYLES = { lumiere: 1, hanabi: 1, poem: 1, tempera: 1, confess: 1, cloud: 1, ring: 1, cadenza: 1, fog: 1, chat: 1, cinema: 1, monet: 1, pvharu: 1, pvcyber: 1, pvweb: 1 };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function parseColor(c) {
    c = String(c || '').trim();
    let m = c.match(/^#([0-9a-f]{6})$/i);
    if (m) {
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    m = c.match(/^#([0-9a-f]{3})$/i);
    if (m) {
      const s = m[1];
      return [parseInt(s[0] + s[0], 16), parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16)];
    }
    m = c.match(/^rgba?\(([^)]+)\)/i);
    if (m) {
      const p = m[1].split(/[,\s/]+/).map(Number);
      if (p.length >= 3 && p.slice(0, 3).every(n => isFinite(n))) return [p[0], p[1], p[2]];
    }
    return [251, 114, 153];
  }

  function rgba(rgb, a) {
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')';
  }

  function mixWhite(rgb, k) {
    return [
      Math.round(rgb[0] + (255 - rgb[0]) * k),
      Math.round(rgb[1] + (255 - rgb[1]) * k),
      Math.round(rgb[2] + (255 - rgb[2]) * k)
    ];
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: h, s: s, l: l };
  }

  function hslToRgb(h, s, l) {
    let r;
    let g;
    let b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  /* Sobel 边缘 → 白线透明底，用作“线稿”背景 */
  function makeLineArt(ctx, size) {
    try {
      const img = ctx.getImageData(0, 0, size, size);
      const d = img.data;
      const gray = new Float32Array(size * size);
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        gray[p] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      }
      const out = ctx.createImageData(size, size);
      for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
          const i = y * size + x;
          const gx = -gray[i - size - 1] - 2 * gray[i - 1] - gray[i + size - 1]
            + gray[i - size + 1] + 2 * gray[i + 1] + gray[i + size + 1];
          const gy = -gray[i - size - 1] - 2 * gray[i - size] - gray[i - size + 1]
            + gray[i + size - 1] + 2 * gray[i + size] + gray[i + size + 1];
          const mag = Math.sqrt(gx * gx + gy * gy);
          const a = Math.max(0, Math.min(255, (mag - 0.08) * 620));
          const o = i * 4;
          out.data[o] = 255;
          out.data[o + 1] = 255;
          out.data[o + 2] = 255;
          out.data[o + 3] = a;
        }
      }
      ctx.putImageData(out, 0, 0);
    } catch (e) {}
  }

  const PALETTE_CACHE = new Map();

  /* 从封面取一个适合暗背景的主色：32×32 采样 → 颜色桶 → 饱和/亮度打分 */
  function paletteFromImage(url) {
    if (!url || !/^https?:/i.test(url)) return Promise.resolve(null);
    if (PALETTE_CACHE.has(url)) return Promise.resolve(PALETTE_CACHE.get(url));
    return fetch('/api/img?u=' + encodeURIComponent(url), { cache: 'force-cache' })
      .then(r => { if (!r.ok) throw new Error('img ' + r.status); return r.blob(); })
      .then(b => createImageBitmap(b))
      .then(bmp => {
        const sw = bmp.width || 32;
        const sh = bmp.height || 32;
        const side = Math.min(sw, sh);
        const sx = (sw - side) / 2;
        const sy = (sh - side) / 2;
        const small = document.createElement('canvas');
        small.width = 160;
        small.height = 160;
        small.getContext('2d').drawImage(bmp, sx, sy, side, side, 0, 0, 160, 160);
        const line = document.createElement('canvas');
        line.width = 256;
        line.height = 256;
        const lctx = line.getContext('2d', { willReadFrequently: true });
        lctx.drawImage(bmp, sx, sy, side, side, 0, 0, 256, 256);
        const c = document.createElement('canvas');
        c.width = 32;
        c.height = 32;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(bmp, 0, 0, 32, 32);
        if (bmp.close) bmp.close();
        const d = x.getImageData(0, 0, 32, 32).data;
        const buckets = new Map();
        let lSum = 0;
        let sSum = 0;
        let wSum = 0;
        let l2Sum = 0;
        let statN = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 160) continue;
          const r = d[i];
          const g = d[i + 1];
          const b = d[i + 2];
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          const sat = mx ? (mx - mn) / mx : 0;
          lSum += lum;
          sSum += sat;
          wSum += (r - b) / 255;
          l2Sum += lum * lum;
          statN++;
          if (lum < 0.06 || lum > 0.96) continue;
          const key = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4);
          let e = buckets.get(key);
          if (!e) {
            e = { n: 0, r: 0, g: 0, b: 0, sat: 0, lum: 0 };
            buckets.set(key, e);
          }
          e.n++;
          e.r += r;
          e.g += g;
          e.b += b;
          e.sat += sat;
          e.lum += lum;
        }
        const lumAvg = statN ? lSum / statN : 0.4;
        const stats = {
          lum: lumAvg,
          sat: statN ? sSum / statN : 0.3,
          warm: statN ? wSum / statN : 0,
          contrast: statN ? Math.sqrt(Math.max(0, l2Sum / statN - lumAvg * lumAvg)) : 0.3
        };
        makeLineArt(lctx, 256);
        const lineInk = document.createElement('canvas');
        lineInk.width = 256;
        lineInk.height = 256;
        const ictx = lineInk.getContext('2d');
        ictx.drawImage(line, 0, 0);
        ictx.globalCompositeOperation = 'source-in';
        ictx.fillStyle = '#171512';
        ictx.fillRect(0, 0, 256, 256);
        let best = null;
        let bestScore = -1;
        for (const e of buckets.values()) {
          const r = e.r / e.n;
          const g = e.g / e.n;
          const b = e.b / e.n;
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          const sat = mx ? (mx - mn) / mx : 0;
          const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          const score = Math.log(1 + e.n) * (0.35 + sat * 1.1) * (1 - Math.abs(lum - 0.45) * 0.9);
          if (score > bestScore) {
            bestScore = score;
            best = [r, g, b];
          }
        }
        if (!best) return null;
        const hsl = rgbToHsl(best[0], best[1], best[2]);
        const accent = hslToRgb(
          hsl.h,
          Math.min(0.9, Math.max(0.5, hsl.s * 1.2)),
          Math.min(0.66, Math.max(0.45, hsl.l))
        );
        return { accent: accent, light: mixWhite(accent, 0.5), stats: stats, small: small, line: line, lineInk: lineInk };
      })
      .then(p => {
        PALETTE_CACHE.set(url, p || null);
        if (PALETTE_CACHE.size > 24) PALETTE_CACHE.delete(PALETTE_CACHE.keys().next().value);
        return p || null;
      })
      .catch(() => {
        PALETTE_CACHE.set(url, null);
        return null;
      });
  }

  function loadPalette(url) {
    M.paletteKey = url || '';
    M.palette = null;
    M.coverArt = null;
    M.color = '';
    if (!url || M.paletteBusy === url) return;
    M.paletteBusy = url;
    paletteFromImage(url).then(p => {
      if (M.paletteKey !== url) return;
      M.palette = p;
      M.color = '';
      M.paletteBusy = '';
      applyColor();
      pickMood(true);
    });
  }

  const MOODS = ['dream', 'night', 'rain', 'warm', 'neon', 'cover', 'lineart'];

  function moodFromAnalysis(lines, palette, track) {
    const text = (((track && track.title) || '') + ' ' + (lines || []).map(l => l.text).join(' ')).toLowerCase();
    const st = (palette && palette.stats) || { lum: 0.4, sat: 0.3, warm: 0, contrast: 0.3 };
    const hit = arr => arr.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
    const S = { dream: 1.0, night: 0.55, rain: 0.5, warm: 0.55, neon: 0.4, cover: 0.85, lineart: 0.35 };
    S.night += Math.min(3, hit(['夜', '月', '星', '眠', '夢', '闇', 'よる', 'つき', 'ほし', 'ねむ', 'ゆめ', 'night', 'moon', 'star', 'sleep', 'dark']) * 0.75);
    S.rain += Math.min(3, hit(['雨', '涙', '泣', '別れ', 'さよなら', '孤独', '寂', '痛', 'rain', 'tear', 'cry', 'alone', 'goodbye', 'pain']) * 0.75);
    S.warm += Math.min(3, hit(['夏', '春', '花', '光', '太陽', '阳', '愛', '恋', '君', '笑', 'なつ', 'はる', 'はな', 'ひかり', 'たいよう', 'あい', 'こい', 'きみ', 'sun', 'summer', 'flower', 'love', 'light']) * 0.7);
    S.dream += Math.min(2.5, hit(['空', '雲', '風', '海', '羽', '夢', '幻', '星', '光', 'そら', 'くも', 'かぜ', 'うみ', 'ゆめ', 'まぼろし', 'sky', 'cloud', 'wind', 'sea', 'dream']) * 0.55);
    S.neon += Math.min(2.5, hit(['街', '電', '夜', '走', '叫', '狂', 'ダンス', 'dance', 'neon', 'electric', 'city', 'run', 'scream']) * 0.6);
    S.lineart += Math.min(2.5, hit(['死', '黒', '闇', '終', '崩', '壊', '血', 'black', 'end', 'broken']) * 0.6);
    if (st.lum < 0.32) { S.night += 0.9; S.lineart += 0.5; }
    if (st.lum > 0.62) { S.warm += 0.7; S.dream += 0.3; }
    if (st.sat > 0.45) { S.neon += 0.5; S.warm += 0.25; }
    if (st.warm > 0.08) { S.warm += 0.7; S.dream += 0.2; }
    if (st.warm < -0.08) { S.rain += 0.5; S.night += 0.3; }
    if (st.contrast > 0.28) S.lineart += 0.35;
    if (!lines || lines.length < 4) S.cover += 0.8;
    let best = 'dream';
    let bs = -1;
    for (const m in S) if (S[m] > bs) { bs = S[m]; best = m; }
    const key = (M.api && M.api.getTrackKey && M.api.getTrackKey()) || '';
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h + key.charCodeAt(i)) % 9973;
    if (h % 7 === 0 && S.cover > bs * 0.85) best = 'cover';
    if (h % 11 === 0 && S.night > bs * 0.9) best = 'night';
    return best;
  }

  function applyMood(m) {
    if (!MOODS.includes(m)) m = 'dream';
    if (M.mood === m && M.moodFade >= 1) return;
    if (M.mood !== m) {
      M.moodPrev = M.mood;
      M.moodFade = 0;
    }
    M.mood = m;
    if (M.layer) M.layer.setAttribute('data-mood', m);
    if (M.api && M.api.onMoodChange) {
      try { M.api.onMoodChange(m); } catch (e) {}
    }
  }

  function pickMood(force) {
    if (M.moodManual && M.moodManual !== 'auto') { applyMood(M.moodManual); return; }
    if (M.aiTheme && MOODS.includes(M.aiTheme.mood)) { applyMood(M.aiTheme.mood); return; }
    const key = (M.api && M.api.getTrackKey && M.api.getTrackKey()) || '';
    if (!key) return;
    const lines = (M.api && M.api.getLines && M.api.getLines()) || [];
    if (!M.palette && !lines.length) return;
    let mood = M.moodCache.get(key);
    if (force || !mood) {
      mood = moodFromAnalysis(lines, M.palette, M.api && M.api.getTrack && M.api.getTrack());
      M.moodCache.set(key, mood);
      if (M.moodCache.size > 200) M.moodCache.delete(M.moodCache.keys().next().value);
    }
    applyMood(mood);
  }

  function setMoodManual(m) {
    M.moodManual = MOODS.includes(m) ? m : 'auto';
    if (M.moodManual === 'auto') pickMood(true);
    else applyMood(M.moodManual);
  }

  function aiToneTheme() {
    if (!M.aiTheme) return null;
    return (M.tone === 'light' && M.aiTheme.light) ? M.aiTheme.light : (M.aiTheme.dark || M.aiTheme.light || null);
  }

  function applyAiTone() {
    const t = aiToneTheme();
    if (!M.layer) return;
    M.layer.setAttribute('data-tone', M.tone === 'light' && t ? 'light' : 'dark');
    if (!t) {
      M.aiPalette = null;
      M.aiBg = null;
      M.aiInk = null;
      M.aiSecondary = null;
      M.aiAnim = 'normal';
      M.aiWordColors = [];
      return;
    }
    M.layer.dataset.font = t.fontStyle === 'sans' ? 'sans' : 'serif';
    M.layer.style.setProperty('--mv-ink', t.primaryColor);
    M.layer.style.setProperty('--mv-accent', t.accentColor);
    M.layer.style.setProperty('--mv-secondary', t.secondaryColor);
    M.layer.style.setProperty('--mv-paper', t.backgroundColor);
    M.aiPalette = parseColor(t.accentColor);
    M.aiBg = parseColor(t.backgroundColor);
    M.aiInk = parseColor(t.primaryColor);
    M.aiSecondary = parseColor(t.secondaryColor);
    M.aiAnim = t.animationIntensity || 'normal';
    M.aiWordColors = Array.isArray(t.wordColors) ? t.wordColors : [];
    applyScrollConfig();
  }

  function setTone(tone) {
    if (tone === 'light' && M.aiTheme && M.aiTheme.light) M.tone = 'light';
    else M.tone = 'dark';
    applyAiTone();
    M.color = '';
    applyColor();
    applyScrollConfig();
    if (M.fume.world) {
      undecorateFumeLine();
      M.fume.idx = -2;
    }
  }

  function normalizeAiTheme(theme) {
    if (!theme) return null;
    if (theme.dark && theme.light) return theme;
    const p = theme.palette || {};
    const accent = p.accent || '#fb7299';
    return Object.assign({}, theme, {
      dark: {
        name: theme.name,
        description: theme.description,
        backgroundColor: p.bg || '#0d1117',
        primaryColor: p.text || '#ffffff',
        accentColor: accent,
        secondaryColor: p.light || accent,
        fontStyle: 'sans',
        animationIntensity: 'normal',
        wordColors: []
      },
      light: {
        name: theme.name,
        description: theme.description,
        backgroundColor: '#efe9dc',
        primaryColor: '#171512',
        accentColor: accent,
        secondaryColor: '#6b6258',
        fontStyle: 'sans',
        animationIntensity: 'normal',
        wordColors: []
      }
    });
  }

  function setAiTheme(theme, key) {
    theme = normalizeAiTheme(theme);
    M.aiKey = key || '';
    M.aiTheme = theme && theme.mood ? theme : null;
    if (!M.aiTheme || !M.aiTheme.light) M.tone = 'dark';
    applyAiTone();
    M.color = '';
    if (M.aiTheme && M.moodManual === 'auto' && MOODS.includes(M.aiTheme.mood)) {
      applyMood(M.aiTheme.mood);
    } else if (!M.aiTheme && M.moodManual === 'auto') {
      pickMood(true);
    }
    applyColor();
    if (M.fume.world) {
      undecorateFumeLine();
      M.fume.idx = -2;
    }
    if (M.layer) {
      if (M.aiTheme) M.layer.setAttribute('data-ai', '1');
      else M.layer.removeAttribute('data-ai');
    }
  }

  function applyColor() {
    const cover = (M.api && M.api.getCoverUrl && M.api.getCoverUrl()) || '';
    if (cover !== M.paletteKey) loadPalette(cover);
    if (M.palette) M.coverArt = M.palette;
    updateGLTexture();
    const ai = M.aiTheme && M.aiTheme.palette ? M.aiPalette : null;
    const base = ai || (M.palette
      ? M.palette.accent
      : parseColor((M.api && M.api.getColor && M.api.getColor()) || '#fb7299'));
    const key = (ai ? 'ai:' : '') + base.join(',');
    if (key === M.color) return;
    M.color = key;
    M.rgb = base;
    const g = ai
      ? parseColor(M.aiTheme.palette.light || M.aiTheme.palette.accent)
      : (M.palette ? M.palette.light : mixWhite(base, 0.25));
    if (M.layer) M.layer.style.setProperty('--mv-glow', 'rgba(' + g[0] + ',' + g[1] + ',' + g[2] + ',0.62)');
    ensureParticles(true);
  }

  function resize(force) {
    if (!M.layer) return;
    const w = M.layer.clientWidth;
    const h = M.layer.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, M.lowPower ? 1 : 1.5);
    if (!force && w === M.w && h === M.h && dpr === M.dpr) return;
    M.w = w;
    M.h = h;
    M.dpr = dpr;
    M.fume.world = null;
    M.fume.lastW = 0;
    M.fume.lastH = 0;
    if (M.canvas) {
      const cw = Math.round(w * dpr);
      const ch = Math.round(h * dpr);
      if (M.canvas.width !== cw || M.canvas.height !== ch) {
        M.canvas.width = cw;
        M.canvas.height = ch;
      }
    }
    if (M.vine) {
      const cw = Math.round(w * dpr);
      const ch = Math.round(h * dpr);
      if (M.vine.width !== cw || M.vine.height !== ch) { M.vine.width = cw; M.vine.height = ch; }
    }
    ensureParticles(true);
    if (M.scroll) applyScrollConfig();
  }

  function ensureParticles(force) {
    if (!force && M.particles.length && M.blobs.length) return;
    const density = M.style === 'diorama' ? 1.55 : M.style === 'fume' ? 0.65 : 1;
    const n = Math.round(clamp((M.w * M.h) / 16000 * density * (M.lowPower ? 0.45 : 1), 16, 140));
    M.particles = [];
    for (let i = 0; i < n; i++) {
      M.particles.push({
        x: Math.random(),
        y: Math.random(),
        r: (0.6 + Math.random() * 1.9) * (M.style === 'diorama' ? 1.3 : 1),
        sp: 0.006 + Math.random() * 0.018,
        ph: Math.random() * Math.PI * 2,
        k: Math.random() < 0.28 ? 0.55 : 0.15
      });
    }
    const cfgs = [
      [0.18, 0.24, 0.58, 1.0, 0.100, 0.26],
      [0.82, 0.26, 0.44, 1.45, 0.080, 0.46],
      [0.52, 0.78, 0.50, 0.85, 0.065, 0.32],
      [0.26, 0.70, 0.34, 1.15, 0.055, 0.20],
      [0.72, 0.64, 0.40, 0.95, 0.050, 0.14]
    ];
    M.blobs = cfgs.map(c => ({
      x: c[0], y: c[1], r: c[2], sp: c[3], a: c[4], k: c[5],
      ph: Math.random() * Math.PI * 2
    }));
  }

  function updateMeta() {
    const t = (M.api && M.api.getTrack && M.api.getTrack()) || {};
    const title = t.title || t.name || '';
    const artist = t.up || '';
    if (M.title && M.title.textContent !== title) M.title.textContent = title;
    if (M.artist && M.artist.textContent !== artist) M.artist.textContent = artist;
  }

  function animateCur() {
    if (!M.cur) return;
    M.cur.classList.remove('mv-in');
    // 流光/立体的入场交给逐词状态机；整句再做 0.5s 淡入会吞掉第一拍
    if (M.cur.classList.contains('mv-flow-line')) return;
    void M.cur.offsetWidth;
    M.cur.classList.add('mv-in');
  }

  function showStatic(text) {
    if (M.cur) { M.cur.style.transform = ''; M.cur.style.justifyContent = ''; }
    applyTuneVars();
    const key = 's:' + text;
    if (M.mode === key) return;
    M.mode = key;
    M.idx = -2;
    M.chars = [];
    M.words = [];
    resetFlowCam();
    if (M.layer) M.layer.classList.remove('fume-world-ready');
    if (M.prev) M.prev.textContent = '';
    if (M.next) M.next.textContent = '';
    if (M.cur) {
      M.cur.innerHTML = '';
      M.cur.classList.remove('mv-long', 'mv-flow-line');
      const d = document.createElement('div');
      d.className = 'mv-title';
      d.textContent = text;
      M.cur.appendChild(d);
      animateCur();
    }
  }

  function showIntro(lines) {
    if (M.cur) { M.cur.style.transform = ''; M.cur.style.justifyContent = ''; }
    applyTuneVars();
    if (M.mode === 'intro') {
      if (M.next) {
        const nx = lines[0] ? lines[0].text : '';
        if (M.next.textContent !== nx) M.next.textContent = nx;
      }
      return;
    }
    M.mode = 'intro';
    M.idx = -1;
    M.chars = [];
    M.words = [];
    resetFlowCam();
    if (M.prev) M.prev.textContent = '';
    if (M.next) M.next.textContent = lines[0] ? lines[0].text : '';
    if (M.cur) {
      M.cur.innerHTML = '';
      M.cur.classList.remove('mv-long', 'mv-flow-line');
      const d = document.createElement('div');
      d.className = 'mv-title';
      d.textContent = '♪';
      M.cur.appendChild(d);
      animateCur();
    }
  }

  function naturalLineDur(text) {
    const units = splitFumeUnits(String(text || ''));
    let cjk = 0, words = 0;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.space) continue;
      if (CJK.test(u.text)) {
        for (const ch of Array.from(u.text)) if (!PUNC.test(ch)) cjk++;
      } else if (!Array.from(u.text).every(ch => PUNC.test(ch))) words++;
    }
    return Math.max(1.4, 0.7 + cjk * 0.33 + words * 0.48);
  }

  /* 行尾估算：字幕自带的 to/end 优先；没有就用下一行起点，
     长间奏时按字数收紧——避免整句歌词被摊进几十秒空白。
     这是 Folia 同步感的关键：词只在本句真正在唱的时间段里分配。 */
  function flowLineEnd(line, next, text) {
    const start = Number(line.t) || 0;
    let end = Number(line.end);
    if (!(end > start + 0.12)) end = 0;
    if (!end) {
      let gap = next ? Number(next.t) - start : 0;
      if (!(gap > 0)) gap = 5;
      const chars = Array.from(String(text || '')).length;
      if (gap > 5 && gap > chars * 0.5 + 2) gap = chars * 0.5 + 2;
      end = start + Math.max(0.6, gap);
    }
    const nx = next ? Number(next.t) : 0;
    if (nx > start && end > nx) end = nx; // 不压到下一句开头
    // 字幕的 to 有时包含整段间奏（如片头标题卡）：按字数估一个“真正唱完”的上限。
    // 真实逐词时间已经给了行内每个词的起止，不能再按字数砍掉后半句。
    const hasReal = Array.isArray(line.words) && line.words.length > 0;
    if (hasReal) {
      const lastWordEnd = Math.max(...line.words.map(w => Number(w.end) || 0));
      if (lastWordEnd > end) end = lastWordEnd;
    }
    const natural = naturalLineDur(text);
    if (!hasReal && end - start > Math.max(6, natural * 2.2)) {
      end = start + Math.max(2.4, natural * 1.5);
    }
    const total = M.api && M.api.getDuration ? M.api.getDuration() : 0;
    if (total > start && end > total) end = total;
    if (!(end > start + 0.12)) {
      const chars = Array.from(String(text || '')).length;
      end = start + Math.max(0.6, Math.min(5, chars * 0.28));
    }
    return end;
  }

  /* 一个语义片段占多少“演唱权重”：中文按字、英文按词长 */
  function segmentWeight(text) {
    let w = 0;
    let token = '';
    const flush = () => {
      if (!token) return;
      w += 1 + Array.from(token).length * 0.15;
      token = '';
    };
    for (const ch of Array.from(String(text || ''))) {
      if (CJK.test(ch)) {
        flush();
        if (!PUNC.test(ch)) w += 1;
      } else if (/[A-Za-z0-9'’\-]/.test(ch)) {
        token += ch;
      } else {
        flush();
      }
    }
    flush();
    return w;
  }

  /* AI 分词优先；没有时用 Intl 的词边界，但保留中文多字词，不再逐字乱蹦 */
  function flowSegments(text, aiSegs) {
    const src = String(text || '');
    if (Array.isArray(aiSegs) && aiSegs.length) {
      const parts = [];
      let acc = '';
      for (const s of aiSegs) {
        if (typeof s !== 'string' || !s.length) continue;
        parts.push(s);
        acc += s;
      }
      const nonSpace = src.replace(/\s+/g, '');
      const norm = s => String(s).replace(/\s+/g, '').normalize('NFKC');
      const allSingle = parts.length > 3 && parts.every(p => Array.from(p).length === 1);
      if (parts.length && !allSingle && (parts.length > 1 || nonSpace.length <= 4)
        && (acc === src || norm(acc) === norm(src))) {
        return parts.map(s => s.replace(/\s+$/, '')).filter(Boolean);
      }
    }
    const out = [];
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        const seg = new Intl.Segmenter(undefined, { granularity: 'word' });
        for (const part of seg.segment(src)) {
          const s = part.segment;
          if (!s) continue;
          if (/^\s+$/.test(s)) {
            if (out.length) out[out.length - 1] += s;
            continue;
          }
          out.push(s);
        }
      } catch (e) {}
    }
    if (!out.length) {
      const m = src.match(/[\u2e80-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]+|[^\s]+/g);
      if (m) out.push(...m);
    }
    return out.map(s => s.replace(/\s+$/, '')).filter(Boolean);
  }

  /* Fume 版分词：保留原行里的空格，保证排版不断词 */
  function segmentsWithSpaces(text, aiSegs) {
    const segs = flowSegments(text, aiSegs);
    const units = [];
    let pos = 0;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const idx = text.indexOf(seg, pos);
      if (idx > pos) {
        const gap = text.slice(pos, idx);
        if (gap) units.push({ text: gap, space: /^\s+$/.test(gap) });
      }
      units.push({ text: seg, space: false });
      pos = idx >= 0 ? idx + seg.length : pos + seg.length;
    }
    if (pos < text.length) {
      const rest = text.slice(pos);
      if (rest) units.push({ text: rest, space: /^\s+$/.test(rest) });
    }
    return units;
  }

  /* 整句不换行；超出容器时整体缩一点，避免待唱词被挤到第二行 */
  function fitFlowLine() {
    if (!M.cur) return;
    M.cur.style.setProperty('--line-fit', '1');
    const avail = M.cur.clientWidth;
    const need = M.cur.scrollWidth;
    if (avail > 0 && need > avail + 1) {
      const fit = Math.max(0.5, Math.min(1, (avail / need) * 0.97));
      M.cur.style.setProperty('--line-fit', fit.toFixed(3));
    }
  }

  /* BPM 软对齐：词头最多挪半格，优先落在节拍/半拍/四分之一拍上 */
  function quantizeBeatTime(t, lineStart, lineEnd, count) {
    const info = M.bpmInfo;
    if (!info || !(info.bpm > 0) || !(lineEnd > lineStart) || (info.confidence && info.confidence < 0.85)) return t;
    const beat = 60 / info.bpm;
    let div = 1;
    while (div < 4 && (lineEnd - lineStart) / (beat / div) < count * 1.15) div *= 2;
    const step = beat / div;
    if (!(step > 0.04)) return t;
    const phase = Number.isFinite(info.phase) ? info.phase : 0;
    const target = phase + Math.round((t - phase) / step) * step;
    if (Math.abs(target - t) > step * 0.46) return t;
    return clamp(target, lineStart + 0.02, lineEnd - 0.05);
  }

  /* 段落级 shot：同一段落共享机位，行内只做轻微漂移，副歌/抬升段再放宽 */
  function playParaTransition(kind) {
    const el = M.fxEl;
    if (!el) return;
    el.className = 'mv-fx';
    void el.offsetWidth;
    el.classList.add('fx-' + kind);
    clearTimeout(M.fxTimer);
    M.fxTimer = setTimeout(() => { if (M.fxEl) M.fxEl.className = 'mv-fx'; }, 760);
  }

  function applyShot(idx) {
    if (!M.cur) return;
    const style = M.style;
    if (style === 'chat' || style === 'fume') return;
    const pi = M.paraOf ? M.paraOf[idx] : 0;
    const kind = M.paraKind ? (M.paraKind[pi] || 'verse') : 'verse';
    if (!M.paraShots) M.paraShots = [];
    let base = M.paraShots[pi];
    if (!base) {
      const from = M.paragraphs && M.paragraphs[pi] ? M.paragraphs[pi].from : idx;
      const bh1 = fumeHash((from + 1) * 211 + 5);
      const bh2 = fumeHash((from + 1) * 223 + 7);
      const bh3 = fumeHash((from + 1) * 227 + 11);
      const bh4 = fumeHash((from + 1) * 229 + 13);
      const wild = kind === 'chorus' || kind === 'lift';
      const breath = kind === 'breath' || kind === 'outro';
      if (wild) {
        base = { sc: 1.04 + bh3 * 0.045, dx: (bh1 - 0.5) * 4.6, dy: (bh2 - 0.5) * 2.2, rot: (bh4 - 0.5) * 1.4 };
      } else if (breath) {
        base = { sc: 0.95 + bh3 * 0.03, dx: (bh1 - 0.5) * 1.2, dy: (bh2 - 0.5) * 0.8, rot: (bh4 - 0.5) * 0.4 };
      } else {
        base = { sc: 0.985 + bh3 * 0.025, dx: (bh1 - 0.5) * 2.0, dy: (bh2 - 0.5) * 1.1, rot: (bh4 - 0.5) * 0.7 };
      }
      M.paraShots[pi] = base;
    }
    const wild = kind === 'chorus' || kind === 'lift';
    const drift = wild ? 1 : 0.45;
    const h1 = fumeHash(idx * 191 + 7);
    const h2 = fumeHash(idx * 193 + 11);
    const h3 = fumeHash(idx * 197 + 13);
    const h4 = fumeHash(idx * 199 + 17);
    let dx = base.dx + (h1 - 0.5) * 1.3 * drift;
    let dy = base.dy + (h2 - 0.5) * 0.8 * drift;
    let sc = base.sc + (h3 - 0.5) * 0.018 * drift;
    let rot = base.rot + (h4 - 0.5) * 0.35 * drift;
    if (style === 'cinema') { dx *= 0.35; dy *= 0.35; sc = 0.96 + (sc - 0.96) * 0.5; rot *= 0.3; }
    if (style === 'poem') { dx *= 0.3; dy *= 0.35; sc = 0.97 + (sc - 0.97) * 0.5; rot *= 0.25; }
    if (style === 'cloud') { dx *= 1.1; dy *= 0.4; sc *= 0.98; rot *= 0.5; }
    if (style === 'fog') { dx *= 1.1; dy *= 0.8; }
    if (style === 'diorama') { dx *= 0.7; dy *= 0.7; sc = 0.99 + (sc - 0.99) * 0.7; }
    if (style === 'hanabi') { sc *= 1.04; dx *= 1.35; dy *= 1.25; rot *= 1.4; }
    if (style === 'vertical' || style === 'confess') { dx = 0; dy = 0; sc = 1; rot = 0; }
    M.cur.style.setProperty('--shot-s', sc.toFixed(3));
    M.cur.style.setProperty('--shot-dx', dx.toFixed(2) + 'vw');
    M.cur.style.setProperty('--shot-dy', dy.toFixed(2) + 'vh');
    M.cur.style.setProperty('--shot-r', rot.toFixed(2) + 'deg');
    if (style === 'vertical' || style === 'confess') {
      M.cur.style.transform = '';
    } else {
      const b = style === 'diorama' ? 'rotateY(-3deg) rotateX(1.2deg) ' : '';
      M.cur.style.transform = b + 'translate3d(var(--shot-dx, 0px), var(--shot-dy, 0px), 0) rotate(var(--shot-r, 0deg)) scale(calc(var(--line-fit, 1) * var(--shot-s, 1)))';
    }
    if (style === 'flow' || style === 'fog' || style === 'hanabi' || style === 'cloud') {
      M.cur.style.justifyContent = h4 < 0.33 ? 'flex-start' : (h4 > 0.67 ? 'flex-end' : 'center');
    } else {
      M.cur.style.justifyContent = '';
    }
    if (style === 'poem') M.cur.style.textAlign = h3 < 0.3 ? 'left' : (h3 > 0.7 ? 'right' : 'center');
    else M.cur.style.textAlign = '';
    if (style === 'cloud') M.cur.style.setProperty('--cloud-flip', h2 < 0.5 ? '1' : '-1');
    if (style === 'vertical') M.cur.style.setProperty('--vshot-fs', (0.95 + h3 * 0.1).toFixed(3));
    if (M.paraStart && M.paraStart.has(idx) && idx > 0 && M.lastParaEntry !== idx) {
      M.lastParaEntry = idx;
      const prev = M.paragraphs && M.paragraphs[pi - 1];
      const gap = prev && M.paragraphs ? (M.paragraphs[pi].start - prev.end) : 0;
      let tr = 'drift';
      if (style === 'cinema') tr = gap > 2.2 ? 'blackout' : (kind === 'chorus' ? 'flash' : 'fade');
      else if (style === 'hanabi') tr = kind === 'chorus' ? 'bloom' : (gap > 2.2 ? 'flash' : 'drift');
      else if (style === 'diorama') tr = gap > 2.2 ? 'focus' : 'drift';
      else if (style === 'cloud') tr = h4 > 0.55 ? 'wipe' : 'drift';
      else if (style === 'poem') tr = 'fade';
      else if (style === 'fog') tr = gap > 2.2 ? 'focus' : 'fade';
      else if (style === 'vertical') tr = h4 > 0.5 ? 'wipe' : 'fade';
      else if (style === 'confess') tr = gap > 2.2 ? 'focus' : 'fade';
      else if (kind === 'chorus') tr = 'flash';
      else if (gap > 2.2) tr = 'focus';
      else if (kind === 'breath' || kind === 'outro') tr = 'fade';
      else if (h4 > 0.55) tr = 'wipe';
      playParaTransition(tr);
      M.cur.classList.add('mv-para-in');
      setTimeout(() => { if (M.cur) M.cur.classList.remove('mv-para-in'); }, 720);
    }
  }

  /* 流光藤蔓：布局节奏参考 LyricalStudio 的 GraphStream（MIT），
     改编为 Canvas2D + 现有逐词时间轴，不引入其运行时。 */
  function vinePoints() {
    if (!M.layer || !M.words || !M.words.length) return [];
    const lr = M.layer.getBoundingClientRect();
    const out = [];
    for (const w of M.words) {
      if (!w.el || !w.el.isConnected) continue;
      const r = w.el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      out.push({ x: r.left + r.width / 2 - lr.left, y: r.top + r.height / 2 - lr.top, r: Math.max(3, Math.min(11, Math.min(r.width, r.height) * 0.22)) });
    }
    return out;
  }

  function captureVine() {
    const pts = vinePoints();
    if (pts.length < 2) return;
    M.vineSnaps.push(pts);
    const keep = Math.max(0, Math.min(3, Number(M.tune.flowKeep) || 0));
    while (M.vineSnaps.length > keep) M.vineSnaps.shift();
  }

  function clearVine() {
    if (!M.vctx) return;
    M.vctx.setTransform(1, 0, 0, 1, 0, 0);
    M.vctx.clearRect(0, 0, M.vine.width, M.vine.height);
  }

  function vinePath(ctx, pts) {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  function drawVine(now) {
    if (M.lowPower) { clearVine(); return; }
    const ctx = M.vctx;
    if (!ctx || !M.vine) return;
    clearVine();
    const dpr = M.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!M.words || M.words.length < 2) return;

    let t = 0;
    try { t = Number(M.api.getTime()) || 0; } catch (e) {}
    let active = -1;
    for (let i = 0; i < M.words.length; i++) if (t >= M.words[i].start - 0.02) active = i;
    if (active < 0) active = 0;
    const pts = vinePoints();
    if (pts.length < 2) return;
    const end = Math.min(pts.length, active + 1);

    // 已经唱过的段落：淡淡的枝干，留在画面里作为时间痕迹
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let s = 0; s < M.vineSnaps.length; s++) {
      const snap = M.vineSnaps[s];
      if (snap.length < 2) continue;
      ctx.globalAlpha = 0.1 + s * 0.04;
      ctx.strokeStyle = rgba(M.rgb, 0.7);
      ctx.lineWidth = 1.1;
      ctx.shadowBlur = 10;
      ctx.shadowColor = rgba(M.rgb, 0.35);
      vinePath(ctx, snap);
      ctx.stroke();
    }

    // 当前句：随演唱进度生长的主藤蔓
    const cur = pts.slice(0, end);
    const density = Math.max(0, Math.min(2, Number(M.tune.flowVine) || 0));
    if (cur.length >= 2) {
      const pulse = 0.7 + (M.bass || 0) * 0.55;
      ctx.globalAlpha = 0.45 + density * 0.35;
      ctx.strokeStyle = rgba(M.rgb, 0.55 + density * 0.2);
      ctx.lineWidth = 1.6;
      ctx.shadowBlur = 14 + pulse * 8;
      ctx.shadowColor = rgba(M.rgb, 0.65);
      vinePath(ctx, cur);
      ctx.stroke();
      ctx.globalAlpha = 0.36;
      ctx.lineWidth = 5.5;
      ctx.shadowBlur = 26;
      ctx.stroke();

      // 枝节和垂落的小枝，让线条不是一根死线
      for (let i = 0; i < cur.length; i++) {
        const p = cur[i];
        ctx.globalAlpha = i === cur.length - 1 ? 0.92 : 0.42;
        ctx.fillStyle = rgba(M.rgb, 0.9);
        ctx.shadowBlur = i === cur.length - 1 ? 20 : 9;
        ctx.beginPath();
        ctx.arc(p.x, p.y, i === cur.length - 1 ? (2.6 + pulse * 1.5) : 1.4, 0, Math.PI * 2);
        ctx.fill();
        if (density > 0 && i > 0 && i % Math.max(2, Math.round(4 / Math.max(.5, density))) === 0) {
          const a = Math.sin(i * 12.9898 + 78.233) * 0.9;
          const len = 10 + (i % 4) * 5;
          ctx.globalAlpha = 0.2;
          ctx.strokeStyle = rgba(M.rgb, 0.6);
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.quadraticCurveTo(p.x + Math.cos(a) * len * 0.6, p.y + Math.sin(a) * len, p.x + Math.cos(a) * len, p.y + Math.sin(a) * len + len * 0.45);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  function buildFlowLine(lines, idx, noGhost) {
    const line = lines[idx];
    const next = lines[idx + 1];
    if (M.style === 'flow' && !noGhost && M.idx !== idx && M.idx >= 0) captureVine();
    M.idx = idx;
    M.mode = 'flow';
    M.chars = [];
    M.words = [];
    const start = Number(line.t) || 0;
    const end = flowLineEnd(line, next, line.text);
    if (M.prev) M.prev.textContent = idx > 0 ? lines[idx - 1].text : '';
    if (M.next) M.next.textContent = next ? next.text : '';

    const aiSegs = M.api && M.api.getSegments ? M.api.getSegments() : null;
    const segTexts = flowSegments(String(line.text || ''), aiSegs && aiSegs[idx]);
    let units = segTexts.map(text => ({ text: text, weight: segmentWeight(text) }));
    /* 多源歌词已经有真实逐词时间：直接用，不再按字数插值（纵向分栏保持原逻辑） */
    const realWords = M.style !== 'vertical' && Array.isArray(line.words)
      ? line.words.filter(w => w && w.text && isFinite(w.t) && isFinite(w.end) && w.end > w.t)
      : null;
    if (realWords && realWords.length) {
      units = realWords.map(w => ({
        text: String(w.text),
        weight: Math.max(0.05, Number(w.end) - Number(w.t)),
        start: Number(w.t),
        end: Number(w.end),
        kana: w.kana || ''
      }));
    }
    if (M.style === 'vertical') {
      const chunks = [];
      for (const u of units) {
        const chars = Array.from(u.text);
        for (let i = 0; i < chars.length; i += 6) {
          const text = chars.slice(i, i + 6).join('');
          if (text) chunks.push({ text, weight: segmentWeight(text) });
        }
      }
      units = chunks.length ? chunks : units;
    }
    const tiltBreaks = new Set();
    if (M.style === 'confess') {
      let hasPunc = false;
      for (let i = 0; i < units.length - 1; i++) {
        if (/[，。！？、；：,.!?;:…—–]$/.test(units[i].text)) { tiltBreaks.add(i); hasPunc = true; }
      }
      if (!hasPunc && units.length >= 6) {
        const parts = units.length >= 11 ? 3 : 2;
        const target = Math.ceil(units.length / parts);
        for (let i = 0; i < units.length - 1; i++) {
          if ((i + 1) % target === 0) tiltBreaks.add(i);
        }
      }
    }
    const tiltY = [0, -0.09, 0.07, -0.05];
    let tiltPhrase = 0;
    const totalW = units.reduce((a, u) => a + u.weight, 0) || 1;
    const dur = Math.max(0.3, (end - start - 0.02) * 0.9);
    const rawDurs = units.map(u => Math.max(0.05, dur * u.weight / totalW));
    let rawSum = rawDurs.reduce((a, d) => a + d, 0);
    if (!(rawSum > 0)) rawSum = 1;
    const scale = dur / rawSum;
    let acc = start + 0.02;
    let rawAcc = acc;
    let wi = 0;
    let ti = 0;
    const frag = document.createDocumentFragment();
    const vWrap = M.style === 'vertical' ? document.createElement('div') : null;
    if (vWrap) { vWrap.className = 'v-cols'; frag.appendChild(vWrap); }
    const vTarget = Math.max(3, Math.min(10, Number(M.tune.vCols) || 6));
    let vCol = null, vChars = 0, vColCount = 0;
    const words = [];
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const fixed = u.start != null && u.end != null;
      let wStart, wEnd;
      if (fixed) {
        wStart = clamp(u.start, start, Math.max(start, end - 0.05));
        wEnd = clamp(u.end, wStart + 0.05, end);
        acc = wEnd;
        rawAcc = wEnd;
      } else {
        const wDur = rawDurs[ti++] * scale;
        const qTarget = i > 0 ? quantizeBeatTime(rawAcc, start, end, units.length) : rawAcc;
        wStart = Math.max(acc, qTarget);
        wEnd = Math.min(end, Math.max(wStart + 0.05, wStart + wDur));
        acc = wEnd;
        rawAcc += wDur;
      }

      const el = document.createElement('span');
      el.className = 'mv-word waiting' + (CJK.test(u.text) ? '' : ' mv-word--latin');
      const chars = Array.from(u.text);
      let host = el;
      let ruby = null;
      if (u.kana && /[\u3400-\u9fff]/.test(u.text)) {
        ruby = document.createElement('ruby');
        ruby.className = 'mv-ruby';
        el.appendChild(ruby);
        host = ruby;
      }
      const charEls = [];
      const charStarts = [];
      const charSpan = (wEnd - wStart) / Math.max(1, chars.length);
      for (let ci = 0; ci < chars.length; ci++) {
        const cs = document.createElement('span');
        cs.className = 'mv-char';
        cs.textContent = chars[ci];
        cs.style.setProperty('--dir', (ci - (chars.length - 1) / 2).toFixed(2));
        host.appendChild(cs);
        charEls.push(cs);
        charStarts.push(wStart + charSpan * ci);
      }
      if (ruby) {
        const rt = document.createElement('rt');
        rt.textContent = u.kana;
        ruby.appendChild(rt);
      }
      const h1 = fumeHash(idx * 97 + wi * 13 + 1);
      const h2 = fumeHash(idx * 97 + wi * 13 + 2);
      const h3 = fumeHash(idx * 97 + wi * 13 + 3);
      const h4 = fumeHash(idx * 97 + wi * 13 + 4);
      el.style.setProperty('--wx', ((h1 - 0.5) * 1.6).toFixed(3) + 'em');
      el.style.setProperty('--wy', ((h2 - 0.5) * 0.8).toFixed(3) + 'em');
      el.style.setProperty('--wz', (-60 - h3 * 90).toFixed(1) + 'px');
      el.style.setProperty('--wr', ((h4 - 0.5) * 24).toFixed(2) + 'deg');
      el.style.setProperty('--cloud-y', (((wi % 5) - 2) * 0.18).toFixed(3) + 'em');
      if (M.style === 'confess') el.style.setProperty('--tilt-y', tiltY[tiltPhrase % tiltY.length].toFixed(2) + 'em');
      el.style.setProperty('--wtr', Math.min(0.34, Math.max(0.1, (wEnd - wStart) * 0.55)).toFixed(3) + 's');
      for (let c = 0; c < M.aiWordColors.length; c++) {
        const wc = M.aiWordColors[c];
        if (wc && wc.word && (u.text.includes(wc.word) || wc.word.includes(u.text))) {
          el.style.setProperty('--wc', wc.color);
          break;
        }
      }
      if (vWrap) {
        if (!vCol || vChars >= vTarget) {
          vCol = document.createElement('span');
          vCol.className = 'v-col';
          vCol.style.setProperty('--vci', String(vColCount));
          vWrap.appendChild(vCol);
          vChars = 0;
          vColCount++;
        }
        vCol.appendChild(el);
        vChars += chars.length;
        el.style.setProperty('--vcol', String(vColCount - 1));
      } else {
        frag.appendChild(el);
      }
      words.push({ el: el, start: wStart, end: wEnd, charEls: charEls, charStarts: charStarts, lit: 0, state: 'waiting' });
      if (M.style === 'confess' && tiltBreaks.has(i)) {
        const br = document.createElement('span');
        br.className = 'tilt-break';
        frag.appendChild(br);
        tiltPhrase++;
      }
      wi++;
    }
    if (vWrap) {
      vWrap.style.setProperty('--vcols', String(vColCount));
      vWrap.style.setProperty('--vscale', vColCount > 5 ? '0.72' : (vColCount > 4 ? '0.8' : (vColCount > 3 ? '0.9' : '1')));
    }
    if (!words.length) {
      if (M.cur) {
        M.cur.innerHTML = '';
        M.cur.className = 'mv-cur mv-title';
        M.cur.textContent = line.text || '';
      }
      return;
    }
    if (M.cur) {
      if (!noGhost && M.cur.classList.contains('mv-flow-line') && (M.cur.textContent || '').trim()) {
        try {
          const wrap = M.cur.parentElement;
          const r = M.cur.getBoundingClientRect();
          const pr = wrap.getBoundingClientRect();
          const ghost = M.cur.cloneNode(true);
          ghost.classList.remove('mv-in');
          ghost.classList.add('mv-leaving');
          ghost.style.position = 'absolute';
          ghost.style.left = (r.left - pr.left) + 'px';
          ghost.style.top = (r.top - pr.top) + 'px';
          ghost.style.width = r.width + 'px';
          ghost.style.height = r.height + 'px';
          ghost.style.margin = '0';
          wrap.appendChild(ghost);
          setTimeout(() => { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }, 520);
        } catch (e) {}
      }
      M.cur.className = 'mv-cur mv-flow-line' + (Array.from(String(line.text || '')).length > 26 ? ' mv-long' : '');
      M.cur.setAttribute('data-ghost', String(line.text || ''));
      M.cur.innerHTML = '';
      M.cur.appendChild(frag);
      if (M.style !== 'vertical') fitFlowLine();
      applyShot(idx);
      animateCur();
    }
    M.words = words;
    applyFlowCam(idx);
    const now = M.api && M.api.getTime ? Number(M.api.getTime()) || 0 : start;
    updateFlowWords(now);
  }

  function applyFlowCam(idx) {
    if (!M.layer) return;
    const h1 = fumeHash(idx * 53 + 1);
    const h2 = fumeHash(idx * 53 + 2);
    const h3 = fumeHash(idx * 53 + 3);
    const h4 = fumeHash(idx * 53 + 4);
    const amp = M.style === 'cinema' || M.style === 'confess' ? 0.35 : (M.style === 'hanabi' ? 1.45 : (M.style === 'vertical' ? 0.45 : (M.style === 'poem' ? 0.2 : (M.style === 'fog' ? 0.6 : 1))));
    M.layer.style.setProperty('--flow-x', ((h1 - 0.5) * 3.0 * amp).toFixed(2) + 'vw');
    M.layer.style.setProperty('--flow-y', ((h2 - 0.5) * 2.2 * amp).toFixed(2) + 'vh');
    M.layer.style.setProperty('--flow-s', (1 + (h3 - 0.5) * 0.05 * amp).toFixed(3));
    M.layer.style.setProperty('--flow-r', ((h4 - 0.5) * 1.4 * amp).toFixed(2) + 'deg');
  }

  function resetFlowCam() {
    if (!M.layer) return;
    M.layer.style.setProperty('--flow-x', '0px');
    M.layer.style.setProperty('--flow-y', '0px');
    M.layer.style.setProperty('--flow-s', '1');
    M.layer.style.setProperty('--flow-r', '0deg');
  }

  function updateFlowWords(t) {
    if (!M.words.length) return;
    const typing = M.words[M.words.length - 1].state !== 'passed';
    if (M.typing !== typing && M.cur) {
      M.typing = typing;
      M.cur.classList.toggle('mv-typing', typing);
    }
    for (let i = 0; i < M.words.length; i++) {
      const w = M.words[i];
      const state = t >= w.end - 0.001 ? 'passed' : (t >= w.start - 0.02 ? 'active' : 'waiting');
      if (w.state !== state) {
        w.state = state;
        w.el.classList.remove('waiting', 'active', 'passed');
        w.el.classList.add(state);
      }
      // 逐字点亮：每个字有自己的演唱起点，和 Folia 的 grapheme 进度一致
      let lit = 0;
      if (state === 'passed') lit = w.charEls.length;
      else if (state === 'active') {
        while (lit < w.charStarts.length && t >= w.charStarts[lit] - 0.01) lit++;
      }
      if (w.lit !== lit) {
        for (let ci = 0; ci < w.charEls.length; ci++) w.charEls[ci].classList.toggle('on', ci < lit);
        w.lit = lit;
      }
    }
  }

  function buildLine(lines, idx) {
    const line = lines[idx];
    const nextLine = lines[idx + 1];
    M.mode = 'line';
    M.idx = idx;
    M.words = [];
    if (M.cur) M.cur.classList.remove('mv-flow-line');

    if (M.prev) M.prev.textContent = idx > 0 ? lines[idx - 1].text : '';
    if (M.next) M.next.textContent = nextLine ? nextLine.text : '';

    const text = String(line.text || '');
    const start = Number(line.t) || 0;
    const end = flowLineEnd(line, nextLine, text);
    const span = Math.max(0.5, end - start);
    const arr = Array.from(text);
    const weights = [];
    let total = 0;
    for (let i = 0; i < arr.length; i++) {
      const ch = arr[i];
      let w;
      if (/\s/.test(ch)) w = 0.3;
      else if (PUNC.test(ch)) w = 0.2;
      else if (CJK.test(ch)) w = 1;
      else w = 0.55;
      weights.push(w);
      total += w;
    }
    if (!total) total = 1;

    const active = span * 0.94;
    let acc = start + 0.03;
    const frag = document.createDocumentFragment();
    const chars = [];
    for (let i = 0; i < arr.length; i++) {
      const ch = arr[i];
      const step = active * weights[i] / total;
      if (/\s/.test(ch)) {
        frag.appendChild(document.createTextNode(' '));
        acc += step;
        continue;
      }
      const el = document.createElement('span');
      el.className = 'mv-ch';
      el.textContent = ch;
      frag.appendChild(el);
      chars.push({ el: el, start: acc, on: false });
      acc += step;
    }

    if (M.cur) {
      M.cur.innerHTML = '';
      M.cur.classList.toggle('mv-long', arr.length > 26);
      M.cur.appendChild(frag);
      animateCur();
    }
    M.chars = chars;
  }

  function fumeHash(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /* 浮名：把整篇歌词排进一张很大的“版面”，相机跟随当前句 */
  function buildFumeWorld(lines) {
    const world = document.getElementById('mv-world');
    if (!world || !M.w || !M.h) return;
    const W = M.w;
    const H = M.h;
    const F = M.fume;
    F.world = world;
    F.linesRef = lines;
    F.lastW = W;
    F.lastH = H;
    F.idx = -2;
    F.decoratedIdx = -1;
    F.units = [];
    F.unitEls = [];
    F.cam = null;
    F.layout = [];
    F.byLine = new Array(lines.length).fill(null);
    world.innerHTML = '';

    const decos = [
      ['ring', 0.07, 0.1, 0.22, 0],
      ['flower', 0.78, 0.16, 0.12, 12],
      ['frame', 0.1, 0.52, 0.28, -4],
      ['ring', 0.62, 0.7, 0.3, 0],
      ['flower', 0.2, 0.86, 0.09, -18],
      ['frame', 0.52, 0.32, 0.2, 6],
      ['ring', 0.86, 0.48, 0.16, 0]
    ];
    for (let i = 0; i < decos.length; i++) {
      const d = decos[i];
      const el = document.createElement('div');
      el.className = 'mv-deco mv-deco-' + d[0];
      const size = Math.max(W, H) * d[3];
      el.style.left = (W * d[1]) + 'px';
      el.style.top = (H * d[2]) + 'px';
      el.style.width = size + 'px';
      el.style.height = (d[0] === 'frame' ? size * 0.62 : size) + 'px';
      el.style.transform = 'rotate(' + d[4] + 'deg)';
      if (d[0] === 'flower') {
        el.innerHTML = '<svg viewBox="0 0 100 100"><g fill="none" stroke="currentColor" stroke-width="2"><circle cx="50" cy="24" r="14"/><circle cx="75" cy="42" r="14"/><circle cx="66" cy="71" r="14"/><circle cx="34" cy="71" r="14"/><circle cx="25" cy="42" r="14"/></g></svg>';
      }
      world.appendChild(el);
    }

    let y = H * 0.18;
    let li = 0;
    for (let i = 0; i < lines.length; i++) {
      const text = String(lines[i].text || '');
      if (!text) continue;
      const h1 = fumeHash(i * 7 + 1);
      const h2 = fumeHash(i * 7 + 2);
      const h3 = fumeHash(i * 7 + 3);
      const h4 = fumeHash(i * 7 + 4);
      const glyphs = Array.from(text);
      const n = glyphs.length;
      const cjk = glyphs.filter(ch => CJK.test(ch)).length;
      const kind = i % 6;
      const vertical = (kind === 1 || kind === 4) && n <= 12 && cjk >= n * 0.5;
      let fs;
      let x;
      let rot;
      if (vertical) {
        fs = Math.round(H * (0.12 + h1 * 0.045));
        fs = Math.max(34, Math.min(fs, Math.round(H * 0.86 / (n * 1.08))));
        x = W * (0.02 + h2 * 0.62);
        rot = (h3 - 0.5) * 7;
      } else if (kind === 2 || kind === 5) {
        fs = Math.round(W * (0.045 + h1 * 0.022));
        fs = Math.max(30, Math.min(fs, Math.round(W * 0.92 / (n * 0.62))));
        x = W * (0.02 + h2 * 0.36);
        rot = (h3 - 0.5) * 10;
      } else {
        fs = Math.round(W * (0.085 + h1 * 0.035));
        fs = Math.max(38, Math.min(fs, Math.round(W * 1.02 / (n * 0.62))));
        x = W * (-0.04 + h2 * 0.22);
        rot = (h3 - 0.5) * 8;
      }
      const el = document.createElement('div');
      el.className = 'mv-fume-line';
      el.textContent = text;
      el.style.left = Math.round(x) + 'px';
      el.style.top = Math.round(y) + 'px';
      el.style.fontSize = fs + 'px';
      el.style.transform = 'rotate(' + rot.toFixed(2) + 'deg)';
      if (vertical) {
        el.classList.add('vertical');
        el.style.writingMode = 'vertical-rl';
        el.style.textOrientation = 'upright';
      }
      world.appendChild(el);
      const item = { el: el, x: x, y: y, fs: fs, rot: rot, vertical: vertical, li: li++, text: text };
      F.layout.push(item);
      F.byLine[i] = item;
      const lineH = el.offsetHeight || fs * 1.2;
      y += lineH + H * (0.16 + h4 * 0.08);
    }

    const sel = document.createElement('div');
    sel.className = 'mv-fume-sel';
    sel.innerHTML = '<i class="c0"></i><i class="c1"></i><i class="c2"></i><i class="c3"></i>';
    world.appendChild(sel);
    F.sel = sel;
    F.els = F.layout.map(x => x.el);
    if (M.layer) M.layer.classList.add('fume-world-ready');
  }

  function splitFumeUnits(text) {
    const units = [];
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        const seg = new Intl.Segmenter(undefined, { granularity: 'word' });
        for (const part of seg.segment(text)) {
          const s = part.segment;
          if (!s) continue;
          if (/^\s+$/.test(s)) {
            units.push({ text: ' ', space: true });
          } else if (CJK.test(s)) {
            for (const ch of Array.from(s)) units.push({ text: ch, space: false });
          } else {
            units.push({ text: s, space: false });
          }
        }
        return units;
      } catch (e) {}
    }
    return Array.from(text).map(ch => ({ text: ch, space: /\s/.test(ch) }));
  }

  function positionFumeSel(item) {
    const F = M.fume;
    if (!F.sel || !item) return;
    const pad = 18;
    F.sel.style.left = (item.x - pad) + 'px';
    F.sel.style.top = (item.y - pad) + 'px';
    F.sel.style.width = (item.el.offsetWidth + pad * 2) + 'px';
    F.sel.style.height = (item.el.offsetHeight + pad * 2) + 'px';
    F.sel.style.transform = 'rotate(' + item.rot.toFixed(2) + 'deg)';
    F.sel.classList.remove('show');
    void F.sel.offsetWidth;
    F.sel.classList.add('show');
  }

  function decorateFumeLine(lineIdx) {
    const F = M.fume;
    const item = F.byLine[lineIdx];
    if (!item) return;
    if (F.decoratedIdx === lineIdx && item.el.classList.contains('decorated')) return;
    undecorateFumeLine();
    F.decoratedIdx = lineIdx;
    F._curUnit = -1;
    const aiSegs = M.api && M.api.getSegments ? M.api.getSegments() : null;
    F.units = segmentsWithSpaces(item.text, aiSegs && aiSegs[lineIdx]);
    F.unitEls = [];
    item.el.textContent = '';
    const frag = document.createDocumentFragment();
    let u = 0;
    for (let i = 0; i < F.units.length; i++) {
      const unit = F.units[i];
      if (unit.space) {
        frag.appendChild(document.createTextNode(' '));
        continue;
      }
      const el = document.createElement('span');
      el.className = 'fw';
      el.textContent = unit.text;
      const h1 = fumeHash(lineIdx * 41 + u * 7 + 1);
      const h2 = fumeHash(lineIdx * 41 + u * 7 + 2);
      const h3 = fumeHash(lineIdx * 41 + u * 7 + 3);
      const amp = M.aiAnim === 'intense' ? 1.5 : M.aiAnim === 'subtle' ? 0.55 : 1;
      const ty = (h1 - 0.5) * 0.14 * amp;
      const rot = (h2 - 0.5) * 4.5 * amp;
      const sc = 1 + (h3 - 0.5) * 0.1 * amp;
      el.style.setProperty('--tf', 'translateY(' + ty.toFixed(3) + 'em) rotate(' + rot.toFixed(2) + 'deg) scale(' + sc.toFixed(3) + ')');
      for (let wi = 0; wi < M.aiWordColors.length; wi++) {
        const wc = M.aiWordColors[wi];
        if (wc && wc.word && (unit.text.includes(wc.word) || wc.word.includes(unit.text))) {
          el.style.color = wc.color;
          break;
        }
      }
      frag.appendChild(el);
      F.unitEls.push(el);
      u++;
    }
    if (!F.unitEls.length) {
      item.el.textContent = item.text;
      F.decoratedIdx = -1;
      F.units = [];
      return;
    }
    item.el.appendChild(frag);
    item.el.classList.add('decorated');
    positionFumeSel(item);
  }

  function undecorateFumeLine() {
    const F = M.fume;
    if (F.decoratedIdx < 0) return;
    const old = F.byLine[F.decoratedIdx];
    if (old) {
      old.el.textContent = old.text;
      old.el.classList.remove('decorated');
    }
    F.decoratedIdx = -1;
    F.units = [];
    F.unitEls = [];
  }

  function updateFumeUnits(t, lineIdx) {
    const F = M.fume;
    if (!F.unitEls.length || !F.linesRef) return;
    const line = F.linesRef[lineIdx];
    if (!line) return;
    const start = Number(line.t) || 0;
    const next = F.linesRef[lineIdx + 1];
    let end = next ? Number(next.t) : start + 6;
    if (!(end > start)) end = start + 6;
    let p = (t - start) / Math.max(0.6, end - start);
    p = clamp(p, 0, 0.999);
    const cur = Math.min(F.unitEls.length - 1, Math.max(0, Math.floor(p * F.unitEls.length)));
    if (F._curUnit === cur && F._curLine === lineIdx) return;
    F._curUnit = cur;
    F._curLine = lineIdx;
    for (let i = 0; i < F.unitEls.length; i++) {
      F.unitEls[i].classList.toggle('past', i < cur);
      F.unitEls[i].classList.toggle('cur', i === cur);
    }
  }

  function updateFumeActive(idx, t) {
    const F = M.fume;
    if (!F.layout.length) return;
    let target = idx >= 0 && F.byLine[idx] ? idx : -1;
    if (target < 0) {
      target = F.byLine.findIndex(x => !!x);
      if (target < 0) target = 0;
    }
    if (F.idx !== target) {
      F.idx = target;
      const item = F.byLine[target];
      if (!item) return;
      for (let i = 0; i < F.layout.length; i++) {
        const it = F.layout[i];
        const d = Math.abs(it.li - item.li);
        it.el.classList.toggle('active', it === item);
        it.el.classList.toggle('near', d === 1);
      }
      decorateFumeLine(target);
      positionFumeSel(item);
    }
    updateFumeUnits(t, target);
  }

  function updateFumeCamera() {
    const F = M.fume;
    if (!F.world || !F.layout.length) return;
    const item = F.byLine[F.idx] || F.layout[0];
    if (!item) return;
    const w = item.el.offsetWidth || item.fs;
    const h = item.el.offsetHeight || item.fs;
    const fit = Math.min((M.w * 0.88) / (w + 1), (M.h * 0.78) / (h + 1));
    const cx = item.x + w / 2;
    const cy = item.y + h / 2;
    const targetS = Math.max(0.55, Math.min(1.06, fit)) * (1 + Math.min(0.04, M.bass * 0.03));
    const tx = M.w / 2 - cx * targetS;
    const ty = M.h * 0.5 - cy * targetS;
    if (!F.cam) {
      F.cam = { x: tx, y: ty, s: targetS };
    } else {
      F.cam.x += (tx - F.cam.x) * 0.09;
      F.cam.y += (ty - F.cam.y) * 0.09;
      F.cam.s += (targetS - F.cam.s) * 0.09;
    }
    F.world.style.transform = 'translate3d(' + F.cam.x.toFixed(2) + 'px,' + F.cam.y.toFixed(2) + 'px,0) scale(' + F.cam.s.toFixed(4) + ')';
  }

  function tickFume(lines, t) {
    const F = M.fume;
    if (!F.world || F.linesRef !== lines || F.lastW !== M.w || F.lastH !== M.h) {
      buildFumeWorld(lines);
    }
    if (!F.layout.length) {
      if (M.layer) M.layer.classList.remove('fume-world-ready');
      showStatic('暂无歌词 · 跟着节奏律动');
      return;
    }
    if (M.layer && !M.layer.classList.contains('fume-world-ready')) M.layer.classList.add('fume-world-ready');
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (Number(lines[i].t) <= t + 0.12) idx = i;
      else break;
    }
    M.isChorus = !!(M.chorusSet && M.chorusSet.has(idx));
    if (M.isChorus !== M.lastChorus) {
      M.lastChorus = M.isChorus;
      try { window.dispatchEvent(new CustomEvent('bp-mv-chorus', { detail: { on: M.isChorus } })); } catch (e) {}
    }
    const prevLine = idx > 0 ? lines[idx - 1] : null;
    const nextLine = idx >= 0 ? lines[idx + 1] : (lines[0] || null);
    if (M.prev) {
      const s = prevLine ? prevLine.text : '';
      if (M.prev.textContent !== s) M.prev.textContent = s;
    }
    if (M.next) {
      const s = nextLine ? nextLine.text : '';
      if (M.next.textContent !== s) M.next.textContent = s;
    }
    updateFumeActive(idx, t);
    updateFumeCamera();
  }

  /* ---------- 对话 MV：歌词变成一条条聊天气泡，逐字打字 ---------- */
  function escAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function chatStamp(sec) {
    sec = Math.max(0, Number(sec) || 0);
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function chatAvatarHtml() {
    const cover = (M.api && M.api.getCoverUrl && M.api.getCoverUrl()) || '';
    if (cover) return '<div class="chat-avatar"><img src="' + escAttr(cover) + '" alt=""></div>';
    return '<div class="chat-avatar chat-avatar--empty">♪</div>';
  }

  function chatRowHtml(side, text, t) {
    const av = chatAvatarHtml();
    const bubble = '<div class="chat-bubble"><div class="chat-text"></div></div>';
    const time = '<span class="chat-time">' + chatStamp(t) + '</span>';
    return side === 'left' ? av + bubble + time : time + bubble + av;
  }

  /* Folia Cappella 的说话人节奏：5 行一轮 + 每 5 行强制右侧 + 短句延续上一侧 + 少量翻边 */
  function computeChatSides(lines, upto) {
    const C = M.chat;
    if (C.sides && C.sides.length > upto) return C.sides;
    const seq = ['left', 'right', 'left', 'right', 'right'];
    let l = 0, last = null;
    const out = [];
    for (let i = 0; i <= upto; i++) {
      const line = lines[i] || {};
      const t = Number(line.t) || 0;
      const short = Array.from(String(line.text || '').replace(/\s/g, '')).length <= 12;
      const forced = (i + 1) % 5 === 0;
      let side;
      if (forced) {
        side = 'right';
        l = 0;
        last = null;
      } else if (short && last && fumeHash(i * 97 + Math.round(t * 7)) < 0.68) {
        side = last;
      } else {
        side = seq[l % seq.length];
        if (fumeHash(i * 131 + Math.round(t * 11) + 7) < 0.18) {
          side = side === 'left' ? 'right' : 'left';
        }
        l++;
        last = side;
      }
      out.push(side);
    }
    C.sides = out;
    return out;
  }

  /* 每个字的揭示时间：先按 AI 词组分词，再在词内均匀展开 */
  function chatCharStarts(line, next, idx) {
    const text = String(line.text || '');
    const start = Number(line.t) || 0;
    const end = flowLineEnd(line, next, text);
    const aiSegs = M.api && M.api.getSegments ? M.api.getSegments() : null;
    const units = segmentsWithSpaces(text, aiSegs && aiSegs[idx]);
    const timed = units.filter(u => !u.space);
    const totalW = timed.reduce((a, u) => a + segmentWeight(u.text), 0) || 1;
    const dur = Math.max(0.3, (end - start - 0.02) * 0.9);
    const raw = timed.map(u => Math.max(0.03, dur * segmentWeight(u.text) / totalW));
    let rawSum = raw.reduce((a, d) => a + d, 0);
    if (!(rawSum > 0)) rawSum = 1;
    const scale = dur / rawSum;
    const starts = [];
    let acc = start + 0.02;
    let rawAcc = acc;
    let ti = 0;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.space) {
        for (let j = 0; j < u.text.length; j++) starts.push(acc);
        continue;
      }
      const wDur = raw[ti++] * scale;
      const qTarget = i > 0 ? quantizeBeatTime(rawAcc, start, end, timed.length) : rawAcc;
      const ws = Math.max(acc, qTarget);
      const chars = Array.from(u.text);
      for (let ci = 0; ci < chars.length; ci++) {
        starts.push(ws + wDur * ci / Math.max(1, chars.length));
      }
      acc = ws + wDur;
      rawAcc += wDur;
    }
    const need = Array.from(text).length;
    if (starts.length !== need) {
      const span = Math.max(0.4, end - start);
      return Array.from({ length: need }, (_, i) => start + span * 0.9 * i / Math.max(1, need));
    }
    return starts;
  }

  function addChatRow(lines, i, fresh) {
    const C = M.chat;
    if (!C.box || C.map.has(i)) return;
    const line = lines[i];
    if (!line) return;
    const side = (computeChatSides(lines, i)[i]) || (i % 2 ? 'right' : 'left');
    const end = flowLineEnd(line, lines[i + 1], line.text);
    const el = document.createElement('div');
    el.className = 'chat-row ' + side + (fresh ? ' fresh' : '');
    el.innerHTML = chatRowHtml(side, line.text, end);
    const textEl = el.querySelector('.chat-text');
    const chars = [];
    for (const ch of Array.from(String(line.text || ''))) {
      const sp = document.createElement('span');
      sp.className = 'chat-ch';
      sp.textContent = ch;
      textEl.appendChild(sp);
      chars.push(sp);
    }
    C.box.appendChild(el);
    const row = { li: i, el: el, bubble: el.querySelector('.chat-bubble'), chars: chars, charStarts: chatCharStarts(line, lines[i + 1], i), lit: -1, line: line };
    C.rows.push(row);
    C.map.set(i, row);
    if (fresh) setTimeout(() => el.classList.remove('fresh'), 700);
  }

  function buildChatWindow(lines, idx) {
    const C = M.chat;
    if (!C.box) return;
    C.box.innerHTML = '';
    C.rows = [];
    C.map.clear();
    if (C.linesRef !== lines) {
      C.linesRef = lines;
      C.sides = null;
    }
    computeChatSides(lines, idx);
    const from = Math.max(0, idx - 4);
    for (let i = from; i <= idx; i++) addChatRow(lines, i, i === idx);
    C.idx = idx;
  }

  function updateChatRows(lines, idx, t) {
    const C = M.chat;
    for (let r = 0; r < C.rows.length; r++) {
      const row = C.rows[r];
      const line = lines[row.li];
      if (!line) continue;
      const isPast = row.li < idx;
      const isCur = row.li === idx;
      row.el.classList.toggle('past', isPast);
      row.el.classList.toggle('cur', isCur);
      let n = 0;
      if (isPast) n = row.chars.length;
      else if (isCur) {
        const starts = row.charStarts || [];
        while (n < starts.length && t >= starts[n] - 0.01) n++;
      }
      if (row.lit !== n) {
        for (let i = 0; i < row.chars.length; i++) row.chars[i].classList.toggle('on', i < n);
        row.lit = n;
      }
      if (row.bubble) row.bubble.classList.toggle('typing', isCur && row.chars.length > 0 && n < row.chars.length);
    }
  }

  function tickChat(lines, t) {
    const C = M.chat;
    if (!C.box) return;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (Number(lines[i].t) <= t + 0.02) idx = i;
      else break;
    }
    if (idx < 0) {
      if (C.idx !== -1) {
        C.box.innerHTML = '';
        C.rows = [];
        C.map.clear();
        C.idx = -1;
      }
      return;
    }
    const jump = C.idx < 0 || idx < C.idx || idx > C.idx + 1;
    if (jump) buildChatWindow(lines, idx);
    else if (idx !== C.idx) addChatRow(lines, idx, true);
    else if (!C.map.has(idx)) addChatRow(lines, idx, true);
    C.idx = idx;
    updateChatRows(lines, idx, t);
  }

  /* 用重复句识别副歌：副歌段让花火/光效/城市亮度更积极 */
  function buildChorusSet(lines) {
    const norm = s => String(s || '').toLowerCase().replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()《》〈〉【】\[\]…—–\-~～]/g, '');
    const freq = new Map();
    const keys = [];
    for (let i = 0; i < lines.length; i++) {
      const k = norm(lines[i].text);
      keys.push(k);
      if (k.length >= 2) freq.set(k, (freq.get(k) || 0) + 1);
    }
    const set = new Set();
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].length >= 2 && (freq.get(keys[i]) || 0) >= 2) set.add(i);
    }
    return set;
  }

  /* 段落结构：按句尾到下一句开头的空白切段，并识别主歌/副歌/呼吸段/抬升段 */
  function buildParagraphs(lines) {
    if (!lines || !lines.length) return null;
    const ends = lines.map((l, i) => {
      let e = Number(l.end) || 0;
      if (!(e > l.t)) e = lines[i + 1] ? lines[i + 1].t : (Number(l.t) || 0) + 5;
      if (lines[i + 1]) e = Math.min(e, Number(lines[i + 1].t));
      return Math.max(Number(l.t) || 0, e);
    });
    const gaps = [];
    for (let i = 1; i < lines.length; i++) {
      const g = (Number(lines[i].t) || 0) - ends[i - 1];
      if (g > 0.2 && g < 20) gaps.push(g);
    }
    gaps.sort((a, b) => a - b);
    const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0.8;
    const threshold = clamp(median * 2.5, 1.25, 3.5);
    const groups = [];
    let cur = [];
    const flush = () => {
      if (!cur.length) return;
      const first = cur[0], last = cur[cur.length - 1];
      const duration = ends[last] - (Number(lines[first].t) || 0);
      let words = 0;
      for (const i of cur) words += Array.from(String(lines[i].text || '').replace(/\s/g, '')).length;
      let punct = 0;
      for (const i of cur) punct += (String(lines[i].text || '').match(/[!?！？…]/g) || []).length;
      const chorus = cur.some(i => M.chorusSet && M.chorusSet.has(i));
      let kind;
      if (chorus) kind = 'chorus';
      else if (last === lines.length - 1) kind = 'outro';
      else if (duration <= 3.5 || words <= 3) kind = 'breath';
      else if (punct >= 2 || words / Math.max(duration, 1) > 2.5) kind = 'lift';
      else kind = 'verse';
      groups.push({ from: first, to: last, kind: kind, start: Number(lines[first].t) || 0, end: ends[last] });
      cur = [];
    };
    for (let i = 0; i < lines.length; i++) {
      if (cur.length) {
        const gap = (Number(lines[i].t) || 0) - ends[i - 1];
        const dur = ends[i - 1] - (Number(lines[cur[0]].t) || 0);
        if (gap >= threshold || cur.length >= 6 || dur > 18) flush();
      }
      cur.push(i);
    }
    flush();
    const paraOf = new Array(lines.length).fill(0);
    const paraKind = [];
    const paraStart = new Set();
    groups.forEach((g, pi) => {
      paraKind.push(g.kind);
      paraStart.add(g.from);
      for (let i = g.from; i <= g.to; i++) paraOf[i] = pi;
    });
    return { groups: groups, paraOf: paraOf, paraKind: paraKind, paraStart: paraStart };
  }

  function tickLyrics(now) {
    if (!M.api) return;
    if (FOLIA_STYLES[M.style]) return;
    if (now - M.lastMetaAt > 800) {
      M.lastMetaAt = now;
      updateMeta();
    }
    const lines = M.api.getLines() || [];
    if (lines !== M.linesRef) {
      M.linesRef = lines;
      M.idx = -2;
      M.mode = '';
      M.chorusSet = buildChorusSet(lines);
      const P = buildParagraphs(lines);
      M.paragraphs = P ? P.groups : null;
      M.paraOf = P ? P.paraOf : null;
      M.paraKind = P ? P.paraKind : null;
      M.paraStart = P ? P.paraStart : null;
      M.paraShots = [];
      pickMood(true);
    }
    const t = Number(M.api.getTime()) || 0;

    if (!lines.length) {
      if (M.layer) M.layer.classList.remove('fume-world-ready');
      if (M.style === 'chat' && M.chat.box) {
        M.chat.box.innerHTML = '';
        M.chat.rows = [];
        M.chat.map.clear();
        M.chat.idx = -1;
      }
      showStatic(M.api.getLoading() ? '搜索歌词中…' : '暂无歌词 · 跟着节奏律动');
      return;
    }
    if (M.style === 'fume') {
      tickFume(lines, t);
      return;
    }
    if (M.style === 'chat') {
      tickChat(lines, t);
      return;
    }

    let idx = -1;
    const lead = (M.style === 'flow' || M.style === 'diorama' || M.style === 'cinema' || M.style === 'hanabi' || M.style === 'vertical' || M.style === 'poem' || M.style === 'cloud' || M.style === 'confess' || M.style === 'fog') ? 0.025 : 0.12;
    for (let i = 0; i < lines.length; i++) {
      if (Number(lines[i].t) <= t + lead) idx = i;
      else break;
    }
    if (idx < 0) {
      showIntro(lines);
      return;
    }
    M.isChorus = !!(M.chorusSet && M.chorusSet.has(idx));
    if (M.isChorus !== M.lastChorus) {
      M.lastChorus = M.isChorus;
      try { window.dispatchEvent(new CustomEvent('bp-mv-chorus', { detail: { on: M.isChorus } })); } catch (e) {}
    }
    if (idx !== M.idx) {
      if (M.style === 'flow' || M.style === 'diorama' || M.style === 'cinema' || M.style === 'hanabi' || M.style === 'vertical' || M.style === 'poem' || M.style === 'cloud' || M.style === 'confess' || M.style === 'fog') buildFlowLine(lines, idx);
      else buildLine(lines, idx);
    }
    if (M.style === 'flow' || M.style === 'diorama' || M.style === 'cinema' || M.style === 'hanabi' || M.style === 'vertical' || M.style === 'poem' || M.style === 'cloud' || M.style === 'confess' || M.style === 'fog') {
      updateFlowWords(t);
      return;
    }

    for (let i = 0; i < M.chars.length; i++) {
      const c = M.chars[i];
      const on = t >= c.start - 0.05;
      if (on !== c.on) {
        c.on = on;
        c.el.classList.toggle('on', on);
      }
    }
  }

  /* 浮名：大幅线稿（星形 + 圆弧），像文字 PV 的装饰笔触 */
  function drawFumeMotif(ctx, now, pulse) {
    const ink = mixWhite(M.rgb, 0.18);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(ink, 0.1 + pulse * 0.05);
    ctx.lineWidth = 1.2;
    const cx = M.w * 0.72;
    const cy = M.h * 0.23;
    const R = Math.min(M.w, M.h) * 0.17;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + i * Math.PI / 5 + now * 0.00002;
      const rr = i % 2 ? R * 0.42 : R;
      const x = cx + Math.cos(ang) * rr;
      const y = cy + Math.sin(ang) * rr;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(M.w * 0.22, M.h * 0.62, Math.min(M.w, M.h) * 0.3, -0.5 + now * 0.00003, 1.15 + now * 0.00003);
    ctx.stroke();
    ctx.restore();
  }

  /* 星屑：顶部斜射光柱 + 大颗散景光斑 */
  function drawDioramaBeams(ctx, now, pulse) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const x = M.w * (0.18 + i * 0.32) + Math.sin(now * 0.00008 + i * 1.7) * 22;
      const g = ctx.createLinearGradient(x, 0, x + 70, M.h);
      g.addColorStop(0, rgba(M.rgb, 0.045 + pulse * 0.035));
      g.addColorStop(0.6, rgba(M.rgb, 0.014));
      g.addColorStop(1, rgba(M.rgb, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - 26, 0);
      ctx.lineTo(x + 26, 0);
      ctx.lineTo(x + 120, M.h);
      ctx.lineTo(x + 34, M.h);
      ctx.closePath();
      ctx.fill();
    }
    for (let i = 0; i < 4; i++) {
      const bx = (0.18 + i * 0.22 + Math.sin(now * 0.00006 + i) * 0.03) * M.w;
      const by = (0.22 + (i % 2) * 0.34 + Math.cos(now * 0.00005 + i) * 0.03) * M.h;
      const rad = Math.min(M.w, M.h) * (0.1 + i * 0.015) * (1 + pulse * 0.1);
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, rad);
      g.addColorStop(0, rgba(mixWhite(M.rgb, 0.45), 0.075));
      g.addColorStop(1, rgba(M.rgb, 0));
      ctx.fillStyle = g;
      ctx.fillRect(bx - rad, by - rad, rad * 2, rad * 2);
    }
    ctx.restore();
  }

  function moodTint(mood) {
    const fixed = {
      dream: [255, 255, 255],
      night: [110, 140, 255],
      rain: [118, 162, 198],
      warm: [255, 168, 96],
      neon: [255, 82, 176]
    };
    const f = fixed[mood];
    if (!f) return M.rgb;
    const k = mood === 'dream' ? 0.22 : 0.55;
    return [
      Math.round(M.rgb[0] + (f[0] - M.rgb[0]) * k),
      Math.round(M.rgb[1] + (f[1] - M.rgb[1]) * k),
      Math.round(M.rgb[2] + (f[2] - M.rgb[2]) * k)
    ];
  }

  function ensureBg() {
    const B = M.bg;
    if (B.stars && B.stars.length && B.w === M.w && B.h === M.h) return;
    B.w = M.w;
    B.h = M.h;
    B.stars = [];
    B.rain = [];
    B.dust = [];
    const n = Math.round(clamp(M.w * M.h / 8000, 50, 130));
    for (let i = 0; i < n; i++) {
      B.stars.push({ x: Math.random(), y: Math.random(), r: 0.4 + Math.random() * 1.7, ph: Math.random() * 6.28, sp: 0.4 + Math.random() * 1.6 });
    }
    for (let i = 0; i < 72; i++) {
      B.rain.push({ x: Math.random(), y: Math.random(), len: 0.03 + Math.random() * 0.07, sp: 0.5 + Math.random() * 0.9, ph: Math.random() * 6.28 });
    }
    for (let i = 0; i < 60; i++) {
      B.dust.push({ x: Math.random(), y: Math.random(), r: 0.8 + Math.random() * 2.4, sp: 0.01 + Math.random() * 0.03, ph: Math.random() * 6.28 });
    }
  }

  /* 场景粒子：花火、萤火、尘埃、涟漪。位置全部用 0~1 归一化，窗口变化不散架 */
  function ensureFx() {
    const F = M.fx;
    if (F.w === M.w && F.h === M.h && F.fireflies.length) return;
    F.w = M.w;
    F.h = M.h;
    F.fireworks = [];
    F.ripples = [];
    F.embers = [];
    F.fireflies = [];
    F.bokeh = [];
    for (let i = 0; i < 22; i++) {
      F.embers.push({
        x: fumeHash(i * 17 + 3), y: 0.6 + fumeHash(i * 19 + 7) * 0.4,
        sp: 0.012 + fumeHash(i * 23 + 1) * 0.03,
        ph: fumeHash(i * 29 + 5) * 6.28,
        r: 0.6 + fumeHash(i * 31 + 9) * 1.8
      });
    }
    for (let i = 0; i < 30; i++) {
      F.fireflies.push({
        x: fumeHash(i * 37 + 2), y: 0.25 + fumeHash(i * 41 + 6) * 0.7,
        ph: fumeHash(i * 43 + 4) * 6.28,
        sp: 0.4 + fumeHash(i * 47 + 8) * 1.4,
        r: 1 + fumeHash(i * 53 + 3) * 2.1
      });
    }
    for (let i = 0; i < 24; i++) {
      F.bokeh.push({
        x: fumeHash(i * 59 + 1), y: fumeHash(i * 61 + 5),
        r: 10 + fumeHash(i * 67 + 7) * 38,
        ph: fumeHash(i * 71 + 2) * 6.28,
        sp: 0.2 + fumeHash(i * 73 + 6) * 0.8,
        a: 0.025 + fumeHash(i * 79 + 4) * 0.06
      });
    }
  }

  const GL_VERT = [
    '#version 300 es',
    'in vec2 aPos;',
    'void main(){ gl_Position=vec4(aPos,0.0,1.0); }'
  ].join('\n');

  const GL_FRAG = [
    '#version 300 es',
    'precision highp float;',
    'out vec4 outColor;',
    'uniform vec2 uRes;',
    'uniform float uTime,uBass,uTone;',
    'uniform vec3 uBg,uPrimary,uAccent,uSecondary;',
    'uniform int uMood;',
    'uniform sampler2D uCover;',
    'uniform float uHasCover;',
    'float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }',
    'float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); float a=hash(i),b=hash(i+vec2(1.0,0.0)),c=hash(i+vec2(0.0,1.0)),d=hash(i+vec2(1.0,1.0)); return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }',
    'float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }',
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/uRes.xy;',
    ' vec2 p=(uv-0.5)*vec2(uRes.x/uRes.y,1.0);',
    ' float t=uTime;',
    ' vec2 q=vec2(fbm(p*1.4+vec2(t*0.04,-t*0.03)), fbm(p*1.4+vec2(5.2,1.3)-t*0.035));',
    ' float n=fbm(p*1.8+q*1.6+vec2(t*0.02,-t*0.015));',
    ' float n2=fbm(p*3.0-q*0.8-t*0.04);',
    ' float glow=smoothstep(0.22,1.05,n);',
    ' vec3 cover = uHasCover > 0.5 ? texture(uCover, uv*0.9 + 0.05).rgb : vec3(0.0);',
    ' vec3 col;',
    ' if(uTone<0.5){',
    '  col=uBg*0.78 + cover*0.16 + uAccent*glow*0.38 + uSecondary*n2*0.10;',
    '  float beam=smoothstep(0.7,1.0, sin((p.x*2.2+p.y*0.5)+t*0.35+q.x*1.5)*0.5+0.5);',
    '  col+=uAccent*beam*0.10;',
    '  float spark=pow(hash(floor(uv*uRes.xy/2.5)),90.0);',
    '  if(uMood==1) col+=vec3(spark)*0.8;',
    '  if(uMood==2){ float rain=smoothstep(0.94,1.0,sin((uv.x*80.0+t*8.0)*3.1415)*0.5+0.5); col+=uSecondary*rain*0.08; }',
    '  if(uMood==4){ vec2 g=abs(fract((p*3.0+vec2(0.0,t*0.1)))-0.5); float grid=smoothstep(0.48,0.5,max(g.x,g.y)); col+=uAccent*(1.0-grid)*0.06; }',
    ' } else {',
    '  col=mix(uBg, cover, 0.10) + uSecondary*(1.0-glow)*0.05 + uAccent*glow*0.16;',
    '  float lines=smoothstep(0.49,0.5,abs(fract((p.y+p.x*0.15)*7.0+n2*0.25)-0.5));',
    '  col=mix(col,uPrimary,lines*0.06);',
    '  float ink=fbm(p*2.0+q*2.0+t*0.01);',
    '  col=mix(col,uPrimary, smoothstep(0.55,0.75,ink)*0.06);',
    ' }',
    ' float grain=hash(uv*uRes.xy+fract(t)*100.0);',
    ' col+=(grain-0.5)*0.045;',
    ' float v=length(uv-0.5);',
    ' col*=1.0-v*0.28;',
    ' col*=1.0+uBass*0.06;',
    ' outColor=vec4(col,1.0);',
    '}'
  ].join('\n');


  /* Lumiere 专用背景着色器：体积光 + 雾 + 眩光 + 暗场，绘光模式使用 */
  const GL_LUM_FRAG = [
    '#version 300 es',
    'precision highp float;',
    'out vec4 outColor;',
    'uniform vec2 uRes;',
    'uniform float uTime,uBass;',
    'uniform vec3 uBg,uAccent,uSecondary;',
    'float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }',
    'float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); float a=hash(i),b=hash(i+vec2(1.,0.)),c=hash(i+vec2(0.,1.)),d=hash(i+vec2(1.,1.)); return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }',
    'float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }',
    'float beamMask(vec2 p, vec2 o, float ang, float width, float len){',
    '  vec2 d=vec2(cos(ang),sin(ang));',
    '  vec2 q=p-o; float along=dot(q,d); float side=abs(dot(q,vec2(-d.y,d.x)));',
    '  float spread=width+max(along,0.0)*0.30;',
    '  float sideFall=exp(-pow(side/max(spread,0.001),2.0)*3.0);',
    '  float alongFall=1.0-smoothstep(0.0,len,along);',
    '  float startFall=smoothstep(-0.08,0.04,along);',
    '  return sideFall*alongFall*startFall;',
    '}',
    'void main(){',
    '  vec2 uv=gl_FragCoord.xy/uRes.xy;',
    '  float ar=uRes.x/uRes.y;',
    '  vec2 p=(uv-0.5)*vec2(ar,1.0);',
    '  vec3 col=mix(uBg, vec3(0.015,0.035,0.028), 0.62);',
    '  float fog=fbm(p*1.7+vec2(uTime*0.018,-uTime*0.013));',
    '  col+=uSecondary*fog*0.075;',
    '  vec3 light=mix(uAccent,vec3(1.0),0.55);',
    '  float b=0.0;',
    '  b+=beamMask(p, vec2(-0.30,0.82), -1.38, 0.040, 1.35);',
    '  b+=beamMask(p, vec2(0.0,0.88), -1.57, 0.052, 1.55);',
    '  b+=beamMask(p, vec2(0.31,0.80), -1.76, 0.036, 1.30);',
    '  b+=beamMask(p, vec2(0.03,0.90), -1.57, 0.105, 1.75)*0.55;',
    '  col+=light*b*(0.30+uBass*0.12)*(0.55+fog*0.7);',
    '  float gd=length(p-vec2(0.01,0.46));',
    '  col+=light*(exp(-gd*3.0)*0.16+exp(-gd*gd*20.0)*0.24);',
    '  float ca=sin(p.x*9.0+sin(p.y*5.0+uTime*0.25)*2.2)*0.5+0.5;',
    '  ca*=smoothstep(0.12,-0.55,p.y);',
    '  col+=uSecondary*ca*0.045;',
    '  vec2 sp=floor(uv*vec2(uRes.x/6.0,uRes.y/6.0));',
    '  vec2 sf=fract(uv*vec2(uRes.x/6.0,uRes.y/6.0))-0.5;',
    '  float st=hash(sp);',
    '  float star=step(0.9975,st)*smoothstep(0.22,0.0,length(sf));',
    '  col+=vec3(star*(0.4+0.4*sin(uTime*1.8+st*30.0)));',
    '  col*=1.0-smoothstep(0.25,0.9,length(p))*0.58;',
    '  outColor=vec4(col,1.0);',
    '}'
  ].join('\n');

  function glCompile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(s) || '';
      gl.deleteShader(s);
      throw new Error('shader: ' + info);
    }
    return s;
  }

  let glTried = 0;
  function initGL() {
    glTried++;
    M.gl.stage = 'start';
    const c = document.getElementById('mv-gl');
    if (!c) { M.gl.stage = 'no-canvas'; return; }
    if (M.gl.canvas === c && M.gl.ready) return;
    if (M.gl.gl) {
      try { const ext = M.gl.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e) {}
    }
    M.gl = { canvas: c, gl: null, prog: null, buf: null, u: {}, ready: false, failed: false, w: 0, h: 0 };
    let gl = null;
    try {
      gl = c.getContext('webgl2', { alpha: false, antialias: false, depth: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    } catch (e) {}
    if (!gl) { M.gl.failed = true; M.gl.stage = 'no-gl'; return; }
    M.gl.stage = 'context';
    try {
      const vs = glCompile(gl, gl.VERTEX_SHADER, GL_VERT);
      const fs = glCompile(gl, gl.FRAGMENT_SHADER, GL_FRAG);
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + (gl.getProgramInfoLog(prog) || ''));
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const a = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      M.gl.tex = tex;
      M.gl.texKey = '';
      M.gl.gl = gl;
      M.gl.prog = prog;
      M.gl.buf = buf;
      M.gl.u = {
        res: gl.getUniformLocation(prog, 'uRes'),
        time: gl.getUniformLocation(prog, 'uTime'),
        bass: gl.getUniformLocation(prog, 'uBass'),
        tone: gl.getUniformLocation(prog, 'uTone'),
        bg: gl.getUniformLocation(prog, 'uBg'),
        primary: gl.getUniformLocation(prog, 'uPrimary'),
        accent: gl.getUniformLocation(prog, 'uAccent'),
        secondary: gl.getUniformLocation(prog, 'uSecondary'),
        mood: gl.getUniformLocation(prog, 'uMood'),
        cover: gl.getUniformLocation(prog, 'uCover'),
        hasCover: gl.getUniformLocation(prog, 'uHasCover')
      };
      // Lumiere 专用程序（绘光）；编译失败时回落通用 GL
      try {
        const lvs = glCompile(gl, gl.VERTEX_SHADER, GL_VERT);
        const lfs = glCompile(gl, gl.FRAGMENT_SHADER, GL_LUM_FRAG);
        const lp = gl.createProgram();
        gl.attachShader(lp, lvs); gl.attachShader(lp, lfs); gl.linkProgram(lp);
        gl.deleteShader(lvs); gl.deleteShader(lfs);
        if (!gl.getProgramParameter(lp, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(lp) || 'lum link');
        M.gl.lumProg = lp;
        M.gl.lumU = {
          res: gl.getUniformLocation(lp, 'uRes'),
          time: gl.getUniformLocation(lp, 'uTime'),
          bass: gl.getUniformLocation(lp, 'uBass'),
          bg: gl.getUniformLocation(lp, 'uBg'),
          accent: gl.getUniformLocation(lp, 'uAccent'),
          secondary: gl.getUniformLocation(lp, 'uSecondary')
        };
      } catch (e) {
        M.gl.lumErr = e && e.message ? e.message : String(e);
        M.gl.lumProg = null;
      }
      M.gl.ready = true;
      M.gl.stage = 'ready';
      updateGLTexture();
      M.gl.lostAfter = gl.isContextLost();
      c.addEventListener('webglcontextlost', e => {
        e.preventDefault();
        if (M.gl.gl !== gl) return; // 旧画布/旧上下文的丢失事件，不能影响新上下文
        M.gl.ready = false;
        if (M.layer) M.layer.classList.remove('gl-on');
      }, false);
      c.addEventListener('webglcontextrestored', () => {
        if (M.gl.gl !== gl) return;
        M.gl.canvas = null;
        M.gl.ready = false;
        initGL();
      }, false);
    } catch (e) {
      M.gl.failed = true;
      M.gl.err = e && e.message ? e.message : String(e);
      M.gl.stage = 'error';
      M.gl.ready = false;
      try { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e2) {}
    }
  }

  function updateGLTexture() {
    if (!M.gl.ready || !M.gl.gl || !M.gl.tex) return;
    const small = M.coverArt && M.coverArt.small;
    const key = (M.paletteKey || '') + '|' + (small ? small.width : 0);
    if (key === M.gl.texKey) return;
    const gl = M.gl.gl;
    try {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, M.gl.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      if (small) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, small);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      M.gl.texKey = key;
    } catch (e) {}
  }

  function drawLumiereGL(now, dt, pulse) {
    if (!M.gl.ready || !M.gl.gl || !M.gl.lumProg || !M.aiTheme) return false;
    if (M.tone === 'light') return false;
    const gl = M.gl.gl;
    if (gl.isContextLost && gl.isContextLost()) return false;
    const c = M.gl.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, M.lowPower ? 1 : 1.5);
    const w = Math.max(1, Math.round(M.w * dpr));
    const h = Math.max(1, Math.round(M.h * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const u = M.gl.lumU;
    gl.viewport(0, 0, w, h);
    gl.useProgram(M.gl.lumProg);
    gl.uniform2f(u.res, w, h);
    gl.uniform1f(u.time, (now || 0) * 0.001);
    gl.uniform1f(u.bass, pulse || 0);
    const bg = M.aiBg || [9, 16, 14];
    const acc = M.aiPalette || [121, 199, 168];
    const sec = M.aiSecondary || [96, 128, 112];
    gl.uniform3f(u.bg, bg[0] / 255, bg[1] / 255, bg[2] / 255);
    gl.uniform3f(u.accent, acc[0] / 255, acc[1] / 255, acc[2] / 255);
    gl.uniform3f(u.secondary, sec[0] / 255, sec[1] / 255, sec[2] / 255);
    gl.bindBuffer(gl.ARRAY_BUFFER, M.gl.buf);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (M.layer) M.layer.classList.add('gl-on');
    return true;
  }

  function drawGL(now, dt, pulse) {
    if (!M.gl.ready || !M.gl.gl || !M.aiTheme) return false;
    const gl = M.gl.gl;
    if (gl.isContextLost && gl.isContextLost()) { M.gl.ready = false; M.gl.err = 'context lost after create'; return false; }
    const c = M.gl.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, M.lowPower ? 1 : 1.5);
    const w = Math.max(1, Math.round(M.w * dpr));
    const h = Math.max(1, Math.round(M.h * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const u = M.gl.u;
    gl.viewport(0, 0, w, h);
    gl.useProgram(M.gl.prog);
    gl.uniform2f(u.res, w, h);
    gl.uniform1f(u.time, (now || 0) * 0.001);
    gl.uniform1f(u.bass, pulse || 0);
    gl.uniform1f(u.tone, M.tone === 'light' ? 1 : 0);
    const bg = M.aiBg || [13, 17, 23];
    const ink = M.aiInk || [242, 245, 247];
    const acc = M.aiPalette || [251, 114, 153];
    const sec = M.aiSecondary || [139, 147, 161];
    gl.uniform3f(u.bg, bg[0] / 255, bg[1] / 255, bg[2] / 255);
    gl.uniform3f(u.primary, ink[0] / 255, ink[1] / 255, ink[2] / 255);
    gl.uniform3f(u.accent, acc[0] / 255, acc[1] / 255, acc[2] / 255);
    gl.uniform3f(u.secondary, sec[0] / 255, sec[1] / 255, sec[2] / 255);
    const moods = { dream: 0, night: 1, rain: 2, warm: 3, neon: 4, cover: 5, lineart: 6 };
    gl.uniform1i(u.mood, moods[M.mood] || 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, M.gl.tex);
    gl.uniform1i(u.cover, 0);
    gl.uniform1f(u.hasCover, (M.mood === 'cover' && M.coverArt) ? 1 : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, M.gl.buf);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (M.layer) M.layer.classList.add('gl-on');
    return true;
  }

  /* ---------- MIT 歌词引擎（music-lyric-player）---------- */
  function lrcTime(sec) {
    sec = Math.max(0, Number(sec) || 0);
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return String(m).padStart(2, '0') + ':' + s.toFixed(2).padStart(5, '0');
  }

  function scrollLrcFromLines(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const text = String(lines[i].text || '');
      if (!text) continue;
      const start = Number(lines[i].t) || 0;
      const next = lines[i + 1] ? Number(lines[i + 1].t) : 0;
      let end = next > start ? next : start + 6;
      if (end - start > 12) end = start + 12;
      if (end - start < 0.7) end = start + 0.7;
      const dur = end - start;
      const units = splitFumeUnits(text);
      let total = 0;
      const weights = [];
      for (let j = 0; j < units.length; j++) {
        const ch = units[j].text;
        let w;
        if (units[j].space) w = 0.3;
        else if (PUNC.test(ch)) w = 0.2;
        else if (CJK.test(ch)) w = 1;
        else w = 0.55;
        weights.push(w);
        total += w;
      }
      if (!total) total = 1;
      const active = dur * 0.94;
      let acc = start + 0.02;
      let body = '';
      for (let j = 0; j < units.length; j++) {
        const u = units[j];
        if (u.space) {
          body += ' ';
          acc += active * weights[j] / total;
          continue;
        }
        body += '<' + lrcTime(acc) + '>' + u.text;
        acc += active * weights[j] / total;
      }
      out.push('[' + lrcTime(start) + ']' + body);
    }
    return out.join('\n');
  }

  function fixScrollEnds(info) {
    if (!info || !info.lines) return;
    const normals = [];
    for (const line of info.lines) {
      if (line.body && line.body.case === 'normal') normals.push(line);
    }
    for (let i = 0; i < normals.length; i++) {
      const n = normals[i].body.value;
      const start = (n.time && n.time.start) || 0;
      const nextStart = i + 1 < normals.length ? (normals[i + 1].body.value.time.start || start + 5000) : start + 5000;
      const end = Math.max(start + 700, nextStart);
      n.time = n.time || { start: start };
      n.time.end = end;
      const words = (n.words || []).filter(w => w.body && w.body.case === 'normal');
      for (let j = 0; j < words.length; j++) {
        const w = words[j].body.value;
        const ws = (w.time && w.time.start) || start;
        const we = j + 1 < words.length ? (words[j + 1].body.value.time.start || end) : end;
        w.time = w.time || { start: ws };
        w.time.end = Math.max(ws + 80, we);
      }
    }
  }

  function initScroll() {
    const box = document.getElementById('mv-scroll');
    if (!box || !window.LyricEngine) return false;
    if (M.scroll && M.scroll.box === box && M.scroll.dom) return true;
    if (M.scroll && M.scroll.dom) {
      try { M.scroll.dom.destroy(); } catch (e) {}
    }
    M.scroll = null;
    try {
      const base = new window.LyricEngine.BaseLyricPlayer();
      const dom = new window.LyricEngine.DomLyricPlayer(base);
      box.innerHTML = '';
      box.appendChild(dom.element);
      M.scroll = { box: box, base: base, dom: dom, linesRef: null };
      applyScrollConfig();
      return true;
    } catch (e) {
      M.scroll = null;
      return false;
    }
  }

  function applyScrollConfig() {
    if (!M.scroll || !M.scroll.dom) return;
    const t = aiToneTheme();
    const light = M.tone === 'light' && !!t;
    const ink = t ? t.primaryColor : '#ffffff';
    const accent = t ? t.accentColor : '#ffffff';
    const family = t && t.fontStyle === 'serif'
      ? '"Yu Mincho", "Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", "Songti SC", serif'
      : '"Yu Gothic", "Hiragino Sans", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
    const size = Math.round(Math.min(66, Math.max(34, M.w * 0.052)));
    const normal = light ? 'rgba(23,21,18,.3)' : 'rgba(255,255,255,.3)';
    const played = light ? 'rgba(23,21,18,.55)' : 'rgba(255,255,255,.55)';
    try {
      M.scroll.dom.config.merge({
        layout: { align: 'center', gap: Math.round(Math.min(44, Math.max(18, M.h * 0.055))) },
        effect: {
          blur: { enabled: true, min: 0.35, max: 4.8 },
          scale: { enabled: true, min: 0.66, max: 1 }
        },
        scroll: { anchor: 50, animation: { mode: 'ripple', duration: 600, range: 4, step: 45 } },
        line: {
          normal: {
            base: {
              font: { size: size, weight: 800, family: family },
              style: { normal: { color: normal }, active: { color: ink }, played: { color: played } }
            },
            main: {
              use: 'syllable',
              syllable: {
                word: {
                  animation: {
                    float: { enabled: true, from: 0, to: -2 },
                    mask: { enabled: true, feather: { normal: 0.5, first: 1.5, last: 0.5 } },
                    emphasize: {
                      enabled: true,
                      minDuration: 0,
                      disablePlaybackRate: 4,
                      effects: {
                        main: { enabled: true, scale: 0.1, offsetHorizontal: 1, offsetVertical: 1 },
                        glow: { enabled: true, color: accent, maxRadius: 9, maxAlpha: 0.8 },
                        float: { enabled: true, duration: { scale: 1.4, lead: 400 }, amplitude: 2, background: { enabled: true, scale: 2 } }
                      }
                    }
                  }
                }
              }
            },
            annotation: { visible: false }
          }
        },
        container: { fade: { enabled: true } }
      });
    } catch (e) {}
  }

  function scrollUpdate(lines) {
    if (!M.scroll) return;
    const lrc = scrollLrcFromLines(lines || []);
    if (!lrc) { M.scroll.linesRef = lines; return; }
    try {
      const parsed = window.LyricEngine.createParserPipeline({ content: { original: lrc } })
        .infer().parse().interlude.insert().space.insert().final();
      fixScrollEnds(parsed.result);
      M.scroll.base.updateLyric(parsed.result);
      M.scroll.linesRef = lines;
    } catch (e) {}
  }

  function scrollSync() {
    if (!M.scroll) return;
    const base = M.scroll.base;
    const playing = !!(M.api && M.api.getPlaying && M.api.getPlaying());
    const ms = ((M.api && M.api.getTime && M.api.getTime()) || 0) * 1000;
    try {
      if (playing) {
        if (!base.currentPlaying || Math.abs(base.currentTime - ms) > 650) base.play(ms);
      } else if (base.currentPlaying) {
        base.pause();
      }
    } catch (e) {}
  }

  function drawDream(ctx, now, dt, pulse, alpha, rgb) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    const g = ctx.createLinearGradient(0, 0, M.w, M.h);
    g.addColorStop(0, 'rgba(13,9,19,1)');
    g.addColorStop(0.55, 'rgba(9,8,14,1)');
    g.addColorStop(1, 'rgba(5,4,8,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, M.w, M.h);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < M.blobs.length; i++) {
      const b = M.blobs[i];
      const bx = (b.x + Math.sin(now * 0.00006 * b.sp + b.ph) * 0.09) * M.w;
      const by = (b.y + Math.cos(now * 0.00008 * b.sp + b.ph * 1.7) * 0.08) * M.h;
      const rad = Math.max(M.w, M.h) * b.r * (1 + 0.1 * Math.sin(now * 0.0009 * b.sp + b.ph) + pulse * 0.16);
      const tint = mixWhite(rgb, b.k);
      const rg = ctx.createRadialGradient(bx, by, 0, bx, by, rad);
      rg.addColorStop(0, rgba(tint, b.a * (0.75 + pulse * 0.35)));
      rg.addColorStop(0.55, rgba(tint, b.a * 0.42));
      rg.addColorStop(1, rgba(tint, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(bx - rad, by - rad, rad * 2, rad * 2);
    }
    for (let i = 0; i < M.particles.length; i++) {
      const p = M.particles[i];
      p.y -= p.sp * dt;
      if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
      const px = (p.x + Math.sin(now * 0.0004 + p.ph) * 0.006) * M.w;
      const py = p.y * M.h;
      const a = 0.10 + 0.16 * (0.5 + 0.5 * Math.sin(now * 0.002 + p.ph));
      ctx.fillStyle = rgba(mixWhite(rgb, p.k), a);
      ctx.beginPath();
      ctx.arc(px, py, p.r * (1 + pulse * 0.2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawNight(ctx, now, dt, pulse, alpha, rgb, noMoon) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    const g = ctx.createLinearGradient(0, 0, 0, M.h);
    g.addColorStop(0, 'rgba(4,6,16,1)');
    g.addColorStop(0.55, 'rgba(8,11,28,1)');
    g.addColorStop(1, 'rgba(2,3,8,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, M.w, M.h);
    ctx.globalCompositeOperation = 'lighter';
    const neb = ctx.createRadialGradient(M.w * 0.26, M.h * 0.24, 0, M.w * 0.26, M.h * 0.24, M.w * 0.55);
    neb.addColorStop(0, rgba(moodTint('night'), 0.14));
    neb.addColorStop(1, rgba(moodTint('night'), 0));
    ctx.fillStyle = neb;
    ctx.fillRect(0, 0, M.w, M.h);
    if (!noMoon) {
      const mx = M.w * 0.74;
      const my = M.h * 0.2;
      const mr = Math.min(M.w, M.h) * 0.075;
      const moon = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 2.2);
      moon.addColorStop(0, 'rgba(255,250,225,0.9)');
      moon.addColorStop(0.28, 'rgba(255,244,210,0.5)');
      moon.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = moon;
      ctx.fillRect(mx - mr * 2.2, my - mr * 2.2, mr * 4.4, mr * 4.4);
      ctx.fillStyle = 'rgba(255,252,235,0.92)';
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fill();
    }
    const B = M.bg;
    for (let i = 0; i < B.stars.length; i++) {
      const s = B.stars[i];
      const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(now * 0.001 * s.sp + s.ph));
      ctx.fillStyle = 'rgba(225,235,255,' + (a * 0.8) + ')';
      ctx.beginPath();
      ctx.arc(s.x * M.w, s.y * M.h, s.r * (1 + pulse * 0.15), 0, Math.PI * 2);
      ctx.fill();
    }
    const shoot = (now * 0.00004) % 1;
    if (shoot < 0.06) {
      const sx = M.w * (0.15 + shoot * 8);
      const sy = M.h * (0.12 + shoot * 2.2);
      const lg = ctx.createLinearGradient(sx, sy, sx - 90, sy + 50);
      lg.addColorStop(0, 'rgba(255,255,255,0.75)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = lg;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx - 90, sy + 50);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRain(ctx, now, dt, pulse, alpha, rgb) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    const g = ctx.createLinearGradient(0, 0, 0, M.h);
    g.addColorStop(0, 'rgba(7,13,22,1)');
    g.addColorStop(0.55, 'rgba(11,20,30,1)');
    g.addColorStop(1, 'rgba(4,7,12,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, M.w, M.h);
    ctx.globalCompositeOperation = 'lighter';
    const tint = moodTint('rain');
    const fog = ctx.createRadialGradient(M.w * 0.5, M.h * 0.62, 0, M.w * 0.5, M.h * 0.62, M.w * 0.7);
    fog.addColorStop(0, rgba(tint, 0.1));
    fog.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = fog;
    ctx.fillRect(0, 0, M.w, M.h);
    ctx.strokeStyle = 'rgba(180,205,235,0.2)';
    ctx.lineWidth = 1;
    const B = M.bg;
    for (let i = 0; i < B.rain.length; i++) {
      const r = B.rain[i];
      const y = ((r.y + (now * 0.00012 * r.sp + r.ph * 0.1)) % 1) * M.h;
      const x = (r.x + Math.sin(now * 0.0002 + r.ph) * 0.01) * M.w;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 5, y + M.h * r.len);
      ctx.stroke();
    }
    for (let i = 0; i < 11; i++) {
      const dx = (0.08 + fumeHash(i * 13 + 2) * 0.84) * M.w;
      const dy = (0.12 + fumeHash(i * 13 + 5) * 0.7) * M.h;
      const rr = 2 + fumeHash(i * 13 + 8) * 7;
      const dg = ctx.createRadialGradient(dx, dy, 0, dx, dy, rr);
      dg.addColorStop(0, 'rgba(220,235,255,0.35)');
      dg.addColorStop(1, 'rgba(220,235,255,0)');
      ctx.fillStyle = dg;
      ctx.fillRect(dx - rr, dy - rr, rr * 2, rr * 2);
    }
    ctx.restore();
  }

  function drawWarm(ctx, now, dt, pulse, alpha, rgb) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    const g = ctx.createLinearGradient(0, 0, M.w * 0.5, M.h);
    g.addColorStop(0, 'rgba(30,16,9,1)');
    g.addColorStop(0.5, 'rgba(22,13,9,1)');
    g.addColorStop(1, 'rgba(8,6,7,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, M.w, M.h);
    ctx.globalCompositeOperation = 'lighter';
    const tint = moodTint('warm');
    const sx = M.w * 0.72;
    const sy = M.h * 0.16;
    const sun = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(M.w, M.h) * 0.5);
    sun.addColorStop(0, rgba(tint, 0.32 + pulse * 0.06));
    sun.addColorStop(0.35, rgba(tint, 0.12));
    sun.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, M.w, M.h);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(now * 0.00002);
    for (let i = 0; i < 7; i++) {
      ctx.rotate(Math.PI * 2 / 7);
      const rg = ctx.createLinearGradient(0, 0, M.w * 0.7, 0);
      rg.addColorStop(0, rgba(tint, 0.08));
      rg.addColorStop(1, rgba(tint, 0));
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(M.w * 0.75, -M.h * 0.08);
      ctx.lineTo(M.w * 0.75, M.h * 0.08);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    const B = M.bg;
    for (let i = 0; i < B.dust.length; i++) {
      const p = B.dust[i];
      const x = (p.x + Math.sin(now * 0.0003 + p.ph) * 0.01) * M.w;
      const y = ((p.y - now * 0.000008 * p.sp) % 1 + 1) % 1 * M.h;
      const a = 0.08 + 0.16 * (0.5 + 0.5 * Math.sin(now * 0.0015 + p.ph));
      ctx.fillStyle = rgba(mixWhite(tint, 0.5), a);
      ctx.beginPath();
      ctx.arc(x, y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawNeon(ctx, now, dt, pulse, alpha, rgb) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    const g = ctx.createLinearGradient(0, 0, 0, M.h);
    g.addColorStop(0, 'rgba(7,5,15,1)');
    g.addColorStop(0.6, 'rgba(11,6,19,1)');
    g.addColorStop(1, 'rgba(3,3,7,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, M.w, M.h);
    ctx.globalCompositeOperation = 'lighter';
    const tint = moodTint('neon');
    const cyan = [90, 235, 255];
    const hy = M.h * 0.55;
    const vx = M.w * 0.5;
    const vy = M.h * 0.46;
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(tint, 0.16 + pulse * 0.08);
    for (let i = 0; i <= 14; i++) {
      const x = (i / 14) * M.w;
      ctx.beginPath();
      ctx.moveTo(x, M.h);
      ctx.lineTo(vx, vy);
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(cyan, 0.14 + pulse * 0.1);
    for (let i = 0; i < 10; i++) {
      const t = i / 10;
      const y = vy + (M.h - vy) * t * t;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(M.w, y);
      ctx.stroke();
    }
    const scan = ((now * 0.00006) % 1) * M.h;
    const sg = ctx.createLinearGradient(0, scan - 30, 0, scan + 30);
    sg.addColorStop(0, rgba(cyan, 0));
    sg.addColorStop(0.5, rgba(cyan, 0.07));
    sg.addColorStop(1, rgba(cyan, 0));
    ctx.fillStyle = sg;
    ctx.fillRect(0, scan - 30, M.w, 60);
    const glow = ctx.createRadialGradient(vx, hy, 0, vx, hy, M.w * 0.5);
    glow.addColorStop(0, rgba(tint, 0.1 + pulse * 0.06));
    glow.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, M.w, M.h);
    ctx.restore();
  }

  function drawCover(ctx, now, dt, pulse, alpha, rgb) {
    if (!M.coverArt || !M.coverArt.small) { drawDream(ctx, now, dt, pulse, alpha, rgb); return; }
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#060509';
    ctx.fillRect(0, 0, M.w, M.h);
    const img = M.coverArt.small;
    const s = Math.max(M.w / img.width, M.h / img.height);
    const dw = img.width * s;
    const dh = img.height * s;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = alpha * 0.8;
    ctx.drawImage(img, (M.w - dw) / 2, (M.h - dh) / 2, dw, dh);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'source-over';
    const g = ctx.createLinearGradient(0, 0, 0, M.h);
    g.addColorStop(0, 'rgba(5,4,8,0.55)');
    g.addColorStop(0.5, 'rgba(5,4,8,0.28)');
    g.addColorStop(1, 'rgba(5,4,8,0.68)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, M.w, M.h);
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(M.w * 0.5, M.h * 0.5, 0, M.w * 0.5, M.h * 0.5, M.w * 0.55);
    glow.addColorStop(0, rgba(rgb, 0.06 + pulse * 0.04));
    glow.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, M.w, M.h);
    ctx.restore();
  }

  function drawLineart(ctx, now, dt, pulse, alpha, rgb) {
    if (!M.coverArt || !M.coverArt.line) { drawDream(ctx, now, dt, pulse, alpha, rgb); return; }
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#040405';
    ctx.fillRect(0, 0, M.w, M.h);
    const img = M.coverArt.line;
    const s = Math.max(M.w / img.width, M.h / img.height);
    const dw = img.width * s;
    const dh = img.height * s;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = alpha * 0.82;
    ctx.drawImage(img, (M.w - dw) / 2, (M.h - dh) / 2, dw, dh);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    const glow = ctx.createRadialGradient(M.w * 0.5, M.h * 0.5, 0, M.w * 0.5, M.h * 0.5, M.w * 0.6);
    glow.addColorStop(0, rgba(rgb, 0.05 + pulse * 0.04));
    glow.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, M.w, M.h);
    ctx.restore();
  }

  /* 浅色纸感画面：AI 亮色主题专用，线稿用深色墨线版本 */
  /* ---------- 场景层：花火、极光、雾、光柱、雨城、墨迹 ---------- */
  function spawnFirework(now) {
    const F = M.fx;
    if (F.fireworks.length > 5) return;
    const seed = Math.floor(now / 650);
    const rnd = n => fumeHash(seed * 37 + n * 11 + 3);
    const type = rnd(1) < 0.22 ? 'willow' : (rnd(2) < 0.3 ? 'ring' : 'peony');
    const cx = 0.24 + rnd(3) * 0.52;
    const cy = 0.12 + rnd(4) * 0.3;
    const base = M.aiPalette || M.rgb;
    const c1 = mixWhite(base, rnd(5) * 0.35);
    const c2 = rnd(6) < 0.5 ? moodTint('warm') : mixWhite(base, 0.55);
    const count = type === 'willow' ? 64 : (type === 'ring' ? 44 : 58);
    const parts = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (rnd(i + 10) - 0.5) * 0.28;
      const sp = (type === 'ring' ? 0.19 : 0.10 + rnd(i + 20) * 0.32) * (type === 'willow' ? 1.15 : 1);
      const life = (type === 'willow' ? 1.7 : 1.0) + rnd(i + 30) * 0.9;
      const col = rnd(i + 40) < 0.28 ? [242, 242, 255] : (rnd(i + 50) < 0.5 ? c1 : c2);
      parts.push({ a: a, sp: sp, life: life, col: col, size: 0.9 + rnd(i + 60) * 1.8, g: type === 'willow' ? 0.12 : 0.06 });
    }
    F.fireworks.push({ t0: now / 1000, x: cx, y: cy, c1: c1, c2: c2, parts: parts, type: type, flight: 0.45 + rnd(7) * 0.35 });
    F.lastBurst = now;
  }

  function drawFireworks(ctx, now, pulse, alpha) {
    const F = M.fx;
    const t = now / 1000;
    const scale = Math.min(M.w, M.h);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    for (let bi = F.fireworks.length - 1; bi >= 0; bi--) {
      const b = F.fireworks[bi];
      const age = t - b.t0;
      const flight = b.flight || 0.55;
      if (age > flight + 3.2) { F.fireworks.splice(bi, 1); continue; }
      const bx = b.x * M.w;
      const by = b.y * M.h;
      if (age < flight) {
        // 升空：从画面底部拖一条细尾，到爆点再炸开
        const p = clamp(age / flight, 0, 1);
        const e = 1 - Math.pow(1 - p, 3);
        const sy = M.h * 0.98 + (by - M.h * 0.98) * e;
        const sx = bx + Math.sin(age * 26) * 2.2;
        const tg = ctx.createLinearGradient(sx, sy + 52, sx, sy);
        tg.addColorStop(0, rgba(b.c1, 0));
        tg.addColorStop(0.7, rgba(mixWhite(b.c1, 0.6), 0.32));
        tg.addColorStop(1, rgba([255, 248, 225], 0.9));
        ctx.strokeStyle = tg;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(sx, sy + 52);
        ctx.lineTo(sx, sy);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,250,235,.95)';
        ctx.beginPath();
        ctx.arc(sx, sy, 2 + p * 1.8, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const ba = age - flight;
      if (ba < 0.85) {
        const fa = (1 - ba / 0.85) * 0.3;
        const fr = scale * (0.08 + ba * 0.18);
        const fg = ctx.createRadialGradient(bx, by, 0, bx, by, fr);
        fg.addColorStop(0, rgba(mixWhite(b.c1, 0.25), fa));
        fg.addColorStop(1, rgba(b.c1, 0));
        ctx.fillStyle = fg;
        ctx.fillRect(bx - fr, by - fr, fr * 2, fr * 2);
        if (ba < 0.12) {
          ctx.fillStyle = 'rgba(255,255,255,' + ((1 - ba / 0.12) * 0.08) + ')';
          ctx.fillRect(0, 0, M.w, M.h);
        }
      }
      for (let i = 0; i < b.parts.length; i++) {
        const p = b.parts[i];
        if (ba > p.life) continue;
        const k = 1 - Math.exp(-ba * 1.5);
        const dist = p.sp * scale * k * 1.25;
        const x = bx + Math.cos(p.a) * dist;
        const y = by + Math.sin(p.a) * dist + 0.5 * p.g * scale * ba * ba;
        const fade = Math.pow(1 - ba / p.life, 1.4);
        if (fade <= 0.01) continue;
        const r = p.size * (0.55 + fade * 0.75);
        const px = bx + Math.cos(p.a) * dist * 0.9;
        const py = by + Math.sin(p.a) * dist * 0.9 + 0.5 * p.g * scale * Math.max(0, ba - 0.045) ** 2;
        ctx.strokeStyle = rgba(p.col, fade * 0.42);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = rgba(p.col, fade * 0.14);
        ctx.beginPath();
        ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(p.col, fade * 0.95);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (ba < 0.9) {
        ctx.strokeStyle = rgba(mixWhite(b.c1, 0.35), (1 - ba / 0.9) * 0.4);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(bx, by, scale * 0.02 + ba * scale * 0.18, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (ba > 0.4 && ba < 2.8) {
        const sa = (1 - (ba - 0.4) / 2.4) * 0.06;
        const sr = scale * (0.12 + ba * 0.08);
        const sg = ctx.createRadialGradient(bx, by, 0, bx, by, sr);
        sg.addColorStop(0, rgba(mixWhite(b.c1, 0.4), sa));
        sg.addColorStop(1, rgba(b.c1, 0));
        ctx.fillStyle = sg;
        ctx.fillRect(bx - sr, by - sr, sr * 2, sr * 2);
      }
    }
    for (let i = 0; i < F.embers.length; i++) {
      const e = F.embers[i];
      const y = ((e.y - now * 0.000008 * e.sp * 60) % 1 + 1) % 1;
      const x = (e.x + Math.sin(now * 0.00025 + e.ph) * 0.02) * M.w;
      const a = (0.15 + 0.35 * (0.5 + 0.5 * Math.sin(now * 0.0016 + e.ph))) * (0.7 + pulse * 0.5);
      ctx.fillStyle = rgba(mixWhite(M.rgb, 0.55), a);
      ctx.beginPath();
      ctx.arc(x, y * M.h, e.r * (1 + pulse * 0.3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawAurora(ctx, now, pulse, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    const cols = [moodTint('dream'), mixWhite(moodTint('night'), 0.25), mixWhite(M.rgb, 0.35)];
    for (let band = 0; band < 3; band++) {
      const y0 = (0.16 + band * 0.09) * M.h;
      const height = M.h * (0.07 + band * 0.018);
      const col = cols[band];
      const grad = ctx.createLinearGradient(0, y0 - height, 0, y0 + height);
      grad.addColorStop(0, rgba(col, 0));
      grad.addColorStop(0.42, rgba(col, (0.09 + pulse * 0.04) * (1 - band * 0.18)));
      grad.addColorStop(0.65, rgba(mixWhite(col, 0.25), 0.05));
      grad.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      for (let x = 0; x <= M.w + 20; x += 22) {
        const y = y0 + Math.sin(x * 0.0028 + now * 0.00011 * (band + 1) + band * 1.7) * M.h * 0.035
          + Math.sin(x * 0.0011 - now * 0.00007) * M.h * 0.018;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let x = M.w + 20; x >= 0; x -= 22) {
        const y = y0 + height + Math.sin(x * 0.0028 + now * 0.00011 * (band + 1) + band * 1.7) * M.h * 0.02;
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFog(ctx, now, pulse, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    const tint = mixWhite(moodTint('dream'), 0.3);
    for (let i = 0; i < 4; i++) {
      const y = (0.54 + i * 0.1) * M.h + Math.sin(now * 0.00006 + i) * M.h * 0.025;
      const x = (0.12 + i * 0.24 + Math.sin(now * 0.00004 + i * 2) * 0.08) * M.w;
      const r = M.w * (0.28 + i * 0.04);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(tint, (0.07 + pulse * 0.025) * (1 - i * 0.16)));
      g.addColorStop(1, rgba(tint, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  function drawFireflies(ctx, now, pulse, alpha) {
    const F = M.fx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    const tint = mixWhite(moodTint('warm'), 0.45);
    for (let i = 0; i < F.fireflies.length; i++) {
      const f = F.fireflies[i];
      const x = (f.x + Math.sin(now * 0.0002 * f.sp + f.ph) * 0.07) * M.w;
      const y = (f.y + Math.cos(now * 0.00017 * f.sp + f.ph * 1.4) * 0.05) * M.h;
      const a = 0.12 + 0.42 * (0.5 + 0.5 * Math.sin(now * 0.0018 * f.sp + f.ph));
      const r = f.r * (1 + pulse * 0.25);
      ctx.fillStyle = rgba(tint, a * 0.16);
      ctx.beginPath();
      ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(mixWhite(tint, 0.4), a);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBokeh(ctx, now, pulse, alpha) {
    const F = M.fx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    const tint = moodTint('warm');
    for (let i = 0; i < F.bokeh.length; i++) {
      const b = F.bokeh[i];
      const x = (b.x + Math.sin(now * 0.00005 * b.sp + b.ph) * 0.05) * M.w;
      const y = (b.y + Math.cos(now * 0.00004 * b.sp + b.ph) * 0.035) * M.h;
      const r = b.r * (1 + pulse * 0.08);
      ctx.fillStyle = rgba(mixWhite(tint, 0.2), b.a * (0.75 + pulse * 0.45));
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(mixWhite(tint, 0.6), b.a * 0.75);
      ctx.beginPath();
      ctx.arc(x - r * 0.18, y - r * 0.18, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawLightShafts(ctx, now, pulse, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    const tint = mixWhite(moodTint('warm'), 0.3);
    ctx.translate(M.w * 0.78, -M.h * 0.08);
    ctx.rotate(-0.52 + Math.sin(now * 0.00005) * 0.025);
    for (let i = 0; i < 5; i++) {
      const spread = (i - 2) * 0.13 + Math.sin(now * 0.00008 + i) * 0.012;
      const far = Math.max(M.w, M.h) * 1.25;
      const g = ctx.createLinearGradient(0, 0, far, far * 0.12);
      g.addColorStop(0, rgba(tint, (0.1 + pulse * 0.05) * (1 - Math.abs(i - 2) * 0.16)));
      g.addColorStop(0.55, rgba(tint, 0.035));
      g.addColorStop(1, rgba(tint, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(far, far * (0.02 + spread));
      ctx.lineTo(far, far * (0.2 + spread));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCity(ctx, now, pulse, alpha, neon) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const ink = [6, 8, 14];
    const tint = neon ? moodTint('neon') : moodTint('rain');
    const horizon = M.h * 0.76;
    const g = ctx.createLinearGradient(0, horizon - M.h * 0.2, 0, M.h);
    g.addColorStop(0, rgba(ink, 0));
    g.addColorStop(0.35, rgba(ink, 0.55));
    g.addColorStop(1, rgba(ink, 0.9));
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon - M.h * 0.2, M.w, M.h - horizon + M.h * 0.2);
    const n = 26;
    for (let i = 0; i < n; i++) {
      const w = M.w / n * (0.5 + fumeHash(i * 13 + 3) * 0.9);
      const x = (i / n) * M.w - w * 0.1;
      const bh = M.h * (0.04 + fumeHash(i * 17 + 7) * 0.16);
      const y = horizon - bh;
      ctx.fillStyle = 'rgba(4,6,10,' + (0.72 + fumeHash(i * 19 + 2) * 0.2) + ')';
      ctx.fillRect(x, y, w, bh + M.h * 0.2);
      const cols = Math.max(1, Math.floor(w / 9));
      const rows = Math.max(1, Math.floor(bh / 12));
      for (let cx = 0; cx < cols; cx++) {
        for (let cy = 0; cy < rows; cy++) {
          if (fumeHash(i * 131 + cx * 17 + cy * 7) < 0.55) continue;
          const wx = x + 4 + cx * (w - 8) / cols;
          const wy = y + 5 + cy * (bh - 8) / rows;
          ctx.fillStyle = rgba(mixWhite(tint, 0.55), 0.3 + 0.34 * (0.5 + 0.5 * Math.sin(now * 0.001 + i + cy)));
          ctx.fillRect(wx, wy, 1.6, 2.2);
        }
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 14; i++) {
      const x = (i / 14 + 0.012) * M.w;
      const h = M.h * (0.05 + fumeHash(i * 23 + 5) * 0.12);
      const w = 2 + fumeHash(i * 29 + 1) * 9;
      const gg = ctx.createLinearGradient(0, horizon - h, 0, horizon);
      gg.addColorStop(0, rgba(tint, 0.02));
      gg.addColorStop(0.5, rgba(tint, 0.06 + pulse * 0.04));
      gg.addColorStop(1, rgba(tint, 0));
      ctx.fillStyle = gg;
      ctx.fillRect(x, horizon - h, w, h);
    }
    ctx.restore();
  }

  function drawRipples(ctx, now, pulse, alpha) {
    const F = M.fx;
    if (F.ripples.length < 8 && fumeHash(Math.floor(now / 420)) < 0.7) {
      F.ripples.push({ x: 0.08 + fumeHash(Math.floor(now / 420) * 7) * 0.84, y: 0.82 + fumeHash(Math.floor(now / 420) * 11) * 0.14, t0: now / 1000 });
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    const tint = moodTint('rain');
    for (let i = F.ripples.length - 1; i >= 0; i--) {
      const r = F.ripples[i];
      const age = now / 1000 - r.t0;
      if (age > 2.2) { F.ripples.splice(i, 1); continue; }
      const a = (1 - age / 2.2) * 0.22;
      const rr = (0.01 + age * 0.045) * M.w;
      ctx.strokeStyle = rgba(mixWhite(tint, 0.35), a);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(r.x * M.w, r.y * M.h, rr, rr * 0.28, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawInkScene(ctx, now, pulse, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const ink = M.aiInk || [10, 11, 14];
    const accent = M.aiPalette || M.rgb;
    const tints = [ink, mixWhite(ink, 0.35), accent];
    for (let i = 0; i < 4; i++) {
      const y = (0.18 + i * 0.19) * M.h;
      const ph = now * 0.00003 * (i + 1) + i * 1.7;
      ctx.strokeStyle = rgba(tints[i % 3], 0.08 + pulse * 0.03);
      ctx.lineWidth = 8 + i * 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-M.w * 0.08, y + Math.sin(ph) * M.h * 0.04);
      ctx.bezierCurveTo(M.w * 0.3, y - M.h * 0.08 + Math.sin(ph + 1) * M.h * 0.05,
        M.w * 0.7, y + M.h * 0.08 + Math.cos(ph) * M.h * 0.04, M.w * 1.08, y);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const x = (0.15 + i * 0.2 + Math.sin(now * 0.00005 + i) * 0.04) * M.w;
      const y = (0.25 + fumeHash(i * 31 + 3) * 0.5) * M.h;
      const r = M.w * (0.04 + fumeHash(i * 37 + 5) * 0.08);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(mixWhite(accent, 0.3), 0.035));
      g.addColorStop(1, rgba(accent, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  function drawPaperFx(ctx, now, pulse, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'multiply';
    const ink = M.aiInk || [23, 21, 18];
    for (let i = 0; i < 4; i++) {
      const x = (0.18 + i * 0.22 + Math.sin(now * 0.00004 + i) * 0.03) * M.w;
      const y = (0.24 + fumeHash(i * 41 + 2) * 0.6) * M.h;
      const r = M.w * (0.03 + fumeHash(i * 43 + 7) * 0.05);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(ink, 0.035 + pulse * 0.01));
      g.addColorStop(1, rgba(ink, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'lighter';
    const warm = mixWhite(M.aiPalette || M.rgb, 0.5);
    for (let i = 0; i < 24; i++) {
      const x = (fumeHash(i * 47 + 3) + Math.sin(now * 0.0002 + i) * 0.02) * M.w;
      const y = (fumeHash(i * 53 + 5) + Math.cos(now * 0.00017 + i) * 0.015) * M.h;
      const a = 0.04 + 0.06 * (0.5 + 0.5 * Math.sin(now * 0.001 + i));
      ctx.fillStyle = rgba(warm, a);
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + fumeHash(i * 59 + 1) * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSceneVeil(ctx, now, scene, alpha) {
    if (!M.glOn) return;
    const veils = {
      dream: [10, 6, 24, 0.38], night: [3, 4, 10, 0.32], rain: [4, 8, 12, 0.4],
      warm: [24, 10, 6, 0.28], neon: [5, 3, 12, 0.36], lineart: [3, 3, 4, 0.46],
      lumiere: [24, 10, 6, 0.24], hanabi: [4, 3, 10, 0.2]
    };
    const v = veils[scene];
    if (!v) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = rgba([v[0], v[1], v[2]], v[3]);
    ctx.fillRect(0, 0, M.w, M.h);
    const tint = M.aiPalette || M.rgb;
    const g = ctx.createRadialGradient(M.w * 0.5, M.h * 0.5, 0, M.w * 0.5, M.h * 0.5, M.w * 0.62);
    g.addColorStop(0, rgba(tint, 0.05));
    g.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, M.w, M.h);
    ctx.restore();
  }

  function drawLightning(ctx, now, pulse, alpha) {
    const F = M.fx;
    if (!F.lightning && now > F.nextLightning && (M.isChorus || F.beat > 0.6)) {
      const seed = Math.floor(now / 700);
      const rnd = n => fumeHash(seed * 13 + n * 7 + 1);
      let x = (0.18 + rnd(2) * 0.64) * M.w;
      let y = 0;
      const pts = [[x, y]];
      while (y < M.h * 0.58) {
        x += (rnd(pts.length + 3) - 0.5) * M.w * 0.08;
        y += M.h * (0.035 + rnd(pts.length + 5) * 0.055);
        pts.push([x, y]);
      }
      F.lightning = { t0: now / 1000, pts: pts };
      F.nextLightning = now + 3600 + rnd(8) * 4200;
    }
    if (!F.lightning) return;
    const age = now / 1000 - F.lightning.t0;
    if (age > 0.65) { F.lightning = null; return; }
    const a = (1 - age / 0.65);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(190,215,255,' + (a * 0.12) + ')';
    ctx.fillRect(0, 0, M.w, M.h);
    ctx.strokeStyle = 'rgba(235,245,255,' + (a * 0.9) + ')';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = 0; i < F.lightning.pts.length; i++) {
      const p = F.lightning.pts[i];
      if (i === 0) ctx.moveTo(p[0], p[1]);
      else ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(170,205,255,' + (a * 0.35) + ')';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.restore();
  }

  function drawStarfall(ctx, now, pulse, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    for (let i = 0; i < 80; i++) {
      const sp = 0.025 + fumeHash(i * 17 + 3) * 0.06;
      const x = ((fumeHash(i * 11 + 1) + now * 0.00001 * sp) % 1) * M.w;
      const y = ((fumeHash(i * 13 + 5) + now * 0.00003 * sp) % 1) * M.h;
      const len = 10 + fumeHash(i * 19 + 7) * 34;
      const a = 0.08 + fumeHash(i * 23 + 9) * 0.18;
      ctx.strokeStyle = 'rgba(205,225,245,' + a + ')';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - len * 0.22, y + len);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawLumiereBackdrop(ctx, now, pulse, alpha) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(2, 10, 9, .26)';
    ctx.fillRect(0, 0, M.w, M.h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    const tint = mixWhite(M.aiPalette || moodTint('warm'), 0.58);
    const cx = M.w * 0.52;
    const top = -M.h * 0.08;
    for (let i = 0; i < 3; i++) {
      const bx = cx + (i - 1) * M.w * 0.22;
      const spread = (i - 1) * 0.22 + Math.sin(now * 0.00006 + i) * 0.03;
      const far = Math.max(M.w, M.h) * 1.25;
      const g = ctx.createLinearGradient(bx, top, bx + far * spread, far);
      g.addColorStop(0, rgba(tint, 0.42 + pulse * 0.1));
      g.addColorStop(0.38, rgba(tint, 0.15));
      g.addColorStop(1, rgba(tint, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(bx - M.w * 0.045, top);
      ctx.lineTo(bx + M.w * 0.045, top);
      ctx.lineTo(bx + far * spread + M.w * 0.28, M.h);
      ctx.lineTo(bx + far * spread - M.w * 0.12, M.h);
      ctx.closePath();
      ctx.fill();
    }
    const pillar = ctx.createLinearGradient(cx, top, cx, M.h);
    pillar.addColorStop(0, rgba(mixWhite(tint, 0.55), 0.45 + pulse * 0.1));
    pillar.addColorStop(0.5, rgba(tint, 0.16));
    pillar.addColorStop(1, rgba(tint, 0));
    ctx.fillStyle = pillar;
    ctx.fillRect(cx - M.w * 0.055, top, M.w * 0.11, M.h * 1.1);
    // 细线构成：同心弧 + 十字引线，像 Folia Lumiere 的星图
    ctx.globalAlpha = alpha * 0.45;
    const lx = M.w * 0.56, ly = M.h * 0.44;
    ctx.strokeStyle = rgba(mixWhite(tint, 0.4), 0.5);
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 3; i++) {
      const rr = Math.min(M.w, M.h) * (0.16 + i * 0.075);
      const a0 = now * 0.00003 * (i + 1) + i * 1.7;
      ctx.beginPath();
      ctx.arc(lx, ly, rr, a0, a0 + Math.PI * 1.42);
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(mixWhite(tint, 0.5), 0.34);
    ctx.beginPath();
    ctx.moveTo(lx - M.w * 0.2, ly); ctx.lineTo(lx + M.w * 0.2, ly);
    ctx.moveTo(lx, ly - M.h * 0.25); ctx.lineTo(lx, ly + M.h * 0.25);
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.55;
    for (let i = 0; i < 9; i++) {
      const x = (fumeHash(i * 31 + 9) + Math.sin(now * 0.00003 + i) * 0.02) * M.w;
      const sp = 0.01 + fumeHash(i * 37 + 2) * 0.03;
      const y = ((fumeHash(i * 41 + 6) + now * 0.00002 * sp) % 1) * M.h;
      ctx.fillStyle = rgba(mixWhite(tint, 0.55), 0.15 + fumeHash(i * 43 + 4) * 0.18);
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + fumeHash(i * 47 + 8) * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSceneFx(ctx, now, dt, pulse, alpha) {
    if (!M.fx || !M.fx.fireflies.length) return;
    if (M.style === 'chat') return;
    if (M.tone === 'light' && M.aiTheme) { drawPaperFx(ctx, now, pulse, alpha); return; }
    const scene = M.mood;
    if (M.style !== 'hanabi' && scene !== 'cover') drawSceneVeil(ctx, now, scene, alpha);
    const F = M.fx;
    const wantBurst = scene === 'night' || scene === 'hanabi' || M.style === 'hanabi';
    if (M.style === 'hanabi') {
      ctx.save();
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = 'rgba(4,3,10,1)';
      ctx.fillRect(0, 0, M.w, M.h);
      ctx.restore();
    }
    if (wantBurst) {
      const chorus = F.energy > 0.28 || pulse > 0.34;
      const gap = (M.style === 'hanabi' ? 850 : (chorus ? 1100 : 3000)) * (M.aiAnim === 'intense' ? 0.72 : (M.aiAnim === 'subtle' ? 1.35 : 1)) / (M.isChorus ? 1.35 : 1);
      if (now - F.lastBurst > gap || (F.beat > 0.72 && now - F.lastBurst > 420)) spawnFirework(now);
      drawFireworks(ctx, now, pulse, alpha);
    }
    const boost = M.isChorus ? 1.25 : 1;
    if (scene === 'dream') {
      drawAurora(ctx, now, pulse, Math.min(1, alpha * boost));
      drawFog(ctx, now, pulse, Math.min(1, alpha * boost));
      drawFireflies(ctx, now, pulse, Math.min(1, alpha * boost));
    } else if (scene === 'rain') {
      drawCity(ctx, now, pulse, alpha, false);
      drawRipples(ctx, now, pulse, alpha);
      drawFog(ctx, now, pulse, alpha * 0.6);
      drawLightning(ctx, now, pulse, alpha);
    } else if (scene === 'warm' || scene === 'lumiere') {
      if (M.style !== 'cinema') drawLightShafts(ctx, now, pulse, Math.min(1, alpha * boost));
      drawBokeh(ctx, now, pulse, Math.min(1, alpha * boost * 0.7));
    } else if (scene === 'neon') {
      drawCity(ctx, now, pulse, alpha, true);
      drawLightShafts(ctx, now, pulse, alpha * 0.55);
    } else if (scene === 'lineart') {
      drawInkScene(ctx, now, pulse, alpha);
    } else if (scene === 'cover') {
      drawBokeh(ctx, now, pulse, alpha * 0.7);
    }
    if (M.style === 'cinema' && scene !== 'warm' && scene !== 'lumiere' && scene !== 'rain' && scene !== 'neon') {
      drawLightShafts(ctx, now, pulse, alpha * 0.7);
      drawBokeh(ctx, now, pulse, alpha * 0.5);
    }
    if (M.style === 'cinema') {
      drawLumiereBackdrop(ctx, now, pulse, alpha * 0.9);
      drawStarfall(ctx, now, pulse, alpha * 0.8);
      if (scene !== 'rain' && scene !== 'dream') drawFog(ctx, now, pulse, alpha * 0.45);
    }
    if (M.style === 'poem' && scene !== 'lineart') drawInkScene(ctx, now, pulse, alpha * 0.35);
    if (M.style === 'vertical' && scene !== 'lineart') {
      drawInkScene(ctx, now, pulse, alpha * 0.22);
      ctx.save();
      ctx.globalAlpha = alpha * 0.08;
      ctx.strokeStyle = '#e8f5ea';
      ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) {
        const x = ((now * 0.006 + i * 197) % 1.2 - 0.1) * ctx.canvas.width;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - 30, ctx.canvas.height); ctx.stroke();
      }
      ctx.restore();
    }
    if (M.style === 'cloud' && scene !== 'dream') drawAurora(ctx, now, pulse, alpha * 0.5);
    if (M.style === 'confess' && scene !== 'warm' && scene !== 'cover') drawBokeh(ctx, now, pulse, alpha * 0.35);
    if (M.style === 'fog') {
      if (scene !== 'dream' && scene !== 'rain') drawFog(ctx, now, pulse, alpha * 0.8);
      drawFireflies(ctx, now, pulse, alpha * 0.45);
    }
  }

  function drawPaper(ctx, now, dt, pulse, alpha) {
    const bg = M.aiBg || [239, 233, 220];
    const ink = M.aiInk || [23, 21, 18];
    const sec = M.aiSecondary || [107, 98, 88];
    const accent = M.aiPalette || M.rgb;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    const g = ctx.createLinearGradient(0, 0, M.w * 0.6, M.h);
    g.addColorStop(0, rgba(bg, 1));
    g.addColorStop(0.62, rgba(bg, 0.94));
    g.addColorStop(1, rgba(mixWhite(bg, 0.15), 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, M.w, M.h);

    ctx.globalCompositeOperation = 'multiply';
    const stains = [
      [0.18, 0.22, 0.55, 0.07, sec],
      [0.82, 0.3, 0.42, 0.05, accent],
      [0.52, 0.8, 0.5, 0.05, ink],
      [0.35, 0.62, 0.3, 0.04, sec]
    ];
    for (let i = 0; i < stains.length; i++) {
      const s = stains[i];
      const x = (s[0] + Math.sin(now * 0.00005 + i) * 0.05) * M.w;
      const y = (s[1] + Math.cos(now * 0.00006 + i) * 0.04) * M.h;
      const r = Math.max(M.w, M.h) * s[2];
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, rgba(s[4], s[3] + pulse * 0.015));
      rg.addColorStop(1, rgba(s[4], 0));
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, M.w, M.h);
    }
    if (M.coverArt && M.coverArt.lineInk) {
      const img = M.coverArt.lineInk;
      const sc = Math.max(M.w / img.width, M.h / img.height);
      const dw = img.width * sc;
      const dh = img.height * sc;
      ctx.globalAlpha = alpha * 0.2;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (M.w - dw) / 2, (M.h - dh) / 2, dw, dh);
    }
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = rgba(ink, 0.035);
    ctx.lineWidth = 1;
    for (let y = 60; y < M.h; y += 72) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(M.w, y + 0.5);
      ctx.stroke();
    }
    for (let i = 0; i < 44; i++) {
      const x = fumeHash(i * 11 + 1) * M.w;
      const y = fumeHash(i * 11 + 4) * M.h;
      const r = 0.5 + fumeHash(i * 11 + 7) * 1.4;
      ctx.fillStyle = rgba(ink, 0.1);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawMood(ctx, mood, now, dt, pulse, alpha) {
    if (alpha <= 0.001) return;
    if (M.tone === 'light' && M.aiTheme) {
      drawPaper(ctx, now, dt, pulse, alpha);
      return;
    }
    const rgb = moodTint(mood);
    if (mood === 'night') drawNight(ctx, now, dt, pulse, alpha, rgb);
    else if (mood === 'rain') drawRain(ctx, now, dt, pulse, alpha, rgb);
    else if (mood === 'warm') drawWarm(ctx, now, dt, pulse, alpha, rgb);
    else if (mood === 'neon') drawNeon(ctx, now, dt, pulse, alpha, rgb);
    else if (mood === 'cover') drawCover(ctx, now, dt, pulse, alpha, rgb);
    else if (mood === 'lineart') drawLineart(ctx, now, dt, pulse, alpha, rgb);
    else drawDream(ctx, now, dt, pulse, alpha, rgb);
  }

  function draw(now, dt) {
    if (!M.ctx || !M.w || !M.h) return;
    applyColor();
    const ctx = M.ctx;
    ensureFx();
    ctx.setTransform(M.dpr, 0, 0, M.dpr, 0, 0);
    ctx.clearRect(0, 0, M.w, M.h);

    let spec = null;
    try { spec = M.api.getSpectrum && M.api.getSpectrum(); } catch (e) {}
    const playing = !!(M.api.getPlaying && M.api.getPlaying());
    let level = 0;
    if (spec && spec.length && playing) {
      let sum = 0;
      let cnt = 0;
      const top = Math.min(spec.length, 12);
      for (let i = 1; i < top; i++) { sum += spec[i]; cnt++; }
      level = cnt ? sum / cnt / 255 : 0;
    }
    const nb = spec ? spec.length : 0;
    const bandAvg = (a, b) => {
      if (!nb) return 0;
      const i0 = Math.max(0, Math.floor(a * nb));
      const i1 = Math.max(i0 + 1, Math.floor(b * nb));
      let sum = 0, cnt = 0;
      for (let i = i0; i < i1 && i < nb; i++) { sum += spec[i]; cnt++; }
      return cnt ? sum / cnt / 255 : 0;
    };
    M.bands.bass = bandAvg(0, 0.02);
    M.bands.lowMid = bandAvg(0.02, 0.06);
    M.bands.mid = bandAvg(0.06, 0.16);
    M.bands.vocal = bandAvg(0.06, 0.3);
    M.bands.treble = bandAvg(0.3, 0.75);
    if (M.layer) M.layer.style.setProperty('--mv-vocal', M.bands.vocal.toFixed(3));
    M.bass += (level - M.bass) * (level > M.bass ? 0.28 : 0.07);
    const pulse = clamp(M.bass, 0, 1);
    const FX = M.fx;
    FX.energy += (level - FX.energy) * 0.12;
    const onset = level > FX.lastLevel + 0.035 && level > 0.08;
    FX.beat = Math.max(FX.beat * 0.86, onset ? 1 : 0);
    FX.lastLevel = level;
    const rgb = M.rgb;

    /* 镜头缓慢漂移：浮名幅度大一点，像手持镜头；流光/星屑只做呼吸感 */
    if (M.layer) {
      const camAmp = M.style === 'fume' ? 12 : 4;
      const camX = Math.sin(now * 0.00012) * camAmp + (pulse - 0.25) * (M.style === 'fume' ? 6 : 2);
      const camY = Math.cos(now * 0.00009) * camAmp * 0.55;
      const camS = 1 + Math.sin(now * 0.00007) * (M.style === 'fume' ? 0.006 : 0.002);
      M.layer.style.setProperty('--mv-cam-x', camX.toFixed(2) + 'px');
      M.layer.style.setProperty('--mv-cam-y', camY.toFixed(2) + 'px');
      M.layer.style.setProperty('--mv-cam-s', camS.toFixed(4));
      if (M.style === 'confess' && M.cur) M.cur.style.setProperty('--tilt-pulse', (1 + pulse * 0.06).toFixed(3));
    }

    const videoBg = !!(M.layer && M.layer.classList.contains('has-video'));
    const chatStyle = M.style === 'chat';
    let glOn = false;
    if (!videoBg && !chatStyle && !M.lowPower) {
      if (M.style === 'cinema') glOn = drawLumiereGL(now, dt, pulse);
      if (!glOn) glOn = drawGL(now, dt, pulse);
    }
    M.glOn = glOn;
    if (!glOn) {
      if (M.layer) M.layer.classList.remove('gl-on');
      if (!videoBg) {
        ensureBg();
        if (chatStyle) {
          // 对话样式固定用星夜/纸感背景，给气泡留干净的对比
          if (M.tone === 'light' && M.aiTheme) drawMood(ctx, 'night', now, dt, pulse, 1);
          else drawNight(ctx, now, dt, pulse, 1, moodTint('night'), true);
        } else {
          M.moodFade = Math.min(1, M.moodFade + dt * 2.4);
          if (M.moodPrev && M.moodPrev !== M.mood && M.moodFade < 1) {
            drawMood(ctx, M.moodPrev, now, dt, pulse, 1 - M.moodFade);
          } else if (M.moodPrev && M.moodFade >= 1) {
            M.moodPrev = null;
          }
          drawMood(ctx, M.mood, now, dt, pulse, M.moodPrev ? M.moodFade : 1);
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (!videoBg) drawSceneFx(ctx, now, dt, pulse, M.moodPrev ? M.moodFade : 1);

    if (M.style === 'diorama') drawDioramaBeams(ctx, now, pulse);

    if (M.style === 'fume') drawFumeMotif(ctx, now, pulse);

    if (spec && spec.length && playing) {
      const n = 64;
      const grad = ctx.createLinearGradient(0, M.h, 0, M.h * 0.55);
      grad.addColorStop(0, rgba(rgb, 0.30));
      grad.addColorStop(1, rgba(rgb, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, M.h);
      for (let i = 0; i < n; i++) {
        const bin = Math.min(spec.length - 1, Math.floor(Math.pow(i / n, 1.5) * spec.length * 0.6));
        const v = spec[bin] / 255;
        ctx.lineTo((i / (n - 1)) * M.w, M.h - v * M.h * 0.22);
      }
      ctx.lineTo(M.w, M.h);
      ctx.closePath();
      ctx.fill();
    }

    const hg = ctx.createRadialGradient(M.w / 2, M.h * 1.02, 0, M.w / 2, M.h * 1.02, Math.max(M.w * 0.55, 240));
    hg.addColorStop(0, rgba(rgb, 0.09 + pulse * 0.09));
    hg.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = hg;
    ctx.fillRect(0, M.h * 0.55, M.w, M.h * 0.45);

    ctx.globalCompositeOperation = 'source-over';
  }

  function checkStyleHealth(now) {
    if (M.style !== 'fume' && M.style !== 'diorama') { M.healthFail = 0; return; }
    if (now - M.healthAt < 900) return;
    M.healthAt = now;
    let lines = [];
    try { lines = (M.api && M.api.getLines && M.api.getLines()) || []; } catch (e) {}
    if (!M.api || M.idx < 0 || !lines[M.idx]) { M.healthFail = 0; return; }
    let t = 0;
    try { t = Number(M.api.getTime()) || 0; } catch (e) {}
    if (t < Number(lines[M.idx].t || 0) + 1.6) { M.healthFail = 0; return; }
    let ok = false;
    if (M.style === 'fume') {
      ok = !!(M.fume && ((M.fume.layout && M.fume.layout.length) || (M.fume.byLine && M.fume.byLine.length))) || !!(M.cur && M.cur.textContent.trim());
    } else {
      ok = !!(M.cur && M.cur.textContent.trim()) || !!(M.words && M.words.length);
    }
    if (ok) { M.healthFail = 0; return; }
    M.healthFail++;
    if (M.healthFail >= 3) {
      M.healthFail = 0;
      const old = M.style;
      setStyle('flow');
      try { window.dispatchEvent(new CustomEvent('bp-style-fallback', { detail: { style: old } })); } catch (e) {}
    }
  }

  function perfSample(now) {
    if (!M.perfStart) { M.perfStart = now; M.perfAt = now; M.perfFrames = M.frames; return; }
    if (document.hidden) { M.perfAt = now; M.perfFrames = M.frames; M.perfLow = 0; return; }
    if (now - M.perfStart < 8000 || now - M.perfAt < 2000) return;
    const fps = (M.frames - M.perfFrames) * 1000 / Math.max(1, now - M.perfAt);
    M.perfAt = now;
    M.perfFrames = M.frames;
    if (fps < 26) M.perfLow++; else M.perfLow = 0;
    if (M.perfLow >= 3 && !M.perfFired && !M.lowPower) {
      M.perfFired = true;
      try { window.dispatchEvent(new CustomEvent('bp-low-fps', { detail: { fps } })); } catch (e) {}
    }
  }

  function loop(ts) {
    if (!M.running) return;
    M.raf = requestAnimationFrame(loop);
    M.frames++;
    perfSample(ts || performance.now());
    if (document.hidden) return;
    if (!M.layer || !M.layer.isConnected) return;
    const now = ts || performance.now();
    const dt = M.lastTs ? clamp((now - M.lastTs) / 1000, 0.001, 0.06) : 0.016;
    M.lastTs = now;
    resize(false);
    tickLyrics(now);
    checkStyleHealth(now);
    if (now - M.lastPaint < 30) return;
    M.lastPaint = now;
    draw(now, dt);
    if (M.style === 'flow') drawVine(now); else clearVine();
  }

  function applyTuneVars() {
    if (!M.layer) return;
    M.layer.style.setProperty('--v-wait', String(M.tune.vWait));
    M.layer.style.setProperty('--v-wait-blur', ((1 - Number(M.tune.vWait)) * 4).toFixed(2) + 'px');
    M.layer.style.setProperty('--v-gap', Math.round(Number(M.tune.vGap) || 26) + 'px');
    M.layer.classList.toggle('mv-flow-preview', !!M.tune.flowPreview);
  }

  function setLowPower(on) {
    M.lowPower = !!on;
    resize(true);
    ensureParticles(true);
    if (M.lowPower) clearVine();
  }

  function setTune(t) {
    if (!t) return;
    const old = M.tune;
    M.tune = Object.assign({}, old, t);
    applyTuneVars();
    if (M.style === 'vertical' && M.idx >= 0 && Number(old.vCols) !== Number(M.tune.vCols)) {
      const lines = (M.api && M.api.getLines && M.api.getLines()) || [];
      if (lines[M.idx]) buildFlowLine(lines, M.idx, true);
    }
    if (M.style === 'flow') {
      const keep = Math.max(0, Math.min(3, Number(M.tune.flowKeep) || 0));
      while (M.vineSnaps.length > keep) M.vineSnaps.shift();
    }
  }

  function setStyle(style) {
    M.style = STYLES[style] ? style : 'flow';
    if (M.layer) M.layer.setAttribute('data-style', M.style);
    M.idx = -2;
    M.mode = '';
    M.chars = [];
    M.words = [];
    M.vineSnaps = [];
    M.vineLast = null;
    if (M.style !== 'flow' && M.vctx) M.vctx.clearRect(0, 0, M.w, M.h);
    M.fume.idx = -2;
    M.lastParaEntry = -1;
    if (M.cur) { M.cur.style.transform = ''; M.cur.style.justifyContent = ''; }
    applyTuneVars();
    if (M.chat.box) {
      M.chat.box.innerHTML = '';
      M.chat.rows = [];
      M.chat.map.clear();
      M.chat.idx = -2;
      M.chat.sides = null;
      M.chat.linesRef = null;
    }
    if (M.style !== 'flow' && M.style !== 'diorama' && M.style !== 'cinema' && M.style !== 'hanabi' && M.style !== 'vertical' && M.style !== 'poem' && M.style !== 'cloud' && M.style !== 'confess' && M.style !== 'fog') resetFlowCam();
    ensureParticles(true);
  }

  function bind(api) {
    M.api = api || M.api;
    M.layer = (api && api.layer) || document.getElementById('mv-layer');
    M.canvas = document.getElementById('mv-bg');
    M.ctx = M.canvas ? M.canvas.getContext('2d') : null;
    M.prev = document.getElementById('mv-prev');
    M.cur = document.getElementById('mv-cur');
    M.vine = document.getElementById('mv-vine');
    if (M.vine) M.vctx = M.vine.getContext('2d');
    M.next = document.getElementById('mv-next');
    M.chat.box = document.getElementById('mv-chat');
    M.fxEl = document.getElementById('mv-fx');
    if (M.chat.box) M.chat.box.innerHTML = '';
    M.chat.rows = [];
    M.chat.map = new Map();
    M.chat.idx = -2;
    M.chat.key = '';
    M.lastParaEntry = -1;
    M.paragraphs = null;
    M.paraOf = null;
    M.paraKind = null;
    M.paraStart = null;
    M.chat.sides = null;
    M.chat.linesRef = null;
    M.bpmInfo = (M.api && M.api.getBpm && M.api.getBpm()) || null;
    M.title = document.getElementById('mv-title');
    M.artist = document.getElementById('mv-artist');
    if (M.scroll && M.scroll.box !== document.getElementById('mv-scroll')) {
      try { M.scroll.dom.destroy(); } catch (e) {}
      M.scroll = null;
    }
    M.idx = -2;
    M.mode = '';
    M.linesRef = null;
    M.chars = [];
    M.color = '';
    M.palette = null;
    M.paletteKey = '';
    M.paletteBusy = '';
    M.fume = { world: null, layout: [], byLine: [], els: [], sel: null, idx: -2, linesRef: null, lastW: 0, lastH: 0, cam: null };
    if (M.layer) M.layer.classList.remove('fume-world-ready');
    M.coverArt = null;
    M.moodPrev = null;
    M.moodFade = 1;
    M.moodManual = (M.api && M.api.getMoodOverride && M.api.getMoodOverride()) || 'auto';
    M.aiTheme = null;
    M.aiPalette = null;
    M.aiKey = '';
    M.tone = (M.api && M.api.getTone && M.api.getTone()) || 'dark';
    if (M.layer) {
      M.layer.setAttribute('data-mood', M.mood);
      M.layer.setAttribute('data-tone', 'dark');
      M.layer.removeAttribute('data-ai');
    }
    if (M.moodManual !== 'auto') applyMood(M.moodManual);
    const at = M.api && M.api.getAiTheme && M.api.getAiTheme();
    if (at && at.theme) setAiTheme(at.theme, at.key);
    M.lastMetaAt = 0;
    if (M.prev) M.prev.textContent = '';
    if (M.next) M.next.textContent = '';
    if (M.cur) M.cur.textContent = '';
    updateMeta();
    applyColor();
    resize(true);
    setStyle((api && api.getStyle && api.getStyle()) || M.style);
    initGL();
  }

  function start() {
    if (M.running) return;
    M.running = true;
    M.perfStart = 0;
    M.perfAt = 0;
    M.perfFrames = M.frames;
    M.perfLow = 0;
    M.perfFired = false;
    M.lastTs = 0;
    M.lastPaint = 0;
    M.raf = requestAnimationFrame(loop);
  }

  function stop() {
    M.running = false;
    if (M.raf) {
      cancelAnimationFrame(M.raf);
      M.raf = 0;
    }
    if (M.scroll && M.scroll.base) {
      try { M.scroll.base.pause(); } catch (e) {}
    }
  }

  window.LyricMV = {
    bind: bind,
    start: start,
    stop: stop,
    resize: () => resize(true),
    setStyle: setStyle,
    setTune: setTune,
    setLowPower: setLowPower,
    setMoodManual: setMoodManual,
    setAiTheme: setAiTheme,
    setTone: setTone,
    setBpm: (info) => {
      M.bpmInfo = info && info.bpm ? info : null;
      if (!M.api) return;
      const lines = M.api.getLines() || [];
      if (M.style === 'chat') {
        const C = M.chat;
        if (C.idx >= 0) {
          for (const row of C.rows) {
            row.charStarts = chatCharStarts(lines[row.li], lines[row.li + 1], row.li);
            row.lit = -1;
          }
          updateChatRows(lines, C.idx, Number(M.api.getTime()) || 0);
        }
      } else if (M.idx >= 0 && M.idx < lines.length) {
        buildFlowLine(lines, M.idx, true);
      }
    },
    initGL: initGL,
    /* AI 分词到位后原地重建当前句（不留残影、不改变播放时间） */
    refreshLine: () => {
      if (!M.api) return;
      const lines = M.api.getLines() || [];
      if (M.idx < 0 || M.idx >= lines.length) return;
      if (M.style === 'flow' || M.style === 'diorama' || M.style === 'cinema' || M.style === 'hanabi' || M.style === 'vertical' || M.style === 'poem' || M.style === 'cloud' || M.style === 'confess' || M.style === 'fog') {
        buildFlowLine(lines, M.idx, true);
      } else if (M.style === 'fume') {
        const F = M.fume;
        if (F.byLine && F.idx >= 0) {
          undecorateFumeLine();
          decorateFumeLine(F.idx);
        }
      } else if (M.style === 'chat') {
        const C = M.chat;
        if (C.idx >= 0) {
          for (const row of C.rows) {
            row.charStarts = chatCharStarts(lines[row.li], lines[row.li + 1], row.li);
            row.lit = -1;
          }
          updateChatRows(lines, C.idx, Number(M.api.getTime()) || 0);
        }
      }
    },
    /* 调试/自动化用：页面被浏览器后台节流时手动推进一帧 */
    step: () => {
      const now = performance.now();
      M.frames++;
      if (M.api) {
        resize(false);
        tickLyrics(now);
        draw(now, 0.016);
      }
    },
    debug: () => ({
      running: M.running, frames: M.frames, idx: M.idx, chars: M.chars.length,
      segments: M.api && M.api.getSegments ? ((M.api.getSegments() || []).length) : 0,
      w: M.w, h: M.h, style: M.style, hidden: document.hidden,
      palette: M.palette ? { accent: M.palette.accent.join(','), light: M.palette.light.join(','), stats: M.palette.stats } : null,
      paletteKey: M.paletteKey,
      mood: M.mood,
      moodManual: M.moodManual,
      moodPrev: M.moodPrev,
      coverArt: !!M.coverArt,
      ai: M.aiTheme ? {
        name: M.aiTheme.name,
        mood: M.aiTheme.mood,
        accent: (aiToneTheme() && aiToneTheme().accentColor) || (M.aiTheme.palette && (M.aiTheme.palette.accentColor || M.aiTheme.palette.accent)) || ''
      } : null,
      tone: M.tone,
      fontStyle: M.layer ? M.layer.dataset.font : null,
      animationIntensity: M.aiAnim,
      gl: M.gl.ready ? 'on' : (M.gl.failed ? 'failed' : 'off'),
      chorus: M.isChorus,
      wordStarts: M.words ? M.words.slice(0, 10).map(w => +w.start.toFixed(2)) : [],
      bands: M.bands,
      para: M.paraKind && M.paraOf && M.idx >= 0 ? M.paraKind[M.paraOf[M.idx]] : '',
      shot: M.cur ? { dx: M.cur.style.getPropertyValue('--shot-dx'), dy: M.cur.style.getPropertyValue('--shot-dy'), s: M.cur.style.getPropertyValue('--shot-s'), r: M.cur.style.getPropertyValue('--shot-r') } : null,
      bpm: M.bpmInfo ? { bpm: M.bpmInfo.bpm, phase: +(Number(M.bpmInfo.phase) || 0).toFixed(2), confidence: M.bpmInfo.confidence } : null,
      fx: { bursts: M.fx ? M.fx.fireworks.length : 0, energy: M.fx ? +M.fx.energy.toFixed(2) : 0, beat: M.fx ? +M.fx.beat.toFixed(2) : 0, info: M.fx ? M.fx.fireworks.map(b => ({ type: b.type, age: +(performance.now()/1000-b.t0).toFixed(2), flight: +(b.flight||0).toFixed(2), n: b.parts.length })) : [] },
      glErr: M.gl.err || '',
      lum: M.gl.lumProg ? 'on' : 'off',
      lumErr: M.gl.lumErr || '',
      glLostAfter: !!M.gl.lostAfter,
      glTried: glTried,
      glStage: M.gl.stage || '',
      scroll: !!(M.scroll && M.scroll.base),
      scrollMode: !!(M.layer && M.layer.classList.contains('scroll-mode')),
      scrollCfg: (() => {
        if (!M.scroll) return null;
        try {
          const c = M.scroll.dom.config.current.line.normal;
          return { use: c.main.use, emph: c.main.syllable.word.animation.emphasize.enabled, emphCfg: c.main.syllable.word.animation.emphasize, float: c.main.syllable.word.animation.float.enabled, timing: M.scroll.base.currentInfo && M.scroll.base.currentInfo.timing };
        } catch (e) { return 'err'; }
      })(),
      fume: { idx: M.fume.idx, lines: M.fume.layout.length, ready: !!(M.layer && M.layer.classList.contains('fume-world-ready')) }
    })
  };
})();
