# 第三方组件声明

本项目以 GNU AGPL-3.0 授权（全文见根目录 [`LICENSE`](LICENSE)）。本软件包含以下第三方组件，各组件的著作权归其作者所有，按各自的许可证使用，**不随本项目的许可证改变**。

其中两个组件**不在项目的 AGPL-3.0 授权范围内**，作为独立组件按各自条款处理：

- **Folia 运行时和可视化组件**（`public/vendor/folia/`）：代码本身为 AGPL-3.0，但其 `NOTICE.txt` 声明本拷贝"仅供个人使用、不对外分发"，且"一旦分发或作为网络服务使用，AGPL 的义务随之适用"。动态MV 的 19 种样式中有 12 种依赖它：对话、光影、向籁、云阶、倾诉、雾笼、绘光、淡彩、回环、心象、莫奈、蛛网。
- **PV Tool**（`public/vendor/pvtool/`）：非商业许可证（保留所有权利；授权不可转让、可撤销；作者 @DanteAlighieri13210914）。仅授权非商业目的的使用、复制和修改，不能被项目的开源许可证覆盖。动态MV 的春日、赛博、蛛网三种样式依赖它。

## 组件清单

| 组件 | 位置 | 版本 | 许可证 | 声明是否齐全 |
|---|---|---|---|---|
| Electron（含 Chromium、Node.js） | 安装包内的运行时 | 45.2.1 | MIT 等 | 齐全：安装包里带 `LICENSE` 和 `LICENSES.chromium.html` |
| cloudflared | `bin/cloudflared.exe` | 2026.11.1 | Apache-2.0 | 齐全：`bin/CLOUDFLARED-LICENSE` |
| NeteaseCloudMusicApi | `node_modules/`，随安装包分发 | 4.32.0 | MIT | 齐全：包内带 `LICENSE` |
| ws | `node_modules/`，随安装包分发 | 8.23.0 | MIT | 齐全：包内带 `LICENSE` |
| SoundTouchJS AudioWorklet | `public/js/vendor/soundtouch-worklet.js` | 2.1.1 | MPL-2.0 | **缺**：文件里没有许可证头，仓库里也没有 MPL 全文 |
| Signalsmith Stretch | `public/js/vendor/signalsmith-stretch.mjs` | 1.3.2 | MIT | **缺**：文件里没有许可证头和版权声明 |
| QR Code Generator for JavaScript（Kazuhiko Arase） | `public/vendor/qrcode.js` | 未标版本 | MIT | **缺**：文件头只有一行"MIT 许可"的链接，没有完整条款 |
| Folia 的运行时和可视化组件 | `public/vendor/folia/` | 未标版本 | AGPL-3.0 | 全文见根目录 `LICENSE`；另有其自带 `NOTICE.txt` |
| PV Tool | `public/vendor/pvtool/` | 未标版本 | 非商业许可证（保留所有权利） | 齐全：`LICENSE.txt`、`NOTICE.txt` |

## 待补事项

- [ ] SoundTouchJS：补 MPL-2.0 全文和版权声明（来源 https://github.com/cutterbl/SoundTouchJS ）
- [ ] Signalsmith Stretch：补版权声明和 MIT 全文（来源 https://signalsmith-audio.co.uk/code/stretch/ ）
- [ ] qrcode.js：补版权声明和 MIT 全文（Copyright (c) 2009 Kazuhiko Arase）
- [x] Folia：AGPL-3.0 全文已随根目录 `LICENSE` 提供
