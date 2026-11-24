/* 紧凑 MD5（WBI 签名用）— RFC 1321 程序化实现（移位表/T表按公式生成，无手抄错误） */
'use strict';
function md5(s) {
  s = unescape(encodeURIComponent(s)); // UTF-8
  const len = s.length;
  const words = [];
  for (let i = 0; i < len; i++) words[i >> 2] = (words[i >> 2] || 0) | (s.charCodeAt(i) << ((i % 4) * 8));
  words[len >> 2] = (words[len >> 2] || 0) | (0x80 << ((len % 4) * 8));
  const blocks = Math.ceil((len + 9) / 64);
  for (let i = Math.floor((len + 8) / 4); i < blocks * 16; i++) words[i] = words[i] || 0;
  words[blocks * 16 - 2] = len * 8;
  words.length = blocks * 16;

  const add = (x, y) => {
    const l = (x & 0xFFFF) + (y & 0xFFFF);
    return ((((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xFFFF)) | 0;
  };
  const rot = (x, c) => (x << c) | (x >>> (32 - c));
  const F = (x, y, z) => (x & y) | (~x & z);
  const G = (x, y, z) => (x & z) | (y & ~z);
  const H = (x, y, z) => x ^ y ^ z;
  const I = (x, y, z) => y ^ (x | ~z);
  const T = i => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const kk = i => (i < 16 ? i : i < 32 ? (5 * i + 1) % 16 : i < 48 ? (3 * i + 5) % 16 : (7 * i) % 16);
  const sf = i => S[(i % 4) + Math.floor(i / 16) * 4];

  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  const blocksN = blocks;
  for (let blk = 0; blk < blocksN; blk++) {
    const M = words.slice(blk * 16, blk * 16 + 16);
    const aa = a, bb = b, cc = c, dd = d;
    for (let i = 0; i < 64; i++) {
      const f = i < 16 ? F(b, c, d) : i < 32 ? G(b, c, d) : i < 48 ? H(b, c, d) : I(b, c, d);
      const k = kk(i);
      const tmp = add(add(a, f), add(M[k], T(i)));
      a = d;
      d = c;
      c = b;
      b = add(b, rot(tmp, sf(i)));
    }
    a = add(a, aa); b = add(b, bb); c = add(c, cc); d = add(d, dd);
  }
  const out = [a, b, c, d];
  let hex = '';
  for (const w of out) for (let j = 0; j < 4; j++) hex += ((w >> (j * 8)) & 0xFF).toString(16).padStart(2, '0');
  return hex;
}
