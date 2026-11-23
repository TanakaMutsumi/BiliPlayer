/* 动态 EQ 离线自测：node scripts/test-dyneq.mjs
   用最小 AudioWorklet 运行时桩直接跑 worklet，验证透明性/高频抑制/低频抑制。 */
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../public/js/vendor/dynamic-eq-worklet.js', import.meta.url), 'utf8');
let Processor = null;
const sandbox = {
  sampleRate: 48000,
  AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } },
  registerProcessor: (name, cls) => { Processor = cls; },
  Math, Float32Array, Int32Array, Array, Number, console
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
if (!Processor) throw new Error('processor not registered');

const sr = 48000;
function render(dry, amount, low, mid, high, extra) {
  const p = new Processor();
  const out = new Float32Array(dry.length);
  const n = 128;
  const inL = new Float32Array(n), inR = new Float32Array(n);
  const outL = new Float32Array(n), outR = new Float32Array(n);
  const params = Object.assign({ amount: [amount], low: [low], mid: [mid], high: [high] }, extra || {});
  for (let off = 0; off < dry.length; off += n) {
    const m = Math.min(n, dry.length - off);
    for (let i = 0; i < m; i++) { inL[i] = dry[off + i]; inR[i] = dry[off + i]; }
    for (let i = m; i < n; i++) { inL[i] = 0; inR[i] = 0; }
    p.process([[inL, inR]], [[outL, outR]], params);
    for (let i = 0; i < m; i++) out[off + i] = outL[i];
  }
  return out;
}
function goertzel(a, f, t0, dur) {
  const w = 2 * Math.PI * f / sr, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  const i0 = Math.floor(t0 * sr), i1 = Math.floor((t0 + dur) * sr);
  for (let i = i0; i < i1; i++) { const s0 = a[i] + c * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / ((i1 - i0) / 2);
}
function mk(freq, amp, noise = 0.06) {
  const len = sr * 2, d = new Float32Array(len);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const r = Math.random() * 2 - 1;
    lp += 0.15 * (r - lp);
    d[i] = noise * lp + amp * Math.sin(2 * Math.PI * freq * i / sr);
  }
  return d;
}
const hi = mk(3500, 0.08);
const r0 = render(hi, 0, 0, 0, 0);
const rh = render(hi, 1, 0, 0, 1);
const rhAlt = render(hi, 1, 0, 0, 1, { fHigh: [3000], qHigh: [2.5], thHigh: [-6] });
const rl = render(hi, 1, 1, 0, 0);
const lo = mk(180, 0.15);
const lo0 = render(lo, 0, 0, 0, 0);
const lo1 = render(lo, 1, 1, 0, 0);
let md = 0;
for (let i = 0; i < hi.length; i++) md = Math.max(md, Math.abs(r0[i] - hi[i]));
const nan = [rh, rl, lo1].some(a => Array.from(a).some(v => !Number.isFinite(v)));
const db = (a, b) => +(20 * Math.log10(a / b)).toFixed(2);
const out = {
  transparentMaxDiff: md,
  hiDry: +goertzel(hi, 3500, 0.5, 1).toFixed(4),
  hiCutHigh: +goertzel(rh, 3500, 0.5, 1).toFixed(4),
  hiHighDb: db(goertzel(rh, 3500, 0.5, 1), goertzel(hi, 3500, 0.5, 1)),
  hiCutLowOnly: +goertzel(rl, 3500, 0.5, 1).toFixed(4),
  hiLowOnlyDb: db(goertzel(rl, 3500, 0.5, 1), goertzel(hi, 3500, 0.5, 1)),
  loDry: +goertzel(lo, 180, 0.5, 1).toFixed(4),
  loCut: +goertzel(lo1, 180, 0.5, 1).toFixed(4),
  loDb: db(goertzel(lo1, 180, 0.5, 1), goertzel(lo, 180, 0.5, 1)),
  hiAltDb: db(goertzel(rhAlt, 3500, 0.5, 1), goertzel(hi, 3500, 0.5, 1)),
  nan
};
console.log(JSON.stringify(out, null, 2));
if (!(out.transparentMaxDiff === 0 && out.hiHighDb <= -4 && Math.abs(out.hiLowOnlyDb) < 0.2 && out.loDb <= -3 && out.hiAltDb > out.hiHighDb + 1 && !out.nan)) {
  console.error('FAIL: dynamic EQ'); process.exit(1);
}
