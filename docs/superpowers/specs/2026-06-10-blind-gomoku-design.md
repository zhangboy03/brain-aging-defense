# 盲五子棋（Blind Gomoku）设计

日期：2026-06-10
状态：方案 A 已获用户批准，授权自主执行到部署

## 1. 背景

复刻 Netflix《The Devil's Plan》S1E10 密室淘汰赛中的「盲五子棋」（盲五子棋 / Blind Gomoku，
规则来源：视频 https://www.youtube.com/watch?v=4LxJugqygUs 的字幕与画面帧）：

- 本质是标准五子棋：每颗棋子**底层身份**是黑或白，先用自己的真实颜色连成五子者胜。
- 但棋子**顶面与侧面被涂成杂色**（红/黄/蓝/绿/粉/紫/白/黑），落到棋盘上后从表面
  完全看不出黑白归属。
- 玩家必须**靠记忆**记住自己和对方每一手的落点；表面颜色是纯干扰，也是心理战工具
  （节目中 Seok-jin 故意用黄色给攻击子做标记，AI 则故意跟用同色扰乱他）。

**使用场景**：清华、北大两队各持一台 iPad 实时对战；主持人用电脑控制台开局/重置并观战
（上帝视角）。前端托管 GitHub Pages，复用本仓库已部署的 SSE relay 后端
（`server/app.py` @ `https://brain-aging-sync.ai-builders.space`，见
`2026-06-10-cross-device-sync-design.md`）。

## 2. 已确认的规则决策

| 决策点 | 结论 |
|---|---|
| 表面颜色 | 玩家落子时从 8 色调色盘自选（红/黄/蓝/绿/粉/紫/白/黑） |
| 设备拓扑 | 两台 iPad（棋手视角）+ 主持人控制台（上帝视角 + 流程控制） |
| 胜负判定 | 系统自动判定；连五瞬间宣布胜负并**全盘翻面揭示**真实黑白，高亮获胜五连 |
| 队伍/黑白 | iPad 进房间选「清华」或「北大」；开局时系统随机分配黑/白，黑先 |
| 棋盘 | 15×15 标准盘 |
| 禁手 | 无禁手；五连或更长（长连）即胜 |
| 悔棋/计时 | 都没有（记忆游戏本质决定不能悔棋；节奏由主持人现场控制） |
| 平局 | 棋盘下满无人连五为平局 |

## 3. 架构（方案 A：控制台 = 游戏引擎）

后端 relay **零改动**，继续保持游戏无感知的哑管道。游戏逻辑全部在前端：

```
 iPad-清华                 iPad-北大
   │ pushEvent(move请求)      │ pushEvent(move请求)
   ▼                          ▼
 ┌──────────── relay（现有，不改）────────────┐
 │  /r/blind-gomoku/event  → 广播给所有订阅者  │
 │  /r/blind-gomoku/state  → 存快照 + 广播     │
 │  /r/blind-gomoku/sse    → 订阅(连上即补快照)│
 └────────────────────────────────────────────┘
   ▲ pushState(权威快照)        │ SSE
   │                            ▼
 主持人控制台 admin.html      两台 iPad 渲染
 （唯一权威：校验move、       （收到 state 重绘）
   更新棋局、判胜负）
```

- iPad 的落子只是**请求**（event）；控制台订阅 SSE 收到后**校验**（gameId 匹配、
  phase 为 playing、轮到该队、格子为空），合法则更新权威棋局并 `pushState` 完整快照。
- 非法/过期/重复的 move 请求被控制台静默丢弃；iPad 以收到的 state 为准回滚乐观渲染。
- 断线重连：relay 在每次 SSE 连接建立时自动补发最新快照（现有能力），iPad 睡眠唤醒后
  自动对齐。
- 单控制台锁（claim/heartbeat，现有能力）防止误开第二个控制台。
- 落子链路 iPad→relay→控制台→relay→iPad 约 200–400ms，轮流制棋类无感。

**前提**：主持人控制台必须全程在线（它是游戏引擎）。控制台短暂掉线不丢局——
权威状态在控制台内存 + relay 快照里各有一份，控制台刷新后从 `GET /r/blind-gomoku/snapshot`
恢复权威状态（state 里含全部所需信息）。

## 4. 文件与组件

```
public/blind-gomoku/
  core.js       # 纯游戏逻辑（无 DOM）：状态机、落子校验、连五/平局判定、随机分边
  index.html    # iPad 棋手页：选队 → 等待开局 → 对战（棋盘 + 调色盘 + 回合提示）→ 揭示
  admin.html    # 主持人控制台：开局/重置/强制结束揭示；上帝视角棋盘（真实黑白 + 表面色）
docs/superpowers/specs/2026-06-10-blind-gomoku-design.md   # 本文档
scripts/test_blind_gomoku.mjs  # node --test 单元测试（加载 core.js 测纯逻辑）
README.md       # 增补游戏说明
index.html / src 不动；public/ 由 Vite 原样拷贝进 dist，走现有 GitHub Pages 流水线。
```

`core.js` 模式与 `head-count/core.js` 一致：IIFE 挂到 `global.BlindGomoku`
（`typeof window !== 'undefined' ? window : globalThis`），node 测试可直接 import。

## 5. 状态模型（控制台权威，整体作为 relay 快照）

```js
state = {
  v: 17,                  // 单调递增版本号，iPad 丢弃旧版本
  gameId: 3,              // 每开新局 +1；move 事件必须带相同 gameId 才有效
  phase: 'lobby' | 'playing' | 'finished',
  seats: { tsinghua: 'b'|'w'|null, pku: 'b'|'w'|null },  // 开局时随机分配
  joined: { tsinghua: bool, pku: bool },                 // 两队是否已就位
  turn: 'b' | 'w',
  board: [ [null | {s:'b'|'w', c:'red'|…, n:moveNo}, …15], …15 ],  // s=真实色 c=表面色
  moveCount: 0,
  lastMove: {x,y} | null,
  winner: null | 'b' | 'w' | 'draw',
  winLine: [[x,y]×5+] | null,
  revealed: bool,         // finished 后全盘翻面
  showNumbers: bool,      // 控制台开关：是否给选手显示落子序号（默认 false）
}
```

**信息安全说明（已知取舍）**：state 广播给所有订阅者，棋子真实颜色 `s` 在 iPad 端
内存里可见。懂技术的选手开 DevTools 能作弊，但本场景是现场友谊赛 + iPad Safari
（开 DevTools 需要连 Mac），接受此风险，不做服务端隐藏（那是方案 C 的代价）。

iPad 事件（`pushEvent`）：

```js
{ type: 'join', team: 'tsinghua'|'pku' }
{ type: 'move', gameId, team, x, y, color }   // color = 表面色
```

控制台动作：开局（随机 seats、turn='b'、清盘、gameId+1、phase='playing'）、
重置回 lobby、强制结束（phase='finished'、revealed=true、winner 维持 null 表示无胜者）。

## 6. iPad 棋手页交互

1. **进房**：全屏二选一「清华 / 北大」按钮 → `join` 事件 + 本地记住队伍
   （sessionStorage，刷新不丢）。已被占的队在 state.joined 里可见，按钮置灰。
2. **等待开局**：显示「等待主持人开局…」+ 双方就位状态。
3. **对战**：
   - 顶部：本队队名 + 执子颜色（黑/白——只有自己这台 iPad 显示自己执的真实颜色，
     这是玩家唯一确定知道的真实信息）+ 回合提示（「轮到你了」/「对方思考中…」）。
   - 棋盘：深蓝发光网格风格（还原节目）；所有已落子只显示**表面色**圆片 + 落子序号
     （序号开关默认关，主持人可在控制台全局开启以降低难度）。
   - 调色盘：8 色横排，先选色（默认上次用的色）再点棋盘交点落子；
     落子需二次确认（点交点出现幽灵子 → 再点确认），防误触。
   - 乐观渲染：确认后立刻显示幽灵子为半透明，待权威 state 到达后转正/回滚。
   - 非己方回合时棋盘只读。
4. **揭示**：phase='finished' 时全盘翻面动画（表面色 → 真实黑白），高亮获胜五连，
   显示「清华(黑) 获胜」/「平局」/「主持人结束了本局」。
5. **可靠性**：Screen Wake Lock 防息屏（失败则提示关自动锁定）；EventSource 自动重连
   即自动对齐（relay 补快照）。

## 7. 控制台页（admin.html）

- claim 锁（busy 时提示并提供强制接管），心跳续锁——直接复用 `Sync.console`。
- 显示双方就位状态；按钮：**开始新一局**（两队都就位才可点）/ **重置** / **强制结束并揭示**。
- 上帝视角棋盘：每颗子内圈显示真实黑白、外环显示表面色，并标落子序号；侧栏滚动
  显示着法记录（第 n 手 清华(黑) H8 表面红）。
- 「显示序号给选手」开关（写进 state，iPad 据此显示/隐藏序号）。
- 控制台刷新恢复：启动时先 `GET /r/blind-gomoku/snapshot`，有快照则作为权威状态继续。

## 8. 错误处理

| 情况 | 处理 |
|---|---|
| move 不合法（非本回合/占用/坐标越界/gameId 过期） | 控制台静默丢弃；iPad 幽灵子在下一个 state 回滚消失 |
| 两队抢同一队名 | 控制台先到先得，后到的 join 被忽略；iPad 看 state.joined 自行更正 |
| iPad 断线/睡眠 | SSE 重连自动补快照，无需人工操作 |
| 控制台掉线/刷新 | 从 relay snapshot 恢复权威状态；期间 iPad 落子请求丢失，重下即可 |
| relay 不可达 | iPad/控制台顶部显示红色「连接断开」横幅，自动重试；无本地降级（跨设备是本游戏的全部意义） |
| 误开第二控制台 | claim 返回 busy，提示 + 可强制接管（旧台心跳失败转只读） |

## 9. 测试

- **单元测试**（`node --test scripts/test_blind_gomoku.mjs`，纯逻辑零依赖）：
  - 落子校验：回合轮转、占用拒绝、越界拒绝、lobby/finished 阶段拒绝、gameId 过期拒绝。
  - 连五判定:横/竖/两条对角、长连（≥6）也算胜、棋盘边缘的五连。
  - 平局：下满 225 手无五连。
  - 揭示数据：winner/winLine/revealed 正确。
  - 随机分边：seats 恰好一黑一白。
- **后端**：不改，现有 pytest 已覆盖。
- **手动验收**（部署后）：本机两个浏览器窗口模拟两台 iPad + 一个控制台窗口跑通整局：
  选队→开局→交替落子→连五→全盘揭示；中途断开一个「iPad」标签再连，画面自动对齐。

## 10. 部署

- 前端：merge 到 main 即触发现有 GitHub Pages workflow，无需新配置。
  - 棋手页：`https://zhangboy03.github.io/brain-aging-defense/blind-gomoku/`
  - 控制台：`https://zhangboy03.github.io/brain-aging-defense/blind-gomoku/admin.html`
- 后端：零改动，无需重新部署。房间名固定 `blind-gomoku`，与现有游戏房间天然隔离。

## 11. Dimensions in scope

确定性功能（无 LLM 参与），适用维度：

- **功能正确性**：五子棋规则引擎（落子校验、连五/长连/平局判定、随机分边）。
- **错误处理**：非法落子、过期事件、抢队冲突、断线、误开控制台。
- **性能**：跨设备同步延迟（轮流制棋类，宽松）。
- **可靠性**：iPad 睡眠唤醒自愈、控制台刷新恢复。
- **安全**：仅做最小校验（控制台校验回合与占用）；反作弊明确排除（见 §5、§14）。

## 12. Success Criteria

### C1 — 规则引擎正确
- **Criterion**：`node --test scripts/test_blind_gomoku.mjs` 覆盖 §13 全部 Happy/Edge 逻辑用例且全绿。
- **Threshold for ship**：100% 通过，0 跳过。
- **Grader**：code（node --test）。

### C2 — 跨设备同步延迟
- **Criterion**：WHEN 一台设备落子 THE SYSTEM SHALL 在同一 Wi-Fi 下 1 秒内（连续 20 手目测无一例外）让另两块屏呈现该手棋。
- **Threshold for ship**：20/20 手 ≤1s。
- **Grader**：human（部署后手动验收，三窗口模拟）。

### C3 — 断线自愈
- **Criterion**：WHEN iPad 页面断开 SSE ≥30 秒后恢复 THE SYSTEM SHALL 在 5 秒内不经刷新自动呈现与权威一致的局面。
- **Threshold for ship**：连续 3 次断连/恢复试验全部自愈。
- **Grader**：human。

### C4 — 非法操作零副作用
- **Criterion**：非本回合落子、占用点落子、过期 gameId 事件，均不改变权威状态（state.v 不递增）。
- **Threshold for ship**：单测断言 + 手动各试 1 次。
- **Grader**：code + human。

### C5 — 控制台可恢复
- **Criterion**：WHEN 控制台在对局中刷新 THE SYSTEM SHALL 从 relay snapshot 恢复权威状态，且下一手落子正常处理。
- **Threshold for ship**：手动试验 2 次均成功。
- **Grader**：human。

### C6 — 构建与部署
- **Criterion**：`npm run build` 零错误；merge 后 GitHub Pages 上 `/blind-gomoku/` 与 `/blind-gomoku/admin.html` 可访问且能连上 relay。
- **Threshold for ship**：线上 URL 全部 200 且页面可用。
- **Grader**：code（build）+ human（线上烟测）。

## 13. Test Cases

### Happy path（T1–T8，单测为主）
| ID | Input | Expected | Criterion |
|---|---|---|---|
| T1 | 两队 join 后控制台开局 | seats 恰好一黑一白，turn='b'，phase='playing'，gameId+1 | C1 |
| T2 | 黑方在空点落子（任意表面色） | board 记录 {s,c,n}，turn 翻转为 'w'，v+1 | C1 |
| T3 | 横向连五 | winner=该方，winLine 为该 5 点，phase='finished'，revealed=true | C1 |
| T4 | 纵向连五 | 同上 | C1 |
| T5 | 主对角连五 | 同上 | C1 |
| T6 | 副对角连五 | 同上 | C1 |
| T7 | 长连（6 连） | 算胜，winLine 含 ≥5 点 | C1 |
| T8 | 表面色与真实色无关（白方用黑色表面子连五） | 判定只看 s 不看 c | C1 |

### Edge cases（E1–E8）
| ID | Category | Input | Expected | Criterion |
|---|---|---|---|---|
| E1 | 回合 | 白方在黑方回合发 move | 丢弃，v 不变 | C4 |
| E2 | 占用 | 在已占交点落子 | 丢弃，v 不变 | C4 |
| E3 | 越界 | x=15 或负数 | 丢弃，v 不变 | C4 |
| E4 | 阶段 | lobby/finished 阶段发 move | 丢弃 | C4 |
| E5 | 过期 | 携带旧 gameId 的 move | 丢弃 | C4 |
| E6 | 抢队 | 两台 iPad 先后 join 同一队 | 先到先得，后者被忽略 | C1 |
| E7 | 平局 | 225 手下满无连五 | winner='draw'，phase='finished' | C1 |
| E8 | 边缘 | 紧贴棋盘边线的连五（含角点） | 正确判胜，不越界扫描 | C1 |

### Adversarial（A1–A2）
| ID | Attack type | Input | Expected behavior | Criterion |
|---|---|---|---|---|
| A1 | 伪造事件 | 手工 POST 冒充对方队伍的 move | 若恰逢该队回合则会被接受——**已知接受的风险**（§5），不在防御范围；非该队回合则丢弃 | C4 |
| A2 | 偷看状态 | DevTools 读 state 里的真实色 s | 不防御，接受风险（现场 iPad Safari 场景） | — |

## 14. Out of scope

- 不做服务端反作弊 / 真实颜色隐藏（A1/A2 明确接受，理由见 §5）。
- 不做多房间 / 多场并行、账号、observer 大屏（控制台即上帝视角，可投屏）。
- 不做计时器、悔棋、禁手规则、比分多局制（主持人口头记分）。
- 不做 AI 对手；不做本地 localStorage/BroadcastChannel 降级。
- 不做自动化端到端测试（C2/C3/C5 用一次性手动验收，本游戏为单场活动用途，
  无持续回归需求；规则引擎的回归由 C1 单测覆盖）。
