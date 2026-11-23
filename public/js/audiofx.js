'use strict';
/* AudioFX 音效引擎：FX总线（EQ/宽度/环境混响/声场旋转/激励/夜听压缩/安全限制器/磁带/电子管/变调）
   插入点：gainA/gainB（交叉淡化之后）→ fxIn → [FX链] → out → analyser（原链路其余不动）
   设计依据：open-orpheus #139 云音效参数协议 + lx-music-desktop(Apache-2.0) 图骨架 + effetune(MIT) 参数级实现 */
(function () {
  const STORE_KEY = 'bp.audioFx';
  const CUSTOM_KEY = 'bp.fxCustomPresets';
  const CUSTOM_FIELDS = [
    'eq', 'width', 'widthHigh', 'depth', 'env', 'rotate', 'tube', 'tape', 'exciter',
    'night', 'nightAmount', 'vocal', 'crossfeed', 'crossfeedMid', 'cfDelay', 'cfFreq',
    'preamp', 'monoBass', 'presetTrim', 'autoLevel', 'fdnReverb', 'deEsser',
    'fdnSize', 'fdnDecay', 'fdnDamping', 'fdnEr', 'envPre', 'reverbDuck',
    'transient', 'transientSustain', 'transientHigh', 'transientFreq', 'loudness', 'deFreq', 'bassFreq',
    'dynEq', 'dynEqLow', 'dynEqMid', 'dynEqHigh', 'dynEqFLow', 'dynEqQLow', 'dynEqThLow', 'dynEqFMid', 'dynEqQMid', 'dynEqThMid', 'dynEqFHigh', 'dynEqQHigh', 'dynEqThHigh', 'bassExciter'
  ];
  const EQ_FREQS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const ENV_PRESETS = {
    none: null,
    bathroom: { decay: 0.6, pre: 0.008, lpStart: 12000, lpEnd: 4000, wet: 0.32, size: 0.55, damping: 0.55 },
    room: { decay: 1.0, pre: 0.015, lpStart: 10000, lpEnd: 3000, wet: 0.3, size: 0.7, damping: 0.45 },
    theatre: { decay: 1.4, pre: 0.022, lpStart: 9000, lpEnd: 2500, wet: 0.32, size: 1.0, damping: 0.35 },
    hall: { decay: 2.0, pre: 0.03, lpStart: 8500, lpEnd: 1800, wet: 0.34, size: 1.2, damping: 0.3 },
    church: { decay: 4.5, pre: 0.06, lpStart: 8000, lpEnd: 900, wet: 0.4, size: 1.45, damping: 0.4 }
  };
  const ROT_PRESETS = {
    off: null,
    '3d': { speed: 0.06, radius: 1.6, low: 1.0, spread: 0.28, fill: 0.22, makeup: 1.7 },
    '360': { speed: 0.11, radius: 1.3, low: 1.0, spread: 0.32, fill: 0.2, makeup: 1.8 },
    '8d': { speed: 0.16, radius: 1.0, low: 0.25, spread: 0.12, fill: 0.4, makeup: 1.35 }
  };
  /* presetTrim：预设响度对齐（dB），以“原声”RMS 为基准实测。混响/旋转/激励会改变 RMS，
     切换预设时若不补偿会出现近 9dB 的音量跳变；该增益放在交叉馈送后、限制器前。 */
  const PRESETS = {
    original: { label: '原声', desc: '不加任何处理' },
    '3d': { label: '3D环绕', desc: '戴耳机，慢速环绕的包裹感', apply: { rotate: '3d', env: 'room', depth: 0.6, presetTrim: -1.5 } },
    '360': { label: '360°环绕', desc: '全周旋转，声场整体转动', apply: { rotate: '360', env: 'theatre', depth: 0.7, width: 1.15, presetTrim: -1.9 } },
    '8d': { label: '8D环绕', desc: '快速穿颅而过的律动', apply: { rotate: '8d', env: 'hall', depth: 0.85, width: 1.1, presetTrim: 0.8 } },
    concert: { label: '演唱会现场', desc: '适合流行演唱会live版、摇滚', apply: { env: 'hall', depth: 0.95, eqBass: 4, width: 1.15, rotate: '3d', presetTrim: -1.4 } },
    panorama: { label: '震撼全景', desc: '超强声场的震撼效果', apply: { env: 'hall', depth: 1, eqBass: 6, eqBands: [0, -1.5, 0, 0, 0, 0, 1, 0, 1.5, 1], width: 1.35, tape: 0, presetTrim: 1.3 } },
    cathedral: { label: '教堂混响', desc: '还原教堂空旷的空间混响', apply: { env: 'church', depth: 1, eqTreble: -2, width: 1.1, presetTrim: -1.7 } },
    clear: { label: '清澈人声', desc: '降低浑浊，感受人声通透', apply: { eqBands: [0, -1, -2.5, -2, 0, 0.5, 2.5, 3, 1.5, 0.5], exciter: 0.15, presetTrim: 3.2 } },
    hires: { label: '高解析人声', desc: '增强解析力还原细节', apply: { eqBands: [0, 0, 0, 0, 0, 0.5, 0, 2, 2, 1.5], exciter: 0.25, width: 1.2, presetTrim: 0.8 } },
    tube: { label: 'HiFi电子管', desc: '适合爵士、老歌、蓝调', apply: { tube: 0.7, eqBands: [0, 0, 0, 0, 1.5, 1.5, 0, 0, 0, -2], eqBass: 1.5, presetTrim: 3.5 } },
    cassette: { label: '怀旧卡带机', desc: '还原老式卡带播放效果', apply: { tape: 0.85, eqBands: [0, 1, 0, 0, 0, 0, 0, -1.5, -4, -7], presetTrim: 1.2 } },
    ethereal: { label: '空灵人声', desc: '空灵飘渺的氛围感', apply: { env: 'church', depth: 0.85, exciter: 0.12, width: 1.3, eqBands: [0, 0, -1, 0, 0, 0, 0, 1.5, 2.5, 2.5], rotate: '3d', presetTrim: -3.0 } },
    headphone: { label: '耳机优化', desc: '交叉馈送 + 低频单声道，降低耳机声场疲劳', apply: { crossfeed: 0.55, eqBass: 1.5, eqTreble: -0.5, monoBass: true, preamp: -1, presetTrim: 1.2 } },
    headphonePlus: { label: '耳机优化+', desc: '双频段交叉馈送，人声更靠前、声场更自然', apply: { crossfeed: 0.7, crossfeedMid: 0.35, eqBass: 2, eqTreble: -1, monoBass: true, preamp: -1.5, presetTrim: -1.0 } }
  };

  function defaultState() {
    return {
      preset: 'original',
      speed: 1,
      eq: { bass: 0, treble: 0, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      width: 1, widthHigh: 1, depth: 0, env: 'none',
      rotate: 'off', tube: 0, tape: 0, exciter: 0,
      night: false, pitch: 0, vocal: 'normal', crossfeed: 0, crossfeedMid: 0, cfDelay: 0.3, cfFreq: 700, preamp: 0, monoBass: false, presetTrim: 0,
      autoLevel: true, bypass: false, headphone: null, fdnReverb: true, deEsser: 0, nightAmount: 1,
      fdnSize: null, fdnDecay: null, fdnDamping: null, fdnEr: null, envPre: null, reverbDuck: 0, perfMode: false, deFreq: 5000, bassFreq: 120,
      transient: 0, transientSustain: 0, transientHigh: false, transientFreq: 2000, loudness: 0,
      dynEq: 0, dynEqLow: 1, dynEqMid: 1, dynEqHigh: 1, dynEqFLow: 180, dynEqQLow: 0.9, dynEqThLow: -11, dynEqFMid: 1200, dynEqQMid: 1.3, dynEqThMid: -13, dynEqFHigh: 3500, dynEqQHigh: 1.2, dynEqThHigh: -15, bassExciter: 0
    };
  }

  let S = defaultState();
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      const hadTrim = Object.prototype.hasOwnProperty.call(saved, 'presetTrim');
      S = Object.assign(defaultState(), saved);
      if (!S.eq || !Array.isArray(S.eq.bands) || S.eq.bands.length !== 10) S.eq = defaultState().eq;
      if (S.headphone && (!Array.isArray(S.headphone.filters) || !S.headphone.filters.length)) S.headphone = null;
      /* 旧存档没有 presetTrim：按当前预设补上，避免升级后响度补偿丢失 */
      if (!hadTrim) {
        const p = PRESETS[S.preset];
        S.presetTrim = p && p.apply && typeof p.apply.presetTrim === 'number' ? p.apply.presetTrim : 0;
      }
    }
  } catch (e) {}

  /* 状态→预设检测：声音色彩模块全部中性=original；与某预设配方完全一致=该预设；否则=custom */
  function detectPreset(s) {
    const d = defaultState();
    const colorKeys = ['env', 'rotate', 'width', 'depth', 'tube', 'tape', 'exciter', 'crossfeed', 'crossfeedMid', 'preamp', 'monoBass'];
    const eqNeutral = s.eq.bass === 0 && s.eq.treble === 0 && s.eq.bands.every(v => !v);
    if (colorKeys.every(k => s[k] === d[k]) && eqNeutral) return 'original';
    for (const k of Object.keys(PRESETS)) {
      if (k === 'original') continue;
      const eff = Object.assign(defaultState(), PRESETS[k].apply || {});
      if (PRESETS[k].apply) {
        if (PRESETS[k].apply.eqBass !== undefined) eff.eq.bass = PRESETS[k].apply.eqBass;
        if (PRESETS[k].apply.eqTreble !== undefined) eff.eq.treble = PRESETS[k].apply.eqTreble;
        if (PRESETS[k].apply.eqBands) eff.eq.bands = PRESETS[k].apply.eqBands.slice();
      }
      const same = colorKeys.every(k2 => s[k2] === eff[k2]) &&
        s.eq.bass === eff.eq.bass && s.eq.treble === eff.eq.treble &&
        s.eq.bands.every((v, i) => v === eff.eq.bands[i]);
      if (same) return k;
    }
    return 'custom';
  }
  let ctx = null, built = false;
  const n = {};
  let lfoX = null, lfoZ = null, hissSrc = null;
  let pitchNode = null, pitchReady = false;
  let pitchEngineName = 'soundtouch';
  try { if (localStorage.getItem('bp.pitchEngine') === 'signalsmith') pitchEngineName = 'signalsmith'; } catch (e) {}
  let lastPitchSent = null;
  let pitchMetrics = { underrunCount: 0, framesBuffered: 0, blockCount: 0, outputRms: 0, outputPeak: 0, engine: 'soundtouch', latency: 0 };
  let wLimiterReady = false, wLimiterLoading = false, limiterGrDb = 0, limiterVer = '', limiterPeak = 0, limiterPeakMax = 0, limiterThr = 0, limiterPhases = 8;
  let fdnNode = null, fdnReady = false, fdnLoading = false;
  let trNode = null, trReady = false, trLoading = false;
  let dynNode = null, dynReady = false, dynLoading = false, dynGr = [0, 0, 0];
  let duckNode = null, duckReady = false, duckLoading = false, duckDb = 0;
  let deNode = null, deReady = false, deLoading = false, deWlReduction = 0;
  let volLevel = 0.8;
  let deTimer = 0;
  /* 音效自动响度：干/湿同窗 RMS 比对，慢速把预设残差收敛到 0dB；只作用于 FX 内部，不碰媒体响度归一 */
  let autoDb = 0, alDry = 0, alWet = 0, alN = 0, alLast = 0, alTimer = 0;
  const _meterBuf = new Float32Array(1024);
  let meterMax = 0;

  /* 波形整形曲线：按小信号增益 g0=曲线在0处导数 归一。
     旧版直接 tanh(kx)/tanh(k) 在弱信号处有 +6~9dB 提升，一开效果就"变响变糊"，是预设听起来雷同的主因之一。 */
  function makeCurve(kind, drive) {
    const N = 8192, c = new Float32Array(N);
    if (kind === 'tube') {
      // 不对称软饱和（偶次谐波=管味），去DC；g0 = D*(1-tanh²(D*b))
      const b = 0.15, D = Math.max(0.2, drive);
      const th = Math.tanh(D * b);
      const g0 = Math.max(0.01, D * (1 - th * th));
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 2 - 1;
        c[i] = (Math.tanh(D * (x + b)) - th) / g0;
      }
    } else {
      // tanh 饱和；g0 = k/tanh(k)，k=1+drive*3（drive 0..1 为强度）
      const k = 1 + Math.max(0, drive) * 3;
      const g0 = Math.max(0.01, k / Math.tanh(k));
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 2 - 1;
        c[i] = Math.tanh(k * x) / g0;
      }
    }
    return c;
  }
  /* 输出安全软限幅：|x|<=0.9 完全透明，超过后 tanh 软削顶，避免 EQ/混响/饱和叠加后硬削波 */
  function makeSafetyCurve() {
    const N = 8192, c = new Float32Array(N), th = 0.97;
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      const ax = Math.abs(x);
      c[i] = ax <= th ? x : Math.sign(x) * (th + (1 - th) * Math.tanh((ax - th) / (1 - th)));
    }
    return c;
  }
  /* Paul Kellett 粉噪（-3dB/oct）：混响尾与磁带嘶声都用它，比白噪更自然 */
  let k0, k1, k2, k3, k4, k5, k6;
  function pinkReset() { k0 = k1 = k2 = k3 = k4 = k5 = k6 = 0; }
  function pinkNext(w) {
    k0 = 0.99886 * k0 + w * 0.0555179;
    k1 = 0.99332 * k1 + w * 0.0750759;
    k2 = 0.96900 * k2 + w * 0.1538520;
    k3 = 0.86650 * k3 + w * 0.3104856;
    k4 = 0.55000 * k4 + w * 0.5329522;
    k5 = -0.7616 * k5 - w * 0.0168980;
    const p = (k0 + k1 + k2 + k3 + k4 + k5 + k6 + w * 0.5362) * 0.11;
    k6 = w * 0.115926;
    return p;
  }
  /* 程序化IR：粉噪尾 + 离散早期反射 + 高频更快衰减 + 立体声去相关 */
  function genIR(preset) {
    const sr = ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * preset.decay));
    const buf = ctx.createBuffer(2, len, sr);
    const preN = Math.floor(sr * preset.pre);
    const taps = [[0.011, 0.24], [0.017, 0.20], [0.023, 0.17], [0.031, 0.14], [0.039, 0.115], [0.047, 0.095], [0.057, 0.075], [0.067, 0.06]];
    const fadeN = Math.max(1, Math.floor(sr * 0.004));
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      pinkReset();
      let lp = 0;
      for (let i = 0; i < len; i++) {
        if (i < preN) { d[i] = 0; continue; }
        const t = (i - preN) / (len - preN);
        const env = Math.pow(10, -3 * t); // -60dB @ RT60
        const pn = pinkNext(Math.random() * 2 - 1);
        // 频率阻尼：截止频率从 lpStart 随 (1-t)² 降到 lpEnd（高频衰减更快）
        const cut = preset.lpEnd + (preset.lpStart - preset.lpEnd) * Math.pow(1 - t, 2);
        const co = Math.min(0.95, Math.max(0.0001, 1 - Math.exp(-2 * Math.PI * cut / sr)));
        lp += co * (pn - lp);
        d[i] = lp * env;
      }
      // 早期反射：离散tap + 左右±1.3ms 时差，给出明确空间位置感
      const off = ch ? 0.0013 : -0.0013;
      for (const [tt, gg] of taps) {
        const idx = preN + Math.floor((tt + off) * sr);
        if (idx >= 0 && idx < len) {
          const g = gg * (ch ? 0.92 : 1);
          for (let j = 0; j < fadeN && idx + j < len; j++) d[idx + j] += g * (1 - j / fadeN);
        }
      }
      for (let i = preN; i < Math.min(len, preN + fadeN); i++) d[i] *= (i - preN) / fadeN;
    }
    return buf;
  }
  function pinkBuffer(seconds) {
    const sr = ctx.sampleRate, len = Math.floor(sr * (seconds || 2));
    const buf = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      pinkReset();
      for (let i = 0; i < len; i++) d[i] = pinkNext(Math.random() * 2 - 1) * 0.18;
    }
    return buf;
  }
  const setP = (param, v, tau) => { try { param.setTargetAtTime(v, ctx.currentTime, tau || 0.02); } catch (e) {} };
  const _autoBuf = new Float32Array(2048);
  function rmsAn(an) {
    if (!an) return 0;
    const n = an.fftSize;
    try { an.getFloatTimeDomainData(_autoBuf); } catch (e) { return 0; }
    let s = 0;
    for (let i = 0; i < n; i++) s += _autoBuf[i] * _autoBuf[i];
    return Math.sqrt(s / n);
  }
  let alWasOn = true;
  function autoLevelTick() {
    if (!built || !ctx || !n.autoGain) return;
    if (S.headphone && Array.isArray(S.headphone.filters) && S.headphone.filters.length) return; // 校准开启时冻结自动响度
    if (S.bypass) return; // 旁通时冻结自动响度，恢复后继续
    if (!S.autoLevel) {
      if (alWasOn) { alWasOn = false; alN = 0; alDry = 0; alWet = 0; }
      if (Math.abs(n.autoGain.gain.value - 1) > 0.001) setP(n.autoGain.gain, 1, 0.4);
      return;
    }
    if (!alWasOn) { alWasOn = true; alN = 0; alDry = 0; alWet = 0; autoDb = 0; }
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const dt = alLast ? Math.min(1, now - alLast) : 0.5;
    alLast = now;
    const dry = rmsAn(n.dryMeter), wet = rmsAn(n.preLim);
    if (dry < 0.004 || wet < 0.001) return;
    const a = 1 - Math.exp(-dt / 4.0);
    alDry += a * (dry - alDry);
    alWet += a * (wet - alWet);
    alN += dt;
    if (alN < 2.5) return;
    const errDb = 20 * Math.log10(alDry / alWet);
    if (Math.abs(errDb) < 0.2) return;
    const step = Math.max(-0.35, Math.min(0.35, errDb * 0.12));
    autoDb = Math.max(-4, Math.min(4, autoDb + step));
    setP(n.autoGain.gain, Math.pow(10, autoDb / 20), 0.6);
  }

  async function ensureWorkletLimiter() {
    if (wLimiterReady || wLimiterLoading || !ctx || !n.wLimIn) return;
    wLimiterLoading = true;
    try {
      await ctx.audioWorklet.addModule('/js/vendor/peak-limiter-worklet.js?v=fir64x8p');
      const node = new AudioWorkletNode(ctx, 'peak-limiter-processor', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        parameterData: { threshold: -1, release: 120, phases: 8 }
      });
      try { n.wLimIn.disconnect(); } catch (e) {}
      n.wLimIn.connect(node);
      node.connect(n.safety);
      node.port.onmessage = e => {
        if (e.data && typeof e.data.grDb === 'number') limiterGrDb = e.data.grDb;
        if (e.data && e.data.ver) limiterVer = e.data.ver;
        if (e.data && typeof e.data.phases === 'number') limiterPhases = e.data.phases;
        if (e.data && typeof e.data.peak === 'number') { limiterPeak = e.data.peak; if (e.data.peak > limiterPeakMax) limiterPeakMax = e.data.peak; }
        if (e.data && typeof e.data.thr === 'number') limiterThr = e.data.thr;
      };
      n.wLimiter = node;
      limiterGrDb = 0;
      limiterVer = '';
      wLimiterReady = true;
    } catch (e) {
      wLimiterReady = false;
    } finally {
      wLimiterLoading = false;
    }
  }

  function applyReverb() {
    if (!n.convWet) return;
    const useFdn = !!(fdnReady && S.fdnReverb !== false && !S.perfMode);
    setP(n.convWet.gain, useFdn ? 0 : 1, 0.1);
    setP(n.fdnWet.gain, useFdn ? 1 : 0, 0.1);
    if (!fdnNode) return;
    const ep = ENV_PRESETS[S.env] || ENV_PRESETS.hall;
    const size = S.fdnSize != null ? Math.max(0.3, Math.min(2, Number(S.fdnSize))) : (ep.size || 1);
    const decay = S.fdnDecay != null ? Math.max(0.2, Math.min(8, Number(S.fdnDecay))) : (ep.decay || 2);
    const damping = S.fdnDamping != null ? Math.max(0, Math.min(1, Number(S.fdnDamping))) : (ep.damping != null ? ep.damping : 0.3);
    const erMix = S.fdnEr != null ? Math.max(0, Math.min(1, Number(S.fdnEr))) : 0.3;
    try {
      setP(fdnNode.parameters.get('size'), size, 0.15);
      setP(fdnNode.parameters.get('decay'), decay, 0.15);
      setP(fdnNode.parameters.get('damping'), damping, 0.15);
      setP(fdnNode.parameters.get('modDepth'), 0.0002, 0.15);
      setP(fdnNode.parameters.get('erMix'), erMix, 0.15);
    } catch (e) {}
  }
  async function ensureFdnReverb() {
    if (fdnReady || fdnLoading || !ctx || !n.fdnIn) return;
    fdnLoading = true;
    try {
      await ctx.audioWorklet.addModule('/js/vendor/fdn-reverb-worklet.js?v=fdn6');
      fdnNode = new AudioWorkletNode(ctx, 'fdn-reverb', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit'
      });
      n.fdnIn.connect(fdnNode);
      fdnNode.connect(n.fdnOut);
      fdnReady = true;
      applyReverb();
    } catch (e) {
      fdnReady = false;
    } finally {
      fdnLoading = false;
    }
  }

  async function ensureTransient() {
    if (trReady || trLoading || !ctx || !n.deOut) return;
    trLoading = true;
    try {
      await ctx.audioWorklet.addModule('/js/vendor/transient-shaper-worklet.js?v=tr4');
      const node = new AudioWorkletNode(ctx, 'transient-shaper', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit'
      });
      try { n.deOut.disconnect(); } catch (e) {}
      n.deOut.connect(node);
      node.connect(n.tapeDry);
      node.connect(n.tapeDelay);
      trNode = node;
      trReady = true;
      applyAll();
    } catch (e) {
      trReady = false;
    } finally {
      trLoading = false;
    }
  }

  async function ensureDynEq() {
    if (dynReady || dynLoading || !ctx || !n.postEq) return;
    dynLoading = true;
    try {
      await ctx.audioWorklet.addModule('/js/vendor/dynamic-eq-worklet.js?v=deq2');
      const node = new AudioWorkletNode(ctx, 'dynamic-eq', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit'
      });
      node.port.onmessage = e => {
        if (e.data && Array.isArray(e.data.gr)) dynGr = e.data.gr;
      };
      try { n.postEq.disconnect(); } catch (e) {}
      n.postEq.connect(node);
      node.connect(n.loudBass);
      dynNode = node;
      dynReady = true;
      applyAll();
    } catch (e) {
      dynReady = false;
    } finally {
      dynLoading = false;
    }
  }

  async function ensureDuck() {
    if (duckReady || duckLoading || !ctx || !n.envWet || !n.envHP) return;
    duckLoading = true;
    try {
      await ctx.audioWorklet.addModule('/js/vendor/ducking-worklet.js?v=duck1');
      const node = new AudioWorkletNode(ctx, 'reverb-duck', {
        numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit'
      });
      node.port.onmessage = e => {
        if (e.data && typeof e.data.duckDb === 'number') duckDb = e.data.duckDb;
      };
      n.envWet.connect(node, 0, 0);
      n.envIn.connect(node, 0, 1);
      node.connect(n.envHP);
      try { n.envWet.disconnect(n.envHP); } catch (e) {}
      duckNode = node;
      duckReady = true;
      applyAll();
    } catch (e) {
      duckReady = false;
    } finally {
      duckLoading = false;
    }
  }

  async function ensureDeEsserWorklet() {
    if (deReady || deLoading || !ctx || !n.deIn) return;
    deLoading = true;
    try {
      await ctx.audioWorklet.addModule('/js/vendor/deesser-worklet.js?v=de2');
      const node = new AudioWorkletNode(ctx, 'de-esser', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        channelCount: 2, channelCountMode: 'explicit'
      });
      node.port.onmessage = e => {
        if (e.data && typeof e.data.reduction === 'number') deWlReduction = e.data.reduction;
      };
      try { n.deIn.disconnect(); } catch (e) {}
      n.deIn.connect(node);
      node.connect(n.deOut);
      deNode = node;
      deReady = true;
      applyAll();
    } catch (e) {
      deReady = false;
    } finally {
      deLoading = false;
    }
  }

  function build(context) {
    ctx = context;
    n.fxIn = ctx.createGain();
    n.preamp = ctx.createGain();
    n.preamp.gain.value = Math.pow(10, (Number(S.preamp) || 0) / 20);
    /* ---- 耳机校准（AutoEQ 参数 EQ）：放在用户 EQ 之前；关闭时 hpDry 直通 ---- */
    n.hpDry = ctx.createGain(); n.hpDry.gain.value = 1;
    n.hpWet = ctx.createGain(); n.hpWet.gain.value = 0;
    n.hpPreamp = ctx.createGain(); n.hpPreamp.gain.value = 1;
    n.hpFilters = Array.from({ length: 10 }, () => {
      const b = ctx.createBiquadFilter();
      b.type = 'peaking'; b.frequency.value = 1000; b.Q.value = 1; b.gain.value = 0;
      return b;
    });
    n.fxIn.connect(n.hpDry); n.hpDry.connect(n.preamp);
    n.fxIn.connect(n.hpPreamp);
    let hpPrev = n.hpPreamp;
    n.hpFilters.forEach(b => { hpPrev.connect(b); hpPrev = b; });
    hpPrev.connect(n.hpWet); n.hpWet.connect(n.preamp);
    /* ---- EQ：bass搁架95Hz + 10段peaking(比例Q) + treble搁架13kHz（透明：全0dB） ---- */
    n.eqBass = ctx.createBiquadFilter(); n.eqBass.type = 'lowshelf'; n.eqBass.frequency.value = 95; n.eqBass.Q.value = 0.707; n.eqBass.gain.value = S.eq.bass;
    n.eqB = EQ_FREQS.map((f, i) => { const b = ctx.createBiquadFilter(); b.type = 'peaking'; b.frequency.value = f; b.Q.value = 0.9; b.gain.value = S.eq.bands[i] || 0; return b; });
    n.eqTreble = ctx.createBiquadFilter(); n.eqTreble.type = 'highshelf'; n.eqTreble.frequency.value = 13000; n.eqTreble.Q.value = 0.707; n.eqTreble.gain.value = S.eq.treble;
    n.postEq = ctx.createGain();
    let prev = n.preamp;
    const link = x => { prev.connect(x); prev = x; };
    link(n.eqBass); n.eqB.forEach(link); link(n.eqTreble); link(n.postEq);

    /* ---- 磁带（全湿式：抖晃+滚降+饱和）：旧版干湿混合会与8ms延迟形成梳状滤波（62.5/187.5Hz深谷） ---- */
    n.tapeDry = ctx.createGain();
    n.tapeWet = ctx.createGain();
    n.tapeDelay = ctx.createDelay(0.06); n.tapeDelay.delayTime.value = 0.008;
    /* 多分量抖晃 LFO：wow 0.33/0.61/0.93Hz，flutter 4.3/6.1/8.2Hz（单一LFO太机械） */
    const mkLfo = (type, f) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(n.tapeDelay.delayTime); o.start();
      return g;
    };
    n.wowG1 = mkLfo('sine', 0.33); n.wowG2 = mkLfo('sine', 0.61); n.wowG3 = mkLfo('sine', 0.93);
    n.flutG1 = mkLfo('sine', 4.3); n.flutG2 = mkLfo('triangle', 6.1); n.flutG3 = mkLfo('sine', 8.2);
    n.tapeLP = ctx.createBiquadFilter(); n.tapeLP.type = 'lowpass'; n.tapeLP.frequency.value = 12000;
    /* 磁带预加重/去加重 + 磁头低频 bump：让饱和产生更多高频谐波，再恢复频响 */
    n.tapePre = ctx.createBiquadFilter(); n.tapePre.type = 'highshelf'; n.tapePre.frequency.value = 3500; n.tapePre.gain.value = 0;
    n.tapeShaper = ctx.createWaveShaper(); n.tapeShaper.curve = makeCurve('tanh', 0); n.tapeShaper.oversample = '4x';
    n.tapeDe = ctx.createBiquadFilter(); n.tapeDe.type = 'highshelf'; n.tapeDe.frequency.value = 3500; n.tapeDe.gain.value = 0;
    n.tapeBump = ctx.createBiquadFilter(); n.tapeBump.type = 'lowshelf'; n.tapeBump.frequency.value = 90; n.tapeBump.gain.value = 0;
    n.tapeHiss = ctx.createGain(); n.tapeHiss.gain.value = 0;
    n.hissHP = ctx.createBiquadFilter(); n.hissHP.type = 'highpass'; n.hissHP.frequency.value = 350;
    n.hissLP = ctx.createBiquadFilter(); n.hissLP.type = 'lowpass'; n.hissLP.frequency.value = 9000;
    /* ---- 去齿音：5kHz LR4 分频，仅对高频段做快速压缩，避免直接砍高音 ---- */
    n.deIn = ctx.createGain();
    n.deOut = ctx.createGain();
    n.deBypass = ctx.createGain(); n.deBypass.gain.value = 1;
    n.deWet = ctx.createGain(); n.deWet.gain.value = 0;
    n.deLowA = ctx.createBiquadFilter(); n.deLowA.type = 'lowpass'; n.deLowA.frequency.value = 5000; n.deLowA.Q.value = 0.707;
    n.deLowB = ctx.createBiquadFilter(); n.deLowB.type = 'lowpass'; n.deLowB.frequency.value = 5000; n.deLowB.Q.value = 0.707;
    n.deHighA = ctx.createBiquadFilter(); n.deHighA.type = 'highpass'; n.deHighA.frequency.value = 5000; n.deHighA.Q.value = 0.707;
    n.deHighB = ctx.createBiquadFilter(); n.deHighB.type = 'highpass'; n.deHighB.frequency.value = 5000; n.deHighB.Q.value = 0.707;
    n.deComp = ctx.createDynamicsCompressor();
    n.deComp.threshold.value = -18; n.deComp.knee.value = 6; n.deComp.ratio.value = 1;
    n.deComp.attack.value = 0.002; n.deComp.release.value = 0.05;
    n.deHighGain = ctx.createGain(); n.deHighGain.gain.value = 1;
    n.deSum = ctx.createGain();
    /* 等响度补偿：音量越低，低频/高频搁架补偿越多（近似 Fletcher-Munson） */
    n.loudBass = ctx.createBiquadFilter(); n.loudBass.type = 'lowshelf'; n.loudBass.frequency.value = 110; n.loudBass.Q.value = 0.707; n.loudBass.gain.value = 0;
    n.loudTreble = ctx.createBiquadFilter(); n.loudTreble.type = 'highshelf'; n.loudTreble.frequency.value = 9000; n.loudTreble.Q.value = 0.707; n.loudTreble.gain.value = 0;
    n.postEq.connect(n.loudBass); n.loudBass.connect(n.loudTreble); n.loudTreble.connect(n.deIn);
    /* 低频激励：120Hz 以下取两阶低通，驱动软饱和产生谐波，90Hz 高通去掉基频后并联回主链 */
    n.bassLP1 = ctx.createBiquadFilter(); n.bassLP1.type = 'lowpass'; n.bassLP1.frequency.value = 120; n.bassLP1.Q.value = 0.707;
    n.bassLP2 = ctx.createBiquadFilter(); n.bassLP2.type = 'lowpass'; n.bassLP2.frequency.value = 120; n.bassLP2.Q.value = 0.707;
    n.bassDrive = ctx.createGain(); n.bassDrive.gain.value = 1;
    n.bassShape = ctx.createWaveShaper(); n.bassShape.curve = makeCurve('tanh', 0); n.bassShape.oversample = '4x';
    n.bassHP = ctx.createBiquadFilter(); n.bassHP.type = 'highpass'; n.bassHP.frequency.value = 130; n.bassHP.Q.value = 0.707;
    n.bassWet = ctx.createGain(); n.bassWet.gain.value = 0;
    n.loudTreble.connect(n.bassLP1); n.bassLP1.connect(n.bassLP2); n.bassLP2.connect(n.bassDrive);
    n.bassDrive.connect(n.bassShape); n.bassShape.connect(n.bassHP); n.bassHP.connect(n.bassWet); n.bassWet.connect(n.deIn);
    n.deIn.connect(n.deBypass); n.deBypass.connect(n.deOut);
    n.deIn.connect(n.deLowA); n.deLowA.connect(n.deLowB); n.deLowB.connect(n.deSum);
    n.deIn.connect(n.deHighA); n.deHighA.connect(n.deHighB); n.deHighB.connect(n.deComp);
    n.deComp.connect(n.deHighGain); n.deHighGain.connect(n.deSum);
    n.deSum.connect(n.deWet); n.deWet.connect(n.deOut);
    n.deOut.connect(n.tapeDry);
    n.deOut.connect(n.tapeDelay); n.tapeDelay.connect(n.tapeLP); n.tapeLP.connect(n.tapePre);
    n.tapePre.connect(n.tapeShaper); n.tapeShaper.connect(n.tapeDe); n.tapeDe.connect(n.tapeBump); n.tapeBump.connect(n.tapeWet);
    n.hissSrc = ctx.createBufferSource(); n.hissSrc.buffer = pinkBuffer(2); n.hissSrc.loop = true;
    n.hissSrc.connect(n.hissHP); n.hissHP.connect(n.hissLP); n.hissLP.connect(n.tapeHiss);
    n.hissSrc.start();

    /* ---- 电子管（并联软饱和：干=1-tube / 湿=tube，曲线已按小信号归一） ---- */
    n.tubeDry = ctx.createGain(); n.tubeDry.gain.value = 1 - S.tube;
    n.tubeShaper = ctx.createWaveShaper(); n.tubeShaper.curve = makeCurve('tube', 0.8 + S.tube * 1.8); n.tubeShaper.oversample = '4x';
    n.tubeWet = ctx.createGain(); n.tubeWet.gain.value = S.tube;
    n.tubeLP = ctx.createBiquadFilter(); n.tubeLP.type = 'lowpass'; n.tubeLP.frequency.value = 15000;
    n.tubeMid = ctx.createBiquadFilter(); n.tubeMid.type = 'peaking'; n.tubeMid.frequency.value = 900; n.tubeMid.Q.value = 0.8; n.tubeMid.gain.value = 0;
    n.tubeDC = ctx.createBiquadFilter(); n.tubeDC.type = 'highpass'; n.tubeDC.frequency.value = 20; n.tubeDC.Q.value = 0.707;
    n.wIn = ctx.createGain();
    n.tapeDry.connect(n.wIn); n.tapeWet.connect(n.wIn); n.tapeHiss.connect(n.wIn);
    n.wIn.connect(n.tubeDry); n.wIn.connect(n.tubeShaper);
    n.tubeShaper.connect(n.tubeLP); n.tubeLP.connect(n.tubeMid); n.tubeMid.connect(n.tubeDC); n.tubeDC.connect(n.tubeWet);

    /* ---- M/S 宽度 + 人声模式 ---- */
    n.split = ctx.createChannelSplitter(2);
    n.midL = ctx.createGain(); n.midL.gain.value = 0.5;
    n.midR = ctx.createGain(); n.midR.gain.value = 0.5;
    n.sideL = ctx.createGain(); n.sideL.gain.value = 0.5;
    n.sideRinv = ctx.createGain(); n.sideRinv.gain.value = -0.5;
    n.sumMid = ctx.createGain(); n.sumSide = ctx.createGain();
    n.gainM = ctx.createGain(); n.gainM.gain.value = 1;
    n.wSide = ctx.createGain(); n.wSide.gain.value = S.width;
    n.wSideInv = ctx.createGain(); n.wSideInv.gain.value = -S.width;
    n.sideHP = ctx.createBiquadFilter(); n.sideHP.type = 'highpass'; n.sideHP.frequency.value = 120; n.sideHP.Q.value = 0.707;
    n.sideLP = ctx.createBiquadFilter(); n.sideLP.type = 'lowpass'; n.sideLP.frequency.value = 120; n.sideLP.Q.value = 0.707;
    /* 三段宽度：<120Hz 低频侧信号单独处理；>120Hz 走基础宽度，4kHz 以上由侧信号搁架额外加宽 */
    n.sideHS = ctx.createBiquadFilter(); n.sideHS.type = 'highshelf'; n.sideHS.frequency.value = 4000; n.sideHS.Q.value = 0.707; n.sideHS.gain.value = 0;
    n.wSideLow = ctx.createGain(); n.wSideLow.gain.value = S.width;
    n.wSideLowInv = ctx.createGain(); n.wSideLowInv.gain.value = -S.width;
    n.merge = ctx.createChannelMerger(2);
    n.tubeDry.connect(n.split); n.tubeWet.connect(n.split);
    n.split.connect(n.midL, 0); n.split.connect(n.midR, 1);
    n.split.connect(n.sideL, 0); n.split.connect(n.sideRinv, 1);
    n.midL.connect(n.sumMid); n.midR.connect(n.sumMid);
    n.sideL.connect(n.sumSide); n.sideRinv.connect(n.sumSide);
    n.sumMid.connect(n.gainM);
    /* 侧信号分频：<120Hz 走 wSideLow（monoBass 归零）；>120Hz 经 sideHS 高频搁架后走 wSide */
    n.sumSide.connect(n.sideHP);
    n.sideHP.connect(n.sideHS); n.sideHS.connect(n.wSide); n.wSide.connect(n.wSideInv);
    n.sumSide.connect(n.sideLP); n.sideLP.connect(n.wSideLow); n.wSideLow.connect(n.wSideLowInv);
    n.gainM.connect(n.merge, 0, 0); n.gainM.connect(n.merge, 0, 1);
    n.wSide.connect(n.merge, 0, 0);
    n.wSideInv.connect(n.merge, 0, 1);
    n.wSideLow.connect(n.merge, 0, 0);
    n.wSideLowInv.connect(n.merge, 0, 1);
    n.envIn = ctx.createGain(); n.merge.connect(n.envIn);

    /* ---- 环境混响（程序IR，Convolver） ---- */
    n.envDry = ctx.createGain(); n.envSum = ctx.createGain();
    n.envPre = ctx.createDelay(0.2); n.envPre.delayTime.value = 0.01;
    n.conv = ctx.createConvolver(); n.conv.normalize = true;
    n.convWet = ctx.createGain(); n.convWet.gain.value = 1;
    n.fdnIn = ctx.createGain();
    n.fdnOut = ctx.createGain();
    n.fdnWet = ctx.createGain(); n.fdnWet.gain.value = 0;
    n.envWet = ctx.createGain(); n.envWet.gain.value = 0;
    /* 湿声只保留 180Hz–10kHz：低频不浑、高频不刺，干声仍全频直通 */
    n.envHP = ctx.createBiquadFilter(); n.envHP.type = 'highpass'; n.envHP.frequency.value = 180; n.envHP.Q.value = 0.707;
    n.envLP = ctx.createBiquadFilter(); n.envLP.type = 'lowpass'; n.envLP.frequency.value = 10000; n.envLP.Q.value = 0.707;
    n.envIn.connect(n.envDry); n.envDry.connect(n.envSum);
    n.envIn.connect(n.envPre);
    n.envPre.connect(n.conv); n.conv.connect(n.convWet); n.convWet.connect(n.envWet);
    n.envPre.connect(n.fdnIn); n.fdnOut.connect(n.fdnWet); n.fdnWet.connect(n.envWet);
    n.envWet.connect(n.envHP); n.envHP.connect(n.envLP); n.envLP.connect(n.envSum);
    const ep = ENV_PRESETS[S.env];
    if (ep) { n.conv.buffer = genIR(ep); n.envPre.delayTime.value = ep.pre; setP(n.envWet.gain, ep.wet * S.depth, 0.05); }
    else { n.conv.buffer = genIR(ENV_PRESETS.hall); setP(n.envWet.gain, 0, 0.02); }

    /* ---- 声场旋转（HRTF Panner + LFO轨道；低频分离居中） ---- */
    n.rotIn = ctx.createGain();
    n.rotLP = ctx.createBiquadFilter(); n.rotLP.type = 'lowpass'; n.rotLP.frequency.value = 350;
    n.rotHP = ctx.createBiquadFilter(); n.rotHP.type = 'highpass'; n.rotHP.frequency.value = 350;
    n.rotLow = ctx.createGain(); n.rotLow.gain.value = 1;
    n.rotHigh = ctx.createGain(); n.rotHigh.gain.value = 0;
    n.pannerL = ctx.createPanner();
    n.pannerL.panningModel = 'HRTF';
    n.pannerL.distanceModel = 'linear'; n.pannerL.refDistance = 1; n.pannerL.rolloffFactor = 0;
    n.pannerL.positionZ.value = -1;
    n.pannerR = ctx.createPanner();
    n.pannerR.panningModel = 'HRTF';
    n.pannerR.distanceModel = 'linear'; n.pannerR.refDistance = 1; n.pannerR.rolloffFactor = 0;
    n.pannerR.positionZ.value = -1;
    n.rotSplit = ctx.createChannelSplitter(2);
    n.rotHighL = ctx.createGain(); n.rotHighL.gain.value = 0.5;
    n.rotFill = ctx.createGain(); n.rotFill.gain.value = 0;
    n.rotHighR = ctx.createGain(); n.rotHighR.gain.value = 0.5;
    n.rotOscX = ctx.createOscillator(); n.rotOscX.frequency.value = 0.001; // 静止
    n.rotGX = ctx.createGain(); n.rotGX.gain.value = 0;
    n.rotOscZ = ctx.createOscillator();
    try { n.rotOscZ.setPeriodicWave(ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]), { disableNormalization: true })); } catch (e) { n.rotOscZ.type = 'sine'; }
    n.rotGZ = ctx.createGain(); n.rotGZ.gain.value = 0;
    /* 右 Panner 的相位偏移：X_R=cosφ·X+sinφ·Z，Z_R=cosφ·Z−sinφ·X */
    n.rotRCX = ctx.createGain(); n.rotRCX.gain.value = 0;
    n.rotRSX = ctx.createGain(); n.rotRSX.gain.value = 0;
    n.rotRCZ = ctx.createGain(); n.rotRCZ.gain.value = 0;
    n.rotRSZ = ctx.createGain(); n.rotRSZ.gain.value = 0;
    n.rotOscX.connect(n.rotGX); n.rotGX.connect(n.pannerL.positionX);
    n.rotOscZ.connect(n.rotGZ); n.rotGZ.connect(n.pannerL.positionZ);
    n.rotGX.connect(n.rotRCX); n.rotRCX.connect(n.pannerR.positionX);
    n.rotGZ.connect(n.rotRSX); n.rotRSX.connect(n.pannerR.positionX);
    n.rotGZ.connect(n.rotRCZ); n.rotRCZ.connect(n.pannerR.positionZ);
    n.rotGX.connect(n.rotRSZ); n.rotRSZ.connect(n.pannerR.positionZ);
    n.rotOscX.start(); n.rotOscZ.start();
    n.rotOut = ctx.createGain();
    n.rotBypass = ctx.createGain(); n.rotBypass.gain.value = 1; // 旁通直连：rotate关时唯一通路（否则低通支路杀掉全频段）
    n.envSum.connect(n.rotIn);
    n.rotIn.connect(n.rotBypass); n.rotBypass.connect(n.rotOut);
    n.rotIn.connect(n.rotLP); n.rotLP.connect(n.rotLow); n.rotLow.connect(n.rotOut);
    n.rotIn.connect(n.rotHP); n.rotHP.connect(n.rotSplit);
    n.rotSplit.connect(n.pannerL, 0); n.rotSplit.connect(n.pannerR, 1);
    n.pannerL.connect(n.rotHighL); n.pannerR.connect(n.rotHighR);
    n.rotHighL.connect(n.rotHigh); n.rotHighR.connect(n.rotHigh);
    n.rotHP.connect(n.rotFill); n.rotFill.connect(n.rotHigh);
    n.rotHigh.connect(n.rotOut);

    /* ---- 激励器（带限：HP2.8k→LP9k→软饱和→LP14k，湿量回注；全带饱和只会变吵） ---- */
    n.exDry = ctx.createGain();
    n.exHP = ctx.createBiquadFilter(); n.exHP.type = 'highpass'; n.exHP.frequency.value = 2800;
    n.exPreLP = ctx.createBiquadFilter(); n.exPreLP.type = 'lowpass'; n.exPreLP.frequency.value = 9000;
    n.exShaper = ctx.createWaveShaper(); n.exShaper.curve = makeCurve('tube', 2.2); n.exShaper.oversample = '4x';
    n.exPostLP = ctx.createBiquadFilter(); n.exPostLP.type = 'lowpass'; n.exPostLP.frequency.value = 14000;
    n.exWet = ctx.createGain(); n.exWet.gain.value = S.exciter * 0.8;
    n.compIn = ctx.createGain();
    n.rotOut.connect(n.exDry); n.exDry.connect(n.compIn);
    n.rotOut.connect(n.exHP); n.exHP.connect(n.exPreLP); n.exPreLP.connect(n.exShaper); n.exShaper.connect(n.exPostLP); n.exPostLP.connect(n.exWet); n.exWet.connect(n.compIn);

    /* ---- 夜听 3 段压缩（仅夜听串入）：LR4 分频 + 独立压缩 + 安全限制器 ---- */
    const mkBq = (type, freq) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = freq; b.Q.value = 0.707; return b; };
    const mkComp = (th, knee, ratio, atk, rel) => {
      const c = ctx.createDynamicsCompressor();
      c.threshold.value = th; c.knee.value = knee; c.ratio.value = ratio;
      c.attack.value = atk; c.release.value = rel;
      return c;
    };
    /* 低频 <200Hz：压得更多，避免夜听时低频顶掉中高频 */
    n.nightLowA = mkBq('lowpass', 200); n.nightLowB = mkBq('lowpass', 200);
    n.nightLowComp = mkComp(-18, 12, 2.4, 0.02, 0.35);
    /* 中频 200–2000Hz */
    n.nightHPA = mkBq('highpass', 200); n.nightHPB = mkBq('highpass', 200);
    n.nightMidLPA = mkBq('lowpass', 2000); n.nightMidLPB = mkBq('lowpass', 2000);
    n.nightMidComp = mkComp(-21, 18, 2.0, 0.015, 0.28);
    /* 高频 >2000Hz：轻压，保留清晰度 */
    n.nightHighA = mkBq('highpass', 2000); n.nightHighB = mkBq('highpass', 2000);
    n.nightHighComp = mkComp(-24, 18, 1.5, 0.008, 0.18);
    n.nightLowGain = ctx.createGain(); n.nightLowGain.gain.value = 0.95;
    n.nightMidGain = ctx.createGain(); n.nightMidGain.gain.value = 1.0;
    n.nightHighGain = ctx.createGain(); n.nightHighGain.gain.value = 1.0;
    n.nightSum = ctx.createGain();
    n.limiter = ctx.createDynamicsCompressor();
    n.limiter.threshold.value = -1; n.limiter.knee.value = 0; n.limiter.ratio.value = 20;
    n.limiter.attack.value = 0.002; n.limiter.release.value = 0.25;
    n.trim = ctx.createGain(); n.trim.gain.value = 0.85;         // 压缩/限制前留 headroom（仅夜听串入路径）
    n.nightTrim = ctx.createGain(); n.nightTrim.gain.value = S.night ? 0.708 : 1;
    n.out = ctx.createGain(); n.out.gain.value = 1;              // 旁通路径不补偿，原声电平与直连一致
    /* 限制器默认旁通（ratio20/阈值-1有固定makeup+抽吸尾，被听成"混响感"）；夜听模式才串入 */
    n.limDry = ctx.createGain(); n.limDry.gain.value = 1;
    n.limWet = ctx.createGain(); n.limWet.gain.value = 0;
    /* 变调放在主链分叉前：夜听开/关都生效。pitch=0 时走 bypass，避免 SoundTouch 常驻处理 */
    n.pitchIn = ctx.createGain();
    n.pitchOut = ctx.createGain();
    n.pitchBypass = ctx.createGain(); n.pitchBypass.gain.value = 1;
    n.pitchWet = ctx.createGain(); n.pitchWet.gain.value = 0;
    n.compIn.connect(n.pitchIn);
    n.pitchIn.connect(n.pitchBypass); n.pitchBypass.connect(n.pitchOut);
    n.pitchWet.connect(n.pitchOut);
    n.pitchOut.connect(n.limDry); n.limDry.connect(n.out);
    n.pitchOut.connect(n.trim);
    /* 3 段分频与压缩；夜听关闭时 limWet=0，整条支路静音 */
    n.trim.connect(n.nightLowA); n.nightLowA.connect(n.nightLowB); n.nightLowB.connect(n.nightLowComp);
    n.nightLowComp.connect(n.nightLowGain); n.nightLowGain.connect(n.nightSum);
    n.trim.connect(n.nightHPA); n.nightHPA.connect(n.nightHPB); n.nightHPB.connect(n.nightMidLPA);
    n.nightMidLPA.connect(n.nightMidLPB); n.nightMidLPB.connect(n.nightMidComp);
    n.nightMidComp.connect(n.nightMidGain); n.nightMidGain.connect(n.nightSum);
    n.trim.connect(n.nightHighA); n.nightHighA.connect(n.nightHighB); n.nightHighB.connect(n.nightHighComp);
    n.nightHighComp.connect(n.nightHighGain); n.nightHighGain.connect(n.nightSum);
    n.nightSum.connect(n.limiter); n.limiter.connect(n.nightTrim); n.nightTrim.connect(n.limWet); n.limWet.connect(n.out);
    /* 最后一级安全软限幅：只有峰值超过 -0.9dBFS 才介入，正常段落完全透明 */
    n.safety = ctx.createWaveShaper();
    n.safety.curve = makeSafetyCurve();
    n.safety.oversample = '4x';
    n.finalOut = ctx.createGain();
    /* 耳机交叉馈送（bs2b 思路）：对侧信号 0.3ms 延迟 + 700Hz 低通 + 可调衰减；
       直通路径加 1.2kHz 高频架衰减，模拟头部对高频的遮蔽（旧版只有宽带 -0.15×cf） */
    n.cfSplit = ctx.createChannelSplitter(2);
    n.cfMerge = ctx.createChannelMerger(2);
    n.cfL = ctx.createGain(); n.cfL.gain.value = 1;
    n.cfR = ctx.createGain(); n.cfR.gain.value = 1;
    n.cfShelfL = ctx.createBiquadFilter(); n.cfShelfL.type = 'highshelf'; n.cfShelfL.frequency.value = 1200; n.cfShelfL.Q.value = 0.707; n.cfShelfL.gain.value = 0;
    n.cfShelfR = ctx.createBiquadFilter(); n.cfShelfR.type = 'highshelf'; n.cfShelfR.frequency.value = 1200; n.cfShelfR.Q.value = 0.707; n.cfShelfR.gain.value = 0;
    n.cfLR = ctx.createGain(); n.cfLR.gain.value = 0;
    n.cfRL = ctx.createGain(); n.cfRL.gain.value = 0;
    n.cfDL = ctx.createDelay(0.01); n.cfDL.delayTime.value = 0.0003;
    n.cfDR = ctx.createDelay(0.01); n.cfDR.delayTime.value = 0.0003;
    n.cfLPL = ctx.createBiquadFilter(); n.cfLPL.type = 'lowpass'; n.cfLPL.frequency.value = 700; n.cfLPL.Q.value = 0.707;
    n.cfLPR = ctx.createBiquadFilter(); n.cfLPR.type = 'lowpass'; n.cfLPR.frequency.value = 700; n.cfLPR.Q.value = 0.707;
    n.cfOut = ctx.createGain();
    /* 预设响度对齐：放在交叉馈送后、lookahead 限制器前，限制器看到的是补偿后的信号 */
    n.presetTrim = ctx.createGain(); n.presetTrim.gain.value = Math.pow(10, (Number(S.presetTrim) || 0) / 20);
    n.out.connect(n.cfSplit);
    n.cfSplit.connect(n.cfL, 0); n.cfL.connect(n.cfShelfL); n.cfShelfL.connect(n.cfMerge, 0, 0);
    n.cfSplit.connect(n.cfR, 1); n.cfR.connect(n.cfShelfR); n.cfShelfR.connect(n.cfMerge, 0, 1);
    n.cfSplit.connect(n.cfDL, 0); n.cfDL.connect(n.cfLPL); n.cfLPL.connect(n.cfLR); n.cfLR.connect(n.cfMerge, 0, 1);
    n.cfSplit.connect(n.cfDR, 1); n.cfDR.connect(n.cfLPR); n.cfLPR.connect(n.cfRL); n.cfRL.connect(n.cfMerge, 0, 0);
    /* 中频交叉：1.2kHz 带通 + 0.45ms，模拟头部对中高频的遮蔽；默认 0 */
    n.cfMDL = ctx.createDelay(0.01); n.cfMDL.delayTime.value = 0.00045;
    n.cfMDR = ctx.createDelay(0.01); n.cfMDR.delayTime.value = 0.00045;
    n.cfMBL = ctx.createBiquadFilter(); n.cfMBL.type = 'bandpass'; n.cfMBL.frequency.value = 1200; n.cfMBL.Q.value = 0.8;
    n.cfMBR = ctx.createBiquadFilter(); n.cfMBR.type = 'bandpass'; n.cfMBR.frequency.value = 1200; n.cfMBR.Q.value = 0.8;
    n.cfML = ctx.createGain(); n.cfML.gain.value = 0;
    n.cfMR = ctx.createGain(); n.cfMR.gain.value = 0;
    n.cfSplit.connect(n.cfMDL, 0); n.cfMDL.connect(n.cfMBL); n.cfMBL.connect(n.cfML); n.cfML.connect(n.cfMerge, 0, 1);
    n.cfSplit.connect(n.cfMDR, 1); n.cfMDR.connect(n.cfMBR); n.cfMBR.connect(n.cfMR); n.cfMR.connect(n.cfMerge, 0, 0);
    n.cfMerge.connect(n.cfOut);
    n.cfOut.connect(n.presetTrim);
    n.wLimIn = ctx.createGain();
    /* 自动响度增益：静态 presetTrim 之后、限制器之前；干/湿分析器都绕过它/包含它 */
    n.autoGain = ctx.createGain(); n.autoGain.gain.value = Math.pow(10, (S.autoLevel ? autoDb : 0) / 20);
    n.presetTrim.connect(n.autoGain);
    n.autoGain.connect(n.wLimIn);
    /* 限制器输入峰值分析器：诊断用，区分“真实输入峰值”与 FIR 检测峰值 */
    n.preLim = ctx.createAnalyser(); n.preLim.fftSize = 1024; n.preLim.smoothingTimeConstant = 0;
    n.autoGain.connect(n.preLim);
    /* 干信号分析器：自动响度用，取 FX 输入（已含媒体响度归一，未含任何音效） */
    n.dryMeter = ctx.createAnalyser(); n.dryMeter.fftSize = 2048; n.dryMeter.smoothingTimeConstant = 0;
    n.fxIn.connect(n.dryMeter);
    try {
      const psink = ctx.createGain(); psink.gain.value = 0;
      n.preLim.connect(psink); psink.connect(ctx.destination);
      const dsink = ctx.createGain(); dsink.gain.value = 0;
      n.dryMeter.connect(dsink); dsink.connect(ctx.destination);
    } catch (e) {}
    n.wLimIn.connect(n.safety);
    /* A/B 旁通：湿声经 bypassWet，干声从 fxIn 直连 finalOut；默认干0湿1 */
    n.bypassWet = ctx.createGain(); n.bypassWet.gain.value = 1;
    n.bypassDry = ctx.createGain(); n.bypassDry.gain.value = 0;
    n.safety.connect(n.bypassWet); n.bypassWet.connect(n.finalOut);
    n.fxIn.connect(n.bypassDry); n.bypassDry.connect(n.finalOut);
    /* 输出后置表：诊断/预设回归用，0 增益哑通道保证持续拉取 */
    n.meter = ctx.createAnalyser(); n.meter.fftSize = 1024; n.meter.smoothingTimeConstant = 0;
    n.finalOut.connect(n.meter);
    try {
      const msink = ctx.createGain(); msink.gain.value = 0;
      n.meter.connect(msink); msink.connect(ctx.destination);
    } catch (e) {}

    /* ---- 变调（SoundTouch worklet，按需加载） ---- */
    built = true;
    applyAll(); // 关键：构建后立即套用状态。否则 tapeWet 等节点停留在默认增益1，原声也会挂上磁带/梳状滤波
    if (!alTimer) alTimer = setInterval(autoLevelTick, 500);
    /* Chromium 的 DynamicsCompressor 自带 makeup；用 reduction 反向补偿，得到真正的压缩衰减 */
    if (!deTimer) deTimer = setInterval(() => {
      if (!built || deReady || !n.deComp || !n.deHighGain) return;
      const gr = Number(n.deComp.reduction) || 0;
      setP(n.deHighGain.gain, Math.pow(10, gr / 20), 0.01);
    }, 30);
    ensureWorkletLimiter();
    ensureFdnReverb();
    ensureTransient();
    ensureDynEq();
    ensureDuck();
    ensureDeEsserWorklet();
  }

  function applyRotate() {
    const rp = ROT_PRESETS[S.rotate];
    if (!rp) {
      setP(n.rotBypass.gain, 1, 0.05); setP(n.rotLow.gain, 0, 0.08); setP(n.rotHigh.gain, 0, 0.08);
      setP(n.rotFill.gain, 0, 0.05);
      setP(n.rotGX.gain, 0); setP(n.rotGZ.gain, 0);
      setP(n.rotRCX.gain, 0); setP(n.rotRSX.gain, 0); setP(n.rotRCZ.gain, 0); setP(n.rotRSZ.gain, 0);
      return;
    }
    setP(n.rotBypass.gain, 0, 0.05);
    setP(n.rotLow.gain, rp.low, 0.08);
    setP(n.rotHigh.gain, rp.makeup || 1, 0.3); // 缓入：掩蔽HRTF异步加载
    setP(n.rotFill.gain, rp.fill || 0.25, 0.05);
    setP(n.rotGX.gain, rp.radius, 0.05);
    setP(n.rotGZ.gain, rp.radius, 0.05);
    const phi = rp.spread || 0.25;
    const c = Math.cos(phi), s = Math.sin(phi);
    setP(n.rotRCX.gain, c, 0.05);
    setP(n.rotRSX.gain, s, 0.05);
    setP(n.rotRCZ.gain, c, 0.05);
    setP(n.rotRSZ.gain, -s, 0.05);
    setP(n.rotOscX.frequency, rp.speed, 0.05);
    setP(n.rotOscZ.frequency, rp.speed, 0.05);
  }
  function applyVocal() {
    if (S.vocal === 'center') {
      setP(n.gainM.gain, 1); setP(n.wSide.gain, 0); setP(n.wSideInv.gain, 0);
      setP(n.wSideLow.gain, 0); setP(n.wSideLowInv.gain, 0);
      setP(n.sideHS.gain, 0, 0.05);
    } else if (S.vocal === 'side') {
      setP(n.gainM.gain, 0); setP(n.wSide.gain, 1); setP(n.wSideInv.gain, -1);
      setP(n.wSideLow.gain, 1); setP(n.wSideLowInv.gain, -1);
      setP(n.sideHS.gain, 0, 0.05);
    } else {
      const low = S.monoBass ? 0 : S.width;
      const wh = S.widthHigh == null ? 1 : Math.max(0.1, S.widthHigh);
      setP(n.gainM.gain, 1); setP(n.wSide.gain, S.width); setP(n.wSideInv.gain, -S.width);
      setP(n.sideHS.gain, 20 * Math.log10(wh), 0.05);
      setP(n.wSideLow.gain, low); setP(n.wSideLowInv.gain, -low);
    }
  }
  function eqQ(g) { return Math.min(2.5, Math.max(0.7, 0.7 + 0.15 * Math.abs(g || 0))); }
  const BAND_CLAMP = [6, 6, 12, 12, 12, 12, 12, 12, 6, 6]; // 31/63/8k/16k 限幅±6dB
  function applyHeadphone() {
    if (!n.hpDry) return;
    const hp = S.headphone;
    const amt = hp ? Math.max(0, Math.min(1, hp.amount == null ? 1 : Number(hp.amount))) : 0;
    const on = !!(hp && Array.isArray(hp.filters) && hp.filters.length && amt > 0.001);
    setP(n.hpDry.gain, on ? 0 : 1, 0.05);
    setP(n.hpWet.gain, on ? 1 : 0, 0.05);
    const pre = on ? Math.max(-24, Math.min(6, (Number(hp.preamp) || 0) * amt)) : 0;
    setP(n.hpPreamp.gain, Math.pow(10, pre / 20), 0.05);
    const typeMap = { peaking: 'peaking', lowshelf: 'lowshelf', highshelf: 'highshelf' };
    n.hpFilters.forEach((b, i) => {
      const f = on ? hp.filters[i] : null;
      if (!f) { setP(b.gain, 0, 0.05); return; }
      try { b.type = typeMap[f.type] || 'peaking'; } catch (e) {}
      setP(b.frequency, Math.max(20, Math.min(20000, Number(f.freq) || 1000)), 0.05);
      setP(b.Q, Math.max(0.1, Math.min(12, Number(f.q) || 0.707)), 0.05);
      setP(b.gain, Math.max(-24, Math.min(24, (Number(f.gain) || 0) * amt)), 0.05);
    });
  }
  function applyAll() {
    if (!built) return;
    const pre = Math.max(-12, Math.min(6, Number(S.preamp) || 0));
    setP(n.preamp.gain, Math.pow(10, pre / 20), 0.05);
    applyHeadphone();
    const bass = S.eq.bass, treble = S.eq.treble;
    setP(n.eqBass.gain, bass); setP(n.eqTreble.gain, treble);
    let maxBoost = Math.max(0, bass, treble);
    n.eqB.forEach((b, i) => {
      const lim = BAND_CLAMP[i] == null ? 12 : BAND_CLAMP[i];
      const g = Math.max(-lim, Math.min(lim, S.eq.bands[i] || 0));
      setP(b.gain, g); setP(b.Q, eqQ(g), 0.03);  // 比例Q：小增益Q低(宽而自然)，大增益Q高(精准)
      if (g > maxBoost) maxBoost = g;
    });
    // 提升后自动回补（约 -0.5×最大提升 dB），避免整体变响顶到后级
    setP(n.postEq.gain, Math.pow(10, -0.5 * maxBoost / 20), 0.05);

    /* 磁带：全湿(干湿混合会与8ms延迟形成梳状滤波)，强度用抖晃深度/滚降/饱和度表达 */
    const t = Math.max(0, Math.min(1, S.tape || 0));
    const tapeOn = t > 0.02;
    setP(n.tapeDry.gain, tapeOn ? 0 : 1, 0.06);
    setP(n.tapeWet.gain, tapeOn ? 1 : 0, 0.06);
    setP(n.tapeLP.frequency, 12000 - 3800 * t, 0.05);
    setP(n.tapePre.gain, t * 4, 0.05);
    setP(n.tapeDe.gain, -t * 4, 0.05);
    setP(n.tapeBump.gain, t * 1.5, 0.05);
    n.tapeShaper.curve = makeCurve('tanh', t * 0.4); // k≈1+1.2t：轻饱和；旧k≈5会把峰值压到-14dBFS
    setP(n.wowG1.gain, 0.00012 * t, 0.05);
    setP(n.wowG2.gain, 0.00016 * t, 0.05);
    setP(n.wowG3.gain, 0.00008 * t, 0.05);
    setP(n.flutG1.gain, 0.000020 * t, 0.05);
    setP(n.flutG2.gain, 0.000020 * t, 0.05);
    setP(n.flutG3.gain, 0.000015 * t, 0.05);
    setP(n.tapeHiss.gain, tapeOn ? 0.03 * t : 0, 0.08);

    /* 电子管：真交叉淡化 + 归一化曲线（弱音不虚高） */
    setP(n.tubeDry.gain, 1 - S.tube, 0.05);
    setP(n.tubeWet.gain, S.tube, 0.05);
    n.tubeShaper.curve = makeCurve('tube', 0.8 + S.tube * 1.8);
    setP(n.tubeMid.gain, S.tube * 1.2, 0.05);
    applyVocal();
    const cf = Math.max(0, Math.min(1, Number(S.crossfeed) || 0));
    const cfm = Math.max(0, Math.min(1, Number(S.crossfeedMid) || 0));
    const cfD = Math.max(0.1, Math.min(0.6, S.cfDelay == null ? 0.3 : Number(S.cfDelay)));
    const cfF = Math.max(400, Math.min(1000, S.cfFreq == null ? 700 : Number(S.cfFreq)));
    setP(n.cfLR.gain, cf * 0.55, 0.05);
    setP(n.cfRL.gain, cf * 0.55, 0.05);
    setP(n.cfML.gain, cfm * 0.35, 0.05);
    setP(n.cfMR.gain, cfm * 0.35, 0.05);
    setP(n.cfL.gain, 1 - cf * 0.15 - cfm * 0.05, 0.05);
    setP(n.cfR.gain, 1 - cf * 0.15 - cfm * 0.05, 0.05);
    setP(n.cfShelfL.gain, -cf * 2.5 - cfm * 1.5, 0.05);
    setP(n.cfShelfR.gain, -cf * 2.5 - cfm * 1.5, 0.05);
    setP(n.cfDL.delayTime, cfD / 1000, 0.05);
    setP(n.cfDR.delayTime, cfD / 1000, 0.05);
    setP(n.cfLPL.frequency, cfF, 0.05);
    setP(n.cfLPR.frequency, cfF, 0.05);
    setP(n.cfMDL.delayTime, cfD * 1.5 / 1000, 0.05);
    setP(n.cfMDR.delayTime, cfD * 1.5 / 1000, 0.05);
    setP(n.cfMBL.frequency, cfF * 1.7, 0.05);
    setP(n.cfMBR.frequency, cfF * 1.7, 0.05);
    /* 预设响度对齐：缓变避免切预设时泵浦；自定义状态下保留来自预设的 trim */
    const ptr = Math.max(-9, Math.min(6, Number(S.presetTrim) || 0));
    setP(n.presetTrim.gain, Math.pow(10, ptr / 20), 0.08);
    if (n.wLimiter) {
      try { setP(n.wLimiter.parameters.get('phases'), S.perfMode ? 4 : 8, 0.05); } catch (e) {}
    }
    if (n.autoGain) {
      const hpOn = !!(S.headphone && Array.isArray(S.headphone.filters) && S.headphone.filters.length);
      setP(n.autoGain.gain, Math.pow(10, ((S.autoLevel && !hpOn) ? autoDb : 0) / 20), 0.5);
    }
    if (n.bypassDry) {
      const hp = S.headphone;
      const amt = hp ? Math.max(0, Math.min(1, hp.amount == null ? 1 : Number(hp.amount))) : 0;
      const hpPre = (hp && hp.filters && hp.filters.length && amt > 0.001)
        ? Math.max(-24, Math.min(6, (Number(hp.preamp) || 0) * amt)) : 0;
      const dryMatch = hpPre < 0 ? Math.min(1, Math.pow(10, hpPre / 20)) : 1;
      setP(n.bypassDry.gain, S.bypass ? dryMatch : 0, 0.05);
      setP(n.bypassWet.gain, S.bypass ? 0 : 1, 0.05);
    }
    if (n.deBypass) {
      const de = Math.max(0, Math.min(1, Number(S.deEsser) || 0));
      const deOn = de > 0.001;
      setP(n.deBypass.gain, deOn ? 0 : 1, 0.05);
      setP(n.deWet.gain, deOn ? 1 : 0, 0.05);
      setP(n.deComp.threshold, -18 - 12 * de, 0.05);
      setP(n.deComp.ratio, 1 + 2 * de, 0.05);
    }
    if (deNode) {
      const de = Math.max(0, Math.min(1, Number(S.deEsser) || 0));
      try { setP(deNode.parameters.get('amount'), de, 0.05); setP(deNode.parameters.get('freq'), Math.max(4000, Math.min(8000, S.deFreq == null ? 5000 : Number(S.deFreq))), 0.05); } catch (e) {}
    }
    if (n.loudBass) {
      const loud = Math.max(0, Math.min(1, Number(S.loudness) || 0));
      const vv = Math.max(0, Math.min(1, volLevel));
      const comp = Math.pow(1 - vv, 1.2);
      setP(n.loudBass.gain, loud * comp * 8, 0.15);
      setP(n.loudTreble.gain, loud * comp * 4, 0.15);
    }
    if (n.bassWet) {
      const be = Math.max(0, Math.min(1, Number(S.bassExciter) || 0));
      const bf = Math.max(80, Math.min(160, S.bassFreq == null ? 120 : Number(S.bassFreq)));
      setP(n.bassDrive.gain, 1 + be * 7, 0.05);
      setP(n.bassWet.gain, be * 0.5, 0.05);
      setP(n.bassLP1.frequency, bf, 0.05);
      setP(n.bassLP2.frequency, bf, 0.05);
      setP(n.bassHP.frequency, bf + 10, 0.05);
    }
    if (dynNode) {
      const da = Math.max(0, Math.min(1, S.perfMode ? 0 : (Number(S.dynEq) || 0)));
      const dl = Math.max(0, Math.min(1, S.dynEqLow == null ? 1 : Number(S.dynEqLow)));
      const dm = Math.max(0, Math.min(1, S.dynEqMid == null ? 1 : Number(S.dynEqMid)));
      const dh = Math.max(0, Math.min(1, S.dynEqHigh == null ? 1 : Number(S.dynEqHigh)));
      try {
        setP(dynNode.parameters.get('amount'), da, 0.05);
        setP(dynNode.parameters.get('low'), dl, 0.05);
        setP(dynNode.parameters.get('mid'), dm, 0.05);
        setP(dynNode.parameters.get('high'), dh, 0.05);
        const dp = [
          ['fLow', S.dynEqFLow, 180, 80, 300], ['qLow', S.dynEqQLow, 0.9, 0.4, 3], ['thLow', S.dynEqThLow, -11, -24, -4],
          ['fMid', S.dynEqFMid, 1200, 600, 2000], ['qMid', S.dynEqQMid, 1.3, 0.4, 3], ['thMid', S.dynEqThMid, -13, -24, -4],
          ['fHigh', S.dynEqFHigh, 3500, 2000, 6000], ['qHigh', S.dynEqQHigh, 1.2, 0.4, 3], ['thHigh', S.dynEqThHigh, -15, -24, -4]
        ];
        for (const [k, v, def, lo, hi] of dp) setP(dynNode.parameters.get(k), Math.max(lo, Math.min(hi, v == null ? def : Number(v))), 0.05);
      } catch (e) {}
    }
    if (duckNode) {
      const dd = Math.max(0, Math.min(1, Number(S.reverbDuck) || 0));
      try { setP(duckNode.parameters.get('depth'), dd, 0.05); } catch (e) {}
    }
    const ep = ENV_PRESETS[S.env];
    if (ep) {
      if (!n.conv.buffer || n._convKey !== S.env) { n.conv.buffer = genIR(ep); n._convKey = S.env; }
      const preMs = S.envPre != null ? Math.max(0, Math.min(120, Number(S.envPre))) : ep.pre * 1000;
      setP(n.envPre.delayTime, preMs / 1000, 0.05);
      setP(n.envWet.gain, ep.wet * S.depth, 0.05);
    } else setP(n.envWet.gain, 0, 0.05);
    applyReverb();
    applyRotate();
    if (trNode) {
      const trA = Math.max(0, Math.min(1, Number(S.transient) || 0));
      const trS = Math.max(0, Math.min(1, Number(S.transientSustain) || 0));
      try {
        setP(trNode.parameters.get('attack'), trA, 0.05);
        setP(trNode.parameters.get('sustain'), trS, 0.05);
        setP(trNode.parameters.get('highOnly'), S.transientHigh ? 1 : 0, 0.05);
        setP(trNode.parameters.get('freq'), Math.max(1000, Math.min(4000, S.transientFreq == null ? 2000 : Number(S.transientFreq))), 0.05);
      } catch (e) {}
    }
    setP(n.exWet.gain, S.exciter * 0.8, 0.05);
    const na = Math.max(0, Math.min(1, S.nightAmount == null ? 1 : Number(S.nightAmount)));
    const nightOn = !!S.night && na > 0.001;
    setP(n.nightLowComp.threshold, -18 * na, 0.05);
    setP(n.nightLowComp.ratio, 1 + 1.4 * na, 0.05);
    setP(n.nightMidComp.threshold, -21 * na, 0.05);
    setP(n.nightMidComp.ratio, 1 + 1.0 * na, 0.05);
    setP(n.nightHighComp.threshold, -24 * na, 0.05);
    setP(n.nightHighComp.ratio, 1 + 0.5 * na, 0.05);
    setP(n.nightTrim.gain, 1 - 0.292 * na, 0.05);
    // 限制器仅夜听模式串入（旁通态有+0.57dB makeup与抽吸尾，听成混响感）
    setP(n.limDry.gain, nightOn ? 0 : 1, 0.05);
    setP(n.limWet.gain, nightOn ? 1 : 0, 0.05);
    applyPitch();
  }
  function readCustomPresets() {
    try {
      const a = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
      return Array.isArray(a) ? a.filter(x => x && x.id && x.name && x.state) : [];
    } catch (e) { return []; }
  }
  function writeCustomPresets(list) {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch (e) {}
  }
  function customSnapshot() {
    const out = {};
    for (const k of CUSTOM_FIELDS) if (S[k] !== undefined) out[k] = S[k];
    return out;
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {} }

  /* ---- 变调：SoundTouch worklet（vendored，按需异步加载，失败降级为不可用） ---- */
  async function ensurePitch() {
    if (pitchReady || pitchNode) return pitchReady;
    try {
      if (pitchEngineName === 'signalsmith') {
        const mod = await import('/js/vendor/signalsmith-stretch.mjs');
        const Sig = mod.default || mod.SignalsmithStretch;
        pitchNode = await Sig(ctx, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
        n.pitchIn.connect(pitchNode);
        pitchNode.connect(n.pitchWet);
        pitchReady = true;
        pitchMetrics = { underrunCount: 0, framesBuffered: 0, blockCount: 0, outputRms: 0, outputPeak: 0, engine: 'signalsmith', latency: 0 };
        try { pitchMetrics.latency = +(await pitchNode.latency()).toFixed(3); } catch (e) {}
        const semis = Math.max(-6, Math.min(6, Number(S.pitch) || 0));
        try { await pitchNode.start({ active: true, semitones: semis }); } catch (e) {}
        lastPitchSent = semis;
        applyPitch();
        return true;
      }
      await ctx.audioWorklet.addModule('/js/vendor/soundtouch-worklet.js');
      pitchNode = new AudioWorkletNode(ctx, 'soundtouch-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      pitchNode.port.onmessage = e => {
        if (e.data && e.data.type === 'metrics') {
          pitchMetrics = {
            underrunCount: e.data.underrunCount || 0,
            framesBuffered: e.data.framesBuffered || 0,
            blockCount: e.data.blockCount || 0,
            outputRms: +(e.data.outputRms || 0).toFixed(4),
            outputPeak: +(e.data.outputPeak || 0).toFixed(4),
            engine: 'soundtouch',
            latency: 0
          };
        }
      };
      /* 音乐变调用更长的 sequence/overlap，减少瞬态断裂；lanczos 插值 */
      try { pitchNode.port.postMessage({ type: 'set-stretch-parameters', params: { sequenceMs: 60, seekWindowMs: 25, overlapMs: 12 } }); } catch (e) {}
      try { pitchNode.port.postMessage({ type: 'set-interpolation-strategy', strategy: 'lanczos' }); } catch (e) {}
      pitchReady = true;
      // 串入主链分叉前：pitchIn → pitchNode → pitchWet → pitchOut；pitch=0 时 bypass 直通
      try { n.pitchIn.connect(pitchNode); } catch (e) {}
      pitchNode.connect(n.pitchWet);
      applyPitch();
      return true;
    } catch (e) { pitchReady = false; pitchNode = null; return false; }
  }
  function disposePitchNode() {
    if (!pitchNode) return;
    try { n.pitchIn.disconnect(pitchNode); } catch (e) {}
    try { pitchNode.disconnect(n.pitchWet); } catch (e) {}
    try { pitchNode.port.close(); } catch (e) {}
    pitchNode = null;
    pitchReady = false;
    lastPitchSent = null;
  }
  function setPitchEngine(engine) {
    const e = engine === 'signalsmith' ? 'signalsmith' : 'soundtouch';
    if (e === pitchEngineName) return true;
    S.pitch = 0;
    save();
    disposePitchNode();
    pitchEngineName = e;
    try { localStorage.setItem('bp.pitchEngine', e); } catch (e2) {}
    if (n.pitchBypass) { setP(n.pitchBypass.gain, 1, 0.03); setP(n.pitchWet.gain, 0, 0.03); }
    return true;
  }
  function applyPitch() {
    if (!pitchNode) return;
    const semis = Math.max(-6, Math.min(6, Number(S.pitch) || 0));
    const on = Math.abs(semis) > 0.001;
    setP(n.pitchBypass.gain, on ? 0 : 1, 0.03);
    setP(n.pitchWet.gain, on ? 1 : 0, 0.03);
    if (pitchEngineName === 'signalsmith' && typeof pitchNode.schedule === 'function') {
      if (semis !== lastPitchSent) {
        lastPitchSent = semis;
        try { pitchNode.schedule({ semitones: semis }); } catch (e) {}
      }
      return;
    }
    try {
      const semisP = pitchNode.parameters.get('pitchSemitones');
      const mult = pitchNode.parameters.get('pitch');
      if (semisP) setP(semisP, semis, 0.03);          // 半音参数直传
      else if (mult) setP(mult, Math.pow(2, semis / 12), 0.03);
      lastPitchSent = semis;
    } catch (e) {}
  }

  function meter() {
    if (!n.meter) return { peak: 0, rms: 0, maxPeak: 0, clip: false };
    try { n.meter.getFloatTimeDomainData(_meterBuf); } catch (e) { return { peak: 0, rms: 0, maxPeak: 0, clip: false }; }
    let s = 0, p = 0;
    for (let i = 0; i < _meterBuf.length; i++) {
      const v = _meterBuf[i];
      s += v * v;
      const a = Math.abs(v);
      if (a > p) p = a;
    }
    if (p > meterMax) meterMax = p;
    return { peak: +p.toFixed(4), rms: +Math.sqrt(s / _meterBuf.length).toFixed(4), maxPeak: +meterMax.toFixed(4), clip: meterMax > 1.0 };
  }
  function preLimPeak() {
    if (!n.preLim) return 0;
    try { n.preLim.getFloatTimeDomainData(_meterBuf); } catch (e) { return 0; }
    let p = 0;
    for (let i = 0; i < _meterBuf.length; i++) {
      const a = Math.abs(_meterBuf[i]);
      if (a > p) p = a;
    }
    return p;
  }
  /* 限制器离线自检：不发声，用 OfflineAudioContext 渲染 997Hz 正弦。
     热段 1.8 应压到约 0.89；低段 0.5 应透明通过。 */
  async function selfTest() {
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AC) return { ok: false, error: 'OfflineAudioContext 不可用' };
    const sr = 48000;
    try {
      const off = new AC(2, sr, sr);
      await off.audioWorklet.addModule('/js/vendor/peak-limiter-worklet.js?v=fir64x8p');
      const node = new AudioWorkletNode(off, 'peak-limiter-processor', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
        parameterData: { threshold: -1, release: 120, phases: 8 }
      });
      const osc = off.createOscillator(); osc.type = 'sine'; osc.frequency.value = 997;
      const g = off.createGain();
      g.gain.setValueAtTime(1.8, 0);
      g.gain.setValueAtTime(1.8, 0.45);
      g.gain.linearRampToValueAtTime(0.5, 0.46);
      g.gain.setValueAtTime(0.5, 1.0);
      osc.connect(g); g.connect(node); node.connect(off.destination); osc.start();
      const buf = await off.startRendering();
      const peakAt = (t0, t1) => {
        let p = 0;
        const a = Math.max(0, Math.floor(t0 * sr)), b = Math.min(buf.length, Math.floor(t1 * sr));
        for (let ch = 0; ch < buf.numberOfChannels; ch++) {
          const d = buf.getChannelData(ch);
          for (let i = a; i < b; i++) { const v = Math.abs(d[i]); if (v > p) p = v; }
        }
        return +p.toFixed(3);
      };
      const hot = peakAt(0.10, 0.42);
      const low = peakAt(0.70, 0.95);
      const ok = hot >= 0.84 && hot <= 0.92 && low >= 0.44 && low <= 0.56;
      return { ok, hot, low, ver: 'fir64x8', expected: { hot: '0.84~0.92', low: '0.44~0.56' } };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }
  /* AutoEQ ParametricEQ.txt 解析：Preamp + Filter N: ON PK/LSC/HSC Fc/Gain/Q */
  function parseAutoEq(text) {
    const lines = String(text || '').split(/\r?\n/);
    let preamp = 0;
    const filters = [];
    for (const line of lines) {
      const pm = line.match(/Preamp:\s*(-?[\d.]+)\s*dB/i);
      if (pm) { preamp = +pm[1]; continue; }
      const fm = line.match(/Filter\s*\d+:\s*(ON|OFF)\s+(\w+)\s+(?:Fc|F)\s+([\d.]+)\s*Hz\s+Gain\s+(-?[\d.]+)\s*dB(?:\s+Q\s+([\d.]+))?/i);
      if (!fm || fm[1].toUpperCase() !== 'ON') continue;
      const t = fm[2].toUpperCase();
      const type = t === 'PK' ? 'peaking' : (t === 'LSC' || t === 'LS') ? 'lowshelf' : (t === 'HSC' || t === 'HS') ? 'highshelf' : null;
      if (!type) continue;
      filters.push({
        type,
        freq: Math.max(20, Math.min(20000, Number(fm[3]) || 1000)),
        gain: Math.max(-24, Math.min(24, Number(fm[4]) || 0)),
        q: Math.max(0.1, Math.min(12, fm[5] ? Number(fm[5]) : 0.707))
      });
      if (filters.length >= 10) break;
    }
    return { preamp: Math.max(-24, Math.min(6, Number(preamp) || 0)), filters };
  }
  function setHeadphone(prof) {
    if (!prof) {
      S.headphone = null;
    } else {
      const filters = (Array.isArray(prof.filters) ? prof.filters : []).slice(0, 10).map(f => ({
        type: f.type === 'lowshelf' || f.type === 'highshelf' ? f.type : 'peaking',
        freq: Math.max(20, Math.min(20000, Number(f.freq) || 1000)),
        gain: Math.max(-24, Math.min(24, Number(f.gain) || 0)),
        q: Math.max(0.1, Math.min(12, Number(f.q) || 0.707))
      }));
      S.headphone = {
        name: String(prof.name || '耳机校准').slice(0, 100),
        source: String(prof.source || '').slice(0, 40),
        preamp: Math.max(-24, Math.min(6, Number(prof.preamp) || 0)),
        amount: prof.amount == null ? 1 : Math.max(0, Math.min(1, Number(prof.amount))),
        filters
      };
    }
    applyAll(); save();
    return S.headphone;
  }
  function setHeadphoneFromText(name, text, source) {
    const p = parseAutoEq(text);
    if (!p.filters.length) throw new Error('未解析到 AutoEQ 滤波器');
    return setHeadphone({ name, source, preamp: p.preamp, filters: p.filters });
  }
  function setHeadphoneAmount(v) {
    if (!S.headphone) return false;
    S.headphone.amount = Math.max(0, Math.min(1, Number(v)));
    applyAll(); save();
    return S.headphone.amount;
  }

  window.AudioFX = {
    EQ_FREQS, ENV_PRESETS, ROT_PRESETS, PRESETS,
    get state() { return S; },
    context() { return ctx; },
    parseAutoEq,
    setHeadphone,
    setHeadphoneFromText,
    setHeadphoneAmount,
    headphone() { return S.headphone; },
    meter,
    selfTest,
    resetMeter() { meterMax = 0; limiterPeakMax = 0; },
    ensure(context) {
      if (!built) build(context);
      return { input: n.fxIn, output: n.finalOut };
    },
    speed() { return S.speed || 1; },
    setSpeed(v) { S.speed = Math.max(0.5, Math.min(2, v || 1)); save(); },
    set(patch) {
      Object.assign(S, patch);
      if (patch.autoLevel !== undefined) {
        autoDb = 0; alDry = 0; alWet = 0; alN = 0; alWasOn = !!patch.autoLevel;
      }
      if (patch.eq) S.eq = Object.assign(defaultState().eq, patch.eq);
      S.preset = detectPreset(S);
      applyAll(); save();
    },
    setEq(part) {
      S.eq = Object.assign({}, S.eq, part);
      S.preset = detectPreset(S);
      applyAll(); save();
    },
    setVolume(v) {
      volLevel = Math.max(0, Math.min(1, Number(v) || 0));
      if (n.loudBass) {
        const loud = Math.max(0, Math.min(1, Number(S.loudness) || 0));
        const comp = Math.pow(1 - volLevel, 1.2);
        setP(n.loudBass.gain, loud * comp * 8, 0.15);
        setP(n.loudTreble.gain, loud * comp * 4, 0.15);
      }
    },
    saveCustomPreset(name) {
      const nm = String(name || '').trim().slice(0, 24);
      if (!nm) return null;
      const list = readCustomPresets();
      const id = 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
      list.push({ id, name: nm, state: customSnapshot(), at: Date.now() });
      writeCustomPresets(list.slice(-40));
      S.preset = 'custom:' + id;
      save();
      return id;
    },
    listCustomPresets() {
      return readCustomPresets().map(x => ({ id: x.id, name: x.name, at: x.at || 0 }));
    },
    applyCustomPreset(id) {
      const item = readCustomPresets().find(x => x.id === id);
      if (!item) return false;
      const keep = { speed: S.speed, pitch: S.pitch, perfMode: S.perfMode, bypass: S.bypass, headphone: S.headphone };
      S = Object.assign(defaultState(), item.state || {});
      S.speed = keep.speed; S.pitch = keep.pitch; S.perfMode = keep.perfMode;
      S.bypass = keep.bypass; S.headphone = keep.headphone;
      S.preset = 'custom:' + id;
      save();
      applyAll();
      if (pitchNode) applyPitch();
      return true;
    },
    deleteCustomPreset(id) {
      writeCustomPresets(readCustomPresets().filter(x => x.id !== id));
      if (S.preset === 'custom:' + id) { S.preset = 'custom'; save(); }
      return true;
    },
    exportCustomPresets() {
      return JSON.stringify({ v: 1, presets: readCustomPresets() }, null, 2);
    },
    importCustomPresets(text) {
      let data;
      try { data = JSON.parse(String(text || '')); } catch (e) { throw new Error('JSON 解析失败'); }
      const arr = Array.isArray(data) ? data : (data && Array.isArray(data.presets) ? data.presets : null);
      if (!arr) throw new Error('格式不正确：缺少 presets 数组');
      const list = readCustomPresets();
      let added = 0;
      for (const it of arr) {
        if (list.length >= 40) break;
        if (!it || typeof it.name !== 'string' || !it.state || typeof it.state !== 'object') continue;
        const clean = {};
        for (const k of CUSTOM_FIELDS) if (it.state[k] !== undefined) clean[k] = it.state[k];
        const id = 'c' + Date.now().toString(36) + Math.floor(Math.random() * 100000).toString(36);
        list.push({ id, name: String(it.name).trim().slice(0, 24) || '导入预设', state: clean, at: Date.now() });
        added++;
      }
      writeCustomPresets(list);
      return added;
    },
    latency() {
      const lim = wLimiterReady ? 3 : 0;
      const tr = ((Number(S.transient) || 0) > 0.001 || (Number(S.transientSustain) || 0) > 0.001) ? 2 : 0;
      const p = (S.pitch !== 0 && pitchMetrics && pitchMetrics.latency) ? Math.round(pitchMetrics.latency * 1000) : 0;
      return { limiter: lim, transient: tr, pitch: p, totalFx: lim + tr + p };
    },
    setPreset(key) {
      const p = PRESETS[key];
      if (!p) return;
      S.preset = key;
      autoDb = 0; alDry = 0; alWet = 0; alN = 0; alWasOn = !!S.autoLevel;
      if (key === 'original') {
        S = Object.assign(defaultState(), { speed: S.speed, pitch: S.pitch });
        if (pitchNode) applyPitch();
      } else {
        const keep = { speed: S.speed, pitch: S.pitch, eq: S.eq };
        S = Object.assign(defaultState(), p.apply || {});
        S.preset = key; S.speed = keep.speed; S.pitch = keep.pitch;
        // 预设EQ简写键映射进 S.eq（eqBass/eqTreble/eqBands）
        if (p.apply) {
          if (p.apply.eqBass !== undefined) S.eq.bass = p.apply.eqBass;
          if (p.apply.eqTreble !== undefined) S.eq.treble = p.apply.eqTreble;
          if (p.apply.eqBands) S.eq.bands = p.apply.eqBands.slice();
        } else S.eq = keep.eq;
      }
      applyAll(); save();
    },
    async setPitch(v) {
      S.pitch = Math.max(-6, Math.min(6, v || 0)); save();
      if (S.pitch !== 0) {
        const okP = await ensurePitch();
        if (!okP) { S.pitch = 0; save(); return false; }
      }
      applyPitch(); return true;
    },
    pitchAvailable() { return pitchReady; },
    pitchEngine() { return pitchEngineName; },
    setPitchEngine,
    debug() {
      return {
        eqGains: n.eqB ? n.eqB.map(b => +b.gain.value.toFixed(2)) : null,
        bass: n.eqBass ? +n.eqBass.gain.value.toFixed(2) : null,
        treble: n.eqTreble ? +n.eqTreble.gain.value.toFixed(2) : null,
        wet: n.envWet ? +n.envWet.gain.value.toFixed(3) : null,
        envPreMs: n.envPre ? Math.round(n.envPre.delayTime.value * 1000) : null,
        wetHp: n.envHP ? Math.round(n.envHP.frequency.value) : null,
        wetLp: n.envLP ? Math.round(n.envLP.frequency.value) : null,
        transientReady: trReady,
        transientAttack: trNode ? +(trNode.parameters.get('attack').value).toFixed(2) : null,
        transientSustain: trNode ? +(trNode.parameters.get('sustain').value).toFixed(2) : null,
        transientHigh: trNode ? +(trNode.parameters.get('highOnly').value) > 0.5 : !!(S.transientHigh),
        transientFreq: trNode ? Math.round(trNode.parameters.get('freq').value) : (S.transientFreq == null ? 2000 : Number(S.transientFreq)),
        loudness: Math.max(0, Math.min(1, Number(S.loudness) || 0)),
        volLevel: +volLevel.toFixed(2),
        loudBass: n.loudBass ? +n.loudBass.gain.value.toFixed(2) : null,
        loudTreble: n.loudTreble ? +n.loudTreble.gain.value.toFixed(2) : null,
        dynEqReady: dynReady,
        dynEqGr: dynGr.slice(),
        dynEqAmount: dynNode ? +(dynNode.parameters.get('amount').value).toFixed(2) : null,
        dynEqBands: dynNode ? ['low', 'mid', 'high'].map(k => +(dynNode.parameters.get(k).value).toFixed(2)) : null,
        dynEqParams: dynNode ? {
          low: { f: Math.round(dynNode.parameters.get('fLow').value), q: +dynNode.parameters.get('qLow').value.toFixed(2), th: +dynNode.parameters.get('thLow').value.toFixed(1) },
          mid: { f: Math.round(dynNode.parameters.get('fMid').value), q: +dynNode.parameters.get('qMid').value.toFixed(2), th: +dynNode.parameters.get('thMid').value.toFixed(1) },
          high: { f: Math.round(dynNode.parameters.get('fHigh').value), q: +dynNode.parameters.get('qHigh').value.toFixed(2), th: +dynNode.parameters.get('thHigh').value.toFixed(1) }
        } : null,
        bassExciter: +(S.bassExciter || 0).toFixed(2),
        bassDrive: n.bassDrive ? +n.bassDrive.gain.value.toFixed(2) : null,
        bassWet: n.bassWet ? +n.bassWet.gain.value.toFixed(3) : null,
        bassFreq: n.bassLP1 ? Math.round(n.bassLP1.frequency.value) : null,
        reverbEngine: fdnReady ? ((S.fdnReverb === false || S.perfMode) ? 'ir' : 'fdn') : 'ir',
        fdnReady,
        convWet: n.convWet ? +n.convWet.gain.value.toFixed(3) : null,
        fdnWet: n.fdnWet ? +n.fdnWet.gain.value.toFixed(3) : null,
        fdnParams: fdnNode ? {
          size: +(fdnNode.parameters.get('size').value || 0).toFixed(2),
          decay: +(fdnNode.parameters.get('decay').value || 0).toFixed(2),
          damping: +(fdnNode.parameters.get('damping').value || 0).toFixed(2),
          erMix: +(fdnNode.parameters.get('erMix').value || 0).toFixed(2)
        } : null,
        duckReady,
        duckDepth: duckNode ? +(duckNode.parameters.get('depth').value).toFixed(2) : null,
        duckDb,
        irKey: n._convKey || null,
        rotHigh: n.rotHigh ? +n.rotHigh.gain.value.toFixed(3) : null,
        rotSpeed: n.rotOscX ? n.rotOscX.frequency.value : null,
        side: n.wSide ? +n.wSide.gain.value.toFixed(3) : null,
        sideHigh: n.sideHS ? +n.sideHS.gain.value.toFixed(2) : null,
        widthHigh: +(S.widthHigh == null ? 1 : S.widthHigh).toFixed(2),
        mid: n.gainM ? +n.gainM.gain.value.toFixed(3) : null,
        exWet: n.exWet ? +n.exWet.gain.value.toFixed(3) : null,
        compTh: n.nightLowComp ? [
          +n.nightLowComp.threshold.value.toFixed(1),
          +n.nightMidComp.threshold.value.toFixed(1),
          +n.nightHighComp.threshold.value.toFixed(1)
        ] : null,
        nightReduction: n.nightLowComp ? [
          +(n.nightLowComp.reduction || 0).toFixed(1),
          +(n.nightMidComp.reduction || 0).toFixed(1),
          +(n.nightHighComp.reduction || 0).toFixed(1)
        ] : null,
        postEq: n.postEq ? +n.postEq.gain.value.toFixed(3) : null,
        preamp: n.preamp ? +n.preamp.gain.value.toFixed(3) : null,
        crossfeed: n.cfLR ? +n.cfLR.gain.value.toFixed(3) : null,
        cfMid: n.cfML ? +n.cfML.gain.value.toFixed(3) : null,
        cfShelf: n.cfShelfL ? +n.cfShelfL.gain.value.toFixed(2) : null,
        cfDelayMs: n.cfDL ? +(n.cfDL.delayTime.value * 1000).toFixed(2) : null,
        cfFreq: n.cfLPL ? Math.round(n.cfLPL.frequency.value) : null,
        presetTrimDb: S.presetTrim || 0,
        presetTrimGain: n.presetTrim ? +n.presetTrim.gain.value.toFixed(3) : null,
        headphone: S.headphone ? { name: S.headphone.name, source: S.headphone.source, preamp: S.headphone.preamp, amount: S.headphone.amount, filters: S.headphone.filters.length } : null,
        hpDry: n.hpDry ? +n.hpDry.gain.value.toFixed(3) : null,
        hpWet: n.hpWet ? +n.hpWet.gain.value.toFixed(3) : null,
        hpPreamp: n.hpPreamp ? +n.hpPreamp.gain.value.toFixed(3) : null,
        autoLevel: !!S.autoLevel,
        autoDb: +autoDb.toFixed(2),
        autoGain: n.autoGain ? +n.autoGain.gain.value.toFixed(3) : null,
        autoDry: +alDry.toFixed(4),
        autoWet: +alWet.toFixed(4),
        bypass: !!S.bypass,
        bypassDry: n.bypassDry ? +n.bypassDry.gain.value.toFixed(3) : null,
        bypassWet: n.bypassWet ? +n.bypassWet.gain.value.toFixed(3) : null,
        monoBassLow: n.wSideLow ? +n.wSideLow.gain.value.toFixed(3) : null,
        limiterReady: !!wLimiterReady,
        limiterGrDb,
        limiterVer,
        limiterPeak: +limiterPeak.toFixed(3),
        limiterPeakDb: limiterPeak > 0 ? +(20 * Math.log10(limiterPeak)).toFixed(2) : null,
        limiterPeakMaxDb: limiterPeakMax > 0 ? +(20 * Math.log10(limiterPeakMax)).toFixed(2) : null,
        limiterThr: +limiterThr.toFixed(3),
        preLimPeak: +preLimPeak().toFixed(3),
        irLen: n.conv && n.conv.buffer ? n.conv.buffer.length : null,
        irDur: n.conv && n.conv.buffer ? +n.conv.buffer.duration.toFixed(2) : null,
        irHead: n.conv && n.conv.buffer ? (function () { const d = n.conv.buffer.getChannelData(0); let m = 0; for (let i = 0; i < Math.max(1, Math.floor(d.length * 0.008)); i++) m = Math.max(m, Math.abs(d[i])); return +m.toFixed(3); })() : null,
        irEarly: n.conv && n.conv.buffer ? (function () { const d = n.conv.buffer.getChannelData(0); let m = 0; const a = Math.floor(d.length * 0.015), b = Math.floor(d.length * 0.06); for (let i = a; i < b; i++) m = Math.max(m, Math.abs(d[i])); return +m.toFixed(3); })() : null,
        hiss: n.tapeHiss ? +n.tapeHiss.gain.value.toFixed(4) : null,
        trim: n.trim ? +n.trim.gain.value.toFixed(3) : null,
        nightTrim: n.nightTrim ? +n.nightTrim.gain.value.toFixed(3) : null,
        nightAmount: S.nightAmount == null ? 1 : Number(S.nightAmount),
        limDry: n.limDry ? +n.limDry.gain.value.toFixed(3) : null,
        limWet: n.limWet ? +n.limWet.gain.value.toFixed(3) : null,
        rotBypass: n.rotBypass ? +n.rotBypass.gain.value.toFixed(3) : null,
        ctxState: ctx ? ctx.state : null,
        ctxTime: ctx ? +ctx.currentTime.toFixed(2) : null,
        tubeWet: n.tubeWet ? +n.tubeWet.gain.value.toFixed(3) : null,
        tapeWet: n.tapeWet ? +n.tapeWet.gain.value.toFixed(3) : null,
        tapeDry: n.tapeDry ? +n.tapeDry.gain.value.toFixed(3) : null,
        tapePre: n.tapePre ? +n.tapePre.gain.value.toFixed(2) : null,
        tapeDe: n.tapeDe ? +n.tapeDe.gain.value.toFixed(2) : null,
        tapeBump: n.tapeBump ? +n.tapeBump.gain.value.toFixed(2) : null,
        tubeMid: n.tubeMid ? +n.tubeMid.gain.value.toFixed(2) : null,
        deEsser: Number(S.deEsser) || 0,
        deBypass: n.deBypass ? +n.deBypass.gain.value.toFixed(3) : null,
        deWet: n.deWet ? +n.deWet.gain.value.toFixed(3) : null,
        deEngine: deReady ? 'worklet' : 'graph',
        deFreq: deReady ? Math.round(deNode.parameters.get('freq').value) : 5000,
        deTh: deReady ? +(-18 - 12 * (Number(S.deEsser) || 0)).toFixed(1) : (n.deComp ? +n.deComp.threshold.value.toFixed(1) : null),
        deRatio: deReady ? +(1 + 2 * (Number(S.deEsser) || 0)).toFixed(2) : (n.deComp ? +n.deComp.ratio.value.toFixed(2) : null),
        deReduction: deReady ? +deWlReduction.toFixed(1) : (n.deComp ? +(n.deComp.reduction || 0).toFixed(1) : null),
        perfMode: !!S.perfMode,
        limiterPhases: limiterPhases,
        wowG1: n.wowG1 ? 'ok' : 'missing',
        pitchParam: pitchNode && pitchNode.parameters && pitchNode.parameters.get("pitchSemitones") ? pitchNode.parameters.get("pitchSemitones").value : null,
        pitchEngine: pitchEngineName,
        pitchMetrics: { underrunCount: pitchMetrics.underrunCount, framesBuffered: pitchMetrics.framesBuffered, blockCount: pitchMetrics.blockCount, outputRms: pitchMetrics.outputRms, outputPeak: pitchMetrics.outputPeak, engine: pitchMetrics.engine, latency: pitchMetrics.latency }
      };
    }
  };
})();
