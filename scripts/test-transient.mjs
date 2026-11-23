/* 瞬态塑形（2ms 前视 + 仅高频）离线自测：node scripts/test-transient.mjs */
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../public/js/vendor/transient-shaper-worklet.js', import.meta.url), 'utf8');
let Processor = null;
const sandbox = {
  sampleRate: 48000,
  AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } },
  registerProcessor: (name, cls) => { if (name === 'transient-shaper') Processor = cls; },
  Math, Float32Array, Int32Array, Array, Number, console
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
if (!Processor) throw new Error('processor not registered');
const sr = 48000;

function render(dry, attack, sustain, highOnly, freq = 2000) {
  const p = new Processor();
  const out = new Float32Array(dry.length);
  const n = 128;
  const inL = new Float32Array(n), inR = new Float32Array(n);
  const oL = new Float32Array(n), oR = new Float32Array(n);
  const params = { attack: [attack], sustain: [sustain], highOnly: [highOnly ? 1 : 0], freq: [freq] };
  for (let off = 0; off < dry.length; off += n) {
    const m = Math.min(n, dry.length - off);
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
function peak(a, t0, dur) {
  let p = 0;
  const i0 = Math.floor(t0 * sr), i1 = Math.floor((t0 + dur) * sr);
  for (let i = i0; i < i1; i++) p = Math.max(p, Math.abs(a[i]));
  return p;
}
const len = sr * 2;
function signal(withBurst) {
  const d = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    d[i] = 0.2 * Math.sin(2 * Math.PI * 60 * t);
    if (withBurst && t > 0.1 && t < 0.105) d[i] += 0.3 * Math.sin(2 * Math.PI * 5000 * (t - 0.1));
  }
  return d;
}
const click = signal(true);
const r0 = render(click, 0, 0, 0);
let md = 0; for (let i = 0; i < len; i++) md = Math.max(md, Math.abs(r0[i] - click[i]));
const rA = render(click, 1, 0, 0);
const rH = render(click, 1, 0, 1);
const tone = new Float32Array(len);
for (let i = 0; i < len; i++) tone[i] = 0.2 * Math.sin(2 * Math.PI * 1000 * i / sr);
const rN = render(tone, 0.0001, 0, 1);
const sig2k = new Float32Array(len);
for (let i = 0; i < len; i++) {
  const t = i / sr;
  sig2k[i] = 0.2 * Math.sin(2 * Math.PI * 60 * t);
  if (t > 0.1 && t < 0.105) sig2k[i] += 0.3 * Math.sin(2 * Math.PI * 2000 * (t - 0.1));
}
const r1k = render(sig2k, 1, 0, 1, 1000);
const r4k = render(sig2k, 1, 0, 1, 4000);
const db = (a, b) => +(20 * Math.log10(a / b)).toFixed(2);
const out = {
  transparent: md,
  lookahead: {
    dryBurst: +peak(click, 0.1, 0.015).toFixed(4),
    fullBurst: +peak(rA, 0.1, 0.015).toFixed(4),
    fullDb: db(peak(rA, 0.1, 0.015), peak(click, 0.1, 0.015)),
    highBurst: +peak(rH, 0.1, 0.015).toFixed(4),
    highDb: db(peak(rH, 0.1, 0.015), peak(click, 0.1, 0.015))
  },
  low: {
    dry60: +goertzel(click, 60, 0.3, 0.5).toFixed(4),
    full60: +goertzel(rA, 60, 0.3, 0.5).toFixed(4),
    high60: +goertzel(rH, 60, 0.3, 0.5).toFixed(4),
    high60Db: db(goertzel(rH, 60, 0.3, 0.5), goertzel(click, 60, 0.3, 0.5))
  },
  crossover: {
    dry1k: +goertzel(tone, 1000, 0.3, 0.5).toFixed(4),
    high1k: +goertzel(rN, 1000, 0.3, 0.5).toFixed(4)
  },
  nan: [rA, rH, rN].some(a => Array.from(a).some(v => !Number.isFinite(v))),
  freqTest: {
    peak1k: +peak(r1k, 0.1, 0.015).toFixed(4),
    peak4k: +peak(r4k, 0.1, 0.015).toFixed(4)
  }
};
console.log(JSON.stringify(out, null, 2));
if (!(out.transparent === 0 && out.lookahead.fullDb > 4 && Math.abs(out.low.high60Db) < 0.2 && Math.abs(out.crossover.high1k - out.crossover.dry1k) < 0.02 && out.freqTest.peak1k > out.freqTest.peak4k * 1.15 && !out.nan)) {
  console.error('FAIL: transient shaper'); process.exit(1);
}
