# 动态 MV / Folia / PV Tool 模块交接文档

> 日期：2026-11-20  
> 项目：`C:\Users\16493\Desktop\b站音乐播放器`  
> 目的：记录动态歌词 MV 板块的完整架构、当前状态、已知问题和继续开发方法，方便后续直接接上下文。  
> 重要前提：Folia 资源为 AGPL-3.0，当前仅限个人本地使用；PV Tool 为 Non-Commercial License，同样仅限个人非商业使用。

---

## 1. 当前结论

动态 MV 已经是“多运行时混合”架构：

- **Folia 原版运行时/组件**：12 个样式
- **自行重设计**：流光、纵向
- **旧实现保留**：浮名、星屑
- **PV Tool 试点**：春日、赛博、蛛网

当前共 **19 个样式**。应用通过 `public/js/folia-bridge.js` 统一管理 Folia/PV 运行时的生命周期，`public/js/lyricmv.js` 继续负责旧样式、歌词时间轴和多种辅助效果。

当前打包版运行端口：`8899`。

---

## 2. 样式总表（19 个）

| id | 名称 | 实现 | 备注 |
|---|---|---|---|
| `lumiere` | 绘光 | Folia Lumiere（Pixi） | 原版 Pixi 运行时 |
| `hanabi` | 花火 | Folia Hanabi（Pixi） | 原版 Pixi 运行时 |
| `poem` | 向籁 | Folia Sonnet（Pixi） | 原版 Pixi 运行时 |
| `tempera` | 淡彩 | Folia Tempera（Pixi） | 原版 Pixi 运行时 |
| `confess` | 倾诉 | Folia Tilt（React） | 原版组件，Shadow DOM 挂载 |
| `cloud` | 云阶 | Folia Partita（React） | 原版组件 |
| `ring` | 回环 | Folia Claddagh（React） | 原版组件 |
| `cadenza` | 心象 | Folia Cadenza（React） | 原版组件 |
| `fog` | 雾笼 | Folia Nebbia（WebGL/React） | 原版组件 |
| `chat` | 对话 | Folia Cappella（React） | 原版组件，聊天气泡 |
| `cinema` | 光影 | Folia Still（React） | 原版组件 |
| `monet` | 莫奈 | Folia Monet（React） | 原版组件 |
| `flow` | 流光 | 自行实现 + 藤蔓 | Canvas2D + DOM |
| `vertical` | 纵向 | 自行重设计 | 竖排分栏 |
| `fume` | 浮名 | 旧实现 | 原版 Fume 未跑通 |
| `diorama` | 星屑 | 旧实现 | 原版 Diorama 未跑通 |
| `pvharu` | 春日 | PV Tool 模板 17 | iframe 试点 |
| `pvcyber` | 赛博 | PV Tool 模板 3 | iframe 试点 |
| `pvweb` | 蛛网 | PV Tool 模板 9 | iframe 试点 |

说明：`hanabi` 的样式卡描述仍写着“爆炸大字”，但它实际使用的是 Folia Hanabi 原版运行时。

---

## 3. 关键文件地图

### `public/js/app.js`

负责：

- `MV_STYLE_DEFS`：19 个样式卡定义
- 动态 MV 的 DOM 结构（`#mv-layer`、`#mv-folia-lumiere`、`#mv-vine`、`#mv-grade`、`#mv-instrumental`、`#mv-transition` 等）
- `setMVStyle()`：统一切换样式
- 样式画廊、缩略图、样式面板
- AI 主题加载与日夜切换
- AI 歌词分词请求、BPM 请求
- AI 导演、段落切换、副歌事件
- 流光/纵向微调面板
- 性能模式、自动低帧率降级
- `FoliaBridge.configure()` 的数据注入

重要函数：

- `setMVStyle(style, keepTransition)`
- `updateTunePanel()`
- `setLowPower(on, quiet)`
- `directorPick(force)`
- `scheduleDirector()`
- `setDirector(on, quiet)`
- `pickChorusStyle()`
- `crossfadeTo(style)`
- `setSectionSwitch(on, quiet)`
- `openNEImport()` 等网易云导入逻辑（与本模块相邻但独立）

### `public/js/lyricmv.js`

负责旧样式和歌词基础能力：

- 歌词时间轴、逐字/逐词时间
- 段落、副歌识别、shot 镜头
- 旧样式：`flow`、`fume`、`diorama`、`chat`、`cinema`、`vertical`、`fog`
- 流光藤蔓 Canvas
- 纵向分栏 DOM
- BPM 软量化
- AI 词色
- 低帧率检测和性能参数
- `FOLIA_STYLES` 命中时直接跳过旧渲染

重要 API：

- `LyricMV.start()` / `stop()`
- `setStyle(style)`
- `setTune(t)`
- `setLowPower(on)`
- `step()`：后台节流时手动推进一帧
- `refreshLine()`
- `debug()`

### `public/js/folia-bridge.js`

Folia + PV Tool 统一桥：

- Pixi 运行时：Lumiere、Hanabi、Sonnet、Tempera
- React 原版组件：Tilt、Partita、Claddagh、Cadenza、Nebbia、Cappella、Still、Monet
- PV Tool iframe：春日、赛博、蛛网
- 把播放器数据转换为 Folia program / React props
- Shadow DOM 隔离
- 自动降级、低性能、副歌、间奏、PV 调色/FX

关键数据结构：

```js
RUNTIMES = {
  lumiere, hanabi, poem, tempera
}

DOM_RUNTIMES = {
  confess, cloud, fog, ring, cadenza, chat, cinema, monet
}

PV_STYLES = {
  pvharu:  { template: 17, maxChars: 8 },
  pvcyber: { template: 3,  maxChars: 9 },
  pvweb:   { template: 9,  maxChars: 12 }
}
```

关键函数：

- `build(track, lines, theme, key)`
- `buildDom(...)`
- `buildPv(...)`
- `sendPvInit()`
- `verifyStyle(style, lines)`
- `failStyle(style)`
- `makeTheme(theme)`
- `buildLines(lines, segments)`
- `renderDom(idx, th)`
- `setInstrumental(on)`
- `setLowPower(on)`
- `setPvFx(on)`

调试全局：

```js
window.__FoliaRT
window.__FoliaProgram
window.__FoliaStyle
window.__FoliaDom
```

### `public/css/style.css`

主要块：

- `.mv-layer` 基础布局
- `.mv-folia-host` / `.mv-grade` / `.mv-instrumental` / `.mv-transition`
- `.mv-vine` 流光藤蔓
- `.v-cols` / `.v-col` 纵向分栏
- 各旧样式 CSS
- 19 个样式卡缩略图 `.thumb-*`
- MV 模式下隐藏顶栏、弹幕、右侧队列、`np-bg`

### `public/vendor/folia`

Folia 本地原版资源：

- 提取自 `D:\folia\resources\app.asar`
- 约 26MB
- 包含 Pixi 运行时、React 组件、CSS 和 license
- `lumiere-entry.js`、`hanabi-entry.js`、`sonnet-entry.js`、`tempera-entry.js`
- `assets/noLyricLines-Dn3DI4dd.js` 被本地 patch 过，暴露 ReactDOM 工厂：
  - `window.__FoliaReactClientFactory`
  - `window.__FoliaCreateRoot`

### `public/vendor/pvtool`

PV Tool 试点构建产物：

- `embed.html`
- `assets/*`
- `LICENSE.txt`
- `NOTICE.txt`
- `README-LOCAL.txt`

PV Tool 源码研究副本在项目外：

```text
C:\Users\16493\Desktop\_research_pvtool\pv-tool-main
```

重建 PV Tool embed：

```bash
cd C:\Users\16493\Desktop\_research_pvtool\pv-tool-main
npx vite build --config vite.embed.config.ts
# 把 dist-embed/assets 和 embed.html 复制到 public/vendor/pvtool
```

### `scripts/package-app.js`

打包脚本：

- 排除 `backup`、`data`、`scripts`、`tmp`、`.zcode`
- 自动寻找本机 Electron 缓存 zip
- 输出 `dist/BiliPlayer-win32-x64`

---

## 4. 运行链路

### 4.1 样式切换

```text
点击样式卡
  -> setMVStyle(style)
  -> LyricMV.setStyle(style)
  -> LyricMV.setTune(App.mv.tune)
  -> FoliaBridge.setStyle(style)
  -> FoliaBridge.tick()
```

`lyricmv.js` 里：

```js
const FOLIA_STYLES = { lumiere, hanabi, poem, tempera, confess, cloud, ring, cadenza, fog, chat, cinema, monet, pvharu, pvcyber, pvweb }
```

命中 `FOLIA_STYLES` 后，旧 Canvas/DOM 歌词管线直接跳过，交给 `FoliaBridge`。

### 4.2 Folia Pixi 模式

```text
buildLines()
  -> 对应 program builder
  -> runtime.create()
  -> host canvas
```

- `lumiere`：`buildLumiereProgram`
- `hanabi`：`buildHanabiProgram`
- `poem`：`buildSonnetProgram`
- `tempera`：`buildTemperaProgram`

### 4.3 Folia React 模式

```text
ensureReact()
  -> import noLyricLines
  -> 调用 __FoliaReactClientFactory()
  -> 取 __FoliaCreateRoot
  -> import VisualizerXXX
  -> 在 host 内创建子 div + Shadow DOM
  -> createRoot(mount).render(component props)
```

Props 主要包括：

- `currentTime`：motion value
- `currentLineIndex`
- `lines`
- `theme`
- `audioPower` / `audioBands`
- `showText`
- `seed`
- `subtitle*`
- `sharedProps`

Shadow DOM 里加载：

```text
/vendor/folia/assets/src-U7FXIZ6e.css
```

### 4.4 PV Tool 模式

```text
buildPv()
  -> host 内创建 iframe
  -> /vendor/pvtool/embed.html
  -> postMessage:
       pvtool-init
       pvtool-time
       pvtool-lyrics
       pvtool-template
       pvtool-fx
```

PV Tool 侧 `src/embed.ts`：

- 初始化 `PVEngine`
- 加载模板
- 接收歌词、时间、BPM、能量、调色盘
- `seek()` 同步播放器时间
- 副歌时应用 `shake/zoom/tilt/glitch/beatReactivity`

PV 当前模板：

- 春日：17
- 赛博：3
- 蛛网：9

---

## 5. 主题、字体和美化

### 5.1 AI 主题

真实配置路径：

```text
%APPDATA%\BiliPlayer\ai_config.json
```

应用内数据：

- `App.mv.aiTheme`
- `App.mv.tone`：`dark` / `light`
- `App.mv.aiPalette`
- `App.mv.aiWordColors`

`makeTheme()` 输出 Folia theme：

- `primaryColor`
- `secondaryColor`
- `accentColor`
- `backgroundColor`
- `textColor`
- `fontStyle`
- `fontFamily`
- `animationIntensity`
- `wordColors`

### 5.2 字体

- 衬线：`Noto Serif SC`（系统已安装）
- 无衬线：`Microsoft YaHei`
- 不要传整段 CSS 字体栈，Folia 会再次拼接，可能变成无效字体并回退到 10px

### 5.3 Folia 统一调色层

`#mv-grade`：

- 四角暗角
- 上下轻微压暗
- 顶部主题色柔光
- 9 秒呼吸
- 亮色主题降低暗角

作用于 12 个 Folia 样式，不影响 PV Tool。

---

## 6. AI 分词、BPM 和电影化

### 6.1 AI 歌词分词

- 后端：`src/aitheme.js` + `/api/ai/segment`
- 前端：`App.mv.segments`
- 传递到 Folia：`buildLines(lines, segments)`
- 旧流光/纵向也使用分词结果

### 6.2 BPM

- 从音频 onset envelope 自相关 + phase 检测
- 置信度不足时回退
- 只影响词头落点，不改变歌词行时间轴
- Folia 通过 `bp-mv-chorus` 或 program 的 `isChorus` 使用段落信息

### 6.3 Shot / 段落

旧样式有：

- `buildParagraphs()`
- `paraOf` / `paraKind` / `paraStart`
- `applyShot()`
- `playParaTransition()`

Folia 模式主要使用原版 program 自带的 shot 系统。

---

## 7. AI 导演和段落切换

### 7.1 AI 导演

数据：

```js
App.mv.director
App.mv.directorTrack
App.mv.directorBase
App.mv.directorChorus
App.mv.sectionSwitch
App.mv.lastChorus
App.mv.sectionBusy
App.mv.pendingSection
App.mv.sectionCooldownUntil
```

逻辑：

- 根据 AI 主题情绪 + BPM + `App.mv.mood` 选择歌曲主样式
- 手动选择样式会关闭导演
- 每首歌只选一次，避免中途反复切换
- 副歌可切到“更强烈”的样式，再切回主样式

当前段落切换默认关闭，样式面板点「段落」开启。

### 7.2 遮罩保护

`#mv-transition`：

- 切样式前淡入
- 切完 1.05 秒后淡出
- 4.2 秒看门狗
- 12 秒副歌冷却
- 手动选样式会立即清除遮罩并取消切换

### 7.3 副歌强度

事件：

```js
bp-mv-chorus
```

- 旧流光/纵向由 `LyricMV` 发出
- Folia 由 `FoliaBridge` 根据 `builtLines.isChorus` 发出
- 页面加 `mv-chorus`
- 流光藤蔓增强、纵向等待列变亮、Folia 画面轻微亮度/饱和度提升
- PV Tool 接收 `pvtool-fx`，增强镜头冲击

---

## 8. 流光 / 纵向重设计

### 流光

- DOM 逐词
- `#mv-vine` Canvas 藤蔓
- 已唱词之间生成节点和曲线
- 上一句留淡色枝干
- 低频呼吸
- 参考 LyricalStudio GraphStream（MIT）的连续构图，但不是直接引入其运行时

可调参数：

```js
App.mv.tune.flowKeep      // 保留旧句 0-3
App.mv.tune.flowVine      // 藤蔓强度 0-2
App.mv.tune.flowPreview   // 整句预显
```

### 纵向

- `.v-cols` / `.v-col`
- 每列目标字数由 `App.mv.tune.vCols` 控制
- 当前列发光，等待列低亮
- 列距由 `vGap` 控制
- 等待列亮度由 `vWait` 控制

参数持久化：

```text
localStorage["bp.mvTune"]
```

---

## 9. 性能和降级

### 手动性能模式

样式面板「性能」：

- `App.mv.lowPower`
- `body.mv-low-power`
- Pixi/Folia renderScale 0.72
- DPR 上限 1
- 粒子 45%
- 关闭旧 GL、藤蔓、噪点

### 自动性能模式

- MV 启动 8 秒后检测
- 每 2 秒采样
- 连续 3 次低于 26 FPS 自动开启
- 手动关闭后本次运行不再自动开启

### Folia 自动降级

`verifyStyle()`：

- Pixi 检查 canvas 尺寸
- DOM 检查挂载节点
- 云阶额外检查文本
- 失败调用 `failStyle()`，切回流光并 Toast

注意：Cadenza 句间可能暂时没有文字，不能按单帧文本误判失败。

### 间奏

Folia 模式下，歌词为 `♪ 音乐 ♪` 时：

- `setInstrumental(true)`
- 显示 `#mv-instrumental`
- 中间呼吸 `♪`，周围飘浮音符
- 真实歌词恢复后自动隐藏

---

## 10. PV Tool 试点细节

### 当前状态

- 斩击已移除（用户觉得一般）
- 保留：春日、赛博、蛛网
- 每个模板独立 `maxChars` 避免长句裁切
- 主歌相机抖动为 0，避免一直抖动
- 副歌才启用轻微 shake/zoom/tilt/glitch

### 限制

- PV Tool 按行/短句变化，不是逐字时间轴
- 部分模板在间奏段可能只有背景
- 模板颜色部分硬编码，AI 主题只能部分覆盖
- 非商业许可

---

## 11. 已知问题 / 不要踩的坑

1. **Fume / Diorama 原版组件未跑通**
   - 挂载后文章排版返回空
   - 当前保留旧实现
   - 有内容检测，但只覆盖旧实现

2. **单实例锁导致“代码没更新”**
   - 打包/重启前必须关闭所有 `BiliPlayer.exe`
   - 否则旧 renderer 继续运行，看到的还是旧代码
   - 建议：
     ```bat
     taskkill /IM BiliPlayer.exe /F
     ```
   - 再启动新构建

3. **字体栈**
   - 只能传单一 `fontFamily`
   - 不要传 `"Font A", "Font B", serif`

4. **动画强度**
   - Folia 的 `animationIntensity` 只能归一化为 `calm / normal / intense`
   - AI 主题可能返回其他值，已在 `makeTheme()` 处理

5. **段落切换**
   - 目前仍是实验功能
   - 默认关闭
   - 尚未用真实副歌边界做长时间回归

6. **云阶/Partita**
   - 可能出现正文空、只剩背景
   - 已有文本检测、遮罩取消、兜底渐变、间奏层

7. **PV Tool**
   - 是外部 iframe，不是 Folia 的一部分
   - 样式切换要销毁 iframe，避免叠加
   - 许可证 Non-Commercial

---

## 12. 当前备份

与 MV/Folia/PV 相关：

```text
backup/folia-final-20261119
backup/folia-beautify-20261120
backup/redesign-vertical-flow-20261119
backup/pvtool-pilot-20261120
backup/pvtool-optimize-20261120
backup/pvtool-remove-slash-20261120
backup/cloud-instrumental-20261120
backup/folia-fume-diorama-nebbia-20261119
backup/folia-still-cinema-20261119
backup/folia-partita-20261119
backup/folia-cappella-20261119
backup/folia-chat-cappella-20261119
backup/folia-dom-runtimes-20261119
backup/folia-sonnet-20261119
backup/folia-tempera-20261119
```

打包目录：

```text
dist/BiliPlayer-win32-x64
```

运行端口：

```text
8899
```

---

## 13. 后续新增样式的方法

### 新增 Folia Pixi 模式

1. 在 `RUNTIMES` 增加 entry/runtime/builder/tuning
2. `app.js` 增加 `MV_STYLE_DEFS`
3. `lyricmv.js` 的 `STYLES` / `FOLIA_STYLES` 增加 id
4. CSS 的 Folia `:is(...)` 列表增加 `[data-style="id"]`
5. 增加 `.thumb-id`
6. 重新打包并测试

### 新增 Folia React 模式

1. 在 `DOM_RUNTIMES` 增加 visualizer entry
2. 同上 2–5
3. 注意组件需要的 props/tuning
4. Shadow DOM 内加载 Folia CSS

### 新增 PV Tool 模板

1. 在 `PV_STYLES` 增加 `{ template, maxChars }`
2. `app.js` 增加样式卡
3. `lyricmv.js` 的 `STYLES` / `FOLIA_STYLES` 增加 id
4. CSS `:is(...)` 和缩略图
5. 测试 iframe 加载、歌词、时间、切换清理

---

## 14. 快速测试清单

- [ ] 16/19 样式逐个切换
- [ ] 播放 / 暂停 / 拖动 / 切歌
- [ ] 真实 AI 主题暗色/亮色
- [ ] 云阶正文非空
- [ ] 间奏显示音符层
- [ ] 流光藤蔓不遮歌词
- [ ] 纵向列宽和字号
- [ ] Folia → PV → Folia 切换无残留
- [ ] 性能模式分辨率降低
- [ ] 关闭所有 BiliPlayer 后再重新打包

---

## 15. 许可证提醒

- Folia：AGPL-3.0，本目录为个人本地使用提取
- PV Tool：Non-Commercial License
- 不得把 `public/vendor/folia` 或 `public/vendor/pvtool` 作为闭源商业产品分发
- 商业分发前必须重新处理授权
