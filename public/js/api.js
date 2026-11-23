/* 前端 API 封装 */
const Api = {
  async _fetch(path, opts) {
    let r;
    try { r = await fetch('/api/' + path, opts); }
    catch { throw new Error('无法连接本地服务，请重新启动播放器'); }
    let j = null;
    try { j = await r.json(); } catch {}
    if (!j) throw new Error('服务异常 (' + r.status + ')');
    if (!j.ok) {
      const e = new Error(j.message || '请求失败');
      e.code = j.code || 0;
      if (j.risk) { e.risk = true; e.retryAt = j.retryAt || 0; }
      throw e;
    }
    return j.data;
  },
  get(path, params) {
    let qs = '';
    if (params) {
      const sp = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') sp.append(k, v); });
      qs = sp.toString() ? '?' + sp.toString() : '';
    }
    return this._fetch(path + qs);
  },
  post(path, body) {
    return this._fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  },
  put(path, body) {
    return this._fetch(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  },
  del(path) {
    return this._fetch(path, { method: 'DELETE' });
  }
};
