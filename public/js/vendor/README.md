# Vendored audio worklets / libraries

本目录存放运行时直接加载的第三方音频代码。对应 npm 包已从 `package.json` 移除，避免打包重复；升级时从下列来源重新复制。

| 文件 | 来源 / 版本 | 许可证 | 说明 |
|---|---|---|---|
| `peak-limiter-worklet.js` | 本项目自研 | 随项目 | 8x/4x 可选 64-tap 多相 FIR lookahead 限制器 |
| `fdn-reverb-worklet.js` | 本项目自研（FDN 思路参考 Signalsmith 文章） | 随项目 | 8 通道 FDN 算法混响 + 15 抽头早期反射 |
| `transient-shaper-worklet.js` | 本项目自研（双包络瞬态塑形思路） | 随项目 | 立体声联动打击感/尾音收敛 |
| `dynamic-eq-worklet.js` | 本项目自研（动态 EQ / 共振抑制思路） | 随项目 | 3 段窄带动态衰减（180Hz/1.2kHz/3.5kHz） |
| `ducking-worklet.js` | 本项目自研（reverb ducking / sidechain 思路） | 随项目 | 干声侧链控制混响湿声，最大 -12dB |
| `deesser-worklet.js` | 本项目自研（split-band de-esser 思路） | 随项目 | 5kHz LR4 分频 + 高频段逐采样压缩 |
| `soundtouch-worklet.js` | `@soundtouchjs/audio-worklet` 2.1.1 | MPL-2.0 | SoundTouchJS AudioWorklet；来源 https://github.com/cutterbl/SoundTouchJS |
| `signalsmith-stretch.mjs` | `signalsmith-stretch` 1.3.2 | MIT | Signalsmith Stretch JS/WASM；来源 https://signalsmith-audio.co.uk/code/stretch/ |

## 加载方式

- `soundtouch-worklet.js`：`audioContext.audioWorklet.addModule('/js/vendor/soundtouch-worklet.js')`
- `signalsmith-stretch.mjs`：`await import('/js/vendor/signalsmith-stretch.mjs')`（`server.js` MIME 已支持 `.mjs`）
- `peak-limiter-worklet.js`：`audioContext.audioWorklet.addModule('/js/vendor/peak-limiter-worklet.js?v=fir64x8p')`（`phases` 4–8）
- `fdn-reverb-worklet.js`：`audioContext.audioWorklet.addModule('/js/vendor/fdn-reverb-worklet.js?v=fdn5')`
- `transient-shaper-worklet.js`：`audioContext.audioWorklet.addModule('/js/vendor/transient-shaper-worklet.js?v=tr2')`
- `dynamic-eq-worklet.js`：`audioContext.audioWorklet.addModule('/js/vendor/dynamic-eq-worklet.js?v=deq1')`
- `ducking-worklet.js`：`audioContext.audioWorklet.addModule('/js/vendor/ducking-worklet.js?v=duck1')`
- `deesser-worklet.js`：`audioContext.audioWorklet.addModule('/js/vendor/deesser-worklet.js?v=de1')`

## 注意

- 修改/升级 vendor 文件后，需要同步更新 `server.js` 的 MIME（`.mjs`）和缓存查询串版本。
- SoundTouchJS 为 MPL-2.0：再分发时保留来源与许可证信息。
- Signalsmith Stretch 为 MIT：再分发时保留版权与许可证信息。
