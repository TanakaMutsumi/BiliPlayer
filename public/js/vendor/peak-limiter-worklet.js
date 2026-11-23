/* 立体声联动 lookahead 峰值限制器
   - 3ms 延迟环：增益在峰值到达输出前开始下降
   - 瞬时 attack / 可调 release
   - 放在 AudioFX 交叉馈送之后、安全软限幅之前
   - 8x 64-tap 多相 FIR 带限插值检测 ISP（比 4x 更细的相位分辨率；仍非标准真峰值表） */
class PeakLimiterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -1, minValue: -24, maxValue: 0, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 120, minValue: 10, maxValue: 1000, automationRate: 'k-rate' },
      { name: 'phases', defaultValue: 8, minValue: 4, maxValue: 8, automationRate: 'k-rate' }
    ];
  }
  constructor() {
    super();
    this.look = Math.max(16, Math.min(512, Math.round(sampleRate * 0.003)));
    this.bufs = null;
    this.pos = 0;
    this.gain = 1;
    this.frames = 0;
    this.lastReport = 0;
    this.taps = 64;
    this.phases = 8;
    this.hists = null;
    this.histPos = null;
    /* 8 个相位 × 64 抽头 Hamming 窗 sinc；D = 31.5 - p/8，八相位覆盖 0.875 采样间隔 */
    this.coef = [];
    const center = (this.taps - 1) / 2;
    for (let p = 0; p < this.phases; p++) {
      const c = new Float32Array(this.taps);
      let sum = 0;
      for (let j = 0; j < this.taps; j++) {
        const x = j - center + p / this.phases;
        const s = Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
        const w = 0.54 - 0.46 * Math.cos(2 * Math.PI * j / (this.taps - 1));
        c[j] = s * w;
        sum += c[j];
      }
      for (let j = 0; j < this.taps; j++) c[j] /= sum;
      this.coef.push(c);
    }
  }
  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length || !input[0]) return true;
    const chCount = input.length;
    const n = input[0].length;
    if (!this.bufs || this.bufs.length !== chCount) {
      this.bufs = Array.from({ length: chCount }, () => new Float32Array(this.look));
      this.hists = Array.from({ length: chCount }, () => new Float32Array(this.taps));
      this.histPos = new Int32Array(chCount);
      this.pos = 0;
    }
    const thrDb = params.threshold && params.threshold.length ? params.threshold[0] : -1;
    const relMs = params.release && params.release.length ? params.release[0] : 120;
    const phN = Math.max(4, Math.min(8, Math.round((params.phases && params.phases[0]) || 8)));
    const thr = Math.pow(10, thrDb / 20);
    const rel = Math.exp(-1 / Math.max(1, sampleRate * relMs / 1000));
    let peak = 0;
    for (let c = 0; c < chCount; c++) {
      const src = input[c];
      const hist = this.hists[c];
      let hp = this.histPos[c];
      for (let i = 0; i < n; i++) {
        hist[hp] = src[i];
        /* 4 相位带限插值：每相位 16 抽头，估计采样间峰值 */
        for (let ph = 0; ph < phN; ph++) {
          const co = this.coef[ph];
          let acc = 0, idx = hp;
          for (let j = 0; j < this.taps; j++) {
            acc += co[j] * hist[idx];
            idx--;
            if (idx < 0) idx = this.taps - 1;
          }
          const a = Math.abs(acc);
          if (a > peak) peak = a;
        }
        const ax = Math.abs(src[i]);
        if (ax > peak) peak = ax;
        hp++;
        if (hp >= this.taps) hp = 0;
      }
      this.histPos[c] = hp;
    }
    const target = peak > thr ? thr / peak : 1;
    let minG = 1;
    for (let c = 0; c < chCount; c++) {
      const src = input[c];
      const buf = this.bufs[c];
      const dst = output[c] || output[0];
      let p = this.pos;
      let g = this.gain;
      for (let i = 0; i < n; i++) {
        if (target < g) g = target;                 // attack：瞬时
        else g = rel * g + (1 - rel) * target;      // release：平滑
        if (g < minG) minG = g;
        const delayed = buf[p];
        buf[p] = src[i];
        dst[i] = delayed * g;
        p++;
        if (p >= this.look) p = 0;
      }
      if (c === chCount - 1) {
        this.pos = p;
        this.gain = g;
      }
    }
    /* 每 ~100ms 上报一次本块最小增益，供诊断页显示实时衰减量（0dB=未介入） */
    this.frames += n;
    if (this.frames - this.lastReport >= sampleRate * 0.1) {
      this.lastReport = this.frames;
      this.port.postMessage({ grDb: +(20 * Math.log10(Math.max(1e-4, minG))).toFixed(2), ver: 'fir64x8', phases: phN, peak: +peak.toFixed(4), thr: +thr.toFixed(4) });
    }
    return true;
  }
}
registerProcessor('peak-limiter-processor', PeakLimiterProcessor);
