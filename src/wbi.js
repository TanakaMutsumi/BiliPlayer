'use strict';
/* WBI 签名：B站部分接口（如搜索）需要 w_rid/wts 参数 */
const crypto = require('crypto');

const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52
];

function mixinKey(rawWbi) {
  return MIXIN_TAB.map(i => rawWbi[i]).join('').slice(0, 32);
}

function clean(s) {
  // 官方前端签名时会剔除 "!'()*" 这几个字符
  return String(s).replace(/[!'()*]/g, '');
}

function enc(s) {
  return encodeURIComponent(clean(s));
}

/* 返回拼好的 query string（含 wts 与 w_rid） */
function signQuery(params, key) {
  const p = Object.assign({}, params, { wts: Math.floor(Date.now() / 1000) });
  const keys = Object.keys(p).filter(k => k !== 'w_rid').sort();
  const qs = keys.map(k => enc(k) + '=' + enc(p[k])).join('&');
  const w_rid = crypto.createHash('md5').update(qs + key, 'utf8').digest('hex');
  return qs + '&w_rid=' + w_rid;
}

module.exports = { mixinKey, signQuery };
