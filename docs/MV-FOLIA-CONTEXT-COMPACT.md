# MV / Folia / PV Tool 压缩上下文

项目：`C:\Users\16493\Desktop\b站音乐播放器`  
当前运行：打包版端口 `8899`  
完整交接文档：`docs/MV-FOLIA-HANDOFF-20261120.md`

## 现状

动态 MV 共 19 个样式：

- **Folia 原版 12 个**：绘光、花火、向籁、淡彩、倾诉、云阶、回环、心象、雾笼、对话、光影、莫奈
- **自行重设计 2 个**：流光、纵向
- **旧实现保留 2 个**：浮名、星屑
- **PV Tool 试点 3 个**：春日、赛博、蛛网

Folia 实现：
- Pixi：Lumiere、Hanabi、Sonnet、Tempera
- React/Shadow DOM：Tilt、Partita、Claddagh、Cadenza、Nebbia、Cappella、Still、Monet
- PV Tool：iframe + postMessage

## 关键文件

- `public/js/app.js`：样式卡、MV DOM、AI 主题、分词、BPM、AI 导演、段落切换、微调、性能模式
- `public/js/lyricmv.js`：旧样式、歌词时间轴、逐字/逐词、段落/shot、流光藤蔓、纵向分栏、低帧率检测
- `public/js/folia-bridge.js`：Folia Pixi/React/PV 运行时桥、Shadow DOM、自动降级、间奏、调色/FX
- `public/css/style.css`：Folia 宿主、`mv-grade` 调色层、间奏层、样式卡、流光/纵向、MV 布局
- `public/vendor/folia`：Folia 原版资源（AGPL，个人自用）
- `public/vendor/pvtool`：PV Tool 构建产物（Non-Commercial，个人自用）
- `scripts/package-app.js`：打包并排除 backup/data/tmp 等

## 已做的重要增强

- AI 主题 `wordColors` 已传给 Folia
- 衬线字体改为 `Noto Serif SC`
- Folia 统一暗角/顶部主题柔光调色层
- 流光藤蔓、纵向竖排分栏
- AI 导演：按主题情绪 + BPM 选主样式
- 副歌强度：`bp-mv-chorus` + `mv-chorus`
- 副歌样式切换：默认关闭、带淡入淡出、12 秒冷却、4.2 秒看门狗
- 性能模式：手动 + 连续低 FPS 自动开启
- Folia 失败自动回退流光
- Folia 间奏显示动态音符层
- PV Tool：春日/赛博/蛛网；主歌无相机抖动，副歌轻微 shake/zoom/glitch

## 已知问题 / 注意

- 浮名、星屑原版 Fume/Diorama 文章排版仍为空，故保留旧实现
- Cadenza 句间可能暂无文字，自动降级不能按单帧文本判断
- 段落切换仍属实验功能，未做真实副歌长回归
- PV Tool 是行/短句级，不是逐字；部分模板间奏段会偏空
- 打包/重启前必须关闭所有 `BiliPlayer.exe`，否则会因单实例锁继续跑旧 renderer
- Folia/PV 均仅限个人非商业使用

## 构建与备份

- 打包：`npm run dist`
- 运行：`dist/BiliPlayer-win32-x64/BiliPlayer.exe`，端口 `8899`
- 主要备份：`backup/folia-final-20261119`、`backup/folia-beautify-20261120`、`backup/pvtool-optimize-20261120`
