'use strict';
/* Electron 主进程：内嵌本地服务，创建应用窗口 */
const { app, BrowserWindow, Menu, shell, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

if (!process.env.BP_ALLOW_MULTI && !app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let serverPort = 0;
let neLoginWin = null;
const widgetWins = new Map(); // 桌面组件窗口（widget / desk-lyrics）

function createWindow(port) {
  serverPort = port;
  win = new BrowserWindow({
    width: 1300,
    height: 850,
    minWidth: 1024,
    minHeight: 640,
    title: '哔哩播放器',
    backgroundColor: '#f6f7f8',
    autoHideMenuBar: true,
    show: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  Menu.setApplicationMenu(null);
  win.loadURL('http://127.0.0.1:' + port);
  win.once('ready-to-show', () => win.show());
  // “在B站打开”等外链交给系统默认浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.hostname === '127.0.0.1' && u.port === String(port) && (u.pathname === '/widget.html' || u.pathname === '/desk-lyrics.html')) {
        const key = u.pathname;
        const exist = widgetWins.get(key);
        if (exist && !exist.isDestroyed()) { exist.focus(); return { action: 'deny' }; }
        const isTall = u.searchParams.get('tall') === '1';
        const opts = Object.assign({
          frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
          resizable: true, hasShadow: true, show: true, useContentSize: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(__dirname, 'widget-preload.js') }
        }, key === '/widget.html' ? (isTall ? { width: 280, height: 392 } : { width: 420, height: 132 }) : { width: 900, height: 150 });
        const w2 = new BrowserWindow(opts);
        w2.setAlwaysOnTop(true, 'screen-saver');
        w2.loadURL(url);
        w2.on('closed', () => { if (deskWinRef === w2) { deskWinRef = null; deskRects = []; } widgetWins.delete(key); });
        widgetWins.set(key, w2);
        return { action: 'deny' };
      }
    } catch (e) {}
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => {
    widgetWins.forEach(w2 => { try { w2.close(); } catch (e) {} });
    widgetWins.clear();
    win = null;
  });
}

ipcMain.on('widget-resize', (event, w, h) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.setSize(w, h);
});
/* 桌面歌词鼠标策略：轮询屏幕光标，落在歌词热区内→窗口可交互，否则穿透。
   （页面 mouseenter 在 forward 穿透模式下收不到，必须在主进程判定） */
let deskWinRef = null, deskRects = [];
function applyDeskMouse() {
  const win = deskWinRef && !deskWinRef.isDestroyed() ? deskWinRef : null;
  if (!win) return;
  try {
    const p = screen.getCursorScreenPoint();
    const [wx, wy] = win.getPosition();
    const [ww, wh] = win.getSize();
    const inside = p.x >= wx && p.x <= wx + ww && p.y >= wy && p.y <= wy + wh;
    let overHot = false;
    if (inside) {
      for (const r of deskRects) {
        if (p.x >= wx + r.x && p.x <= wx + r.x + r.w && p.y >= wy + r.y && p.y <= wy + r.y + r.h) { overHot = true; break; }
      }
    }
    win.setIgnoreMouseEvents(!overHot, { forward: overHot });
  } catch (e) {}
}
setInterval(applyDeskMouse, 80);
ipcMain.on('desk-clickthrough', (event, on, rects) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  if (Array.isArray(rects)) deskRects = rects;
  if (typeof on === 'boolean' && on === false) { deskWinRef = null; deskRects = []; try { win.setIgnoreMouseEvents(false); } catch (e) {} return; }
  deskWinRef = win;
});
ipcMain.on('widget-set-tall', (event, tall) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.setContentSize(tall ? 280 : 420, tall ? 392 : 132);
});
/* 内容自适应：直接测量页面里 #widget 的真实渲染尺寸，窗口调成一致 */
ipcMain.on('widget-fit', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(
    '(function(){var e=document.getElementById("widget");if(!e)return{w:420,h:132};var r=e.getBoundingClientRect();return{w:Math.ceil(r.width),h:Math.ceil(r.height)}})()'
  ).then(size => {
    if (win.isDestroyed()) return;
    if (size && size.w > 0 && size.h > 0) win.setContentSize(size.w, size.h);
  }).catch(() => {});
});

/* 网易云一键网页登录：弹出官方登录页，登录成功后自动抓取Cookie交给本地服务 */
ipcMain.handle('open-ne-web-login', () => {
  if (neLoginWin && !neLoginWin.isDestroyed()) { neLoginWin.focus(); return true; }
  neLoginWin = new BrowserWindow({
    width: 480,
    height: 640,
    title: '网易云音乐登录',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  neLoginWin.loadURL('https://music.163.com/#/login');
  let done = false;
  const timer = setInterval(async () => {
    if (!neLoginWin || neLoginWin.isDestroyed()) { clearInterval(timer); return; }
    if (done) return;
    try {
      const cookies = await neLoginWin.webContents.session.cookies.get({ name: 'MUSIC_U' });
      if (!cookies || !cookies.length || !cookies[0].value) return;
      done = true;
      const val = cookies[0].value;
      const r = await new Promise(resolve => {
        require('http').get('http://127.0.0.1:' + serverPort + '/api/ncookie/set?value=' + encodeURIComponent(val), res => {
          let d = '';
          res.on('data', c => { d += c; });
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
        }).on('error', () => resolve(null));
      });
      const user = r && r.ok && r.data && r.data.user ? r.data.user : null;
      if (win && !win.isDestroyed()) win.webContents.send('ne-login-done', { ok: !!user, user });
      try { neLoginWin.close(); } catch (e) {}
    } catch (e) { /* 登录窗口关闭竞态等，忽略 */ }
  }, 1000);
  neLoginWin.on('closed', () => { clearInterval(timer); neLoginWin = null; });
  return true;
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

/* 一次性迁移旧便携数据（exe旁data\）到 %APPDATA%\BiliPlayer：只补缺，不覆盖 */
function migratePortableData(oldDir, newDir) {
  try {
    if (!oldDir || !fs.existsSync(oldDir)) return;
    fs.mkdirSync(newDir, { recursive: true });
    for (const f of fs.readdirSync(oldDir)) {
      const src = path.join(oldDir, f);
      const dst = path.join(newDir, f);
      let st;
      try { st = fs.statSync(src); } catch (e) { continue; }
      if (!st.isFile()) continue;
      if (!fs.existsSync(dst)) { try { fs.copyFileSync(src, dst); } catch (e) {} continue; }
      // 目标已存在：仅当目标是空歌单而来源非空时用来源补上
      if (f === 'playlists.json') {
        try {
          const a = JSON.parse(fs.readFileSync(dst, 'utf8'));
          const b = JSON.parse(fs.readFileSync(src, 'utf8'));
          if (Array.isArray(a) && !a.length && Array.isArray(b) && b.length) fs.copyFileSync(src, dst);
        } catch (e) {}
      }
    }
  } catch (e) {}
}

app.whenReady().then(() => {
  // 数据（登录凭证/歌单）固定存 %APPDATA%\BiliPlayer —— 与程序目录彻底分离，
  // 重新打包、删除、更新 dist 都不会动到用户数据
  const dataDir = process.env.BP_DATA_DIR || path.join(app.getPath('appData'), 'BiliPlayer');
  migratePortableData(
    app.isPackaged ? path.join(path.dirname(app.getPath('exe')), 'data') : path.join(__dirname, '..', 'data'),
    dataDir
  );
  process.env.BP_DATA_DIR = dataDir;
  const { startServer } = require('../server');
  startServer(port => createWindow(port));
});

app.on('before-quit', () => { try { const s = require('../server'); s.cloudflared.stop(); s.roomServer.stop(); } catch (e) {} });
app.on('window-all-closed', () => app.quit());
