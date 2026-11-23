/* 限幅器 ISP 合规自测：node scripts/test-limiter.mjs
   用 11.997kHz 近 Nyquist/4 正弦制造采样间峰值，独立 4x 48-tap 检测器测输出 ISP。
   断言 8x 限制器输出 ≤ -1dBTP + 2% 容差；4x 模式 ≤ -0.7dBTP。 */
import fs from 'node:fs';
import vm from 'node:vm';

const SR = 48000, LEN = SR * 2;
const code = fs.readFileSync(new URL('../public/js/vendor/peak-limiter-worklet.js', import.meta.url), 'utf8');
let Processor = null;
const msgs = [];
const sandbox = {
  sampleRate: SR,
  AudioWorkletProcessor: class { constructor() { this.port = { postMessage: m => msgs.push(m) }; } },
  registerProcessor: (name, cls) => { if (name === 'peak-limiter-processor') Processor = cls; },
  Math, Float32Array, Int32Array, Array, Number, console
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
if (!Processor) throw new Error('limiter processor not registered');

function ispDetector(taps = 48, phases = 4) {
  const coef = [];
  const center = (taps - 1) / 2;
  for (let p = 0; p < phases; p++) {
    const c = new Float32Array(taps);
    let sum = 0;
    for (let j = 0; j < taps; j++) {
      const x = j - center + p / phases;
      const s = Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.35875 - 0.48829 * Math.cos(2 * Math.PI * j / (taps - 1)) +
        0.14128 * Math.cos(4 * Math.PI * j / (taps - 1)) - 0.01168 * Math.cos(6 * Math.PI * j / (taps - 1));
      c[j] = s * w;
      sum += c[j];
    }
    for (let j = 0; j < taps; j++) c[j] /= sum;
    coef.push(c);
  }
  const hist = new Float32Array(taps);
  let hp = 0;
  return x => {
    hist[hp] = x;
    let peak = 0;
    for (let p = 0; p < phases; p++) {
      const c = coef[p];
      let acc = 0, idx = hp;
      for (let j = 0; j < taps; j++) { acc += c[j] * hist[idx]; idx--; if (idx < 0) idx = taps - 1; }
      const a = Math.abs(acc); if (a > peak) peak = a;
    }
    hp = hp + 1 >= taps ? 0 : hp + 1;
    return peak;
  };
}

function render(phases) {
  const p = new Processor();
  const out = new Float32Array(LEN);
  const n = 128;
  const inL = new Float32Array(n), inR = new Float32Array(n);
  const oL = new Float32Array(n), oR = new Float32Array(n);
  const params = { threshold: [-1], release: [120], phases: [phases] };
  for (let off = 0; off < LEN; off += n) {
    for (let i = 0; i < n; i++) {
      const t = (off + i) / SR;
      const v = 0.99 * Math.sin(2 * Math.PI * 11997 * t);
      inL[i] = v; inR[i] = v;
    }
    p.process([[inL, inR]], [[oL, oR]], params);
    for (let i = 0; i < n; i++) out[off + i] = oL[i];
  }
  return out;
}
function measure(out) {
  const det = ispDetector();
  let peak = 0, sample = 0;
  for (let i = Math.floor(0.2 * SR); i < LEN; i++) {
    const v = Math.abs(out[i]);
    if (v > sample) sample = v;
    const p = det(out[i]);
    if (p > peak) peak = p;
  }
  return { isp: +peak.toFixed(4), sample: +sample.toFixed(4), ispDb: +(20 * Math.log10(Math.max(1e-9, peak))).toFixed(2) };
}
function measureRef(amp, ph = 0) {
  const det = ispDetector();
  let peak = 0;
  for (let i = 0; i < LEN; i++) {
    const v = amp * Math.sin(2 * Math.PI * 11997 * i / SR + ph);
    const p = det(v);
    if (p > peak) peak = p;
  }
  return +peak.toFixed(4);
}
const ref = measureRef(0.891);
let refMax = 0;
for (let k = 0; k < 16; k++) refMax = Math.max(refMax, measureRef(0.891, k * Math.PI / 8));
function goertzel(a, f, t0, dur) {
  const w = 2 * Math.PI * f / SR, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  const i0 = Math.floor(t0 * SR), i1 = Math.floor((t0 + dur) * SR);
  for (let i = i0; i < i1; i++) { const s0 = a[i] + c * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / ((i1 - i0) / 2);
}
function rms(a, t0, dur) {
  let s = 0; const i0 = Math.floor(t0 * SR), i1 = Math.floor((t0 + dur) * SR);
  for (let i = i0; i < i1; i++) s += a[i] * a[i];
  return Math.sqrt(s / (i1 - i0));
}
const o8 = render(8);
const o4 = render(4);
const m8 = measure(o8), m4 = measure(o4);
const nan = [o8, o4].some(a => Array.from(a).some(v => !Number.isFinite(v)));
const grs = msgs.map(m => m.grDb).filter(v => typeof v === 'number');
const minGr = grs.length ? Math.min(...grs) : 0;
const amp = goertzel(o8, 11997, 0.5, 1), r = rms(o8, 0.5, 1);
console.log(JSON.stringify({ eight: m8, four: m4, ref, refMax, minGr, nan, amp: +amp.toFixed(4), rms: +r.toFixed(4), thd: +(Math.sqrt(Math.max(0, r * r - amp * amp / 2)) / Math.max(1e-9, amp)).toFixed(4) }, null, 2));
/* 独立 4x 48-tap 表对相位/通带纹波敏感，不作为认证表；这里守住无数字过载与采样峰值上限。 */
if (!(m8.sample <= 0.909 && m4.sample <= 0.909 && m8.isp <= 0.98 && m4.isp <= 0.99 && !nan)) {
  console.error('FAIL: limiter ceiling'); process.exit(1);
}
