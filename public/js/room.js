/* 一起听：房主本机 WebSocket 房间 + 客人本地拉流同步。
   依赖全局 Player / Api / showModal / toast / esc（由 app.js 提供）。
   房主只广播曲目 ID、队列、播放状态和时间戳；不发送媒体直链/Cookie。 */
(function () {
  const NAME_KEY = 'bp.roomName';
  const R = {
    ws: null, role: null, code: '', hostToken: '', name: '', clientId: '',
    info: null, members: [], chat: [], state: null,
    connected: false, connecting: false, keepAlive: false, lastErr: '',
    offset: 0, rtt: 0, offsets: [], pingTimer: null,
    hostTimer: null, guestTimer: null, reconnectTimer: null, reconnectDelay: 1000,
    lastTrackKey: '', lastQueueKey: '', lastPlaying: false, lastPos: 0, lastSentAt: 0,
    loadGen: 0, loading: false, drift: 0, panelOpen: false,
    ready: new Set(), startTimer: null, waitingStart: false, hostOffline: false,
    reconnectAttempts: 0, errors: [], lastLoadErrorKey: '',
    requests: [], reqResults: [], reqStatus: '', reqQuery: ''
  };
  window.Room = R;

  const $ = id => document.getElementById(id);
  const val = id => { const e = $(id); return e ? String(e.value || '').trim() : ''; };
  const trackKey = it => it ? (it.nid ? 'n' + it.nid : (it.bvid ? 'b' + it.bvid : '')) : '';
  const packItem = it => {
    if (!it) return null;
    const o = {};
    for (const k of ['bvid', 'cid', 'aid', 'upMid', 'nid', 'title', 'up', 'artist', 'duration', 'pic', 'play', 'type', 'album', 'pubdate']) {
      if (it[k] !== undefined && it[k] !== null) o[k] = it[k];
    }
    return o;
  };
  const serverNow = () => Date.now() + (R.role === 'host' ? 0 : R.offset);
  const expected = st => {
    if (!st) return 0;
    const base = Number(st.position) || 0;
    if (!st.playing) return Math.max(0, base);
    const anchor = st.startAt != null ? Number(st.startAt) : Number(st.startedAt);
    if (!isFinite(anchor)) return Math.max(0, base);
    const now = serverNow();
    if (now < anchor) return Math.max(0, base);
    return Math.max(0, base + (now - anchor) / 1000);
  };
  function clearStartTimer() {
    if (R.startTimer) { clearTimeout(R.startTimer); R.startTimer = null; }
    R.waitingStart = false;
  }
  function send(obj) {
    if (R.ws && R.ws.readyState === 1) { try { R.ws.send(JSON.stringify(obj)); } catch (e) {} }
  }
  function stopTimer(k) { if (R[k]) { clearInterval(R[k]); R[k] = null; } }
  function stopTimers() {
    stopTimer('pingTimer'); stopTimer('hostTimer'); stopTimer('guestTimer');
    clearStartTimer();
    if (R.reconnectTimer) { clearTimeout(R.reconnectTimer); R.reconnectTimer = null; }
  }
  function closeSocket(bye) {
    if (!R.ws) return;
    try { if (bye && R.ws.readyState === 1) R.ws.send(JSON.stringify({ type: 'bye' })); } catch (e) {}
    try { R.ws.close(); } catch (e) {}
    R.ws = null;
  }

  function connect(url, join) {
    closeSocket(false);
    R.connecting = true;
    R.lastErr = '';
    let ws = null;
    try { ws = new WebSocket(url); } catch (e) { R.connecting = false; R.lastErr = '地址无效'; toast('连接失败：地址无效', 'error'); refreshPanel(); return; }
    R.ws = ws;
    const timer = setTimeout(() => {
      if (ws.readyState !== 1) {
        try { ws.close(); } catch (e) {}
        R.connecting = false; R.lastErr = '连接超时';
        toast('连接超时：检查房主地址、Tailscale 和防火墙', 'error');
        refreshPanel();
      }
    }, 8000);
    ws.onopen = () => {
      clearTimeout(timer);
      R.connected = true; R.connecting = false; R.reconnectDelay = 1000; R.reconnectAttempts = 0; R.hostOffline = false;
      send(Object.assign({ type: 'join' }, join));
      startPing();
      if (R.role === 'host') startHostSync(); else startGuestSync();
      refreshPanel();
    };
    ws.onmessage = ev => {
      let m = null;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      handle(m);
    };
    ws.onclose = () => {
      clearTimeout(timer);
      R.connected = false; R.connecting = false;
      stopTimers();
      if (R.role === 'guest') { try { Player.activeEl().pause(); } catch (e) {} }
      refreshPanel();
      if (R.keepAlive && R.role) scheduleReconnect(url, join);
    };
    ws.onerror = () => { if (!R.lastErr) R.lastErr = '连接失败'; };
  }
  function scheduleReconnect(url, join) {
    if (R.reconnectTimer) return;
    if (R.reconnectAttempts >= 6) {
      R.keepAlive = false;
      R.lastErr = '连接已断开，请重新加入';
      refreshPanel();
      return;
    }
    R.reconnectAttempts++;
    const delay = R.reconnectDelay;
    R.reconnectDelay = Math.min(10000, Math.round(delay * 1.8));
    R.reconnectTimer = setTimeout(() => {
      R.reconnectTimer = null;
      if (R.keepAlive && R.role) connect(url, join);
    }, delay);
  }

  function startPing() {
    stopTimer('pingTimer');
    R.offsets = [];
    const tick = () => { if (R.ws && R.ws.readyState === 1) send({ type: 'ping', t0: Date.now() }); };
    tick();
    R.pingTimer = setInterval(tick, 5000);
  }
  function handle(m) {
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'welcome') {
      R.clientId = m.clientId || '';
      R.role = m.role || R.role;
      R.code = m.code || R.code;
      R.members = Array.isArray(m.members) ? m.members : [];
      R.chat = Array.isArray(m.chat) ? m.chat : [];
      R.state = m.state || null;
      R.requests = Array.isArray(m.requests) ? m.requests : [];
      if (R.role === 'host') R.ready.clear();
      if (R.role === 'guest' && R.state) applyState(R.state);
      refreshPanel();
      return;
    }
    if (m.type === 'members') { R.members = Array.isArray(m.members) ? m.members : []; refreshPanel(); return; }
    if (m.type === 'chat') {
      if (m.chat) { R.chat.push(m.chat); if (R.chat.length > 50) R.chat.shift(); refreshPanel(); }
      return;
    }
    if (m.type === 'state') {
      if (R.role === 'guest') applyState(m.state);
      return;
    }
    if (m.type === 'request') {
      if (m.request && m.request.id && !R.requests.some(r => r.id === m.request.id)) {
        R.requests.push(m.request);
        if (R.role === 'host') toast(m.request.name + ' 点歌：' + ((m.request.item && m.request.item.title) || ''), '');
        refreshPanel();
      }
      return;
    }
    if (m.type === 'request-result') {
      R.requests = R.requests.filter(r => r.id !== m.id);
      if (R.role === 'guest') {
        R.reqStatus = m.accept ? ('房主已加入队列：' + ((m.item && m.item.title) || '')) : '房主未接受这首点歌';
        toast(R.reqStatus, m.accept ? 'success' : '');
      }
      refreshPanel();
      return;
    }
    if (m.type === 'ready') {
      if (R.role === 'host' && m.clientId) { R.ready.add(m.clientId); refreshPanel(); }
      return;
    }
    if (m.type === 'guest-error') {
      const text = (m.name || '客人') + ' 加载失败：' + (m.message || '未知错误');
      R.chat.push({ name: '系统', text, at: Date.now() });
      if (R.chat.length > 50) R.chat.shift();
      toast(text, 'error');
      refreshPanel();
      return;
    }
    if (m.type === 'host-offline') {
      if (R.role === 'guest') {
        clearStartTimer();
        R.hostOffline = true;
        R.lastErr = '房主重连中…';
        try { Player.activeEl().pause(); } catch (e) {}
        toast('房主连接中断，等待重连…', '');
        refreshPanel();
      }
      return;
    }
    if (m.type === 'host-online') {
      if (R.role === 'guest') {
        R.hostOffline = false;
        R.lastErr = '';
        toast('房主已重连', 'success');
        refreshPanel();
      }
      return;
    }
    if (m.type === 'host-left') {
      if (R.role === 'guest') {
        R.keepAlive = false;
        R.state = null;
        R.requests = [];
        R.lastErr = '房主已离开';
        clearStartTimer();
        R.ready.clear();
        stopTimers();
        closeSocket(false);
        try { Player.activeEl().pause(); } catch (e) {}
        toast('房主已离开，播放已暂停', '');
        refreshPanel();
      }
      return;
    }
    if (m.type === 'error') {
      R.lastErr = m.message || '房间错误';
      toast(R.lastErr, 'error');
      if (!R.connected) return;
      return;
    }
    if (m.type === 'pong') {
      const t2 = Date.now();
      const rtt = Math.max(0, t2 - (Number(m.t0) || t2));
      const off = (Number(m.serverTime) || t2) - ((Number(m.t0) || t2) + t2) / 2;
      R.rtt = Math.round(rtt);
      R.offsets.push(off);
      if (R.offsets.length > 5) R.offsets.shift();
      const sorted = R.offsets.slice().sort((a, b) => a - b);
      R.offset = sorted[Math.floor(sorted.length / 2)] || 0;
      refreshPanel();
    }
  }

  function startHostSync() {
    stopTimer('hostTimer');
    R.lastTrackKey = ''; R.lastQueueKey = ''; R.lastPlaying = false; R.lastPos = 0; R.lastSentAt = 0;
    R.hostTimer = setInterval(hostTick, 500);
  }
  function hostTick() {
    if (R.role !== 'host' || !R.connected || !R.ws) return;
    if (Player.S.loading) return;
    const el = Player.activeEl();
    const tr = Player.S.track;
    if (!el || !tr) return;
    const q = Array.isArray(Player.S.queue) ? Player.S.queue : [];
    const tk = trackKey(tr);
    const qk = q.map(trackKey).join('|');
    const playing = !el.paused;
    const pos = Number(el.currentTime) || 0;
    const now = Date.now();
    const trackChanged = tk !== R.lastTrackKey;
    const queueChanged = qk !== R.lastQueueKey;
    const playChanged = playing !== R.lastPlaying;
    let seek = false;
    if (!trackChanged && !queueChanged && !playChanged && R.lastPlaying) {
      const exp = R.lastPos + (now - R.lastSentAt) / 1000;
      if (Math.abs(pos - exp) > 0.8) seek = true;
    }
    if (!trackChanged && !queueChanged && !playChanged && !R.lastPlaying && Math.abs(pos - R.lastPos) > 0.5) seek = true;
    const heartbeat = now - R.lastSentAt > 5000;
    if (!trackChanged && !queueChanged && !playChanged && !seek && !heartbeat) return;
    /* 预约起播：换歌 1.5s、恢复播放 1s、播放中 seek 0.8s；房主继续播，客人等到 startAt 再对齐 */
    let lead = 0;
    if (trackChanged && playing) lead = 1500;
    else if (playChanged && playing) lead = 1000;
    else if (seek && playing) lead = 800;
    const startAt = now + lead;
    const sendPos = playing ? pos + lead / 1000 : pos;
    const state = {
      track: packItem(tr),
      queue: q.map(packItem),
      index: Player.S.index,
      playing,
      position: sendPos,
      startAt,
      startedAt: startAt,
      rate: 1
    };
    send({ type: 'state', state });
    if (trackChanged) R.ready.clear();
    R.lastTrackKey = tk; R.lastQueueKey = qk; R.lastPlaying = playing;
    R.lastPos = pos; R.lastSentAt = now;
  }

  function startGuestSync() {
    stopTimer('guestTimer');
    R.guestTimer = setInterval(guestTick, 2000);
  }
  function guestTick() {
    if (R.role !== 'guest' || !R.connected || !R.state || !R.state.playing) return;
    if (R.waitingStart || R.startTimer || R.hostOffline) return;
    const el = Player.activeEl();
    if (!el || el.paused) return;
    const exp = expected(R.state);
    const drift = (Number(el.currentTime) || 0) - exp;
    R.drift = drift;
    if (Math.abs(drift) > 0.25) {
      try { Player.seek(exp); } catch (e) {}
      try { el.playbackRate = 1; } catch (e) {}
    } else if (Math.abs(drift) > 0.05) {
      try {
        el.playbackRate = 1 - Math.max(-0.02, Math.min(0.02, drift * 0.2));
        setTimeout(() => { try { el.playbackRate = 1; } catch (e) {} }, 2000);
      } catch (e) {}
    }
    refreshPanel();
  }

  function sendReady() {
    send({ type: 'ready', track: trackKey(Player.S.track) });
  }

  function alignGuest(st, doReady) {
    clearStartTimer();
    const el = Player.activeEl();
    if (!el) return;
    const anchor = st.startAt != null ? Number(st.startAt) : Number(st.startedAt);
    let delay = isFinite(anchor) ? (anchor - serverNow()) / 1000 : 0;
    if (delay > 10) delay = 0; // 时钟异常保护
    const base = Number(st.position) || 0;
    const target = delay > 0.02 ? base : expected(st);
    const cur = Number(el.currentTime) || 0;
    if (delay > 0.02 || !st.playing || Math.abs(cur - target) > 0.5) {
      try { Player.seek(Math.max(0, target)); } catch (e) {}
    }
    if (!st.playing) {
      try { el.pause(); } catch (e) {}
      if (doReady) sendReady();
      return;
    }
    if (delay > 0.02) {
      try { el.pause(); } catch (e) {}
      R.waitingStart = true;
      R.startTimer = setTimeout(async () => {
        R.startTimer = null;
        R.waitingStart = false;
        if (!R.connected || R.role !== 'guest') return;
        const t = expected(R.state || st);
        try { Player.seek(Math.max(0, t)); } catch (e) {}
        try { await Player.activeEl().play(); } catch (e) {}
        sendReady();
      }, Math.min(10000, delay * 1000));
    } else {
      try { el.play(); } catch (e) {}
      if (doReady) sendReady();
    }
  }

  async function applyState(st) {
    if (R.role !== 'guest' || !st) return;
    R.state = st;
    const tk = trackKey(st.track);
    const same = !!(tk && trackKey(Player.S.track) === tk);
    const q = Array.isArray(st.queue) && st.queue.length ? st.queue : (st.track ? [st.track] : []);
    const qk = q.map(trackKey).join('|');
    const localQk = (Player.S.queue || []).map(trackKey).join('|');
    if (!same) {
      const gen = ++R.loadGen;
      R.loading = true;
      R.lastLoadErrorKey = '';
      try {
        const idx = Math.max(0, Math.min(q.length - 1, Number(st.index) || 0));
        Player.setQueue(q, idx);
        Player.S.resumeAt = 0;
        await Player.playCurrent();
        if (gen !== R.loadGen) return;
        alignGuest(st, true);
      } catch (e) {
        const msg = (e && e.message) || String(e);
        clearStartTimer();
        try { Player.activeEl().pause(); } catch (er) {}
        R.lastErr = '加载失败，等待房主处理';
        toast('加载房主歌曲失败：' + msg, 'error');
        if (R.lastLoadErrorKey !== tk) {
          R.lastLoadErrorKey = tk;
          send({ type: 'loadError', message: msg });
        }
      } finally {
        if (gen === R.loadGen) R.loading = false;
      }
      return;
    }
    if (qk !== localQk) {
      const idx = Math.max(0, Math.min(q.length - 1, Number(st.index) || 0));
      Player.setQueue(q, idx);
    }
    alignGuest(st, false);
  }

  /* ---------- UI ---------- */
  function lobbyHtml() {
    return '<h3>👥 一起听</h3>' +
      '<div class="room-note">2–8 人；房主和客人各自用本机账号拉流。房主建房会自动开 cloudflared 公网隧道，客人只需装 App；也可用 Tailscale/局域网地址。</div>' +
      '<div class="room-grid">' +
        '<div class="room-card"><b>创建房间</b><input id="room-host-name" maxlength="20" placeholder="你的昵称"><button class="btn primary" data-room-create>创建房间</button><div class="room-note">会开一个本机 WebSocket 端口 8900，Windows 防火墙需放行。</div></div>' +
        '<div class="room-card"><b>加入房间</b><input id="room-addr" placeholder="https://xxx.trycloudflare.com 或 100.x:8900"><input id="room-code" maxlength="8" placeholder="6 位房间码"><input id="room-guest-name" maxlength="20" placeholder="你的昵称"><button class="btn" data-room-join>加入房间</button></div>' +
      '</div>';
  }
  function roomHtml() {
    const hostAddrs = (R.info && R.info.ips || []).map(x => (x.tailscale ? 'Tailscale · ' : '') + (x.name ? x.name + ' ' : '') + x.address + ':' + R.info.port).join(' / ');
    const tunnel = R.info && R.info.tunnel;
    const tunnelLine = tunnel && tunnel.url
      ? '<div class="room-public">公网地址 <b>' + esc(tunnel.url) + '</b> <span class="room-note">cloudflared</span></div>'
      : '<div class="room-note">公网隧道：' + esc(tunnel ? (tunnel.error || (tunnel.active ? '建立中…' : '已关闭')) : '未启用') + '</div>';
    return '<h3>👥 一起听 <span class="room-role">' + (R.role === 'host' ? '房主' : '听众') + '</span></h3>' +
      '<div class="room-head"><div>房间码 <b id="room-code">' + esc(R.code) + '</b>' + (R.role === 'host' ? ' <button class="btn" data-room-copy>复制邀请</button>' : '') + '</div><div id="room-status">连接中…</div></div>' +
      (R.role === 'host' ? '<div class="room-hostinfo">' + tunnelLine + '<div class="room-note">局域网/Tailscale：' + esc(hostAddrs || '未检测到地址') + '</div><div class="room-note">客人输入公网地址（或局域网地址）+ 房间码。</div><div class="fx-advrow"><button class="btn" data-room-tunnel-retry>' + (tunnel && tunnel.url ? '重试隧道' : '开启公网隧道') + '</button><button class="btn" data-room-tunnel-off>关闭公网隧道</button></div></div>' : '') +
      '<div class="room-cols"><div class="room-col"><b>成员</b><div id="room-members"></div></div>' +
      '<div class="room-col"><b>聊天</b><div id="room-chat"></div><div class="room-chat-row"><input id="room-chat-input" maxlength="300" placeholder="说点什么…"><button class="btn" data-room-send>发送</button></div></div></div>' +
      (R.role === 'host'
        ? '<div class="room-request"><b>点歌申请 <span id="room-req-count">' + R.requests.length + '</span></b><div id="room-req-list"></div></div>'
        : '<div class="room-request"><b>点歌申请</b><div class="room-request-row"><input id="room-req-q" maxlength="80" placeholder="B站 BV号/视频链接/关键词"><button class="btn" data-room-req-search>搜索</button></div><div class="room-note">未登录 B 站时可直接粘贴视频链接/BV 号；关键词搜索需客人登录。</div><div id="room-req-results"></div><div id="room-req-status" class="room-note"></div></div>') +
      '<div class="room-actions">' + (R.role === 'host' ? '<button class="btn" data-room-stop>结束房间</button>' : '<button class="btn" data-room-leave>离开房间</button>') +
      '<span class="room-note">' + (R.role === 'guest' ? '播放/暂停/切歌由房主控制' : '你的播放会同步给所有人') + '</span></div>';
  }
  function renderPanel() {
    showModal(R.role ? roomHtml() : lobbyHtml(), 'wide');
    bindPanel();
    refreshPanel();
  }
  function bindPanel() {
    const create = document.querySelector('[data-room-create]');
    if (create) create.onclick = createRoom;
    const join = document.querySelector('[data-room-join]');
    if (join) join.onclick = joinRoom;
    const copy = document.querySelector('[data-room-copy]');
    if (copy) copy.onclick = copyInvite;
    const sendBtn = document.querySelector('[data-room-send]');
    if (sendBtn) sendBtn.onclick = sendChat;
    const ci = $('room-chat-input');
    if (ci) ci.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } };
    const leave = document.querySelector('[data-room-leave]');
    if (leave) leave.onclick = () => leaveRoom();
    const stop = document.querySelector('[data-room-stop]');
    if (stop) stop.onclick = () => leaveRoom();
    const tr = document.querySelector('[data-room-tunnel-retry]');
    if (tr) tr.onclick = tunnelRetry;
    const toff = document.querySelector('[data-room-tunnel-off]');
    if (toff) toff.onclick = tunnelOff;
    const reqSearch = document.querySelector('[data-room-req-search]');
    if (reqSearch) reqSearch.onclick = requestSearch;
    const reqResults = $('room-req-results');
    if (reqResults) reqResults.onclick = e => {
      const b = e.target.closest('[data-room-req-idx]');
      if (b) sendRequest(+b.dataset.roomReqIdx);
    };
    const reqList = $('room-req-list');
    if (reqList) reqList.onclick = e => {
      const a = e.target.closest('[data-room-req-accept]');
      const r = e.target.closest('[data-room-req-reject]');
      if (a) acceptRequest(a.dataset.roomReqAccept);
      if (r) rejectRequest(r.dataset.roomReqReject);
    };
  }
  function refreshPanel() {
    document.querySelectorAll('[data-action="room-open"]').forEach(b => {
      b.classList.toggle('active', !!R.role);
      b.textContent = R.role ? ('👥 一起听 · ' + (R.connected ? '已连接' : '连接中')) : '👥 一起听';
    });
    if (!$('room-status')) return;
    const st = $('room-status');
    if (st) {
      if (R.role === 'host') {
        const ids = new Set(R.members.filter(m => m.role === 'guest').map(m => m.id));
        for (const id of [...R.ready]) if (!ids.has(id)) R.ready.delete(id);
      }
      const readyTxt = R.role === 'host' ? ' · 就绪 ' + R.ready.size + '/' + Math.max(0, R.members.length - 1) : (R.waitingStart ? ' · 等待同步起播' : '');
      st.textContent = R.hostOffline
        ? '房主重连中…'
        : (R.connected
          ? '已连接 · RTT ' + (R.rtt || '—') + 'ms · 偏移 ' + Math.round(R.offset) + 'ms · 漂移 ' + Math.round(R.drift * 1000) + 'ms' + readyTxt
          : (R.connecting ? '连接中…' : (R.lastErr || '已断开')));
    }
    const mm = $('room-members');
    if (mm) mm.innerHTML = R.members.map(m => '<div class="room-member"><b>' + esc(m.name) + '</b><span>' + (m.role === 'host' ? '房主' : (R.ready.has(m.id) ? '已就绪' : '听众')) + '</span></div>').join('') || '<div class="room-note">等待加入…</div>';
    const ch = $('room-chat');
    if (ch) {
      ch.innerHTML = R.chat.map(c => '<div class="room-msg"><b>' + esc(c.name) + '</b> ' + esc(c.text) + '</div>').join('') || '<div class="room-note">还没有消息</div>';
      ch.scrollTop = ch.scrollHeight;
    }
    const rl = $('room-req-list');
    if (rl) {
      rl.innerHTML = R.requests.length ? R.requests.map(r => {
        const it = r.item || {};
        return '<div class="room-req-item"><div class="room-req-meta"><b>' + esc(it.title || '未命名') + '</b><span>' + esc(r.name || '') + ' · ' + esc(it.up || it.artist || '') + '</span></div>' +
          '<div class="room-req-btns"><button class="btn" data-room-req-accept="' + esc(r.id) + '">加入队列</button><button class="btn" data-room-req-reject="' + esc(r.id) + '">拒绝</button></div></div>';
      }).join('') : '<div class="room-note">暂无点歌申请</div>';
    }
    const rc = $('room-req-count');
    if (rc) rc.textContent = R.requests.length;
    const rr = $('room-req-results');
    if (rr) {
      rr.innerHTML = R.reqResults.length ? R.reqResults.map((it, i) =>
        '<div class="room-req-item"><div class="room-req-meta"><b>' + esc(it.title || '') + '</b><span>' + esc(it.up || it.artist || '') + '</span></div>' +
        '<div class="room-req-btns"><button class="btn" data-room-req-idx="' + i + '">申请</button></div></div>').join('') : '';
    }
    const rs = $('room-req-status');
    if (rs) rs.textContent = R.reqStatus || '';
  }
  async function createRoom() {
    const name = val('room-host-name') || localStorage.getItem(NAME_KEY) || '房主';
    localStorage.setItem(NAME_KEY, name);
    R.role = 'host'; R.name = name; R.keepAlive = true; R.connecting = true; R.lastErr = '';
    try {
      toast('正在建立公网隧道，约 10–20 秒…', '');
      const info = await Api.post('room/start', {});
      R.info = info; R.code = info.code; R.hostToken = info.hostToken;
      if (info.tunnel && info.tunnel.error) toast('公网隧道失败：' + info.tunnel.error + '（仍可用局域网/Tailscale 地址）', 'error');
      connect('ws://127.0.0.1:' + info.port, { role: 'host', code: info.code, token: info.hostToken, name });
      renderPanel();
    } catch (e) {
      R.role = null; R.keepAlive = false; R.connecting = false;
      toast('创建房间失败：' + ((e && e.message) || e), 'error');
      renderPanel();
    }
  }
  function normalizeRoomUrl(addr) {
    let s = String(addr || '').trim();
    if (/^https:\/\//i.test(s)) return 'wss://' + s.slice(8).replace(/\/.*$/, '');
    if (/^http:\/\//i.test(s)) return 'ws://' + s.slice(7).replace(/\/.*$/, '');
    if (/^wss?:\/\//i.test(s)) return s.replace(/\/.*$/, '');
    s = s.replace(/\/.*$/, '');
    if (!/:\d+$/.test(s)) s += ':8900';
    return 'ws://' + s;
  }
  function joinRoom() {
    let addr = val('room-addr');
    const code = val('room-code').toUpperCase();
    const name = val('room-guest-name') || localStorage.getItem(NAME_KEY) || '听众';
    if (!addr) { toast('请输入房主地址', 'error'); return; }
    if (!code) { toast('请输入房间码', 'error'); return; }
    localStorage.setItem(NAME_KEY, name);
    const url = normalizeRoomUrl(addr);
    R.role = 'guest'; R.name = name; R.code = code; R.keepAlive = true; R.connecting = true; R.lastErr = '';
    connect(url, { role: 'guest', code, name });
    renderPanel();
  }
  async function leaveRoom() {
    R.keepAlive = false;
    closeSocket(true);
    stopTimers();
    const wasHost = R.role === 'host';
    R.role = null; R.code = ''; R.hostToken = ''; R.info = null; R.state = null;
    R.members = []; R.chat = []; R.connected = false; R.connecting = false;
    if (wasHost) { try { await Api.post('room/stop', {}); } catch (e) {} }
    renderPanel();
    toast('已离开一起听', 'success');
  }
  function extractBvid(q) {
    const m = String(q || '').match(/BV[0-9A-Za-z]{10}/);
    return m ? m[0] : '';
  }
  async function requestSearch() {
    const q = val('room-req-q');
    if (!q) { toast('输入 BV 号/链接或关键词', 'error'); return; }
    R.reqStatus = '';
    const rr = $('room-req-results');
    if (rr) rr.innerHTML = '<div class="room-note">搜索中…</div>';
    try {
      let items = [];
      const bv = extractBvid(q);
      if (bv) {
        const d = await Api.get('video', { bvid: bv });
        items = [{ bvid: bv, cid: d.cid, aid: d.aid, upMid: d.upMid, title: d.title, up: d.up, duration: d.duration, pic: d.pic, type: 'bili' }];
      } else {
        const d = await Api.get('search', { keyword: q, pn: 1 });
        items = (d.items || []).slice(0, 5);
      }
      R.reqResults = items;
      if (!items.length) R.reqStatus = '没有找到结果';
      refreshPanel();
    } catch (e) {
      R.reqResults = [];
      R.reqStatus = '搜索失败：' + ((e && e.message) || e);
      refreshPanel();
    }
  }
  function sendRequest(idx) {
    const it = R.reqResults[idx];
    if (!it) return;
    send({ type: 'request', item: packItem(it) });
    R.reqStatus = '已提交，等待房主处理';
    refreshPanel();
  }
  function acceptRequest(id) {
    const r = R.requests.find(x => x.id === id);
    if (!r) return;
    const item = r.item || {};
    let added = 0;
    try {
      added = Player.insertAfterCurrent([item]);
      if (!added && !Player.S.queue.length) { Player.setQueue([item], 0); added = 1; }
    } catch (e) {}
    if (!added) { toast('当前没有可插入的队列', 'error'); return; }
    send({ type: 'request-result', id, accept: true });
    R.requests = R.requests.filter(x => x.id !== id);
    toast('已加入队列：' + (item.title || ''), 'success');
    refreshPanel();
  }
  function rejectRequest(id) {
    send({ type: 'request-result', id, accept: false });
    R.requests = R.requests.filter(x => x.id !== id);
    toast('已拒绝该点歌', '');
    refreshPanel();
  }

  async function tunnelRetry() {
    if (R.role !== 'host') return;
    if (R.members.some(m => m.role === 'guest') && !confirm('重试隧道会断开当前所有客人，需要他们用新地址重新加入。继续？')) return;
    try {
      toast('正在重建公网隧道，约 10–20 秒…', '');
      await Api.post('tunnel/stop', {});
      const t = await Api.post('tunnel/start', {});
      R.info.tunnel = t;
      if (t && t.url) toast('公网隧道已恢复', 'success');
      else toast('隧道失败：' + ((t && t.error) || '未知错误'), 'error');
      renderPanel();
    } catch (e) { toast('隧道重试失败：' + ((e && e.message) || e), 'error'); }
  }
  async function tunnelOff() {
    if (R.role !== 'host') return;
    if (R.members.some(m => m.role === 'guest') && !confirm('关闭公网隧道会断开当前所有客人，继续？')) return;
    try {
      await Api.post('tunnel/stop', {});
      R.info.tunnel = { active: false, url: '', error: '' };
      toast('已关闭公网隧道，仅局域网/Tailscale 可用', '');
      renderPanel();
    } catch (e) { toast('关闭隧道失败：' + ((e && e.message) || e), 'error'); }
  }
  function copyInvite() {
    const addrs = (R.info && R.info.ips || []).map(x => x.address + ':' + R.info.port).join(' / ');
    const tunnel = R.info && R.info.tunnel && R.info.tunnel.url;
    const text = '一起听房间 ' + R.code + '\n房主地址：' + (tunnel || addrs || '（房主查看一起听面板）') + '\n打开 BiliPlayer → 一起听 → 加入房间';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('已复制邀请', 'success')).catch(() => toast('复制失败', 'error'));
    } else toast('当前环境不支持复制', 'error');
  }
  function sendChat() {
    const inp = $('room-chat-input');
    const text = inp ? String(inp.value || '').trim() : '';
    if (!text) return;
    send({ type: 'chat', text });
    if (inp) inp.value = '';
  }

  function openPanel() {
    R.panelOpen = true;
    renderPanel();
  }

  /* 客人禁止本地传输控制，避免和房主状态打架 */
  document.addEventListener('click', e => {
    if (R.role !== 'guest' || !R.connected) return;
    const t = e.target.closest('#pb-play,#pb-next,#pb-prev,#pb-playmode');
    if (t) { e.preventDefault(); e.stopPropagation(); toast('一起听中由房主控制播放', ''); }
  }, true);
  document.addEventListener('pointerdown', e => {
    if (R.role === 'guest' && R.connected && e.target.closest('#pb-track')) {
      e.preventDefault(); e.stopPropagation(); toast('一起听中由房主控制进度', '');
    }
  }, true);
  document.addEventListener('keydown', e => {
    if (R.role !== 'guest' || !R.connected) return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(tag)) {
      e.preventDefault(); e.stopPropagation(); toast('一起听中由房主控制播放', '');
    }
  }, true);

  R.openPanel = openPanel;
  R.createRoom = createRoom;
  R.joinRoom = joinRoom;
  R.leaveRoom = leaveRoom;
})();
