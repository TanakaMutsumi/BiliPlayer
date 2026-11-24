'use strict';
/* 本地打包：排除备份/数据/测试目录，并优先使用本机 Electron 缓存 zip。 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { packager } = require('@electron/packager');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const excluded = [
  'dist', 'data', 'backup', '.zcode', 'scripts', 'tmp', '.ref', 'bin', 'tmp-npm',
  '.git' // 仓库历史和远程配置不进安装包（否则包体翻倍，分享时还会带出提交记录）
];
const excludedModules = ['electron', 'electron-packager', 'electron-winstaller', '.bin'];

function findElectronZip() {
  if (process.env.ELECTRON_ZIP_DIR) return process.env.ELECTRON_ZIP_DIR;
  const cache = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron', 'Cache');
  try {
    for (const dir of fs.readdirSync(cache)) {
      const p = path.join(cache, dir);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        const z = fs.readdirSync(p).find(x => /^electron-v.*-win32-x64\.zip$/.test(x));
        if (z) return p;
      }
    }
  } catch (e) {}
  return '';
}

const electronZipDir = findElectronZip();

packager({
  dir: root,
  name: 'BiliPlayer',
  platform: 'win32',
  arch: 'x64',
  out: dist,
  overwrite: true,
  icon: path.join(root, 'assets', 'icon.ico'),
  win32metadata: { ProductName: 'BiliPlayer' },
  electronZipDir: electronZipDir || undefined,
  extraResource: [path.join(root, 'bin')],
  ignore(file) {
    const rel = String(file).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel || rel === '.') return false;
    if (excluded.some(d => rel === d || rel.startsWith(d + '/'))) return true;
    if (rel.startsWith('node_modules/')) {
      const p = rel.slice('node_modules/'.length);
      if (excludedModules.some(d => p === d || p.startsWith(d + '/'))) return true;
    }
    return /^(server|dev-server|electron-dev)\.log$/.test(rel) || rel.startsWith('_dist_');
  }
}).then(paths => {
  console.log('Wrote new app to:', paths[0]);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
