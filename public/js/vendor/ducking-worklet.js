/* 混响避让（ducking）AudioWorklet
   - 输入 0：混响湿声；输入 1：干声侧链
   - 干声包络越大，湿声压得越多；干声安静时混响自然回来
   - depth=0 时逐样本透明；最大避让 -12dB
   独立实现，思路参考常见 reverb ducking / sidechain。 */
class DuckingProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'depth', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }
  constructor() {
    super();
    this.env = 0;
    this.gain = 1;
    this.aEnv = 1 - Math.exp(-1 / (sampleRate * 0.005));
    this.rEnv = 1 - Math.exp(-1 / (sampleRate * 0.15));
    this.aGain = 1 - Math.exp(-1 / (sampleRate * 0.01));
    this.rGain = 1 - Math.exp(-1 / (sampleRate * 0.2));
    this.frames = 0;
    this.lastReport = 0;
  }
  process(inputs, outputs, params) {
    const wet = inputs[0];
    const sc = inputs[1];
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const n = output[0].length;
    const depth = Math.max(0, Math.min(1, (params.depth && params.depth[0]) || 0));
    if (!wet || !wet.length || !wet[0]) {
      for (let c = 0; c < output.length; c++) output[c].fill(0);
      return true;
    }
    const scL = sc && sc[0] ? sc[0] : null;
    const scR = sc && sc[1] ? sc[1] : scL;
    for (let i = 0; i < n; i++) {
      let x = 0;
      if (scL) {
        const a = Math.abs(scL[i]), b = Math.abs(scR[i]);
        x = a > b ? a : b;
      }
      this.env += (x > this.env ? this.aEnv : this.rEnv) * (x - this.env);
      const over = Math.max(0, Math.min(1, (this.env - 0.04) / 0.16));
      const target = 1 - depth * 0.75 * over;
      const a = target < this.gain ? this.aGain : this.rGain;
      this.gain += a * (target - this.gain);
      for (let c = 0; c < output.length; c++) {
        const src = wet[c] || wet[0];
        output[c][i] = (src ? src[i] : 0) * this.gain;
      }
    }
    this.frames += n;
    if (this.frames - this.lastReport >= sampleRate * 0.1) {
      this.lastReport = this.frames;
      this.port.postMessage({ duckDb: +(20 * Math.log10(Math.max(1e-4, this.gain))).toFixed(2) });
    }
    return true;
  }
}
registerProcessor('reverb-duck', DuckingProcessor);
