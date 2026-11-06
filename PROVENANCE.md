# 素材来源与许可范围（PROVENANCE）

本插件是二次移植作品：**代码**按 MIT 许可（见 [`LICENSE`](LICENSE)），**立绘 / 音效**来自
[claude-desk-pet](https://github.com/BingXing-ai/claude-desk-pet)，**记账内核**来自
[DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)。

## 一、逐项来源

| 文件 / 目录 | 来源 | 许可 / 说明 |
|---|---|---|
| `lib/index.js`、`assets/claude-pet.js`、`cordis.patch.yml`、`package.json`、README、dev 脚本 | 本移植新增 | MIT |
| `lib/accounting.mjs` | 复制自 DeepSeek-Balance-Whale-Widget 0.4.2 的 `lib/accounting.mjs` | MIT；未改动逻辑，仅随本包分发 |
| `assets/sprites/*.png`（10 张） | 复制自 claude-desk-pet 的 `pet/sprites/` | 原仓库 MIT；立绘由原作者用 AI 绘图生成（详见原仓库 README） |
| `assets/sounds/done.wav`、`error.wav` | 复制自 claude-desk-pet 的 `sounds/` | 原仓库 MIT |
| `assets/sounds/pinch.mp3` | 复制自 DeepSeek-Balance-Whale-Widget 0.4.2 的 `assets/Ya1.mp3`（默认「小黄鸭」按压声） | 按原项目说明「原样提供」，不适用 MIT；仅用于捏捏音效 |
| `assets/fonts/SmileySans-Oblique.ttf` | Smiley Sans v2.0.1（得意黑），来自 [atelier-anchor/smiley-sans](https://github.com/atelier-anchor/smiley-sans) | **SIL Open Font License 1.1**，不适用本包的 MIT；详见 `assets/fonts/README.md` |
| `icon.png` | 由 claude-desk-pet 的立绘裁切 / 缩放而来 | 与原立绘同源，仅用于标识本插件 |

DeepSeek-Balance-Whale-Widget 的鲸鱼立绘、动图与 README 展示图**没有使用**；音效仅 `pinch.mp3` 取自其 `assets/Ya1.mp3`（按原项目说明原样提供）。

## 二、对原项目的改动

- claude-desk-pet 的 Python `pet.pyw` 悬浮窗没有随本包分发；它的状态机与表情映射被重写进
  `lib/index.js`（DSH `session/event` 驱动）和 `assets/claude-pet.js`（页面内挂件）。
- `accounting.mjs` 原样保留（定点金额、余额观测账本、部分数据判定、历史记账本聚合）。
- 余额获取、峰谷价目、每轮 usage 换算参考了小鲸鱼 0.4.2 的宿主实现，重新组织为只读路由
  （`/dsh-widget-pet/state.json`、`/balance.json`、`/records.json`），没有保留其多厂商模型、
  泡泡编辑器、Codex 统计等与本移植无关的模块。

## 三、权利主张 / Takedown

如果你认为本包中的立绘或音效侵犯了你的权利，请在本仓库开一条 issue，说明**文件名**与**依据**，
我们会在核实后立即替换或移除，不附加其它条件。也欢迎直接提供可自由再分发的替代素材。
