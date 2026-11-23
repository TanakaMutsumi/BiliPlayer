/* 播放引擎：audio(纯听) / video(看视频) 双元素，切换时保持进度 */
const Player = (function () {
  const audio = document.createElement('audio');
  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.preload = 'auto';
  audio.preload = 'auto';
  const holder = document.createElement('div');
  holder.style.display = 'none';
  holder.appendChild(audio);
  holder.appendChild(video);
  document.body.appendChild(holder);

  const S = {
    queue: [],
    index: -1,
    mode: localStorage.getItem('bp.mode') || 'audio',
    slot: localStorage.getItem('bp.mode') === 'video' ? 'b' : 'a', // 当前主元素：a=audio b=video（无缝切换时互换）
    playmode: localStorage.getItem('bp.playmode') || 'list', // list | one | random
    playing: false,
    loading: false,
    track: null,
    dashAV: false,
    _dashEnded: false
  };
  const hooks = {}; // onChange 由 app.js 挂载

  function cur() { return S.queue[S.index] || null; }
  function activeEl() { return S.slot === 'b' ? video : audio; }
  function otherEl() { return S.slot === 'b' ? audio : video; }

  function notify(extra) {
    if (hooks.onChange) hooks.onChange(S, extra || {});
  }
  function neQualityLabel(m) {
    if (m && m.quality) return m.quality;
    return '网易云 ' + ((m && m.type) || 'mp3');
  }
  function audioQuality() {
    let q = 'auto';
    try { q = localStorage.getItem('bp.audioQuality') || 'auto'; } catch (e) {}
    if (q !== 'auto') return q;
    /* 自动：慢网/省流走 320k，其余走无损；不自动选 Hi-Res，避免默认拉 75MB。 */
    try {
      const c = navigator.connection || {};
      if (c.saveData) return '320';
      const et = String(c.effectiveType || '');
      if (et === 'slow-2g' || et === '2g' || et === '3g') return '320';
    } catch (e) {}
    return 'lossless';
  }
  function dashVideoOn() {
    try { return localStorage.getItem('bp.dashVideo') === '1'; } catch (e) { return false; }
  }
  /* B站 DASH 音频可能返回杜比 ec-3/ac-3；Chromium 通常不支持。按 canPlayType 选第一个可解码候选。 */
  function codecPlayable(codecs) {
    if (!codecs) return true;
    try { return audio.canPlayType('audio/mp4; codecs="' + codecs + '"') !== ''; } catch (e) { return true; }
  }
  function pickPlayableMedia(m) {
    if (!m || !m.url) return m;
    const list = [m].concat(Array.isArray(m.alts) ? m.alts : []);
    const hit = list.find(x => x && x.url && codecPlayable(x.codecs));
    return hit || m;
  }
  /* 网易云档位回退链：Hi-Res 失败 → 无损 → 320；无损失败 → 320。 */
  function qualityChain(q) {
    const all = ['hires', 'lossless', '320', '192', '128'];
    const i = all.indexOf(q);
    return i < 0 ? ['lossless', '320'] : all.slice(i);
  }
  async function neMedia(id, q) {
    const chain = qualityChain(q || 'lossless');
    let last = null, lastErr = null;
    for (const qq of chain) {
      try {
        const m = await Api.get('nmedia', { id, quality: qq });
        last = m;
        if (m && m.url) { m._q = qq; return m; }
      } catch (e) {
        lastErr = e;
        if (e && e.risk) throw e; // 风控交给上层冷却，不继续换档加深
      }
    }
    if (last) { last._q = chain[chain.length - 1]; return last; }
    if (lastErr) throw lastErr;
    return { url: null };
  }

  /* ---------- 频谱分析（音频可视化用） ---------- */
  let audioCtx = null, analyser = null, freqData = null, gainNode = null;
  let gainA = null, gainB = null; // 每元素独立增益：无缝切换时做交叉淡化，可视化不受影响
  let eqA = null, eqB = null;     // 每元素低频EQ：交叉淡化时bass swap，避免双低频打架
  /* ---------- 响度归一（K加权，逐轨测8秒后锁定常量增益） ---------- */
  let normA = null, normB = null; // 每元素归一增益（在EQ后、交叉增益前，与淡入淡出互不干扰）
  let loudA = null, loudB = null; // 每元素K加权分析器（左右声道各一个，能量求和）
  let fadePref = 1800;            // 切歌交叉淡化时长 ms，可在高级页调 0–3000
  try { const v = parseInt(localStorage.getItem('bp.fadeMs'), 10); if (isFinite(v)) fadePref = Math.max(0, Math.min(3000, v)); } catch (e) {}
  function setFadeMs(v) {
    fadePref = Math.max(0, Math.min(3000, Math.round(Number(v) || 0)));
    try { localStorage.setItem('bp.fadeMs', String(fadePref)); } catch (e) {}
    return fadePref;
  }
  let loudTarget = -14;           // 目标响度 LUFS，可在高级页选 -12/-14/-16/-18
  let loudPeakCeil = -1.5;        // 采样峰值上限 dBFS，可在高级页选 -1.5/-2/-3
  try { const v = parseFloat(localStorage.getItem('bp.loudTarget')); if (isFinite(v)) loudTarget = Math.max(-18, Math.min(-12, v)); } catch (e) {}
  try { const v = parseFloat(localStorage.getItem('bp.loudPeakCeil')); if (isFinite(v)) loudPeakCeil = Math.max(-6, Math.min(-0.5, v)); } catch (e) {}
  const LOUD_MIN = -12, LOUD_MAX = 5; // 增益限幅：最多衰减12dB/提升5dB，防炸防虚
  let loudCache = null;
  try { const raw = localStorage.getItem('bp.loudness.v6'); if (raw) loudCache = JSON.parse(raw); } catch (e) { loudCache = null; }
  if (!loudCache || typeof loudCache !== 'object') {
    loudCache = {};
    /* v5 缓存存的是 -14LUFS 下的增益 g；迁移成测量响度 l，换目标时可直接重算 */
    try {
      const old = JSON.parse(localStorage.getItem('bp.loudness.v5') || '{}') || {};
      for (const k of Object.keys(old)) {
        const it = old[k];
        if (it && typeof it.g === 'number') loudCache[k] = { l: +(-14 - it.g).toFixed(2), p: +(it.p || 0).toFixed(4) };
      }
    } catch (e) {}
    try { localStorage.setItem('bp.loudness.v6', JSON.stringify(loudCache)); } catch (e) {}
  }
  function loudSave() { try { localStorage.setItem('bp.loudness.v6', JSON.stringify(loudCache)); } catch (e) {} }
  /* K加权（BS.1770）：highshelf 1681Hz +4dB + highpass 38Hz，左右各一路→分析器 */
  function makeLoudTap(ctx, src) {
    try {
      const sp = ctx.createChannelSplitter(2);
      src.connect(sp);
      const mk = ch => {
        const sh = ctx.createBiquadFilter();
        sh.type = 'highshelf'; sh.frequency.value = 1681.97; sh.gain.value = 3.999; sh.Q.value = 0.7071;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 38.13; hp.Q.value = 0.5003;
        const an = ctx.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0;
        sp.connect(sh, ch); sh.connect(hp); hp.connect(an);
        /* Analyser 必须有一条到 destination 的路径才会被 Web Audio 拉取；用 0 增益哑通道保证测量持续运行 */
        try {
          const sink = ctx.createGain(); sink.gain.value = 0;
          an.connect(sink); sink.connect(ctx.destination);
        } catch (e) {}
        return an;
      };
      /* 原始（未K加权）峰值分析器：只用于限制响度增益，避免 K 加权 +4dB 高频架把峰值算高
         而过度衰减；也避免把“响度提升”全部丢给末级限制器去压，造成持续 5~6dB 增益压缩 */
      const mkRaw = ch => {
        const an = ctx.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0;
        sp.connect(an, ch);
        try {
          const sink = ctx.createGain(); sink.gain.value = 0;
          an.connect(sink); sink.connect(ctx.destination);
        } catch (e) {}
        return an;
      };
      return { l: mk(0), r: mk(1), rl: mkRaw(0), rr: mkRaw(1) };
    } catch (e) { return null; }
  }
  const _loudBuf = new Float32Array(1024);
  function loudStats(an) {
    try { an.getFloatTimeDomainData(_loudBuf); } catch (e) { return { ms: 0, peak: 0 }; }
    let s = 0, p = 0;
    for (let i = 0; i < _loudBuf.length; i++) {
      const v = _loudBuf[i];
      s += v * v;
      const a = Math.abs(v);
      if (a > p) p = a;
    }
    return { ms: s / _loudBuf.length, peak: p };
  }
  /* 换轨时初始化该元素的测量状态：有缓存直接套用（锁定），无缓存沿用上一轨增益再缓慢收敛 */
  function initLoud(el, item) {
    if (!normA) return;
    const key = item ? (item.nid ? 'n' + item.nid : (item.bvid ? 'b' + item.bvid : '')) : '';
    const raw = key ? loudCache[key] : null;
    const cachedL = raw && typeof raw.l === 'number' ? raw.l : (raw && typeof raw.g === 'number' ? -14 - raw.g : null);
    const cached = cachedL != null;
    const cachedPeak = cached ? (Number(raw.p) || 0) : 0;
    const cachedGain = cached ? capDbByPeak(loudTarget - cachedL, cachedPeak) : 0;
    el._loud = {
      key, e: 0, n: 0, t0: 0, win: 0,
      blocks: [], blockE: 0, blockN: 0, blockT0: 0, peak: cachedPeak,
      lufs: cachedL, locked: !!cached, gDb: cachedGain
    };
    if (cached) {
      const g = el === audio ? normA : normB;
      try { g.gain.cancelScheduledValues(audioCtx.currentTime); g.gain.setTargetAtTime(Math.pow(10, cachedGain / 20), audioCtx.currentTime, 0.05); } catch (e) {}
    }
  }
  /* BS.1770 门限积分：绝对门限 -70 LUFS，相对门限 integrated-10 LU，忽略静音/间奏 */
  function gatedLufs(blocks) {
    if (!blocks || !blocks.length) return null;
    const abs = blocks.filter(e => e > 1e-12).map(e => -0.691 + 10 * Math.log10(e)).filter(l => l >= -70);
    if (!abs.length) return null;
    const meanAbs = abs.reduce((a, b) => a + Math.pow(10, (b + 0.691) / 10), 0) / abs.length;
    const relTh = -0.691 + 10 * Math.log10(meanAbs) - 10;
    const rel = abs.filter(l => l >= relTh);
    const use = rel.length ? rel : abs;
    const mean = use.reduce((a, b) => a + Math.pow(10, (b + 0.691) / 10), 0) / use.length;
    return -0.691 + 10 * Math.log10(mean);
  }
  /* 峰值保护：响度增益不得把原始采样峰值推过 -1.5dBFS。
     否则 +5dB 的“响度提升”会全部由末级限制器压回去，造成持续增益压缩/抽吸。
     用未K加权峰值，避免高频架把峰值算高而误伤（K加权峰值可达原始峰值1.6倍）。 */
  function capDbByPeak(db, peak) {
    if (!(peak > 1e-6)) return db;
    return Math.min(db, loudPeakCeil - 20 * Math.log10(peak));
  }
  function reapplyLoudGains() {
    [audio, video].forEach(el => {
      const st = el._loud;
      if (!st || !st.key || st.lufs == null) return;
      let g = loudTarget - st.lufs;
      g = Math.max(LOUD_MIN, Math.min(LOUD_MAX, g));
      g = capDbByPeak(g, st.peak);
      st.gDb = g;
      const gn = el === audio ? normA : normB;
      if (gn && audioCtx) {
        try { gn.gain.setTargetAtTime(Math.pow(10, g / 20), audioCtx.currentTime, 0.25); } catch (e) {}
      }
      loudCache[st.key] = { l: +st.lufs.toFixed(2), p: +st.peak.toFixed(4) };
    });
    loudSave();
  }
  function setLoudTarget(v) {
    const t = Math.max(-18, Math.min(-12, Number(v) || -14));
    loudTarget = t;
    try { localStorage.setItem('bp.loudTarget', String(t)); } catch (e) {}
    reapplyLoudGains();
    return t;
  }
  function setLoudPeakCeil(v) {
    const p = Math.max(-6, Math.min(-0.5, Number(v) || -1.5));
    loudPeakCeil = p;
    try { localStorage.setItem('bp.loudPeakCeil', String(p)); } catch (e) {}
    reapplyLoudGains();
    return p;
  }
  function normTick() {
    if (!normA || !audioCtx || audioCtx.state !== 'running') return;
    [audio, video].forEach(el => {
      const st = el._loud;
      if (!st || !st.key || el.paused || el.ended) return;
      const tap = el === audio ? loudA : loudB;
      if (!tap) return;
      /* 锁定后峰值守卫：后段出现更高峰值时缓慢下调归一增益，避免末级限制器长期压峰；
         只降不升，并写回缓存，下次播放直接使用安全增益。 */
      if (st.locked) {
        const rp = Math.max(
          tap.rl ? loudStats(tap.rl).peak : 0,
          tap.rr ? loudStats(tap.rr).peak : 0
        );
        if (rp > st.peak + 0.005) {
          st.peak = rp;
          const capped = capDbByPeak(st.gDb, st.peak);
          if (capped < st.gDb - 0.1) {
            st.gDb = capped;
            const g0 = el === audio ? normA : normB;
            try { g0.gain.setTargetAtTime(Math.pow(10, st.gDb / 20), audioCtx.currentTime, 2.0); } catch (e) {}
            loudCache[st.key] = { l: +(st.lufs != null ? st.lufs : (-14 - st.gDb)).toFixed(2), p: +st.peak.toFixed(4) };
            loudSave();
          }
        }
        return;
      }
      const S = loudStats(tap.l), R = loudStats(tap.r);
      const zl = S.ms, zr = R.ms;
      if (zl + zr < 1e-8) return; // 缓冲/静音不采样，避免把静音当"超轻"狂拉增益
      const t = performance.now();
      if (!st.t0) st.t0 = t;
      if (!st.blockT0) st.blockT0 = t;
      const rawPeak = Math.max(
        tap.rl ? loudStats(tap.rl).peak : 0,
        tap.rr ? loudStats(tap.rr).peak : 0
      );
      st.peak = Math.max(st.peak, rawPeak);
      st.blockE += zl + zr; st.blockN++;
      if (t - st.blockT0 < 400) return; // 400ms 短时块
      const blockE = st.blockE / Math.max(1, st.blockN);
      st.blocks.push(blockE);
      if (st.blocks.length > 120) st.blocks.shift();
      st.blockE = 0; st.blockN = 0; st.blockT0 = t;
      const lufs = -0.691 + 10 * Math.log10(blockE + 1e-12);
      /* 未锁定时用“累计门限积分”而不是单块响度：长前奏/现场版不会因开头安静而被永久 +5dB，
         后面高潮段也不会全部丢给末级限制器去压。 */
      const integratedNow = gatedLufs(st.blocks);
      const lufsUse = integratedNow != null ? integratedNow : lufs;
      let db = loudTarget - lufsUse;
      db = Math.max(LOUD_MIN, Math.min(LOUD_MAX, db));
      db = capDbByPeak(db, st.peak);
      st.gDb = st.gDb * 0.82 + db * 0.18; // 平滑，避免逐窗跳变
      const g = el === audio ? normA : normB;
      try { g.gain.setTargetAtTime(Math.pow(10, st.gDb / 20), audioCtx.currentTime, 0.35); } catch (e) {}
      /* 30 秒 / 50 个 400ms 块后才锁定，给长前奏和现场动态留足测量时间 */
      if (t - st.t0 > 30000 && st.blocks.length >= 50) {
        const integrated = gatedLufs(st.blocks);
        if (integrated != null) {
          let gdb = loudTarget - integrated;
          gdb = Math.max(LOUD_MIN, Math.min(LOUD_MAX, gdb));
          gdb = capDbByPeak(gdb, st.peak);
          st.gDb = gdb;
          try { g.gain.setTargetAtTime(Math.pow(10, st.gDb / 20), audioCtx.currentTime, 0.45); } catch (e) {}
          st.locked = true;
          st.lufs = integrated;
          if (st.key) { loudCache[st.key] = { l: +integrated.toFixed(2), p: +st.peak.toFixed(4) }; loudSave(); }
        }
      }
    });
  }
  setInterval(normTick, 200);
  function ensureAnalyser() {
    if (analyser) return analyser;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { audioCtx = new AC({ latencyHint: 'playback' }); } catch (e) { audioCtx = new AC(); }
      const src = audioCtx.createMediaElementSource(audio); // 同一元素只能创建一次
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.82;
      gainA = audioCtx.createGain();
      gainB = audioCtx.createGain();
      normA = audioCtx.createGain();
      normB = audioCtx.createGain();
      eqA = audioCtx.createBiquadFilter(); eqA.type = 'lowshelf'; eqA.frequency.value = 150; eqA.gain.value = 0;
      eqB = audioCtx.createBiquadFilter(); eqB.type = 'lowshelf'; eqB.frequency.value = 150; eqB.gain.value = 0;
      gainNode = audioCtx.createGain();
      src.connect(eqA); eqA.connect(normA); normA.connect(gainA);
      const srcV = audioCtx.createMediaElementSource(video); // 看视频时波形也有数据
      srcV.connect(eqB); eqB.connect(normB); normB.connect(gainB);
      loudA = makeLoudTap(audioCtx, src);
      loudB = makeLoudTap(audioCtx, srcV);
      if (window.AudioFX && AudioFX.ensure) {
        const fx = AudioFX.ensure(audioCtx);
        gainA.connect(fx.input);
        gainB.connect(fx.input);
        fx.output.connect(analyser);
      } else {
        gainA.connect(analyser);
        gainB.connect(analyser);
      }
      analyser.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      // 音量走总增益：分析器取音量前的信号，波浪不随音量缩水
      audio.volume = 1;
      video.volume = 1;
      gainNode.gain.value = (S.vol !== undefined ? S.vol : 0.8);
      gainA.gain.value = 1;
      gainB.gain.value = 1; // 归位由 normalizeElGains 按当前slot处理
      freqData = new Uint8Array(analyser.frequencyBinCount);
    } catch (e) { analyser = null; }
    return analyser;
  }
  function resumeAudio() {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  }
  /* 音频看门狗：在播但无声（增益卡0/上下文挂起）时自动恢复 */
  function audioWatch() {
    const el = activeEl();
    if (!el || el.paused) return;
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    if (gainNode && (S.vol === undefined || S.vol > 0.01) && gainNode.gain.value <= 0.001) {
      fadeGain(vol(), 120);
    }
  }
  /* 切歌淡入淡出：走图内增益，不依赖元素音量 */
  let _fadeT = 0;
  function fadeGain(target, ms) {
    return new Promise(res => {
      if (!gainNode || !audioCtx) return res();
      const g = gainNode.gain;
      try {
        const now = audioCtx.currentTime;
        g.cancelScheduledValues(now);
        g.setValueAtTime(Math.max(0.0001, g.value), now);
        g.linearRampToValueAtTime(Math.max(0.0001, target), now + ms / 1000);
      } catch (e) { return res(); }
      clearTimeout(_fadeT);
      _fadeT = setTimeout(() => {
        try {
          const t2 = audioCtx.currentTime;
          g.cancelScheduledValues(t2);
          g.setValueAtTime(Math.max(0.0001, target), t2);
        } catch (e) {}
        res();
      }, ms + 40);
    });
  }
  const vol = () => (S.vol !== undefined ? S.vol : 0.8);
  /* 用户倍速（音效面板设置）：与版本切换的tempo斜率统一计算，防互相覆盖 */
  const userSpeed = () => (window.AudioFX ? AudioFX.speed() : 1);
  function applyRate(el, extra = 1) {
    const r = Math.max(0.0625, Math.min(16, userSpeed() * (extra || 1)));
    try {
      el.playbackRate = r;
      el.preservesPitch = true;
      try { el.webkitPreservesPitch = true; } catch (e) {}
    } catch (e) {}
    return r;
  }
  function spectrum() {
    if (!analyser) return null;
    analyser.getByteFrequencyData(freqData);
    return freqData;
  }

  async function ensureCid(item) {
    if (item.cid) {
      if (item.aid && item.upMid) return item;
      const d = await Api.get('video', { bvid: item.bvid });
      item.aid = item.aid || d.aid;
      item.upMid = item.upMid || d.upMid;
      return item;
    }
    const d = await Api.get('video', { bvid: item.bvid });
    item.cid = d.cid;
    item.aid = item.aid || d.aid;
    item.upMid = item.upMid || d.upMid;
    if (!item.title) item.title = d.title;
    if (!item.up) item.up = d.up;
    if (!item.pic) item.pic = d.pic;
    return item;
  }

  let loadGen = 0; // 加载世代：新加载/交叉切换都会+1，旧的异步回调发现世代不符就放弃，防止迟到的网易云直链覆盖刚切过去的B站歌
  let preAdvanced = false; // 本轨是否已"提前交叉"到下一首（timeupdate 触发，防重复/防 ended 二次切歌）
  /* 下一首预取：当前歌开播后后台拉取下一首的直链（B站走media、网易云走nmedia），
     真正切歌时服务端/客户端缓存命中，近零等待。B站直链含cid+模式，切换时校验一致才用 */
  const prefetchMap = new Map();
  function prefetchNext() {
    try {
      const it = S.queue && S.queue[S.index + 1];
      if (!it || !(it.bvid || it.nid)) return;
      if (S.mode === 'video' && dashVideoOn()) return; // DASH 双流不走 mp4 预取
      if (it.nid) { neMedia(it.nid, audioQuality()).catch(() => {}); return; }
      const key = 'b' + it.bvid;
      const hit = prefetchMap.get(key);
      if (hit && Date.now() - hit.at < 10 * 60 * 1000) return;
      ensureCid(Object.assign({}, it)).then(i2 => Api.get('media', { bvid: i2.bvid, cid: i2.cid, kind: S.mode })).then(m => {
        m = pickPlayableMedia(m);
        prefetchMap.set(key, { cid: it.cid, url: m.url, quality: m.quality, mode: S.mode, at: Date.now() });
        if (prefetchMap.size > 12) prefetchMap.delete(prefetchMap.keys().next().value);
      }).catch(() => {});
    } catch (e) {}
  }
  /* 自动档卡顿降档：仅 auto 档生效；连续 waiting 6 秒才降一档，手动选的档位不动 */
  function clearStallTimer(el) {
    if (el && el._qStallTimer) { clearTimeout(el._qStallTimer); el._qStallTimer = 0; }
  }
  function armStallTimer(el) {
    if (!el || el._qStallTimer) return;
    const fb = el._qFallback;
    if (!fb || !fb.auto || fb.idx >= fb.chain.length - 1) return;
    el._qStallTimer = setTimeout(() => {
      el._qStallTimer = 0;
      if (el !== activeEl() || el.paused || !el._qFallback) return;
      const f = el._qFallback;
      if (f.idx >= f.chain.length - 1) return;
      f.idx++;
      const q = f.chain[f.idx];
      load(f.item, { seek: el.currentTime || 0, autoplay: true, qualityOverride: q, autoDowngrade: f.auto }).catch(() => {});
    }, 6000);
  }
  /* DASH 视频+音频双流：video-only 走 video 元素（静音），audio-only 走 audio 元素（FX/响度链） */
  let dashSyncTimer = 0;
  function stopDashSync() {
    if (dashSyncTimer) { clearInterval(dashSyncTimer); dashSyncTimer = 0; }
  }
  function startDashSync() {
    stopDashSync();
    dashSyncTimer = setInterval(() => {
      if (!S.dashAV) { stopDashSync(); return; }
      const v = video, a = audio;
      if (!v.src || !a.src) return;
      if (v.paused !== a.paused) { if (v.paused) a.pause(); else a.play().catch(() => {}); }
      const d = a.currentTime - v.currentTime;
      if (Math.abs(d) > 0.15) { try { a.currentTime = v.currentTime; } catch (e) {} }
    }, 1000);
  }
  async function playDashAV(item, m, { seek = 0, autoplay = true } = {}) {
    S.dashAV = true;
    S._dashEnded = false;
    S.slot = 'a'; // 音频元素是响度/FX 主元素；video 只负责画面
    S.track = item;
    S.quality = m.quality || 'DASH';
    const v = video, a = audio;
    try { v.pause(); a.pause(); } catch (e) {}
    v.muted = true;
    v.src = m.videoUrl;   // 服务端已 proxy，不能再套一层 /api/stream
    a.src = m.audioUrl;
    try { v.currentTime = seek || 0; a.currentTime = seek || 0; } catch (e) {}
    ensureAnalyser();
    normalizeElGains(a);
    initLoud(a, item);
    resumeAudio();
    applyRate(v); applyRate(a);
    const onErr = () => {
      if (!S.dashAV) return;
      S.dashAV = false;
      stopDashSync();
      try { v.pause(); a.pause(); } catch (e) {}
      load(item, { seek: v.currentTime || seek || 0, autoplay: true, dashFallback: true }).catch(() => {});
    };
    v.addEventListener('error', onErr, { once: true });
    a.addEventListener('error', onErr, { once: true });
    if (autoplay) {
      try { await Promise.all([v.play(), a.play()]); } catch (e) {}
    }
    startDashSync();
    S.loading = false;
    notify({ loaded: true });
    prefetchNext();
  }
  async function load(item, { seek = 0, autoplay = true, qualityOverride = null, autoDowngrade = null, dashFallback = false } = {}) {
    const gen = ++loadGen;
    preAdvanced = false;
    S.loading = true;
    S._dashEnded = false;
    try {
      audio._qFallback = null; video._qFallback = null;
      clearStallTimer(audio); clearStallTimer(video);
      stopDashSync();
      if (S.dashAV) { S.dashAV = false; try { video.pause(); } catch (e) {} }
      if (S.mode === 'video') video.muted = false;
    } catch (e) {}
    notify();
    try {
      if (item.nid) {
        // 网易云直链歌曲：无bvid/cid，音频直链由服务端带Cookie解析
        let mN = null;
        try {
          mN = await neMedia(item.nid, qualityOverride || audioQuality());
        } catch (e) {
          if (gen !== loadGen) return; // 已被更新的切歌顶替
          /* 风控可重试：原样上抛带 risk 标记，由上层冷却重试而非跳歌 */
          if (e && e.risk) throw e;
          throw new Error('网易云接口错误(' + ((e && e.message) || '未知') + ')');
        }
        if (gen !== loadGen) return;
        if (!mN.url) throw new Error('该歌曲需要网易云VIP或已下架，无法播放');
        const elN = activeEl();
        const otherN = otherEl();
        // 与B站路径一致：先把正在唱的旧歌淡出、停掉闲置元素，再换源（否则B站歌会继续响）
        const singingN = [elN, otherN].find(x => !x.paused && !x.ended && isFinite(x.duration) && x.currentTime < x.duration - 0.25 && x.src);
        if (singingN) await fadeGain(0, 180);
        if (gen !== loadGen) { fadeGain(vol(), 80); return; }
        try { otherN.pause(); } catch {}
        // 必须走本地代理：跨域直连会被WebAudio污染（图谱静音、无波形无声音）
        elN.src = '/api/stream?u=' + encodeURIComponent(mN.url);
        const qChain = qualityChain(mN._q || qualityOverride || audioQuality());
        const autoDg = autoDowngrade !== null ? !!autoDowngrade : ((localStorage.getItem('bp.audioQuality') || 'auto') === 'auto');
        elN._qFallback = { item, seek, chain: qChain, idx: Math.max(0, qChain.indexOf(mN._q || qChain[0])), auto: autoDg };
        try { elN.currentTime = seek || 0; } catch (e) {}
        applyRate(elN);
        S.quality = neQualityLabel(mN);
        ensureAnalyser();
        normalizeElGains(elN);
        initLoud(elN, item);
        resumeAudio();
        if (autoplay) {
          try { await elN.play(); }
          catch (e) { if (!(e && (e.name === 'AbortError' || e.name === 'NotAllowedError'))) throw e; }
          if (gen !== loadGen) return;
          fadeGain(vol(), 220);
        }
        S.loading = false;
        notify({ loaded: true });
        prefetchNext();
        return;
      }
      item = await ensureCid(item);
      if (gen !== loadGen) return;
      const wantDash = S.mode === 'video' && dashVideoOn() && !dashFallback;
      const pf = wantDash ? null : prefetchMap.get('b' + item.bvid);
      let m = null;
      if (pf && pf.mode === S.mode && (!item.cid || pf.cid === item.cid) && pf.url) {
        m = { url: pf.url, quality: pf.quality };
        prefetchMap.delete('b' + item.bvid);
      } else {
        const req = { bvid: item.bvid, cid: item.cid, kind: S.mode };
        if (wantDash) req.dash = 1;
        m = await Api.get('media', req);
      }
      if (gen !== loadGen) return;
      if (wantDash && m && m.type === 'dash-av' && m.videoUrl && m.audioUrl) {
        const el0 = activeEl(), other0 = otherEl();
        const singing0 = [el0, other0].find(x => !x.paused && !x.ended && isFinite(x.duration) && x.currentTime < x.duration - 0.25);
        if (singing0) await fadeGain(0, 180);
        if (gen !== loadGen) { fadeGain(vol(), 80); return; }
        try { other0.pause(); } catch (e) {}
        await playDashAV(item, m, { seek, autoplay });
        return;
      }
      m = pickPlayableMedia(m);
      const el = activeEl();
      const other = otherEl();
      // 切歌淡出：任一元素还在唱且没自然播完才淡出（自然结束不拖节奏）
      const singing = [el, other].find(x => !x.paused && !x.ended && isFinite(x.duration) && x.currentTime < x.duration - 0.25);
      if (singing) await fadeGain(0, 180);
      if (gen !== loadGen) { fadeGain(vol(), 80); return; }
      try { other.pause(); } catch {}
      el.src = m.url;
      try { el.currentTime = seek || 0; } catch (e) { /* 时长未知时越界seek忽略 */ }
      applyRate(el);
      S.quality = m.quality || '';
      ensureAnalyser();
      normalizeElGains(el);
      initLoud(el, item);
      resumeAudio();
      if (autoplay) {
        try { await el.play(); }
        catch (e) {
          // 浏览器省电策略/自动播放拦截导致的中断不算失败，媒体已就绪只是暂停
          if (!(e && (e.name === 'AbortError' || e.name === 'NotAllowedError'))) throw e;
        }
        if (gen !== loadGen) return;
        fadeGain(vol(), 220); // 新歌淡入，不阻塞加载完成的通知
      }
      S.loading = false;
      notify({ loaded: true });
      prefetchNext();
    } catch (e) {
      if (gen !== loadGen) return; // 旧加载的失败不影响新歌
      S.loading = false;
      S.playing = false;
      // 淡出后失败要把音量拉回来，不然一直静音
      fadeGain(vol(), 60);
      notify({ error: e });
      throw e;
    }
  }
  /* 元素增益归位：当前主元素全开、闲置元素静音（交叉淡化后调用，防残留中间值） */
  function normalizeElGains(active) {
    if (!analyser || !gainA || !gainB) return;
    const t = audioCtx.currentTime;
    gainA.gain.cancelScheduledValues(t);
    gainB.gain.cancelScheduledValues(t);
    gainA.gain.setValueAtTime(active === audio ? 1 : 0.0001, t);
    gainB.gain.setValueAtTime(active === video ? 1 : 0.0001, t);
    if (eqA && eqB) {
      eqA.gain.cancelScheduledValues(t); eqA.gain.setValueAtTime(0, t);
      eqB.gain.cancelScheduledValues(t); eqB.gain.setValueAtTime(0, t);
    }
  }
  let _cIn = null, _cOut = null;
  function curves() {
    if (!_cIn) {
      const n = 64;
      _cIn = new Float32Array(n); _cOut = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const th = (i / (n - 1)) * Math.PI / 2;
        _cIn[i] = Math.max(0.0001, Math.sin(th));
        _cOut[i] = Math.max(0.0001, Math.cos(th));
      }
    }
    return [_cIn, _cOut];
  }
  function waitState(el, cond, name, ms) {
    return new Promise(res => {
      if (cond()) return res();
      const done = () => { el.removeEventListener(name, done); clearTimeout(t); res(); };
      const t = setTimeout(done, ms);
      el.addEventListener(name, done);
    });
  }
  /* 无缝衔接：新版本在另一元素上从 startPos 起播，两路交叉淡化（fadeMs），完成后互换主元素。
     预武装优化：url/媒体地址可由外部预取传入（跳过网络请求），且等待 canplay 而非盲目起播，
     使点击瞬间即可开始交叉（startPos 通常=对齐点-淡化时长，交叉结束时正好唱到锚点句） */
  async function crossfadeTo(item, seek, opts = {}) {
    // slope=局部速度比：交叉期间目标元素以此速率播放（preservesPitch变速不变调）；bass swap EQ消除双低频打架
    let { fadeMs = fadePref, url = null, startOffset = 0, slope = 1, eqSwap = false, srcPos = null, tsSampled = NaN, mode = 'smooth' } = opts;
    fadeMs = Math.max(20, Math.min(3000, Number(fadeMs) || 0));
    if (!analyser || S.mode === 'video') return false;
    const myGen = ++loadGen; // 交叉切换也算一次加载世代：期间用户点了别的歌（含网易云）就放弃这次交叉
    const from = activeEl(), to = otherEl();
    let mediaUrl = url;
    if (!mediaUrl) {
      if (!item.bvid) return false; // 网易云没有bvid，必须由调用方传入直链 url
      item = await ensureCid(item);
      if (myGen !== loadGen) return false;
      const m = pickPlayableMedia(await Api.get('media', { bvid: item.bvid, cid: item.cid, kind: S.mode }));
      if (myGen !== loadGen) return false;
      mediaUrl = m.url;
      S.quality = m.quality || '';
    }
    resumeAudio();
    let startPos = Math.max(0, (seek || 0) - (startOffset || 0));
    /* seek 卫生：metadata 就绪后再定位 → 等 seeked 落定 → 回读校验补偿（element seek 粒度=1个AAC帧±21-26ms） */
    if (to.src !== mediaUrl) { to.src = mediaUrl; await waitState(to, () => to.readyState >= 1, 'loadedmetadata', 2500); }
    try { to.currentTime = startPos; } catch (e) {}
    await waitState(to, () => !to.seeking, 'seeked', 1500);
    let landed = NaN;
    try { landed = to.currentTime; } catch (e) {}
    if (isFinite(landed) && Math.abs(landed - startPos) > 0.005 && Math.abs(landed - startPos) < 0.6) {
      try { to.currentTime = startPos + (startPos - landed); await waitState(to, () => !to.seeking, 'seeked', 800); landed = to.currentTime; } catch (e) {}
    }
    await waitState(to, () => to.readyState >= 3, 'canplay', 5000);
    if (myGen !== loadGen) return false; // 等待缓冲期间用户已切歌：放弃这次交叉，别抢新歌
    /* 延迟补偿：srcT 采样到此刻源曲仍在推进 → 按漂移量二次对齐（数据已缓冲，seek廉价） */
    if (srcPos && isFinite(tsSampled)) {
      const drift = (srcPos() || 0) - tsSampled;
      if (drift > 0.02 && drift < 30) {
        startPos = Math.max(0, startPos + drift * (slope || 1));
        try { to.currentTime = startPos; await waitState(to, () => !to.seeking, 'seeked', 800); landed = to.currentTime; } catch (e) {}
      }
    }
    const gFrom = to === audio ? gainB : gainA;
    const gTo = to === audio ? gainA : gainB;
    const t0 = audioCtx.currentTime;
    gTo.gain.cancelScheduledValues(t0);
    gTo.gain.setValueAtTime(0.0001, t0);
    try { await to.play(); }
    catch (e) {
      if (!(e && (e.name === 'AbortError' || e.name === 'NotAllowedError'))) throw e;
    }
    const t1 = audioCtx.currentTime;
    const [cIn, cOut] = curves();
    gFrom.gain.cancelScheduledValues(t1);
    gFrom.gain.setValueAtTime(Math.max(0.0001, gFrom.gain.value), t1);
    gFrom.gain.setValueCurveAtTime(cOut, t1, fadeMs / 1000);
    gTo.gain.setValueCurveAtTime(cIn, t1, fadeMs / 1000);
    if (slope !== 1) {
      to.preservesPitch = true;
      try { to.webkitPreservesPitch = true; } catch (e) {}
      applyRate(to, slope); // 用户倍速×切换斜率（tempo跟随），preservesPitch不变调
    }
    if (eqSwap && eqA && eqB) {
      const eqFrom = from === audio ? eqA : eqB, eqTo = to === audio ? eqA : eqB;
      const t2 = audioCtx.currentTime;
      eqFrom.gain.cancelScheduledValues(t2); eqFrom.gain.setValueAtTime(0, t2);
      eqFrom.gain.linearRampToValueAtTime(-24, t2 + fadeMs / 1000);
      eqTo.gain.cancelScheduledValues(t2); eqTo.gain.setValueAtTime(-24, t2);
      eqTo.gain.linearRampToValueAtTime(0, t2 + fadeMs / 1000);
    }
    S.track = item;
    S.loading = false;
    initLoud(to, item); // 目标元素按新歌初始化响度测量
    notify({ loaded: true });
    let landed2 = NaN;
    try { landed2 = to.currentTime; } catch (e) {}
    window.__seamStats = { mode, path: 'element', requested: startPos, landed: landed2, deltaMs: isFinite(landed2) ? Math.round((landed2 - startPos) * 1000) : null, fadeMs };
    /* swap 锚定音频时钟（淡化结束时刻），不再用墙钟 fadeMs+80 猜 */
    const swapDelay = Math.max(0, (t1 + fadeMs / 1000) - audioCtx.currentTime) * 1000 + 60;
    setTimeout(() => {
      try { from.pause(); } catch (e) {}
      S.slot = to === video ? 'b' : 'a';
      to.playbackRate = 1; // 交接完成后恢复自然速度
      applyRate(to); // 应用用户倍速
      normalizeElGains(to);
      S.playing = !to.paused; // 交接后主动同步播放态（play事件在副元素上被忽略了）
      preAdvanced = false; // 交叉完成：解除"提前接歌"守卫（期间 ended 已被忽略）
      notify();
    }, swapDelay);
    return true;
  }
  /* 采样级交接：目标声部先由 AudioBufferSourceNode 演唱（start(when,offset) 在音频时钟上采样级精确），
     淡化结束后用 25ms 等功率微交叉回交 element 续航（element 落点±1帧误差被微淡化掩蔽，gapless-5 双模模式）。
     offsetAt(srcPosAtT0) 给出 t0 时刻的对齐偏移 → 交叉窗内两轨唱同一句 */
  async function crossfadeToBuffer(item, opts = {}) {
    let { fadeMs = fadePref, slope = 1, eqSwap = false, buffer = null, url = null, offsetAt = null, srcPos = null, mode = 'smooth' } = opts;
    fadeMs = Math.max(20, Math.min(3000, Number(fadeMs) || 0));
    if (!analyser || !buffer || S.mode === 'video') return false;
    if (Math.abs(userSpeed() - 1) > 0.001) return false; // 倍速≠1：ABSN无preservesPitch，降级element路径保音质
    const from = activeEl(), to = otherEl();
    const gFrom = to === audio ? gainB : gainA;
    const gTo = to === audio ? gainA : gainB;
    resumeAudio();
    const now = audioCtx.currentTime;
    const t0 = now + 0.1; // 100ms前瞻：吸收调度抖动（A Tale of Two Clocks）
    const srcAt = srcPos ? (srcPos() + (t0 - now)) : null;
    if (srcAt == null) return false;
    const offset = Math.max(0, Math.min(buffer.duration - 1, offsetAt ? offsetAt(srcAt) : srcAt));
    let mediaUrl = url;
    if (!mediaUrl) {
      try {
        const ci = await ensureCid(Object.assign({}, item));
        const mm = pickPlayableMedia(await Api.get('media', { bvid: ci.bvid, cid: ci.cid, kind: 'audio' }));
        mediaUrl = mm.url;
      } catch (e) { return false; }
    }
    if (to.src !== mediaUrl) { to.src = mediaUrl; await waitState(to, () => to.readyState >= 1, 'loadedmetadata', 2500); }
    const bufSrc = audioCtx.createBufferSource();
    const bufGain = audioCtx.createGain();
    bufSrc.buffer = buffer;
    bufSrc.connect(bufGain);
    bufGain.connect(gTo);
    bufSrc.start(t0, offset); // 采样级起播
    const [cIn, cOut] = curves();
    gTo.gain.cancelScheduledValues(t0);
    gTo.gain.setValueAtTime(0.0001, t0);
    gTo.gain.setValueCurveAtTime(cIn, t0, fadeMs / 1000);
    gFrom.gain.cancelScheduledValues(t0);
    gFrom.gain.setValueAtTime(Math.max(0.0001, gFrom.gain.value), t0);
    gFrom.gain.setValueCurveAtTime(cOut, t0, fadeMs / 1000);
    if (eqSwap && eqA && eqB) {
      const eqFrom = from === audio ? eqA : eqB, eqTo = to === audio ? eqA : eqB;
      eqFrom.gain.cancelScheduledValues(t0); eqFrom.gain.setValueAtTime(0, t0);
      eqFrom.gain.linearRampToValueAtTime(-24, t0 + fadeMs / 1000);
      eqTo.gain.cancelScheduledValues(t0); eqTo.gain.setValueAtTime(-24, t0);
      eqTo.gain.linearRampToValueAtTime(0, t0 + fadeMs / 1000);
    }
    /* element 预热：静音播放，交接瞬间重新瞄准到 buffer 当时的位置 */
    to.volume = 0;
    try { await to.play(); } catch (e) {}
    S.track = item;
    S.loading = false;
    initLoud(to, item);
    notify({ loaded: true });
    window.__seamStats = { mode, path: 'buffer', requested: offset, landed: offset, deltaMs: 0, fadeMs };
    const F = fadeMs / 1000;
    const handBase = t0 + F + 0.15;
    const tryHand = (tries) => {
      const tH = Math.max(handBase, audioCtx.currentTime + 0.03);
      const ready = to.readyState >= 3 || (() => {
        try { const p = to.currentTime; for (let i = 0; i < to.buffered.length; i++) if (to.buffered.start(i) <= p + 0.3 && to.buffered.end(i) >= p + 1.5) return true; } catch (e) {}
        return false;
      })();
      if (!ready && tries > 0) { setTimeout(() => tryHand(tries - 1), 60); return; }
      try {
        const want = Math.max(0, Math.min(buffer.duration - 0.5, offset + (tH - t0)));
        try { to.currentTime = want; } catch (e) {}
        let ld = NaN;
        try { ld = to.currentTime; } catch (e) {}
        window.__seamStats = { mode, path: 'buffer', requested: want, landed: ld, deltaMs: isFinite(ld) ? Math.round((ld - want) * 1000) : null, fadeMs, handoff: true };
        const tn = audioCtx.currentTime;
        bufGain.gain.cancelScheduledValues(tn);
        bufGain.gain.setValueAtTime(Math.max(0.0001, bufGain.gain.value), tn);
        bufGain.gain.linearRampToValueAtTime(0.0001, tn + 0.025);
        bufSrc.stop(tn + 0.045);
        to.volume = 0.3;
        setTimeout(() => { to.volume = 0.7; }, 8);
        setTimeout(() => { to.volume = 1; }, 16);
        from.pause();
        S.slot = to === video ? 'b' : 'a';
        S.playing = !to.paused;
        if (slope !== 1) { applyRate(to, slope); } else { applyRate(to); }
        normalizeElGains(to);
        notify();
      } catch (e) {}
    };
    setTimeout(() => tryHand(30), Math.max(0, (handBase - audioCtx.currentTime) * 1000));
    return true;
  }
  function setQueue(queue, index) {
    S.queue = queue;
    S.index = index;
    S.slotOrig = null; // 新队列：清除原版记忆
  }
  /* 在当前歌之后插入推荐曲（心动模式用），不打断正在播放的歌 */
  function insertAfterCurrent(items) {
    const list = (items || []).filter(Boolean);
    if (!list.length || !S.queue.length) return 0;
    const at = Math.max(0, S.index + 1);
    S.queue.splice(at, 0, ...list);
    notify({ queueChanged: true });
    return list.length;
  }

  async function playCurrent() {
    const it = cur();
    if (!it) return;
    S.track = it;
    const seek = S.resumeAt || 0; // 断点续播：首次播放跳到上次进度
    S.resumeAt = 0;
    await load(it, { seek });
  }

  function toggle() {
    if (S.dashAV) {
      if (audio.paused) { audio.play().catch(() => {}); video.play().catch(() => {}); }
      else { audio.pause(); video.pause(); }
      return;
    }
    const el = activeEl();
    if (!cur()) return;
    resumeAudio();
    if (!el.src) { playCurrent().catch(() => {}); return; } // 恢复的会话还没加载媒体
    if (el.paused) { el.play().catch(() => {}); } else { el.pause(); }
  }

  async function step(delta) {
    if (!S.queue.length) return;
    const i = nextIndexOf(delta);
    if (i < 0) return;
    const target = S.queue[i];
    const curIt = S.track;
    preAdvanced = false;
    /* 手动切歌：目标为网易云且当前在播、音频模式 → 400ms 交叉淡化（与版本切换同一套双元素） */
    if (target && target.nid && curIt && analyser && S.mode !== 'video' && !activeEl().paused) {
      S.index = i;
      const ok = await neCrossfadeTo(target, fadePref);
      if (ok) return;
      if (S.index !== i) return; // 交叉期间用户已切到别的歌
      await playCurrent(); // 交叉失败：回退常规加载
      return;
    }
    S.index = i;
    await playCurrent();
  }
  /* 与 step 同规则计算目标索引 */
  function nextIndexOf(delta) {
    if (!S.queue.length) return -1;
    if (S.playmode === 'random' && S.queue.length > 1) {
      let i; do { i = Math.floor(Math.random() * S.queue.length); } while (i === S.index);
      return i;
    }
    let i = S.index + delta;
    if (i < 0) i = S.queue.length - 1;
    if (i >= S.queue.length) i = 0;
    return i;
  }
  /* 网易云目标的无缝交叉：取直链（服务端已缓存）→ 交给 crossfadeTo 走双元素等功率交叉 */
  async function neCrossfadeTo(item, fadeMs) {
    if (!analyser || S.mode === 'video' || !item || !item.nid) return false;
    let mN = null;
    try { mN = await neMedia(item.nid, audioQuality()); } catch (e) { return false; }
    if (!mN || !mN.url) return false;
    try {
      const ok = await crossfadeTo(item, 0, { fadeMs, url: '/api/stream?u=' + encodeURIComponent(mN.url), mode: 'ne' });
      if (ok) { S.quality = neQualityLabel(mN); notify(); prefetchNext(); }
      return ok;
    } catch (e) { return false; }
  }
  /* 自然接歌：按用户淡化时长提前起交叉，淡窗在曲尾前约 50ms 收尾；B站目标仍走原流程 */
  async function preAdvance(el) {
    if (preAdvanced || S.playmode === 'one' || S.queue.length < 2) return;
    if (S.mode === 'video' || !analyser) return;
    if (!el.duration || !isFinite(el.duration)) return;
    const remain = el.duration - el.currentTime;
    const lead = fadePref <= 0 ? 0.15 : Math.max(0.15, fadePref / 1000);
    if (remain > lead + 0.15 || remain < 0.12) return;
    const i = nextIndexOf(1);
    const target = S.queue[i];
    if (!target || !target.nid) return;
    preAdvanced = true;
    const prevIdx = S.index, prevTrack = S.track;
    S.index = i;
    const fadeMs = fadePref <= 0 ? 20 : Math.max(20, Math.min(fadePref, Math.round(remain * 1000) - 50));
    const ok = await neCrossfadeTo(target, fadeMs);
    if (ok) return;
    if (S.index === i) { // 无人接手：还原，等 ended 正常切
      S.index = prevIdx;
      S.track = prevTrack;
    }
    preAdvanced = false;
  }

  function seek(t) {
    if (S.dashAV) {
      const dur = video.duration || audio.duration;
      if (isFinite(t) && isFinite(dur)) {
        const x = Math.max(0, Math.min(t, dur));
        try { video.currentTime = x; } catch (e) {}
        try { audio.currentTime = x; } catch (e) {}
      }
      return;
    }
    const el = activeEl();
    if (isFinite(t) && isFinite(el.duration)) el.currentTime = Math.max(0, Math.min(t, el.duration));
  }

  function setVolume(v) {
    v = Math.max(0, Math.min(1, v));
    S.vol = v;
    localStorage.setItem('bp.vol', String(v));
    if (gainNode) { audio.volume = 1; video.volume = 1; gainNode.gain.value = v; }
    else { audio.volume = v; video.volume = v; }
  }
  function volume() { return S.vol !== undefined ? S.vol : audio.volume; }

  async function setMode(m) {
    if (m === S.mode || !cur()) return;
    if (S.dashAV && m !== 'video') {
      S.dashAV = false; stopDashSync();
      try { video.pause(); video.muted = false; } catch (e) {}
    }
    const el = activeEl();
    const t = el.currentTime || 0;
    const was = !el.paused;
    S.mode = m;
    S.slot = m === 'video' ? 'b' : 'a'; // 主元素跟随模式
    localStorage.setItem('bp.mode', m);
    try {
      await load(cur(), { seek: t, autoplay: was });
    } catch (e) { /* notify 已处理 */ }
  }

  function setPlaymode(pm) {
    S.playmode = pm;
    localStorage.setItem('bp.playmode', pm);
    notify();
  }

  function mountVideo(container) {
    if (container && video.parentElement !== container) {
      container.appendChild(video);
      video.style.width = '100%';
      video.style.height = '100%';
    }
  }
  function unmountVideo() {
    if (video.parentElement && video.parentElement !== holder) holder.appendChild(video);
  }

  [audio, video].forEach(el => {
    /* DASH 双流镜像：video 是画面主时钟，audio 是 FX/响度主元素 */
    if (el === video) {
      el.addEventListener('play', () => { if (S.dashAV && audio.paused) audio.play().catch(() => {}); });
      el.addEventListener('pause', () => { if (S.dashAV && !audio.paused) audio.pause(); });
      el.addEventListener('seeking', () => { if (S.dashAV) { try { audio.currentTime = video.currentTime; } catch (e) {} } });
      el.addEventListener('ended', () => {
        if (!S.dashAV || S._dashEnded) return;
        S._dashEnded = true;
        try { audio.pause(); } catch (e) {}
        step(1).catch(() => {});
      });
    }
    if (el === audio) {
      el.addEventListener('play', () => { if (S.dashAV && video.paused) video.play().catch(() => {}); });
      el.addEventListener('pause', () => { if (S.dashAV && !video.paused) video.pause(); });
    }
    // 只有"主元素"的事件才驱动全局状态（无缝切换期间副元素也在发声/发事件）
    el.addEventListener('play', () => { if (el !== activeEl()) return; S.playing = true; resumeAudio(); notify(); });
    el.addEventListener('pause', () => { clearStallTimer(el); if (el !== activeEl()) return; S.playing = false; notify(); });
    el.addEventListener('ended', () => {
      clearStallTimer(el);
      if (el !== activeEl()) return;
      if (S.dashAV && S._dashEnded) return;
      if (S.dashAV) S._dashEnded = true;
      if (preAdvanced) return; // 已提前交叉到下一首，等 swap 完成，别二次切歌
      if (S.playmode === 'one') { el.currentTime = 0; el.play().catch(() => {}); }
      else step(1).catch(() => {});
    });
    el.addEventListener('timeupdate', () => { clearStallTimer(el); if (el !== activeEl()) return; audioWatch(); preAdvance(el); notify({ tick: true }); });
    el.addEventListener('waiting', () => { if (el !== activeEl()) return; S.loading = true; armStallTimer(el); notify(); });
    el.addEventListener('playing', () => { if (el !== activeEl()) return; clearStallTimer(el); S.loading = false; notify(); });
    el.addEventListener('error', () => {
      if (!el.src || el !== activeEl() || S.dashAV) return;
      clearStallTimer(el);
      /* Hi-Res/无损直链播放失败时自动降档重试，避免整首报错 */
      const fb = el._qFallback;
      if (fb && fb.idx < fb.chain.length - 1) {
        fb.idx++;
        const q = fb.chain[fb.idx];
        el._qFallback = null;
        S.loading = true;
        notify();
        load(fb.item, { seek: el.currentTime || fb.seek || 0, autoplay: true, qualityOverride: q, autoDowngrade: fb.auto }).catch(() => {});
        return;
      }
      S.loading = false;
      S.playing = false;
      notify({ error: new Error('媒体加载失败') });
    });
  });

  return { S, audio, video, hooks, cur, activeEl, otherEl, setQueue, insertAfterCurrent, playCurrent, toggle, step, seek, setVolume, volume, fadeMs: () => fadePref, setFadeMs, loudTarget: () => loudTarget, setLoudTarget, loudPeakCeil: () => loudPeakCeil, setLoudPeakCeil, setMode, setPlaymode, mountVideo, unmountVideo, getSpectrum: spectrum, resumeAudio, audioState: () => (audioCtx ? audioCtx.state : 'none'), applyUserSpeed: () => { try { if (S.dashAV) { applyRate(audio); applyRate(video); } else { const el = activeEl(); if (el && el.src) applyRate(el); } } catch (e) {} }, crossfadeTo, crossfadeToBuffer, ensureCid, pickMedia: pickPlayableMedia, neMedia, eqState: () => ({ a: eqA ? eqA.gain.value : null, b: eqB ? eqB.gain.value : null }), audioDebug: () => ({ ctx: audioCtx ? audioCtx.state : 'none', sampleRate: audioCtx ? audioCtx.sampleRate : null, baseLatency: audioCtx && audioCtx.baseLatency != null ? +audioCtx.baseLatency.toFixed(4) : null, outputLatency: audioCtx && audioCtx.outputLatency != null ? +audioCtx.outputLatency.toFixed(4) : null, activeLoud: activeEl()._loud ? { key: activeEl()._loud.key, gDb: +activeEl()._loud.gDb.toFixed(2), locked: activeEl()._loud.locked, peak: +(activeEl()._loud.peak || 0).toFixed(3), peakCapDb: +capDbByPeak(99, activeEl()._loud.peak || 0).toFixed(2), lufs: activeEl()._loud.lufs != null ? +activeEl()._loud.lufs.toFixed(2) : null, target: loudTarget, peakCeil: loudPeakCeil, fadeMs: fadePref } : null, master: gainNode ? gainNode.gain.value : null, eqA: eqA ? eqA.gain.value : null, eqB: eqB ? eqB.gain.value : null, ga: gainA ? gainA.gain.value : null, gb: gainB ? gainB.gain.value : null, normA: normA ? +normA.gain.value.toFixed(3) : null, normB: normB ? +normB.gain.value.toFixed(3) : null, loudA: audio._loud ? { key: audio._loud.key, gDb: +audio._loud.gDb.toFixed(2), locked: audio._loud.locked } : null, loudB: video._loud ? { key: video._loud.key, gDb: +video._loud.gDb.toFixed(2), locked: video._loud.locked } : null }) };
})();
