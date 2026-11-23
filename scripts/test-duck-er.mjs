/* 混响避让 + FDN 早期反射强度离线自测：node scripts/test-duck-er.mjs */
import fs from 'node:fs';
import vm from 'node:vm';

function load(file, clsName) {
  const code = fs.readFileSync(new URL('../public/js/vendor/' + file, import.meta.url), 'utf8');
  let Processor = null;
  const sandbox = {
    sampleRate: 48000,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {} }; } },
    registerProcessor: (name, cls) => { if (name === clsName) Processor = cls; },
    Math, Float32Array, Int32Array, Array, Number, console
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  if (!Processor) throw new Error('processor not registered: ' + clsName);
  return Processor;
}

const sr = 48000;
const Duck = load('ducking-worklet.js', 'reverb-duck');
let duckOut = null;
{
  const p = new Duck();
  const n = 128, len = sr * 2;
  const wet = new Float32Array(len), sc = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    wet[i] = 0.1 * Math.sin(2 * Math.PI * 220 * i / sr);
    const t = i / sr;
    sc[i] = (t > 0.4 && t < 0.8) || (t > 1.2 && t < 1.6) ? 0.3 * Math.sin(2 * Math.PI * 110 * t) : 0;
  }
  const out = new Float32Array(len);
  const inW = new Float32Array(n), inS = new Float32Array(n);
  const outB = new Float32Array(n), outB2 = new Float32Array(n);
  const params = { depth: [1] };
  for (let off = 0; off < len; off += n) {
    for (let i = 0; i < n; i++) { inW[i] = wet[off + i]; inS[i] = sc[off + i]; }
    p.process([[inW, inW], [inS, inS]], [[outB, outB2]], params);
    for (let i = 0; i < n; i++) out[off + i] = outB[i];
  }
  const rms = (a, t0, dur) => {
    let s = 0; const i0 = Math.floor(t0 * sr), i1 = Math.floor((t0 + dur) * sr);
    for (let i = i0; i < i1; i++) s += a[i] * a[i];
    return Math.sqrt(s / (i1 - i0));
  };
  const db = (a, b) => +(20 * Math.log10(a / b)).toFixed(2);
  // 透明性
  const p0 = new Duck();
  const out0 = new Float32Array(len);
  for (let off = 0; off < len; off += n) {
    for (let i = 0; i < n; i++) { inW[i] = wet[off + i]; inS[i] = sc[off + i]; }
    p0.process([[inW, inW], [inS, inS]], [[outB, outB2]], { depth: [0] });
    for (let i = 0; i < n; i++) out0[off + i] = outB[i];
  }
  let md = 0; for (let i = 0; i < len; i++) md = Math.max(md, Math.abs(out0[i] - wet[i]));
  duckOut = {
    transparent: md,
    quietRms: +rms(out, 0.9, 0.25).toFixed(5),
    loudRms: +rms(out, 0.5, 0.2).toFixed(5),
    wetRms: +rms(wet, 0.9, 0.25).toFixed(5),
    duckDb: db(rms(out, 0.5, 0.2), rms(wet, 0.5, 0.2)),
    recoveredDb: db(rms(out, 0.9, 0.25), rms(wet, 0.9, 0.25))
  };
  console.log('duck', JSON.stringify(duckOut));
}

const Fdn = load('fdn-reverb-worklet.js', 'fdn-reverb');
{
  const n = 128, len = sr;
  const render = erMix => {
    const p = new Fdn();
    const dry = new Float32Array(len); dry[0] = 0.5;
    const out = new Float32Array(len);
    const inL = new Float32Array(n), inR = new Float32Array(n);
    const oL = new Float32Array(n), oR = new Float32Array(n);
    const params = {
      size: [1.2], decay: [2], damping: [0.3], modDepth: [0.0002], erMix: [erMix]
    };
    for (let off = 0; off < len; off += n) {
      for (let i = 0; i < n; i++) { inL[i] = dry[off + i] || 0; inR[i] = inL[i]; }
      p.process([[inL, inR]], [[oL, oR]], params);
      for (let i = 0; i < n; i++) out[off + i] = oL[i];
    }
    let er = 0, early = 0;
    for (let i = Math.floor(0.004 * sr); i < Math.floor(0.07 * sr); i++) er = Math.max(er, Math.abs(out[i]));
    for (let i = Math.floor(0.15 * sr); i < Math.floor(0.4 * sr); i++) early = Math.max(early, Math.abs(out[i]));
    return { er: +er.toFixed(4), early: +early.toFixed(4) };
  };
  const erOut = { off: render(0), def: render(0.3), full: render(1) };
  console.log('er', JSON.stringify(erOut));
  if (!(duckOut.transparent === 0 && duckOut.duckDb <= -10 && erOut.off.er === 0 && erOut.def.er > 0 && erOut.full.er > erOut.def.er)) {
    console.error('FAIL: ducking/ER'); process.exit(1);
  }
}
