/* Folia 原版绘光 runtime 桥：只在纯自用构建中使用，资源位于 /vendor/folia */
(function () {
  let cfg = null;
  let mod = null;
  let rt = null;
  let host = null;
  let timer = 0;
  let building = false;
  let buildKey = '';
  let paused = null;
  let failAt = 0;
  let failKey = '';
  let builtLinesRef = null;
  let lastChorus = false;
  let lowPower = false;
  let lastInstrumental = null;
  let pvFrame = null,
      pvReady = false,
      pvInitSent = false,
      pvLastTime = -1,
      pvFailTimer = 0;
  let reactCore = null;
  let domRoot = null;
  let domTime = null;
  let domPower = null;
  let domBands = null;
  let domComp = null;
  let domLines = null;
  let domOrigLines = null;
  let domLine = -2;
  let domStyle = '';
  let domShadow = null;
  let domMount = null;
  let domTrack = null;
  let verifyTimer = 0;
  let lastError = null;
  const failedStyles = new Set();

  const audio = { power: 0, bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0 };
  const mvPower = { get: () => audio.power };
  const mvBands = {
    bass: { get: () => audio.bass },
    lowMid: { get: () => audio.lowMid },
    mid: { get: () => audio.mid },
    vocal: { get: () => audio.vocal },
    treble: { get: () => audio.treble },
    spectrum: { get: () => new Uint8Array(64) }
  };
  const currentTime = { v: 0, get() { return this.v; } };
  const TUNING = {
    lightIntensity: 1, audioResponse: 1, fogDensity: 1, darkField: 1,
    moteAmount: 1, bloom: 0.55, textBloom: 0.45, unlitOpacity: 1,
    windowNeighbors: 0, decay: 1, echo: 1, fogOctaves: 4, lineArt: 1,
    frontBokeh: 1, trails: 1, hideTrails: false, overlayFrame: true,
    textOnly: false, keywordColors: true, themeIcons: false,
    themeColorMix: 1, renderQuality: 'full'
  };

  const SONNET_TUNING = {
    cameraIntensity: 1, typographyMotion: 1, mgDensity: 1,
    showOnlyText: false, showGuide: true, showBackgroundMg: true, showFixedGeo: true,
    showGiantDecorativeText: true, showBackgroundDecor: true, enableTransitions: true,
    outerFrameMode: 'full', textureResolution: 1,
    postProcessEnabled: true, postProcessGrain: 0.12, postProcessContrast: 0.1,
    postProcessRgbShift: 0.05, postProcessHalftone: 0, postProcessVignette: 0.2,
    postProcessLensDistortion: 0, postProcessLensDispersion: 0,
    render: { scale: 1, antialias: true, adaptive: true }
  };
  const TEMPERA_TUNING = {
    cameraIntensity: 1, glyphMotion: 1, wholeLineLyrics: false, glyphSettleStretch: 0.5,
    depthOfField: 1, depthPan: 1, glyphDepth: 1, colorMode: 'duo', textInversion: false,
    layerImages: [], layerImageDepth: 'back', layerImageFrequency: 0.2,
    showBlocks: true, showDecor: true, showCornerMarks: true, enableTransitions: true,
    textureResolution: 1, postProcessEnabled: true, postProcessTextureCompression: false,
    postProcessGrain: 0.1, postProcessContrast: 0.1, postProcessRgbShift: 0, postProcessVignette: 0.2,
    postProcessLensDistortion: 0, render: { scale: 1, antialias: true, adaptive: true }
  };
  const RUNTIMES = {
    lumiere: { entry: '/vendor/folia/lumiere-entry.js', runtime: 'LumierePixiRuntime', builder: 'buildLumiereProgram', tuning: TUNING },
    hanabi: { entry: '/vendor/folia/hanabi-entry.js', runtime: 'HanabiPixiRuntime', builder: 'buildHanabiProgram', tuning: { colorMode: 'theme', sparkAmount: 1, ornamentAmount: 1, textMotion: 1, blockOpacity: 1, riseSpeed: 1, spin: 1, ambient: 1, glow: 1, bloom: 0.6, chorusBloom: 1, launches: true, overlayFrame: true, textOnly: false, sky: 1, collage: 1, render: { scale: 1, antialias: true, adaptive: true } } },
    poem: { entry: '/vendor/folia/sonnet-entry.js', runtime: 'SonnetPixiRuntime', builder: 'buildSonnetProgram', tuning: SONNET_TUNING, flat: true },
    tempera: { entry: '/vendor/folia/tempera-entry.js', runtime: 'TemperaPixiRuntime', builder: 'buildTemperaProgram', tuning: TEMPERA_TUNING, flat: true }
  };
  const DOM_RUNTIMES = {
    confess: { entry: '/vendor/folia/assets/VisualizerTilt-DllvpBbl.js' },
    cloud: { entry: '/vendor/folia/assets/VisualizerPartita-6owcZPhh.js' },
    fog: { entry: '/vendor/folia/assets/VisualizerNebbia-DbFp6nBq.js' },
    ring: { entry: '/vendor/folia/assets/VisualizerCladdagh-DICuO-Ko.js' },
    cadenza: { entry: '/vendor/folia/assets/VisualizerCadenza-UZ2ig0A-.js' },
    chat: { entry: '/vendor/folia/assets/VisualizerCappella-C1AWTMIg.js' },
    cinema: { entry: '/vendor/folia/assets/VisualizerStill-t4dQW3hB.js' },
    monet: { entry: '/vendor/folia/assets/VisualizerMonet-CAUKUgpS.js' }
  };
  const PV_STYLES = { pvharu: { template: 17, maxChars: 8 }, pvcyber: { template: 3, maxChars: 9 }, pvweb: { template: 9, maxChars: 12 } };
  const mods = {};

  function getHost() {
    host = (cfg && cfg.getHost && cfg.getHost()) || document.getElementById('mv-folia-lumiere');
    return host;
  }

  function stopRuntime() {
    if (pvFailTimer) { clearTimeout(pvFailTimer); pvFailTimer = 0; }
    if (pvFrame) { try { pvFrame.remove(); } catch (e) {} pvFrame = null; }
    pvReady = false; pvInitSent = false; pvLastTime = -1;
    if (verifyTimer) { clearTimeout(verifyTimer); verifyTimer = 0; }
    if (rt) {
      try { rt.destroy(); } catch (e) {}
      rt = null;
    }
    if (domRoot) {
      try { domRoot.unmount(); } catch (e) {}
      domRoot = null;
    }
    domTime = domPower = domBands = null;
    domComp = domLines = domOrigLines = null;
    domTrack = null;
    builtLinesRef = null;
    lastChorus = false;
    setInstrumental(false);
    lastInstrumental = null;
    domLine = -2;
    domStyle = '';
    domShadow = null;
    domMount = null;
    const h = getHost();
    if (h) {
      h.innerHTML = '';
      if (h.shadowRoot) h.shadowRoot.innerHTML = '';
    }
    buildKey = '';
    paused = null;
  }

  function makeTheme(theme) {
    const th = (theme && theme.theme) || {};
    const tone = (cfg && cfg.getTone && cfg.getTone()) === 'light' ? 'light' : 'dark';
    const t = th[tone] || th.dark || th.light || {};
    return {
      name: t.name || 'Bili Folia',
      primaryColor: t.primaryColor || '#effff7',
      secondaryColor: t.secondaryColor || '#91b8a7',
      accentColor: t.accentColor || '#9fe0c2',
      backgroundColor: t.backgroundColor || '#07110d',
      textColor: t.primaryColor || '#effff7',
      fontStyle: t.fontStyle === 'sans' ? 'sans' : 'serif',
      animationIntensity: (() => {
        const v = String(t.animationIntensity || 'normal').toLowerCase();
        return v === 'calm' || v === 'soft' || v === 'subtle' ? 'calm' : (v === 'intense' || v === 'energetic' || v === 'high' ? 'intense' : 'normal');
      })(),
      fontFamily: t.fontStyle === 'sans' ? 'Microsoft YaHei' : 'Noto Serif SC',
      fontWeight: 400,
      description: t.description || '',
      lyricsIcons: [],
      wordColors: Array.isArray(t.wordColors) ? t.wordColors : []
    };
  }

  function buildLines(lines, segments) {
    const freq = new Map();
    const norm = s => String(s || '').toLowerCase().replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()《》〈〉【】\[\]…—–\-~～]/g, '');
    lines.forEach(l => {
      const k = norm(l.text);
      if (k.length >= 2) freq.set(k, (freq.get(k) || 0) + 1);
    });
    return lines.map((l, i) => {
      const start = Number(l.t) || 0;
      let end = Number(l.end) || (lines[i + 1] ? Number(lines[i + 1].t) : start + 5);
      if (!(end > start)) end = start + 5;
      const text = String(l.text || '');
      /* 多源歌词已经给了真实逐词时间就直接用；没有才按分词/字数插值 */
      const real = Array.isArray(l.words)
        ? l.words.filter(w => w && w.text && isFinite(w.t) && isFinite(w.end) && w.end > w.t)
        : null;
      let words = null;
      if (real && real.length) {
        words = real.map(w => ({
          text: String(w.text),
          startTime: Math.max(start, Math.min(end, Number(w.t))),
          endTime: Math.max(start, Math.min(end, Number(w.end)))
        })).filter(w => w.endTime > w.startTime);
      }
      if (!words || !words.length) {
        let parts = segments && Array.isArray(segments[i]) && segments[i].length ? segments[i] : null;
        if (!parts) {
          if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            try {
              const seg = new Intl.Segmenter(undefined, { granularity: 'word' });
              const raw = [];
              for (const p of seg.segment(text)) {
                const s = p.segment;
                if (!s) continue;
                if (/^\s+$/.test(s)) { if (raw.length) raw[raw.length - 1] += s; }
                else raw.push(s);
              }
              parts = raw.length ? raw : Array.from(text);
            } catch (e) { parts = Array.from(text); }
          } else parts = Array.from(text);
        }
        let total = 0;
        for (const p of parts) total += Array.from(p).length;
        if (!total) total = 1;
        const span = Math.max(0.3, end - start);
        let acc = start;
        words = parts.map(p => {
          const dur = span * Array.from(p).length / total;
          const w = { text: p, startTime: acc, endTime: acc + dur };
          acc += dur;
          return w;
        });
      }
      const k = norm(text);
      const chorus = k.length >= 2 && (freq.get(k) || 0) >= 2;
      return {
        startTime: start,
        endTime: end,
        fullText: text,
        translation: l.translation || '',
        romanization: l.romanization || '',
        words: words,
        isChorus: chorus,
        songPart: chorus ? 'chorus' : 'verse'
      };
    });
  }

  function updateAudio() {
    let spec = null;
    try { spec = cfg && cfg.getSpectrum && cfg.getSpectrum(); } catch (e) {}
    if (!spec || !spec.length) {
      audio.power *= 0.9; audio.bass *= 0.9; audio.lowMid *= 0.9;
      audio.mid *= 0.9; audio.vocal *= 0.9; audio.treble *= 0.9;
      return;
    }
    const nb = spec.length;
    const avg = (a, b) => {
      const i0 = Math.max(0, Math.floor(a * nb));
      const i1 = Math.max(i0 + 1, Math.floor(b * nb));
      let s = 0, c = 0;
      for (let i = i0; i < i1 && i < nb; i++) { s += spec[i]; c++; }
      return c ? s / c / 255 : 0;
    };
    audio.bass = avg(0, 0.02);
    audio.lowMid = avg(0.02, 0.06);
    audio.mid = avg(0.06, 0.16);
    audio.vocal = avg(0.06, 0.3);
    audio.treble = avg(0.3, 0.75);
    audio.power = (audio.bass * 0.35 + audio.lowMid * 0.25 + audio.mid * 0.25 + audio.vocal * 0.15);
  }

  function setLowPower(on) {
    on = !!on;
    if (on === lowPower) return;
    lowPower = on;
    if (active()) buildKey = '';
  }

  function active() {
    if (!cfg || !cfg.getStyle || !cfg.isMVOn || !cfg.isMVOn()) return false;
    const style = cfg.getStyle();
    return !!(RUNTIMES[style] || DOM_RUNTIMES[style] || PV_STYLES[style]);
  }

  function lineIndexAt(lines, t) {
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (Number(lines[i].t) <= t + 0.05) idx = i;
      else break;
    }
    return idx;
  }

  async function ensureReact() {
    if (reactCore) return reactCore;
    const m = await import('/vendor/folia/assets/noLyricLines-Dn3DI4dd.js');
    if (window.__FoliaReactClientFactory) window.__FoliaReactClientFactory();
    if (typeof window.__FoliaCreateRoot !== 'function') throw new Error('Folia ReactDOM client unavailable');
    const jsxr = m.do();
    reactCore = { createRoot: window.__FoliaCreateRoot, jsx: jsxr.jsx, motionValue: m.Xa };
    return reactCore;
  }

  function subtitleMode(lines) {
    const hasT = (lines || []).some(l => l && l.translation);
    const hasR = (lines || []).some(l => l && l.romanization);
    if (hasT && hasR) return 'both';
    if (hasT) return 'translation';
    if (hasR) return 'romanization';
    return 'translation';
  }

  function domProps(idx, th) {
    const light = (cfg.getTone && cfg.getTone()) === 'light';
    const subMode = subtitleMode(domLines);
    return {
      currentTime: domTime,
      currentLineIndex: idx,
      seed: 'bilimusic-' + domStyle,
      songTitle: (domTrack && domTrack.title) || '',
      songArtist: (domTrack && domTrack.up) || '',
      paused: false,
      isPreviewMode: false,
      isDaylight: light,
      lines: domLines,
      theme: th,
      audioPower: domPower,
      audioBands: domBands,
      showText: true,
      staticMode: false,
      lyricsFontScale: (() => { const w = (getHost() && getHost().clientWidth) || 1000; return Math.max(0.6, Math.min(0.88, (w / Math.max(1, window.innerWidth)) * 0.85)); })(),
      subtitleTheme: th,
      subtitleFontScale: 1,
      subtitleOverlayOpacity: 0,
      subtitleOverlayBackground: 'transparent',
      subtitleUpcomingLyricsBlur: false,
      isPlayerChromeHidden: true,
      hideTranslationSubtitle: true,
      showSubtitleTranslation: false,
      subtitleContentMode: 'none',
      subtitleOverlayLayout: 'bottom',
      sharedProps: {
        isDaylight: light,
        paused: false,
        staticMode: false,
        isPreviewMode: false,
        isPlayerChromeHidden: true,
        hideTranslationSubtitle: true,
        showSubtitleTranslation: false,
        subtitleContentMode: 'none',
        visualizerOpacity: 1
      }
    };
  }

  function renderDom(idx, th) {
    if (!domRoot || !domComp) return;
    domRoot.render(reactCore.jsx(domComp, domProps(idx, th)));
  }

  async function buildDom(style, rc, h, track, lines, th, builtLines) {
    const core = await ensureReact();
    if (!domComp || domStyle !== style || mods[style] !== domComp) {
      const mod = await import(rc.entry);
      domComp = mod.default;
      mods[style] = domComp;
    } else {
      domComp = mods[style];
    }
    const shell = document.createElement('div');
    shell.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    h.appendChild(shell);
    domShadow = shell.attachShadow({ mode: 'open' });
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/vendor/folia/assets/src-U7FXIZ6e.css';
    domShadow.appendChild(link);
    const styleEl = document.createElement('style');
    styleEl.textContent = ':host{display:block;width:100%;height:100%}';
    domShadow.appendChild(styleEl);
    domMount = document.createElement('div');
    domMount.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden';
    domShadow.appendChild(domMount);
    domLines = builtLines;
    domOrigLines = lines;
    domTrack = track;
    domStyle = style;
    const t = Number(cfg.getTime && cfg.getTime()) || 0;
    domTime = core.motionValue(t);
    domPower = core.motionValue(audio.power);
    domBands = {
      bass: core.motionValue(audio.bass),
      lowMid: core.motionValue(audio.lowMid),
      mid: core.motionValue(audio.mid),
      vocal: core.motionValue(audio.vocal),
      treble: core.motionValue(audio.treble)
    };
    domLine = lineIndexAt(lines, t);
    domRoot = core.createRoot(domMount);
    renderDom(domLine, th);
  }

  function setInstrumental(on) {
    const el = document.getElementById('mv-instrumental');
    if (el) el.classList.toggle('show', !!on);
  }

  function noteRuntimeError(style, err, source) {
    if (!style || failedStyles.has(style)) return;
    const msg = String((err && (err.message || err.reason || err)) || 'runtime error').slice(0, 240);
    lastError = { style, source: source || 'runtime', message: msg, at: Date.now() };
    try { if (cfg && cfg.onRuntimeError) cfg.onRuntimeError(lastError); } catch (e) {}
    failStyle(style, lastError);
  }

  function failStyle(style, reason) {
    if (!style || failedStyles.has(style)) return;
    failedStyles.add(style);
    stopRuntime();
    try {
      if (cfg && cfg.onFailure) cfg.onFailure(style, reason || null);
    } catch (e) {}
  }

  function verifyStyle(style, lines) {
    if (verifyTimer) clearTimeout(verifyTimer);
    verifyTimer = setTimeout(() => {
      verifyTimer = 0;
      if (!rt && !domRoot) return;
      let t = 0;
      try { t = Number(cfg.getTime && cfg.getTime()) || 0; } catch (e) {}
      if (lineIndexAt(lines, t) < 0) return; // 间奏/前奏不判失败
      let ok = false;
      if (domRoot && domShadow) {
        // React 挂载成功即视为可用；像 Cadenza 这类模式在句间可能暂时没有文字，
        // 不能因为某一帧没有文本就误判失败。云阶额外检查是否有实际歌词文本，
        // 避免 Partita 只挂背景、正文为空时呈现黑屏。
        const cv = style === 'fog' ? domShadow.querySelector('canvas') : null;
        ok = !!(domMount && domMount.childElementCount > 0) || !!(cv && cv.width > 2 && cv.height > 2);
        if (ok && style === 'cloud') {
          const bad = new Set(['STYLE', 'LINK', 'SCRIPT']);
          let txt = '';
          for (const el of domShadow.querySelectorAll('*')) {
            if (bad.has(el.tagName) || el.children.length) continue;
            const s = (el.textContent || '').trim();
            if (s) { txt += s; if (txt.length > 4) break; }
          }
          const li = lineIndexAt(lines, t);
          const lineText = li >= 0 && lines[li] ? String(lines[li].text || '') : '';
          if (lineText.replace(/[♪\s]/g, '').length > 1 && txt.length < 2) ok = false;
        }
      } else if (rt) {
        const cv = getHost() && getHost().querySelector('canvas');
        ok = !!(cv && cv.width > 2 && cv.height > 2);
      }
      if (!ok) failStyle(style);
    }, 7000);
  }

  function watchRuntimeCanvas(style) {
    const h = getHost();
    if (!h) return;
    const cv = h.querySelector('canvas');
    if (!cv || cv.__foliaCanvasWatch) return;
    cv.__foliaCanvasWatch = true;
    cv.addEventListener('webglcontextlost', (e) => {
      try { e.preventDefault(); } catch (err) {}
      setTimeout(() => {
        if (!cv.isConnected || cv.width < 2 || cv.height < 2) noteRuntimeError(style, 'WebGL context lost', 'webgl');
      }, 1500);
    }, false);
  }

  function pvLyricLines(lines, maxChars) {
    const cap = Math.max(3, Math.min(14, Number(maxChars) || 7));
    const built = buildLines(lines, cfg.getSegments && cfg.getSegments());
    const out = [];
    for (const line of built) {
      const words = Array.isArray(line.words) ? line.words : [];
      if (!words.length) {
        out.push({ time: line.startTime, text: line.fullText || '' });
        continue;
      }
      let group = [];
      let chars = 0;
      const flush = () => {
        if (!group.length) return;
        out.push({ time: group[0].startTime, text: group.map(w => w.text).join('') });
        group = [];
        chars = 0;
      };
      for (const w of words) {
        const n = Array.from(String(w.text || '')).length;
        if (group.length && chars + n > cap) flush();
        group.push(w);
        chars += n;
      }
      flush();
    }
    return out;
  }

  function sendPvInit() {
    if (!pvFrame || !pvReady || !pvFrame.contentWindow) return;
    const t = Number(cfg.getTime && cfg.getTime()) || 0;
    const lines = (cfg.getLines && cfg.getLines()) || [];
    const th = makeTheme(cfg.getTheme && cfg.getTheme());
    const payload = {
      type: 'pvtool-init',
      template: PV_STYLES[cfg.getStyle()] ? PV_STYLES[cfg.getStyle()].template : 1,
      time: t,
      playing: !!(cfg.getPlaying && cfg.getPlaying()),
      bpm: Number(cfg.getBpm && cfg.getBpm()) || 120,
      palette: { primary: th.primaryColor, secondary: th.secondaryColor, accent: th.accentColor, background: th.backgroundColor, text: th.textColor },
      energy: document.body.classList.contains('mv-chorus') ? 1 : 0.35,
      lyrics: pvLyricLines(lines, PV_STYLES[cfg.getStyle()] && PV_STYLES[cfg.getStyle()].maxChars)
    };
    try { pvFrame.contentWindow.postMessage(payload, '*'); } catch (e) {}
    pvInitSent = true;
    pvLastTime = t;
  }

  function buildPv(style, track, lines, key) {
    stopRuntime();
    const h = getHost();
    if (!h) return;
    h.innerHTML = '';
    const frame = document.createElement('iframe');
    frame.className = 'pv-embed-frame';
    frame.src = '/vendor/pvtool/embed.html';
    frame.title = 'PV Tool';
    frame.setAttribute('allow', 'autoplay');
    h.appendChild(frame);
    pvFrame = frame;
    pvReady = false;
    pvInitSent = false;
    pvLastTime = -1;
    buildKey = key;
    pvFailTimer = setTimeout(() => { if (!pvReady) failStyle(style); }, 9000);
    frame.addEventListener('load', () => {
      if (pvFrame !== frame) return;
      sendPvInit();
      try {
        const win = frame.contentWindow;
        if (win && !win.__foliaErrHooked) {
          win.__foliaErrHooked = true;
          win.addEventListener('error', ev => noteRuntimeError(style, (ev && ev.error) || (ev && ev.message), 'pv-iframe'));
          win.addEventListener('unhandledrejection', ev => noteRuntimeError(style, ev && ev.reason, 'pv-iframe'));
        }
      } catch (e) {}
    });
  }

  async function build(track, lines, theme, key) {
    building = true;
    const style = cfg.getStyle();
    if (failedStyles.has(style)) return;
    try {
      const domRc = DOM_RUNTIMES[style];
      const rc = domRc || RUNTIMES[style];
      if (!rc) return;
      const isDom = !!domRc;
      if (!isDom && !mods[style]) mods[style] = await import(rc.entry);
      const m = isDom ? null : mods[style];
      stopRuntime();
      const h = getHost();
      if (!h) return;
      h.innerHTML = '';
      const segs = cfg.getSegments && cfg.getSegments();
      const builtLines = buildLines(lines, segs);
      builtLinesRef = builtLines;
      const th = makeTheme(theme);
      const subMode = subtitleMode(builtLines);
      currentTime.v = Number(cfg.getTime && cfg.getTime()) || 0;
      updateAudio();
      if (isDom) {
        await buildDom(style, rc, h, track, lines, th, builtLines);
        paused = false;
        buildKey = key;
        window.__FoliaStyle = style;
        window.__FoliaDom = { root: domRoot, lines: builtLines };
        verifyStyle(style, lines);
        return;
      }
      const seed = 'bilimusic-' + style;
      const program = style === 'tempera'
        ? m[rc.builder](builtLines, seed, { wholeLineLyrics: false })
        : m[rc.builder](builtLines, seed, {}, { duration: Number(cfg.getDuration && cfg.getDuration()) || 300 });
      if (rc.flat) {
        rt = await m[rc.runtime].create({
          host: h,
          songSeed: 'bilimusic-' + style,
          program: program,
          theme: th,
          tuning: rc.tuning,
          renderScale: lowPower ? 0.72 : 1,
          antialias: !lowPower,
          antialiasMode: 'auto',
          smartBeatEnabled: true,
          currentTime: currentTime,
          audioPower: mvPower,
          audioBands: mvBands,
          lyricsFontScale: 1,
          hideTranslationSubtitle: true,
          showSubtitleTranslation: false,
          subtitleContentMode: 'none',
          subtitleTheme: th,
          subtitleFontScale: 0.9,
          staticMode: false,
          transparentBackground: false,
          paused: false,
          songTitle: track.title || '',
          songArtist: track.up || '',
          songAlbum: '',
          coverColors: [th.primaryColor, th.secondaryColor, th.accentColor, th.backgroundColor],
          imageBlobs: new Map(),
          modulation: {}
        });
      } else {
        rt = await m[rc.runtime].create({
          host: h,
          song: { seed: 'bilimusic-' + style, program: program, theme: th },
          tuning: rc.tuning,
          currentTime: currentTime,
          audioPower: mvPower,
          audioBands: mvBands,
          staticMode: false,
          showText: true,
          hideTranslationSubtitle: true,
          showSubtitleTranslation: false,
          subtitleContentMode: 'none',
          subtitleTheme: th,
          subtitleFontScale: 0.9,
          paused: false,
          metadata: { title: track.title || '', artist: track.up || '', album: '' },
          renderScale: lowPower ? 0.72 : 1,
          antialias: !lowPower
        });
      }
      paused = false;
      buildKey = key;
      watchRuntimeCanvas(style);
      verifyStyle(style, lines);
      window.__FoliaRT = rt;
      window.__FoliaProgram = program;
      window.__FoliaStyle = style;
    } catch (e) {
      failAt = Date.now();
      failKey = key;
      console.warn('[Folia Lumiere]', e && e.message ? e.message : e, e && e.stack ? e.stack : '');
      stopRuntime();
      failStyle(style);
    } finally {
      building = false;
    }
  }

  async function tick() {
    try {
      await tickInner();
    } catch (e) {
      if (cfg && active()) noteRuntimeError(cfg.getStyle(), e, 'tick');
      else console.warn('[Folia]', e && e.message || e);
    }
  }
  async function tickInner() {
    if (!cfg) return;
    if (!active()) { stopRuntime(); return; }
    const track = cfg.getTrack && cfg.getTrack();
    const lines = cfg.getLines && cfg.getLines();
    if (!track || !lines || lines.length < 2) { stopRuntime(); return; }
    const theme = cfg.getTheme && cfg.getTheme();
    const segs = (cfg.getSegments && cfg.getSegments()) || [];
    const key = [
      cfg.getStyle(),
      track.bvid || ('n' + (track.nid || '')),
      track.title || '',
      lines.length,
      lines[0] && lines[0].t,
      lines[lines.length - 1] && lines[lines.length - 1].t,
      (theme && theme.theme && theme.theme.name) || '',
      cfg.getTone && cfg.getTone(),
      cfg.getLyricKey && cfg.getLyricKey(),
      segs.length
    ].join('|');
    const curStyle = cfg.getStyle();
    if (PV_STYLES[curStyle]) {
      if (!pvFrame || key !== buildKey) {
        if (!building && (failKey !== key || Date.now() - failAt > 15000)) buildPv(curStyle, track, lines, key);
      }
      if (!pvFrame || !pvReady) return;
      const pvT = Number(cfg.getTime && cfg.getTime()) || 0;
      if (Math.abs(pvT - pvLastTime) > 0.08) {
        pvLastTime = pvT;
        try {
          pvFrame.contentWindow.postMessage({
            type: 'pvtool-time', time: pvT,
            playing: !!(cfg.getPlaying && cfg.getPlaying())
          }, '*');
        } catch (e) {}
      }
      return;
    }
    if ((!rt && !domRoot) || key !== buildKey) {
      if (!building && (failKey !== key || Date.now() - failAt > 15000)) await build(track, lines, theme, key);
    }
    if (!rt && !domRoot) return;
    const t = Number(cfg.getTime && cfg.getTime()) || 0;
    currentTime.v = t;
    updateAudio();
    if (builtLinesRef && lines.length) {
      const li = lineIndexAt(lines, t);
      const rawLine = li >= 0 && lines[li] ? String(lines[li].text || '') : '';
      const inst = li >= 0 && rawLine.replace(/[♪♫♬\s音乐]/g, '').length === 0;
      if (inst !== lastInstrumental) { lastInstrumental = inst; setInstrumental(inst); }
      const on = !!(builtLinesRef[li] && builtLinesRef[li].isChorus);
      if (on !== lastChorus) {
        lastChorus = on;
        try { window.dispatchEvent(new CustomEvent('bp-mv-chorus', { detail: { on } })); } catch (e) {}
      }
    }
    if (domRoot && domTime && domPower && domBands) {
      domTime.set(t);
      domPower.set(audio.power);
      if (domBands && domBands.bass) {
        domBands.bass.set(audio.bass);
        domBands.lowMid.set(audio.lowMid);
        domBands.mid.set(audio.mid);
        domBands.vocal.set(audio.vocal);
        domBands.treble.set(audio.treble);
      }
      const idx = lineIndexAt(domOrigLines || [], t);
      if (idx !== domLine) {
        domLine = idx;
        renderDom(idx, makeTheme(cfg.getTheme && cfg.getTheme()));
      }
    }
  }

  /* 细粒度运行时错误：只捕获 /vendor/folia/ 里的异常/未处理 Promise，避免误伤主应用 */
  window.addEventListener('error', (e) => {
    if (!active()) return;
    const file = String((e && e.filename) || '');
    const stack = String((e && e.error && e.error.stack) || '');
    const src = String((e && e.target && (e.target.src || e.target.href)) || '');
    if (!/\/vendor\/folia\//.test(file + stack + src)) return;
    noteRuntimeError(cfg.getStyle(), (e && e.error) || (e && e.message) || '资源加载失败', 'window.error');
  }, true);
  window.addEventListener('unhandledrejection', (e) => {
    if (!active()) return;
    const r = e && e.reason;
    const stack = String((r && r.stack) || '');
    if (!/\/vendor\/folia\//.test(stack)) return;
    noteRuntimeError(cfg.getStyle(), r, 'unhandledrejection');
  });

  window.addEventListener('message', (e) => {
    if (!pvFrame || e.source !== pvFrame.contentWindow || !e.data) return;
    const d = e.data;
    if (d.type === 'pvtool-ready') {
      pvReady = true;
      if (pvFailTimer) { clearTimeout(pvFailTimer); pvFailTimer = 0; }
      sendPvInit();
    } else if (d.type === 'pvtool-error') {
      failStyle(cfg.getStyle());
    }
  });

  window.FoliaBridge = {
    configure(c) {
      cfg = c;
      lowPower = !!(c.getLowPower && c.getLowPower());
      if (!timer) timer = setInterval(tick, 40);
      tick();
    },
    refresh() { tick(); },
    sync() { tick(); },
    setStyle() { tick(); },
    setLowPower,
    getLastError: () => lastError,
    setPvFx(on) {
      if (!pvFrame || !pvReady) return;
      try { pvFrame.contentWindow.postMessage({ type: 'pvtool-fx', energy: on ? 1 : 0.35 }, '*'); } catch (e) {}
    },
    stop() { stopRuntime(); }
  };
})();
