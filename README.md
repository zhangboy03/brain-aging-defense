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

## 贡献方向

- 继续细化剩余七种训练游戏。
- 对照公开视频还原每个游戏的节奏、动画、开始/失败/成功流程。
- 替换更合适的 CC0、宽松许可或自制素材。
- 增加移动端适配、无障碍标签和可测试的关卡生成器。
