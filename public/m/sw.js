/* BiliPlayer 手机端 Service Worker
   只缓存"静态外壳"（html/css/js/图标），绝不缓存：
   - /api/*（接口，必须实时）
   - 音频/视频流（Range 请求，缓存会瞬间吃爆内存导致页面卡死）
   - 大文件（apk 等） */
const CACHE = 'bp-m-v2';
const SHELL = ['./', './m.css', './m.js', './icon-192.png', './icon-512.png'];
const MAX_CACHE_BYTES = 120 * 1024; // 单个资源超过 120KB 不缓存

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL).catch(() => { }))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k)) // 清掉旧版（含之前错误的缓存）
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }

  // 只处理同源静态资源；接口一律交给网络
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (/\.(apk|mp3|m4a|mp4|webm|flac|aac|ogg|wav)$/i.test(url.pathname)) return;
  if (url.pathname.startsWith('/m/BiliPlayer')) return;

  // 网络优先，失败回落缓存（离线可用）
  e.respondWith(
    fetch(req).then(res => {
      // 只缓存成功的小体积静态资源；跳过部分响应与 Range 响应
      const len = +(res.headers.get('content-length') || 0);
      const isRange = res.status === 206 || req.headers.has('range');
      if (res.ok && !isRange && len > 0 && len <= MAX_CACHE_BYTES) {
        const cp = res.clone();
        caches.open(CACHE).then(c => c.put(req, cp)).catch(() => { });
      }
      return res;
    }).catch(() => caches.match(req).then(m => m || caches.match('./')))
  );
});
