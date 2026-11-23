# 歌词模块压缩上下文

项目：`C:\Users\16493\Desktop\b站音乐播放器`  
当前运行：打包版端口 `8899`  
完整交接：`docs/LYRICS-HANDOFF-20261121.md`  
详细路线图/研究：`docs/LYRICS-ROADMAP-20261120.md`、`docs/LYRICS-PIPELINE-RESEARCH-20261120.md`

## 现状

歌词闭环已完成：多源找词 → 匹配 → 逐字/行级 → 现场对齐 → 手动校准 → 本地兜底 → MV。

来源：
- B 站本视频 CC
- B 站 CC + 外部文本 DP（`bili-cc-align`，支持严格/宽松 + 翻译匹配）
- 网易云 LRC/YRC/tlyric/romalrc
- 酷狗 KRC（逐字 + `[language:]` 翻译/罗马音 + `[kana:]` 假名）
- AMLL TTML
- LRCLIB
- 手动导入 LRC/纯文本
- 手动编辑（改文本/拆分/合并/删除）

QQ QRC 未接入；本地 ASR 未接入。

## 关键能力

- 标题多身份解析、别名歌手、B 站标签证据、时长/版本评分
- 逐字进 Folia/流光；行级插值
- 现场版 onset `(scale, offset)` 自动对齐，低置信标记
- CC DP：严格 + “翻译 + 位置先验”宽松；`ccMatched` 每行置信度
- 整首偏移 ±600s；逐行 nudge；此后偏移；节拍吸附
- 打点同步：关键锚点 + 自动插值
- 校准向导：CC → 整体偏移 → 打点
- 自动估偏移 + 试听当前/建议
- 手动导入/编辑；导出 LRC/增强 LRC/SRT/ASS
- 未命中原因卡片：登录/换源/导入/重试/诊断
- 候选预览/锁定/恢复自动
- 诊断：来源/质量/对齐/偏移/缓存 key/候选分数/请求耗时/MV 错误
- 置信度圆点：蓝 CC 匹配 / 黄 估算 / 红 低置信；可点击、只看低置信
- KRC ruby：歌词列表 + 流光；Folia Canvas 不支持
- MV 翻译/罗马音独立开关 + 字号/高度
- 纯音乐 MV 动态背景
- Folia 7s verify + 8s 节点兜底 + `/vendor/folia/` 运行时错误捕获

## 持久化

- `data/lyrics`：歌词缓存 30 天，负缓存 5 分钟
- `data/lyrics-search.json`：搜索缓存 1 小时，启动恢复
- `data/lyric-overrides`：手动歌词 + 整首偏移
- `data/lyric-locks`：锁定源
- `data/lyric-line-offsets`：逐行偏移
- localStorage：整首偏移/逐行偏移本机优先、MV 字幕设置、外观

优先级：`手动 > 锁定 > 自动`

**两套 key：**
- 客户端 `key`：`bvid|cid` / `n<nid>` / `meta-...`
- 服务端 `cacheKey`：`bili-<bvid>-<cid>` / `ne-<nid>` / `meta-<hash>`
- localStorage/state 用 `key`；服务端文件/offset/override/lock 用 `cacheKey`

## 关键文件

- `src/lyrics.js`：来源、解析、匹配、缓存、DP、KRC merge、override/lock/offset、备份
- `src/bilibili.js`：CC、视频详情、标签
- `server.js`：所有 `/api/lyrics/*`
- `public/js/app.js`：加载、UI、偏移、打点、校准、导入导出、置信度、MV 叠层
- `public/js/lyricmv.js`：流光/纵向/旧样式、真实 words、流光 ruby
- `public/js/folia-bridge.js`：Folia/PV 运行时、错误捕获、失败回退
- `public/css/style.css`：歌词工具条、原因卡、校准向导、ruby、置信度、MV 字幕

## 不变量（不要破坏）

1. 缺 cid 时 `loadLyricsIfNeeded` 先清旧词，`ensureCid` 后自动重载
2. `baseLines` 是绝对基准；全局偏移/逐行偏移在 `recomputeLyricLines` 叠加
3. `重新找` 只清缓存；`恢复自动` 清手动/锁定/缓存/逐行偏移
4. 清空逐行偏移必须写 localStorage tombstone
5. KRC 跨候选只合并 translation/romanization/kana，不替换正文时间轴
6. CC 只有 `ccLoose`/`ccTranslated` 才优先 cc-align，避免中文歌丢完整 CC 原文
7. Folia 错误捕获只认 `/vendor/folia/`
8. 打包前必须关闭所有 `BiliPlayer.exe`

## 最近审计结果

9 个样本 0 失败：
- 周杰伦 CC 43
- 又三郎 cc-align 40（27 CC + 13 估算）
- 花に亡霊 NetEase 54（翻译+罗马音，needs-align）
- 嘘月 Kugou 42 逐字
- 夜に駆ける AMLL 56（翻译+罗马音）
- Lemon Kugou 51（翻译 51 + 罗马音 51 + 假名 68）
- Shape of You AMLL 85（翻译 85）
- 夏陰、ピアノを弾く instrumental
- 假标题 no-source

本轮修复：
- KRC 跨候选元数据合并（Lemon 以前只有 roma，没 translation）
- 规范歌手名无法被别名系统识别（米津玄師）
- Kugou 标签漏“翻译”

## 已知限制

- B 站 CC 需登录；真实 CC 覆盖有限，很多“字幕”是烧录
- onset 自动对齐实验性，密集编曲可能低置信
- 不是所有 KRC 候选都有翻译/罗马音/假名
- 逐词置信度仍需 ASR/强制对齐
- Folia Canvas 不支持 ruby
- QQ QRC、本地 ASR 未接入
- 搜索缓存统一 1h TTL，未精准失效

## 构建/备份

- 打包：`npm run dist`
- 运行：`dist/BiliPlayer-win32-x64/BiliPlayer.exe`，端口 `8899`
- 审计快照：`backup/audit-snapshot-20261121`
- 最近代码备份：`backup/pre-search-cache-20261121`、`pre-flow-ruby-20261121`、`pre-folia-runtime-errors-20261121`

## 当前状态

- 打包版运行中
- 当前歌曲：《会心の一撃》，NetEase 35 行
- `lyric-locks` / `lyric-line-offsets` / `lyric-overrides` 为空
- `lyrics-search.json` 保留正常搜索缓存
