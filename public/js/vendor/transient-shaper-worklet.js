/* 立体声联动瞬态塑形（AudioWorklet）
   - 双包络：fast（0.8ms attack / 50ms release）与 slow（30ms / 300ms）
   - 2ms 前视：增益提前于延迟后的音频建立，能抓住第一个瞬态
   - highOnly=1：2kHz LR4 分频，只塑形高频段，避免底鼓/贝斯抽吸
   - 参数为 0 时直通（无延迟、逐样本透明）
   独立实现，思路参考常见 transient shaper 的双包络 + lookahead。 */
class TransientShaperProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'attack', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'sustain', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'highOnly', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'freq', defaultValue: 2000, minValue: 1000, maxValue: 4000, automationRate: 'k-rate' }
    ];
  }
  constructor() {
    super();
    this.fast = 0;
    this.slow = 0;
    this.gain = 1;
    this.aFast = 1 - Math.exp(-1 / (sampleRate * 0.0008));
    this.rFast = 1 - Math.exp(-1 / (sampleRate * 0.05));
    this.aSlow = 1 - Math.exp(-1 / (sampleRate * 0.03));
    this.rSlow = 1 - Math.exp(-1 / (sampleRate * 0.3));
    this.gSmooth = 1 - Math.exp(-1 / (sampleRate * 0.002));
    this.look = Math.max(1, Math.round(sampleRate * 0.002));
    this.dly = [new Float32Array(this.look), new Float32Array(this.look)];
    this.dpos = 0;
    const st = () => ({ x1: 0, x2: 0, y1: 0, y2: 0 });
    this.st = [0, 1].map(() => ({ lp1: st(), lp2: st(), hp1: st(), hp2: st(), det: st() }));
    this.freq = 2000;
    this.setCoefs(this.freq);
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
    const atk = Math.max(0, Math.min(1, (params.attack && params.attack[0]) || 0));
    const sus = Math.max(0, Math.min(1, (params.sustain && params.sustain[0]) || 0));
    const highOnly = ((params.highOnly && params.highOnly[0]) || 0) > 0.5;
    const freq = Math.max(1000, Math.min(4000, (params.freq && params.freq[0]) || 2000));
    if (Math.abs(freq - this.freq) > 0.5) { this.freq = freq; this.setCoefs(freq); }
    if (atk < 1e-4 && sus < 1e-4) {
      for (let i = 0; i < n; i++) {
        this.dly[0][this.dpos] = inL[i];
        this.dly[1][this.dpos] = inR[i];
        this.dpos = this.dpos + 1 >= this.look ? 0 : this.dpos + 1;
        outL[i] = inL[i];
        outR[i] = inR[i];
      }
      this.gain = 1;
      return true;
    }
    const s0 = this.st[0], s1 = this.st[1];
    for (let i = 0; i < n; i++) {
      const iL = inL[i], iR = inR[i];
      const dL = this.dly[0][this.dpos], dR = this.dly[1][this.dpos];
      this.dly[0][this.dpos] = iL;
      this.dly[1][this.dpos] = iR;
      this.dpos = this.dpos + 1 >= this.look ? 0 : this.dpos + 1;
      let x;
      if (highOnly) {
        const hL = this.bq(s0.det, this.hp, iL);
        const hR = this.bq(s1.det, this.hp, iR);
        x = Math.max(Math.abs(hL), Math.abs(hR));
      } else {
        x = Math.max(Math.abs(iL), Math.abs(iR));
      }
      this.fast += (x > this.fast ? this.aFast : this.rFast) * (x - this.fast);
      this.slow += (x > this.slow ? this.aSlow : this.rSlow) * (x - this.slow);
      const d = this.fast - this.slow;
      const den = this.slow + 0.001;
      let target = 1;
      if (d > 0) target = 1 + atk * Math.min(1.2, d / den);
      else if (d < 0) target = 1 - sus * 0.8 * Math.min(1, -d / den);
      target = Math.max(0.3, Math.min(2.5, target));
      this.gain += this.gSmooth * (target - this.gain);
      if (highOnly) {
        const loL = this.bq(s0.lp2, this.lp, this.bq(s0.lp1, this.lp, dL));
        const loR = this.bq(s1.lp2, this.lp, this.bq(s1.lp1, this.lp, dR));
        const hiL = this.bq(s0.hp2, this.hp, this.bq(s0.hp1, this.hp, dL));
        const hiR = this.bq(s1.hp2, this.hp, this.bq(s1.hp1, this.hp, dR));
        outL[i] = loL + hiL * this.gain;
        outR[i] = loR + hiR * this.gain;
      } else {
        outL[i] = dL * this.gain;
        outR[i] = dR * this.gain;
      }
    }
    return true;
  }
}
registerProcessor('transient-shaper', TransientShaperProcessor);
