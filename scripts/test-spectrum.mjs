/* 频谱快照回归：node scripts/test-spectrum.mjs
   用确定性多音信号跑关键 worklet，和 scripts/audio-baseline.json 比较频段能量。
   首次运行会生成基线；之后偏差超过 1.5dB 返回非 0。 */
import fs from 'node:fs';
import vm from 'node:vm';

const SR = 48000, LEN = SR * 2;
const BASELINE = new URL('./audio-baseline.json', import.meta.url);

function load(file, clsName) {
  const code = fs.readFileSync(new URL('../public/js/vendor/' + file, import.meta.url), 'utf8');
  let Processor = null;
  const sandbox = {
    sampleRate: SR,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } },
    registerProcessor: (name, cls) => { if (name === clsName) Processor = cls; },
    Math, Float32Array, Int32Array, Array, Number, console
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  if (!Processor) throw new Error('processor not registered: ' + clsName);
  return Processor;
}

const FREQS = [100, 500, 1000, 2000, 4000, 8000];
const SIG = new Float32Array(LEN);
for (let i = 0; i < LEN; i++) {
  const t = i / SR;
  let v = 0;
  FREQS.forEach((f, k) => { v += 0.06 * Math.sin(2 * Math.PI * f * t + k * 0.7); });
  SIG[i] = v;
}
function goertzel(a, f, t0, dur) {
  const w = 2 * Math.PI * f / SR, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  const i0 = Math.floor(t0 * SR), i1 = Math.floor((t0 + dur) * SR);
  for (let i = i0; i < i1; i++) { const s0 = a[i] + c * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / ((i1 - i0) / 2);
}
function spectrum(a) {
  const out = {};
  for (const f of FREQS) out[f] = +(20 * Math.log10(Math.max(1e-9, goertzel(a, f, 0.5, 1)))).toFixed(2);
  return out;
}
function render(Processor, params, input = SIG) {
  const p = new Processor();
  const out = new Float32Array(LEN);
  const n = 128;
  const inL = new Float32Array(n), inR = new Float32Array(n);
  const oL = new Float32Array(n), oR = new Float32Array(n);
  for (let off = 0; off < LEN; off += n) {
    const m = Math.min(n, LEN - off);
    for (let i = 0; i < m; i++) { inL[i] = input[off + i]; inR[i] = input[off + i]; }
    for (let i = m; i < n; i++) { inL[i] = 0; inR[i] = 0; }
    p.process([[inL, inR]], [[oL, oR]], params);
    for (let i = 0; i < m; i++) out[off + i] = oL[i];
  }
  return out;
}

const Dyn = load('dynamic-eq-worklet.js', 'dynamic-eq');
const Tr = load('transient-shaper-worklet.js', 'transient-shaper');
const De = load('deesser-worklet.js', 'de-esser');
const Fdn = load('fdn-reverb-worklet.js', 'fdn-reverb');

const result = {
  dynEq: spectrum(render(Dyn, { amount: [1], low: [1], mid: [1], high: [1] })),
  transient: spectrum(render(Tr, { attack: [1], sustain: [0], highOnly: [0], freq: [2000] })),
  transientHigh: spectrum(render(Tr, { attack: [1], sustain: [0], highOnly: [1], freq: [2000] })),
  deEsser: spectrum(render(De, { amount: [1], freq: [5000] }))
};
/* FDN：脉冲的 ER/早/中/晚能量 */
{
  const p = new Fdn();
  const out = new Float32Array(SR * 2);
  const n = 128;
  const inL = new Float32Array(n), inR = new Float32Array(n);
  const oL = new Float32Array(n), oR = new Float32Array(n);
  for (let off = 0; off < SR * 2; off += n) {
    for (let i = 0; i < n; i++) { inL[i] = (off + i === 0) ? 0.5 : 0; inR[i] = inL[i]; }
    p.process([[inL, inR]], [[oL, oR]], { size: [1.2], decay: [2], damping: [0.3], modDepth: [0.0002], erMix: [0.3] });
    for (let i = 0; i < n; i++) out[off + i] = oL[i];
  }
  const peak = (t0, t1) => { let v = 0; for (let i = Math.floor(t0 * SR); i < Math.floor(t1 * SR); i++) v = Math.max(v, Math.abs(out[i])); return +v.toFixed(5); };
  result.fdn = { er: peak(0.004, 0.07), early: peak(0.15, 0.4), mid: peak(0.4, 0.9), late: peak(1.2, 1.9) };
}

if (!fs.existsSync(BASELINE)) {
  fs.writeFileSync(BASELINE, JSON.stringify(result, null, 2));
  console.log('spectrum baseline created:', BASELINE.pathname);
  process.exit(0);
}
const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const fails = [];
for (const key of ['dynEq', 'transient', 'transientHigh', 'deEsser']) {
  for (const f of FREQS) {
    const a = result[key][f], b = base[key] && base[key][f];
    if (typeof b !== 'number') { fails.push(`${key} ${f}Hz missing baseline`); continue; }
    if (Math.abs(a - b) > 1.5) fails.push(`${key} ${f}Hz ${b}→${a}dB`);
  }
}
for (const k of ['er', 'early', 'mid', 'late']) {
  const a = result.fdn[k], b = base.fdn && base.fdn[k];
  if (typeof b !== 'number' || Math.abs(a - b) > Math.max(0.002, Math.abs(b) * 0.2)) fails.push(`fdn ${k} ${b}→${a}`);
}
if (fails.length) {
  console.error('FAIL: spectrum snapshot');
  for (const f of fails) console.error('  ' + f);
  process.exit(1);
}
console.log('spectrum snapshot ok');
