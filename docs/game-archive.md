# 清年阁综艺游戏档案

本页是仓库内游戏的统一索引。路径均相对于 GitHub Pages 根地址：

`https://zhangboy03.github.io/qingniange-variety-games/`

## 当前游戏

| 游戏 | 玩家/投屏入口 | 主持人入口 | 归档说明 |
| --- | --- | --- | --- |
| 脑力八练（暗格追踪） | `/` | 无 | 单人猫鼠位置记忆训练；同页另有 7 个待细化训练入口 |
| 蜂窝抢答（HEXAGON） | `/hexagon/` | `/hexagon/admin.html` | 记忆数字位置后围绕目标数抢答，支持比分与多屏同步 |
| 进出数数 | `/head-count/player.html` | `/head-count/` | 观察人物进出并回答最终人数 |
| 魔方大战 | `/cube-battle/` | `/cube-battle/admin.html` | 找出两幅魔方图中唯一不同的色块，主持人判分 |
| 盲五子棋 | `/blind-gomoku/` | `/blind-gomoku/admin.html` | 棋子真实阵营被表面颜色遮蔽，控制台为权威引擎 |
| 盲五子棋（随机色版） | `/blind-gomoku-v2/` | `/blind-gomoku-v2/admin.html` | 保留旧版的独立变体；落子表面色由控制台随机指定 |
| 挑战拼图 | `/challenge-puzzle/` | `/challenge-puzzle/admin.html` | 双队依序放置可旋转拼图块，另有 `/challenge-puzzle/audience.html` 观众页 |

## 同步与测试索引

| 游戏/组件 | 同步房间 | 自动化检查 |
| --- | --- | --- |
| 蜂窝抢答 | `hexagon` | `node --test scripts/test_sync_contracts.mjs` |
| 进出数数 | `head-count` | `node --test scripts/test_head_count.mjs` |
| 魔方大战 | `cube-battle` | `node --test scripts/test_sync_contracts.mjs` |
| 盲五子棋 | `blind-gomoku` | `node --test scripts/test_blind_gomoku.mjs` |
| 盲五子棋（随机色版） | `blind-gomoku-v2` | `node --test scripts/test_blind_gomoku.mjs` |
| 挑战拼图 | `challenge-puzzle` | `node --test scripts/test_challenge_puzzle.mjs` |
| 同步中转服务 | 各游戏独立房间 | `python3 -m pytest server/test_app.py` |

## 归档规则

1. 已在活动中使用过的版本不原地覆盖；玩法明显变化时建立新目录。
2. 新增或调整游戏时，同步维护本页的入口、角色、房间名和测试命令。
3. `public/<game>/` 保存可直接部署的页面；共享同步逻辑放在 `public/sync.js`。
4. 设计与实施过程记录保存在 `docs/superpowers/`，不作为当前入口清单。
