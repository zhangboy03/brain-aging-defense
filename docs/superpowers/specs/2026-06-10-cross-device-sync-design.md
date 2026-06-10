# 跨设备实时同步设计：控制台 → 多大屏

日期：2026-06-10
状态：已与用户确认方向，待 spec 评审

## 1. 背景与目标场景

仓库里有两个「主持人控制台 + 投屏大屏」式的双队竞赛游戏：

- `public/hexagon/`：蜂窝记忆抢答（`admin.html` 控制台 + `index.html` 大屏）
- `public/head-count/`：数人头记忆题（`index.html` 控制台 + `player.html` 大屏）

**真实使用场景（用户确认）：**

- 用户用**自己的电脑**作为**唯一控制台**。
- 外部有**两个 iPad 同时在线**作为大屏：一个给北大队、一个给清华队。
- 控制台要让两个 iPad 画面**完全同步**：相同的题目、对方是否抢答、自己是否答对，
  这些都要实时广播并保持一致。两个 iPad 是「镜像」，内容完全相同。

**当前问题：** 两个游戏的跨页面同步只用了 `localStorage` + `BroadcastChannel`，
二者都只在「同一浏览器、同源、不同标签页」之间生效，**完全无法跨设备**。
手机控制台无法控制电脑大屏，电脑控制台也无法控制 iPad，原因是状态从未上过网。

## 2. 约束

- **部署平台**：GitHub Pages（纯静态，不能跑常驻后端）托管前端；
  跨设备中转后端部署到 **AI Builder Space**（底层 Koyeb 容器）。
- **AI Builder Space 部署约束**：根目录 `Dockerfile`、**单进程单端口**、256MB 内存、
  必须读 `PORT` 环境变量、**public 仓库**、**不得提交密钥**。
  部署地址 `https://{service-name}.ai-builders.space`，免费 12 个月、最多 2 个服务。
- 后端代码放**本仓库**（用户确认），根 Dockerfile 只构建后端，
  GitHub Pages 的 Actions 流水线照旧、与后端部署互不干扰。

## 3. 架构

```
   电脑控制台(唯一)
        │  POST state / event（每个动作即时推）
        ▼
 ┌────────────────────────────────────────────────┐
 │  中转后端  FastAPI 单进程  @ ai-builders.space    │
 │  • 每个房间内存保存「最新 state 快照」             │
 │  • 控制台 POST 推 state / event                  │
 │  • 大屏 GET SSE 订阅；连上即收当前快照             │
 │  • 单控制台锁：claim + 心跳，超时自动释放          │
 └────────────────────────────────────────────────┘
        │ SSE              │ SSE
        ▼                  ▼
   iPad-A(北大队)       iPad-B(清华队)   ← 收到相同流，画面一致
```

中转**对游戏逻辑无感知**，只搬运不透明的 JSON。房间名区分游戏：`hexagon` / `head-count`。
一个通用服务覆盖两个游戏，只占 1 个服务额度。

## 4. 核心设计：state 快照 + event 命令（双语义）

两个游戏的同步模型不同，中转必须同时支持两种语义：

- **`state`（声明式快照）**：房间的「最新真相」。后端**存下来**，
  **任何新订阅者一连上立刻收到它**，因此中途连入 / 断线重连都能立刻对齐当前画面。
- **`event`（命令式事件）**：「现在触发这个动作」（如播放动画）。后端只转发给
  **当前在线**的订阅者，**不补发**给未来连入者。

各游戏如何映射：

- **hexagon**：渲染完全是声明式的（大屏从完整状态 `S` 渲染）。
  → **只用 `state`**，每次把完整 `S` 作为快照推送。语义零损失。
- **head-count**：事件式协议。
  - `round`（已生成题目）、`scores`、当前 phase → 作为 `state` 快照（中途连入能渲染正确静态画面）。
  - `start` / `reveal` / `reset`（触发动画）→ 作为 `event`。
  - 控制台维护一个 `snapshot = {round, roundNo, phase, scores}`，每次动作更新并作为 `state` 推送；
    动画触发同时再推一个 `event`。新连入的 iPad 收到 `state` 渲染正确静态画面，随后等下一个 `event`。

## 5. 后端 API（FastAPI）

| 端点 | 方法 | 谁用 | 作用 |
|---|---|---|---|
| `/r/{room}/state` | POST | 控制台 | 推完整快照；后端覆盖保存，并广播给在线订阅者 |
| `/r/{room}/event` | POST | 控制台 | 推命令式事件；只广播给在线订阅者，不保存 |
| `/r/{room}/sse` | GET | 大屏 | SSE 长连接；连上先收一次当前快照，之后实时收 state/event |
| `/r/{room}/claim` | POST | 控制台 | 领房间锁；返回是否已有别的控制台在线 + 锁 token |
| `/r/{room}/heartbeat` | POST | 控制台 | 续锁心跳（带锁 token） |
| `/healthz` | GET | 平台 | 健康检查 |

实现要点：

- 状态全部**在内存**（`dict[room] -> {state, subscribers, lock}`）。容器重启状态丢失可接受
  （重新生成一题即可；控制台重连后会重推 state）。不引数据库，省内存、合规 256MB。
- SSE 用 `asyncio.Queue` 给每个订阅者一个队列；POST 时把消息塞进该房间所有队列。
- **SSE 必带头**：`Content-Type: text/event-stream`、`Cache-Control: no-cache`、
  `X-Accel-Buffering: no`、`Connection: keep-alive`。
- **保活**：每 ~15s 向每个 SSE 连接写一个注释帧 `: ping\n\n`，防代理/Koyeb 掐空闲连接。
- **CORS**：允许来自 GitHub Pages 源（`https://zhangboy03.github.io`）的请求；
  SSE 本身不受 CORS 预检限制，但 `POST state/event` 需要 `Access-Control-Allow-Origin`。
- 依赖只用 `fastapi` + `uvicorn[standard]`，镜像精简。

## 6. 单控制台锁

- 控制台打开时 `POST /claim`：
  - 若无活跃控制台（或上一个心跳超时 > 10s）→ 发新锁 token，成为活跃控制台。
  - 若已有活跃控制台 → 返回 `busy`，前端提示「⚠️ 已有控制台在线」，
    提供「强制接管」按钮（再次 claim 带 `force=true`，旧控制台下次心跳被拒、转只读）。
- 控制台每 ~4s `POST /heartbeat` 续锁；关闭/崩溃后 10s 锁自动释放。
- 本场景中只有一台笔记本作控制台、iPad 只作大屏，所以锁主要是「防误开第二个控制台」的安全网。

## 7. 客户端：共享 `public/sync.js`

封装一层，两个游戏的 admin 和大屏都引入：

- `Sync.display(room, onState, onEvent)`：大屏用。建立 `EventSource`，自动重连；
  收到 `state` 调 `onState`，收到 `event` 调 `onEvent`。
- `Sync.console(room)`：控制台用。提供 `pushState(s)` / `pushEvent(e)` / `claim()` /
  心跳定时器；返回锁状态。
- `BACKEND` 常量写在文件顶部（`https://{service}.ai-builders.space`）。
- **降级**：探测后端不可达时，回退到原 `localStorage` + `BroadcastChannel`
  （同设备仍可用），不破坏现有体验。

## 8. iPad / Safari 现场可靠性（必须实现）

1. **自动重连 + 重连即重发快照**：iOS Safari 锁屏/切网/省电会断 SSE；
   `EventSource` 自带重连，relay 在每次连接时立刻补发当前完整 `state`。
2. **保活心跳帧**（见 §5）。
3. **防息屏**：大屏页用 **Screen Wake Lock API**（Safari 16.4+）申请常亮，
   失败则降级提示用户把「自动锁定」设为永不。
4. **禁缓冲头**（见 §5）。
5. **可选的紧同步**：若两屏动画起播时刻要更齐，`start` 事件可带一个很小的前置延时，
   两屏收到后同时起播。MVP 先不做，普通 SSE 扇出（屏间差 ~几十毫秒）已足够。

## 9. 倒计时优化（顺手）

hexagon 控制台现在每 250ms 推一次完整状态（4 条/秒，上网太吵）。
改为：进入倒计时只推一次「结束时间戳 `endAt`」，大屏本地每 250ms 自行 tick 显示。
每轮网络上只发几条消息，画面照样顺滑。

## 10. 仓库改动清单（均在本仓库）

```
server/app.py            # FastAPI 中转后端
server/requirements.txt  # fastapi, uvicorn[standard]
Dockerfile               # 根目录，只构建后端：CMD sh -c "uvicorn server.app:app --host 0.0.0.0 --port ${PORT:-8000}"
.dockerignore            # 挡掉 node_modules / dist / src 等前端产物
public/sync.js           # 共享客户端同步层
public/hexagon/admin.html, index.html   # 接 sync.js，替换 localStorage/BroadcastChannel
public/head-count/index.html, player.html, core.js?  # 接 sync.js，引入 state/event 映射
README.md                # 增补「多屏同步架构」与场景说明
```

## 11. 非目标（Out of scope）

- 不做多场比赛 / 多房间管理后台；房间名固定两个。
- 不做账号 / 鉴权（中转是低风险展示用途；锁只防误开第二控制台）。
- 不做状态持久化（容器重启即重置，可接受）。
- 不把游戏页面迁出 GitHub Pages（保持现状更稳）。
- iPad 不做按队定制画面（两屏镜像，完全相同）。

## 12. 成功标准

- 电脑控制台的每个动作（出题 / 开始 / 抢答 / 判对错 / 比分），
  在两个 iPad 上 **1 秒内** 同步呈现，且两屏内容一致。
- 任一 iPad 断线重连后，**自动**回到与控制台一致的当前画面，无需手动刷新。
- 第二个 iPad 中途打开，立刻显示当前题目与比分（不是旧画面或空白）。
- 误开第二个控制台会被提示，不会与第一个控制台冲突。
- 后端不可达时，同设备多页面仍能通过本地回退同步（不报错、不白屏）。
