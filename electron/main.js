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
let qqLoginWin = null;
let qqKeepWin = null; // QQ音乐Cookie保活窗口（不可见，定期访问y.qq.com让服务端续期凭证）
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
          w2.on('closed', () => {
            if (deskWinRef === w2) { deskWinRef = null; deskRects = []; }
            widgetWins.delete(key);
            // 无论组件窗口以何种方式关闭，都同步主窗口的开关状态
            try { if (win && !win.isDestroyed()) win.webContents.send('widget-window-closed', key); } catch (e) {}
          });
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
/* 组件窗口自关通道：window.close() 失效时兜底 */
ipcMain.on('widget-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.close();
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

/* 退出QQ音乐：把Jar里的qq.com Cookie全部移除（配合服务端清Cookie文件） */
ipcMain.handle('qq-jar-clear', async () => {
  try {
    const { session } = require('electron');
    const all = await session.defaultSession.cookies.get({});
    let n = 0;
    for (const c of all) {
      if (!(c.domain || '').includes('qq.com')) continue;
      const url = (c.domain || '').startsWith('.') ? 'https://www' + c.domain : 'https://' + (c.domain || '').replace(/^\./, '');
      try { await session.defaultSession.cookies.remove(url, c.name); n++; } catch (e) { }
    }
    return n;
  } catch (e) { return -1; }
});

/* QQ音乐一键网页登录：弹出 y.qq.com 登录页（支持QQ/微信/扫码），登录成功后
   自动抓取 qq.com 域下的登录Cookie（uin + qm_keyst 等）交给本地服务 */
ipcMain.handle('open-qq-web-login', () => {
  if (qqLoginWin && !qqLoginWin.isDestroyed()) { qqLoginWin.focus(); return true; }
  qqLoginWin = new BrowserWindow({
    width: 520,
    height: 680,
    title: 'QQ音乐登录',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  qqLoginWin.loadURL('https://y.qq.com/n/ryqq/login');
  let done = false;
  let psrfWait = 0; // 等会员凭证 psrf_musickey_createtime 写入
  const timer = setInterval(async () => {
    if (!qqLoginWin || qqLoginWin.isDestroyed()) { clearInterval(timer); return; }
    if (done) return;
    try {
      // 只取 qq.com 域的Cookie（避免混入B站等其他会话）
      const all = await qqLoginWin.webContents.session.cookies.get({});
      const qqq = all.filter(c => (c.domain || '').includes('qq.com'));
      const kv = {};
      qqq.forEach(c => { if (c.value) kv[c.name] = c.value; });
      // 登录完成标志：有uin且有 qm_keyst（新版）或 qqmusic_key（旧版）
      if (!kv.uin || kv.uin === '0' || (!kv.qm_keyst && !kv.qqmusic_key)) return;
      /* psrf_musickey_createtime 通常在 qm_keyst 之后 1~3 秒才写入，
         以前一检测到 qm_keyst 就立刻保存，结果漏掉 psrf_* → 已登录却按游客/非会员处理 */
      if (!kv.psrf_musickey_createtime) {
        psrfWait += 1;
        if (psrfWait < 6) return;
      }
      done = true;
      /* 必须保存全部 qq.com Cookie：VIP会员验证依赖 psrf_musickey_createtime /
         psrf_qqunionid / psrf_access_token_expiresAt 等凭证，任何白名单裁剪
         都会让会员降级为普通用户（会员歌曲显示 needbuy 播不了） */
      const ck = qqq
        .filter(c => c.value)
        .map(c => c.name + '=' + c.value).join('; ');
      const r = await new Promise(resolve => {
        /* 定时同步走 merge（只增不删），避免把会员凭证冲掉 */
      require('http').get('http://127.0.0.1:' + serverPort + '/api/qqcookie/merge?value=' + encodeURIComponent(ck), res => {
          let d = '';
          res.on('data', c => { d += c; });
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
        }).on('error', () => resolve(null));
      });
      /* 关窗前等3秒再重抓一次：QQ登录收尾时会轮换qm_keyst，
         抓完立即关窗会漏掉轮换后的新key（表现为登录几分钟后失效） */
      setTimeout(async () => {
        let user = r && r.ok && r.data && r.data.user ? r.data.user : null;
        try {
          if (qqLoginWin && !qqLoginWin.isDestroyed()) {
            const all2 = await qqLoginWin.webContents.session.cookies.get({});
            const ck2 = all2.filter(c2 => (c2.domain || '').includes('qq.com') && c2.value).map(c2 => c2.name + '=' + c2.value).join('; ');
            if (ck2) {
              const r2 = await new Promise(resolve => {
                require('http').get('http://127.0.0.1:' + serverPort + '/api/qqcookie/merge?value=' + encodeURIComponent(ck2), res => {
                  let d = ''; res.on('data', c => { d += c; }); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
                }).on('error', () => resolve(null));
              });
              if (r2 && r2.ok && r2.data && r2.data.user) user = r2.data.user;
            }
          }
        } catch (e) { /* 忽略 */ }
        if (win && !win.isDestroyed()) win.webContents.send('qq-login-done', { ok: !!user, user });
        try { if (qqLoginWin && !qqLoginWin.isDestroyed()) qqLoginWin.close(); } catch (e) { }
      }, 3000);
    } catch (e) { /* 登录窗口关闭竞态等，忽略 */ }
  }, 1000);
  qqLoginWin.on('closed', () => { clearInterval(timer); qqLoginWin = null; });
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
  startServer(port => {
    createWindow(port);
    /* 启动后从 Chromium Cookie 罐重抓全量 QQ Cookie：
       旧版本保存时裁掉了 psrf_musickey_createtime 等VIP凭证（导致会员降级），
       这里自动补全 —— 用户无需重新登录 */
    refreshQqCookieFromJar();
    /* 每2分钟再同步一次：QQ音乐会在页面访问时轮换key，
       服务端一直拿旧key就会出现"有会员也播不了会员歌"的老问题 */
    setInterval(() => { refreshQqCookieFromJar(); }, 120 * 1000);
    /* QQ音乐凭证保活：qm_keyst/psrf_* 需要页面访问才会被服务端续期。
       只做Cookie同步不做访问，登录几小时后就会"会员歌播不了"。 */
    /* 注意：不要用隐藏窗口反复访问 y.qq.com —— 实测会让Cookie键数变少（凭证丢失）。
       改为依赖 merge 同步 + 失效时提示重新登录。 */
  });
});

app.on('before-quit', () => { try { const s = require('../server'); s.cloudflared.stop(); s.roomServer.stop(); } catch (e) {} });
/* 从默认 session 的 Cookie 罐重抓全部 qq.com Cookie 交给本地服务 */
async function refreshQqCookieFromJar() {
  try {
    const { session } = require('electron');
    const all = await session.defaultSession.cookies.get({});
    const qqq = all.filter(c => (c.domain || '').includes('qq.com') && c.value);
    const kv = {};
    qqq.forEach(c => { kv[c.name] = c.value; });
    if (!kv.uin || kv.uin === '0' || (!kv.qm_keyst && !kv.qqmusic_key)) return; // 未登录，跳过
    const ck = qqq.map(c => c.name + '=' + c.value).join('; ');
    await new Promise(resolve => {
      require('http').get('http://127.0.0.1:' + serverPort + '/api/qqcookie/set?value=' + encodeURIComponent(ck), res => {
        res.resume();
        res.on('end', resolve);
      }).on('error', resolve);
    });
    console.log('[QQ] Cookie已从浏览器罐补全（含VIP凭证）');
  } catch (e) { /* 忽略 */ }
}

/* ---------- QQ音乐凭证保活 ---------- */
function qqKeepStart() {
  try {
    if (qqKeepWin && !qqKeepWin.isDestroyed()) return;
    qqKeepWin = new BrowserWindow({
      width: 400, height: 300, show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    qqKeepWin.webContents.on('did-finish-load', () => {
      setTimeout(() => { refreshQqCookieFromJar(); }, 2000);
    });
    qqKeepWin.on('closed', () => { qqKeepWin = null; });
    qqKeepWin.loadURL('https://y.qq.com/');
    console.log('[QQ] 凭证保活已启动');
  } catch (e) { console.log('[QQ] 保活启动失败', e.message); }
}
function qqKeepRefresh() {
  try {
    if (!qqKeepWin || qqKeepWin.isDestroyed()) { qqKeepStart(); return; }
    qqKeepWin.loadURL('https://y.qq.com/'); // 重新载入触发续期
  } catch (e) { }
}

app.on('window-all-closed', () => app.quit());
