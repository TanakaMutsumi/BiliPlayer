# 歌词获取、纠错与现场版对齐 · 调研与实施方案

> 日期：2026-11-20  
> 项目：`C:\Users\16493\Desktop\b站音乐播放器`  
> 目标：解决 B 站歌曲“没歌词 / 歌词错 / 时间轴对不上（尤其现场版）”的问题，并让动态 MV 拿到可靠的逐词时间轴。  
> 结论先行：**不需要从零“生成歌词”。中文/日文歌曲的逐字歌词在网易云、QQ、酷狗、AMLL 里大量存在；先把多源歌词找对、匹配对、解析对，现场版再用“版本专属歌词 → B 站本视频字幕 → 缩放+偏移拟合 → 本地 ASR 对齐 → 手动校准”逐级兜底。**  
> 交接日志：`docs/LYRICS-HANDOFF-20261121.md`（压缩版：`docs/LYRICS-CONTEXT-COMPACT.md`）

---

## 1. 结论摘要

### 1.1 当前链路的真实问题

| 问题 | 现状 | 后果 |
|---|---|---|
| B 站字幕依赖登录 | 本地 `data/cookies.json` 只有 `buvid3/buvid4`，没有 `SESSDATA`；实测 `x/player/wbi/v2` 直接返回“账号未登录” | “本视频 B 站 AI 字幕”这条路实际不可用 |
| 网易云只取了旧 LRC | 代码请求 `/api/song/lyric?id=...&lv=1&tv=-1`，只读 `lrc.lyric` | 丢掉了 `yrc`（逐字）、`tlyric`（翻译）、`romalrc`（罗马音） |
| 匹配只看标题+时长 | `neteaseLyrics(title, duration)` 不接收歌手；客户端传了 `artist`，服务端 `server.js` 没用 | 同名不同歌手、live/翻唱/remix 容易拿错 |
| 标题清洗把 Live 删了 | `_titleToKeyword()` 明确删除 `现场版|Live` | 现场版视频会去匹配录音室 LRC，时间轴必然对不上 |
| 时间轴校正只有整体偏移 | `syncLyricTimeline()` 只搜 `offset`，不搜速度/结构 | 现场版 tempo 不同、段落延长时无效 |
| 无逐字时间源 | 所有逐词时间都是按字数/权重插值 + AI 分词 + BPM 量化 | 歌词动画“卡点”只能近似，达不到 Folia 原版的逐字感 |
| 无按歌曲持久缓存 | 只有 1 小时内存缓存；`_subCache` 无上限 | 每次切歌重新搜，风控/延迟/结果不稳定 |
| 无手动校准 | 没有 offset、逐行 nudge、点按同步、换源 | 匹配错了用户只能忍着 |

### 1.2 推荐路线

```text
歌曲身份解析（标题/歌手/版本/时长）
  -> 多源歌词候选（B站CC / 网易云 / QQ / 酷狗 / AMLL / LRCLIB）
  -> 版本感知匹配打分（歌名+歌手+版本+时长+来源质量）
  -> 统一解析为 lines + words + translation
  -> 按歌曲持久缓存 + 手动换源/偏移
  -> 动态 MV 优先使用真实逐词时间，缺失时才回退插值
```

现场版单独走一条链路：

```text
识别 live/cover/remix/instrumental
  -> 1. 找该现场版本的专属 LRC（网易云/QQ/酷狗现场专辑）
  -> 2. 有 B 站本视频 CC 字幕：用它的时间轴（必要时把外部正确文本对齐到 CC）
  -> 3. 没有专属 LRC：用 (scale, offset) 拟合现场音频的 onset/chroma
  -> 4. 仍不可靠：本地 ASR（SenseVoice）+ 已知歌词 DP 对齐
  -> 5. 最终兜底：手动 tap-to-sync / 逐行 nudge
```

**优先级原则：真实存在的逐字歌词 > 本视频字幕时间 > 音频对齐 > ASR 生成 > 手动。**  
不要一上来就用 AI“生成歌词”：歌唱 ASR 的文本错误率远高于“找到正确文本 + 对齐时间”。

---

## 2. 现有代码链路（精确位置）

### 2.1 请求入口

- `server.js:224-226`：`/api/subtitle?bvid&cid` → `bili.subtitles()`
- `server.js:262-293`：`/api/nlyric?id&title&artist&dur` → `songDetail` → `bili.neteaseLyrics()` → `bili.lrclibLyrics()`
- `public/js/app.js:2237-2280`：`loadLyricsIfNeeded()`
  - B 站曲目：`Api.get('subtitle', { bvid, cid })`
  - 网易云曲目：`Api.get('nlyric', { id, title, artist, dur })`
  - 结果写入 `state.lyrics = { key, lines, loading, sourceLabel }`

### 2.2 B 站字幕

- `src/bilibili.js:453-462`：10 分钟内存缓存
- `src/bilibili.js:464-482`：`_fetchSubLines()`
  - `x/player/wbi/v2`，WBI 签名
  - 优先 `ai-zh`，其次 `zh`，否则第一个
  - 字幕 JSON：`body[].from / to / content`
  - **只有行级时间，没有逐字**
- `src/bilibili.js:499-553`：`_subtitlesInner()` 兜底链
  1. 本视频字幕
  2. 用清洗标题搜 B 站同名视频，借字幕（时长差 `< max(20, dur*0.3)`）
  3. 网易云 LRC
  4. LRCLIB
- `src/bilibili.js:484-497`：`_titleToKeyword()` 删除 `现场版|Live|完整版|官方MV...`

**实测（2026-11-20，本机）：**
- `data/cookies.json` 键：`buvid3, buvid4`，无 `SESSDATA`
- `videoDetail()` 对公开视频正常
- `_fetchSubLines()` 对音乐区排行视频全部报“账号未登录”
- 结论：**B 站字幕路径需要先登录；当前实际主要靠网易云/LRCLIB 兜底。**

### 2.3 网易云 / LRCLIB

- `src/bilibili.js:555-583`：`neteaseLyrics(title, durationSec)`
  - 搜索：`https://music.163.com/api/search/get/web?s=...&type=1&limit=8`
  - 只按 `duration` 选最优，公差 ±40s
  - 歌词：`https://music.163.com/api/song/lyric?id=...&lv=1&tv=-1`
  - 只读 `lj.lrc.lyric`；`tlyric` 被丢弃
  - 返回 `refDuration`
- `src/bilibili.js:585-612`：`lrclibLyrics()`
  - `/api/search?track_name=&artist_name=`
  - 只读 `syncedLyrics`
  - 标题按第一个空格拆 track/artist，`米津玄師 Lemon` 这类会拆错
- `src/bilibili.js:60-91`：`parseLrc()`
  - 支持一行多时间戳
  - **不解析 `[offset:]`**
  - **不剥离 enhanced LRC 的 `<mm:ss.xx>` 词标签**
  - 不接受 `tlyric/romalrc/yrc`
  - `end` 用下一行推算，长间奏按字数收紧

### 2.4 客户端校正与使用

- `public/js/app.js:2185-2236`：`syncLyricTimeline()`
  - 用视频 onset 包络，在候选 offset 上打分
  - 候选：`0`、`videoDur-refDur`、`diff/2`，再 ±3s 精修
  - **只做整体偏移，不做 tempo 缩放，不做段落对齐**
  - 重写行对象时只保留 `{t,end,text}`，会丢掉新增字段
- `public/js/app.js:2259-2264`：只有 B 站曲目、来源不是“本视频”时才校正；网易云曲目（`nid`）完全跳过
- `public/js/lyricmv.js:1005-1173`：flow 系逐词时间 = 分词 + 权重 + `quantizeBeatTime`
- `public/js/lyricmv.js:1224-1281`：普通 DOM 样式逐字时间 = 字符权重顺序分配
- `public/js/folia-bridge.js:158-208`：Folia lines
  - 有 AI 分词就用 `segments[i]`
  - 否则 `Intl.Segmenter` 或逐字
  - 每词时长 = 行时长 × 字数占比
  - **没有任何真实逐词时间**

### 2.5 现有辅助能力

- `public/js/app.js:302-343`：AI 分词（只决定“切在哪”，不决定时间）
- `public/js/app.js:344-372`：BPM 检测，只微调词头落点
- `public/js/app.js:3945-4050`：版本识别、标题/歌手解析、标题相似度（可直接复用到歌词匹配）
- `public/js/app.js:4777-4855`：`detectBpm()` / `chromaOf()`，已有 chroma/onset 基础
- `public/js/folia-bridge.js:605-614`：间奏 overlay 只在歌词行文本等于 `♪ 音乐 ♪` 时显示；**没有代码生成这一行**

---

## 3. 歌词来源全景（实测/调研）

### 3.1 总表

| 来源 | 提供 | 时间粒度 | 鉴权/限制 | 中国大陆 | 结论 |
|---|---|---|---|---|---|
| **B 站本视频 CC/AI 字幕** | 该视频的歌词/语音转写 | 行级 `from/to` | 需登录 `SESSDATA`；`subtitle_url` 是签名 CDN，会过期 | 是 | **现场版最佳时间锚点**；文本质量看视频 |
| B 站视频简介 | 常见完整歌词文本 | 无 | 公开 | 是 | 纯文本兜底；需自行对齐 |
| B 站弹幕 | 常出现歌词行 + 时间 | 行级但噪声大 | 公开 | 是 | 最后兜底；需过滤/去重 |
| **网易云 LRC** | 歌词文本 | 行级 | 公开 web 接口，无需登录 | 是 | 覆盖最广，首选文本源 |
| **网易云 YRC** | 逐字歌词 | 词/字级 | 同一接口 `yv=-1` | 是 | 有则直接用；覆盖率中等 |
| 网易云 `tlyric/romalrc` | 翻译/罗马音 | 行级 | 同一接口 | 是 | 直接补齐，当前被丢弃 |
| **QQ QRC** | 逐字歌词 + 翻译/罗马音 | 词/字级 | 私有接口，自定义 DES | 是 | 样本覆盖最强；解密/合规成本高 |
| **酷狗 KRC** | 逐字歌词 + 翻译/罗马音/假名 | 词/字级 | 公开搜索/下载，accesskey 约 2h 过期 | 是 | 解码简单（XOR+zlib），性价比高 |
| **AMLL TTML DB** | 高质量逐字 TTML + 翻译 | 词/字级 | 按 NCM/QQ ID 取文件；有国内镜像 | 是 | 质量天花板；无官方搜索 API |
| **LRCLIB** | LRC / plain | 行级 | 无需 key，需 UA | 是 | 开放兜底，适合非中文 |
| 酷我 | LRC | 行级 | 公开接口 | 是 | 中文补充；逐字接口未公开 |
| 咪咕 | 旧接口失效 | — | — | 不稳定 | 不建议直连 |
| Genius / Musixmatch | 文本 / richsync | 无 / 词级 | 授权/被墙 | 否 | 不适合 |
| Uta-Net / PetitLyrics / Joysound | 日文文本 / 内部逐字 | 无 / 字级 | 无公开 API，条款禁止抓取 | 是 | 不做直连 |
| LiriQo | 聚合 11 家 | 混合 | 无 SLA，法律不清 | 是 | 只适合原型验证，不做依赖 |

### 3.2 实测样例（2026-11-20）

**网易云 YRC（`アイドル`，NCM 2048982668）**
- `/api/song/lyric/v1?id=2048982668&lv=-1&tv=-1&rv=-1&yv=-1`
- 返回 `lrc/tlyric/romalrc/yrc/ytlrc`
- YRC 90 行，格式：
  ```text
  [630,2610](630,390,0)Couldn't (1020,240,0)beat (1260,90,0)her ...
  ```
- `ytlrc` 有逐行翻译
- 结论：**网易云一个接口就能同时拿到 LRC + YRC + 翻译 + 罗马音**，当前代码只用了最旧的那一路。

**酷狗 KRC（`Lemon`）**
- 搜索：`https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=Lemon 米津玄師&duration=255000`
- 下载：`https://lyrics.kugou.com/download?...&fmt=krc&charset=utf8`
- 解码：base64 → 去掉 `krc1` 4 字节 → XOR `@Gaw^2tGQ61-ÞÒni` → zlib inflate
- 55 行，格式：
  ```text
  [889,1527]<0,551,0>夢<551,368,0>な<919,153,0>ら...
  ```
- 带 `[language:base64...]` 翻译/罗马音
- 结论：**解码简单，适合作为第二逐字源。**

**AMLL TTML（NCM 2048982668）**
- `https://amll-ttml-db.stevexmh.net/ncm/2048982668`
- `https://amll-ttml-db.gbclstudio.cn/ncm-lyrics/2048982668.ttml`
- 结构：
  ```xml
  <p begin="00:00.686" end="00:03.110">
    <span begin="00:00.686" end="00:01.020">Couldn't</span>
    <span begin="00:01.020" end="00:01.193"> beat</span>
    ...
    <span ttm:role="x-translation" xml:lang="zh-CN">她露出笑容...</span>
  </p>
  ```
- 结论：**有 NCM/QQ ID 时优先取 TTML；质量最高，解析也不难。**

**LRCLIB**
- `/api/get?track_name=Lemon&artist_name=Yonezu%20Kenshi&duration=255` 返回 `syncedLyrics`
- 行级；`hasWordSync` 多数只是“一行一个 word”，不要当逐字用
- 结论：**开放兜底，但不要拿 search 第一条硬套，必须按时长/艺人精确匹配。**

### 3.3 B 站字幕的关键限制

- `x/player/wbi/v2` 的 `subtitle.subtitles[]` 在未登录时为空；本机实测直接报“账号未登录”
- 登录后还要注意 `subtitle_url` 是带 `auth_key` 的签名地址，**只能缓存解析后的内容，不能缓存 URL**
- B 站 AI 字幕是“语音识别”模型，唱歌的识别错误率不低，但**时间轴是对这个视频的**，所以对现场版特别有价值
- 音乐区大量视频没有 CC 字幕；不能把它当主源，只能当“本视频时间锚点”

---

## 4. 时间轴格式与统一模型

### 4.1 格式对照

| 格式 | 粒度 | 结构 | 来源 |
|---|---|---|---|
| LRC | 行 | `[mm:ss.xx]text` | 通用 |
| Enhanced LRC | 词 | `[mm:ss.xx]<mm:ss.xx>word...` | 部分播放器/LDDC 导出 |
| YRC | 词/字 | `[行起,行时长](词起,词长,0)词` | 网易云 |
| KRC | 词/字 | `[行起,行时长]<词偏移,词长,0>词` | 酷狗 |
| QRC | 词/字 | XML 内 `[行起,行时长]词(词起,词长)` | QQ |
| TTML/AMLL | 词/字 | `<p begin end><span begin end>词</span>` | AMLL/Apple Music |
| SRT/VTT | 行 | cue 起止 | B 站 CC、ASR |
| LRCLIB Lyricsfile | 行/词数组 | `lines[].words[]` | LRCLIB |

### 4.2 统一数据模型（建议）

```js
{
  source: 'bili-cc' | 'netease' | 'qq' | 'kugou' | 'amll' | 'lrclib' | 'asr' | 'manual',
  quality: 'word' | 'line' | 'plain',
  lines: [{
    t: 12.34,
    end: 16.78,
    text: '完整一行',
    translation: '中文翻译',       // 可选
    romanization: '罗马音',        // 可选
    words: [                       // 可选；有就优先
      { text: 'Couldn', t: 12.34, end: 12.68 },
      { text: "'t",     t: 12.68, end: 12.80 }
    ],
    confidence: 0.92               // 可选
  }],
  meta: {
    title, artist, album, duration,
    version: 'studio' | 'live' | 'cover' | 'remix' | 'instrumental',
    language: 'zh' | 'ja' | 'en' | ...
  },
  alignment: {
    method: 'native' | 'cc' | 'scale-offset' | 'asr-dp' | 'manual',
    confidence: 0.8,
    refDuration: 255.0
  },
  offsetMs: 0,                     // 用户校准
  fetchedAt: 1760000000000
}
```

**关键约束：**
- `lines` 的 `t` 必须升序；`words` 必须单调不减。
- `words[].text` 拼接应尽量还原 `line.text`（允许空白差异）。
- 所有新增字段必须能穿过 `syncLyricTimeline`（现在会丢字段，需要改成展开合并）。
- Folia 的 `{startTime,endTime,fullText,words,isChorus,songPart}` 是 vendor 运行时契约，**不要在 bridge 之外改字段名**。

---

## 5. 匹配算法（决定“找得对不对”）

### 5.1 可复用的现有代码

`public/js/app.js` 的版本宇宙已经写了很好的解析器：
- `coreSongCandidates(title, artistHint)`：`《》`/引号/分段/歌名+歌手组合
- `VERSION_RULES`：live/mv/cover/inst/remix/pure/remaster
- `classifyVersion()`：录音室/官方 vs 其他
- `titleSim()`：包含 + bigram Jaccard + 英文词 Jaccard

**建议把这套逻辑抽到共享模块**（服务端也需要），不要重新写一套。

### 5.2 归一化

- NFKC 全半角统一
- 小写化、去多余空格
- 标点统一（`，`→`,`, `（`→`(`, `’`→`'`）
- 可选繁→简（网易云/QQ 常见繁体）
- 版本词单独提取，**不要直接删掉**：
  - `live / 现场 / 演唱会 / 音乐节 / concert / unplugged`
  - `cover / 翻唱 / 歌ってみた`
  - `instrumental / 伴奏 / off vocal / karaoke / 纯音乐`
  - `remix / 混音 / 8d`
  - `tv size / short / full / ver.`
- `inst` 视为不同曲目，不能拿伴奏 LRC 配人声视频

### 5.3 歌手解析

B 站曲目没有可靠 `artist` 字段，标题/UP/简介都可能含歌手：
- 优先从标题分段解析（复用 `coreSongCandidates`）
- UP 名含歌手 token 时作为证据（`米津玄師`、`YOASOBI`、`Official`）
- 简介里的 `原唱/原曲/作曲/演唱` 可作为补充
- 网易云曲目直接用 `song.artists[].name`
- 歌手比较用集合重叠，不要求完全相等；允许 `feat./&/、/,` 多歌手

### 5.4 时长

| 场景 | 公差 | 说明 |
|---|---|---|
| 录音室/官方 | ±3s 最佳，±8s 可接受 | 同录音不同剪辑 |
| Live | ±10~20s | 前奏/掌声/讲话会拉长 |
| Cover | ±10s | 编曲不同 |
| 伴奏/纯音乐 | ±5s | 不能与人声版混用 |

时长不是唯一证据：现场版可能只差 2s，但结构完全不同。必须结合版本词 + 首行/末行时间 + 音频相似度。

### 5.5 打分建议

```text
score =
  0.40 * 标题相似度
+ 0.20 * 歌手匹配
+ 0.15 * 时长匹配
+ 0.15 * 版本标记匹配（live 对 live，studio 对 studio）
+ 0.10 * 来源可靠度（word 源 > line 源 > plain 源）
```

规则：
- 标题必须达到最低相似度（如 0.55），否则直接淘汰。
- 版本标记冲突（live vs studio、inst vs vocal）直接降权/淘汰。
- 前两名分差 < 0.08 时不自动选，返回候选让用户点。
- 结果里保留 `candidates[]`，UI 可“换源”。

### 5.6 缓存键

```text
B站：bili:<bvid>:<cid>
网易云：ne:<nid>
跨源兜底：meta:<normalizedTitle>:<normalizedArtist>:<round(duration/2)>
```

缓存内容：最终选择 + 候选摘要 + 用户 offset + 用户手动换源。  
TTL：30 天；标题/时长变化则失效。  
路径：`<dataDir>/lyrics/<safeKey>.json`（打包后就是 `%APPDATA%\BiliPlayer\lyrics`）。

---

## 6. 现场版对齐方案（重点）

### 6.1 先判断“是不是现场版”

不要只看标题。组合信号：
- 标题/简介/tag：`live/现场/演唱会/音乐节/巡演/concert`
- 时长明显长于录音室（前奏/掌声/MC）
- B 站分区/标签：音乐现场（tid=29）
- 音频：开头/结尾有掌声、环境噪声（可选）
- 版本宇宙里已经分类出的 `live` 组

### 6.2 分级策略

#### Tier 1：找“这个现场版本”的专属 LRC（最优先）

- 网易云搜索：`歌名 + Live/现场/演唱会`，用时长 ±15s 过滤
- QQ/酷狗搜索同一版本；酷狗 KRC 常有 live/演唱会版
- AMLL 的 live TTML 较少，但有就最好
- 成功条件：标题版本词匹配 + 时长接近 + 首行时间合理
- 优点：文本和时间都是人做的，质量最高

#### Tier 2：B 站本视频 CC 字幕（有登录时）

- 本视频字幕的时间轴天然对应该现场
- 如果字幕文本是 AI 识别、有错字：
  - 用外部正确歌词文本与 CC 字幕做 **DP 对齐**（字符/拼音相似度）
  - 保留 CC 的时间，替换成正确文本
- 如果字幕只有部分段落：用字幕锚点 + 外部 LRC 插值
- 注意：`subtitle_url` 会过期，缓存解析结果

#### Tier 3：(scale, offset) 拟合（不下载模型）

当前 `syncLyricTimeline` 只搜 offset。升级为：

```text
target_t = ref_t * scale + offset
scale ∈ [0.85, 1.15]（围绕 videoDur/refDur）
offset ∈ [-10, +10]s
```

用视频 onset 包络打分：
- 对每个候选 `(scale, offset)`，把 LRC 行起点映射到视频时间
- 在 onset 包络上取均值/峰值
- 先粗搜（scale 步长 0.01，offset 步长 0.5s），再细搜
- 置信度：相对 `(1,0)` 的改善、覆盖行数、映射后行时长合理性

适用：同一首歌、同一结构、只是整体变快/变慢/前奏变长。  
不适用：加长间奏、改段落、串烧、完全不同编曲。

#### Tier 4：本地 ASR + 已知歌词 DP 对齐（重武器）

流程：
1. 解码当前视频音频为 16kHz mono
2. SenseVoice（sherpa-onnx）识别，拿到 token + 时间戳
3. 把已知歌词归一化成字符/词序列
4. Needleman-Wunsch / DP 对齐：
   - 匹配：字符相同或拼音/罗马音相近
   - 不匹配：惩罚
   - ASR 多出的字（ad-lib/错听）：gap，低成本
5. 每行取第一个/最后一个匹配 token 的时间
6. 没匹配上的行：用相邻锚点按字数插值
7. 置信度 = 匹配字符数 / 总字符数；低于阈值标红，交给手动

优点：不需要录音室参考音频；文本用正确的歌词，ASR 只提供时间。  
缺点：模型 228MB、首次下载、CPU 一首歌约 20–60s、歌唱识别仍可能错。

#### Tier 5：手动校准（永远保留）

- 全局 offset 滑块（±5s，10ms 步进）
- 逐行 nudge（±500ms）
- “从这一行起全部偏移”
- tap-to-sync：播放时按空格给每行打点，自动插值
- 按歌曲持久化
- 导出 LRC / enhanced LRC

### 6.3 为什么不建议“纯音频 DTW 把录音室 LRC 搬到现场”

技术上可行（chroma/HPCP + subsequence DTW），但需要**同时拿到录音室参考音频**，且现场改段落/加长间奏/串烧时 DTW 会跳错。  
可以作为 Tier 3.5 的可选增强：  
- 版本宇宙已经能找录音室版本 → 下载其音频 → chroma DTW → 映射 LRC  
- 但优先级低于“现场专属 LRC”和“本视频 CC”，高于纯 ASR  
- 纯 JS 可实现（FFT + chroma + DTW），4 分钟歌约 1–3 秒 CPU；但工程量大，建议 Phase 3 再考虑。

### 6.4 对齐质量自动检查

每首歌算一遍，存进缓存：

- 覆盖率：匹配字符 / 总字符，行级目标 ≥0.8
- 单调性：`t[i+1] >= t[i]` 必须 100%
- 行时长：中位数/p95；<0.4s 或 >20s 标红
- 行重叠率：<2%
- 字速：CJK 1–12 字/秒，超出标红
- 间隙：>20s 且不是间奏则标红
- 首行时间：不应早于 0 或晚于 60s（除非前奏很长）
- 交叉验证：`(scale,offset)` 结果与 ASR 锚点中位差 >0.5s 则降置信
- 音频相似度：DTW 路径平均 chroma 相似度 <0.7 则拒绝自动搬运

UI 用绿/黄/红标置信度；红色行点一下直接跳到校准。

---

## 7. 本地 ASR / 强制对齐选型

### 7.1 推荐排序

| 方案 | 许可 | Windows/Node | 中文歌唱 | 时间戳 | 体积 | 结论 |
|---|---|---|---|---|---|---|
| **sherpa-onnx + SenseVoice int8** | Apache-2.0 运行时 | `sherpa-onnx-node` 原生 addon，win-x64 约 24MB | 较好（zh/ja/ko/en/yue） | token 时间戳 | 模型 228MB | **首选**；CPU 可跑，无需 Python |
| whisper.cpp large-v3-turbo q5 | MIT | 独立 `whisper-cli.exe`，spawn | 中等 | word/token | 547MB | 可选高质量包；比 SenseVoice 慢 |
| faster-whisper / WhisperX / stable-ts | MIT/BSD | 需要 Python/PyTorch | 中等 | word | 数 GB | 不打包；可做离线验证工具 |
| aeneas | AGPL-3.0 | Python，2017 | **不支持中文** | 行级 | 小 | 不采用 |
| Montreal Forced Aligner | MIT | Kaldi/conda | 普通话模型有 | 音素/词 | 数百 MB | 太重，朗读模型不适合唱 |
| Charsiu | MIT | Python/PyTorch | 普通话 | 音素/词 | 小 | 实验性，不打包 |
| MMS aligner | CC-BY-NC | Python | 多语言 | 词 | ~1.2GB | 非商用 + 太大 |
| auto-lrc | Apache-2.0 | Python CLI | zh/ja/ko/en | 词级 enhanced LRC | 中 | **算法参考**（phoneme posterior + DTW） |
| CTCLRC | AGPL-3.0 | Windows EXE | 日语为主 | 行级 | 大 | 验证基线，不集成 |

### 7.2 为什么不直接用用户现在的 AI

本机真实配置：
- `baseUrl: https://xiaohhrouter.xyz/v1`
- `model: deepseek-v4.1-flash`
- 这是**文本模型**，没有音频转写能力

所以：
- 可以继续用它做分词、主题、候选排序
- **不能**用它“听”音频生成时间轴
- 云端 ASR 需要另配 provider（阿里 Paraformer/火山/OpenAI 等）

### 7.3 云端 ASR（可选，不默认）

| 服务 | 中文 | 词级时间 | 大陆 | 成本 |
|---|---|---|---|---|
| 阿里 DashScope Paraformer v2 | 强 | 是 | 原生 | ¥0.288/小时，10 小时/月免费 |
| 火山引擎 ASR | 强 | 是（utterances.words） | 原生 | 按小时 |
| OpenAI whisper-1 | 中 | 是（verbose_json） | 需海外网络/卡 | $0.006/分钟 |
| Groq whisper-large-v3-turbo | 中 | 需确认 | 需海外 | 便宜 |
| Deepgram/AssemblyAI | 中 | 是 | 需海外 | 按分钟 |

建议：**本地优先，云端只在用户明确开启时按首歌调用**；不要把 API key 写进代码。

### 7.4 人声分离（可选增强）

- Demucs htdemucs：质量好，CPU 约 1.5× 时长；代码 MIT，权重许可不明确
- demucs.cpp：C++/GGML，81MB 模型，适合打包
- SCNet int8：45MB，MIT 权重（`@audio/neural-separate`）
- 作用：ASR 前去掉伴奏，显著提升识别/对齐
- 建议：只对“ASR 置信度低”的歌曲按需跑，不作为默认步骤

### 7.5 预期效果（要管理预期）

- 录音室 + 已有逐字歌词：接近完美
- 录音室 + 只有 LRC：行级准确，逐字仍是插值
- 现场 + 专属 LRC：好
- 现场 + 本视频 CC：时间准，文本可能需修
- 现场 + ASR：行级可用，逐字有 0.2–0.6s 误差；必须给手动校准
- 强混响/美声/合唱/串烧：不要承诺全自动

---

## 8. 推荐架构

### 8.1 服务端

新增 `src/lyrics/`：

```text
src/lyrics/
  index.js          # 编排：身份解析 → 候选 → 打分 → 选择 → 缓存
  match.js          # 标题/歌手/版本/时长归一化与打分
  cache.js          # <dataDir>/lyrics/*.json
  parsers/
    lrc.js          # LRC + enhanced LRC + [offset]
    yrc.js          # 网易云 YRC
    krc.js          # 酷狗 KRC（含解码）
    qrc.js          # QQ QRC（含自定义 DES；Phase 1.5）
    ttml.js         # AMLL TTML
    normalize.js    # 统一 lines/words/translation
  providers/
    bilibili.js     # 复用现有 Bilibili 客户端取 CC
    netease.js      # search + /api/song/lyric/v1
    kugou.js        # search + download + decode
    qq.js           # search + musicu + QRC（Phase 1.5）
    amll.js         # 按 NCM/QQ ID 取 TTML（镜像）
    lrclib.js       # /api/get + /api/search
```

服务端路由：

```text
GET /api/lyrics?bvid=&cid=&nid=&title=&artist=&duration=
  -> { lines, words?, translation?, source, quality, alignment, candidates, offsetMs }

GET /api/lyrics/candidates?...   # 返回候选列表，供“换源”
POST /api/lyrics/offset           # 保存用户 offset
POST /api/lyrics/choose           # 保存用户手动选择的 source
```

兼容：
- 保留 `/api/subtitle`、`/api/nlyric`，内部转调新编排器；旧客户端不崩。
- `server.js` 现有 1 小时缓存保留，作为 L1；L2 是磁盘缓存。

### 8.2 客户端

`loadLyricsIfNeeded()`：
- 统一调 `/api/lyrics`
- 写入 `state.lyrics = { key, lines, source, quality, alignment, offsetMs, loading }`
- 应用 `offsetMs` 后再交给 UI/MV
- 只对“外部来源 + 时间轴可疑”的曲目做自动校正；有逐字/本视频字幕时跳过

`LyricMV` / `FoliaBridge`：
- `line.words` 存在时直接用；否则走现有插值
- `folia-bridge.js:buildLines()` 增加：
  ```js
  const words = Array.isArray(line.words) && line.words.length
    ? line.words.map(w => ({ text: w.text, startTime: w.t, endTime: w.end }))
    : fallbackWords(...)
  ```
- 旧 flow 样式在 `buildFlowLine()` 里增加“真实 word 时间”分支；没有就保持现状
- 不改 Folia vendor 字段名

UI：
- 歌词页来源行：`歌词来源：网易云 · 逐字` / `B站本视频字幕 · 已对齐`
- 质量徽标：`逐字` / `行级` / `纯文本`
- 按钮：`换源`、`校准`、`重新对齐`
- 校准面板：offset 滑块、逐行 nudge、tap-to-sync、恢复默认
- 失败提示：区分“未登录 B 站”“无歌词源”“只有纯文本”“现场版时间轴不确定”

### 8.3 缓存

```text
<dataDir>/lyrics/<key>.json
{
  chosen: { source, quality, fetchedAt, lines, meta, alignment },
  candidates: [ { source, score, quality, duration, title, artist } ],
  offsetMs: 0,
  manualSource: null
}
```

- 歌词文本可以缓存；**不要缓存 B 站签名 URL**
- 网易云/QQ/酷狗 ID 可缓存；accesskey 不缓存
- 版本/时长变化时失效
- 提供“清空歌词缓存”按钮

---

## 9. 分阶段实施

### Phase 0：修复明显断点（小改动，先做）

1. B 站字幕失败不要静默：识别 `-101/账号未登录`，在歌词页提示“登录 B 站可获取本视频字幕”。
2. `neteaseLyrics` 接收 `artist`，搜索时带上歌手；服务端 `/api/nlyric` 把 `artist` 传下去。
3. 换成 `/api/song/lyric/v1?...&yv=-1&rv=-1`，同时读 `lrc/tlyric/romalrc/yrc`。
4. `parseLrc` 支持 `[offset:]`、enhanced LRC 词标签、跳过 JSON credits。
5. `syncLyricTimeline` 重写行对象时保留新增字段（`{...l, t, end}`）。
6. `_titleToKeyword` 不再无条件删除 `Live/现场`；版本词交给匹配器。

### Phase 1：多源 + 逐字 + 缓存 + 手动校准（推荐先做）

1. 新增 `src/lyrics/` 编排器与解析器。
2. 接入：网易云（LRC/YRC/翻译/罗马音）、酷狗 KRC、AMLL TTML、LRCLIB。
3. 版本感知匹配 + 候选打分 + “换源”UI。
4. 磁盘缓存 + offset 持久化。
5. Folia / flow 支持真实 `line.words`。
6. 基础校准：全局 offset + 逐行 nudge。
7. 间奏/纯音乐：track 级 `instrumental` 标记；Folia 无歌词时也能显示背景 + `♪ 音乐 ♪`。

### Phase 2：现场版对齐 + 本地 ASR（重武器）

1. live/cover/remix 检测 + 版本专属 LRC 搜索（Phase 1 已部分覆盖）。
2. B 站本视频 CC 的时间锚定；外部文本 DP 对齐到 CC。
3. `(scale, offset)` 拟合替换纯 offset。
4. 可选下载 SenseVoice 模型；worker/utilityProcess 跑 ASR；DP 对齐；置信度。
5. tap-to-sync 编辑器。
6. 失败降级：ASR 不可用 → scale/offset → 手动。

### Phase 3：增强

1. QQ QRC（自定义 DES）作为逐字源。
2. 录音室 vs 现场 chroma DTW（可选）。
3. 翻译/罗马音在 MV 中显示（Folia subtitle props / 旧样式副行）。
4. 云端 ASR（阿里 Paraformer）按需开启。
5. 歌词导出 LRC/enhanced LRC/SRT。
6. 候选源质量统计与自动优选。

---

## 10. 测试与回归

### 10.1 样本集

至少覆盖：

- 中文流行：有 LRC、有 YRC、只有纯文本、无歌词
- 日文/动画：`アイドル`、`Lemon`、`紅蓮華`、`千本桜`
- 英文：有 LRCLIB、无歌词
- 现场版：官方 live 专辑、B 站演唱会片段、带掌声/MC 的版本
- 翻唱/伴奏/纯音乐：确保不拿错版本
- 超长前奏/间奏、短版/TV size、串烧

### 10.2 每首检查

- 来源、质量（word/line/plain）
- 行数、逐字数、翻译/罗马音
- 首行/末行时间 vs 视频时长
- 单调性、重叠、字速
- 动态 MV 19 个样式是否正常（至少 flow/vertical/poem/cloud/chat/hanabi/pvharu）
- 暂停/拖动/切歌/换源后时间轴是否正确
- 缓存命中、offset 持久化
- B 站未登录/登录两种状态

### 10.3 性能

- 歌词解析 <50ms
- 多源搜索并发但限速（网易云/酷狗各 ≤3 req/s；B 站 ≤1 req/s）
- 磁盘缓存命中 <10ms
- `(scale,offset)` 拟合 <2s
- ASR 后台跑，不阻塞播放；显示进度

---

## 11. 风险与许可证

- **B 站接口**：私有 Web API；文档项目已于 2026-01 因律师函关闭；仅个人本地使用，不要随应用分发接口说明/抓取结果。
- **网易云/QQ/酷狗**：私有接口；歌词有版权；QQ QRC/KRC 解密可能涉及技术保护措施；个人使用，不公开分发歌词库/解密产物。
- **AMLL TTML DB**：仓库声明 CC0，但歌词本身仍受版权保护；AMLL 解析库是 AGPL-3.0；建议自己写轻量 TTML 解析，避免把 AGPL 代码并入分发。
- **LRCLIB**：代码 MIT，数据许可未明确；个人使用 + 标注来源。
- **本地 ASR 模型**：SenseVoice 权重有单独模型许可；sherpa-onnx 运行时 Apache-2.0；分发前读模型卡。
- **PV Tool**：Non-Commercial；与本模块无关，但不要在商业版里混用。
- **QQ QRC 解密**：如果未来要分发，先处理合规；自用可做。

---

## 12. 参考链接

### 歌词源 / 解析

- 网易云歌词 v1：`https://music.163.com/api/song/lyric/v1?id=<id>&lv=-1&tv=-1&rv=-1&yv=-1`
- 酷狗搜索：`https://krcs.kugou.com/search?ver=1&man=yes&client=mobi&keyword=<kw>&duration=<ms>`
- 酷狗下载：`https://lyrics.kugou.com/download?ver=1&client=pc&id=<id>&accesskey=<key>&fmt=krc&charset=utf8`
- AMLL TTML DB：https://github.com/amll-dev/amll-ttml-db
- AMLL 国内镜像：`https://amll-ttml-db.stevexmh.net/ncm/<NCM_ID>`、`https://amll-ttml-db.gbclstudio.cn/ncm-lyrics/<NCM_ID>.ttml`
- LRCLIB：https://lrclib.net/docs
- LDDC（QQ/酷狗/网易云/酷狗解析参考，GPL-3.0）：https://github.com/chenmozhijin/LDDC
- Lyricify Lyrics Helper（匹配/解析参考，Apache-2.0）：https://github.com/WXRIW/Lyricify-Lyrics-Helper
- 163MusicLyrics（匹配参考，Apache-2.0）：https://github.com/jitwxs/163MusicLyrics
- QQMusicDecoder：https://github.com/WXRIW/QQMusicDecoder

### ASR / 对齐

- sherpa-onnx：https://github.com/k2-fsa/sherpa-onnx
- sherpa-onnx-node：https://www.npmjs.com/package/sherpa-onnx-node
- SenseVoice：https://github.com/FunAudioLLM/SenseVoice
- whisper.cpp：https://github.com/ggml-org/whisper.cpp
- faster-whisper：https://github.com/SYSTRAN/faster-whisper
- WhisperX：https://github.com/m-bain/whisperX
- stable-ts：https://github.com/jianfch/stable-ts
- auto-lrc（CJK 歌唱对齐参考，Apache-2.0）：https://github.com/liu-xiaoran/auto-lrc
- CTCLRC（Windows 已知歌词→LRC 验证工具）：https://github.com/Kdroidwin/CTCLRC
- aeneas：https://github.com/readbeyond/aeneas
- MFA：https://github.com/MontrealCorpusTools/Montreal-Forced-Aligner
- MMS aligner：https://docs.pytorch.org/audio/stable/generated/torchaudio.pipelines.MMS_FA.html
- Demucs：https://github.com/adefossez/demucs
- demucs.cpp：https://github.com/sevagh/demucs.cpp
- librosa DTW：https://librosa.org/doc/0.11.0/generated/librosa.sequence.dtw.html

### B 站字幕

- player API 文档镜像：https://cdn.jsdelivr.net/gh/pskdje/bilibili-API-collect@master/docs/video/player.md
- bilibili-subtitle（读取字幕示例）：https://github.com/IndieKKY/bilibili-subtitle

### 研究

- Stoller 2019：https://arxiv.org/abs/1902.06797
- Durand 2023：https://arxiv.org/abs/2306.07744
- Mandarin ALT 2023：https://arxiv.org/abs/2311.12488
- 实时古典演唱对齐 2024：https://arxiv.org/abs/2401.09200
- 参考表演跟踪 2021：https://arxiv.org/abs/2107.14496
- 源分离提升歌词对齐 2025：https://arxiv.org/abs/2506.15514

---

## 13. 一句话建议

**先把“找歌词”做扎实：多源、版本感知、逐字优先、缓存和手动校准；现场版先用“专属 LRC + B 站本视频字幕 + scale/offset”，把本地 ASR 作为可选重武器，而不是第一选择。**

---

## 14. Phase 0 + Phase 1 已落地（2026-11-20）

### 14.1 代码改动

| 文件 | 改动 |
|---|---|
| `src/lyrics.js`（新增） | 多源编排器：LRC/增强 LRC/YRC/KRC/TTML 解析；网易云、酷狗、AMLL、LRCLIB、B站本视频字幕；标题/歌手/版本/时长匹配；磁盘缓存；offset |
| `src/bilibili.js` | 新增 `ownSubtitle()`；字幕接口 `-101` 时返回 `authRequired: true`，不再静默 |
| `server.js` | 新增 `/api/lyrics`、`/api/lyrics/offset`、`/api/lyrics/clear`；保留旧 `/api/subtitle`、`/api/nlyric` 兼容 |
| `public/js/app.js` | `loadLyricsIfNeeded` 优先走 `/api/lyrics`，旧接口兜底；歌词页显示来源/逐字徽标/翻译/偏移按钮；`changeLyricOffset`、`resetLyricOffset`、`reloadLyrics`；FoliaBridge 增加 `getLyricKey` |
| `public/js/lyricmv.js` | flow 系样式优先使用真实 `line.words`；`flowLineEnd` 不再按字数砍掉真实逐词行尾 |
| `public/js/folia-bridge.js` | `buildLines` 优先使用真实 `line.words`；build key 纳入歌词来源/质量/偏移 |
| `public/css/style.css` | `.nt-tools` / `.nt-badge` / `.nt-off` / `.nt-trans` / `.nt-warn` |
| `public/js/app.js`（Phase 2） | 新增 `alignLyricTimeline()`：在视频 onset 包络上搜索 `t -> t*scale+offset`；`maybeAlignLiveLyrics()` 自动跑一次；`cancelLyricAlign()` 可撤销；低置信显示“低置信” |
| `src/lyrics.js` / `server.js`（Phase 2） | 缓存 `align:{scale,offset,confidence}`；`/api/lyrics/align` 保存/清除；`decorate` 先应用对齐再应用用户 offset；按视频时长裁掉越界行 |
| `src/lyrics.js` / `server.js` / `app.js`（Phase 3） | 缓存 `candidateData`（含完整 lines）；`/api/lyrics/choose`；歌词页“换源”弹窗，显示来源/歌名/歌手/逐字/时长/当前源 |
| `src/lyrics.js`（标题解析修复） | 支持“长句宣传语 +「歌名/中文名」+【歌手 巡演名】”；引号是巡演/专辑名时不抢歌名；补 `再演` 为 live 版本词 |
| `src/lyrics.js`（批量稳健性） | 多身份候选 + 搜索驱动仲裁；NetEase `transNames/alias` 中文别名；B 站标签补充歌手证据；纯音乐占位识别；NetEase 登录 Cookie 风控时自动退匿名通道；搜索/歌词超时与查询预算 |
| `src/bilibili.js` | `videoDetail` 增加视频标签 `tags`（歌手/版本证据） |
| `public/js/app.js` / `src/lyrics.js`（手动偏移） | 歌词页支持输入秒数或 `分:秒` 直接跳转；范围 ±600s；用 `baseLines` 绝对偏移，先 `-30s` 再 `+90s` 不会丢时间；服务端持久化 |
| `public/js/app.js`（偏移持久化修复） | 偏移本机 localStorage 优先读取；服务端写入串行化，避免快速操作时旧请求后到覆盖新值；切歌/重开先从本机恢复，再回写服务端 |
| `public/js/app.js` / `src/lyrics.js`（滚动与越界保护） | 歌词容器内 `scrollIntoView({behavior:'smooth'})` 在 Electron 下会失效，改为直接计算 `scrollTop`；手动偏移存在时不再自动对齐；对齐+偏移把整段歌词推到视频结束之后时丢弃该次对齐；全部越界时显示提示 |
| `public/js/app.js`（逐行 nudge） | 点选歌词行后可单独 `行−0.5s / 行+0.5s / 行归零`；与整首偏移叠加；`lineOffsets` 存 localStorage，切歌/重开保留；Folia build key 纳入 lineOffsets |
| `public/js/app.js`（自动估偏移） | 用视频 onset 包络搜索整首建议 offset；弹窗确认后应用；低置信提示；不直接改用户时间轴 |
| `public/js/app.js` / `folia-bridge.js`（MV 翻译） | 新增 `#mv-subtitle` 统一叠层：当前行翻译 + 罗马音，作用于 Folia/流光/PV；MV 工具条“译”/“罗”分别控制翻译和罗马音；关闭 Folia 内置字幕避免重复 |
| `public/js/app.js` / `lyricmv.js` / `style.css`（纯音乐 MV） | `body.mv-instrumental`：隐藏空 Folia host，显示旧动态背景/粒子/暗角 + `♪ 音乐 ♪`；`LyricMV.resize()` 修正画布尺寸；切回普通歌曲自动恢复 |
| `src/lyrics.js`（CC + 外部文本） | `alignTextToCc()`：本视频 CC 行级时间 + 外部歌词文本做 DP 匹配；同时比较正文和 `translation`，严格匹配失败时用“翻译 + 位置先验”宽松通道；匹配行用 CC 时间，未匹配行中位偏移插值；现场版/CC 当前源且 `ccLoose`/`ccTranslated` 时优先选 `bili-cc-align`，避免中文歌丢掉完整 CC 原文 |
| `public/js/app.js`（tap-to-sync） | 打点模式：播放到每句开头按空格或“打点”，把该行钉到当前时间；支持撤销/完成；点击歌词行可切换目标；完成后相邻锚点之间按原歌词时间比例自动插值（局部线性 scale+offset），范围外保持原偏移；与整首偏移、逐行偏移、localStorage 持久化兼容 |
| `public/js/app.js`（切歌歌词串台修复） | 歌词身份纳入 `cid`：B 站条目先只有 `bvid`，补到 `cid` 后再次加载；缺 `cid` 时先清空上一首并显示加载态，通过 `Player.ensureCid()` 补全后自动继续；`onChange` 监听歌词身份变化，不再依赖手动“重新找” |
| `src/lyrics.js` / `public/js/app.js`（未命中原因） | 新增 `no-source` / `low-score` / `rate-limited` / `bili-auth` / `cid-failed` / `instrumental` 原因码；歌词页按原因显示说明和“登录 B 站 / 换源 / 重新找 / 诊断”按钮；诊断面板显示中文原因、候选数、最高分 |
| `src/lyrics.js`（纯音乐误判） | 纯音乐候选也要通过标题/歌手/时长分数门槛，避免 LRCLIB 模糊搜索到无关伴奏就把整首歌判成纯音乐 |
| `src/lyrics.js` / `server.js` / `public/js/app.js`（手动导入） | `parseImportedText()` 支持 LRC 和纯文本；LRC 保留时间轴，纯文本按视频时长均匀估算；写入 `data/lyric-overrides/<key>.json`，resolve 时优先返回；整首偏移同步写回 override，清缓存不丢 |
| `public/js/app.js`（导出） | 歌词页新增“导出”：LRC、增强 LRC（逐字 `<mm:ss.xx>`）、SRT、ASS；时间戳用整数厘秒/毫秒归一，正确处理 59.999s 进位 |
| `public/js/app.js` / `style.css`（校准向导） | 新增 `openCalibrateWizard()`：三步展示 CC 字幕时间、整体偏移、关键句打点；状态包括已完成/可操作/未登录/无 CC；支持切换 CC、估算偏移、归零、开始打点、取消自动对齐；只提供入口，不自动改时间轴 |
| `src/lyrics.js` / `server.js` / `public/js/app.js`（锁定持久化） | `choose()` 同时写 `data/lyric-locks/<key>.json`；fresh resolve 时按 source/id/quality 重新选中锁定候选；`clearCache` 不动锁定；“恢复自动匹配”显式清锁 |
| `src/lyrics.js` / `server.js` / `public/js/app.js`（逐行偏移持久化） | 逐行偏移写 `data/lyric-line-offsets/<key>.json`；`/api/lyrics/lines` 保存；`decorate` 返回服务端偏移；客户端 localStorage 优先、服务端兜底；清空写 tombstone 防旧值回流；旧本地偏移首次加载自动迁移 |
| `src/lyrics.js`（KRC 翻译/罗马音） | 解析酷狗 `[language:]` base64 JSON，按原始 KRC 行号把 `lyricContent` 贴回歌词行；按文字脚本判断 CJK 比例 ≥25% 记 `translation`，否则记 `romanization`；过滤制作名单后仍不会错位；日文歌缺项时再取一个候选，按行合并翻译/罗马音/假名 |
| `src/lyrics.js` / `public/js/app.js` / `style.css`（KRC 假名 ruby） | 解析 `[kana:]` 的“假名(开始ms,时长ms)”流，按 `1/2` 分组取最后一段读音，再按 KRC word 时间全局分配给最近的含汉字词（`word.kana`）；`normalizeLines`、服务端偏移/缩放、客户端逐行偏移都保留 kana；歌词列表用 `<ruby>漢字<rt>かな</rt></ruby>` 显示 |
| `src/lyrics.js` / `public/js/app.js` / `style.css`（行级置信度） | `bili-cc-align` 给每行标 `ccMatched=true/false`；`scale-offset-low`/`needs-align` 给行标 `confidence='low'`；客户端显示蓝/黄/红圆点 + 图例 + title 说明；圆点可点击定位，支持只看低置信 |
| `public/js/app.js`（试听/编辑/备份） | 试听当前/建议偏移；行文本编辑/拆分/合并/删除，保存为手动歌词；“此后 ±0.5s”从选中行起统一偏移；手动歌词、锁定源、逐行偏移一键备份/恢复 JSON；诊断显示缓存命中、总耗时、各源耗时 |
| `src/lyrics.js`（匹配/解释/假名回退） | 歌手别名组参与 `searchIdentities` 和 `artistEvidence`；候选记录标题/歌手/时长/版本四项分数；日文歌酷狗优先尝试带 `[kana:]` 的候选，标签加“假名” |
| `public/js/app.js` / `style.css`（MV 字幕设置） | `--mv-sub-size` / `--mv-sub-bottom` 进入外观自定义滑杆，可调 MV 翻译/罗马音字号和高度 |
| `src/lyrics.js`（搜索缓存） | NetEase/酷狗搜索缓存防抖写入 `data/lyrics-search.json`，启动时按 1 小时 TTL 恢复；`rateBlocked` 单独存储，避免重载后丢失风控状态 |
| `public/js/lyricmv.js` / `style.css`（流光 ruby） | 真实 word 带 `kana` 时，流光的 `.mv-word` 内用 `<ruby><rt>` 渲染假名；Folia Canvas 不支持 ruby |
| `public/js/app.js` / `style.css`（节拍吸附/Folia 兜底） | “吸附节拍”按 `bpmInfo.bpm/phase` 把当前行吸到最近节拍；Folia 渲染器 8 秒内无 canvas/子节点时加 `body.mv-folia-failed`，回退渐变背景并提示 |
| `public/js/folia-bridge.js`（运行时错误捕获） | `window.error` / `unhandledrejection` 只捕获 `/vendor/folia/` 来源；PV iframe 的 error/rejection、WebGL context lost、tick 异常都会写入 `lastError` 并触发 `onRuntimeError` + `onFailure`；诊断面板显示 MV 错误 |
| `public/js/app.js`（诊断面板） | “诊断”弹窗：歌曲/来源/质量/对齐参数/偏移/逐行偏移数/缓存 key/候选分数；支持复制诊断、清缓存重试 |
| `src/lyrics.js` / `public/js/app.js`（候选预览/锁定） | 候选返回前 2 行预览；选择源后写入 `locked`，切歌/重开保持；来源行显示“已锁定”；“恢复自动匹配”清缓存重搜 |

### 14.2 实测结果

| 测试曲 | 结果 |
|---|---|
| `晴天` 周杰伦 | 酷狗 KRC，51 行，逐字 |
| `Lemon` 米津玄師 | AMLL TTML，54 行，逐字 + 翻译 |
| `花に亡霊` ヨルシカ（网易云） | 网易云 YRC，43 行，逐字 + 翻译 |
| `嘘月` ヨルシカ（B 站现场，291s） | 酷狗 KRC，42 行，逐字；时长匹配 |
| `Susan说` 陶喆（B 站 Live'06，321s） | 网易云现场 YRC，38 行，逐字；标记“现场版待校准” |
| `Lemon【米津玄師】动态鼓谱`（257s） | 修复“括号里是歌手”的识别后：AMLL 54 行逐字 + 翻译 |
| `Lemon 2025 TOUR`（300s） | 酷狗 54 行逐字；时长差 24s，标记“现场版待校准” |
| 合成 onset（已知 scale=1.05, offset=8） | 恢复 scale 1.05 / offset 8 / confidence 0.89；随机 onset 被拒绝 |
| `Susan说` 真实音频自动对齐（321s vs 174s） | scale 1.122 / offset 157.03 / confidence 0.32（低置信），首行 157s，31 行；显示“低置信”并可取消对齐恢复 38 行 |
| `Lemon` 换源 | 5 个候选（AMLL/网易云 YRC/酷狗/网易云 LRC/LRCLIB）；切到酷狗 51 行逐字，刷新后仍保持 |
| `"我已别无所求..."「憂一乗/仅有忧伤」【ヨルシカ 月光·再演】` | 从长句宣传语 + 双语引号标题中提取 `憂一乗 / ヨルシカ`，命中酷狗 58 行逐字 |
| `【𝟒𝐊𝟔𝟎帧】爆弾魔 - ヨルシカ 2025「盗作 再演」LIVE` | 识别出引号是巡演名，不抢歌名；解析为 `爆弾魔 / ヨルシカ` |
| `【洛天依原创】为什么夏天总是属于离别` | 括号“洛天依原创”清洗为歌手“洛天依”，命中网易云 70 行 |
| `「原声」もうじき夏が終わるから --n-buna &初音ミク` | “原声”不再当歌名；`--` 正确分隔，命中酷狗 32 行逐字 |
| `『ヨルシカ -败犬不需要安可』2024前世 Live` | NetEase `transNames` 匹配日文原名，命中网易云 46 行 |
| `夜鹿《花に亡霊》2024现场`（UP 不是歌手） | B 站标签含 `ヨルシカ`，歌手证据成立，命中网易云 43 行逐字 |
| 纯音乐 / 钢琴小段（3 首） | NetEase 占位“纯音乐，请欣赏”识别为 `instrumental`，界面显示纯音乐/间奏 |
| 队列 49 首批量回归（最终） | **49/49 无失败**：46 首有歌词（30 逐字 + 16 行级），3 首纯音乐；平均 1.0s，最慢 2.9s |
| 手动偏移输入 | `90` → 首行 90.73s；`-30` → -29.27s；`1:30` → 90.73s；`归零` → 0.73s；重载后仍保持 90.0s |
| 偏移切歌恢复 | 本地 90s、服务端被强制改成 180s → 切走再切回，恢复 90s 并回写服务端 90s |
| 逐行 nudge | 第 6 行 31.63s → `行+0.5s` 后 32.13s；整首 +90s 后 122.13s；行归零后 121.63s；切走再回来仍保留 0.5s |
| 自动估偏移 | 合成起音整体后移 20s → 建议 `+20.0s`（置信度 35%）；应用后首行 20.697s，归零恢复 0.697s |
| MV 翻译/罗马音 | `花に亡霊` 在 Monet / Chat / Lumiere / 流光下均显示“或许你已经忘记了吧 + romaji”，Folia 内置字幕不重复；“译”/“罗”可独立隐藏翻译或罗马音，两者都关时叠层隐藏 |
| MV 字幕开关 | 注入同时含 translation/romanization 的行：双开显示两行；关“译”只剩 romaji；关“罗”后 `show=false`；再开“译”只剩中文；按钮 active 态与状态一致 |
| 纯音乐 MV | `夏陰、ピアノを弾く` + 绘光：Folia host 隐藏、动态背景显示 1052×632、`♪ 音乐` 层显示；切回 `花に亡霊` 后 host 恢复、背景/音符层隐藏 |
| CC + 外部文本 DP | 合成 CC 三行时间 10/12/20s → 外部同文本时间 1/4/7s，对齐后恢复 10/12/20s；拆分/多余行覆盖 0.63 仍可用 |
| CC 候选优先 | 伪造 `Lemon` CC（外部歌词整体 +5s）→ 选中 `bili-cc-align`，首行 5.273s，标签“B站字幕时间 · 外部歌词 · 翻译” |
| 真实 CC 覆盖 | 8 首队列现场版（ヨルシカ LIVE 2024/2025）里只有 1 首有本视频 CC；其余 7 首标题写“中日双字”但字幕是烧录进画面的，`authRequired=false` 仍读不到 CC |
| CC 中文翻译 + 日文原文 | `又三郎` LIVE：CC 是中文翻译，Kugou 外部是日文 + 中文翻译；正文直接匹配 coverage<0.22，宽松通道 coverage 0.65 / 27 对，生成并自动选中 `bili-cc-align`，40 行日文原文 + 中文翻译，首行 21.17s |
| 宽松对齐防误配 | 宽松通道要求 coverage ≥0.3 且平均原始相似度 ≥0.08；无关文本不会仅靠位置先验硬对齐 |
| tap-to-sync | 第 1 行在 5s 打点 → 行偏移 4270ms、行时间 5s；第 2 行 9s → 5000ms；撤销恢复；空格在 12s 打点 → 行时间 12s，且不会触发播放/暂停 |
| tap 插值 | `Susan说`（51 行逐字）：第 3 行 +1.0s、第 8 行 +3.0s 打点 → 第 4–7 行自动插值为 1217/1660/2152/2591ms，渲染时间 85.046/92.186/100.133/107.230s；锚点外行偏移不变；提示“打点完成 · 插值 4 行” |
| tap 交互细节 | 打点模式点击第 8 行 → 目标从第 4 行跳到第 8 行；撤销第 8 行恢复 tapped=[3]；重复打点同一行后撤销仍保留其 tapped 状态和上一次偏移；单锚点完成只提示不插值 |
| 切歌歌词串台 | `Susan说`（51 行）→ 无 cid 的 `夕凪、某、花惑い`：切歌 250ms 内旧歌词已清空、显示加载态；cid 补齐后自动加载 28 行，首行“夏になる前に…”，无 Susan 残留 |
| 切歌快速连点 | 无 cid 的 `Love Song` → 60ms 后再切 `今天没回家`：最终歌词 key=`BV1zxKmzaExa|30748511680`、63 行，和当前队列项一致，旧响应没有覆盖 |
| 网易云 → 无 cid B 站 | `花に夕景`（nid）→ `爱爱爱`（bvid 无 cid）：中间态旧歌词清空，最终加载 35 行新歌词 |
| 未命中原因 UI | 注入 6 种 reason：`bili-auth` 显示“登录 B 站 / 重新找 / 诊断”；`low-score` 显示“换源（3）/ 重新找 / 诊断”和“最高 43 分”；`no-source`、`rate-limited`、`cid-failed`、`instrumental` 文案和按钮均正确 |
| 无结果原因接口 | 假标题 `zzzzqqqqxxyy` 清缓存后返回 `reason=no-source`、`instrumental=false`、`candidateCount=0`；修复前会因 LRCLIB 模糊匹配误报 `instrumental` |
| 手动导入 LRC | `TEST` key 导入 3 行 LRC → `manual=true`、时间 10/15.5/20s；随后 `/api/lyrics` 优先返回手动歌词；清缓存后仍在 |
| 手动导入偏移 | 手动歌词设置 `offsetMs=5000` → 行时间变为 15/20.5/25s；清缓存后 resolve 仍返回 5000ms，override 内 offset 保留 |
| 手动导入纯文本 | 4 行纯文本 + 120s 时长 → 均匀估算 0/36.8/73.6/110.4s，`plain=true`；UI 导入后自动进入打点，面板显示第 1/4 行 |
| 导入 UI | 真实歌曲打开导入弹窗，粘贴 2 行 LRC → `manual=true`、徽标“手动导入”、行时间 20/25s；`重新找` 弹确认框；`清除手动` 后恢复 B 站 CC 43 行 |
| 导出格式 | 43 行行级歌词导出 LRC 47 行（含 ti/ar/by）、SRT 时间格式 `00:00:13,300 --> 00:00:16,650`、ASS 含 `[V4+ Styles]` 和 `Dialogue: 0,0:00:13.30,...`；逐字行可导出 `<mm:ss.xx>` 增强 LRC |
| 导出边界 | `59.999s` → LRC `[01:00.00]`、ASS `0:01:00.00`、SRT `00:00:59,999`；`3599.9996s` → `01:00:00,000`，无 `00:60.00` |
| 校准向导 | B 站 CC 歌曲：第 1 步“已完成”，第 2 步“估算”，第 3 步“开始打点”；点开始打点后弹窗关闭、打点面板打开 |
| 校准向导分支 | 注入 `bili-cc-align` 候选 → 第 1 步显示“切换”；未登录 → 第 1 步 blocked + 登录；已有 align → 底部“取消自动对齐”；已有整体偏移/逐行偏移 → 对应步骤标为已完成 |
| 换源锁定持久化 | 当前歌选酷狗（`locked=true`、34 行逐字）→ 清缓存重新 resolve 仍是酷狗 `locked=true`；点“恢复自动匹配”后回到 B 站 CC 43 行、`locked=false` |
| 逐行偏移持久化 | 设置第 3 行 +500ms → 服务端 `lyric-line-offsets` 写入 `{2:500}`；清空 localStorage 后重载，服务端偏移自动回填并生效；清空偏移后服务端文件删除、本机 tombstone 为 1 |
| 锁定/偏移清理 | “恢复自动匹配”后 `data/lyric-locks`、`data/lyric-line-offsets`、`data/lyric-overrides` 均为空，没有测试残留 |
| KRC 罗马音 | `Lemon` KRC 解码后 66 行，`[language:]` 66 行全部贴回 `romanization`，65 行同时有中文 `translation`；标题行仍会被 `normalizeLines` 丢弃 |
| KRC 翻译/罗马音 | `夜に駆ける` 强制选酷狗：85 行逐字，85 行 translation + 85 行 romanization；首行“溶けてゆくように / 宛如慢慢地溶化般 / to ke te yu ku yo u ni” |
| KRC 无 language | `演员` 薛之谦 KRC 没有 `[language:]` 块，解析不报错、不影响正文时间轴 |
| KRC 假名 ruby 数据 | `Lemon`：51 行、68 个含汉字词带 kana；`夢(ゆめ)`、`未(いま)`、`埃(ほこり)`、`帰(かえ)`；纯平假名词不挂 ruby |
| KRC 元数据合并 | `Lemon` 候选 283818721 有 roma+kana、382052084 有 translation；合并后 51 行 translation + 51 行 romanization + 68 个 kana，标签同时显示“翻译/假名” |
| 歌词全量审计 | 9 个样本覆盖 CC/CC翻译/网易云/酷狗/AMLL/LRCLIB/纯音乐/无结果：0 失败；Lemon 51 行翻译+罗马音+68 假名；周杰伦 CC 43；又三郎 cc-align 40（27/13）；假标题 no-source |
| KRC 假名候选差异 | 同一首 `夜に駆ける` 的酷狗候选：部分带 `[kana:]`（65 行、60 个 kana 词），部分只有 `[language:]`；没有 kana 时正文/翻译不受影响 |
| KRC 假名边界 | `又三郎` KRC 的 `こ2あ(25950,95)` 按 `1/2` 分组后，`貴方` 得到 `あなた` 而不是 `こあなた`；`夢(ゆめ)`、`未(いま)` 等保留 |
| ruby 渲染 | 注入 `夢(ゆめ)+ならば`：歌词行 innerHTML 为 `<ruby>夢<rt>ゆめ</rt></ruby>ならば`，`rt` 文本正确；逐行 +500ms 后 `word.kana` 仍保留 |
| CC 行级置信度 | `又三郎` cc-align：40 行中 27 行 `ccMatched=true`、13 行 `false`；UI 显示 27 个蓝点 + 13 个黄点 + 图例 |
| 低置信行标记 | `冬眠` 应用 scale 1.1 / offset 120 / conf 0.3 后 alignment=`scale-offset-low`，34/34 行 `confidence='low'`，UI 应有红色低置信点 |
| 置信度交互 | `又三郎` cc-align：点黄点 → 选中第 5 行并显示“编辑”；点“只看低置信（13）”→ 40 行中 13 行 `display:block`、其余隐藏；再点显示全部 |
| 试听 | `又三郎` 第 5 行试听：播放位置从 114.5s 跳到 39.1s（该行 40.3s 前 1.2s），并开始播放 |
| 行编辑 | 选中第 5 行改为“测试编辑行”保存 → `source=manual`、`sourceLabel=手动编辑`、40 行保留；清除手动后恢复 cc-align 27/13 置信度 |
| 备份/恢复 | `/api/lyrics/backup` 返回 version/at/overrides/locks/lineOffsets；恢复 `tmp-test/tmp-lock/tmp-line` 三个文件后 backup 能读到，逐项清理后三目录为空 |
| 请求统计 | `夜に駆ける` 实时解析：`totalMs 1417`，`kugou 452ms ok`、`lrclib 911ms ×`、`netease 1415ms ok`；第二次请求 `cacheHit=true`，保留各源耗时 |
| 候选解释/别名 | `夜鹿《花に亡霊》` 生成 `ヨルシカ` 身份（weight 130）；`artistEvidence(夜鹿, ヨルシカ)=1`；`又三郎` 候选 explain 显示标题 0.7 / 歌手 1 / 时长 1 / 版本 0.18 |
| MV 字幕设置 | 外观自定义出现“MV字幕大小/高度”；设 20px/20% 后 `.mv-subtitle` 字号 20px、bottom 20% |
| 搜索缓存持久化 | 解析 `打上花火` 后生成 `data/lyrics-search.json`，含 `ne` 缓存条目；重启后按 1 小时 TTL 恢复 |
| 流光 ruby | 酷狗 `又三郎` 在流光样式下，含汉字 word 生成 `.mv-ruby > rt`，`水(みず)溜(たま)足(あし)` 与歌词列表一致 |
| 节拍吸附 | 真实 `bpmInfo` 71.5 BPM / phase 0.28，选中行 13.3s → 13.706s（+406ms）；归零后偏移 0 |
| Folia 兜底 | 代码路径：Folia 样式 8s 内无 canvas/子节点时设置 `body.mv-folia-failed`；FoliaBridge 自身 7s verify 失败会先切回流光 |
| Folia 运行时错误 | 切到 `poem` 后派发 `/vendor/folia/test.js` 的 ErrorEvent → `App.mv.foliaError` 记录 `window.error / test runtime boom`，样式自动切回 `flow`，`FoliaBridge.getLastError()` 同步可读 |
| 诊断面板 | `花に亡霊`：显示来源/质量/对齐/偏移/缓存 key/37 行/2 个候选（网易云 0.93 当前、LRCLIB 0.88），复制诊断文本约 1.1KB |
| 候选预览/锁定 | 网易云预览“もう忘れて… / 夏の木陰…”，LRCLIB 预览前两行；切到 LRCLIB 后 `locked=true`，切歌回来仍是 LRCLIB，来源行显示“已锁定” |
| 恢复自动 | “恢复自动匹配”清缓存重搜，回到网易云，`locked=false` |
| 快速操作竞态 | 连续 `+90` 后立即归零，再切歌回来，最终为 0，不会被旧请求覆盖 |
| `冬眠` 9:39 / 手动 +390s | 自动对齐+偏移原本把首行推到 11:24（超过视频）；现丢弃该对齐，首行 7:02；播放到 8:00/8:40/9:20 时列表分别滚到 245/396/548px，当前句保持居中。7:02 之前没有歌词可高亮，列表不动是正常的 |
| B 站未登录视频 | 返回 `authRequired: true`，界面提示登录；外部源仍可匹配 |
| 19 个 MV 样式 | 逐一切换，无 JS 错误；Folia Pixi canvas / React host / PV iframe 均挂载 |

### 14.3 当前限制

- **B 站本视频字幕需要登录**：项目 `data/cookies.json` 测试目录只有 `buvid3/buvid4`；打包版使用 `%APPDATA%\BiliPlayer`，已检测到 `SESSDATA`，实际登录态正常。登录后 `ownSubtitle()` 才会返回本视频字幕。
- **现场版对齐是实验性的**：onset 包络在高密度编曲里会有多个可行解，置信度可能只有 0.2–0.4；低置信会显示“低置信 + 试听校准”，并可用“取消对齐”恢复原始 LRC。真正稳的现场对齐还需要 B 站本视频 CC 锚点或本地 ASR。
- **酷狗 `[language:...]` 翻译/罗马音已接入**：按行贴回 `translation`/`romanization`；`[kana:]` 假名也已按 word 时间贴到含汉字的词并在歌词列表显示 ruby。注意部分酷狗候选只有 `[language:]` 没有 `[kana:]`，这类候选不会显示假名。
- **QQ QRC 尚未接入**：需要自定义 DES；作为后续。
- **负缓存 5 分钟**：`no-match` 会短时缓存；修完匹配规则后点“重新找”会清缓存。
- **网易云风控**：短时间大量搜索会 405；已做“登录 Cookie → 匿名通道”自动降级、查询预算、超时上限和搜索结果内存缓存。极端批量测试仍可能触发风控，正常单曲播放一般 0.5–3 秒返回。
- **纯音乐**：识别 NetEase 的“纯音乐，请欣赏”占位，界面显示“纯音乐 / 间奏”，不再显示“没有找到匹配歌词”。
- **手动校准**：整首偏移支持秒/分:秒、±600s；逐行 nudge、自动估偏移、tap-to-sync（含关键行插值）、校准向导均已完成。真正困难的现场版仍建议先试 B 站 CC + 外部文本 DP，再用 tap 补关键段。
- **行级置信度已做，逐词置信度还没有**：当前圆点来自 CC 是否直接匹配/自动对齐置信度；真正的逐词分数需要 ASR 或强制对齐。
- **搜索缓存已持久化**：`data/lyrics-search.json`，1 小时 TTL；另有下一首歌词预取。
- **ruby 已覆盖歌词列表和流光**：Folia Canvas 仍不支持 `word.kana` 的 ruby 渲染。
- **节拍吸附已做**：依赖 `App.mv.bpmInfo` 的 BPM/phase；没有节拍信息时会提示先开启动态 MV。
- **Folia 兜底**：8 秒节点检查 + `/vendor/folia/` 运行时错误捕获（window.error / unhandledrejection / PV iframe / WebGL context lost / tick）；Worker 或跨域脚本内部错误仍无法捕获。
- **旧 `/api/subtitle` 仍会走 B 站借字幕 + 网易云/LRCLIB 旧链路**：只作为新接口失败时的兜底，不影响新链路。

### 14.4 下一步（Phase 2 剩余 + Phase 3）

1. ~~现场版 `(scale, offset)` 拟合~~（已完成，实验性；低置信可取消）。
2. ~~B 站本视频 CC 时间锚定 + 外部文本 DP 对齐~~（已完成行级 DP，生成 `bili-cc-align`）。
3. 可选 SenseVoice 本地 ASR（228MB，按需下载，worker 运行）+ 已知歌词 DP。
4. ~~tap-to-sync / 逐行 nudge~~（已完成：逐行 nudge、自动估偏移、关键行打点插值）。
5. ~~候选源选择 UI~~（已完成：歌词页“换源”）。
6. QQ QRC / 云端 ASR（可选）；酷狗 KRC 翻译/罗马音/`[kana:]` 假名和行级置信度均已完成。

