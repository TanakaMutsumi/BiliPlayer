import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('public/vendor/jizura');
const src = path.join(root, 'src');
const files = fs.readdirSync(src).filter(f => f.endsWith('.js'));
const base = ['01_util.js','02_fonts.js','02b_lang.js','03_text.js','04_styles.js','05_anim.js','05b_registry.js','06_layouts.js','07_decor.js','08_planner.js','08b_omakase.js','09_render.js','10_audio.js','11_export.js'];
const order = [
  ...base.filter(f => files.includes(f)),
  ...files.filter(f => f.startsWith('11p_')).sort(),
  '11q_sets.js'
];
const missing = files.filter(f => !order.includes(f) && f !== '12_ui.js');
if (missing.length) console.warn('unbundled:', missing.join(', '));
const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8').slice(0, 400);
const header = `/*! JIZURA engine v${fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim()} — MIT — https://github.com/852wa/JIZURA\n${license.replace(/\*\//g, '* /')}*/\n`;
const body = order.map(f => `\n/* ---- ${f} ---- */\n` + fs.readFileSync(path.join(src, f), 'utf8')).join('\n');
fs.writeFileSync(path.join(root, 'jizura-engine.js'), header + body);
console.log('wrote jizura-engine.js', (fs.statSync(path.join(root, 'jizura-engine.js')).size / 1024).toFixed(0) + 'KB', order.length + ' files');
