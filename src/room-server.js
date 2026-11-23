'use strict';
/* 一起听房间服务：独立 WebSocket 端口（默认 8900），只转发房间状态/控制/聊天。
   不代理媒体、不接触 B 站/网易云 Cookie；客人各自本地拉流。
   房主令牌只通过本机 /api/room/start 返回，不上公网。 */
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const MAX_CLIENTS = 8;
const CHAT_MAX = 50;

function isTailscale(ip) {
  const p = String(ip).split('.').map(Number);
  return p.length === 4 && p[0] === 100 && p[1] >= 64 && p[1] <= 127;
}

class RoomServer {
  constructor() {
    this.wss = null;
    this.port = 0;
    this.room = null;
    this.hb = null;
    this._starting = null;
  }
  ips() {
    const out = [];
    const ifs = os.networkInterfaces();
    for (const [name, list] of Object.entries(ifs)) {
      for (const a of list || []) {
        if (!a || a.family !== 'IPv4' || a.internal) continue;
        out.push({ name, address: a.address, tailscale: isTailscale(a.address) });
      }
    }
    out.sort((a, b) => (b.tailscale ? 1 : 0) - (a.tailscale ? 1 : 0));
    return out;
  }
  members() {
    if (!this.room) return [];
    return [...this.room.clients.values()].map(c => ({ id: c.id, name: c.name, role: c.role }));
  }
  status() {
    return {
      active: !!(this.wss && this.room),
      code: this.room ? this.room.code : '',
      port: this.port,
      ips: this.ips(),
      members: this.members()
    };
  }
  start() {
    if (this.wss && this.room) {
      return Promise.resolve(Object.assign(this.status(), { hostToken: this.room.hostToken }));
    }
    if (this._starting) return this._starting;
    this._starting = new Promise((resolve, reject) => {
      const code = crypto.randomBytes(3).toString('hex').toUpperCase();
      const hostToken = crypto.randomBytes(16).toString('hex');
      const room = { code, hostToken, host: null, clients: new Map(), state: null, chat: [], hostGraceTimer: null, requests: new Map() };
      let port = parseInt(process.env.BP_ROOM_PORT, 10) || 8900;
      const tryPort = () => {
        const wss = new WebSocketServer({ host: '0.0.0.0', port });
        wss.once('listening', () => {
          this.wss = wss;
          this.port = port;
          this.room = room;
          this.bind(wss);
          this.hb = setInterval(() => this.heartbeat(), 15000);
          this._starting = null;
          resolve(Object.assign(this.status(), { hostToken }));
        });
        wss.once('error', (e) => {
          try { wss.close(); } catch (err) {}
          if (e && e.code === 'EADDRINUSE' && port < 8915) { port++; tryPort(); }
          else { this._starting = null; reject(e); }
        });
      };
      tryPort();
    });
    return this._starting;
  }
  send(ws, obj) {
    if (!ws || ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(obj)); } catch (e) {}
  }
  broadcast(obj) {
    if (!this.room) return;
    for (const c of this.room.clients.values()) this.send(c.ws, obj);
  }
  bind(wss) {
    wss.on('connection', ws => {
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', raw => {
        let msg = null;
        try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
        this.handle(ws, msg);
      });
      ws.on('close', () => this.drop(ws));
      ws.on('error', () => {});
      this.send(ws, { type: 'hello', code: this.room.code, serverTime: Date.now(), max: MAX_CLIENTS });
    });
  }
  handle(ws, msg) {
    if (!this.room || !msg || typeof msg.type !== 'string') return;
    if (msg.type === 'join') {
      if (ws._client) return;
      const code = String(msg.code || '').trim().toUpperCase();
      if (code !== this.room.code) return this.send(ws, { type: 'error', message: '房间码不正确' });
      const role = msg.role === 'host' ? 'host' : 'guest';
      if (role === 'host' && msg.token !== this.room.hostToken) return this.send(ws, { type: 'error', message: '房主令牌无效' });
      if (this.room.clients.size >= MAX_CLIENTS) return this.send(ws, { type: 'error', message: '房间已满（最多 8 人）' });
      if (role === 'host' && this.room.host) {
        const old = this.room.host;
        this.room.host = null;
        try { old.ws.close(); } catch (e) {}
      }
      if (role === 'host' && this.room.hostGraceTimer) {
        clearTimeout(this.room.hostGraceTimer);
        this.room.hostGraceTimer = null;
      }
      const id = crypto.randomBytes(6).toString('hex');
      const name = String(msg.name || '').trim().slice(0, 20) || (role === 'host' ? '房主' : '听众');
      const client = { id, name, role, ws };
      ws._client = client;
      this.room.clients.set(id, client);
      if (role === 'host') this.room.host = client;
      this.send(ws, {
        type: 'welcome', clientId: id, role, code: this.room.code, name,
        members: this.members(), chat: this.room.chat, state: this.room.state, requests: [...this.room.requests.values()], serverTime: Date.now()
      });
      this.broadcast({ type: 'members', members: this.members(), serverTime: Date.now() });
      if (role === 'host') this.broadcast({ type: 'host-online', serverTime: Date.now() });
      return;
    }
    const c = ws._client;
    if (!c) return;
    if (msg.type === 'ping') {
      return this.send(ws, { type: 'pong', t0: msg.t0, serverTime: Date.now() });
    }
    if (msg.type === 'state') {
      if (c.role !== 'host' || !msg.state || typeof msg.state !== 'object') return;
      this.room.state = msg.state;
      this.broadcast({ type: 'state', state: msg.state, serverTime: Date.now() });
      return;
    }
    if (msg.type === 'ready') {
      if (c.role !== 'guest') return;
      this.broadcast({ type: 'ready', clientId: c.id, name: c.name, track: String(msg.track || '').slice(0, 80), serverTime: Date.now() });
      return;
    }
    if (msg.type === 'loadError') {
      if (c.role !== 'guest') return;
      this.broadcast({ type: 'guest-error', clientId: c.id, name: c.name, message: String(msg.message || '').slice(0, 200), serverTime: Date.now() });
      return;
    }
    if (msg.type === 'request') {
      if (c.role !== 'guest' || !msg.item || typeof msg.item !== 'object') return;
      if (this.room.requests.size >= 10) return this.send(ws, { type: 'error', message: '点歌申请已满，等房主处理一下' });
      const item = {};
      for (const k of ['bvid', 'cid', 'aid', 'upMid', 'nid', 'title', 'up', 'artist', 'duration', 'pic', 'play', 'type', 'album', 'pubdate']) {
        if (msg.item[k] === undefined || msg.item[k] === null) continue;
        item[k] = ['cid', 'aid', 'upMid', 'nid', 'duration', 'play', 'pubdate'].includes(k)
          ? Number(msg.item[k]) : String(msg.item[k]).slice(0, 300);
      }
      if (!item.title || (!item.bvid && !item.nid)) return;
      const key = item.bvid ? 'b' + item.bvid : 'n' + item.nid;
      for (const r of this.room.requests.values()) if (r.key === key) return this.send(ws, { type: 'error', message: '已有一首相同的点歌申请' });
      const id = crypto.randomBytes(4).toString('hex');
      const req = { id, key, name: c.name, fromId: c.id, item, at: Date.now() };
      this.room.requests.set(id, req);
      this.broadcast({ type: 'request', request: req, serverTime: Date.now() });
      return;
    }
    if (msg.type === 'request-result') {
      if (c.role !== 'host' || !msg.id) return;
      const req = this.room.requests.get(msg.id);
      if (!req) return;
      this.room.requests.delete(msg.id);
      this.broadcast({ type: 'request-result', id: msg.id, accept: !!msg.accept, by: c.name, fromId: req.fromId, name: req.name, item: req.item, serverTime: Date.now() });
      return;
    }
    if (msg.type === 'chat') {
      const text = String(msg.text || '').trim().slice(0, 300);
      if (!text) return;
      const item = { id: c.id, name: c.name, role: c.role, text, at: Date.now() };
      this.room.chat.push(item);
      if (this.room.chat.length > CHAT_MAX) this.room.chat.shift();
      this.broadcast({ type: 'chat', chat: item, serverTime: Date.now() });
      return;
    }
    if (msg.type === 'bye') {
      try { ws.close(); } catch (e) {}
    }
  }
  drop(ws) {
    if (!this.room) return;
    const c = ws._client;
    if (!c) return;
    ws._client = null;
    this.room.clients.delete(c.id);
    if (c.role === 'guest') {
      for (const [id, r] of this.room.requests) if (r.fromId === c.id) this.room.requests.delete(id);
    }
    const wasHost = c.role === 'host' && this.room.host && this.room.host.id === c.id;
    if (wasHost) {
      this.room.host = null;
      this.broadcast({ type: 'host-offline', graceMs: 20000, serverTime: Date.now() });
      if (this.room.hostGraceTimer) clearTimeout(this.room.hostGraceTimer);
      this.room.hostGraceTimer = setTimeout(() => {
        if (!this.room || this.room.host) return;
        this.room.hostGraceTimer = null;
        this.room.state = null;
        this.broadcast({ type: 'host-left', serverTime: Date.now() });
      }, 20000);
    }
    this.broadcast({ type: 'members', members: this.members(), serverTime: Date.now() });
  }
  heartbeat() {
    if (!this.room) return;
    for (const c of this.room.clients.values()) {
      if (c.ws.isAlive === false) { try { c.ws.terminate(); } catch (e) {} continue; }
      c.ws.isAlive = false;
      try { c.ws.ping(); } catch (e) {}
    }
  }
  stop() {
    if (this.hb) { clearInterval(this.hb); this.hb = null; }
    if (this.room) {
      if (this.room.hostGraceTimer) { clearTimeout(this.room.hostGraceTimer); this.room.hostGraceTimer = null; }
      this.room.requests.clear();
      try { this.broadcast({ type: 'host-left', serverTime: Date.now() }); } catch (e) {}
      for (const c of this.room.clients.values()) { try { c.ws.close(); } catch (e) {} }
    }
    if (this.wss) { try { this.wss.close(); } catch (e) {} }
    this.wss = null;
    this.room = null;
    this.port = 0;
    this._starting = null;
  }
}

module.exports = { RoomServer };
