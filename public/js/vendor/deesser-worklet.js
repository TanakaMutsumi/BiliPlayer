/* 去齿音（AudioWorklet）
   - 5kHz LR4 分频（两级 Butterworth）
   - 只对高频段做快速压缩，低频段原样通过
   - 逐采样包络与增益，无 DynamicsCompressor 的 makeup 问题
   - amount=0 时逐样本透明
   独立实现，思路参考常见 split-band de-esser。 */
class DeEsserProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'amount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'freq', defaultValue: 5000, minValue: 4000, maxValue: 8000, automationRate: 'k-rate' }
    ];
  }
  constructor() {
    super();
    const st = () => ({ x1: 0, x2: 0, y1: 0, y2: 0 });
    this.st = [0, 1].map(() => ({ lp1: st(), lp2: st(), hp1: st(), hp2: st() }));
    this.freq = 5000;
    this.setCoefs(this.freq);
    this.env = 0;
    this.gain = 1;
    this.aEnv = 1 - Math.exp(-1 / (sampleRate * 0.002));
    this.rEnv = 1 - Math.exp(-1 / (sampleRate * 0.05));
    this.aGain = 1 - Math.exp(-1 / (sampleRate * 0.002));
    this.rGain = 1 - Math.exp(-1 / (sampleRate * 0.06));
    this.frames = 0;
    this.lastReport = 0;
  }
  setCoefs(freq) {
    const w0 = 2 * Math.PI * freq / sampleRate;
    const cos = Math.cos(w0), sin = Math.sin(w0);
    const alpha = sin / (2 * 0.70710678);
    const a0 = 1 + alpha;
    this.lp = {
      b0: (1 - cos) / 2 / a0, b1: (1 - cos) / a0, b2: (1 - cos) / 2 / a0,
      a1: -2 * cos / a0, a2: (1 - alpha) / a0
    };
    this.hp = {
      b0: (1 + cos) / 2 / a0, b1: -(1 + cos) / a0, b2: (1 + cos) / 2 / a0,
      a1: -2 * cos / a0, a2: (1 - alpha) / a0
    };
  }
  bq(st, c, x) {
    const y = c.b0 * x + c.b1 * st.x1 + c.b2 * st.x2 - c.a1 * st.y1 - c.a2 * st.y2;
    st.x2 = st.x1; st.x1 = x; st.y2 = st.y1; st.y1 = y;
    return y;
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
    const freq = Math.max(4000, Math.min(8000, (params.freq && params.freq[0]) || 5000));
    if (Math.abs(freq - this.freq) > 0.5) { this.freq = freq; this.setCoefs(freq); }
    if (amount < 1e-4) {
      for (let i = 0; i < n; i++) { outL[i] = inL[i]; outR[i] = inR[i]; }
      this.gain = 1;
      this.frames += n;
      if (this.frames - this.lastReport >= sampleRate * 0.1) {
        this.lastReport = this.frames;
        this.port.postMessage({ reduction: 0 });
      }
      return true;
    }
    const thDb = -18 - 12 * amount;
    const th = Math.pow(10, thDb / 20);
    const ratio = 1 + 2 * amount;
    const expo = 1 / ratio - 1;
    const s0 = this.st[0], s1 = this.st[1];
    for (let i = 0; i < n; i++) {
      const iL = inL[i], iR = inR[i];
      const loL = this.bq(s0.lp2, this.lp, this.bq(s0.lp1, this.lp, iL));
      const loR = this.bq(s1.lp2, this.lp, this.bq(s1.lp1, this.lp, iR));
      const hiL = this.bq(s0.hp2, this.hp, this.bq(s0.hp1, this.hp, iL));
      const hiR = this.bq(s1.hp2, this.hp, this.bq(s1.hp1, this.hp, iR));
      const x = Math.max(Math.abs(hiL), Math.abs(hiR));
      this.env += (x > this.env ? this.aEnv : this.rEnv) * (x - this.env);
      let target = 1;
      if (this.env > th) target = Math.pow(this.env / th, expo);
      target = Math.max(0.25, Math.min(1, target));
      const a = target < this.gain ? this.aGain : this.rGain;
      this.gain += a * (target - this.gain);
      outL[i] = loL + hiL * this.gain;
      outR[i] = loR + hiR * this.gain;
    }
    this.frames += n;
    if (this.frames - this.lastReport >= sampleRate * 0.1) {
      this.lastReport = this.frames;
      this.port.postMessage({ reduction: +(20 * Math.log10(Math.max(1e-4, this.gain))).toFixed(1) });
    }
    return true;
  }
}
registerProcessor('de-esser', DeEsserProcessor);
