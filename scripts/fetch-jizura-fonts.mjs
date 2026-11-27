import fs from 'node:fs';
import path from 'node:path';

/* Rebuild the local JIZURA display-font pack from Google Fonts.
   Run: node scripts/fetch-jizura-fonts.mjs
   The downloaded families are SIL OFL 1.1; keep public/fonts/jizura/licenses/. */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const families = [
  ['dela', 'Dela+Gothic+One'],
  ['zen', 'Zen+Old+Mincho:wght@900'],
  ['plex', 'IBM+Plex+Mono:wght@500'],
  ['notoserif', 'Noto+Serif+JP:wght@300;500;700']
];
const outDir = path.resolve('public/fonts/jizura');
fs.mkdirSync(outDir, { recursive: true });
let css = '/* JIZURA offline display fonts — Google Fonts, SIL OFL 1.1 */\n';
let count = 0;
for (const [tag, spec] of families) {
  const url = 'https://fonts.googleapis.com/css2?family=' + spec + '&display=swap';
  const text = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
  const blocks = text.match(/@font-face\s*\{[^}]+\}/g) || [];
  let i = 0;
  for (const block of blocks) {
    const m = block.match(/url\((https:\/\/[^)]+)\)/);
    if (!m) continue;
    const name = tag + '-' + (i++) + '.woff2';
    const bin = Buffer.from(await (await fetch(m[1], { headers: { 'User-Agent': UA } })).arrayBuffer());
    fs.writeFileSync(path.join(outDir, name), bin);
    css += block.replace(m[1], '../fonts/jizura/' + name) + '\n';
    count++;
  }
}
fs.writeFileSync(path.resolve('public/css/jizura-fonts.css'), css);
console.log('fonts', count, 'css', css.length);
