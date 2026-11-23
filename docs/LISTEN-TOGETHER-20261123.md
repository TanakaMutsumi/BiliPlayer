# 一起听（Listen Together）实现说明

> 目标：2–3 个异地朋友，都装 BiliPlayer，免费/低延迟同步听歌。  
> 方案：房主本机 WebSocket 房间 + cloudflared 公网隧道 + 客人本地拉流 + 房主权威控制。  
> 不共享媒体直链、不代理音频、不接触对方账号 Cookie。

## 1. 架构

```text
房主 App ──ws── 本机 8900 房间服务
                    │
              cloudflared quick tunnel
                    │
客人 App ──wss── https://xxx.trycloudflare.com
      │
      └─ 各自用本机 B站/网易云账号解析同一首 bvid/nid
```

- 房主：唯一控制端，维护队列、当前曲目、播放/暂停/seek/切歌。
- 房间服务：只广播状态、成员、聊天；保存最后状态给迟到者。
- 客人：按房主曲目 ID 本地加载；不接收媒体 URL。
- 异地：房主建房时自动启动 cloudflared，客人只需装 App；Tailscale/局域网作为备用。

## 2. 代码位置

| 文件 | 作用 |
|---|---|
| `src/room-server.js` | WebSocket 房间服务：房间码、房主令牌、成员、聊天、状态广播、心跳 |
| `src/tunnel.js` | cloudflared quick tunnel：启动、解析公网 URL、退出清理 |
| `bin/cloudflared.exe` | cloudflared 2026.11.1（Apache-2.0，SHA256 `341deda3…955e35`） |
| `bin/CLOUDFLARED-LICENSE` | Apache-2.0 许可证 |
| `server.js` | `/api/room/start`、`/api/room/stop`、`/api/room/status` |
| `public/js/room.js` | 房主/客人客户端、时钟同步、播放同步、漂移校正、一起听 UI |
| `public/index.html` | 加载 `room.js` |
| `public/js/app.js` | “👥 一起听”入口与 action |
| `electron/main.js` | 退出时停止房间服务；测试用多实例环境变量 |
| `public/css/style.css` | 房间面板样式 |

## 3. 协议

WebSocket 文本 JSON：

- `hello`：服务端问候，含房间码/服务器时间。
- `join`：`{role:'host'|'guest', code, token?, name}`。
- `welcome`：`{clientId, role, code, members, chat, state, serverTime}`。
- `ping` / `pong`：`{t0, serverTime}`，用于估算时钟偏移与 RTT。
- `state`：仅房主可发；服务端补 `serverTime` 后广播。
- `chat`：`{text}`，服务端限 300 字、保留最近 50 条。
- `members`：成员变化。
- `host-left`：房主断开。
- `request`：客人点歌申请 `{item}`；服务端去重、最多 10 条。
- `request-result`：房主审批 `{id, accept}`；广播给所有人。
- `error`：房间码/令牌/人数错误。

`state` 结构：

```json
{
  "track": { "bvid": "...", "cid": 123, "aid": 456, "upMid": 789, "title": "...", "duration": 240.5 },
  "queue": [ ... ],
  "index": 0,
  "playing": true,
  "position": 12.34,
  "startedAt": 1760000000000,
  "rate": 1
}
```

- `packItem` 只发送播放所需字段（bvid/cid/aid/upMid/nid/title/up/artist/duration/pic/play/type/album/pubdate），不含直链/Cookie。
- 带上 `aid/upMid` 可让客人跳过 B 站 view 接口，减少加载失败。

## 4. 同步逻辑

### 房主
- 每 500ms 轮询本地 Player：
  - 曲目/队列/索引变化 → 发 `state`
  - 播放/暂停变化 → 发 `state`
  - 播放中进度偏离预期 >0.8s（seek）→ 发 `state`
  - 暂停中进度变化 >0.5s（暂停 seek）→ 发 `state`
  - 无变化时每 5s 心跳一次
- `startedAt` 用当前时间，`position` 用当前进度；客人按 `position + (serverNow-startedAt)/1000` 推算。

### 客人
- 收到 `welcome/state`：
  - 曲目不同 → `Player.setQueue` + `playCurrent`，再 seek 到预期进度。
  - 同曲但队列变化 → 只更新队列，不重载当前曲。
  - 同曲 → 同步播放/暂停；偏差 >0.5s 直接 seek。
- 每 2s 检查漂移：
  - >250ms：seek
  - 50–250ms：短暂 `playbackRate` 1±0.02，2s 后恢复
- 预约起播：换歌房主提前 1.5s、恢复播放 1s、播放中 seek 0.8s；客人加载后等到 `startAt` 再播，房主继续播，到点两边进度一致。
- ready 握手：客人加载/对齐后发 `ready`，房主面板显示“就绪 X/Y”。
- 断线：指数退避重连；重连后 welcome 状态自动追平。
- 房主短暂断线：20 秒宽限，客人暂停并显示“房主重连中…”，房主带 token 重连后自动恢复；超时才发 `host-left`。
- 房主离开：暂停客人播放，停止重连，提示“房主已离开”。
- 客人加载失败：客人发 `loadError`，房主聊天区收到“系统：某某加载失败…”，客人暂停等待房主处理。

## 5. 安全与限制

- 房间码 6 位十六进制 + 房主随机 token；房主 token 只通过本机 `/api/room/start` 返回。
- 最多 8 人；聊天限 300 字；状态只接受房主。
- 房间服务绑定 `0.0.0.0:8900`；公网入口是 cloudflared quick tunnel，只暴露房间 WebSocket。
- 隧道 URL 是公网地址，Cloudflare 边缘可见控制/聊天内容；不传媒体、不传 Cookie。
- 房间码 + 房主 token 保护；房主 token 不进入邀请。
- cloudflared quick tunnel 地址每次建房会变，且无 SLA；需要固定地址可改 named tunnel + 域名。
- 房主必须保持 App 和 cloudflared 运行；退出/结束房间会自动杀掉隧道进程。
- “重试/关闭隧道”会断开当前所有客人；UI 会二次确认，客人需用新地址重新加入。
- quick tunnel 重建后地址会变，已有客人无法自动跟到新地址。
- 客人本地拉流，媒体可用性取决于客人账号/地区/版权；加载失败会 toast。
- 第一版无语音、无房主推流、无房主迁移。

## 6. 使用

1. 房主和客人都只需安装 BiliPlayer；不需要装 Tailscale。
2. 房主打开 App → “👥 一起听” → 创建房间；等待 10–20 秒建立 cloudflared 公网隧道。
3. 房主复制邀请（公网 `https://…trycloudflare.com` + 房间码）。
4. 客人打开 App → 一起听 → 加入；输入公网地址、房间码、昵称（也支持 `100.x:8900` 局域网/Tailscale 地址）。
5. 房主播放/暂停/切歌/seek；客人只保留音量与音效。
6. 房主结束房间或退出 App，cloudflared 停止，客人自动暂停。
7. 如果公网隧道失败，房主面板仍显示 Tailscale/局域网地址作为备用。
8. 房主面板可“重试隧道/关闭公网隧道”；隧道异常时可重建（会断开当前客人）。
9. 客人可在房间面板“点歌申请”：粘贴 B 站 BV 号/视频链接（未登录也可），或关键词搜索（需客人登录 B 站）；房主选择“加入队列/拒绝”。

## 7. 实测（2026-11-23）

- Node 模拟客人：加入、welcome、成员、聊天、state 广播正常。
- 双 App（房主 8899 + 客人 8910，独立 userData）：
  - 客人加载同一首 B 站 192kbps，队列 20，进度与房主一致。
  - 播放中漂移：-15ms / 6ms / -9ms / -1ms（不同阶段）。
  - 房主暂停 → 客人暂停；房主 seek 30 → 客人 33.6（含等待时间）；暂停 seek 40 → 客人 40。
  - 房主下一首 → 客人同曲目/索引/队列/192kbps，漂移 6ms。
  - 聊天双向；第三位 Node 客人加入成员 3、离开回 2。
  - 客人点击播放按钮被拦截，不打断房主状态。
  - 客人断线 → 自动暂停；重连后恢复播放，漂移 -9ms。
  - 房主结束房间 → 客人暂停、状态清空、停止重连。
  - 房主重新建房 → 客人重新加入成功。
- cloudflared 公网隧道：
  - 源版房主创建房间 → `https://conventions-res-schedules-candy.trycloudflare.com`；Node 客人 `wss://` 加入成功。
  - 客人 App 输入 `https://…` 自动转 `wss://`，加载同一首 192kbps；RTT 343ms、偏移 5ms、漂移 7ms。
  - 房主结束房间后 cloudflared 进程消失、8900 不再监听，客人暂停并显示“房主已离开”。
- 预约起播/ready：房主暂停加入时客人保持暂停；房主播放后客人等到 `startAt` 起播；房主面板显示“就绪 1/1”。
- 房主断线宽限：房主 ws 断开后客人暂停、状态“房主重连中…”；房主 1s 后自动重连，客人恢复播放，漂移 -6ms。
- 加载失败上报：注入坏 bvid 后房主聊天区收到“系统：优化客人 加载失败：请求错误”。
- 隧道开关：房主 UI 关闭公网隧道后 cloudflared 进程消失；重试后拿到新 `trycloudflare.com` 地址。
- 打包版双实例：房主暂停时加入，客人保持暂停；房主播放后客人按 `startAt` 起播，主机 199.2s / 客人 199.1s，漂移 2ms；房主面板“就绪 1/1”。
- 打包版房主断线：客人暂停显示“房主重连中…”，3s 后恢复播放，漂移 3ms。
- 点歌申请：客人粘贴 BV 链接成功解析；提交后房主请求列表出现；房主接受后队列 20→21，客人队列同步 21，客人状态“房主已加入队列”；拒绝时客人状态“房主未接受这首点歌”。
- 客人未登录 B 站时关键词搜索返回“账号未登录”，UI 提示改用 BV/链接。
- 打包版：Node 客人提交 BV 请求，房主列表出现；接受后队列 21→22，toast“已加入队列：点歌请求测试”。
- 打包版：内置 `resources/bin/cloudflared.exe`；房主创建房间拿到 `https://insert-amongst-promoting-newfoundland.trycloudflare.com`，Node 客人 `wss://` welcome/成员/聊天正常；结束房间后进程清理正常。
- 二进制：cloudflared 2026.11.1，SHA256 与官方 release 一致；`ws` 与 cloudflared 均不在 asar 内重复打包。

## 8. 后续

- cloudflared named tunnel + 域名，固定公网地址（quick tunnel 每次会变）。
- 房主短暂断线宽限（当前 host-left 会让客人停止重连）。
- 客人点歌申请已支持（B 站 BV/链接/关键词）；后续可加投票/网易云点歌。
- 房主 WebRTC 推流兜底（客人无账号/跨区取不到流）。
- 自建/托管 WebSocket 中继，做纯 6 位房间码体验。
- 语音聊天。
