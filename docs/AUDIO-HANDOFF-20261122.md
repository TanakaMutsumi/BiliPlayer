# 音质 / 音效模块交接（2026-11-22）

> 项目：`C:\Users\16493\Desktop\b站音乐播放器`  
> 范围：源音质、媒体加载、响度归一、AudioFX 音效链、True Peak 限制器、耳机交叉馈送、自动响度、诊断  
> 说明：私有 API、版权音频，仅个人本地使用。本文是交接文档；调研与逐轮记录见 `docs/AUDIO-QUALITY-RESEARCH-20261121.md`。

---

## 1. 结论先行

当前音频链路已经形成完整闭环：

1. **源音质**：网易云支持 Hi-Res / 无损 / 320 / 192 / 128；B 站支持 DASH Hi-Res / 杜比 / 192k / 128k / 64k，并按浏览器 codec 支持自动回退。
2. **响度**：EBU R128 门限积分 + 30 秒累计窗口 + 原始峰值上限 + 锁定后峰值守卫，避免“为拉响而压扁动态”。
3. **音效**：10 段 EQ、磁带、电子管、M/S 宽度、程序化混响、HRTF 旋转、激励、夜听压缩、交叉馈送、预设响度对齐、慢速自动响度。
4. **输出安全**：8x 64-tap 多相 FIR ISP 检测 + 3ms lookahead 限制器 + 0.97 软限幅 + 实时 GR 读数。
5. **诊断**：音质、采样率、缓冲延迟、响度增益/峰值上限、输出峰值、限制器衰减、预设补偿、自动响度、交叉馈送。
6. **回归**：19 个 MV 样式 × 13 个音效预设 = 247 组合，0 失败。

---

## 2. 架构与数据流

```text
B站 DASH / 网易云 URL
        │
        ▼
/api/stream 本地代理（避免 WebAudio 跨域污染）
        │
        ▼
<audio> / <video>
        │
   MediaElementSource
        │
   EQ(A/B) → 响度归一 normA/normB → 交叉淡化 gainA/gainB
        │
        ▼
   AudioFX.fxIn
        │
   preamp → 10段EQ + bass/treble → postEq
        │
   磁带(全湿/旁通) → 电子管(并联) → M/S宽度 + 低频单声道
        │
   程序化混响 → HRTF旋转 → 激励 → 夜听压缩(可选)
        │
   交叉馈送(对侧低通+延迟+直通高频架)
        │
   presetTrim(静态预设补偿) → autoGain(自动响度)
        │
   lookahead 限制器(8x 64-tap FIR ISP)
        │
   安全软限幅(0.97)
        │
   finalOut → 输出分析器 → 主音量 gainNode → destination
```

关键点：

- `AudioFX` 插在交叉淡化之后、主音量之前；主音量不影响频谱/响度测量。
- 分析器必须有到 `destination` 的 0 增益哑通道，Chromium 才会持续拉取。
- 响度归一在 FX 之前；自动响度只比较 FX 干/湿，不碰媒体响度。
- 限制器在 FX 末端；`safety` 是最后兜底。

---

## 3. 源音质

### 3.1 网易云

`src/netease.js`：

- `songUrl(id, preferredBr)`
  - `1999000` → Hi-Res（实测 24bit FLAC，约 3Mbps，75MB 级）
  - `999000` → 无损 FLAC
  - `320000` → 320kbps
  - `192000` / `128000` → 对应档
  - Hi-Res 失败自动退无损/320k
- `neQualityLabel`
  - 先判断 `hires / jyeffect / sky`，再判断 `lossless / flac / br`
  - 避免 Hi-Res 被误标成“无损 FLAC”
- 直链缓存：`id|br`，8 分钟；最多 80 条
- `2999000` 返回 `jyeffect`（高清环绕声），不是更高解析，未默认使用
- `neMedia(id, q)`：按 `hires → lossless → 320 → 192 → 128` 逐档尝试
- 播放中 `error`：按回退链自动降一档重试，保留当前 `currentTime`；成功后清除 `_qFallback`
- 自动档下连续 `waiting` >6 秒自动降一档；手动选的档位不会因卡顿被改

`server.js`：

```text
/api/nmedia?id=&quality=hires|lossless|320|192|128
hires → 1999000
lossless → 999000
```

客户端：

- `bp.audioQuality` 持久化档位，默认 `auto`
- `auto`：`saveData` 或 `effectiveType=slow-2g/2g/3g` → 320k；其余 → 无损；不自动 Hi-Res
- 加载、预取、网易云交叉切换都带 quality
- 高级页选项：`自动（按网络） / Hi-Res（实验·文件较大） / 自动无损 / 320 / 192 / 128`
- 下一首生效

### 3.2 B 站

`src/bilibili.js`：

- `AUDIO_PRIORITY = [30251, 30250, 30280, 30232, 30216]`
- `AUDIO_LABEL = Hi-Res / 杜比 / 192kbps / 128kbps / 64kbps`
- `fnval: 4048`
- `playAudio` 返回主候选 + `alts`（全部可用候选，含 id/quality/url/codecs）

客户端 `public/js/player.js`：

- `pickPlayableMedia(m)` 用 `audio.canPlayType('audio/mp4; codecs="..."')` 选第一个可解码候选
- Chromium 实测：
  - `mp4a.40.2` / `mp4a.40.5` / `flac`（MP4）→ `probably`
  - `ec-3` / `ac-3` → 空（杜比不可解）
- 杜比主候选会自动回退到 30280/30232/30216 AAC
- 预取、普通加载、交叉淡化、Buffer 交叉都走同一选择逻辑

---

## 4. 媒体加载与无缝切换

`public/js/player.js`：

- 双元素 `audio` / `video`，各自 `MediaElementSource`、EQ、响度归一、交叉增益
- `load(item, {seek, autoplay})`：统一加载入口
- `prefetchNext()`：当前歌开播后预取下一首直链（B 站 `/api/media`，网易云 `/api/nmedia`）
- `crossfadeTo` / `crossfadeToBuffer`：交叉淡化 / Buffer 交叉
- `ensureCid`：B 站切歌前补 cid
- `S.quality`：实际档位与码率
- 音量：`gainNode` 总音量，`audio.volume=1`，频谱/响度不受音量影响

### 4.1 DASH 视频+音频（实验）

- `src/bilibili.js` `playVideoDash`：1080p AVC video-only + 30280/30232 AAC audio-only
- `server.js`：`/api/media?kind=video&dash=1`
- `playDashAV`：
  - video 元素播放画面（muted），audio 元素走 FX/响度链
  - `S.dashAV=true`、`S.slot='a'`
  - 播放/暂停/seek 双向镜像；每 1s 校正，漂移 >0.15s 对齐
  - error 自动回退普通 720p mp4
- 高级页开关“看视频 DASH 1080p（实验·双流同步）”，默认关闭
- 实测：1440x1080 / 1080p · 192kbps、5 秒漂移 -0.008s、seek 60s 漂移 -0.006s、切回音频正常

---

## 5. 响度归一

`public/js/player.js`：

- 每元素独立 `normA/normB`
- K 加权：highshelf 1681.97Hz +4dB + highpass 38.13Hz
- 400ms 块；绝对门限 -70 LUFS；相对门限 integrated-10 LU
- **30 秒 / 至少 50 块**后锁定；未锁定时用累计门限积分，不用单块响度
- 目标 -14 LUFS；增益限幅 -12..+5dB
- **原始峰值分析器**（未 K 加权）与 K 加权响度分离
- 增益上限：`-1.5dBFS - 20log10(rawPeak)`
- **锁定后峰值守卫**：后段出现更高峰值时，缓慢下调增益（tau 2s），只降不升，写回缓存
- 缓存：`bp.loudness.v5`，值 `{g, p}`；加载时按峰值重新校验
- 分析器 0 增益哑通道到 destination

实测：

- B 站 live 192kbps：原始峰值 0.927 → 增益 -6.01dB，输出 0.482，无削波
- 网易云高响度：原始峰值 0.999 → 增益 -7.64dB，峰值上限 -1.49dB
- `冬眠 Live`：旧 8 秒窗口 +5dB，后段限制器压 3.2dB；新 30 秒 + 峰值守卫最终 -1.44dB，GR 0dB

---

## 6. AudioFX 音效链

`public/js/audiofx.js`：

- `window.AudioFX`，状态持久化 `bp.audioFx`
- 10 段 EQ：31/63/125/250/500/1k/2k/4k/8k/16k
- bass 95Hz lowshelf / treble 13kHz highshelf
- 磁带：抖晃多 LFO + 滚降 + 预加重(+4×tape@3.5k) → 饱和(4x) → 去加重(-4×tape) + 磁头 bump(+1.5×tape@90Hz) + 粉噪嘶声；全湿避免梳状滤波
- 电子管：并联软饱和，曲线按小信号归一；900Hz mid +1.2×tube；20Hz DC 阻断；4x 过采样
- 去齿音：worklet 内 LR4 分频（4–8kHz，默认 5kHz）+ 高频段逐采样压缩，最大 -12dB；原图节点保留为回退
- 低频激励：两阶低通（80–160Hz，默认 120Hz）→ 8x 驱动软饱和 → 高通（截止 +10Hz）→ 并联；100% 时 60Hz +3dB、180Hz 谐波明显
- 瞬态塑形：2ms 前视 + LR4“仅高频”模式（分频 1–4kHz，默认 2kHz）；0 参数直通无延迟
- 交叉馈送：BS2B 拓扑，新增耳间延迟 0.1–0.6ms 与截止 400–1000Hz 可调，附“BS2B 标准”按钮
- 面板：均衡器页拆成耳机校准/均衡/动态/空间/混响 5 个折叠分组；预设页顶部有自定义预设保存/应用/删除/导入/导出
- 省电模式：IR 混响 + 动态 EQ 关 + 限制器 4x；诊断页显示总延迟（限制器 3ms + 瞬态 2ms + 变调延迟 + 输出缓冲）
- 瞬态塑形：双包络（fast 0.8/50ms，slow 30/300ms），起音最多约 +6.4dB，尾音最多约 −2.7dB；增益 2ms 平滑；参数 0 时逐样本透明
- 等响度补偿：110Hz lowshelf + 9kHz highshelf，增益 = loudness × (1−音量)^1.2 × (8dB/4dB)；音量变化 150ms 平滑
- 动态 EQ：三段窄带，带通检测 + 峰值滤波器动态衰减；相对检测（带内/全频），最大 5/5/7dB，块率更新
- 动态 EQ 每段频率/Q/阈值可调（低 80–300Hz、中 600–2k、高 2k–6k；Q 0.4–3；阈值 -24~-4dB）
- 切歌淡入淡出 0–3000ms 可调（默认 1800ms，0=20ms 微淡化）；自动接歌按该时长提前起交叉，曲尾前约 50ms 收尾
- ISP 峰值 max hold，诊断页显示 dBTP；频谱快照回归 `scripts/test-spectrum.mjs` + `audio-baseline.json`
- 混响避让：干声侧链控制湿声，深度 0–100%，最大 -12dB；早期反射 erMix 0–100%（默认 30%）
- 三段宽度：<120Hz 低频侧信号；>120Hz 基础宽度；>4kHz 侧信号 highshelf 额外加宽
- M/S 宽度：>120Hz 与 <120Hz 分开，`monoBass` 时低频侧信号归零
- 混响：双引擎
  - 卷积 IR：程序化 IR（粉噪尾 + 早期反射 + 高频阻尼 + 立体声去相关）
  - FDN 算法：8 通道 + 4 级全通扩散 + Householder 反馈 + 一阶阻尼 + 慢速调制
  - FDN 早期反射：15 抽头 7–140ms，右声道 +1.7ms 去相关，6.5kHz 柔化，随 size 缩放，混入 0.3
  - 湿声总线 180Hz 高通 + 10kHz 低通；干声全频直通
  - `convWet/fdnWet` 100ms 交叉淡化；加载失败回退 IR；默认 FDN
  - FDN 大小/衰减/阻尼可手动覆盖，或“跟随环境预设”
  - 前延迟 0–120ms 可调；`envPre=null` 跟随环境预设
- 旋转：双 HRTF Panner + LFO，高频 L/R 拆分，右 Panner 相位偏移；低频分离居中
  - 3D spread 0.28/fill 0.22/makeup 1.7
  - 360 0.32/0.20/1.8
  - 8D 0.12/0.40/1.35
- 激励：2.8k→9k 带限软饱和
- 夜听：3 段压缩（200/2000Hz LR4 分频）
  - 低 <200Hz：-18dB / 2.4:1 / 20ms / 350ms
  - 中 200–2000Hz：-21dB / 2.0:1 / 15ms / 280ms
  - 高 >2000Hz：-24dB / 1.5:1 / 8ms / 180ms
  - 段增益 0.95/1/1，求和后进限制器 + nightTrim 0.708；夜听关闭 limWet=0
  - `nightAmount` 0–100% 连续缩放 threshold/ratio/nightTrim；0 时完全旁通
- 交叉馈送：对侧 0.3ms + 700Hz 低通 + 可调衰减；直通 1.2kHz 高频架 `-2.5×crossfeed`
- 中频交叉：1.2kHz 带通 + 0.45ms，增益 `0.35×crossfeedMid`；直通 shelf 额外 `-1.5×crossfeedMid`
- 预设“耳机优化+”：crossfeed 0.7 + crossfeedMid 0.35 + monoBass + preamp -1.5
- 耳机校准：AutoEQ 10 段参数 EQ（PK/LSC/HSC）放在用户 EQ 之前；hpDry/hpWet 交叉淡化；Preamp 独立增益；校准开启时暂停 autoLevel
- 校准强度 0–100%：同时缩放 Preamp/filter gain；A/B 旁通按 Preamp 等响；Profile 优先直取文件路径
- 预设：13 个；每个带 `presetTrim` 静态响度补偿
- 自动响度：`autoLevel` 默认开启；干/湿 RMS 4s EMA，500ms tick，±4dB，tau 0.6s
- 安全软限幅：0.97 以下透明，以上 tanh
- A/B 旁通：`bypass` 时干声 `fxIn → finalOut`，湿声经 `bypassWet`；50ms 缓变，不改音量/响度归一
- 变调：`compIn → pitchIn → [bypass 或 pitchNode→pitchWet] → pitchOut → limDry/trim`；pitch=0 直通，夜听开/关都生效
- SoundTouch：lanczos、sequenceMs=60、seekWindowMs=25、overlapMs=12；指标 underrun/framesBuffered/outputRms/peak
- 可选 Signalsmith Stretch（MIT，JS/WASM，`public/js/vendor/signalsmith-stretch.mjs`）：latency 0.12s，高级页开关，默认仍 SoundTouch
- 输出分析器：峰值/RMS/最大峰值/削波

预设响度补偿实测：

| 预设 | presetTrim |
|---|---:|
| 原声 | 0 |
| 3D | -1.5 |
| 360 | -1.9 |
| 8D | +0.8 |
| 演唱会 | -1.4 |
| 全景 | +1.3 |
| 教堂 | -1.7 |
| 清澈 | +3.2 |
| 高解析 | +0.8 |
| 电子管 | +3.5 |
| 卡带 | +1.2 |
| 空灵 | -3.0 |
| 耳机 | +1.2 |

---

## 7. True Peak 限制器

`public/js/vendor/peak-limiter-worklet.js`：

- 3ms lookahead 延迟环
- 瞬时 attack / 120ms release
- 立体声联动
- **8x 64-tap 多相 FIR**（8 相位 × 64 抽头 Hamming 窗 sinc）检测 ISP
- 阈值 -1dBFS
- 每 ~100ms 上报本块最小增益 `{grDb, ver:'fir64x8', peak, thr}`
- 接在交叉馈送/自动响度之后、安全软限幅之前

实测：

- 997Hz 0.5 → 0.5002、GR 0
- 997Hz 1.8 → 0.8901、GR -6.12dB
- 8kHz 1.0（基带采样峰值 0.866）→ 0.8801、GR -0.97dB
- 8kHz 0.7 → 0.6888、GR 0
- 6 秒播放 media/ctx 均前进 6.00 秒，无断音

---

## 8. 诊断 / 调试接口

`AudioFX.debug()`：

- EQ 增益、bass/treble、混响 wet/IR、旋转、M/S、preamp、crossfeed、cfShelf
- `limiterReady / limiterVer / limiterGrDb / limiterPeak / limiterThr / preLimPeak`
- `presetTrimDb / presetTrimGain`
- `autoLevel / autoDb / autoGain / autoDry / autoWet`
- `pitchParam`、`ctxState`、`ctxTime`

`AudioFX.meter()`：

- `{peak, rms, maxPeak, clip}`

`Player.audioDebug()`：

- `ctx / sampleRate / baseLatency / outputLatency`
- `activeLoud {key, gDb, locked, peak, peakCapDb}`
- `master / eqA / eqB / ga / gb / normA / normB / loudA / loudB`

诊断页（音效面板 → 诊断）：

- 歌曲、音质、采样率、缓冲/输出延迟
- 响度增益、原始峰值、增益上限
- 输出峰值、最大峰值、是否削波
- 限制器是否加载、实时衰减、FIR 版本
- 预放大、预设补偿、自动响度
- 交叉馈送、中频交叉、去齿音、低频单声道、当前预设、A/B 旁通状态、变调 underrun/缓冲、耳机校准、混响引擎、混响前延迟/湿声频宽、瞬态塑形、等响度补偿、动态 EQ、混响避让、三段宽度、低频激励、去齿音 worklet、BS2B 参数
- “限制器自检”：`AudioFX.selfTest()` 用 OfflineAudioContext 静默渲染 997Hz；热段 1.8 → 0.89、低段 0.5 → 0.5，不发声

---

## 9. 持久化键

| key | 作用 |
|---|---|
| `bp.audioQuality` | 网易云音质档位：hires/lossless/320/192/128 |
| `bp.audioFx` | AudioFX 全部状态（preset/eq/width/env/rotate/tube/tape/exciter/night/pitch/vocal/crossfeed/preamp/monoBass/presetTrim/autoLevel） |
| `bp.loudness.v5` | 每曲响度缓存 `{g,p}` |
| `bp.vol` | 主音量 |
| `bp.mvOn` / `bp.mvStyle` / `bp.mvVideo` | MV 状态（音效回归相关） |
| `bp.playlists` | 歌单（非音频） |

---

## 10. 测试矩阵与结果

### 10.1 源音质

- 网易云：hires / lossless / 320 / 192 / 128 均返回正确 URL 与标签
- Hi-Res：`Hi-Res 2992kbps`、75.8MB、FLAC 可解码、`readyState=4`、播放正常
- Hi-Res 降档回退：伪造 error + `['hires','lossless']` → 自动加载无损 929kbps，无 error，继续播放
- Hi-Res 端到端：`bp.audioQuality=hires` + 单曲队列 → `S.quality=Hi-Res 2992kbps`、`readyState=4`、播放 10s、无 error、fir64x8、GR 0、无削波
- DASH 视频：1440x1080 / 1080p · 192kbps，5 秒漂移 -0.008s，seek 60s 漂移 -0.006s，切回音频正常
- 自动档：`navigator.connection=4g` → 无损 929kbps、`readyState=4`、播放 8s、无 error；UI 自动档选中
- 自动档卡顿降档：模拟 waiting 6 秒 → 无损降到 320kbps，播放继续，无 error
- 限制器离线自检：热段 0.89、低段 0.496、`ok=true`、`ver=fir64x8`；打包版同样通过
- A/B 旁通：教堂 wet 时 dry=0/wet=1；旁通时 dry=1/wet=0，峰值 0.428、无削波
- 变调主链：997Hz +6 → 1406.3Hz、回 0 → 996.1Hz；稳态 1400 块 underrun +1；打包版 pitchParam=6、无 error、无削波
- Signalsmith 变调：base 996.1Hz、+6 → 1412.1Hz、回 0 → 996.1Hz、latency 0.12s；打包版 engine=signalsmith、峰值 0.4362、无削波
- 耳机优化+：cf 0.385 / cfMid 0.123 / shelf -2.28 / trim -1 / autoDb 0.29 / 峰值 0.3235 / 无削波；卡片与中频滑杆存在
- 耳机校准：Sony WH-1000XM4 → Preamp -6.1dB / 10 filters / hpPreamp 0.495 / autoGain 1 / 峰值 0.2056 / 无削波；搜索与 Profile API 正常
- FDN 混响：hall `engine=fdn/fdnWet=1/wet=0.272/peak=0.1424`；church `peak=0.7123`；无削波；可切回 IR
- 3 段夜听：compTh [-18,-21,-24]、reduction [-1.6,-0.2,-0.4]、peak 0.4317、无削波
- 双 Panner 旋转：3D 音乐 RMS +1.6dB、8D GR −0.08、无削波；打包版 3D peak 0.1656、无 error
- 磁带/电子管：cassette tapePre/De 3.4/-3.4、tapeBump 1.27；tubeMid 0.84；均无削波
- 去齿音：8kHz 正弦 off 0.2129 → on 0.1153（-5.3dB），reduction -10.5；音乐 reduction -3.3、无削波
- 夜听强度：amount 1/0.5/0 对应 compTh [-18/-21/-24]、[-9/-10.5/-12]、[0/0/0]，nightTrim .708/.854/1，无削波
- FDN 参数：自动 1.2/2/0.3，手动 1.6/5/0.6，重置回自动；无削波
- FDN 早期反射：离线脉冲起始 7.6ms、ER 0.0464、70–150ms 空档 0.0521（已填满）、尾音 -114dB、无 NaN
- 混响湿声：HP 180Hz / LP 10kHz 全环境生效；五环境峰值 0.226–0.563、GR 0；IR 回退峰值 0.319
- 前延迟：UI 70ms → 诊断 70ms；点“跟随预设前延迟”回 hall 30ms；14 预设最高峰值 0.596、无削波
- 瞬态塑形：0 参数与输入最大差 0；attack 90% 起音 0.5→1.04（+6.4dB）；sustain 90% 衰减段 −2.72dB；应用内 0.7/0.6 峰值 0.411、GR 0、无削波
- 打包版瞬态 + 14 预设回归：全部 transientReady、最高峰值 0.659（tube）、GR 0、无削波；复位 original 后 0/0
- 等响度补偿：音量 30/40/80/100% → 低音 +5.03/+4.29/+1.30/≈0dB，高音 +2.52/+2.15/+0.65/≈0dB；UI 标签与诊断一致
- 动态 EQ：离线透明差 0；3.5kHz 仅高频段 −7.00dB、仅低频段 0dB；180Hz 仅低频段 −5.00dB；应用内 GR [-4.31,-0.33,0]、峰值 0.101、限制器 GR 0
- 混响避让：depth=0 透明差 0；侧链强段 −12.04dB；安静 0.1s 恢复 −5.72dB；应用内 duck 80% → −6.62dB、GR 0
- 早期反射：erMix 0/0.3/1 → ER 0/0.0428/0.1426
- 三段宽度：widthHigh=2 时 1kHz +0.02dB、8kHz +5.73dB；应用内 1.2/1.4 → 高频侧 +2.92dB；居中模式 0/0
- 打包版组合验证：dyn/duck/tr/fdn ready；动态 EQ GR [-0.1,-3.58,-0.07]；duck 70% −5.1dB；ER 0.5；width 1.2/高频侧 +2.28dB；峰值 0.159、GR 0；UI/诊断齐全
- 低频激励：60Hz +3.08dB、180Hz 谐波 0.111、1kHz 不变；应用内 drive 8/wet 0.5、无削波
- 瞬态前视：起音 +6.39dB（仅高频 +4.49dB）；仅高频 60Hz 0dB；1kHz 交叉 0.2→0.2；应用内 GR −0.05
- 去齿音 worklet：透明 0、1kHz −0.01dB、8kHz −9.6dB；应用内 engine=worklet、th −30/ratio 3
- BS2B 参数：自定义 0.5ms/500Hz、UI 0.4ms/600Hz、标准按钮 45%/0.3ms/700Hz 均生效
- 打包版组合：de=worklet、tr/duck/dyn/fdn ready；bass 6.6x/0.4；tr high；de −26.4dB/2.4；cf 0.4ms/600Hz；width 1.2/+1.58dB；ER 0.4；duck 0.5；dyn GR [−1.69,−2.3,−2.1]；峰值 0.437、GR 0
- 面板重组：5 个分组（耳机校准/均衡/动态/空间/混响）；自定义预设保存/应用/删除通过
- 省电模式：正常 FDN/8x/dyn 0.6 → 省电 IR/4x/dyn 0 → 恢复；总延迟 5ms（不含输出缓冲）
- 14 预设全量：0 失败、0 削波，最高峰值 0.458（8D）
- 分频点：瞬态 3000 / 去齿音 7000 / 低频 100Hz 生效；去齿音 5kHz 在 4k/8k 分频下差 6.25dB；瞬态 2kHz 脉冲差 4.0dB
- `npm run test:audio`：动态 EQ、避让/ER、瞬态、去齿音四项全部通过
- 打包版：瞬态 3500 / 去齿音 6500 / 低频 140Hz、自定义预设保存分频点、省电 IR/4x、峰值 0.38、GR 0
- 打包版 14 预设：默认 2000/5000/120，最高峰值 0.426，GR ≤ −0.03，无削波
- 自动淡化：按 fadePref 提前起交叉，淡窗在曲尾前约 50ms 收尾；手动/版本切换共用
- 预设导出/导入：transient 0.6 / deEsser 0.5 / dynEq 0.4 / fHigh 3200 往返正确；UI 按钮齐全
- 限幅 ISP 测试：8x 采样峰值 0.8913、独立 ISP 0.9553；4x 0.9651；无 NaN；`npm run test:audio` 6 套通过
- 打包版：预设导入/导出按钮齐全、往返正确；切歌淡化 1200ms 生效；ISP 输入 -7.36/max -3.85 dBTP；诊断标签“ISP 输入峰值”
- 动态 EQ 三段参数：200/1.1/-9、1400/1.6/-11、3000/2/-8 生效；自定义预设恢复正确；离线 3.5kHz 默认 -7dB，改参后 -1.42dB
- 切歌淡化：1800→1200→0（近无缝）生效；诊断显示当前值
- dBTP：当前 -10.17、max -7.95、阈值 -1.0；`npm run test:audio` 含频谱快照，全部通过
- 打包版：动态 EQ 三段参数生效、GR [-1.67,-0.56,0]；切歌淡化 1000ms 生效；ISP 当前 -6.94/max -1.74 dBTP；14 预设最高峰值 0.744、无削波
- 目标响度：测量 -13.00 LUFS、目标 -14 → −1.00dB；目标 -18 → −5.00dB；目标 -12 → −1.00dB（峰值上限绑定）；峰值 -3 → −2.50dB；缓存 v6 `{l,p}` 正常
- 打包版：目标 -18 → −5.00dB、峰值 -2.5 不再额外压、恢复 -14/-1.5；UI/诊断正常
- 打包版：5 分组、自定义预设保存/应用/删除、省电 IR/4x/dyn 0、总延迟 5ms、诊断齐全
- 校准强度 50%：hpPreamp 0.704；A/B 旁通 dry=0.704 / wet=0；无削波
- B 站：30280 192kbps AAC 主候选；30232/30216 alts；杜比 ec-3 自动回退

### 10.2 音效

- 13 预设干湿同窗标定，presetTrim 复测大多 ±0.7dB；新增“耳机优化+”由 autoLevel 收敛
- 14 预设音频链回归：0 失败，`ctx=running`、`peak>0`、`clip=false`、`limiterReady=true`
- 自动响度：教堂 -1.2dB、全景 -0.5~-1.1dB，干湿差约 -0.1dB，无泵浦
- 稳态 997Hz 正弦：autoDb 收敛 -0.06dB，原声链透明
- 限制器正弦：997Hz/8kHz 压峰准确，无削波
- 8x 64-tap：997Hz 1.8 → 0.8902/GR −6.3；8kHz 1.0 → 0.8913/GR −1.18；8kHz 0.7 → 0.7147/GR0；6 秒 media/ctx 6.01s
- 变调双引擎：SoundTouch 997+6 → 1406.3Hz；Signalsmith 997+6 → 1412.1Hz，latency 0.12s

### 10.3 全量回归

- 19 个 MV 样式 × 13 个既有预设 = 247 组合
- 0 失败：`ctx=running`、`peak>0`、`clip=false`、`frames` 增长、`glStage=ready`
- 结束后恢复 `flow` + `original`
- 新增第 14 个预设“耳机优化+”后，14 预设音频链回归 0 失败

---

## 11. 已知限制 / 下一步

### 已知限制

- 64-tap FIR 仍是 **8x 多相近似**，不是标准带限 True Peak 表；对极端 near-Nyquist 内容可能仍有 <0.1dB 误差。
- 静态 `presetTrim` 是参考曲标定；自动响度已缓解，但极端低音/混响段落仍可能有 ±1dB 级慢漂移。
- 原声 preset 的 M/S 分频在立体声内容上可能有 <0.5dB 差异，autoLevel 会补偿；未做 M/S 中性旁通。
- Hi-Res 单曲约 75MB，首次加载/拖动更吃带宽；默认仍是无损。
- `jyeffect / sky` 未默认使用（不是更高解析，且可能改变声场）。
- 看视频模式默认仍是 720p mp4；DASH 1080p 双流为实验开关，缓冲时可能出现一次同步校正。
- Electron/Chromium 无法直接 WASAPI 独占/bit-perfect；需要 native addon 或 mpv/libmpv。
- 变调仍用 SoundTouch 为默认（已调 60/25/12 + lanczos）；Signalsmith 为可选引擎，延迟 0.12s、无 underrun 指标上报。启动阶段 SoundTouch 有 38–39 次 underrun，稳态基本为 0。
- 耳机校准依赖 GitHub API（AutoEQ，MIT），未登录限额约 60 次/小时；目录缓存 10 分钟、Profile 缓存 30 分钟。校准开启时 autoLevel 暂停。
- FDN 混响为实验引擎：不同房间的 wet 能量与卷积 IR 不完全一致，可用「环绕深度」或切回 IR 对比。
- 3 段夜听使用 LR4 分频，重建为全通特性；三段压缩参数目前固定，未暴露用户调节。
- 双 Panner 旋转在单声道内容上会明显去相关（3D corr≈0.17），这是宽度来源；若觉得太相位化可下调 spread/提高 fill。
- 磁带预加重/去加重在无饱和时净频响接近平坦；磁头 bump 与电子管中频染色会轻微改变原始音色。
- 去齿音用 30ms 轮询 reduction 补偿 DynamicsCompressor 的 makeup，不是逐采样包络，极快齿音瞬态可能有少量残留。
- 夜听强度通过 threshold/ratio 缩放实现，0.5 不是严格“半程压缩”，但避免了干湿并联的相位问题。
- FDN 手动参数会覆盖当前环境预设，切换环境后仍保留，需点“跟随环境预设”恢复。
- FDN 早期反射混入量固定 0.3，未暴露强度；前延迟覆盖值同样会在切换环境后保留，需点“跟随预设前延迟”恢复。
- 瞬态塑形是零延迟因果包络，没有前视，极短的第一个瞬态（<1ms）提升有限；强打击感会让峰值上升，依赖末级限制器兜底。
- 等响度补偿在 autoLevel 之前，慢速自动响度会部分抵消整体电平变化，最终保留的是低/高频微笑曲线；切换预设会把 loudness 清回 0。
- 动态 EQ 按 128 样本块更新系数（约 2.7ms），不是逐采样；只暴露主强度与三段强度，阈值/Q/频率固定。
- 混响避让的阈值/范围固定，只暴露深度；早期反射默认 30%，过高会让混响偏“贴脸”。
- 低频激励产生的是奇次谐波（180/300Hz…），全频音箱上 60Hz 也会 +3dB，过量会偏轰；默认关闭。
- 瞬态塑形启用时整体延迟 2ms（仅高频模式含 LR4 分频）；0 参数时无延迟。
- 去齿音 worklet 最大衰减 -12dB，阈值/比率仍由单一 amount 控制。
- 自定义预设只保存效果字段，不保存耳机校准/倍速/变调/旁通/省电模式；最多 40 个。
- 分频点变化会重算 LR4 系数，切换瞬间可能有极短过渡；三个分频点收在“分频点 / 高级参数”折叠区。
- 目标响度是逐轨归一，不是完整 EBU R128 母带合规；峰值上限是采样峰值，真峰值仍由末级限制器兜底。
- dBTP 表是限幅前的 8x 多相 ISP 近似，不是认证的 BS.1770-4 真峰值表；限制器阈值仍固定 -1dB。
- 独立 4x 48-tap 测试表有相位/通带纹波，仅用于无数字过载回归，不作为认证表。
- 自动接歌的提前量按用户淡化时长计算；若剩余时间不足，淡化会收紧到曲尾前 50ms。
- 切歌淡化 0ms 实际使用 20ms 微淡化；自动切歌的淡化会按剩余时长收紧。
- v5 响度缓存迁移用 `l=-14-g`，旧增益若被峰值上限截断会偏保守，后续测量会修正。
- 省电模式会牺牲混响算法与动态 EQ，并降低限制器相位数；总延迟为估算值，不含交叉馈送湿声路径。
- 高频宽度用 4kHz 侧信号搁架近似三段，不是严格线性分频；极端宽度下高频侧信号会更强。

### 下一步建议

1. 8x 多相或标准带限 True Peak 表。
2. 多频段 crossfeed / 耳道模型（已做 700Hz + 1.2kHz 双路，仍可细化）。
3. 高质量变调：已接入可选 Signalsmith（默认 SoundTouch）。
4. WASAPI 独占 / bit-perfect（需要 native addon 或 mpv/libmpv）。
5. 音频模块单元测试脚本化（当前多为页面内手动回归）。

---

## 12. 关键文件与备份

### 关键文件

| 文件 | 作用 |
|---|---|
| `src/netease.js` | 网易云 songUrl 档位/Hi-Res/无损/cache/label |
| `src/bilibili.js` | B 站 DASH audio 优先级/label/fnval/alts |
| `server.js` | `/api/media`、`/api/nmedia?quality=`、`/api/stream` |
| `public/js/player.js` | AudioContext、目标响度/峰值上限、切歌淡化、响度归一、媒体加载、codec 回退、quality 传递 |
| `public/js/audiofx.js` | EQ/混响/宽度/交叉馈送/饱和/限幅/自动响度 |
| `public/js/vendor/peak-limiter-worklet.js` | 8x 64-tap FIR lookahead 限制器 |
| `public/js/vendor/fdn-reverb-worklet.js` | 8 通道 FDN 算法混响 + 早期反射 |
| `public/js/vendor/transient-shaper-worklet.js` | 双包络瞬态塑形（打击感/尾音收敛） |
| `public/js/vendor/dynamic-eq-worklet.js` | 3 段动态 EQ（频率/Q/阈值可调） |
| `public/js/vendor/ducking-worklet.js` | 混响避让（干声侧链，最大 -12dB） |
| `public/js/vendor/deesser-worklet.js` | 4–8kHz LR4 分频去齿音 |
| `public/js/vendor/soundtouch-worklet.js` | SoundTouchJS worklet（MPL-2.0） |
| `public/js/vendor/signalsmith-stretch.mjs` | Signalsmith Stretch（MIT，JS/WASM） |
| `public/js/vendor/README.md` | vendor 来源/版本/许可证 |
| `public/js/app.js` | 音效面板、音质选择、诊断页、MV |
| `public/css/style.css` | 音效面板/折叠分组/自定义预设/滑杆/诊断样式 |

### 备份

- `backup/pre-audio-quality-20261121/`
- `backup/pre-audio-preset-trim-20261121/`
- `backup/pre-crossfeed-shelf-20261122/`
- `backup/pre-truepeak-fir-20261122/`
- `backup/pre-truepeak-fir32-20261122/`
- `backup/pre-truepeak-fir64-20261122/`
- `backup/pre-autolevel-20261122/`
- `backup/pre-codec-fallback-20261122/`
- `backup/pre-hires-20261122/`
- `backup/pre-hires-fallback-20261122/`
- `backup/pre-auto-quality-20261122/`
- `backup/pre-selftest-20261122/`
- `backup/pre-stall-downgrade-20261122/`
- `backup/pre-ab-bypass-20261122/`
- `backup/pre-dash-video-20261122/`
- `backup/pre-pitch-main-20261122/`
- `backup/pre-mid-crossfeed-20261122/`
- `backup/pre-signalsmith-20261122/`
- `backup/pre-headphone-cal-20261122/`
- `backup/pre-headphone-polish-20261122/`
- `backup/pre-audio-effects-20261122/`
- `backup/pre-multiband-night-20261122/`
- `backup/pre-stereo-rotation-20261122/`
- `backup/pre-saturation-model-20261122/`
- `backup/pre-deesser-20261122/`
- `backup/pre-night-amount-20261122/`
- `backup/pre-fdn-controls-20261122/`
- `backup/pre-reverb-er-20261123/`
- `backup/pre-transient-20261123/`
- `backup/pre-loudness-20261123/`
- `backup/pre-dyneq-20261123/`
- `backup/pre-reverb-duck-20261123/`
- `backup/pre-width3-20261123/`
- `backup/pre-bass-exciter-20261123/`
- `backup/pre-transient-look-20261123/`
- `backup/pre-deesser-worklet-20261123/`
- `backup/pre-cf-tune-20261123/`
- `backup/panel-perf-20261123-final/`
- `backup/pre-freq-tune-20261123/`
- `backup/pre-loud-target-20261123/`
- `backup/pre-dyneq-params-20261123/`
- `backup/audio-20261123-final2/`
- `backup/pre-auto-fade-20261123/`
- `backup/pre-limiter-bh-20261123/`
- `backup/audio-20261123-final3/`
- `backup/pre-fir8x-20261122/`
- `backup/audio-quality-20261121-final/`
- `backup/audio-quality-20261122-final/`（当前最终快照）

---

## 13. 当前运行状态

- 打包版已启动，端口 `8899`
- 当前曲目：B 站 `[Hi-Res]夕凪、某、花惑い`，192kbps
- `limiterVer=fir64x8`、GR 0dB、`autoLevel=true`、`clip=false`
- 19×13 回归 0 失败
- 网易云 Hi-Res 档已接入，默认自动档

---

## 14. 最终审计（2026-11-22）

- `node --check`：`server.js`、`electron/main.js`、`src/*.js`、`public/js/*.js`、`peak-limiter-worklet.js` 全部通过
- 打包版限制器自检：`hot=0.89`、`low=0.496`、`ok=true`、`ver=fir64x8`
- 14 预设音频链回归：0 失败，全部 `ctx=running`、`peak>0`、`clip=false`、`limiterReady=true`
- 双变调引擎：SoundTouch `pitchParam=6`、Signalsmith `latency=0.12s`，均无 error、无削波
- 耳机校准：Sony WH-1000XM4 → Preamp -6.1dB / 10 filters / hpPreamp 0.495 / autoGain 1 / 峰值 0.2056 / 无削波；搜索/Profile API 正常
- 打包版播放：192kbps、`paused=false`、无 `audio.error`、GR 0dB、`autoLevel=true`、`bypass=false`
- 输出峰值 0.669、`clip=false`
- UI 检查：自动音质/Hi-Res 选项、A/B 旁通、限制器自检、自动响度开关、DASH 1080p 开关、耳机校准搜索/导入、FDN 混响开关均存在
- vendor 审计：`public/js/vendor` 三个 worklet/mjs 均在 asar；未再打包重复的 `node_modules/signalsmith-stretch` 与 `@soundtouchjs/audio-worklet`
- 精简打包版复验：selfTest `hot=0.89/low=0.496/ok`；Signalsmith engine 加载成功、latency 0.12s、峰值 0.4423、无 error/削波
- 模块状态：**stable / handoff ready**（DASH 视频为实验开关，默认关闭）

剩余大工程（不建议在当前模块继续堆小功能）：

1. 高质量变调（signalsmith-stretch WASM）✅ 已接入可选引擎。
2. 8x/标准带限 True Peak（边际优化）
3. 多频段 crossfeed / 耳道模型（主观听感调校）
4. WASAPI 独占 / bit-perfect（需要 native addon 或 mpv/libmpv）

---

## 15. 最终验收（2026-11-23）

完整清单见 `docs/AUDIO-FINAL-ACCEPTANCE-20261123.md`。

- `npm run test:audio`：动态 EQ、避让/ER、瞬态、去齿音、频谱快照、限幅 ISP 共 6 套，退出码 0
- 打包版引擎：动态 EQ / 避让 / 瞬态 / 去齿音 worklet / FDN / 限制器全部 ready，48kHz
- B 站 192kbps、网易云无损 FLAC 905–1512kbps 均正常
- 14 预设最高峰值 0.537，GR ≤ −0.11，无削波
- 自定义预设保存/应用/删除/导出/导入往返正确
- 省电模式 IR/4x/dyn 0 ↔ FDN/8x/dyn 0.6 正常
- 目标响度 −18 ↔ −14、峰值上限 −3 ↔ −1.5、切歌淡化 0/1200/1800ms 均正常
- 网易云自动接歌：`花に亡霊` → `パレード`，`fadeMs=1370`、`deltaMs=6`、`path=element`
- 状态：**stable / frozen**；后续只修具体 bug，不再主动加 DSP 功能

---

## 16. 一起听（2026-11-23）

详细说明：`docs/LISTEN-TOGETHER-20261123.md`。

- 方案：房主本机 WebSocket 房间（0.0.0.0:8900）+ **cloudflared quick tunnel** + 客人本地拉流 + 房主权威控制；不共享媒体直链/Cookie。
- 代码：`src/room-server.js`、`src/tunnel.js`、`public/js/room.js`、`server.js` 的 `/api/room/*`、`electron/main.js` 退出清理。
- 内置：`bin/cloudflared.exe` 2026.11.1（Apache-2.0，SHA256 与官方一致）+ `CLOUDFLARED-LICENSE`；打包到 `resources/bin`，不在 asar 内重复。
- 异地：房主建房自动开公网隧道，客人只需 App，输入 `https://…trycloudflare.com` + 房间码；Tailscale/局域网作为备用。
- 实测：双 App 同步播放/暂停/seek/切歌、聊天、断线重连、房主离开、重新建房均通过；漂移 -15~+6ms。
- 预约起播 + ready：换歌 1.5s / 恢复 1s / seek 0.8s；房主面板显示“就绪 1/1”。
- 房主断线宽限 20s：客人暂停等待，房主带 token 重连后恢复；超时才 host-left。
- 客人加载失败：guest-error 广播到房主聊天区；客人暂停等待。
- 隧道 UI：重试/关闭（二次确认，会断开客人）；关闭后 cloudflared 进程消失，重试拿到新地址。
- 点歌申请：客人按 BV/链接解析并提交，房主“加入队列/拒绝”；接受后队列 20→21，客人同步；拒绝状态回传。
- 打包版点歌：Node 客人提交 BV 请求，房主接受后队列 21→22，toast 正常。
- 打包版双实例：暂停加入保持暂停；播放后按 startAt 起播，主机 199.2s / 客人 199.1s，漂移 2ms；ready 1/1；房主断线宽限后 3s 恢复，漂移 3ms。
- 公网隧道：源版/打包版均拿到 `trycloudflare.com`；Node 客人 `wss://` 加入成功；客人 App 用 `https://` 加入，RTT 343ms、漂移 7ms；结束房间后 cloudflared 进程清理。
- 限制：quick tunnel 地址每次建房会变且无 SLA；Cloudflare 边缘可见控制/聊天；无房主迁移/语音/推流；客人媒体可用性取决于本机账号/地区。
- 备份：`backup/pre-listentogether-20261123/`、`backup/listentogether-20261123-final/`、`backup/listentogether-cloudflared-20261123/`、`backup/pre-room-polish-20261123/`、`backup/listentogether-polish-20261123/`。
