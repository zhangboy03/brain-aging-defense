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

**消息消费规则**（relay 广播是无差别全员扇出，各端必须按 kind 过滤）：
控制台只消费 `event`、忽略 `state`（包括自己 pushState 的回显，否则与内存权威状态打架）；
iPad 只消费 `state`、忽略 `event`（包括双方的 move 请求回显）。

**「请求必达」不成立时的自愈原则**：relay 的 event 不持久化、广播只达当前在线者，
因此协议中所有「请求-裁决」环节都不假设单次送达，而是**让一切关键信息可从 state
快照单源重建/重发**：

1. **join 状态驱动重发**：iPad 每次收到 state 时，若本机已选队且
   `state.joined[myTeam] === null`（座位空），则自动重发 join（幂等）。
   控制台后开 / 刷新窗口期丢失的 join 由此自愈。座位被**其他** deviceId 占用时
   **不重发**（注定被拒），只走「该队已被占用，请重新选队」UI。
2. **pushState 必达且不回退**：控制台的 pushState 是**单飞串行 sender**——同一时刻
   最多一个在途请求，请求体永远取**当前最新**权威 state（dirty 标记：在途期间状态又变了
   就在完成后再发最新值）。禁止按调用逐个重试原始 payload，否则旧 v 的重试晚到会把
   relay 快照回退（relay 对 /state 是无条件最后写入者覆盖），控制台刷新会从回退的快照
   恢复而丢手数。SSE 每次重连（onopen）时**无条件重推当前权威 state**——覆盖 relay
   容器重启丢快照的场景。
3. **决胜手也走 2 的串行 sender**，不存在「phase 已 finished 但 iPad 永远看不到揭示」。

**前提**：主持人控制台必须全程在线（它是游戏引擎）。控制台短暂掉线不丢局——
权威状态在控制台内存 + relay 快照里各有一份，控制台刷新后从 `GET /r/blind-gomoku/snapshot`
恢复权威状态（state 里含全部所需信息）。

**锁的真实语义与接管**：relay 不校验 state/event 的锁 token，锁纯属客户端自律，
且 sync.js 的心跳响应被丢弃、旧控制台无法自知失锁。因此 admin.html 必须**自行检查
心跳响应**：收到 `ok:false` 立即转只读（停止处理 move、停止 pushState，显示
「已被另一控制台接管」横幅），杜绝双引擎 split-brain。控制台启动时 claim 返回 busy
则自动 `force=true` 重试一次（刷新场景下旧锁要 10s 才过期；锁本来就只是防误开的
安全网，被顶掉的一方会因心跳失败转只读）。

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
  epoch: 1749571200000,   // 控制台每次冷启动（无快照可恢复时）取 Date.now()
  v: 17,                  // epoch 内单调递增
  // iPad 接受规则：epoch 更大 → 无条件全量接受；epoch 相同 → 只接受 v 更大的。
  // 否则 relay 重启+控制台刷新后 v 从头计数，iPad 会按旧规则静默丢弃一切新状态。
  gameId: 3,              // 每开新局 +1；move 事件必须带相同 gameId 才有效
  phase: 'lobby' | 'playing' | 'finished',
  seats: { tsinghua: 'b'|'w'|null, pku: 'b'|'w'|null },  // 开局时随机分配
  joined: { tsinghua: deviceId|null, pku: deviceId|null }, // 就位=记录设备指纹，防双机绑同队
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
{ type: 'join', team: 'tsinghua'|'pku', deviceId }  // deviceId: iPad 首次打开时随机生成，存 sessionStorage
{ type: 'move', gameId, team, x, y, color }         // color = 表面色
```

join 语义：某队为空 → 记录该 deviceId，**并把该 deviceId 从另一队移除**（换队闭环：
重选队伍后旧座位自动释放）；已是同一 deviceId → 幂等忽略；已被**其他** deviceId
占用 → 忽略。deviceId 存 **localStorage**（不是 sessionStorage——iPad Safari 关标签
重开后必须仍是同一身份，否则自己的死 deviceId 会把座位占死）。iPad 只在
`state.joined[myTeam] === myDeviceId` 时才认为自己就位，否则显示
「该队已被占用，请重新选队」并允许重选（清除本地队伍绑定）。
胜负判定优先级：**先判连五，再判下满**（第 225 手连五算胜不算平）。

控制台动作：开局（随机 seats、turn='b'、清盘、gameId+1、phase='playing'）、
重置回 lobby（**同时清空 joined**，iPad 凭重发机制自动重新 join）、
强制结束（phase='finished'、revealed=true、winner 维持 null 表示无胜者）。

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
   - 乐观渲染：确认后立刻显示半透明幽灵子。**转正/回滚不以「下一个 state」为准**
     （无关 state 如序号开关切换会误杀在途合法 move），裁决以**权威格内容**为准：
     新 state 中该格已有子 → 转正；turn 已翻转但该格仍空 → 清除（如强制结束/新开局）；
     若 5 秒内无裁决（如 move 在控制台离线期丢失）→ 超时清除幽灵子并恢复可下，
     提示「未送达，请重下」。
   - 非己方回合时棋盘只读。
4. **揭示**：phase='finished' 时全盘翻面动画（表面色 → 真实黑白），高亮获胜五连，
   显示「清华(黑) 获胜」/「平局」/「主持人结束了本局」。
5. **可靠性**：Screen Wake Lock 防息屏（失败则提示关自动锁定）；EventSource 自动重连
   即自动对齐（relay 补快照）。另加**僵尸连接看门狗**：relay 在队列满时会把订阅者移出
   广播列表但连接表面仍活着（EventSource 不会自发重连），因此 SSE 一经建立即**常开**
   看门狗——90 秒未收到任何消息就主动 `es.close()` 重建连接（重建即补快照，误触发
   无害）。不限定 phase：僵尸连接恰恰最常坑在 lobby「等待开局」和 finished
   「等待新一局」阶段，本地 phase 已过期，不能作为守护条件。

## 7. 控制台页（admin.html）

- claim 锁：启动时 claim，busy 则自动 `force=true` 重试一次（覆盖刷新后旧锁未过期的
  10s 窗口，对齐 C5「刷新即恢复」）。**心跳自管**：sync.js 的内置心跳响应被丢弃、
  无法检查，admin 直接 `fetch` 打 `/claim`、`/heartbeat` 自建心跳循环并检查响应
  （sync.js 只用其 pushState/pushEvent；若同时存在 sync.js 内置心跳，同 token 续期，
  冗余无害）。心跳 `ok:false` 立即转只读 +「已被另一控制台接管」横幅；横幅上提供
  **「重新接管」按钮**（force claim → 从 snapshot 恢复 → 退出只读）——否则误开的
  第二控制台被关掉后，游戏将永久无引擎。
- 显示双方就位状态；按钮：**开始新一局**（两队都就位才可点）/ **重置** / **强制结束并揭示**。
- 上帝视角棋盘：每颗子内圈显示真实黑白、外环显示表面色，并标落子序号；侧栏滚动
  显示着法记录（第 n 手 清华(黑) H8 表面红）。
- 「显示序号给选手」开关（写进 state，iPad 据此显示/隐藏序号）。
- 控制台刷新恢复：启动时先 `GET /r/blind-gomoku/snapshot`，有快照则作为权威状态继续。

## 8. 错误处理

| 情况 | 处理 |
|---|---|
| move 不合法（非本回合/占用/坐标越界/gameId 过期） | 控制台静默丢弃；iPad 幽灵子按 §6 裁决/超时规则清除 |
| 两队抢同一队名 | deviceId 先到先得；后到 iPad 见 `joined[team] !== myDeviceId`，提示重选队 |
| join 在控制台离线/刷新窗口丢失 | iPad 状态驱动重发（见 §3 自愈原则 1），自动补上 |
| iPad 断线/睡眠 | SSE 重连自动补快照；僵尸连接由 90s 看门狗重建 |
| 控制台掉线/刷新 | 从 relay snapshot 恢复权威状态（含 epoch/v 续接）；期间 iPad 落子请求丢失，幽灵子 5s 超时提示重下 |
| relay 不可达 / pushState 失败 | 顶部红色「连接断开」横幅；pushState 自动重试直至成功，控制台 SSE 重连时无条件重推 state |
| relay 容器重启丢快照 | 控制台重推 state 恢复；若控制台同时刷新，epoch 机制保证 iPad 接受新序列 |
| 误开第二控制台 | 新台自动强制接管，旧台心跳响应 ok:false 转只读 + 横幅 |
| 接管后的控制台又被关闭 | 旧台（或任一控制台）点横幅上的「重新接管」恢复引擎；期间 move 由幽灵子超时提示兜底 |
| iPad 标签被关闭重开 | deviceId 在 localStorage，重开仍是同一身份，重选本队即幂等恢复 |
| iPad 中途换队 | join 新队自动从旧队释放座位（换队闭环） |

## 9. 测试

- **单元测试**（`node --test scripts/test_blind_gomoku.mjs`，纯逻辑零依赖）：
  - 落子校验：回合轮转、占用拒绝、越界拒绝、lobby/finished 阶段拒绝、gameId 过期拒绝。
  - 连五判定:横/竖/两条对角、长连（≥6）也算胜、棋盘边缘的五连。
  - 平局：下满 225 手无五连；第 225 手连五 → 算胜不算平（优先级）。
  - 揭示数据：winner/winLine/revealed 正确。
  - 随机分边：seats 恰好一黑一白。
  - join 语义：空位记录 deviceId、同 deviceId 幂等、异 deviceId 拒绝、换队自动释放
    旧座位、重置清空 joined。
  - state 接受规则：epoch 大无条件接受；同 epoch 比 v；旧的丢弃。
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
| E6 | 抢队 | 两台 iPad（不同 deviceId）先后 join 同一队 | 先到的 deviceId 占位，后者被拒；同 deviceId 重发幂等 | C1 |
| E7 | 平局 | 225 手下满无连五 | winner='draw'，phase='finished' | C1 |
| E8 | 边缘 | 紧贴棋盘边线的连五（含角点） | 正确判胜，不越界扫描 | C1 |
| E9 | 优先级 | 第 225 手（下满）同时连五 | winner=该方，不是 draw | C1 |
| E10 | 版本 | 收到 epoch 更大但 v 更小的 state | 无条件接受（控制台冷启动新序列） | C1 |

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
