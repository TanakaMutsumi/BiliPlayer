/* 3 段动态 EQ / 动态共振抑制（AudioWorklet）
   - 180Hz（浑浊）、1.2kHz（箱声）、3.5kHz（刺耳）三个窄带
   - 每带：带通检测 + 峰值滤波器动态衰减
   - 相对检测：带内包络 / 全频包络，超过阈值才压，避免整体音量变化
   - 系数按 128 样本块更新；增益 10ms attack / 150ms release
   - amount=0 时逐样本透明
   独立实现，思路参考常见 dynamic EQ / resonance suppressor。 */
class DynamicEqProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'amount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'low', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mid', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'high', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'fLow', defaultValue: 180, minValue: 80, maxValue: 300, automationRate: 'k-rate' },
      { name: 'qLow', defaultValue: 0.9, minValue: 0.4, maxValue: 3, automationRate: 'k-rate' },
      { name: 'thLow', defaultValue: -11, minValue: -24, maxValue: -4, automationRate: 'k-rate' },
      { name: 'fMid', defaultValue: 1200, minValue: 600, maxValue: 2000, automationRate: 'k-rate' },
      { name: 'qMid', defaultValue: 1.3, minValue: 0.4, maxValue: 3, automationRate: 'k-rate' },
      { name: 'thMid', defaultValue: -13, minValue: -24, maxValue: -4, automationRate: 'k-rate' },
      { name: 'fHigh', defaultValue: 3500, minValue: 2000, maxValue: 6000, automationRate: 'k-rate' },
      { name: 'qHigh', defaultValue: 1.2, minValue: 0.4, maxValue: 3, automationRate: 'k-rate' },
      { name: 'thHigh', defaultValue: -15, minValue: -24, maxValue: -4, automationRate: 'k-rate' }
    ];
  }
  constructor() {
    super();
    const defs = [
      { f: 180, q: 0.9, maxCut: 5, th: -11 },
      { f: 1200, q: 1.3, maxCut: 5, th: -13 },
      { f: 3500, q: 1.2, maxCut: 7, th: -15 }
    ];
    this.bands = defs.map(d => {
      const band = {
        f: d.f, q: d.q, maxCut: d.maxCut, th: d.th,
        bp: { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 },
        pk: { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 },
        gainDb: 0
      };
      this.setBp(band);
      return band;
    });
    this.st = [0, 1].map(() => ({
      fullEnv: 0,
      bandEnv: [0, 0, 0],
      bp: this.bands.map(() => ({ x1: 0, x2: 0, y1: 0, y2: 0 })),
      pk: this.bands.map(() => ({ x1: 0, x2: 0, y1: 0, y2: 0 }))
    }));
    this.aFast = 1 - Math.exp(-1 / (sampleRate * 0.003));
    this.rFast = 1 - Math.exp(-1 / (sampleRate * 0.1));
    this.aFull = 1 - Math.exp(-1 / (sampleRate * 0.005));
    this.rFull = 1 - Math.exp(-1 / (sampleRate * 0.2));
    this.frames = 0;
    this.lastReport = 0;
  }
  setBp(band) {
    const w0 = 2 * Math.PI * band.f / sampleRate;
    const cos = Math.cos(w0), sin = Math.sin(w0);
    const alpha = sin / (2 * band.q);
    const a0 = 1 + alpha;
    band.bp.b0 = alpha / a0;
    band.bp.b1 = 0;
    band.bp.b2 = -alpha / a0;
    band.bp.a1 = -2 * cos / a0;
    band.bp.a2 = (1 - alpha) / a0;
  }
  computePeak(band, gainDb) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = 2 * Math.PI * band.f / sampleRate;
    const cos = Math.cos(w0), sin = Math.sin(w0);
    const alpha = sin / (2 * band.q);
    const a0 = 1 + alpha / A;
    band.pk.b0 = (1 + alpha * A) / a0;
    band.pk.b1 = (-2 * cos) / a0;
    band.pk.b2 = (1 - alpha * A) / a0;
    band.pk.a1 = (-2 * cos) / a0;
    band.pk.a2 = (1 - alpha / A) / a0;
  }
  report(n, gr) {
    this.frames += n;
    if (this.frames - this.lastReport >= sampleRate * 0.1) {
      this.lastReport = this.frames;
      this.port.postMessage({ gr: gr.map(v => +v.toFixed(2)) });
    }
  }
  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length || !input[0]) return true;
    const inL = input[0];
    const inR = input[1] || input[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    const n = inL.length;
    const amount = Math.max(0, Math.min(1, (params.amount && params.amount[0]) || 0));
    const bandAmt = [
      Math.max(0, Math.min(1, (params.low && params.low[0]) || 0)),
      Math.max(0, Math.min(1, (params.mid && params.mid[0]) || 0)),
      Math.max(0, Math.min(1, (params.high && params.high[0]) || 0))
    ];
    const cfg = [
      { f: params.fLow ? params.fLow[0] : 180, q: params.qLow ? params.qLow[0] : 0.9, th: params.thLow ? params.thLow[0] : -11, fMin: 80, fMax: 300 },
      { f: params.fMid ? params.fMid[0] : 1200, q: params.qMid ? params.qMid[0] : 1.3, th: params.thMid ? params.thMid[0] : -13, fMin: 600, fMax: 2000 },
      { f: params.fHigh ? params.fHigh[0] : 3500, q: params.qHigh ? params.qHigh[0] : 1.2, th: params.thHigh ? params.thHigh[0] : -15, fMin: 2000, fMax: 6000 }
    ];
    for (let b = 0; b < 3; b++) {
      const band = this.bands[b];
      const f = Math.max(cfg[b].fMin, Math.min(cfg[b].fMax, cfg[b].f || 180));
      const q = Math.max(0.4, Math.min(3, cfg[b].q || 0.9));
      const th = Math.max(-24, Math.min(-4, cfg[b].th == null ? -12 : cfg[b].th));
      if (Math.abs(f - band.f) > 0.5 || Math.abs(q - band.q) > 0.005) {
        band.f = f; band.q = q; this.setBp(band);
      }
      band.th = th;
    }
    const bypass = amount < 1e-4 || (bandAmt[0] + bandAmt[1] + bandAmt[2]) < 1e-4;
    if (bypass) {
      for (let i = 0; i < n; i++) { outL[i] = inL[i]; outR[i] = inR[i]; }
      for (const b of this.bands) { b.gainDb = 0; this.computePeak(b, 0); }
      this.frames += n;
      if (this.frames - this.lastReport >= sampleRate * 0.1) {
        this.lastReport = this.frames;
        this.port.postMessage({ gr: [0, 0, 0] });
      }
      return true;
    }
    const s0 = this.st[0], s1 = this.st[1];
    for (let i = 0; i < n; i++) {
      let l = inL[i], r = inR[i];
      const al = Math.abs(l), ar = Math.abs(r);
      s0.fullEnv += (al > s0.fullEnv ? this.aFull : this.rFull) * (al - s0.fullEnv);
      s1.fullEnv += (ar > s1.fullEnv ? this.aFull : this.rFull) * (ar - s1.fullEnv);
      for (let b = 0; b < 3; b++) {
        const band = this.bands[b];
        const B = band.bp, P = band.pk;
        const bp0 = s0.bp[b], bp1 = s1.bp[b];
        const pk0 = s0.pk[b], pk1 = s1.pk[b];
        const yb0 = B.b0 * l + B.b1 * bp0.x1 + B.b2 * bp0.x2 - B.a1 * bp0.y1 - B.a2 * bp0.y2;
        bp0.x2 = bp0.x1; bp0.x1 = l; bp0.y2 = bp0.y1; bp0.y1 = yb0;
        const yb1 = B.b0 * r + B.b1 * bp1.x1 + B.b2 * bp1.x2 - B.a1 * bp1.y1 - B.a2 * bp1.y2;
        bp1.x2 = bp1.x1; bp1.x1 = r; bp1.y2 = bp1.y1; bp1.y1 = yb1;
        const e0 = Math.abs(yb0), e1 = Math.abs(yb1);
        s0.bandEnv[b] += (e0 > s0.bandEnv[b] ? this.aFast : this.rFast) * (e0 - s0.bandEnv[b]);
        s1.bandEnv[b] += (e1 > s1.bandEnv[b] ? this.aFast : this.rFast) * (e1 - s1.bandEnv[b]);
        const y0 = P.b0 * l + P.b1 * pk0.x1 + P.b2 * pk0.x2 - P.a1 * pk0.y1 - P.a2 * pk0.y2;
        pk0.x2 = pk0.x1; pk0.x1 = l; pk0.y2 = pk0.y1; pk0.y1 = y0;
        const y1 = P.b0 * r + P.b1 * pk1.x1 + P.b2 * pk1.x2 - P.a1 * pk1.y1 - P.a2 * pk1.y2;
        pk1.x2 = pk1.x1; pk1.x1 = r; pk1.y2 = pk1.y1; pk1.y1 = y1;
        l = y0; r = y1;
      }
      outL[i] = l;
      outR[i] = r;
    }
    /* 块率：按本块包络更新下一块的三段增益 */
    const dt = n / sampleRate;
    const aA = 1 - Math.exp(-dt / 0.01);
    const aR = 1 - Math.exp(-dt / 0.15);
    const fe = Math.max(s0.fullEnv, s1.fullEnv);
    for (let b = 0; b < 3; b++) {
      const band = this.bands[b];
      const be = Math.max(s0.bandEnv[b], s1.bandEnv[b]);
      let target = 0;
      if (fe > 1e-4 && be > 1e-6) {
        const relDb = 20 * Math.log10(be / fe);
        const over = (relDb - band.th) / 10;
        if (over > 0) target = -band.maxCut * amount * bandAmt[b] * Math.min(1, over);
      }
      const a = target < band.gainDb ? aA : aR;
      band.gainDb += a * (target - band.gainDb);
      this.computePeak(band, band.gainDb);
    }
    this.report(n, this.bands.map(b => b.gainDb));
    return true;
  }
}
registerProcessor('dynamic-eq', DynamicEqProcessor);
