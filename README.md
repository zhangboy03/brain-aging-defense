# Brain Aging Defense

A browser-based brain-training remake project inspired by Ryuta Kawashima's cognitive training research and publicly available gameplay demonstrations. The goal is to rebuild classic short-session exercises for memory, attention, tracking, and reaction training as an open, iterative web project.

> Disclaimer: This is not an official Nintendo, Tohoku University, or Ryuta Kawashima project. It does not use Nintendo, professor, or original-game trademarks or branded assets. The project is intended for learning, research, and interactive prototype reconstruction.

## Live Demo

GitHub Pages:

https://zhangboy03.github.io/brain-aging-defense/

## Current Status

The public page now lists 8 training entries. Only one is currently implemented as a polished playable sample:

- `Hidden Grid Tracking`: a cat-and-mouse memory tracking game. The player first memorizes where the mice are, then watches cats or mice enter from the board edges and push full rows or columns. At the end, the player must identify all remaining mice.

The other seven exercises are not yet refined. They are kept as visible roadmap entries: continuous calculation, card flipping memory, reading retention, symbol judgment, block tracking, cup tracking, and auditory calculation. Contributions are welcome for rules, assets, animation timing, and progression design.

## Hidden Grid Tracking Rules

- The board is 4 x 3, with 12 covered cells.
- At the beginning, cats and mice are revealed briefly, then all cells are covered.
- Each move pushes one animal in from the left, right, top, or bottom edge.
- The whole affected row or column slides together, and one animal exits from the opposite side.
- The entering and exiting animals can be the same or different, so the final number of mice can change.
- To keep puzzles playable, the generator constrains the final mouse count to 2-8.
- In the answer phase, the player must click every mouse still on the board. Clicking a cat fails the round.

## Local Development

```bash
npm install
npm run dev
```

Build and audit:

```bash
npm run build
npm audit --audit-level=moderate
```

## Tech Stack

- React
- TypeScript
- Vite
- GitHub Pages

## Contribution Ideas

- Refine the remaining seven training games.
- Reconstruct each game's rules, animation timing, start flow, failure flow, and success flow from public reference videos.
- Replace or improve assets with CC0, permissively licensed, or original artwork.
- Improve mobile responsiveness, accessibility labels, and testable puzzle generators.

---

# 脑力八练

一个面向浏览器的脑力训练复刻项目。项目受川岛隆太教授脑训练研究和公开演示玩法启发，目标是把经典的短时记忆、注意力、追踪和反应训练做成可持续迭代的开源网页版本。

> 免责声明：本项目不是任天堂、东北大学或川岛隆太教授的官方作品，也不使用任天堂、教授或原作的商标与品牌素材。当前实现仅用于学习、研究和交互原型复刻。

## 在线体验

GitHub Pages：

https://zhangboy03.github.io/brain-aging-defense/

## 当前状态

公开页面目前列出 8 个训练入口，其中只有一个高完成度样例：

- `暗格追踪`：猫鼠位置记忆与进出推动追踪游戏。玩家先记住起始鼠的位置，随后观察每一次猫或鼠从边缘进入、把整行或整列推出，最后点出全部剩余的鼠。

其他七种训练游戏还没有细化。当前先作为待办入口保留：连续计算、翻牌记忆、朗读保持、符号判断、方块追踪、杯位追踪、听算保持。欢迎继续补充规则、素材、动画和关卡节奏，把这一套训练逐步完善。

## 暗格追踪规则

- 棋盘为 4 x 3，共 12 个暗格。
- 开始时展示猫和鼠的位置，随后全部盖上问号。
- 每次移动会从左、右、上、下任一边推入一只动物。
- 被推动的整行或整列同步滑动，另一端真实推出一只动物。
- 进入和退出的动物可以相同，也可以不同；因此最终鼠的数量可能变化。
- 为了保证题目可玩，生成器会把最终鼠数限制在 2 到 8 之间。
- 答题阶段需要点出所有最终还在棋盘上的鼠；点到猫即失败。

## 本地开发

```bash
npm install
npm run dev
```

构建检查：

```bash
npm run build
npm audit --audit-level=moderate
```

## 技术栈

- React
- TypeScript
- Vite
- GitHub Pages

## 多屏实时同步（控制台 → 多大屏）

部分游戏（蜂窝抢答 `hexagon`、数人头 `head-count`）是「主持人控制台 + 投屏大屏」结构。

**目标场景**：用一台电脑作为**唯一控制台**，实时控制**两个同时在线的 iPad 大屏**
（北大队 / 清华队各一台），让两屏画面**完全同步**——相同题目、对方是否抢答、
自己是否答对，全部即时广播。

**为什么旧版本跨设备不同步**：原同步只用 `localStorage` + `BroadcastChannel`，
二者都只在「同一浏览器、同源、不同标签页」之间生效，状态从不上网，因此跨设备永远不同步。

**方案**：新增一个 FastAPI 中转后端，部署到 [AI Builder Space](https://space.ai-builders.com)
（底层 Koyeb 容器）。控制台把状态/事件 `POST` 给后端，大屏经 **SSE** 实时收推送并扇出到所有屏。
游戏页面仍托管在 GitHub Pages，只多连一个后端。后端可达失败时自动回退到本地
`localStorage`/`BroadcastChannel`（同设备仍可用）。

详细设计见 [`docs/superpowers/specs/2026-06-10-cross-device-sync-design.md`](docs/superpowers/specs/2026-06-10-cross-device-sync-design.md)。

后端相关文件：根目录 `Dockerfile`、`server/`（FastAPI 中转）、`public/sync.js`（共享客户端同步层）。

## 盲五子棋（Blind Gomoku）

复刻 Netflix《The Devil's Plan》的密室对决游戏：棋子底层是黑白五子棋，但表面被涂成
8 种杂色——双方必须**靠记忆**记住每一手的真实归属，连五瞬间系统自动判定并全盘翻面揭示。
表面颜色可自选：既能给自己做标记，也能骗对手（节目里 AI 就靠跟用同色棋子扰乱选手记忆）。

- 棋手页（两台 iPad，进入后各选清华/北大）：`/blind-gomoku/`
- 主持人控制台（上帝视角 + 开局/重置/强制揭示）：`/blind-gomoku/admin.html`
- 架构：控制台是唯一权威引擎，iPad 的落子经 relay 事件转发、控制台校验后以完整快照广播；
  断线重连/睡眠唤醒自动对齐。房间名 `blind-gomoku`。
- 规则引擎单测：`node --test scripts/test_blind_gomoku.mjs`
- 设计文档：[`docs/superpowers/specs/2026-06-10-blind-gomoku-design.md`](docs/superpowers/specs/2026-06-10-blind-gomoku-design.md)

### 随机色版（Blind Gomoku v2）

旧版完整保留。新版去掉了选手自选颜色：每落一子，主持人控制台权威地**随机指定**一个表面色，
选手无法用固定颜色给自己做标记，必须真正**记住自己每一手的颜色**才能认出连线——记忆难度更高。

- 棋手页：`/blind-gomoku-v2/`，主持人控制台：`/blind-gomoku-v2/admin.html`
- 与旧版相互独立：房间名 `blind-gomoku-v2`，规则引擎（`core.js`）与旧版一致，仅落子时由控制台
  在 `onEvent` 里随机指定 `color`，选手端落子事件不再携带颜色，预览显示为中性灰「?」。

## 挑战拼图（Challenge Puzzle）

清华 / 北大 1v1 同步拼图挑战。主持人在电脑控制台出题并启动统一倒计时，两台 iPad 显示完全相同
的题面、拼图块、倒计时和结果。选手用实物拼图作答；时间结束后，主持人录入双方完成的最高 Step，
Step 高者赢，同 Step 判平局。

- iPad 同步页：`/challenge-puzzle/index.html`
- 主持人控制台：`/challenge-puzzle/admin.html`
- 房间名：`challenge-puzzle`
- 同步后端不写死在仓库里：用 `?backend=https://你的后端` 打开一次，或在控制台“同步后端”区保存地址。
- 题库包含每题 `maxStep`，并用求解器验证官方答案和更高 Step 不可行。
- 规则引擎单测：`node --test scripts/test_challenge_puzzle.mjs`

## 贡献方向

- 继续细化剩余七种训练游戏。
- 对照公开视频还原每个游戏的节奏、动画、开始/失败/成功流程。
- 替换更合适的 CC0、宽松许可或自制素材。
- 增加移动端适配、无障碍标签和可测试的关卡生成器。
