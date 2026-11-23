/* 8 通道 FDN 算法混响（AudioWorklet）
   - 输入：4 级 Schroeder 全通扩散器（L/R 各一路）
   - 主体：8 条不同长度延迟线 + Householder 反馈矩阵
   - 阻尼：反馈环内一阶低通
   - 调制：每条延迟线慢速 LFO，抑制金属尾
   - 输出：L/R 从左右通道延迟抽头混合
   参考思路：Signalsmith "Let's write a reverb"（FDN + 扩散器 + Householder），独立实现。 */
class FDNReverbProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'size', defaultValue: 1, minValue: 0.3, maxValue: 2, automationRate: 'k-rate' },
      { name: 'decay', defaultValue: 2, minValue: 0.2, maxValue: 8, automationRate: 'k-rate' },
      { name: 'damping', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'modDepth', defaultValue: 0.0002, minValue: 0, maxValue: 0.001, automationRate: 'k-rate' },
      { name: 'erMix', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }
  constructor() {
    super();
    this.N = 8;
    this.base = [0.101, 0.113, 0.127, 0.139, 0.151, 0.163, 0.179, 0.191];
    this.maxSize = 2;
    this.bufs = Array.from({ length: 8 }, (_, i) =>
      new Float32Array(Math.ceil(sampleRate * this.base[i] * this.maxSize) + 8));
    this.pos = new Int32Array(8);
    this.lp = new Float32Array(8);
    this.modPhase = new Float32Array(8);
    this.modRate = [0.07, 0.09, 0.11, 0.13, 0.15, 0.17, 0.19, 0.23];
    this.outs = new Float32Array(8);
    /* 4 级全通扩散器 */
    const dly = [0.0126, 0.0100, 0.0077, 0.0051];
    this.diffL = dly.map(t => new Float32Array(Math.ceil(sampleRate * t) + 1));
    this.diffR = dly.map(t => new Float32Array(Math.ceil(sampleRate * t) + 1));
    this.diffPosL = new Int32Array(4);
    this.diffPosR = new Int32Array(4);
    this.diffGain = 0.5;
    /* 早期反射：8 抽头稀疏网络，补足扩散器到 FDN 首个回声之间的空档 */
    this.erTimes = [0.0071, 0.0113, 0.0167, 0.0229, 0.0293, 0.0371, 0.0449, 0.0531,
                    0.0629, 0.0731, 0.0847, 0.0971, 0.1103, 0.1249, 0.1399];
    this.erGains = [0.62, 0.55, 0.5, 0.44, 0.38, 0.33, 0.28, 0.24,
                    0.21, 0.18, 0.16, 0.14, 0.12, 0.11, 0.1];
    this.erLen = Math.ceil(sampleRate * 0.18) + 4;
    this.erBufL = new Float32Array(this.erLen);
    this.erBufR = new Float32Array(this.erLen);
    this.erPos = 0;
    this.erLpL = 0;
    this.erLpR = 0;
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
    const size = Math.max(0.3, Math.min(2, (params.size && params.size[0]) || 1));
    const decay = Math.max(0.2, Math.min(8, (params.decay && params.decay[0]) || 2));
    const damping = Math.max(0, Math.min(1, (params.damping && params.damping[0]) || 0.3));
    const modDepth = Math.max(0, Math.min(0.001, (params.modDepth && params.modDepth[0]) || 0.0002));
    const dSamp = new Float32Array(8);
    const fb = new Float32Array(8);
    for (let c = 0; c < 8; c++) {
      dSamp[c] = Math.min(this.bufs[c].length - 4, this.base[c] * size * sampleRate);
      fb[c] = Math.min(0.95, Math.pow(10, -3 * (dSamp[c] / sampleRate) / decay));
    }
    const fc = 2000 + (1 - damping) * 10000;
    const coef = 1 - Math.exp(-2 * Math.PI * fc / sampleRate);
    const modScale = modDepth * sampleRate;
    const erScale = 0.65 + 0.35 * size;
    const erCoef = 1 - Math.exp(-2 * Math.PI * 6500 / sampleRate);
    const erOffR = 0.0017 * sampleRate;
    const erMix = Math.max(0, Math.min(1, params.erMix && params.erMix[0] != null ? params.erMix[0] : 0.3));
    for (let i = 0; i < n; i++) {
      let l = inL[i], r = inR[i];
      /* 早期反射：左右抽头错开 1.7ms，读延迟环后再写入当前样本 */
      let eL = 0, eR = 0;
      for (let t = 0; t < this.erTimes.length; t++) {
        let dl = this.erPos - this.erTimes[t] * erScale * sampleRate;
        while (dl < 0) dl += this.erLen;
        const il = Math.floor(dl), fl = dl - il;
        const il2 = il + 1 >= this.erLen ? 0 : il + 1;
        eL += (this.erBufL[il] * (1 - fl) + this.erBufL[il2] * fl) * this.erGains[t];
        let dr = this.erPos - (this.erTimes[t] * erScale * sampleRate + erOffR);
        while (dr < 0) dr += this.erLen;
        const ir = Math.floor(dr), fr = dr - ir;
        const ir2 = ir + 1 >= this.erLen ? 0 : ir + 1;
        eR += (this.erBufR[ir] * (1 - fr) + this.erBufR[ir2] * fr) * this.erGains[t];
      }
      this.erLpL += erCoef * (eL - this.erLpL);
      this.erLpR += erCoef * (eR - this.erLpR);
      this.erBufL[this.erPos] = l;
      this.erBufR[this.erPos] = r;
      this.erPos = this.erPos + 1 >= this.erLen ? 0 : this.erPos + 1;
      /* 扩散器：4 级全通 */
      for (let s = 0; s < 4; s++) {
        const dl = this.diffL[s], dr = this.diffR[s];
        let pl = this.diffPosL[s], pr = this.diffPosR[s];
        const yl = dl[pl] - this.diffGain * l;
        const yr = dr[pr] - this.diffGain * r;
        dl[pl] = l + this.diffGain * yl;
        dr[pr] = r + this.diffGain * yr;
        this.diffPosL[s] = pl + 1 >= dl.length ? 0 : pl + 1;
        this.diffPosR[s] = pr + 1 >= dr.length ? 0 : pr + 1;
        l = yl; r = yr;
      }
      let sum = 0;
      for (let c = 0; c < 8; c++) {
        const buf = this.bufs[c];
        const p = this.pos[c];
        const d = dSamp[c] + Math.sin(this.modPhase[c] * 2 * Math.PI) * modScale;
        let rp = p - d;
        while (rp < 0) rp += buf.length;
        while (rp >= buf.length) rp -= buf.length;
        const i0 = Math.floor(rp);
        const i1 = i0 + 1 >= buf.length ? 0 : i0 + 1;
        const frac = rp - i0;
        const x = buf[i0] * (1 - frac) + buf[i1] * frac;
        const y = this.lp[c] + coef * (x - this.lp[c]);
        this.lp[c] = y;
        const f = y * fb[c];
        this.outs[c] = f;
        sum += f;
        this.modPhase[c] += this.modRate[c] / sampleRate;
        if (this.modPhase[c] >= 1) this.modPhase[c] -= 1;
      }
      /* Householder 反馈矩阵：H = I - (2/N)·1·1ᵀ */
      for (let c = 0; c < 8; c++) {
        const buf = this.bufs[c];
        const p = this.pos[c];
        const inj = (c < 4 ? l : r) * 1.0;
        buf[p] = inj + this.outs[c] - 0.25 * sum;
        this.pos[c] = p + 1 >= buf.length ? 0 : p + 1;
      }
      const d0 = this.outs[0], d1 = this.outs[1], d2 = this.outs[2], d3 = this.outs[3];
      const d4 = this.outs[4], d5 = this.outs[5], d6 = this.outs[6], d7 = this.outs[7];
      outL[i] = (d0 + d2 + d4 + d6) * 1.0 + (d1 + d3) * 0.15 + this.erLpL * erMix;
      outR[i] = (d1 + d3 + d5 + d7) * 1.0 + (d0 + d2) * 0.15 + this.erLpR * erMix;
    }
    return true;
  }
}
registerProcessor('fdn-reverb', FDNReverbProcessor);
