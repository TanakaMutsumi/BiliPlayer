'use strict';
/* cloudflared quick tunnel 管理：房主建房时把本机房间端口映射成公网 https URL。
   只暴露房间 WebSocket，不代理媒体；进程随房间/应用退出停止。 */
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

class CloudflaredTunnel {
  constructor() {
    this.child = null;
    this.url = '';
    this.port = 0;
    this.error = '';
    this.starting = null;
    this.logs = [];
  }
  binPath() {
    const names = process.platform === 'win32' ? ['cloudflared.exe'] : ['cloudflared'];
    const dirs = [];
    if (process.resourcesPath) dirs.push(path.join(process.resourcesPath, 'bin'));
    dirs.push(path.join(__dirname, '..', 'bin'));
    for (const d of dirs) {
      for (const n of names) {
        const p = path.join(d, n);
        try { if (fs.existsSync(p)) return p; } catch (e) {}
      }
    }
    return '';
  }
  status() {
    return { active: !!this.child, url: this.url, port: this.port, error: this.error };
  }
  start(port) {
    if (this.child && this.url) return Promise.resolve(this.status());
    if (this.starting) return this.starting;
    this.port = port;
    this.url = '';
    this.error = '';
    const bin = this.binPath();
    if (!bin) {
      this.error = '未找到 cloudflared 可执行文件';
      return Promise.reject(new Error(this.error));
    }
    this.starting = new Promise((resolve, reject) => {
      let settled = false;
      const child = spawn(bin, [
        'tunnel', '--url', 'http://127.0.0.1:' + port,
        '--no-autoupdate', '--protocol', 'http2', '--loglevel', 'info'
      ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      const onData = buf => {
        const s = buf.toString();
        this.logs.push(s);
        if (this.logs.length > 60) this.logs.shift();
        const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (m && !this.url) {
          this.url = m[0];
          if (!settled) { settled = true; resolve(this.status()); }
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('error', e => {
        this.error = (e && e.message) || 'cloudflared 启动失败';
        if (!settled) { settled = true; reject(new Error(this.error)); }
      });
      child.on('exit', code => {
        this.child = null;
        if (!settled) {
          this.error = 'cloudflared 退出 (' + code + ')';
          settled = true;
          reject(new Error(this.error));
        } else {
          this.url = '';
        }
      });
      setTimeout(() => {
        if (!settled) {
          this.error = '公网隧道建立超时';
          try { this.stop(); } catch (e) {}
          settled = true;
          reject(new Error(this.error));
        }
      }, 25000);
    }).finally(() => { this.starting = null; });
    return this.starting;
  }
  stop() {
    const child = this.child;
    this.child = null;
    this.url = '';
    this.error = '';
    if (!child) return;
    if (process.platform === 'win32') {
      try { execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {}); } catch (e) {}
    } else {
      try { child.kill('SIGTERM'); } catch (e) {}
    }
  }
}

module.exports = { CloudflaredTunnel };
