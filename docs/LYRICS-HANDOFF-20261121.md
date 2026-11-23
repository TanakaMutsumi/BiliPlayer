# 歌词模块交接日志

> 日期：2026-11-21  
> 项目：`C:\Users\16493\Desktop\b站音乐播放器`  
> 目的：在开始下一个板块前，完整记录歌词模块的架构、当前能力、数据格式、关键不变量、测试结果和已知问题。  
> 许可证前提：B 站/网易云/酷狗/QQ 都是私有 Web API；歌词版权归各权利方；Folia 为 AGPL-3.0，PV Tool 为 Non-Commercial；本模块仅个人本地使用。

---

## 1. 当前结论

歌词模块已经从“按标题搜一个 LRC”升级成完整闭环：

```text
多源找词
  → 多身份标题解析与搜索仲裁
  → 逐字/行级/纯音乐识别
  → 现场版 CC + 外部文本 DP
  → onset 自动对齐
  → 手动偏移 / 逐行 nudge / 打点插值 / 校准向导
  → 本地导入与手动编辑
  → 锁定源 / 逐行偏移 / 手动歌词独立持久化
  → MV 翻译/罗马音/假名 ruby
  → 诊断、备份、失败回退
```

当前打包版运行端口：`8899`。  
最近一次全量审计：9 个多源样本 0 失败；修复了 KRC 跨候选元数据合并、规范歌手名识别、Kugou 标签漏“翻译”三个问题。

---

## 2. 数据流

```text
Player.S.track (bvid/cid/nid/title/up/duration)
  ↓
loadLyricsIfNeeded()
  ↓
GET /api/lyrics
  ↓
Lyrics.resolve(track)
  ├─ B站本视频 CC
  ├─ NetEase LRC/YRC/tlyric/romalrc
  ├─ Kugou KRC (+ language + kana)
  ├─ AMLL TTML
  ├─ LRCLIB
  └─ B站 CC + 外部文本 DP → bili-cc-align
  ↓
候选打分 / 锁定源 / 自动选择
  ↓
decorate(): 对齐变换、全局偏移、逐行偏移、置信度、预览
  ↓
state.lyrics { key, cacheKey, baseLines, lines, ... }
  ↓
Folia / 流光 / 歌词列表 / MV 叠层 / 导出
```

---

## 3. 歌词来源

| 来源 | 能力 | 备注 |
|---|---|---|
| B 站本视频 CC | 行级、天然对应本视频 | 需登录；真实覆盖率有限，很多“字幕”是画面烧录 |
| B 站 CC + 外部文本 | `bili-cc-align`：CC 时间 + 外部正确文本 | 支持严格 DP 和“翻译 + 位置先验”宽松 DP |
| 网易云 LRC | 行级 + 翻译 + 罗马音 | `lrc/tlyric/romalrc` |
| 网易云 YRC | 逐字 | 有则优先 |
| 酷狗 KRC | 逐字 + `[language:]` 翻译/罗马音 + `[kana:]` 假名 | 部分候选只带其中一部分；日文歌会跨候选合并 |
| AMLL TTML | 逐字 + 翻译 + 罗马音 | 按 NCM ID；国内镜像 |
| LRCLIB | 行级开放兜底 | 非中文/英文歌常用 |
| 手动导入 | LRC 或纯文本 | 写入 override，优先级最高 |
| 手动编辑 | 改文本/拆分/合并/删除 | 保存为手动歌词 |

QQ QRC 尚未接入（需求已明确暂缓）。

---

## 4. 匹配与版本识别

### 4.1 标题/歌手解析

`searchIdentity()` / `searchIdentities()` 支持：

- 长宣传语 + `「歌名/中文名」` + `【歌手 巡演名】`
- `『A - B』`、`A - B`、`A -- B`、`A / B`
- 括号里是歌手，如 `Lemon【米津玄師】`
- `原声` / `原唱` / `伴奏` / `纯音乐` 不作为歌名
- `再演` 识别为 live
- 清理“画质/修复/4K/中日双字/动态鼓谱”等噪声

### 4.2 多身份与歌手证据

- 同一标题生成多组 `song / artist` 候选
- 搜索驱动打分：标题相似、歌手证据、时长、版本词
- NetEase `transNames/alias` 中文译名
- B 站视频标签补歌手证据（UP 不是歌手时）
- 歌手别名组（保守）：
  - 夜鹿 → ヨルシカ
  - 真夜中 → ずっと真夜中でいいのに。
  - 痛亲王 → Ado
  - 八爷 → 米津玄師
  - 胡子男 → Official髭男dism
  - 绿苹果 → Mrs. GREEN APPLE
  - 夜游 → YOASOBI 等
- 短英文别名只做精确匹配，避免 `Shadow` 误命中 `Ado`
- 规范名本身也能被别名系统识别（曾修复 `米津玄師` 无法 canonical 的问题）

### 4.3 纯音乐

- 识别 NetEase “纯音乐，请欣赏”占位
- 纯音乐候选也要通过标题/歌手/时长分数门槛，避免 LRCLIB 模糊匹配到无关伴奏就误判整首纯音乐
- UI 显示“纯音乐 / 间奏”，MV 可切纯音乐动态背景

---

## 5. 时间轴与现场版

### 5.1 逐字

- KRC/YRC/AMLL 的真实逐字直接进入 Folia `words[{startTime,endTime,text}]`
- 流光系使用真实 `line.words`，不再按字数平均
- `flowLineEnd` 不按字数砍掉真实逐词行尾
- 行级来源仍保留插值 + 分词 + BPM 量化回退

### 5.2 行级

- 行级 LRC 也会进入 Folia/流光，只是不是逐字
- `normalizeLines()` 统一时间、end、words、translation、romanization、kana

### 5.3 现场版自动对齐

- `maybeAlignLiveLyrics()`：视频 onset 包络与歌词行位置做 `(scale, offset)` 搜索
- 置信度低于 0.4 标记 `scale-offset-low`
- 对齐 + 手动偏移把全部歌词推到视频结束后，丢弃该次对齐
- 手动偏移存在时不再自动对齐

### 5.4 CC + 外部文本 DP

`alignTextToCc(ccLines, extLines)`：

- 严格通道：正文/翻译双通道，文本相似度 DP
- 宽松通道：严格失败时，用“翻译 + 位置先验”再对齐一次
  - 防误配：coverage ≥0.3，平均原始相似度 ≥0.08
- 匹配行使用 CC 时间；未匹配行用中位偏移插值
- 输出保留外部原文 + 翻译，删除 words（行级）
- 每行标 `ccMatched=true/false`
- 候选标 `ccCoverage`、`ccLoose`、`ccTranslated`

选择偏好：

- 锁定源优先
- 现场版或当前是纯 CC 时，如果 `ccLoose` 或 `ccTranslated`，优先 `bili-cc-align`
- 中文歌 CC 原文完整时不会被 cc-align 抢走（`ccTranslated=false`）

---

## 6. 手动校准与兜底

### 6.1 整首偏移

- 输入秒数 `90`、`1:30`、`-30`
- ±0.2s 按钮
- 范围 ±600s
- 以 `baseLines` 绝对计算，不会累积误差
- 本机 localStorage 优先，服务端串行写回

### 6.2 逐行

- 点选歌词行
- `行 −0.5s / 行 +0.5s / 行归零`
- `此后 −0.5s / +0.5s`：从选中行起全部后续行偏移
- 吸附节拍：按 `App.mv.bpmInfo.bpm/phase` 吸到最近节拍
- 偏移存 localStorage 优先，服务端兜底；清空有 tombstone 防止旧值回流

### 6.3 打点同步

- 空格/按钮给当前行打点
- 自动前进
- 撤销、点击行切目标
- 只打关键行，完成时相邻锚点按原歌词时间比例插值
- 插值等价于局部线性 `scale + offset`
- 锚点外保持原偏移
- 完成时提示“插值 N 行”
- 与整首偏移、逐行偏移叠加

### 6.4 校准向导

工具条“校准”打开三步：

1. 用本视频字幕时间（有 CC/cc-align 候选时可切换；未登录给登录入口）
2. 整体偏移（按音频估算，只给建议；可试听当前/建议）
3. 关键句打点（直接进入打点同步）

不会自动改时间轴；有 align 时可“取消自动对齐”。

### 6.5 自动估偏移

- 仅 B 站视频
- onset 包络搜索
- 弹窗显示建议 + 置信度
- “试听当前 / 试听建议 / 应用建议”

### 6.6 导入/编辑

- 导入 LRC：保留原时间轴
- 导入纯文本：按视频时长估算，导入后自动进入打点
- 手动编辑：
  - 改文本
  - 拆分（按光标，否则中点）
  - 合并下一行
  - 删除
- 保存为手动歌词，优先于在线源
- 导出：LRC、增强 LRC、SRT、ASS

---

## 7. UI / MV

### 7.1 歌词页

- 来源标签、逐字/行级徽标、翻译副行
- 未命中原因卡片：
  - `bili-auth` / `low-score` / `no-source` / `rate-limited` / `cid-failed` / `instrumental`
- 对应按钮：登录 B 站 / 换源 / 导入歌词 / 重新找 / 诊断
- 候选源：前两行预览、当前源排第一、锁定
- 诊断：来源/质量/对齐/偏移/缓存 key/候选分数/请求统计/MV 错误
- 置信度圆点：
  - 蓝：CC 直接匹配
  - 黄：CC 未覆盖，按偏移估算
  - 红：自动对齐低置信/未对齐
  - 可点击定位；支持“只看低置信”
- 歌词列表 ruby：KRC `word.kana` → `<ruby>漢字<rt>かな</rt></ruby>`

### 7.2 MV

- `#mv-subtitle` 统一翻译/罗马音叠层
- “译”“罗”独立开关，本地持久化
- 外观自定义可调 MV 字幕大小/高度
- 流光 DOM 支持 ruby
- Folia Canvas 不支持 ruby
- 纯音乐 MV：`body.mv-instrumental` + 动态背景/音符层
- Folia 失败：
  - FoliaBridge 7s `verifyStyle`
  - 8s 节点兜底 `body.mv-folia-failed`
  - 运行时错误捕获：`window.error` / `unhandledrejection`（只认 `/vendor/folia/`）、PV iframe、WebGL context lost、tick 异常
  - 失败后自动切回 `flow`，诊断显示 MV 错误

---

## 8. 持久化

| 内容 | 位置 | 说明 |
|---|---|---|
| 歌词缓存 | `data/lyrics` | 30 天；负缓存 5 分钟 |
| 搜索缓存 | `data/lyrics-search.json` | 1 小时 TTL；启动恢复；防抖 + 原子写 |
| 手动歌词 + 整首偏移 | `data/lyric-overrides` | 优先于在线源 |
| 锁定源 | `data/lyric-locks` | 清缓存/重新找仍保持 |
| 逐行偏移 | `data/lyric-line-offsets` | localStorage 优先，服务端兜底 |
| 整首偏移/逐行偏移本机 | localStorage | `bp.lyricOffset.<key>`、`bp.lyricLineOffsets.<key>`、`bp.lyricLineOffsetsCleared.<key>` |
| MV 字幕设置 | localStorage | `bp.mvSubtitle`、`bp.mvSubTrans`、`bp.mvSubRoma` |
| 外观 | localStorage | `bp.viz`，含 `mvSubSize` / `mvSubBottom` |

优先级：

```text
手动导入/编辑 > 锁定源 > 自动匹配
```

### 8.1 两套 key（重要）

- **客户端 key**：`bvid|cid` 或 `n<nid>` 或 `meta-...`
  - 用于 localStorage offset、逐行偏移、`state.lyrics.key`
- **服务端 cache key**：`bili-<bvid>-<cid>` / `ne-<nid>` / `meta-<hash>`
  - 用于 `data/lyrics`、override、lock、line-offsets 文件、`state.lyrics.cacheKey`
- 客户端保存逐行偏移到服务端时，必须用 `cacheKey`；本地仍用 `key`

不要混用，否则会出现“偏移保存了但重载不生效”。

---

## 9. API

| 路由 | 作用 |
|---|---|
| `GET /api/lyrics` | 解析/取缓存；返回 lines、candidates、reason、stats、lineOffsets 等 |
| `POST /api/lyrics/offset` | 保存整首偏移 |
| `POST /api/lyrics/align` | 保存/清除 scale-offset 对齐 |
| `POST /api/lyrics/choose` | 换源并锁定 |
| `POST /api/lyrics/clear` | 清缓存；`key` 为空时清全部 |
| `POST /api/lyrics/import` | 手动导入 LRC/纯文本 |
| `POST /api/lyrics/manual-lines` | 保存手动编辑后的行 |
| `POST /api/lyrics/override/clear` | 清手动歌词 |
| `POST /api/lyrics/lines` | 保存逐行偏移 |
| `POST /api/lyrics/lock/clear` | 清锁定源 |
| `GET /api/lyrics/backup` | 导出手动歌词/锁定/逐行偏移 |
| `POST /api/lyrics/restore` | 恢复备份 |

---

## 10. 关键文件与函数

### `src/lyrics.js`

- `parseLrc`、`parseYrc`、`parseKrc`、`parseTtml`
- `decodeKrc`
- `parseImportedText`
- `normalizeLines`
- `searchIdentity` / `searchIdentities`
- `canonicalArtist` / `artistEvidence`
- `neteaseSearch` / `neteaseLyric`
- `kugouSearch` / `kugouLyric` / `mergeKrcMeta`
- `amllLyric` / `lrclibLyric`
- `alignTextToCc`
- `applyOffset` / `applyTransform`
- `class Lyrics`
  - `resolve` / `decorate` / `score` / `label`
  - `choose` / `setOffset` / `setAlign`
  - `readOverride` / `writeOverride` / `importManual`
  - `saveManualLines`
  - `readLock` / `writeLock` / `clearLock`
  - `readLineOffsets` / `writeLineOffsets`
  - `readCache` / `writeCache` / `clearCache`
  - `exportManualData` / `importManualData`

### `public/js/app.js`

- `loadLyricsIfNeeded`：切歌/加载/缓存/本机偏移/逐行偏移/预取
- `lyricsBody`：歌词页 UI
- `lyricLineHtml` / `lineConfidence`
- `changeLyricOffset` / `applyLyricOffsetInput` / `resetLyricOffset`
- `changeLineOffset` / `shiftLineOffsetsFrom` / `snapLineToBeat`
- `tapSyncStart` / `tapSyncMark` / `tapSyncUndo` / `tapSyncDone`
- `estimateLyricOffset` / `previewLyricOffset`
- `openCalibrateWizard`
- `openLyricImport` / `importLyricText`
- `openLineEditor` / `saveLineEdit`
- `openLyricExport` / `downloadLyricFile`
- `backupLyricData` / `openLyricRestore` / `restoreLyricData`
- `openLyricDiagnostics` / `lyricDiagData`
- `restoreAutoLyrics` / `clearManualLyrics` / `reloadLyrics`
- `syncMVSubtitle` / `toggleMVSubtitle`

### `public/js/lyricmv.js`

- 流光/纵向/旧样式
- 真实 `line.words` → `.mv-word` / `.mv-char`
- 流光 ruby：`word.kana` → `.mv-ruby`
- `snapLineToBeat` 依赖的 BPM 数据在 `App.mv.bpmInfo`

### `public/js/folia-bridge.js`

- Folia Pixi/React/PV 运行时桥
- `buildLines` 把歌词转成 Folia 行/词
- `failStyle` / `verifyStyle` / `noteRuntimeError`
- `getLastError`
- Folia 错误捕获

### `server.js`

- 歌词所有 API 路由
- `lyricSvc = new Lyrics(DATA_DIR, bili, ne)`

---

## 11. 本轮全量审计

### 11.1 多源 API（9 样本，0 失败）

| 样本 | 结果 |
|---|---|
| 周杰伦《不能说的秘密》Live | `bili-cc` 43 行 |
| ヨルシカ《又三郎》Live | `bili-cc-align` 40 行，27 CC + 13 估算，翻译完整 |
| ヨルシカ《花に亡霊》Live | NetEase 54 行，翻译 + 罗马音，needs-align |
| ヨルシカ《嘘月》Live | Kugou 42 行逐字 |
| YOASOBI《夜に駆ける》 | AMLL 56 行逐字，翻译 + 罗马音 |
| Lemon | Kugou 51 行，翻译 51 + 罗马音 51 + 假名 68 |
| Shape of You | AMLL 85 行逐字，翻译 85 |
| 夏陰、ピアノを弾く | `instrumental` |
| 假标题 | `no-source` |

### 11.2 UI 实测

- 整首偏移 `10` → 首行 13.3→23.3；归零恢复
- 行 +0.5s → 500ms；行归零
- 此后 +0.5s → 只影响从选中行起的行
- 试听 → 跳到目标行前 1.2s
- 打点锚点 0 (+5s)、10 (+10s) → 第 1–9 行插值与公式完全一致
- 行拆分 1→2、合并 2→1、删除 43→42
- 锁定源清缓存仍保持；逐行偏移删 localStorage 后服务端回填
- 缺 cid 切歌无旧词残留
- 导入 LRC 2 行成功；导出 4 种格式弹窗正常
- 6 种原因卡片与按钮正常
- 备份/恢复 API 与诊断按钮正常

### 11.3 本轮修复

1. **KRC 跨候选元数据合并**
   - Lemon 候选 283818721：roma + kana，无 translation
   - 382052084：translation + kana，无 roma
   - 新增 `mergeKrcMeta()`，按行合并，Lemon 现在 51/51/68
2. **规范歌手名无法被别名系统识别**
   - `canonicalArtist` 只检查 `slice(1)`，导致 `米津玄師` 无法触发合并
   - 已改为检查组内全部名称
3. **Kugou 标签漏“翻译”**
   - `label()` 的 kugou 分支只加“假名”，没加 `tr`
   - 已补上，Lemon 标签：`酷狗歌词 · 米津玄師 · 逐字 · 翻译 · 假名`

---

## 12. 修改歌词模块时的不变量

1. **先备份再改**：`backup/<phase>-<date>`，至少包含 `app.js`、`lyrics.js`、`server.js`、`style.css`。
2. **不要混用客户端 key 和 cache key**：
   - localStorage/state 用 `key`
   - 服务端文件/offset/override/lock 用 `cacheKey`
3. **`loadLyricsIfNeeded` 的 cid 逻辑不能删**：
   - 缺 cid 时先清旧歌词
   - `ensureCid` 补全后自动重载
   - `onChange` 监听歌词身份
4. **`baseLines` 是渲染的绝对基准**：
   - 全局偏移/逐行偏移在 `recomputeLyricLines` 上叠加
   - 手动编辑保存的是 base lines，offset 单独存
5. **缓存清理语义**：
   - `重新找` 只清缓存，保留锁定/手动/逐行偏移
   - `恢复自动` 清手动、锁定、缓存、逐行偏移
6. **逐行偏移清空要写 tombstone**，否则重启会把服务端旧值拉回
7. **KRC 候选合并不能替换正文时间轴**，只补 translation/romanization/kana
8. **CC 优先规则**：只有 `ccLoose`/`ccTranslated` 才优先 cc-align，避免中文歌丢完整 CC 原文
9. **Folia 错误捕获只认 `/vendor/folia/`**，不要捕获主应用全部 error
10. **改完必须测**：
    - 至少 1 首 B 站 CC、1 首日文 KRC、1 首 NetEase、1 首 instrumental、1 个假标题
    - 切歌/快速切歌
    - 锁定 + 清缓存
    - 逐行偏移 + 重载
    - 打点插值
    - 19 个 MV 样式至少抽 3 个 Folia + 流光
11. **打包前关闭所有 `BiliPlayer.exe`**，否则单实例锁会继续跑旧 renderer。
12. **测试后清理**：
    - `%APPDATA%\BiliPlayer\lyric-overrides`
    - `lyric-locks`
    - `lyric-line-offsets`
    - 测试用 `lyrics-search.json` 条目
    - 不要把测试 offset/lock 留在用户数据里

---

## 13. 已知限制

- B 站 CC 需要登录；真实 CC 覆盖率有限，很多“中日双字”是画面烧录
- 自动 onset 对齐仍是实验性，密集编曲可能低置信
- 不是所有 KRC 候选都带翻译/罗马音/假名；跨候选合并只在同歌候选存在时生效
- 逐词置信度仍需要 ASR/强制对齐；当前是行级圆点
- Folia Canvas 不支持 ruby；流光和歌词列表支持
- Folia 8 秒兜底在真实运行中较少触发，主要由 7 秒 verify 处理
- QQ QRC 未接入
- 本地 ASR 未接入
- 搜索缓存统一 1 小时 TTL，未按 key 精准失效

---

## 14. 构建 / 测试 / 备份

### 构建

```bash
npm run dist
```

产物：`dist/BiliPlayer-win32-x64/BiliPlayer.exe`  
运行端口：`8899`

### 关键备份

- `backup/lyrics-phase1-20261120`
- `backup/pre-tapsync-interp-20261121`
- `backup/pre-lyric-switch-fix-20261121`
- `backup/pre-reason-ui-20261121`
- `backup/pre-lyric-import-20261121`
- `backup/pre-override-lock-20261121`
- `backup/pre-krc-lang-20261121`
- `backup/pre-mv-sub-toggles-20261121`
- `backup/pre-cc-trans-align-20261121`
- `backup/pre-kana-ruby-20261121`
- `backup/pre-p0p1-20261121`
- `backup/pre-search-cache-20261121`
- `backup/pre-flow-ruby-20261121`
- `backup/pre-folia-runtime-errors-20261121`
- `backup/audit-snapshot-20261121`

### 文档

- `docs/LYRICS-HANDOFF-20261121.md`（本文件）
- `docs/LYRICS-CONTEXT-COMPACT.md`（压缩上下文）
- `docs/LYRICS-ROADMAP-20261120.md`
- `docs/LYRICS-PIPELINE-RESEARCH-20261120.md`

---

## 15. 当前运行状态

- 打包版已启动，端口 `8899`
- 最近恢复的歌曲：《会心の一撃》，NetEase 35 行
- `lyric-locks` / `lyric-line-offsets` / `lyric-overrides` 均为空（审计后已清理）
- `lyrics-search.json` 保留正常搜索缓存
- 当前代码已包含本轮 KRC 合并/标签修复、搜索缓存、流光 ruby、节拍吸附、Folia 错误捕获

---

## 16. 下一个板块开始前的建议

1. 先把本文件作为歌词模块的“封板”文档，不再往歌词里加新功能，除非出现回归。
2. 下一个板块改动前，同样先建 `backup/pre-<板块>-<date>`。
3. 如果新板块会改 `app.js` / `server.js` / `style.css`，先 grep 本文件第 12 节的不变量，避免误伤歌词 key、缓存、偏移、MV 叠层。
4. 若新板块涉及播放器切歌/渲染时序，重点回归：
   - 缺 cid 切歌
   - 快速连切
   - 锁定源
   - 打点/逐行偏移持久化
