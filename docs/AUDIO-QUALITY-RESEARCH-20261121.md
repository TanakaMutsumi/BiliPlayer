# 音质与音效优化调研 / 交接

> 日期：2026-11-21  
> 项目：`C:\Users\16493\Desktop\b站音乐播放器`  
> 范围：B 站/网易云播放链路、Web Audio 输出、响度、EQ、空间音效、耳机交叉馈送、动态/限幅  
> 说明：私有 API、版权音频，仅个人本地使用。Folia/PV 许可证不受本文件影响。  
> 交接文档：`docs/AUDIO-HANDOFF-20261122.md`

---

## 1. 结论先行

这次排查发现，**当前最大的音质瓶颈不是音效算法，而是源音质被代码主动限制**：

1. 网易云 `songUrl` 一直请求 `br=320000`，但 `NeteaseCloudMusicApi` 的 `song_url` 默认是 `br=999000`，当前账号实际能返回 **无损 FLAC**。
2. B 站音频标签把 `30280` 写成 `320kbps`，实际采样到的带宽约 **194kbps**；`30232` 约 108–132kbps，`30216` 约 64kbps。
3. `AudioContext` 使用默认 `interactive` 延迟，音乐播放更适合 `playback` 大缓冲，减少 underrun/爆音。
4. 现有响度归一用 200ms RMS 近似 LUFS，没有门限积分；且分析器分支没有连到 destination，在 Chromium 的拉取模型下可能长期采不到数据。
5. 音效链本身已经比较完整（10 段 EQ、混响、宽度、旋转、电子管/磁带/激励、夜听、变调），但缺少：
   - 输出安全限幅（EQ/混响/饱和叠加后可能削波）
   - 耳机交叉馈送（crossfeed）
   - 更可靠的 EBU R128 门限积分
   - 明确的音质档位选择

本轮已完成上述 1–5 的第一阶段修复，并打包验证。

---

## 2. 全网调研结果

### 2.1 网易云音质

- `NeteaseCloudMusicApi/module/song_url.js`：
  - 默认 `br: parseInt(query.br || 999000)`
  - 走 `/api/song/enhance/player/url` weapi
  - 本项目之前固定传 `320000`，等于主动放弃无损
- 实测当前账号：
  - `br=999000` → `type=flac`, `level=lossless`, `br≈1.09Mbps`, `size≈37.6MB`
  - `br=320000` → `type=mp3`, `level=exhigh`, `320kbps`
  - `br=192000` → `higher`, `192kbps`
  - `br=128000` → `standard`, `128kbps`
- 结论：默认请求无损，失败/无权限再退 320k；提供档位选择。

参考：
- https://github.com/Binaryify/NeteaseCloudMusicApi
- 本地 `node_modules/NeteaseCloudMusicApi/module/song_url.js`

### 2.2 B 站音质

实测 `playurl`（`fnval=16/4048/272/2000`）同一视频返回：

| id | 实测 bandwidth | 实际含义 | 之前标签 |
|---|---|---|---|
| 30216 | ~49–66kbps | 64kbps AAC/HE-AAC | 64kbps |
| 30232 | ~108–132kbps | 128kbps | 132kbps |
| 30280 | ~194–256kbps | 192kbps | **320kbps（错误）** |
| 30250 | 未在样本中出现 | 杜比音频 | Hi-Res（错误） |
| 30251 | 未在样本中出现 | Hi-Res | Hi-Res |

- 大多数音乐视频最高只有 30280，约 192kbps，不存在“320kbps”。
- `fnval=4048` 与 `fnval=16` 在普通视频上返回相同音频列表；改为 4048 以允许 Dolby/Hi-Res（若视频提供）。
- 杜比/Hi-Res 是否能在 Chromium 解码取决于 codec；当前样本未验证。
- 结论：修正标签、优先 30251→30250→30280→30232→30216，并保留实际 bandwidth。

参考：
- B 站 `x/player/playurl` DASH 协议（社区文档已归档，本机实测为准）
- 本项目 `src/bilibili.js`

### 2.3 Web Audio 输出

- `AudioContext({ latencyHint: 'playback' })` 使用更大输出缓冲，适合音乐；`interactive` 更适合交互/低延迟。
- 不要强制 `sampleRate`：让 Chromium 使用系统输出采样率，避免额外重采样。
- 频谱/响度分析器必须有到 `destination` 的路径才会被 Web Audio 持续拉取；用 0 增益哑通道即可。
- `preservesPitch`/`soundtouch-worklet` 已有；变调/倍速仍是实验项。

### 2.4 响度标准化

标准：ITU-R BS.1770-4 / EBU R128。

- K 加权：高架 +4dB @1681.97Hz，高通 38.13Hz。
- 400ms 短时块；绝对门限 -70 LUFS；相对门限 integrated -10 LU。
- 目标 -14 LUFS（流媒体常用）。
- 真正 True Peak 需要 4x 过采样；当前用 8x 64-tap 多相 FIR 近似 ISP，并用输出软限幅兜底。

参考：
- https://github.com/jiixyj/libebur128 （MIT，498★）
- https://github.com/sdroege/ebur128 （MIT）
- https://github.com/shortformkit/lufs-meter-js （MIT）

### 2.5 音效/开源项目

| 项目 | 许可证 | 星数 | 可借鉴 |
|---|---|---|---|
| lx-music-desktop | Apache-2.0 | 55k+ | Electron 音乐播放器、音效图/预设组织 |
| effetune | MIT | 163 | 实时 EQ/电子管/空间效果参数化 |
| open-orpheus | MIT | 370 | 云音效参数协议/播放器架构 |
| Tone.js | MIT | 15k | EQ3/Compressor/Limiter/Reverb/CrossFade 节点组织 |
| signalsmith-stretch | MIT | 588 | 高质量变调/变速（C++/WASM） |
| libebur128 | MIT | 498 | EBU R128 门限积分参考 |
| camilladsp-crossfeed | BSD-3-Clause | 19 | BS2B 交叉馈送参数 |
| bs2b | — | — | Bauer stereophonic-to-binaural 经典算法 |

结论：
- 现有 AudioFX 设计方向是对的（10 段 EQ、程序化 IR、M/S、饱和、限幅），不需要推倒重来。
- 优先补“输出安全”和“耳机交叉馈送”，再做 True Peak/预放大等细节。
- 不建议直接引入 Tone.js 全量替换：会增加包体和调度复杂度；可借鉴节点组织。

---

## 3. 本轮已实现

### 3.1 网易云无损 + 音质档位

- `src/netease.js`
  - `songUrl(id, preferredBr)` 默认请求 `999000`，失败/无权限退 `320000`
  - **Hi-Res**：`preferredBr=1999000` 时 weapi 返回 24bit FLAC（实测 `level=hires`、约 3Mbps、75.8MB）；失败自动退无损/320k
  - `2999000` 返回 `jyeffect`（高清环绕声），不是更高解析，暂不默认使用
  - 返回 `br / level / quality`
  - `quality` 标签：`Hi-Res 2992kbps` / `无损 FLAC 1088kbps` / `320kbps` / `192kbps` / `128kbps`
  - `neQualityLabel` 先判断 `hires/jyeffect/sky`，避免被 flac/br 分支误标成“无损 FLAC”
  - 直链缓存按 `id|br` 分档，避免切档命中旧 320 链接
- `server.js`
  - `/api/nmedia?id=&quality=hires|lossless|320|192|128`
  - `hires → 1999000`，`lossless → 999000`
- `public/js/player.js`
  - `audioQuality()` 从 `bp.audioQuality` 读取
  - 加载/预取/网易云交叉切换都带 quality
  - `S.quality` 显示实际档位与码率
  - `neMedia()` 按 `hires → lossless → 320 → 192 → 128` 逐档回退
  - 播放中 `error` 事件自动降一档重试，保留当前 `currentTime`，避免 Hi-Res/无损直链失败导致整首报错
  - 自动档下连续 `waiting` 超过 6 秒自动降一档；手动选的档位不会因卡顿被改
- `public/js/app.js`
  - 音效面板“高级”新增“网易云音质”选择：自动（按网络）/ Hi-Res（实验·文件较大）/ 自动无损 / 320 / 192 / 128
  - 默认 `auto`；Hi-Res 需手动开启，下一首生效
  - `auto` 解析：`saveData` 或 `effectiveType=slow-2g/2g/3g` → 320k；其余 → 无损；不自动选 Hi-Res

### 3.2 B 站音频质量

- `AUDIO_PRIORITY = [30251, 30250, 30280, 30232, 30216]`
- `AUDIO_LABEL` 修正为 Hi-Res / 杜比 / 192kbps / 128kbps / 64kbps
- `fnval: 4048`
- 返回 `id / bandwidth / codecs`
- `playAudio` 额外返回 `alts`：全部可用候选（含 id/quality/url/codecs）
- 客户端 `pickPlayableMedia` 用 `audio.canPlayType('audio/mp4; codecs="..."')` 选第一个可解码候选：
  - Chromium 实测 `ec-3`/`ac-3` 返回空（杜比不可解）
  - `mp4a.40.2`、`mp4a.40.5`、`flac`（MP4）返回 `probably`
  - 杜比主候选会自动回退到 30280/30232/30216 AAC，避免整首无法播放
- 预取、普通加载、交叉淡化、Buffer 交叉路径都走同一 `pickPlayableMedia`

### 3.2.1 DASH 视频+音频分离（实验）

- `src/bilibili.js` 新增 `playVideoDash(bvid,cid)`：
  - `fnval=4048` 取 DASH
  - 视频优先 `id=80` + `avc1`（1080p AVC，Chromium 兼容性最好），否则最高分辨率
  - 音频优先 30280/30232 AAC
  - 返回 `{type:'dash-av', videoUrl, audioUrl, video, audio, quality}`
- `server.js`：`/api/media?kind=video&dash=1`
- 客户端 `playDashAV`：
  - `video` 元素播放 video-only（`muted=true`）
  - `audio` 元素播放 audio-only，走完整 FX/响度链
  - `S.dashAV=true`、`S.slot='a'`（audio 是 FX/响度主元素）
  - 播放/暂停/seek 双向镜像；每 1s 校正，漂移 >0.15s 时对齐
  - 视频/音频 error → 自动回退普通 720p mp4
- 高级页新增“看视频 DASH 1080p（实验·双流同步）”，默认关闭，下次看视频生效

### 3.3 Web Audio 输出

- `AudioContext({ latencyHint: 'playback' })`
- 不强制 sampleRate

### 3.4 响度归一

- `loudStats()` 同时返回 mean-square 和 peak
- 400ms 块；绝对门限 -70 LUFS；相对门限 integrated-10 LU
- 未锁定时用**累计门限积分**（而不是单块响度）定增益；30 秒 / 至少 50 块后才锁定
- 锁定后保留**峰值守卫**：后段出现更高原始峰值时，按 `-1.5dBFS - peakDb` 缓慢下调归一增益（tau 2s），只降不升，并写回缓存；避免末级限制器长期压峰
- `bp.loudness.v5` 缓存 `{g,p}`；加载时按峰值重新校验
- **给分析器增加 0 增益哑通道到 destination**，确保 Chromium 持续拉取
- 短期增益平滑 tau 0.35，锁定 tau 0.45，峰值守卫 tau 2.0

### 3.5 音效链安全

- 新增 `public/js/vendor/peak-limiter-worklet.js`：
  - 3ms lookahead 延迟环
  - 瞬时 attack / 可调 release
  - 立体声联动
  - 8x 64-tap 多相 FIR 带限插值检测 ISP（8 相位 × 64 抽头 Hamming 窗 sinc；比 32-tap 更接近 True Peak，仍非标准 True Peak 表）
  - 接在交叉馈送之后、安全软限幅之前
- `AudioFX` 输出后新增 `makeSafetyCurve()` 软限幅：
  - `|x| <= 0.97` 完全透明
  - 超过后 tanh 软削顶，避免 EQ/混响/饱和叠加硬削波
  - `oversample = '4x'`
- 保留夜听压缩/限幅路径；原声路径仍透明

### 3.6 耳机交叉馈送

- `AudioFX.state.crossfeed` 0..1
- 输出后：对侧 0.3ms 延迟 + 700Hz 低通 + 可调衰减；直通增益轻微降低防整体变响
- 新增 BS2B 式高频“头影”：直通路径 1.2kHz high-shelf，增益 `-2.5 × crossfeed` dB（crossfeed=0.55 时约 -1.4dB），避免只做低通导致高频过亮、声像不自然
- 新增中频交叉路径：1.2kHz 带通 + 0.45ms 延迟，增益 `0.35 × crossfeedMid`；直通 shelf 额外 `-1.5 × crossfeedMid`，让中频人声更靠前
- 新增预设“耳机优化”：`crossfeed 0.55 + 低频单声道 + 预放大 -1dB + 低音 +1.5 + 高音 -0.5`
- 新增预设“耳机优化+”：`crossfeed 0.7 + crossfeedMid 0.35 + 低频单声道 + 预放大 -1.5dB + 低音 +2 + 高音 -1`
- 均衡器页新增“耳机交叉馈送”“中频交叉”滑杆
- 预设检测/激活徽标纳入 crossfeed / crossfeedMid

---

### 3.7 预放大 / 低频单声道

- 预放大：`AudioFX.state.preamp` -12..+6dB，放在 EQ 之前，便于给大增益留 headroom
- 低频单声道：`monoBass`，把侧信号 <120Hz 部分归零，避免 width>1 时低频相位/空洞
- 均衡器页新增“低频单声道（<120Hz）”开关
- 高级页新增“预放大”滑杆
- 原声预设：preamp=0、monoBassLow=1、crossfeed=0
- 耳机预设：preamp=-1、monoBassLow=0、crossfeed=0.303（对侧增益）

### 3.8 输出表 / 音效诊断

- AudioFX 末端新增分析器 + 0 增益哑通道，实时读输出峰值/RMS
- 新增 `AudioFX.meter()` / `resetMeter()`
- lookahead 限制器每 ~100ms 上报本块最小增益，`AudioFX.debug().limiterGrDb` 显示实时衰减量（0dB=未介入）
- 新增 `AudioFX.selfTest()`：用 `OfflineAudioContext` 静默渲染 997Hz 正弦
  - 热段 1.8 → 期望 0.84~0.92
  - 低段 0.5 → 期望 0.44~0.56
  - 诊断页“限制器自检”按钮，不发声、不打断播放
- 音效面板新增“诊断”页：
  - 歌曲、音质、采样率、缓冲/输出延迟
  - 响度增益（含是否锁定）、原始峰值、增益上限
  - 输出峰值、最大峰值、是否削波
  - lookahead 限制器是否加载、实时衰减量
  - 预放大、预设补偿、交叉馈送、低频单声道、当前预设

### 3.9 预设响度对齐（presetTrim）

问题：13 个预设的混响/旋转/激励/EQ 会显著改变 RMS。连续播放时逐预设采样看似相差近 9dB，但音乐本身在变，不能直接作为标定。

方法：
- 在 AudioFX 输入端与输出端各接一个分析器，用 4 通道 ScriptProcessor 在**同一时间窗**同时采集干/湿信号；
- 测量时把 `presetTrim` 设为 -9dB 留足 headroom，避免限制器介入污染比值；
- `intrinsicDb = 20log10(wetRMS / dryRMS)`，补偿值 `presetTrim = -intrinsicDb`；
- 旋转类预设用 5–6s 窗口覆盖旋转周期。

实测（48kHz，同一 NetEase 曲目）：

| 预设 | 实测 intrinsic | 补偿 presetTrim |
|---|---:|---:|
| 原声 | 0.0dB | 0 |
| 3D环绕 | +1.5dB | -1.5 |
| 360°环绕 | +1.9dB | -1.9 |
| 8D环绕 | -0.8dB | +0.8 |
| 演唱会现场 | +1.4dB | -1.4 |
| 震撼全景 | -1.3dB | +1.3 |
| 教堂混响 | +1.7dB | -1.7 |
| 清澈人声 | -3.2dB | +3.2 |
| 高解析人声 | -0.8dB | +0.8 |
| HiFi电子管 | -3.5dB | +3.5 |
| 怀旧卡带机 | -1.2dB | +1.2 |
| 空灵人声 | -3.0dB | -3.0 |
| 耳机优化 | -1.2dB | +1.2 |
| 耳机优化+ | 未单独标定（autoLevel 收敛） | -1.0 |

- 补偿节点放在交叉馈送后、lookahead 限制器前，限制器看到的是补偿后的信号。
- 切换预设时 80ms 缓变，避免音量跳变。
- 复测：13 个既有预设湿/干比基本落在 ±0.7dB，个别低音/混响依赖型预设（全景、教堂）在其它段落可达 ±1.3~1.8dB；这是静态补偿的固有局限。新增“耳机优化+”由 autoLevel 收敛。
- 旧存档没有 `presetTrim` 时按当前预设自动补齐。

### 3.10 响度归一峰值约束（关键修复）

实测发现：某些曲目被响度归一提 +5dB 后，原始峰值从 ~0.9 推到 1.6，末级 lookahead 限制器只能持续压掉约 6dB。听感上就是“响度上去了但动态被压扁、抽吸”，也是音效算法被感知为“不对劲”的主要原因之一。

修复：
- `makeLoudTap` 增加**未 K 加权**的原始峰值分析器（左右各一），与 K 加权响度分析器分离；
- K 加权高频架 +4dB 会让峰值虚高（可达原始 1.6 倍），不能拿来当削波保护依据；
- 响度增益最终取 `min(响度目标增益, -1.5dBFS - 20log10(原始峰值))`；
- 锁定积分响度时同样应用峰值上限；
- 缓存升级到 `bp.loudness.v4`，存 `{g, p}`，加载时用峰值重新校验；旧 v2/v3 数值作废，避免历史 +5dB 脏值继续生效。

效果：
- B 站 live 曲目（原始峰值 0.927）响度增益 -6.01dB，输出峰值 0.482，限制器不常驻压缩；
- 高响度曲目（原始峰值 0.999）增益 -7.64dB，峰值上限 -1.49dB；
- 需要 +5dB 的曲目，若原始峰值已接近满刻度，增益会被峰值上限拦住，宁可稍轻也不压扁动态。

### 3.11 音效自动响度（autoLevel）

问题：静态 `presetTrim` 是按一首参考曲标定的；低音/混响依赖型预设（全景、教堂）在不同段落仍会有 ±1.3~1.8dB 残差。

实现：
- FX 输入端（`n.fxIn`）与限制器输入端（`n.preLim`，已含 presetTrim + autoGain）各接一个分析器；
- 每 500ms 计算干/湿 RMS，4 秒 EMA；干信号 <0.004 时跳过（静音/前奏不采样）；
- 误差 `20log10(dryEMA / wetEMA)`，死区 0.2dB；每 tick 最多修正误差的 12%（上限 ±0.35dB）；
- `autoGain` 限幅 ±4dB，tau 0.6s；放在 presetTrim 后、限制器前；
- 切换预设时重置为 0dB 并重新收敛；手动调 EQ 不重置，避免跳变；
- 高级页新增“音效自动响度（慢速，防预设音量跳变）”，默认开启，可关闭；
- 只作用于 FX 内部，不改变媒体响度归一/峰值守卫。

实测：
- 教堂预设：15 秒内 autoDb 收敛到约 −1.2dB，期间短暂 +0.4dB 过冲，无削波、GR≈0；
- 全景预设：autoDb 在 −0.5~−1.1dB 间缓慢跟随低音段落，干/湿差约 −0.1dB，无泵浦；
- 关闭后 autoGain 回 1.0，重新开启从 0dB 重新收敛；状态持久化。

### 3.12 A/B 旁通

- `AudioFX.state.bypass`：只绕过 FX，不改媒体响度归一/主音量
- 干声从 `fxIn` 直连 `finalOut`；湿声经 `bypassWet` 到 `finalOut`
- 切换 50ms 缓变，避免咔哒
- 旁通期间 `autoLevel` 冻结，恢复后继续
- 预设页新增“A/B 旁通（听原声）”按钮；诊断页显示旁通状态
- 实测：教堂预设 wet 时 dry=0/wet=1；旁通时 dry=1/wet=0，输出峰值 0.428、无削波

### 3.13 变调主链修复与音质参数

- 旧版 `pitchNode` 串在 `trim → comp`（夜听支路），**夜听关闭时变调实际不生效**。
- 新链路：`compIn → pitchIn → [bypass 或 pitchNode → pitchWet] → pitchOut → limDry / trim`，夜听开/关都生效。
- `pitch=0` 时 bypass 直通、pitchWet=0；只有变调非 0 才让 SoundTouch 输出。
- SoundTouch 参数：`lanczos` 插值、`sequenceMs=60`、`seekWindowMs=25`、`overlapMs=12`（比默认更适合音乐，减少瞬态断裂）。
- 可选高质量引擎 **Signalsmith Stretch**（MIT，JS/WASM，vendored `public/js/vendor/signalsmith-stretch.mjs`）：
  - 高级页开关“高质量变调引擎（Signalsmith·实验·延迟更高）”
  - 实测 latency 0.12s；997Hz +6 → 1412.1Hz；默认仍为 SoundTouch，避免影响现有手感
  - `server.js` MIME 表增加 `.mjs`，动态 import 才能正常加载
- 调试指标：`underrunCount / framesBuffered / blockCount / outputRms / outputPeak / engine / latency`，诊断页显示变调状态与 underrun。
- 实测：997Hz +6 半音 → 1406.3Hz，回到 0 → 996.1Hz；启动阶段 underrun 38–39，稳态 1400 块仅 +1。

### 3.14 耳机校准（AutoEQ）

- 目标：按耳机型号做频响校正，而不是继续调限制器。
- AudioFX 新增 10 段参数 EQ（放在用户 EQ 之前）：
  - `hpDry`（关闭直通）/ `hpWet`（校准输出）交叉淡化
  - AutoEQ Preamp → `hpPreamp`
  - `PK → peaking`、`LSC/LS → lowshelf`、`HSC/HS → highshelf`
- 校准强度 0–100%：同时缩放 Preamp 与每个 filter 的 gain；0% 等于关闭。
- 校准开启时自动响度暂停（避免 autoLevel 把 Preamp 又补回去）；关闭后恢复。
- A/B 等响：校准开启时，旁通干声按当前 Preamp 衰减（如 -6.1dB → 0.495），避免“校准听起来更轻”的误判。
- 服务端：
  - `GET /api/autoeq/search?q=`：在 oratory1990/crinacle 的 over-ear/in-ear/earbud 目录里搜型号
  - `GET /api/autoeq/profile?path=`：取该型号的 `ParametricEQ.txt`
  - GitHub API + 内存缓存（目录 10 分钟、Profile 30 分钟）
  - Profile 先直取 `<型号>/<型号> ParametricEQ.txt`，命名不一致才回退列目录，省一次 API 调用
  - 路径按 segment 编码，避免 `#/?` 等字符破坏 URL
- 客户端：
  - 均衡器页“耳机校准”搜索框、结果列表、关闭按钮
  - 支持直接粘贴 `ParametricEQ.txt` 导入任意型号
- 实测：`Sony WH-1000XM4` → Preamp -6.1dB、10 filters；`hpDry=0/hpWet=1/hpPreamp=0.495`；autoGain=1；无削波
- 强度 50%：`hpPreamp=0.704`；A/B 旁通 `bypassDry=0.704 / bypassWet=0`；无削波

### 3.15 音效算法调研与 FDN 混响

本轮把“音效算法”单独调研了一遍。高赞项目/算法：

| 项目 | 许可 | 星数 | 结论 |
|---|---|---:|---|
| Dragonfly Reverb | GPL-3.0 | 1173 | 音质好，但 GPL，且 C++/LV2 移植成本高 |
| MVerb | GPL-3.0 | 239 | 经典算法混响，GPL |
| sinshu/freeverb | Public Domain | 130 | Freeverb 参考实现，偏经典/金属 |
| mmckegg/freeverb | 未标注 | 31 | Web Audio Freeverb，简单但非现代 FDN |
| Signalsmith “Let's write a reverb” | 文章/示例 | — | FDN + 扩散器 + Householder 的现代思路 |
| vitOTT | GPL-3.0 | 34 | 多段压缩参考，GPL |

结论：不直接搬 GPL 代码，按 FDN 思路独立实现一个许可干净的算法混响。

实现 `public/js/vendor/fdn-reverb-worklet.js`：

- 8 通道 FDN，输入 4 级 Schroeder 全通扩散器（L/R 各一路）
- 反馈矩阵：Householder `H = I - (2/N)·1·1ᵀ`，避免过度混合导致的染色
- 每条延迟线独立长度、反馈增益、一阶低通阻尼
- 慢速 LFO 调制延迟读取位置，抑制金属尾
- 输出从左右通道延迟抽头混合
- `ENV_PRESETS` 新增 `size/damping`；bathroom/room/theatre/hall/church 映射到不同 FDN 参数
- 图中保留卷积 IR 作为回退：`convWet` / `fdnWet` 100ms 交叉淡化
- 均衡器页新增“算法混响（FDN·实验）”开关，默认开启；加载失败自动回退 IR
- 预延迟继续用 `envPre`，FDN 只输出湿声，`envWet` 控制深度

实测：

- 离线脉冲：early 0.1143 / mid 0.0021 / late <0.00005，无 NaN/Inf
- 应用内 hall：`reverbEngine=fdn`、`fdnWet=1`、wet 0.272、峰值 0.1424、无削波
- church：wet 0.36、峰值 0.7123、无削波
- 打包版：`fdnReady=true`、`fdnWet=1`、峰值 0.2332、可切回 IR、无 error

### 3.16 3 段夜听压缩

旧版夜听是单段 `DynamicsCompressor`：-21dB / 2:1 / 30ms attack / 400ms release，所有频段一起压，低频容易顶掉中高频。

新版：

- 200Hz / 2000Hz LR4 分频（每段两级 Butterworth）
- 低频 <200Hz：-18dB / 2.4:1 / 20ms / 350ms
- 中频 200–2000Hz：-21dB / 2.0:1 / 15ms / 280ms
- 高频 >2000Hz：-24dB / 1.5:1 / 8ms / 180ms
- 段增益 0.95 / 1.0 / 1.0，求和后进原安全限制器，再 `nightTrim 0.708`
- 夜听关闭时 `limWet=0`，整条支路静音；原声路径不变
- 诊断页显示三段阈值与实时 reduction

实测：

- compTh `[-18, -21, -24]`
- 一段音乐 reduction `[-1.6, -0.2, -0.4]`，低频压得更多
- 另一段 `[-1.0, -0.9, -0.3]`
- peak 0.4317、`clip=false`、无 error

### 3.17 3D/8D 双 Panner 立体声旋转

旧版旋转把立体声高频段送进**单个 HRTF Panner**，Panner 内部会下混成单声道再 HRTF 化，导致：

- 立体声高频被折叠
- 声场变窄
- 旋转听起来像“单声道点源在绕圈”

新版：

- `rotHP` 高频段经 ChannelSplitter 拆成 L/R
- 两个 HRTF Panner 分别处理 L/R
- 右 Panner 轨道相位偏移 φ：
  - `X_R = cosφ·X + sinφ·Z`
  - `Z_R = cosφ·Z − sinφ·X`
- 两 Panner 输出各 0.5 求和
- 增加“中心填充”`rotFill`：原始高频按比例混回，降低过度相位化
- 每个旋转预设独立 `spread / fill / makeup`：
  - 3D：spread 0.28 / fill 0.22 / makeup 1.7
  - 360：0.32 / 0.20 / 1.8
  - 8D：0.12 / 0.40 / 1.35
- 低频仍走 `rotLow` 居中，保持低频稳定

实测：

- 单声道噪声：off corr 1.00；3D 0.17；360 0.24；8D 0.38
- 音乐：off peak 0.254/RMS 0.107；3D 0.249/0.129；360 0.194/0.080；8D 0.578/0.215（GR −0.08，无削波）
- 打包版 3D：`rotHigh=1.696`、peak 0.1656、ctx running、无 error

说明：单声道噪声下相关性下降是双 Panner 有意制造的宽度；实际音乐大概在 off 0.86 → 3D 0.63 左右。若觉得太宽/太相位化，可下调 spread 或提高 fill。

### 3.18 磁带 / 电子管饱和模型

旧版只是简单的 tanh/不对称 tanh 波形整形。新版补上磁带/电子管的频响与偏置细节：

磁带：

- 预加重：3.5kHz high-shelf `+4×tape` dB，放在饱和前
- 去加重：3.5kHz high-shelf `-4×tape` dB，放在饱和后
- 磁头低频 bump：90Hz low-shelf `+1.5×tape` dB
- 饱和器 `oversample='4x'`
- 网频响在无饱和时接近平坦，饱和时高频谐波更丰富但不刺

电子管：

- 饱和曲线仍按小信号归一
- 900Hz peaking `+1.2×tube` dB，补中频厚度
- 20Hz highpass 去 DC（不对称曲线可能产生直流）
- `oversample='4x'`

实测：

- `cassette`：tapePre 3.4 / tapeDe -3.4 / tapeBump 1.27，peak 0.4632，无削波
- `tube`：tubeMid 0.84 / tubeWet 0.7，peak 0.4632，无削波
- 打包版同样通过

### 3.19 去齿音（动态高频压缩）

不是简单砍高音，而是只对 5kHz 以上做快速压缩：

- 5kHz LR4 分频
- 低频段直接通过
- 高频段 → `DynamicsCompressor` → 求和
- 压缩器：
  - threshold `-18 - 12×amount`（-18 ~ -30dB）
  - ratio `1 + 2×amount`（1 ~ 3）
  - attack 2ms / release 50ms / knee 6
- `deEsser=0` 时 bypass 直通，wet=0
- 均衡器页新增“去齿音 0–100%”滑杆
- 诊断页显示高频衰减量

关键问题：Chromium 的 `DynamicsCompressor` 自带 makeup，直接串入会**反而变响**。实测 1kHz 0.3 正弦通过 -27.6dB/2.6:1 压缩器后 RMS 0.2121 → 0.2258。

修复：每 30ms 读取 `comp.reduction`，用 `deHighGain = 10^(reduction/20)` 反向补偿，得到真正的高频衰减。

实测：

- 8kHz 0.3 正弦：off RMS 0.2129 → on 0.1153（-5.3dB），reduction -10.5
- 音乐下 deEsser=0.8：reduction -3.3、peak 0.0543、无削波
- 打包版 th -27.6 / ratio 2.6 / wet 1 / UI 正常

### 3.20 夜听强度（连续可调）

夜听不再只是开关，`nightAmount` 0–100% 连续控制 3 段压缩：

- 低频 threshold `-18×amount`，ratio `1+1.4×amount`
- 中频 `-21×amount`，ratio `1+1.0×amount`
- 高频 `-24×amount`，ratio `1+0.5×amount`
- `nightTrim = 1 - 0.292×amount`
- `amount=0` 时 `limWet=0 / limDry=1`，整条夜听支路旁通
- 高级页新增“夜听强度”滑杆，诊断页显示强度与三段 reduction

实测：

| amount | compTh | nightTrim | limWet |
|---:|---|---:|---:|
| 1.0 | -18 / -21 / -24 | 0.708 | 1 |
| 0.5 | -9 / -10.5 / -12 | 0.854 | 1 |
| 0 | 0 / 0 / 0 | 1 | 0 |

- 全部 `clip=false`，无 error
- 打包版 amount=0.5 同样通过

### 3.21 FDN 参数控制

FDN 不再只跟随环境预设，均衡器页新增：

- FDN 大小：0.5–1.5
- FDN 衰减：0.5–8s
- FDN 阻尼：0–100%
- “跟随环境预设”按钮

状态：

- `fdnSize / fdnDecay / fdnDamping` 为 null 时使用 `ENV_PRESETS`
- 手动拖动后覆盖当前环境预设
- “跟随环境预设”把三个值清回 null

实测：

- hall 自动：size 1.2 / decay 2 / damping 0.3
- 手动：1.6 / 5 / 0.6
- 重置：回到 1.2 / 2 / 0.3
- peak 0.1489、clip=false、无 error；打包版正常

### 3.22 混响早期反射与湿声整形

FDN 之前只有扩散器 + 延迟线主体，首个回声在 100ms 之后，和干声之间有一段空档；卷积 IR 反而有早期反射。本轮把两条路径拉齐并补上湿声整形：

- FDN worklet 新增 15 抽头早期反射网络：7–140ms 稀疏分布，右声道额外 +1.7ms 去相关，6.5kHz 一阶低通柔化，抽头时间随 size 缩放，混入湿声 0.3
- 混响湿声总线新增 180Hz 高通 + 10kHz 低通：低频不进混响、减少浑浊；高频不刺；干声仍全频直通
- 均衡器页新增“混响前延迟”0–120ms 滑杆，`envPre=null` 时跟随环境预设；“跟随预设前延迟”按钮清回 null
- 诊断页新增“混响湿声”行：前延迟 / HP / LP / 湿量

实测：

- 离线脉冲：起始 7.6ms；ER 段峰值 0.0464；70–150ms 空档峰值 0.0521（已填满）；FDN 早段 0.0744；1.2–1.9s 尾音 0.0007；末端 0.000002；无 NaN；L/R 最大差 0.0623
- 五个环境（depth 0.8）：bathroom/room/theatre/hall/church 峰值 0.456/0.341/0.471/0.226/0.563，GR 0dB，前延迟 8/15/22/30/60ms
- IR 回退：church 峰值 0.319，湿声 HP/LP 仍生效
- 14 预设全量：最高峰值 0.596（clear），全部 clip=false、GR 0
- UI：滑杆 70ms → 状态/诊断 70ms；点“跟随预设前延迟”回到 hall 30ms
- 备份：`backup/pre-reverb-er-20261123/`

### 3.23 瞬态塑形（打击感 / 尾音收敛）

新增 `public/js/vendor/transient-shaper-worklet.js`，补上“让鼓点更结实、尾音更干净”这一类缺失的效果：

- 双包络：fast 0.8ms attack / 50ms release；slow 30ms / 300ms
- fast > slow 时按比例提升起音；fast < slow 时收敛衰减尾音
- 立体声联动（取 L/R 较大值），增益 2ms 一阶平滑，零延迟
- 参数 0 时逐样本透明（实测与输入完全一致）
- 串在去齿音之后、磁带之前；worklet 加载失败自动保持原直通
- 均衡器页新增“瞬态打击 / 尾音收敛”0–100% 滑杆；诊断页新增状态行

实测：

- 透明性：attack=sustain=0 时与输入最大差 0
- 打击感 90%：30ms 脉冲起音峰值 0.5 → 1.04（+6.4dB）
- 尾音收敛 90%：指数衰减段 RMS 0.06996 → 0.05118（−2.72dB）
- 应用内：attack 0.7 / sustain 0.6 参数生效，峰值 0.411、GR 0、无削波
- UI：滑杆 55%/35% 与状态、诊断一致；复位 0 后恢复透明
- 备份：`backup/pre-transient-20261123/`

### 3.24 等响度补偿（低音量增强）

人耳在低音量下对低频/高频不敏感（Fletcher-Munson）。新增随音量变化的等响度补偿：

- 110Hz lowshelf + 9kHz highshelf，放在用户 EQ 之后、去齿音之前
- `loudness` 0–100% 控制强度；实际增益 = `loudness × (1 - 音量)^1.2 × (低音 8dB / 高音 4dB)`
- 音量滑杆、静音命令、启动恢复都会同步给 `AudioFX.setVolume()`；150ms 平滑
- 均衡器页新增“等响度补偿”滑杆；诊断页显示音量、低音/高音实际增益

实测（loudness=100%）：

- 音量 30%：低音 +5.03dB / 高音 +2.52dB
- 音量 40%：低音 +4.29dB / 高音 +2.15dB
- 音量 80%：低音 +1.30dB / 高音 +0.65dB
- 音量 100%：约 0dB
- UI：滑杆 35% 标签与状态一致；诊断行存在；复位 0 后回到透明
- 备份：`backup/pre-loudness-20261123/`

### 3.25 动态 EQ（3 段共振抑制）

静态 EQ 无法处理随段落变化的“糊/刺”。新增 `public/js/vendor/dynamic-eq-worklet.js`：

- 三段：180Hz（浑浊）、1.2kHz（箱声）、3.5kHz（刺耳）
- 每段带通检测 + 峰值滤波器动态衰减；相对检测（带内包络 / 全频包络），避免整体音量变化
- 最大衰减 5/5/7dB；增益 10ms attack / 150ms release；系数按 128 样本块更新
- 主强度 + 三段独立强度 0–100%；`amount=0` 时逐样本透明
- 串在用户 EQ 之后、等响度补偿之前；加载失败自动直通

实测：

- 离线透明性：amount=0 与输入最大差 0
- 3.5kHz 共振 + 仅高频段开启：−7.00dB；仅低频段开启时 3.5kHz 变化 0dB
- 180Hz + 仅低频段开启：−5.00dB
- 应用内：`dynEqReady=true`，GR `[-4.31, -0.33, 0]`，峰值 0.101、限制器 GR 0、无削波
- UI：滑杆 70% 标签正确；三段滑杆存在；诊断行存在；复位 0 后 GR 归零
- 备份：`backup/pre-dyneq-20261123/`

### 3.26 混响避让（ducking）与早期反射强度

- 新增 `public/js/vendor/ducking-worklet.js`：输入 0 为混响湿声，输入 1 为干声侧链；干声越大湿声压得越多，安静时自然回来
- 深度 0–100%，最大避让 -12dB；attack 10ms / release 200ms；depth=0 逐样本透明
- FDN worklet 新增 `erMix` 参数：早期反射强度 0–100%，默认 30%；“跟随预设参数”一并复位
- 均衡器页新增“混响避让”和“早期反射”滑杆；诊断页显示避让深度/实时衰减

实测：

- 避让离线：depth=0 与输入差 0；侧链强段 −12.04dB；安静 0.1s 后恢复到 −5.72dB
- 早期反射离线：erMix 0 / 0.3 / 1 → ER 峰值 0 / 0.0428 / 0.1426，FDN 早段不变
- 应用内：hall + duck 80% → `duckDb −6.62`，ER 0.6，峰值 0.085、限制器 GR 0
- UI：滑杆 45%/50% 与参数一致；诊断行存在；复位后 wet 0
- 备份：`backup/pre-reverb-duck-20261123/`

### 3.27 三段立体声宽度

- <120Hz：低频侧信号单独处理，`monoBass` 时归零
- >120Hz：基础宽度 `width`
- >4kHz：侧信号 4kHz highshelf 额外加宽，`widthHigh` 50–150%
- 用搁架而不是硬分频，避免 4kHz 交叉点的幅度凹陷
- 均衡器页新增“高频宽度”；诊断页显示高频侧增益

实测：

- 离线：`widthHigh=2` 时 1kHz 变化 +0.02dB，8kHz +5.73dB（无交叉凹陷）
- 应用内：width 1.2 / widthHigh 1.4 → 侧增益 1.2、高频侧 +2.92dB
- 人声居中模式：侧增益与高频侧均归 0
- UI：130% 标签、+2.28dB；诊断行存在；复位 100%/0dB
- 打包版：dyn/duck/tr/fdn 全部 ready；GR [-0.1,-3.58,-0.07]；duck 70% → −5.1dB；ER 0.5；width 1.2 / 高频侧 +2.28dB；峰值 0.159、限制器 GR 0；UI 与诊断行齐全；复位 normal
- 备份：`backup/pre-width3-20261123/`

### 3.28 低频激励（谐波低音增强）

- 120Hz 两阶低通取低频 → 8x 驱动软饱和 → 130Hz 高通去掉基频 → 并联回主链
- 均衡器页新增“低频激励”0–100%；诊断页显示 drive / wet
- 目的：小音箱/耳机缺乏下潜时，用 180Hz 等谐波让大脑补出低频

实测（100%）：

- 60Hz 基频 +3.08dB（少量增强），180Hz 谐波 0.111，1kHz 不变
- 应用内 drive 8 / wet 0.5；UI 60% → drive 5.2 / wet 0.3；无削波
- 备份：`backup/pre-bass-exciter-20261123/`

### 3.29 瞬态塑形前视 + 仅高频

- 2ms 前视：音频延迟 2ms，增益用未延迟包络提前建立，能抓住第一个瞬态
- `highOnly`：2kHz LR4 分频，只塑形高频段，避免底鼓/贝斯抽吸
- 参数为 0 时直通且无延迟；均衡器页新增“瞬态仅高频”开关

实测：

- 透明性：0 参数与输入差 0
- 前视：5kHz 脉冲起音 0.5 → 1.043（+6.39dB）；仅高频模式 +4.49dB
- 仅高频模式 60Hz 变化 0dB；全频模式 60Hz +0.78dB（说明抽吸被避免）
- LR4 交叉：1kHz 幅度 0.2 → 0.2
- 应用内：high=true、attack 0.8、峰值 0.36、GR −0.05
- 备份：`backup/pre-transient-look-20261123/`

### 3.30 去齿音 worklet 化

- 新增 `public/js/vendor/deesser-worklet.js`：5kHz LR4 分频 + 高频段逐采样包络压缩
- 去掉 DynamicsCompressor 的 makeup 问题与 30ms 轮询补偿
- 最大衰减 -12dB；amount=0 逐样本透明；原图节点保留为加载失败回退

实测：

- 透明性 0；1kHz −0.01dB；8kHz −9.6dB（amount=100%）
- 应用内 engine=worklet、th −30dB / ratio 3；UI 50% → −24dB / 2；GR 0
- 备份：`backup/pre-deesser-worklet-20261123/`

### 3.31 BS2B 交叉馈送参数开放

现有交叉馈送已是 BS2B 拓扑（0.3ms 耳间延迟 + 700Hz 低通 + 高频遮蔽搁架），本轮不再重复造引擎，而是开放两个核心参数：

- “交叉延迟”0.1–0.6ms、“交叉截止”400–1000Hz；中频交叉路径按 1.5× 延迟 / 1.7× 截止联动
- “BS2B 标准”按钮：crossfeed 45% / 中频 0 / 延迟 0.3ms / 截止 700Hz
- 诊断页显示延迟与截止

实测：

- 自定义 0.5ms/500Hz 生效；UI 0.4ms/600Hz 生效
- BS2B 标准按钮 → 45% / 0 / 0.3ms / 700Hz，侧增益 0.248
- 复位 0 / 0.3ms / 700Hz；无削波
- 打包版组合：de=worklet、tr/duck/dyn/fdn ready；bass drive 6.6/wet 0.4；tr high；de th −26.4/ratio 2.4；cf 0.4ms/600Hz；width 1.2/高频侧 +1.58dB；ER 0.4；duck 0.5；dyn GR [−1.69,−2.3,−2.1]；峰值 0.437、GR 0；UI/诊断齐全
- 备份：`backup/pre-cf-tune-20261123/`

### 3.32 效果面板重组 + 自定义预设

均衡器页控件过多，改为 5 个可折叠分组：

- 耳机校准（默认折叠）
- 均衡（默认展开）
- 动态（默认展开：瞬态、等响度、动态 EQ、低频激励、去齿音、低频单声道）
- 空间（默认折叠：宽度、交叉馈送、BS2B 参数）
- 混响（默认折叠：环境、FDN、前延迟、避让）

预设页顶部新增“自定义预设”：

- 输入名称保存当前效果状态；列表支持应用/删除；当前预设高亮
- 存储键 `bp.fxCustomPresets`，最多 40 个；只保存效果字段，保留 speed/pitch/perfMode/bypass/耳机校准
- 保存/应用/删除全链路实测通过；列表 1→0

### 3.33 省电模式 + 总延迟

- “省电模式”开关：强制 IR 混响、动态 EQ 归零、限制器降到 4x 多相
- 限制器 worklet 新增 `phases` 参数（4–8），实时上报当前相位数
- 诊断页新增“性能模式”“总延迟”；`AudioFX.latency()` 返回限制器 3ms + 瞬态 2ms（启用时）+ 变调延迟
- 实测：正常 FDN / 8x / 动态 EQ 0.6；省电 IR / 4x / 动态 EQ 0；关闭后恢复
- 总延迟：限制器 3 + 瞬态 2 = 5ms（不含输出缓冲；变调开启时另加 120ms）
- 14 预设全量：0 失败、0 削波；最高峰值 0.458（8D）
- 打包版：5 个分组、自定义预设保存/应用/删除、省电 IR/4x/dyn 0、总延迟 5ms、诊断行齐全
- 备份：`backup/panel-perf-20261123-final/`

### 3.34 分频点开放 + 自动化音频回归

- 瞬态分频 1–4kHz（默认 2kHz），去齿音分频 4–8kHz（默认 5kHz），低频激励截止 80–160Hz（默认 120Hz）
- 三个参数收在动态分组的“分频点 / 高级参数”折叠区，避免主界面继续变长
- worklet 在参数变化时重算 LR4 系数，不需要重载模块
- 新增 `npm run test:audio`：依次跑动态 EQ、混响避让/ER、瞬态、去齿音四个 Node 离线测试，并在关键指标不达标时返回非 0

实测：

- 应用内：瞬态 3000Hz / 去齿音 7000Hz / 低频 100Hz 生效；滑杆 2500/6500/110 与标签一致；诊断行显示分频点
- 去齿音 5kHz 信号：4kHz 分频时 0.0919，8kHz 分频时 0.1887（+6.25dB），证明分频点生效
- 瞬态 2kHz 脉冲：1kHz 分频峰值 0.826，4kHz 分频 0.518（+4.0dB）
- 组合高设置峰值 0.857、限制器 GR −0.09dB，无削波
- `npm run test:audio` 四项全部通过
- 打包版：瞬态 3500 / 去齿音 6500 / 低频 140Hz 生效；自定义预设保存/恢复分频点；省电 IR/4x；峰值 0.38、GR 0；UI/诊断齐全
- 打包版 14 预设：默认分频 2000/5000/120，最高峰值 0.426，GR ≤ −0.03，无削波
- 备份：`backup/pre-freq-tune-20261123/`

### 3.35 目标响度 / 峰值上限可选

逐轨响度归一从固定 -14 LUFS 改为可选目标：

- 目标响度：-12 / -14 / -16 / -18 LUFS（默认 -14）
- 采样峰值上限：-1.5 / -2 / -3 dBFS（默认 -1.5）
- 缓存升级到 v6，存测量响度 `{l, p}` 而不是增益 `{g, p}`；v5 缓存迁移为 `l = -14 - g`
- 换目标时对已锁定曲目立即重算增益；未锁定曲目下一测量窗生效
- 高级页新增两个下拉；诊断页显示目标、测量 LUFS、峰值上限

实测：

- 当前曲目：测量 -13.00 LUFS，目标 -14 → 增益 -1.00dB（峰值上限先绑定）
- 目标 -18 → -5.00dB；目标 -12 → -1.00dB（峰值上限限制，不能继续提升）
- 峰值上限 -3 → 增益 -2.50dB；恢复 -1.5 → -1.00dB
- 缓存 v6 示例：`{"l":-13.01,"p":0.9428}`，共 26 条
- UI：目标 -16 / 峰值 -2 下拉生效；诊断行齐全
- 打包版：测量 -13 LUFS、目标 -14 → −1dB；目标 -18 → −5dB；峰值 -2.5 不再额外压；恢复 -14/-1.5；UI/诊断正常
- 备份：`backup/pre-loud-target-20261123/`

### 3.36 动态 EQ 每段频率/Q/阈值

- 每段新增 3 个参数：频率、Q、相对阈值
  - 低：80–300Hz，Q 0.4–3，阈值 -24~-4dB
  - 中：600–2000Hz，Q 0.4–3，阈值 -24~-4dB
  - 高：2000–6000Hz，Q 0.4–3，阈值 -24~-4dB
- 默认仍为 180/1200/3500Hz、Q 0.9/1.3/1.2、阈值 -11/-13/-15dB
- worklet 在参数变化时重算带通系数；峰值滤波器系数仍按块更新
- 收在“分频点 / 高级参数”折叠区；自定义预设已包含这 9 个字段

实测：

- 设置 200/1.1/-9、1400/1.6/-11、3000/2.0/-8 全部生效
- UI 高频频率改 2800Hz，标签与调试一致
- 自定义预设保存/恢复三段参数正确
- 离线：默认高频段 3.5kHz 压 -7dB；改成 3000Hz/Q2.5/阈值-6 后只压 -1.42dB
- 打包版：220/1.2/-8、1300/1.5/-10、3200/1.8/-9 生效；GR [-1.67,-0.56,0]

### 3.37 切歌淡入淡出时长

- 高级页新增 0–3000ms 滑杆，默认 1800ms；0 表示近无缝（实际 20ms 微淡化防爆音）
- 手动切歌、自动切歌、版本切换都读取该设置；自动切歌的淡化不会超过剩余时长
- `Player.fadeMs()` / `Player.setFadeMs()`；诊断页显示当前淡化

实测：1800 → 1200 → 0（标签“近无缝”）均生效；恢复 1800。
打包版：滑杆 1000ms 生效，标签/诊断一致，恢复 1800。

### 3.38 dBTP 表 + 频谱快照回归

- 限制器 ISP 峰值增加 max hold，诊断页显示“max X dBTP · 当前 Y dBTP · 阈值 -1.0（8x 近似）”
- “重置峰值”同时清零 ISP max
- 新增 `scripts/test-spectrum.mjs`：确定性多音信号跑动态 EQ/瞬态/瞬态仅高频/去齿音，比较 6 个频段能量；FDN 比较 ER/早/中/晚能量
- 首次运行生成 `scripts/audio-baseline.json`，之后偏差 >1.5dB 返回非 0；已加入 `npm run test:audio`

实测：当前 ISP -10.17 dBTP、max -7.95 dBTP、阈值 -1.0；频谱快照通过。
打包版：ISP 当前 -6.94、max -1.74 dBTP；14 预设最高峰值 0.744（cathedral），GR ≤ -2.49，无削波。

### 3.39 自动淡化收尾 + 预设导入导出 + 限幅测试

- 自动接歌改为按用户淡化时长提前起交叉：`lead=fadePref/1000`，淡窗在曲尾前约 50ms 收尾
- 自定义预设新增导出/导入 JSON：导出 `{v:1,presets:[...]}`；导入按 `CUSTOM_FIELDS` 清洗，最多 40 个
- 新增 `scripts/test-limiter.mjs`：11.997kHz 正弦制造采样间峰值，独立 4x 48-tap 表测 ISP；断言采样峰值 ≤ -1dB 且无数字过载
- 独立 4x 表有相位/通带纹波（纯 0.891 正弦扫相位可读到 0.976），因此不作为认证表；诊断页 ISP 行明确标注“限幅前”

实测：

- 导出/导入往返：transient 0.6 / deEsser 0.5 / dynEq 0.4 / fHigh 3200 全部恢复
- 切歌淡化 1000ms 生效，恢复 1800
- 限幅测试：8x 输出采样峰值 0.8913、独立 ISP 0.9553；4x 0.9651；无 NaN
- `npm run test:audio` 现在 6 套（含频谱快照与限幅），全部通过
- 打包版：导入/导出按钮齐全，预设往返正确；切歌淡化 1200ms 生效；ISP 输入当前 -7.36/max -3.85 dBTP；诊断标签“ISP 输入峰值”
- 备份：`backup/pre-auto-fade-20261123/`、`backup/audio-20261123-final3/`

## 4. 实测

### 4.1 网易云

```text
hires    → flac / hires / 2992kbps / 75.8MB
lossless → flac / lossless / 1088kbps / 37.6MB
320      → mp3 / exhigh / 320kbps
192      → mp3 / higher / 192kbps
128      → mp3 / standard / 128kbps
```

Hi-Res 解码实测：
- `/api/nmedia?quality=hires` 返回 `Hi-Res 2992kbps`、`level=hires`、`size=75819505`
- 浏览器 `canPlayType('audio/flac') = probably`
- 临时 `Audio` 元素加载代理直链：`loadedmetadata` 成功、`duration=202.73`、`readyState=4`、播放 1.32s、无 `error`

Hi-Res 降档回退实测：
- `neMedia(id,'hires')` → `_q=hires`、`Hi-Res 2992kbps`
- 伪造播放 `error` + 回退链 `['hires','lossless']` → 自动加载 `无损 FLAC 929kbps`，无 `error`，继续播放
- 回退完成后 `_qFallback=null`，恢复原曲后 192kbps 正常播放

Hi-Res 播放器端到端：
- `bp.audioQuality=hires` + 单曲队列 → `S.quality=Hi-Res 2992kbps`
- `readyState=4`、`duration=202.7`、播放到 10s、无 `error`
- `fir64x8`、GR 0dB、`clip=false`
- 恢复原队列/原音质后 192kbps 正常播放

自动档实测：
- `navigator.connection` 为 `4g`、`saveData=false` → 自动解析为无损
- `S.quality=无损 FLAC 929kbps`、`readyState=4`、播放 8s、无 `error`
- 高级页“自动（按网络）”选中状态正确
- 恢复原队列后 192kbps 正常播放

自动档卡顿降档实测：
- 模拟 `waiting` 且无进度 6 秒 → 自动从无损降到 320kbps
- 降档后 `playbackRate` 恢复 1、继续播放、无 `error`
- 计时器在正常 `timeupdate/playing/pause/ended` 时清除
- 打包版同样通过；恢复原队列后 192kbps 正常

打包版播放：
- `花に亡霊`：`无损 FLAC 905kbps`，`readyState 4`，无 `audio.error`
- 切 320 档：`320kbps`，正常播放；切回无损正常

### 4.2 B 站

```text
BV1zZ4y1M7zN / 350604677
quality: 192kbps
id: 30280
bandwidth: 194079
codecs: mp4a.40.2
```

编码回退实测：

```text
BV1BFNBzvEBc / 30547970333
primary: 30280 / 192kbps / mp4a.40.2
alts:    30232 / 128kbps / mp4a.40.2
         30216 /  64kbps / mp4a.40.5
canPlayType('audio/mp4; codecs="ec-3"') = ''   // 杜比不可解
fake primary ec-3 + AAC alt → pickPlayableMedia 选中 192kbps AAC
实际播放：192kbps、fir32、无 error、无削波
```

DASH 视频+音频实测：

```text
BV1wM4m1Y7Ly / 1661773258（Love Song 现场）
视频：1440x1080 / 1080p / AVC
音频：30280 / 192kbps / AAC
双元素 5 秒漂移：-0.008s
暂停/播放：双元素同步
seek 60s：双元素 60.5s，漂移 -0.006s
切回音频模式：192kbps、video 暂停、muted=false、无 error
```

### 4.3 响度

- 修复前：分析器分支无 destination，长时间 `blocks=0/1`，无法锁定
- 修复后：`blocks=12`、`locked=true`、`gDb≈-10.24`、写入 `bp.loudness.v5`
- 另一首峰值较低的曲目：`gDb=+5`（上限），峰值 0.327，提升后仍安全

### 4.4 音效

- 耳机预设：`crossfeed=0.55`、`preamp=-1`、`monoBass=true`；debug crossfeed 0.303、preamp 0.891、monoBassLow 0、`postEq≈0.917`
- 13 个音效预设逐个切换：全部有频谱输出、无异常；原声恢复后 preamp=0、monoBass=false
- 原声预设：crossfeed 0，输出链透明
- 频谱峰值 >0，无静音/断链
- 打包版 `limiterReady=true`，耳机预设下仍正常出声
- 诊断页实测：48000Hz、baseLatency 20ms、outputLatency 48ms、limiterReady=true，输出峰值无削波
- 干湿同窗复测（presetTrim 生效后）：原声 -0.07dB、3D +0.15、360 -0.22、8D -0.36、演唱会 +0.10、全景 +1.83、教堂 +1.34、清澈 +0.29、高解析 +0.28、电子管 +0.74、卡带 -0.51、空灵 -1.07、耳机 +0.69；全部无削波
- B 站 live 曲目（192kbps）复测：原声/耳机/教堂/8D/全景峰值 0.19–0.37，`clip=false`，限制器未常驻压缩
- 4x FIR ISP 限幅器：`limiterReady=true`、`limiterVer=fir32`；干/湿峰值接近，仅在瞬时过载时压峰（如干 1.059 → 湿 0.895）
- 32-tap 正弦复验：997Hz 0.5 → 0.5002/GR0；997Hz 1.8 → 0.8891/GR −6.13；8kHz 1.0 → 0.8524/GR −0.98；8kHz 0.7 → 0.6684/GR0；播放 6 秒 media/ctx 均前进 6.00 秒，无断音
- 8x 64-tap 正弦复验：997Hz 1.8 → 0.8902/GR −6.3；8kHz 1.0 → 0.8913/GR −1.18；8kHz 0.7 → 0.7147/GR0；播放 6 秒 media/ctx 均前进 6.01 秒，无断音
- 自动响度基准校验（稳态 997Hz 正弦，原声预设）：14 秒后 autoDb 收敛到 −0.06dB、干/湿比 +0.05dB，说明原声 FX 链透明、autoLevel 无系统性偏置
- 打包版复验：网易云 `无损 FLAC 1106kbps`；原始峰值 0.419、增益上限 +6.06dB，因此允许 +5dB 提升，输出峰值 0.316、无削波；耳机/教堂/全景/清澈/8D 切换均 `clip=false`、`limiterReady=true`
- 耳机预设新增高频头影后：`crossfeed=0.303`、`cfShelf=-1.38dB`；B 站 192kbps live 曲目输出峰值 0.373、无削波、限制器衰减 0dB
- 限制器正弦硬验证（4x FIR）：997Hz 输入 0.5 → 输出 0.500、GR 0dB；997Hz 输入 1.8 → 输出 0.890、GR −6.12dB；8kHz 输入 1.0（基带采样峰值仅 0.866）→ GR −1.01dB、输出基带峰值 0.842，证明能检测采样间峰值且不削波；8kHz 输入 0.7 → GR 0dB
- 打包版复验：B 站 `冬眠 (前世Live 2021)` 192kbps，耳机预设 `cfShelf=-1.38dB`、限制器衰减 0dB、输出峰值 0.116、无削波
- 自动响度实测：教堂收敛到约 −1.2dB、全景 −0.5~−1.1dB，干/湿差约 −0.1dB，`clip=false`、GR≈0；开关可即时恢复/重新收敛
- 限制器离线自检（OfflineAudioContext）：热段 0.89、低段 0.496、`ok=true`、`ver=fir64x8`；打包版同样通过
- A/B 旁通：教堂预设 wet 时 dry=0/wet=1；旁通时 dry=1/wet=0，输出峰值 0.428、`clip=false`；打包版同样通过
- 变调主链：997Hz +6 半音 → 1406.3Hz，回 0 → 996.1Hz；稳态 1400 块 underrun +1，打包版 `pitchParam=6`、无 error、无削波
- Signalsmith 变调：base 996.1Hz、+6 → 1412.1Hz、回 0 → 996.1Hz、latency 0.12s；打包版 engine=signalsmith、峰值 0.4362、无削波、UI 开关存在
- 耳机优化+：`cf=0.385`、`cfMid=0.123`、`shelf=-2.28`、`trim=-1`、autoDb 0.29、峰值 0.3235、`clip=false`；预设卡片/中频滑杆存在
- 耳机校准：Sony WH-1000XM4 → Preamp -6.1dB、10 filters、hpPreamp 0.495、autoGain 1、峰值 0.2056、无削波；搜索/Profile API 与 UI 均正常
- FDN 混响：hall/church 均 `engine=fdn`、`fdnWet=1`、无削波；可切回卷积 IR；打包版正常
- 3 段夜听：compTh [-18,-21,-24]，reduction [-1.6,-0.2,-0.4]，peak 0.4317、无削波
- 双 Panner 旋转：3D/360/8D 均无削波；3D 音乐 RMS +1.6dB，8D GR −0.08；打包版正常
- 磁带/电子管：cassette 预加重 3.4dB/去加重 -3.4dB/磁头 bump 1.27dB；tube 中频 0.84dB；均无削波
- 去齿音：8kHz 正弦衰减 -5.3dB；音乐 reduction -3.3、无削波；打包版正常
- 夜听强度：amount 1/0.5/0 对应 compTh [-18/-21/-24]、[-9/-10.5/-12]、[0/0/0]；无削波
- FDN 参数：自动 1.2/2/0.3，手动 1.6/5/0.6，重置回自动；无削波

### 4.5 响度峰值约束

- 修复前：K 加权峰值 1.65 被误当节目峰值，导致过度衰减；后来完全移除峰值保护，又出现 +5dB 增益把原始峰值推到 1.6、限制器持续压 6dB 的问题
- 修复后：原始峰值分析器与 K 加权响度分离，增益上限 `-1.5dBFS - peakDb`
- `bp.loudness.v5` 缓存 `{g,p}`；加载时重新按峰值校验
- 测量窗口从 8 秒延长到 30 秒 / 50 块，未锁定时用累计门限积分，避免长前奏 Live 被永久 +5dB
- 锁定后峰值守卫：后段峰值升高时缓慢下调增益并写回缓存
- B 站 live 曲目：原始峰值 0.927、增益 -6.01dB、输出峰值 0.482、无削波
- 网易云高响度曲目：原始峰值 0.999、增益 -7.64dB、峰值上限 -1.49dB、无削波
- `冬眠 (前世Live 2021)` 实测：
  - 旧 8 秒窗口：+5.00dB、峰值 0.088，后段峰值升到 1.27，限制器持续压 3.2dB
  - 新 30 秒窗口：+2.22dB、峰值 0.651，后段峰值 0.965，峰值守卫降到 -1.19dB；限制器 GR 从 -3.2dB 降到约 0dB
  - 继续播放到 354s 又出现 0.9935 峰值，守卫最终降到 -1.44dB，缓存写回 `{g:-1.44,p:0.9935}`
  - 打包版复验：`limiterVer=fir16`、GR 0dB、输出峰值 0.783、无削波；下次播放直接使用安全增益

### 4.6 MV 样式 × 音效预设全量回归

- 测试曲目：B 站 `冬眠 (前世Live 2021)`，192kbps，34 行歌词，动态 MV 运行中
- 覆盖：19 个 MV 样式 × 13 个音效预设 = **247 组合**
- 结果：**0 失败**
  - 每个样式切换后 `LyricMV.debug().style` 正确、`running=true`、`frames` 持续增长
  - 所有组合 `AudioContext.state=running`、`peak>0`、`clip=false`
  - GL 渲染器 `glStage=ready`、`glErr` 为空
  - 结束后恢复 `flow` + `original`，限制器 `fir16`、GR 0dB、输出峰值 0.484、无削波

---

## 5. 备份

- `backup/pre-audio-quality-20261121/`
  - `audiofx.js`
  - `player.js`
  - `app.js`
  - `bilibili.js`
  - `netease.js`
  - `server.js`
  - `style.css`
  - `index.html`
- `backup/pre-audio-preset-trim-20261121/`
  - `audiofx.js`（加入 presetTrim / 三次插值限幅器之前）
  - `AUDIO-QUALITY-RESEARCH-20261121.md`
- `backup/pre-crossfeed-shelf-20261122/`
  - `audiofx.js`、`peak-limiter-worklet.js`、`app.js`（加入高频头影/GR 读数之前）
- `backup/pre-truepeak-fir-20261122/`
  - `peak-limiter-worklet.js`（三次插值 → 4x 16-tap FIR 之前）
- `backup/pre-autolevel-20261122/`
  - `audiofx.js`、`app.js`、`style.css`（加入 autoLevel 之前）
- `backup/pre-truepeak-fir32-20261122/`
  - `peak-limiter-worklet.js`、`audiofx.js`（16-tap → 32-tap 之前）
- `backup/pre-truepeak-fir64-20261122/`
  - `peak-limiter-worklet.js`、`audiofx.js`（32-tap → 64-tap 之前）
- `backup/pre-fir8x-20261122/`
  - `peak-limiter-worklet.js`、`audiofx.js`（4x 64-tap → 8x 64-tap 之前）
- `backup/pre-codec-fallback-20261122/`
  - `src/bilibili.js`、`public/js/player.js`（加入 DASH 音频候选/编码回退之前）
- `backup/pre-hires-20261122/`
  - `src/netease.js`、`server.js`、`public/js/player.js`、`public/js/app.js`（加入 Hi-Res 档之前）
- `backup/pre-hires-fallback-20261122/`
  - `public/js/player.js`（加入 neMedia/播放中降档回退之前）
- `backup/pre-auto-quality-20261122/`
  - `public/js/player.js`、`public/js/app.js`（加入自动音质档之前）
- `backup/pre-selftest-20261122/`
  - `public/js/audiofx.js`、`public/js/app.js`（加入限制器自检之前）
- `backup/pre-stall-downgrade-20261122/`
  - `public/js/player.js`（加入自动档卡顿降档之前）
- `backup/pre-ab-bypass-20261122/`
  - `public/js/audiofx.js`、`public/js/app.js`（加入 A/B 旁通之前）
- `backup/pre-dash-video-20261122/`
  - `src/bilibili.js`、`server.js`、`public/js/player.js`、`public/js/app.js`（加入 DASH 双流视频之前）
- `backup/pre-pitch-main-20261122/`
  - `public/js/audiofx.js`（变调移入主链之前）
- `backup/pre-mid-crossfeed-20261122/`
  - `public/js/audiofx.js`、`public/js/app.js`（加入中频交叉/耳机优化+之前）
- `backup/pre-signalsmith-20261122/`
  - `public/js/audiofx.js`、`public/js/app.js`（加入 Signalsmith 变调引擎之前）
- `backup/pre-headphone-cal-20261122/`
  - `server.js`、`public/js/audiofx.js`、`public/js/app.js`、`public/css/style.css`（加入耳机校准之前）
- `backup/audio-quality-20261121-final/`
  - 上一阶段稳定快照（FIR/30s 窗口之前），可用于回退

---

## 6. 下一步（音质/音效 P1/P2）

### P1

1. **True Peak limiter（过采样版）**
   - 已有 3ms lookahead + 8x 64-tap 多相 FIR ISP 检测
   - 仍非标准带限/过采样 True Peak 表；可继续做 8x 多相或标准带限滤波
2. **更好的 crossfeed** ✅ 已完成
   - 700Hz 低通 + 1.2kHz 中频带通 + 直通高频架
   - “耳机优化+”预设：crossfeed 0.7 + crossfeedMid 0.35
   - 仍可继续做更精细的耳道模型/分频延迟
3. **单声道低频** ✅ 已完成（`monoBass`）
4. **预设响度对齐** ✅ 已完成（13 个 presetTrim，复测 ±0.7dB 为主）
5. **预设回归** ✅ 已完成（19 个 MV 样式 × 13 个音效预设 = 247 组合，0 失败）
6. **音频诊断面板** ✅ 已完成（含原始峰值/峰值上限/预设补偿）

### P2

- **本地 ASR 无关**：音频质量优先于效果数量
- **bit-perfect/WASAPI 独占**：Electron/Chromium 无法直接做到；需要 native addon 或外部 mpv/libmpv 后端，工程量大，暂不做
- **DASH 视频+音频分离** ✅ 已完成（实验开关，默认关闭；1080p AVC + 192k AAC 双流同步）
- **高质量变调** ✅ 已接入可选 Signalsmith Stretch（WASM/AudioWorklet，MIT）；默认仍 SoundTouch，延迟 0.12s
- **响度缓存按专辑/版本**：同一录音不同版本不要共用增益
- **音效自动响度（动态）** ✅ 已完成（`autoLevel`，默认开启，可在高级页关闭）

---

## 7. 关键文件

| 文件 | 作用 |
|---|---|
| `src/netease.js` | 网易云 songUrl 档位/Hi-Res/无损/cache/label |
| `src/bilibili.js` | B 站 DASH audio 优先级/label/fnval |
| `server.js` | `/api/nmedia?quality=` |
| `public/js/player.js` | AudioContext、响度、媒体加载、quality 传递 |
| `public/js/audiofx.js` | EQ/混响/宽度/交叉馈送/饱和/限幅 |
| `public/js/app.js` | 音效面板、音质选择、MV |
| `public/css/style.css` | 音效面板/滑杆 |

---

## 8. 当前状态

- 打包版已启动，端口 `8899`
- 当前歌曲：B 站 `【4K杜比视界】陶喆《今天没回家》`，`192kbps`
- 音效预设：原声；`limiterReady=true`、`limiterVer=fir64x8`；限制器衰减 0dB；无削波
- 耳机预设：`crossfeed=0.303`、`cfShelf=-1.38dB`、`monoBass=开`
- 响度增益 -3.74dB（原始峰值 1.097，峰值上限 -2.31dB；30 秒窗口 + 峰值守卫已生效）
- 输出峰值 0.211，`clip=false`
- B 站 DASH 编码回退：primary 30280 AAC 192kbps；alts 30232/30216；杜比 ec-3 主候选会自动回退到 AAC
- DASH 视频+音频：实验开关默认关闭；实测 1440x1080 / 1080p · 192kbps，双流漂移 -0.008s
- 网易云音质选择新增 `Hi-Res（实验·文件较大）`：实测 `Hi-Res 2992kbps`、FLAC 可解码播放；默认仍为无损
- 网易云降档回退：Hi-Res/无损直链播放失败会自动降一档重试，保留播放进度
- 网易云音质新增“自动（按网络）”：4g 实测无损；慢网/省流走 320；不自动 Hi-Res
- 自动档卡顿降档：连续 waiting 6 秒自动降一档，恢复后继续播放
- A/B 旁通：预设页可一键听原声，只绕过 FX，不改音量/响度归一
- DASH 视频+音频：高级页实验开关；1080p AVC + 192k AAC 双流同步，默认关闭
- 变调：修复“仅夜听生效”，移到主链分叉前；SoundTouch 60/25/12 + lanczos
- 中频交叉 + “耳机优化+”预设：1.2kHz 带通 + 0.45ms，cf 0.7/cfMid 0.35
- 变调新增可选 Signalsmith Stretch 引擎（0.12s 延迟，默认 SoundTouch）
- 耳机校准：AutoEQ 搜索/导入 + 10 段参数 EQ，校准期间暂停自动响度
- FDN 算法混响：8 通道 + 4 级扩散 + Householder + 阻尼/调制，可切回卷积 IR
- 夜听升级为 3 段压缩：200/2000Hz LR4 分频，低频多压、高频保留清晰度
- 3D/8D 改为双 HRTF Panner + 相位偏移 + 中心填充，保留立体声宽度
- 磁带加预加重/去加重/磁头 bump，电子管加中频染色/DC 阻断
- 新增去齿音：5kHz 动态高频压缩 + makeup 反向补偿
- 夜听改为 0–100% 强度连续可调，amount=0 完全旁通
- FDN 混响新增大小/衰减/阻尼参数与“跟随环境预设”
- vendor/依赖清理：`@soundtouchjs/audio-worklet`、`signalsmith-stretch` 已从 package.json 移除，仅保留 `public/js/vendor` 文件；来源/许可证见 `public/js/vendor/README.md`
- 最终回归：14 预设 0 失败；双变调引擎频谱正确；限制器自检 `hot=0.89/low=0.496`；精简打包版复验通过
- 变调新增可选 Signalsmith Stretch 引擎（0.12s 延迟，默认 SoundTouch）
- 耳机校准：AutoEQ 搜索/导入 + 10 段参数 EQ，校准期间暂停自动响度
- FDN 算法混响：8 通道 + 4 级扩散 + Householder + 阻尼/调制，可切回卷积 IR
- 夜听升级为 3 段压缩：200/2000Hz LR4 分频，低频多压、高频保留清晰度
- 3D/8D 改为双 HRTF Panner + 相位偏移 + 中心填充，保留立体声宽度
- 磁带加预加重/去加重/磁头 bump，电子管加中频染色/DC 阻断
- 新增去齿音：5kHz 动态高频压缩 + makeup 反向补偿
- 夜听改为 0–100% 强度连续可调，amount=0 完全旁通
- FDN 混响新增大小/衰减/阻尼参数与“跟随环境预设”
- FDN 新增 15 抽头早期反射（7–140ms，左右错开 1.7ms）；湿声 180Hz 低切 + 10kHz 柔化；前延迟 0–120ms 可调
- 新增瞬态塑形：双包络打击感/尾音收敛，0 参数逐样本透明，串在去齿音后
- 新增等响度补偿：音量越低，110Hz/9kHz 搁架补偿越多（最多 +8/+4dB）
- 新增动态 EQ：180Hz/1.2kHz/3.5kHz 三段窄带动态衰减，按带内/全频相对能量触发
- 混响新增避让（ducking，最大 -12dB）与早期反射强度 0–100%
- 立体声宽度改为三段：<120Hz 单声道、>120Hz 基础宽度、>4kHz 侧信号搁架加宽
- 新增低频激励（谐波低音）、瞬态 2ms 前视/仅高频、去齿音 worklet、BS2B 参数开放
- 效果面板改为 5 个折叠分组；新增自定义预设保存/应用/删除
- 新增省电模式（IR 混响 / 动态 EQ 关 / 4x 限制器）与总延迟显示
- 瞬态/去齿音/低频激励分频点开放；`npm run test:audio` 自动化回归
- 目标响度 -12/-14/-16/-18 LUFS 与采样峰值上限 -1.5/-2/-3 dBFS 可选，缓存升级 v6
- 动态 EQ 每段频率/Q/阈值开放；切歌淡化 0–3000ms 可调；dBTP 表与频谱快照回归
- 自动淡化按用户时长收尾；自定义预设导入/导出；限幅 ISP 回归测试
- 19 个 MV 样式 × 13 个预设全量回归：247 组合，0 失败
- 14 预设音频链回归：0 失败，全部 `ctx=running`、`peak>0`、`clip=false`、`limiterReady=true`
- 双变调引擎：SoundTouch 997+6→1406.3Hz；Signalsmith 997+6→1412.1Hz（latency 0.12s）
- 限制器离线自检：热段 0.89 / 低段 0.496 / `ok=true`
- 自动响度：默认开启；教堂/全景实测干湿差约 −0.1dB，无泵浦；打包版教堂预设 8 秒 autoDb +1.13dB、GR 0dB、无削波，高级页开关已生效
- 备份：`pre-audio-quality-20261121`、`pre-audio-preset-trim-20261121`、`pre-crossfeed-shelf-20261122`、`pre-truepeak-fir-20261122`、`pre-truepeak-fir32-20261122`、`pre-truepeak-fir64-20261122`、`pre-fir8x-20261122`、`pre-autolevel-20261122`、`pre-codec-fallback-20261122`、`pre-hires-20261122`、`pre-hires-fallback-20261122`、`pre-auto-quality-20261122`、`pre-selftest-20261122`、`pre-stall-downgrade-20261122`、`pre-ab-bypass-20261122`、`pre-dash-video-20261122`、`pre-pitch-main-20261122`、`pre-mid-crossfeed-20261122`、`pre-signalsmith-20261122`、`pre-headphone-cal-20261122`、`audio-quality-20261121-final`、`audio-quality-20261122-final`
- 本轮已完成：8x 64-tap FIR ISP 限幅、30 秒累计响度窗口、锁定后峰值守卫、13 预设响度对齐、响度峰值约束与 v5 缓存、BS2B 高频头影、限制器实时 GR 读数、MV×预设全量回归、音效自动响度、B站 DASH 音频编码回退、网易云 Hi-Res 档、自动音质/卡顿降档、A/B 旁通、DASH 视频+音频双流、中频交叉/耳机优化+、双变调引擎
