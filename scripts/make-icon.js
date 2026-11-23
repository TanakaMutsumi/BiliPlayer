'use strict';
/* 生成应用图标 assets/icon.ico（B站小电视风格：粉色圆角机身+天线+白色播放键）
   纯 Node 实现，无依赖：超采样绘制 + 区域重采样 + BMP 格式 ICO */
const fs = require('fs');
const path = require('path');

const PINK = [251, 114, 153];
const WHITE = [255, 255, 255];

/* 圆角矩形 SDF，<=0 在内部 */
function rrSDF(px, py, x0, y0, x1, y1, r) {
  const bx = (x0 + x1) / 2, by = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r, hy = (y1 - y0) / 2 - r;
  const dx = Math.abs(px - bx) - hx, dy = Math.abs(py - by) - hy;
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - r;
}

/* 点到线段距离（天线，圆头） */
function segDist(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  const dx = px - (ax + abx * t), dy = py - (ay + aby * t);
  return Math.hypot(dx, dy);
}

/* 三角形包含测试（播放键） */
function inTri(px, py, a, b, c) {
  const sign = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = sign([px, py], a, b), d2 = sign([px, py], b, c), d3 = sign([px, py], c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function drawCanvas() {
  const W = 1024;
  const img = Buffer.alloc(W * W * 4);
  const tri = [[462, 480], [462, 762], [710, 621]];
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const body = rrSDF(x, y, 96, 330, 928, 918, 170) <= 0;
      const ant = segDist(x, y, 336, 118, 512, 342) < 27 || segDist(x, y, 688, 118, 512, 342) < 27;
      let col = null;
      if (body && inTri(x, y, tri[0], tri[1], tri[2])) col = WHITE;
      else if (body || ant) col = PINK;
      if (col) {
        const i = (y * W + x) * 4;
        img[i] = col[0]; img[i + 1] = col[1]; img[i + 2] = col[2]; img[i + 3] = 255;
      }
    }
  }
  return { data: img, w: W };
}

function resize(src, srcW, dstW) {
  const out = Buffer.alloc(dstW * dstW * 4);
  for (let y = 0; y < dstW; y++) {
    const y0 = Math.floor(y * srcW / dstW), y1 = Math.max(y0 + 1, Math.floor((y + 1) * srcW / dstW));
    for (let x = 0; x < dstW; x++) {
      const x0 = Math.floor(x * srcW / dstW), x1 = Math.max(x0 + 1, Math.floor((x + 1) * srcW / dstW));
      let r = 0, g = 0, b = 0, a = 0, c = 0;
      for (let yy = y0; yy < y1 && yy < srcW; yy++) {
        for (let xx = x0; xx < x1 && xx < srcW; xx++) {
          const i = (yy * srcW + xx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; c++;
        }
      }
      const o = (y * dstW + x) * 4;
      out[o] = Math.round(r / c); out[o + 1] = Math.round(g / c);
      out[o + 2] = Math.round(b / c); out[o + 3] = Math.round(a / c);
    }
  }
  return out;
}

function bmpEntry(rgba, size) {
  const info = Buffer.alloc(40);
  info.writeUInt32LE(40, 0);
  info.writeInt32LE(size, 4);
  info.writeInt32LE(size * 2, 8);       // XOR + AND
  info.writeUInt16LE(1, 12);
  info.writeUInt16LE(32, 14);
  const maskRow = ((size + 31) >> 5) << 2;
  const dataSize = size * size * 4 + maskRow * size;
  info.writeUInt32LE(dataSize, 20);
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const srcRow = size - 1 - y;        // 自底向上
    for (let x = 0; x < size; x++) {
      const si = (srcRow * size + x) * 4, di = (y * size + x) * 4;
      xor[di] = rgba[si + 2];           // B
      xor[di + 1] = rgba[si + 1];       // G
      xor[di + 2] = rgba[si];           // R
      xor[di + 3] = rgba[si + 3];       // A
    }
  }
  return Buffer.concat([info, xor, Buffer.alloc(maskRow * size)]);
}

function buildIco(sizes) {
  const base = drawCanvas();
  const images = sizes.map(s => bmpEntry(resize(base.data, base.w, s), s));
  const count = sizes.length;
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + 16 * count;
  sizes.forEach((s, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(s >= 256 ? 0 : s, 0);
    e.writeUInt8(s >= 256 ? 0 : s, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(images[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += images[i].length;
    entries.push(e);
  });
  return Buffer.concat([head, ...entries, ...images]);
}

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.ico'), buildIco([16, 32, 48, 64, 128, 256]));
console.log('icon.ico written:', path.join(outDir, 'icon.ico'));
