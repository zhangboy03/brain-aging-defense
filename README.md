# 清年阁综艺游戏库

清年阁历次活动使用过的浏览器综艺游戏与互动原型。仓库统一保存游戏页面、主持人控制台、选手/观众大屏、跨设备同步服务和规则测试，便于复用、复盘与继续迭代。

## 在线入口

- 游戏主页：<https://zhangboy03.github.io/qingniange-variety-games/>
- 各游戏的主持人、选手与观众入口见 [`docs/game-archive.md`](docs/game-archive.md)

## 游戏归档

| 游戏 | 目录 | 形态 |
| --- | --- | --- |
| 脑力八练（暗格追踪） | `/` | 单人训练主页 |
| 蜂窝抢答（HEXAGON） | `/hexagon/` | 主持人控制台 + 投屏 |
| 进出数数 | `/head-count/` | 主持人控制台 + 选手大屏 |
| 魔方大战 | `/cube-battle/` | 主持人控制台 + 投屏 |
| 盲五子棋 | `/blind-gomoku/` | 主持人控制台 + 双方选手页 |
| 盲五子棋（随机色版） | `/blind-gomoku-v2/` | 历史玩法变体 |
| 挑战拼图 | `/challenge-puzzle/` | 主持人控制台 + 选手/观众页 |

详细玩法、页面角色、同步房间和测试命令集中记录在[游戏档案](docs/game-archive.md)中。新增游戏时，请同时更新该档案，避免入口和规则散落。

## 本地开发

```bash
npm install
npm run dev
```

构建与测试：

```bash
npm run build
node --test scripts/test_blind_gomoku.mjs
node --test scripts/test_challenge_puzzle.mjs
node --test scripts/test_head_count.mjs
node --test scripts/test_sync_contracts.mjs
python3 -m pytest server/test_app.py
```

## 项目结构

- `src/`：脑力八练 React 主页与暗格追踪游戏
- `public/<game>/`：各综艺游戏的静态页面与浏览器端规则引擎
- `public/sync.js`：跨设备实时同步客户端
- `server/`：FastAPI 同步中转服务
- `scripts/`：规则与同步契约测试
- `docs/game-archive.md`：游戏归档总表
- `docs/superpowers/`：早期设计与实施记录

## 多屏实时同步

需要跨设备联动的游戏采用“主持人控制台 + 多个投屏/选手页”结构。控制台把状态和事件发送到 FastAPI 中转服务，大屏通过 SSE 接收广播；后端不可达时，页面回退到同设备的 `localStorage` / `BroadcastChannel` 同步。

- 默认同步后端：`https://bsync.zhangboy.xyz`
- 后端部署：根目录 `Dockerfile`、`deploy.sh` 与 `server/`
- 同步客户端：`public/sync.js`

## 技术栈

- React、TypeScript、Vite
- 原生 HTML、CSS、JavaScript 游戏页面
- FastAPI、SSE
- GitHub Pages

## 维护约定

- 保留已经实际使用过的玩法版本；变体使用独立目录，不覆盖旧版。
- 每个游戏的页面入口、同步房间和测试方式都登记到游戏档案。
- 优先使用原创或许可清晰的素材。
- 修改同步协议或规则引擎后，运行对应测试并完成实际多屏演练。
