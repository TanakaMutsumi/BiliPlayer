/* 去齿音 worklet 离线自测：node scripts/test-deesser.mjs */
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../public/js/vendor/deesser-worklet.js', import.meta.url), 'utf8');
let Processor = null;
const sandbox = {
  sampleRate: 48000,
  AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } },
  registerProcessor: (name, cls) => { if (name === 'de-esser') Processor = cls; },
  Math, Float32Array, Int32Array, Array, Number, console
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
if (!Processor) throw new Error('processor not registered');
const sr = 48000, len = sr * 2;

function render(dry, amount, freq = 5000) {
  const p = new Processor();
  const out = new Float32Array(len);
  const n = 128;
  const inL = new Float32Array(n), inR = new Float32Array(n);
  const oL = new Float32Array(n), oR = new Float32Array(n);
  const params = { amount: [amount], freq: [freq] };
  for (let off = 0; off < len; off += n) {
    const m = Math.min(n, len - off);
    for (let i = 0; i < m; i++) { inL[i] = dry[off + i]; inR[i] = dry[off + i]; }
    for (let i = m; i < n; i++) { inL[i] = 0; inR[i] = 0; }
    p.process([[inL, inR]], [[oL, oR]], params);
    for (let i = 0; i < m; i++) out[off + i] = oL[i];
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
const dry = new Float32Array(len);
for (let i = 0; i < len; i++) {
  const t = i / sr;
  dry[i] = 0.2 * Math.sin(2 * Math.PI * 1000 * t) + 0.3 * Math.sin(2 * Math.PI * 8000 * t);
}
const r0 = render(dry, 0);
const r1 = render(dry, 1);
const dry5 = new Float32Array(len);
for (let i = 0; i < len; i++) {
  const t = i / sr;
  dry5[i] = 0.2 * Math.sin(2 * Math.PI * 5000 * t) + 0.2 * Math.sin(2 * Math.PI * 8000 * t);
}
const r4 = render(dry5, 1, 4000);
const r8 = render(dry5, 1, 8000);
let md = 0; for (let i = 0; i < len; i++) md = Math.max(md, Math.abs(r0[i] - dry[i]));
const db = (a, b) => +(20 * Math.log10(a / b)).toFixed(2);
const g = (a, f) => goertzel(a, f, 0.5, 1);
const out = {
  transparent: md,
  k1: { dry: +g(dry, 1000).toFixed(4), off: +g(r0, 1000).toFixed(4), on: +g(r1, 1000).toFixed(4), db: db(g(r1, 1000), g(dry, 1000)) },
  k8: { dry: +g(dry, 8000).toFixed(4), off: +g(r0, 8000).toFixed(4), on: +g(r1, 8000).toFixed(4), db: db(g(r1, 8000), g(dry, 8000)) },
  nan: Array.from(r1).some(v => !Number.isFinite(v)),
  freqTest: {
    k5At4k: +g(r4, 5000).toFixed(4),
    k5At8k: +g(r8, 5000).toFixed(4),
    ratioDb: db(g(r8, 5000), g(r4, 5000))
  }
};
console.log(JSON.stringify(out, null, 2));
if (!(out.transparent === 0 && out.k8.db <= -6 && out.k1.db > -0.5 && out.freqTest.k5At8k > out.freqTest.k5At4k * 1.3 && !out.nan)) {
  console.error('FAIL: de-esser'); process.exit(1);
}
