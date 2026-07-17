# iWork Agent 技术详细设计

> 基于 `docs/requirements.md` v0.1，Client-Server 模式
>
> Client: Electron | Server: Python FastAPI | 通信: MCP Streamable HTTP | 存储: PostgreSQL + pgvector

---

## 目录

- [1. Query Loop 引擎](#1-query-loop-引擎)
  - [1.1 架构概览](#11-架构概览)
  - [1.2 状态机](#12-状态机)
  - [1.3 Per-Message 核心循环](#13-per-message-核心循环)
  - [1.4 三种模式的行为汇总](#14-三种模式的行为汇总)
  - [1.5 Plan 模式子流程](#15-plan-模式子流程)
  - [1.6 Build 模式子流程](#16-build-模式子流程)
  - [1.7 消息排队流程](#17-消息排队流程)
  - [1.8 异常处理](#18-异常处理)
    - [1.8.1 异常全景图（按 Loop 执行链路排列）](#181-异常全景图按-loop-执行链路排列)
    - [1.8.2 四级处理策略](#182-四级处理策略)
    - [1.8.3 重试与退避实现](#183-重试与退避实现)
    - [1.8.4 重复操作检测](#184-重复操作检测)
    - [1.8.5 流连接断开时的缓冲回放](#185-流连接断开时的缓冲回放)
    - [1.8.6 引擎恢复（服务器重启后）](#186-引擎恢复服务器重启后)
  - [1.9 前后端主对话接口完整定义](#19-前后端主对话接口完整定义)
    - [1.9.1 接口总览](#191-接口总览)
    - [1.9.2 接口详细定义](#192-接口详细定义)
      - [工具分类：客户端工具 vs 服务端 MCP](#工具分类客户端工具-vs-服务端-mcp)
      - [Plan 模式数据块详解](#plan-模式数据块详解)
      - [Build 模式数据块详解](#build-模式数据块详解)
    - [客户端处理汇总](#客户端处理汇总)
    - [1.9.3 错误码参考](#193-错误码参考)
    - [1.9.4 典型交互时序](#194-典型交互时序)

---

## 1. Query Loop 引擎

### 1.1 架构概览

QueryLoopEngine 是 Server 端每个会话的**长生命周期、单实例协程**，内部维护消息 FIFO 队列，逐条出队执行，单条消息内部按 turn 循环调用 LLM，直到达到终止条件或上限。

```
┌─ QueryLoopEngine (会话级单实例, 生命周期=会话) ─────────────┐
│                                                             │
│   MessageQueue (FIFO, 上限 10)                               │
│   ┌──────┐ ┌──────┐ ┌──────┐                               │
│   │ msg3 │ │ msg2 │ │ msg1 │ ← 队首                         │
│   └──────┘ └──────┘ └──────┘                               │
│        ↑                          ↓                         │
│   用户发送消息入队           dequeue → 开始执行               │
│   (loop 运行中不中断)         完成后自动取下一条               │
│                                                             │
│   ┌──────────────────────────────────────────────────────┐  │
│   │                Per-Message Loop                      │  │
│   │        turn 1..max_turns(25), timeout(300s)          │  │
│   │                                                      │  │
│   │  context → llm.stream() → parse → dispatch → append  │  │
│   │                                                      │  │
│   │  ┌──────────┐  ┌─────────────┐  ┌───────────────┐   │  │
│   │  │StepPlanner│  │ToolDispatcher│  │ResponseBuilder│   │  │
│   │  └──────────┘  └─────────────┘  └───────────────┘   │  │
│   └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 状态机

```
                    ┌──────────────────────────────────────┐
                    │           SESSION_ACTIVE               │
                    │                                        │
    ┌──────┐ 入队    │  ┌──────────┐    ┌──────────────┐    │
    │ IDLE │───────►│  │PROCESSING│───►│WAITING_SYNC  │    │
    └──────┘        │  └──────────┘    └──────┬───────┘    │
       ↑            │       ↑                 │            │
       │ 队空,无待   │       │ 确认/跳过/      │            │
       │ 处理消息    │       │ 工具结果回传     │            │
       │            │       │                 │            │
       │            │  ┌────┴────┐            │            │
       │            │  │ 有下一条 │◄───────────┘            │
       │            │  │ 消息     │                         │
       │            │  └─────────┘                         │
       └────────────┴───────────────────────────────────────┘
```

| 状态 | 说明 |
|------|------|
| **IDLE** | 消息队列为空，等待新消息。空闲超时（默认 30 分钟）后会话可归档 |
| **PROCESSING** | 队首消息出队，执行 per-message loop（内部 turn 1..25） |
| **WAITING_SYNC** | 暂停等待：Plan 模式等用户确认计划或回答问题 / Build 模式每步等确认 / Client 工具执行等结果回传 |

重试路径：工具执行失败 → 错误计数累加 → < 3 次重试，≥ 3 次终止并反馈用户 → `TERMINAL`

### 1.3 Per-Message 核心循环

```python
# 伪代码
async def run_message(session_id: str, message: Message):
    turn = 0
    terminal = False
    mode = await session_manager.get_mode(session_id)  # ask / plan / build
    plan_confirmed = False
    plan_text_buffer = ""  # Plan 模式 turn 1 累积 LLM 输出的计划文本
    build_step = 0

    while turn < MAX_TURNS and not terminal:
        # 1. 构建上下文（含 mode 对应的 system prompt）
        ctx = await context_manager.build(session_id, turn, mode)

        # 2. LLM 流式调用
        response = await llm.stream(
            messages=ctx.messages,
            tools=ctx.available_tools if mode != "ask" else None,
            tool_choice="none" if mode == "ask" else "auto",
            system=ctx.system_prompt,
        )

        # 3. 逐数据块解析
        async for chunk in response:
            # ── 文本 + 思考：三种模式都直接流式推客户端 ──
            if chunk.type in ("thinking", "text"):
                await self._push_chunk({"type": f"agent.{chunk.type}", "delta": chunk.delta})
                if mode == "plan" and not plan_confirmed and chunk.type == "text":
                    plan_text_buffer += chunk.delta  # Plan 模式累积计划文本

            # ── Plan 模式专项：LLM 向用户提问 ──
            elif chunk.type == "plan.question":
                # plan.question 是一种特殊 tool，LLM 用它向用户发起选择题或追问
                # 前端渲染为选项卡片或输入框，用户回答后注入上下文
                await self._push_chunk({
                    "type": "plan.question",
                    "message_id": message.id,
                    "question": chunk.tool_input.get("question"),
                    "options": chunk.tool_input.get("options"),   # 可选，选择题的选项列表
                    "input_type": chunk.tool_input.get("input_type", "select"),  # select | text | confirm
                })
                answer = await self.sync_waiter.wait(self.session.id, timeout=300)
                if answer is None:
                    # 用户超时未响应
                    await context_manager.append_text(
                        session_id, "[用户未回应此问题，请跳过并继续]"
                    )
                else:
                    # 将用户答案注入上下文
                    await context_manager.append_user_response(session_id, chunk, answer)
                continue  # 继续当前 turn，不增加 turn 计数

            # ── 工具调用：三种模式行为不同 ──
            elif chunk.type == "tool_use":

                # === Ask 模式：不应出现，忽略 ===
                if mode == "ask":
                    log.warning(f"Ask mode got tool_use, skipping")

                # === Plan 模式 ===
                elif mode == "plan":
                    if not plan_confirmed:
                        # turn 1: 把第一个 tool_use 当"计划生成"处理
                        # LLM 在 Plan 模式下先输出 plan 文本，不应直接有 tool_use
                        # 走到这里说明 LLM 跳过了 plan 输出，做兜底处理
                        await self._push_chunk({
                            "type": "plan.generated",
                            "plan_text": "（LLM 直接发出了工具调用，跳过计划阶段）"
                        })
                        confirmed = await self.sync_waiter.wait(self.session.id, timeout=300)
                        if not confirmed:
                            terminal = True
                            break
                        plan_confirmed = True

                    # 计划已确认，走正常工具执行流程（不暂停）
                    await _execute_tool_chunk(session_id, chunk)

                # === Build 模式：每步暂停确认 ===
                elif mode == "build":
                    # 权限检查
                    tool_name = chunk.tool_name or "unknown"
                    tool_call_id = chunk.tool_call_id or ""
                    if not await self._check_tool_permission(msg, tool_name, chunk.tool_input or {}, tool_call_id, turn):
                        continue
                    # 推送待确认步骤
                    build_step += 1
                    await self._push_chunk({
                        "type": "build.step_pending",
                        "tool_name": chunk.tool_name,
                        "input": chunk.tool_input,
                        "step": build_step
                    })
                    decision = await self.sync_waiter.wait(self.session.id, timeout=300)
                    if decision == "confirm":
                        await _execute_tool_chunk(session_id, chunk)
                    elif decision == "skip":
                        await context_manager.append_skip_feedback(session_id, chunk)
                    elif decision == "abort":
                        terminal = True
                        break

        # 4. Plan 模式 turn 1 完成：推送 plan.generated，等待用户确认
        if mode == "plan" and not plan_confirmed:
            await self._push_chunk({
                "type": "plan.generated",
                "plan_text": plan_text_buffer  # turn 1 中通过 text 数据块累积的计划文本
            })
            confirmed = await self.sync_waiter.wait(self.session.id, timeout=300)
            if not confirmed:
                terminal = True
            else:
                plan_confirmed = True
                continue  # 跳过 turn+=1，直接进入下一轮（带 tools 的执行轮）

        # 5. 终止判断
        if response.stop_reason == "end_turn":
            terminal = True
        elif mode == "ask":
            terminal = True  # Ask 模式一轮就停

        turn += 1


async def _execute_tool_chunk(self, msg: Message, chunk: LLMChunk, turn: int):
    """工具执行：分类 → 分发 → 结果注入 → 推送客户端"""
    location = self.tool_dispatcher.classify(chunk.tool_name)
    if location == ToolLocation.CLIENT:
        await self._push_chunk({
            "type": "client.tool_request",
            "request_id": str(uuid4()),
            "tool_name": chunk.tool_name,
            "input": chunk.tool_input,
        })
        result = await self.sync_waiter.wait(self.session.id, timeout=120)
        if result is None:
            await self._push_chunk({"type": "client.tool_timeout", ...})
            result = {"success": False, "error": "客户端工具执行超时"}
    else:
        try:
            result = await asyncio.wait_for(
                self.tool_dispatcher.dispatch(self.session.id, chunk), timeout=120)
        except asyncio.TimeoutError:
            result = {"success": False, "error": "服务端工具执行超时"}
        await self._push_chunk({
            "type": "agent.tool_result",
            "tool_name": chunk.tool_name,
            "result": result,
        })
    await self.context_mgr.append_tool_result(self.session.id, chunk, result)
    msg.tool_calls_count += 1


async def _check_tool_permission(self, msg, tool_name, tool_input, tool_call_id, turn):
    """权限检查：被拒绝的工具注入错误上下文并继续"""
    try:
        self.permission.check(tool_name, tool_input or {})
        return True
    except Exception as e:
        await self._push_chunk({"type": "agent.tool_result", "tool_call_id": tool_call_id,
            "tool_name": tool_name, "result": {"success": False, "error": str(e)}})
        await self.context_mgr.append_error_feedback(self.session.id, tool_name, str(e))
        msg.tool_calls_count += 1
        return False
```

### 1.4 三种模式的行为汇总

| | Ask | Plan | Build |
|--|-----|------|-------|
| **tools 参数** | `None`, `tool_choice="none"` | turn 1 不传; 确认后传 `auto` | `auto` |
| **LLM 行为** | 纯文本回复 | turn 1 生成计划; turn 2..n 自动执行 | 每轮正常调用工具 |
| **暂停点** | 无 | 1 次（计划→确认）+ N 次（plan.question） | 每个 tool_use 1 次 |
| **Client 交互** | 仅接收流式文本 | 流推计划 → 等 POST confirm/edit/reject; 流推问题 → 等 POST plan/answer | 流推每步 → 等 POST confirm/skip/abort |
| **终止条件** | stop_reason=end_turn 或 1 轮结束 | 计划拒绝 / 步骤全部完成 | 用户 abort / 自然完成 |
| **典型场景** | "什么是闭包？" | "帮我搭建一个 React 项目" | "把 src/utils.ts 里的 foo 重构并跑通测试" |
### 1.5 Plan 模式子流程

Plan 模式的核心思想：**先审方案，再自动执行**。整个消息处理过程暂停一次——在 LLM 生成执行计划后、开始具体行动前。但在计划生成过程中，LLM 可以通过 `plan.question` 随时向用户发起交互式追问（选择题/填空题/确认框），确保需求没有遗漏。

#### 完整流程

```
用户发消息 "帮我写一个 Python 爬虫"
        │
        ▼
┌─ PROCESSING (turn 1, 不带 tools) ─────────────┐
│                                                │
│  LLM 推理中，可能穿插多次 plan.question:          │
│                                                │
│  ┌─ plan.question ────────────────────────────┐ │
│  │ "你希望爬取哪个网站？"                        │ │
│  │ options: ["新闻网站", "电商平台", "社交平台"]  │ │
│  │                                            │ │
│  │   → WAITING_SYNC                           │ │
│  │   用户选 "电商平台"                           │ │
│  │   → POST /plan/answer                      │ │
│  │   → PROCESSING，继续 turn 1                 │ │
│  └────────────────────────────────────────────┘ │
│                                                │
│  ┌─ plan.question ────────────────────────────┐ │
│  │ "需要处理反爬机制吗？"                        │ │
│  │ options: ["是，需要", "不需要"]               │ │
│  │                                            │ │
│  │   → 用户选 "是，需要"                         │ │
│  │   → POST /plan/answer → PROCESSING          │ │
│  └────────────────────────────────────────────┘ │
│                                                │
│  LLM 收集够信息后，输出完整计划文本:               │
│  { type: "plan.generated",                     │
│    plan_text: "1. 创建项目目录\n                   │
│                2. 分析目标电商网站结构\n            │
│                3. 实现反爬绕过\n                   │
│                4. 编写爬虫主逻辑\n                 │
│                5. 数据清洗与存储\n                 │
│                6. 编写 README" }                │
│                                                │
│  → 切换到 WAITING_SYNC                         │
└────────────────────────────────────────────────┘
        │
        ▼  客户端展示计划文本，用户做出选择:
        │
┌─ WAITING_SYNC ────────────────────────────────┐
│                                                │
│  [确认] 用户认可方案                             │
│  → POST /sessions/{id}/plan/confirm             │
│  → 切回 PROCESSING                              │
│  → turn 2..n 自动执行，工具调用不再暂停            │
│  → 所有步骤完成后 TERMINAL                       │
│                                                │
│  [编辑] 用户修改计划文本                          │
│  → POST /sessions/{id}/plan/edit                │
│    Body: { plan_text: "修改后的计划..." }         │
│  → 服务端更新计划文本                             │
│  → 重新推送 plan.generated                      │
│  → 再次等待用户确认（循环，不限制编辑次数）          │
│                                                │
│  [拒绝] 用户不满意方案                            │
│  → POST /sessions/{id}/plan/reject              │
│  → LLM 追加回复"计划已取消，请重新描述您的需求"     │
│  → TERMINAL，等待用户发送新消息                   │
│                                                │
└────────────────────────────────────────────────┘
```

#### plan.question 详解

`plan.question` 是 Plan 模式 turn 1 中 LLM 可调用的特殊 tool，用于向用户发起交互式提问。它只出现在 plan 未确认阶段，一旦用户确认计划进入 turn 2+，不再触发。

**三种问题类型：**

| `input_type` | 用途 | 前端渲染 | 用户返回值 |
|-------------|------|---------|-----------|
| `select` | 选择题，多选一 | 选项卡片列表 | 选中的 `option` 值 |
| `text` | 填空题，自由输入 | 文本输入框 | 用户输入的字符串 |
| `confirm` | 确认框，是/否 | 确定/取消按钮 | `true` 或 `false` |

**plan.question 数据块格式：**

```typescript
{
  type: "plan.question";
  seq: number;
  message_id: string;
  question: string;                    // 问题文本，如 "你希望部署到哪个平台？"
  options?: string[];                  // select 类型时必填，选项列表
  input_type: "select" | "text" | "confirm";
  context?: string;                    // 可选，解释为什么问这个问题
}
```

**用户回答：**

```
POST /sessions/{id}/plan/answer
Body: { answer: "电商平台" }          // select: 选项文本; text: 自由文本; confirm: "true"/"false"
```

回答直接注入 LLM 上下文，形式为：`用户关于"<question>"的回答：<answer>`。引擎切回 PROCESSING，继续当前 turn。

**超时处理：** 300s 内用户未响应 → 推送 `plan.question_timeout` → 注入 `[用户未回应此问题，请跳过并继续]` → LLM 自行决定下一步。

**与 `plan.generated` 的关系：**

- `plan.question` 是**中途暂停**，LLM 还在收集信息
- `plan.generated` 是**最终交付物**，LLM 认为信息够了，给出完整方案
- LLM 自行判断何时不再提问、何时输出最终计划
- 一次 turn 1 中 `plan.question` 可以有 0 到 N 次

#### 与 Build 模式的核心区别

| | Plan | Build |
|--|------|-------|
| 暂停次数 | 1 次（确认计划）+ N 次（plan.question，可选） | **每步暂停**（每执行一个工具前等确认） |
| 用户确认什么 | 确认"整体方案对不对"，或在计划阶段回答追问 | 确认"这一步做不做" |
| 适用场景 | 复杂多步骤任务，需要前置审核和需求澄清 | 需要精细控制每一步操作

### 1.6 Build 模式子流程

```
PROCESSING:
  LLM 返回 tool_use → push stream "build.step_pending"
  → 切换到 WAITING_SYNC

WAITING_SYNC:
  收到 POST /sessions/{id}/build/confirm  → 执行工具 → 切回 PROCESSING
  收到 POST /sessions/{id}/build/skip     → 跳过此步 → 切回 PROCESSING (通知 LLM: "此步被用户跳过")
  收到 POST /sessions/{id}/build/abort    → TERMINAL
```

### 1.7 消息排队流程

**实现原理：DB 为数据源 + asyncio.Event 为调度信号**

```
                  POST /sessions/{id}/messages
                         │
          ┌──────────────▼──────────────┐
          │  INSERT INTO messages       │
          │  (status='pending',         │
          │   queue_position=N)         │
          └──────────────┬──────────────┘
                         │
          ┌──────────────▼──────────────┐
          │  self._wake_event.set()     │  ← 跨协程唤醒引擎
          └──────────────┬──────────────┘
                         │
          ┌──────────────▼──────────────┐
          │  引擎被唤醒，dequeue:         │
          │  SELECT ... WHERE           │
          │  status='pending' ORDER BY  │
          │  queue_position LIMIT 1     │
          │  FOR UPDATE SKIP LOCKED     │
          │  → UPDATE status='processing'│
          │  → 开始 per-message loop     │
          └──────────────────────────────┘

DB + Event 混合方案的原因:

| 问题 | 纯内存 asyncio.Queue | DB + Event (本方案) |
|------|---------------------|--------------------|
| 服务器重启 | 队列丢失 | 从 DB 恢复 status='pending' |
| 并发安全 | 单进程 OK | FOR UPDATE SKIP LOCKED |
| 用户手动移除 | 需自定义索引 | UPDATE WHERE status='pending' |
| 客户端查询队列 | 需额外 API 读内存 | SELECT 即得 |
```

**引擎主循环**:

```python
class QueryLoopEngine:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.state = "IDLE"
        self._wake_event = asyncio.Event()
        self._current_msg: Message | None = None
        self._lock = asyncio.Lock()

    async def run(self):
        """会话主循环: 休眠 → 唤醒 → 处理 → 检查队列 → 休眠"""
        while True:
            msg = await self._dequeue_next()
            if msg is None:
                # 队空 → IDLE
                self.state = "IDLE"
                await self._wake_event.wait()
                self._wake_event.clear()
                continue

            # 有消息 → PROCESSING
            self.state = "PROCESSING"
            self._current_msg = msg
            await self._push_chunk({
                "type": "message.start",
                "seq": self._next_seq(),
                "message_id": msg.id,
                "mode": msg.mode,
                "scene_mode": msg.scene_mode,
                "workspace": msg.workspace,
            })

            try:
                await self._run_message_loop(msg)
            except Exception as e:
                await self._push_chunk({"type": "message.error", "message_id": msg.id, "error": str(e)})
            finally:
                await self._mark_completed(msg)
                self._current_msg = None

            # 循环 back to dequeue_next()
```

**入队 / 出队 / 移除**:

```python
async def _dequeue_next(self) -> Message | None:
    """DB 原子出队: SKIP LOCKED 避免并发竞争"""
    async with self._lock:
        row = await db.fetchrow(
            """UPDATE messages SET status='processing', queue_position=NULL
               WHERE id = (
                 SELECT id FROM messages
                 WHERE session_id=$1 AND status='pending'
                 ORDER BY queue_position ASC LIMIT 1
                 FOR UPDATE SKIP LOCKED
               )
               RETURNING *""",
            self.session_id
        )
        if row:
            await self._renumber_queue()    # 剩余消息重排 queue_position
        return Message.from_row(row) if row else None


async def enqueue(self, user_id, content, scene_mode, workspace, model, mode,
                     files=None, skill_ids=None, mcp_servers=None) -> Message:
    """HTTP handler 调用: 写入 DB + 唤醒引擎"""
    async with self._lock:
        next_pos = await db.fetchval(
            """SELECT COALESCE(MAX(queue_position), 0) + 1
               FROM messages WHERE session_id=$1 AND status='pending'""",
            self.session_id
        )
        if next_pos > 10:
            raise HTTPException(429, "队列已满，最多 10 条")

        msg = await db.fetchrow(
            """INSERT INTO messages
               (session_id, user_id, content, scene_mode, workspace, model, mode,
                files, skill_ids, mcp_servers, status, queue_position)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11)
               RETURNING *""",
            self.session_id, user_id, content, scene_mode, workspace, model, mode,
            files or [], skill_ids or [], mcp_servers or [], next_pos
        )

    self._wake_event.set()          # 唤醒引擎
    return Message.from_row(msg)


async def remove_from_queue(self, msg_id: UUID):
    """用户手动移除队列中的消息"""
    async with self._lock:
        await db.execute(
            """UPDATE messages SET status='cancelled', queue_position=NULL
               WHERE id=$1 AND session_id=$2 AND status='pending'""",
            msg_id, self.session_id
        )
        await self._renumber_queue()


async def _renumber_queue(self):
    """重排剩余 pending 消息的 queue_position 为 1,2,3..."""
    pending = await db.fetch(
        """SELECT id FROM messages
           WHERE session_id=$1 AND status='pending'
           ORDER BY queue_position ASC""",
        self.session_id
    )
    for i, row in enumerate(pending, start=1):
        await db.execute(
            "UPDATE messages SET queue_position=$1 WHERE id=$2",
            i, row["id"]
        )


```

**运行示例**:

```
1. 用户发送 msg1 → enqueue() → _wake_event.set()
   → 引擎 IDLE → 被唤醒 → _dequeue_next() → msg1 PROCESSING

2. PROCESSING 期间:
   用户发送 msg2 → enqueue(queue_position=1) → _wake_event.set() (引擎已醒,无操作)
   用户发送 msg3 → enqueue(queue_position=2)
   用户手动移除 msg3 → remove_from_queue() → msg3 cancelled

3. msg1 处理完成 → 循环回 _dequeue_next()
   → 查到 msg2 (queue_position=1) → 出队 → msg2 PROCESSING
   → 再次 _dequeue_next() → None → IDLE
```

### 1.8 异常处理

#### 1.8.1 异常全景图（按 Loop 执行链路排列）

```
enqueue() → context.build() → llm.stream() → parse events → permission.check()
                                                                    │
                                                             tool_dispatcher.dispatch()
                                                                    │
                                                     context.append_tool_result()
                                                                    │
                                                       sync_waiter.wait()
                                                                    │
                                                              _push_chunk 给客户端
```

| # | 阶段 | 异常 | 触发条件 |
|---|------|------|---------|
| 1 | **入队** | 队列满 | 队中已有 10 条 pending → HTTP 429 |
| 2 | **入队** | 重复入队 | 同一条消息 ID 重复 POST，幂等处理：查重后返回已有记录 |
| 3 | **入队** | 会话已归档 | session.status='archived' → HTTP 410 Gone |
| 4 | **build context** | DB 查询超时/失败 | PG 连接断开、慢查询 |
| 5 | **build context** | @文件不存在/过大 | 文件被外部删除或超过 8000 字限制 → 注入警告文本替代 |
| 6 | **build context** | Token 超限 | 截断历史后仍超窗口 90% → 强制摘要压缩最早轮次 |
| 7 | **llm.stream()** | 网络超时 | API 不可达 → 指数退避重试 3 次 |
| 8 | **llm.stream()** | Rate Limit (429) | 超出并发/速率配额 → 退避重试 3 次，仍失败则排队降级 |
| 9 | **llm.stream()** | 认证失败 (401/403) | API key 过期或余额不足 → 致命错误，通知用户 |
| 10 | **llm.stream()** | 流中断 | 流中途断开 → 重试 1 次，断点续传不可用则重新调用 |
| 11 | **llm.stream()** | 空响应 | LLM 未返回任何 content 或 tool_use → 重试 1 次，仍空则返回"抱歉，我暂时无法回答" |
| 12 | **llm.stream()** | 格式异常 | JSON 解析失败，tool_use.input 非法 → 错误注入上下文，让 LLM 修正 |
| 13 | **parse events** | 无限循环 | LLM 连续 3 次调用同一工具且输入/输出相同 → 强制终止，反馈"检测到重复操作" |
| 14 | **parse events** | 内容安全拦截 | API 返回 content_filter → 中止，推送"内容被安全策略拦截" |
| 15 | **permission** | 权限拒绝 | 工具/路径被策略拦截 → 错误注入上下文，LLM 尝试替代方案 |
| 16 | **dispatch** | 工具不存在 | LLM 捏造了 tool name → 错误注入上下文，列出可用工具 |
| 17 | **dispatch** | Server 工具执行失败 | MCP 不可达、API 错误 → 错误注入上下文 |
| 18 | **dispatch** | Client 工具回传超时 | 120s 内客户端未回 → 推送 tool_timeout，LLM 决定重试/跳过 |
| 19 | **dispatch** | Client 工具执行失败 | Shell 非零退出、文件写入权限不足 → 错误(含 stderr)注入上下文 |
| 20 | **dispatch** | Client 回传篡改 | request_id 不匹配 → 忽略，继续等待正确回传 |
| 21 | **wait sync** | 用户无响应超时 | Plan/Build 模式下 300s 无确认 → 推送 timeout，释放等待 |
| 22 | **stream push** | 连接断开 | 客户端离线 → 引擎继续执行，数据块写入 buffer 等待重连回放 |
| 23 | **总耗时** | 执行超时 | 单条消息总耗时超 300s → 强制终止，推送 max_turns_exceeded |
| 24 | **Max turns** | 轮次耗尽 | turn >= 25 未终止 → 强制终止 |
| 25 | **引擎层** | 并发冲突 | asyncio.Lock 兜底，2s 未获取锁则记录告警日志 |

#### 1.8.2 四级处理策略

```
第 1 级：重试（瞬时故障，自动恢复）
  网络超时、流中断、DB 连接断开
  → 指数退避: 1s → 2s → 4s，最多 3 次
  → 3 次均失败升级为第 4 级

第 2 级：降级（可恢复错误，LLM 自适应）
  工具不存在、权限拒绝、工具执行失败、@文件不存在、格式异常
  → 错误文本注入上下文: "工具 'xxx' 执行失败: <原因>。请尝试其他方法。"
  → LLM 自行调整策略，继续 loop

第 3 级：暂停（等待用户介入）
  用户 Plan/Build 无响应、Client 工具回传超时
  → 引擎进入 SUSPENDED 状态，等待用户手动恢复或取消

第 4 级：终止（不可恢复，释放引擎）
  Rate Limit 耗尽、认证失败、内容安全拦截、Max turns、执行超时
  → 推送错误数据块: { type: "message.error", error: "...", fatal: true }
  → 消息标记 error，引擎回到 IDLE 或归档
```

#### 1.8.3 重试与退避实现

```python
import asyncio

RETRIABLE_ERRORS = (
    httpx.NetworkError,
    httpx.TimeoutException,
    httpx.HTTPStatusError,   # 仅 429, 502, 503
)

async def call_llm_with_retry(ctx, tools, system):
    last_exc = None
    for attempt in range(3):
        try:
            return await llm.stream(
                messages=ctx.messages,
                tools=tools,
                system=system,
            )
        except RETRIABLE_ERRORS as e:
            last_exc = e
            if isinstance(e, httpx.HTTPStatusError) and e.response.status_code not in (429, 502, 503):
                raise   # 401/403 等不重试
            delay = 2 ** attempt  # 1s → 2s → 4s
            await asyncio.sleep(delay)

    raise MaxRetriesExceeded(last_exc)
```

#### 1.8.4 重复操作检测

```python
# 在 per-message loop 中:
_recent_tool_calls: list[tuple[str, str]] = []  # [(tool_name, input_hash), ...]

async def _check_loop_detection(self, chunk) -> bool:
    """连续 3 次相同工具+相同输入 → 判定为死循环"""
    key = (chunk.tool_name, hashlib.md5(chunk.tool_input_json.encode()).hexdigest())
    self._recent_tool_calls.append(key)
    if len(self._recent_tool_calls) > 3:
        self._recent_tool_calls.pop(0)
    if len(self._recent_tool_calls) == 3 and len(set(self._recent_tool_calls)) == 1:
        await self._push_chunk({
            "type": "message.error",
            "error": "检测到连续三次相同工具调用，可能是死循环，已自动终止。"
        })
        return True
    return False
```

#### 1.8.5 流连接断开时的缓冲回放

```python
class StreamBuffer:
    """客户端断开时缓冲数据块，重连后回放"""
    def __init__(self, session_id: str, max_size: int = 500):
        self.buffer: list[dict] = []
        self.max_size = max_size

    def push(self, chunk: dict):
        if len(self.buffer) >= self.max_size:
            self.buffer.pop(0)
        self.buffer.append(chunk)

    def drain(self, since_seq: int | None = None) -> list[dict]:
        """客户端重连时回放 since_seq 之后的数据块"""
        if since_seq is None:
            return list(self.buffer)
        return [c for c in self.buffer if c.get("seq", 0) > since_seq]
```

#### 1.8.6 引擎恢复（服务器重启后）

```python
async def recover_session(session_id: UUID):
    """服务启动时恢复未完成的会话"""
    session = await db.fetchrow(
        "SELECT * FROM sessions WHERE status='active'"
    )
    if not session:
        return

    # 恢复当前正在处理的消息（如果有）
    if session["current_message_id"]:
        msg = await db.fetchrow(
            "SELECT * FROM messages WHERE id=$1 AND status='processing'",
            session["current_message_id"]
        )
        if msg:
            # 重置为 pending，重新处理
            await db.execute(
                "UPDATE messages SET status='pending', queue_position=0 WHERE id=$1",
                msg["id"]
            )
        await db.execute(
            "UPDATE sessions SET current_message_id=NULL WHERE id=$1",
            session["id"]
        )

    engine = QueryLoopEngine(session_id)
    asyncio.create_task(engine.run())
    return engine
```

### 1.9 前后端主对话接口完整定义

#### 1.9.1 接口总览

**通信协议：Streamable HTTP**

| 分类 | 方法 + 路径 | 方向 | 服务端作用 | 触发时机 | 前端作用 |
|------|------------|------|-----------|---------|---------|
| **会话** | `GET /sessions` | Cli ← Svr | 查询当前用户的所有会话列表，按更新时间倒序 | 侧边栏任务列表加载、切换任务 | 获取任务列表数据（id、标题、更新时间），渲染侧边栏任务项。 |
| **会话** | `POST /sessions` | Cli → Svr | 创建会话，注册客户端工具清单并存储初始配置。**客户端工具注册的唯一入口。** | 用户点击侧边栏"新建任务" | Electron 本地生成 session_id (UUID)，携带 `client_tools`（完整工具定义）、`workspace`、`model`、`mode`、`scene_mode` 创建会话。工具清单存储为会话元数据，后续该会话所有消息自动使用。 |
| **会话** | `GET /sessions/{id}` | Cli ← Svr | 获取会话详情（含已注册的 client_tools、当前配置、消息列表） | 恢复已有任务、断线重连后加载会话状态 | 加载会话完整信息，含工具清单、工作空间、模型、模式等，前端据此恢复 UI 状态。 |
| **会话** | `PATCH /sessions/{id}` | Cli → Svr | 更新会话配置（工作空间、模型、模式等） | 用户在首页右栏修改工作空间/模型/使用模式 | Body 携带变更字段，服务端更新会话级默认配置。后续新消息继承新配置，历史消息不受影响。 |
| **会话** | `DELETE /sessions/{id}` | Cli → Svr | 归档会话（软删除） | 用户右键任务 → 删除 | 会话标记为 archived，数据保留但不再出现在列表中。已归档会话拒绝新消息（返回 410）。 |
| **主对话** | `POST /sessions/{id}/messages` | Cli → Svr | 入队，返回 NDJSON 流式响应，流式推送该消息的所有处理数据块 | 用户每次发送消息 | 将输入文本、工作模式、工作空间等打包提交，接收 NDJSON 流并逐条渲染 AI 思考、文本回复、工具调用状态。**整个对话 UI 实时更新的核心通道。** |
| **重连** | `GET /sessions/{id}/stream?since_seq=N` | Cli ← Svr | 断线重连，从 since_seq 续传丢失数据块。**关键机制：前端断开后引擎继续执行**，数据块写入 StreamBuffer（上限 500 条），重连后从 buffer 回放 `seq > N` 的所有数据块，再继续实时推送。 | 主通道 NDJSON 流断开时自动触发（网络抖动、合盖唤醒、切 Wi-Fi），前端通过流 `onerror` 自动检测并重连，无需用户手动操作 | 记录最后收到的 `seq`，自动重连后从断点续传。**合盖期间 AI 不中断**，开盖后断线期间的数据块一次性追回，无缝衔接最新进度。连续重试失败后展示"连接已断开，点击重试"兜底按钮。 |
| **队列** | `GET /sessions/{id}/queue` | Cli ← Svr | 查询当前队列 | 展示消息排队状态 | 获取队列快照，渲染"前面还有 N 条消息等待处理"及每条排队消息预览。 |
| **队列** | `DELETE /sessions/{id}/queue/{msg_id}` | Cli → Svr | 移除排队中的消息 | 用户取消排队中的消息 | 移除 `pending` 状态的消息（处理中不可移除），收到 200 后从 UI 队列清除。 |
| **Plan** | `POST /sessions/{id}/plan/confirm` | Cli → Svr | 确认计划，开始自动执行 | 用户点击 **[确认计划]** | 通知服务端自动执行计划，前端继续接收工具调用等流式数据块。 |
| **Plan** | `POST /sessions/{id}/plan/edit` | Cli → Svr | 替换计划文本，重新推送 `plan.generated` | 用户点击 **[编辑]** → 修改计划 → 提交 | Body 带 `plan_text`，服务端替换后重新推送 `plan.generated` 给用户再次确认（可反复编辑）。 |
| **Plan** | `POST /sessions/{id}/plan/reject` | Cli → Svr | 终止计划，LLM 追加"计划已取消" | 用户点击 **[拒绝]** | 无 Body。前端恢复对话态等新需求。 |
| **Plan** | `POST /sessions/{id}/plan/answer` | Cli → Svr | 用户回答 plan.question 的追问 | 用户选择选项或输入文本 | Body 带 `answer` 字符串，注入 LLM 上下文后继续当前 turn。 |
| **Build** | `POST /sessions/{id}/build/confirm` | Cli → Svr | 执行当前步骤工具 | 用户点击 **[确认]** | 执行当前步骤工具，前端继续接收后续数据块。 |
| **Build** | `POST /sessions/{id}/build/skip` | Cli → Svr | 跳过当前步骤，LLM 收到"被跳过"反馈后继续 | 用户点击 **[跳过]** | 前端更新步骤状态为"已跳过"。 |
| **Build** | `POST /sessions/{id}/build/abort` | Cli → Svr | 终止整条消息处理，引擎回 IDLE | 用户点击 **[终止]**（方向不对/改主意） | 前端清空执行步骤，恢复输入态。 |
| **工具回传** | `POST /sessions/{id}/tool-result/{request_id}` | Cli → Svr | 结果注入 LLM 上下文继续推理 | 前端本地执行完 `client.tool_request` 后 | 回传成功（stdout + 文件变更）或失败（stderr + 退出码）。**串联 AI 思考与本地执行的闭环。** |

**与 SSE 方案的关键区别：**

| | SSE | Streamable HTTP |
|--|-----|-----------------|
| 主通道 | GET /stream 长连接（独立于请求） | POST /messages 响应本身就是流 |
| 客户端请求数 | 2 个连接（POST + GET） | 1 个连接（POST 即流） |
| 断线重连 | GET /stream?since_seq=N | GET /stream?since_seq=N（仅重连用） |
| 协议格式 | `event: xxx\ndata: {...}\n\n` | 每行一个 JSON: `{"type":"xxx",...}\n` |
| 消息边界 | 空行分隔 | 换行符分隔（NDJSON） |

---

#### 1.9.2 接口详细定义

以下按 1.9.1 接口总览中的分类逐一说明每个接口的请求/响应/流式数据块。

---

##### 会话列表 — `GET /sessions`

用户登录后首次加载侧边栏任务列表时调用，也可用于刷新列表。

**Query 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `status` | `string` | 否 | 过滤条件：`active`（默认，未归档）、`archived`（已归档）、`all` |
| `limit` | `number` | 否 | 每页条数，默认 50，最大 100 |
| `offset` | `number` | 否 | 分页偏移，默认 0 |

**Response (JSON):**

```typescript
// 200 OK
{
  sessions: {
    id: string;
    title: string;                      // 任务标题（默认"新建任务"，首条消息后自动截取前 20 字符）
    mode: "ask" | "plan" | "build";
    scene_mode: "office" | "code";
    model: string;
    workspace: string;
    message_count: number;
    created_at: string;
    updated_at: string;                 // 最后活跃时间
    status: "active" | "archived";
  }[];
  total: number;
}
```

---

##### 会话创建 — `POST /sessions`

用户点击侧边栏"新建任务"时触发。**客户端在此接口中上报本地工具清单**，服务端将其与会话绑定存储。此后该会话的所有消息自动使用这份工具定义，无需每条消息重复携带。

**触发流程：**

```
用户点击侧边栏"新建任务"
  → Electron 本地生成 session_id (UUID v4)
  → POST /sessions  携带 client_tools + 初始配置
  → 服务端创建会话记录，存储工具清单
  → 返回 201，前端获得 session_id
  → 后续 POST /sessions/{id}/messages 基于此会话
```

**Request Body (JSON):**

```typescript
{
  // ── 必填 ──
  id: string;                           // 客户端生成的 UUID v4，服务端做幂等校验

  // ── 初始配置（必填，与消息级配置一致）──
  scene_mode: "office" | "code";
  workspace: string;                    // 工作空间根目录绝对路径（沙箱边界）
  model: string;                        // e.g. "claude-opus-4-7"
  mode: "ask" | "plan" | "build";

  // ── 客户端本地工具清单（必填，注册后该会话所有消息共享）──
  client_tools: {
    name: string;                       // 工具名，e.g. "bash", "read_file", "write_file", "edit_file"
    description: string;                // 给 LLM 看的功能描述
    input_schema: {                     // JSON Schema，定义工具参数
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  }[];

  // ── 可选 ──
  mcp_servers?: {                       // 用户默认启用的 MCP 服务列表
    server_id: string;
    server_name: string;
    enabled_tools?: string[];
  }[];
}
```

> **client_tools 示例：**
>
> ```json
> {
>   "name": "bash",
>   "description": "Execute a shell command in the workspace directory. Returns stdout, stderr, and exit code.",
>   "input_schema": {
>     "type": "object",
>     "properties": {
>       "command": { "type": "string", "description": "The shell command to execute" },
>       "timeout_ms": { "type": "number", "description": "Timeout in milliseconds, default 120000" }
>     },
>     "required": ["command"]
>   }
> }
> ```

> **设计要点：**
>
> | 决策 | 理由 |
> |------|------|
> | client_tools 在会话创建时注册，非每条消息携带 | 工具定义对客户端版本固定，重复传输浪费带宽；绑定会话保证历史消息可复现 |
> | 由客户端生成 session_id | 离线可用（无需等服务端返回 ID），且客户端可在网络恢复后重试创建（幂等） |
> | 会话创建后工具清单不可变 | 保证会话内上下文一致性；客户端升级后新会话用新工具，旧会话不受影响 |
> | 不传 `client_tools` 或传空数组 | 表示该会话仅使用纯文本对话和服务端 MCP，无本地工具可用 |

**Response (JSON):**

```typescript
// 201 Created
{
  id: string;                           // 回显 session_id
  title: string;                        // "新建任务"
  mode: "ask" | "plan" | "build";
  scene_mode: "office" | "code";
  model: string;
  workspace: string;
  client_tools_count: number;           // 已注册的客户端工具数量
  mcp_servers_count: number;
  created_at: string;
}

// 409 Conflict — 幂等：已存在同 ID 会话
{ error: "duplicate"; message: "该 session_id 已存在"; existing_session: { id: string; title: string; created_at: string; }; }

// 400 — client_tools 为空或格式非法
{ error: "invalid_request"; message: "client_tools 不能为空且必须为合法 JSON Schema 数组"; }
```

---

##### 会话详情 — `GET /sessions/{id}`

用于恢复已有任务或断线重连后加载会话完整状态。

**Response (JSON):**

```typescript
// 200 OK
{
  id: string;
  title: string;
  mode: "ask" | "plan" | "build";
  scene_mode: "office" | "code";
  model: string;
  workspace: string;
  status: "active" | "archived";
  client_tools: {                     // 创建时注册的工具清单
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }[];
  mcp_servers: {
    server_id: string;
    server_name: string;
    enabled_tools: string[];
  }[];
  current_processing: {               // 当前正在处理的消息（如有）
    message_id: string;
    started_at: string;
  } | null;
  queue_size: number;                  // 排队中的消息数
  message_count: number;
  created_at: string;
  updated_at: string;
}

// 404
{ error: "not_found"; message: "会话不存在"; }
```

---

##### 会话更新 — `PATCH /sessions/{id}`

用户在首页右栏修改工作空间、模型或使用模式时触发。**仅更新会话级默认值**，历史消息的配置不变。

**Request Body (JSON):**

```typescript
{
  // 以下字段均为可选，传哪些更新哪些
  workspace?: string;
  model?: string;
  mode?: "ask" | "plan" | "build";
  scene_mode?: "office" | "code";
  mcp_servers?: {
    server_id: string;
    server_name: string;
    enabled_tools?: string[];
  }[];
}
```

**Response (JSON):**

```typescript
// 200 OK — 返回更新后的完整会话信息（字段同 GET /sessions/{id} 响应）
{ ... }

// 410 — 会话已归档
{ error: "session_archived"; message: "该会话已归档，无法更新配置"; }
```

> **与消息级配置的关系：** 会话级配置是默认值，`POST /sessions/{id}/messages` 发布时客户端仍携带当前生效的配置（独立存储于每条消息）。用户中途切换工作空间后：新消息使用新 workspace，历史消息保留旧 workspace（可复现）。

---

##### 会话删除 — `DELETE /sessions/{id}`

软删除（归档），会话数据保留，但不展示在列表中，且拒绝新消息。

**Response (JSON):**

```typescript
// 200 OK
{ status: "archived"; id: string; archived_at: string; }

// 404
{ error: "not_found"; message: "会话不存在"; }
```

---

##### 主对话 — `POST /sessions/{id}/messages`

**Request Body (JSON):**

```typescript
{
  // ── 必填 ──
  content: string;                    // 用户输入文本

  // ── 运行配置（每条消息独立携带，覆盖会话级默认值） ──
  scene_mode: "office" | "code";     // 工作场景: office=日常办公, code=代码开发
  workspace: string;                  // 工作空间根目录绝对路径（沙箱边界）
  model: string;                      // 模型标识符, e.g. "claude-opus-4-7", "deepseek-v3"
  mode: "ask" | "plan" | "build";    // 使用模式: ask=问答, plan=规划, build=构建

  // ── 可选 ──
  files?: string[];                   // @ 引用的文件绝对路径列表
  skill_invocations?: {               // / 调用的 Skill 列表
    skill_id: string;
    skill_name: string;
  }[];
  mcp_servers?: {                     // 本消息启用的 MCP 服务列表
    server_id: string;
    server_name: string;
    enabled_tools?: string[];
  }[];
}
```

> **设计说明：** `scene_mode`, `workspace`, `model`, `mode` 四条为消息级必填，服务端按每条消息独立存储，确保历史消息上下文可复现。`mcp_servers` 可选，不传则使用用户默认启用的列表。消息入队时锁定配置，后续变更不影响已入队消息。

**Response（成功 — NDJSON 流）:**

```
HTTP/1.1 200 OK
Content-Type: application/x-ndjson
Transfer-Encoding: chunked
```

响应头立即返回（毫秒级），Body 为 NDJSON 流，逐条推送处理数据块，流持续到该消息处理完成。

```typescript
// 引擎空闲 → 立即处理，首个数据块为 message.start
{"type":"message.start","seq":0,"message_id":"m1","mode":"build","scene_mode":"code","workspace":"/path/to/project"}
```

**Response（错误 — 非流式，立即返回）:**

```typescript
// 429 — 队列已满（最多 10 条）
{ error: "queue_full"; message: "队列已满，最多 10 条"; current_queue_size: number; }

// 410 — 会话已归档
{ error: "session_archived"; message: "该会话已归档，无法发送新消息"; }

// 400 — 参数不合法
{ error: "invalid_request"; message: "缺少必填参数 scene_mode"; }
```

**流中可能出现的数据块类型：**

| 数据块 | 出现时机 |
|------|---------|
| `message.start` | 消息开始处理 |
| `agent.thinking` | AI 思考过程（增量，可折叠展示） |
| `agent.text` | AI 回复正文（增量） |

| `agent.tool_result` | 工具执行结果 |
| `client.tool_request` | 要求 Client 本地执行工具 |
| `client.tool_timeout` | Client 工具执行超时 |
| `plan.generated` | Plan 模式：计划生成完毕 |
| `plan.question` | Plan 模式：LLM 向用户提问 |
| `build.step_pending` | Build 模式：步骤待确认 |
| `plan.question_timeout` | Plan 模式：用户超时未回答 |
| `message.complete` | 消息处理完成（含 turn/token 摘要） |
| `message.error` | 消息处理异常 |

**响应时序：**

```
引擎空闲，立即处理：
Client                              Server
  │─ POST /messages ──────────────→│
  │◄── HTTP 200 ──────────────────│  Content-Type: application/x-ndjson
  │◄── {"type":"message.start",…}
  │◄── {"type":"agent.thinking","delta":"…"}
  │◄── {"type":"agent.text","delta":"…"}
  │◄── ...
  │◄── {"type":"message.complete",…}
  │                                    │  ← 流关闭

引擎正忙，排队等待：
Client                              Server
  │─ POST /messages ──────────────→│
  │◄── HTTP 200 ──────────────────│
  │       … 等待前序消息完成 …            ← 流保持连接
  │◄── {"type":"message.start",…}
  │◄── {"type":"agent.text",…}
  │◄── ...
  │◄── {"type":"message.complete",…}
  │                                    │  ← 流关闭
```

> **注意：** 引擎串行处理消息，每条 POST /messages 返回的流仅包含该消息自身的数据块。客户端可同时持有多个流连接（每个对应一条已发送消息）。流最长生命周期 = 排队等待 + 处理（单条上限 300s）。

---

##### 重连 — `GET /sessions/{id}/stream`

纯续传通道，不触发入队。主通道流断开后自动调用，从断点续传。

**Query 参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `since_seq` | `number` | 是* | 该序号之前的数据块均已收到，从 seq+1 开始续推 |
| `since_message_id` | `string` | 否 | 多条流并存时，指定续哪条消息的流 |

> *重连时必填。不传从当前处理中的消息开头推送；无处理中消息则返回空流立即关闭。

**Response:** 与主通道完全一致，`Content-Type: application/x-ndjson`。

**重连时序：**

```
Client                                    Server
  │─ POST /messages (msg m1) ──────────────→│  主通道
  │◄══ NDJSON stream ═══════════════════════│
  │   {"type":"agent.text","seq":14,...}     │
  │   ... connection drops ...              │  ← 网络中断
  │                                          │
  │─ GET /stream?since_seq=15&since_message_id=m1 ──→│  续传
  │◄══ seq 16+ 回放 ═══════════════════════│  ← 从 StreamBuffer 回放
  │   ... 追上实时后继续增量推送 ...         │
  │◄── {"type":"message.complete",…}        │
  │                                          │  ← 流关闭
```

> StreamBuffer 机制见 [1.8.5 流连接断开时的缓冲回放](#185-流连接断开时的缓冲回放)。

---

##### 队列查询 — `GET /sessions/{id}/queue`

**Response (JSON):**

```typescript
// 200 OK
{
  session_id: string;
  queue: {
    message_id: string;
    content_preview: string;          // 前 100 个字符
    queue_position: number;
    status: "pending";
    created_at: string;
  }[];
  current_processing: {
    message_id: string;
    content_preview: string;
    started_at: string;
  } | null;
}
```

---

##### 队列移除 — `DELETE /sessions/{id}/queue/{msg_id}`

**Response (JSON):**

```typescript
// 200 OK
{ success: true; removed_message_id: string; }

// 404 — 不存在或已不在队列
{ error: "not_found"; message: "消息不存在或已开始处理，无法移除"; }

// 409 — 已在处理中
{ error: "already_processing"; message: "该消息正在处理中，无法移除"; }
```

---

##### Plan 确认 — `POST /sessions/{id}/plan/confirm`

**Request Body:** 无（服务端从当前等待状态获取上下文）

**Response (JSON):**

```typescript
// 200 OK — 开始自动执行计划，后续步骤通过流推送
{ status: "confirmed"; message_id: string; }
```

---

##### Plan 编辑 — `POST /sessions/{id}/plan/edit`

**Request Body (JSON):**

```typescript
{ plan_text: string; }               // 用户修改后的计划文本，必填
```

**Response (JSON):**

```typescript
// 200 OK — 替换计划后重新推送 plan.generated
{ status: "edited"; message_id: string; }

// 400 — plan_text 为空
{ error: "invalid_request"; message: "plan_text 不能为空"; }
```

---

##### Plan 拒绝 — `POST /sessions/{id}/plan/reject`

**Request Body:** 无

**Response (JSON):**

```typescript
// 200 OK — LLM 追加"计划已取消"，消息终止
{ status: "rejected"; message_id: string; }
```

---

##### Plan 回答 — `POST /sessions/{id}/plan/answer`

回答 `plan.question` 的追问。注入 LLM 上下文后继续当前 turn。

**Request Body (JSON):**

```typescript
{ answer: string; }                  // select: 选项文本; text: 自由文本; confirm: "true"/"false"
```

**Response (JSON):**

```typescript
// 200 OK — 回答已注入，引擎继续 turn 1
{ status: "answered"; message_id: string; }
```

---

##### Build 确认 — `POST /sessions/{id}/build/confirm`

**Request Body:** 无（确认当前 `build.step_pending` 推送的步骤）

**Response (JSON):**

```typescript
// 200 OK — 执行该工具，结果通过流推送
{ status: "confirmed"; step: number; tool_name: string; }
```

---

##### Build 跳过 — `POST /sessions/{id}/build/skip`

**Request Body:** 无

**Response (JSON):**

```typescript
// 200 OK — LLM 收到"被跳过"反馈后继续下一步决策
{ status: "skipped"; step: number; tool_name: string; }
```

---

##### Build 终止 — `POST /sessions/{id}/build/abort`

**Request Body:** 无

**Response (JSON):**

```typescript
// 200 OK — 终止当前消息处理，引擎回 IDLE
{ status: "aborted"; message_id: string; }
```

---

##### 工具结果回传 — `POST /sessions/{id}/tool-result/{request_id}`

服务端推送 `client.tool_request` 后，Client 本地执行完毕，回传结果。

**Request Body (JSON):**

```typescript
// 成功
{
  status: "success";
  output: string;                     // stdout 内容
  files?: {                           // 产生的文件（可选）
    path: string;
    content: string;
    action: "created" | "modified" | "deleted";
  }[];
  duration_ms: number;
}

// 失败
{
  status: "error";
  error: string;                      // 错误信息（含 stderr）
  exit_code?: number;
  duration_ms: number;
}
```

**Response (JSON):**

```typescript
// 200 OK — 结果已注入上下文，LLM 继续下一 turn
{ received: true; request_id: string; }

// 404
{ error: "not_found"; message: "request_id 不存在或已超时过期"; }

// 409 — 幂等保护
{ error: "duplicate"; message: "该 request_id 已收到过结果"; received_at: string; }
```

---

##### 流式数据块类型总览

所有数据块按**输出类型**分为四大类。NDJSON 每行一个完整 JSON，`\n` 分隔：

```
{"type":"agent.text","seq":42,"delta":"你好","turn":1,"message_id":"m1"}
{"type":"message.complete","seq":44,"message_id":"m1","summary":{…}}
```

| 分类 | 数据块 | 增量/完整 | 说明 |
|------|------|----------|------|
| **文本** | `agent.thinking` | 增量 (`delta`) | AI 思考过程，可折叠展示 |
| **文本** | `agent.text` | 增量 (`delta`) | AI 回复正文，打字机效果 |

| **工具** | `agent.tool_result` | 完整 | 工具执行完毕后回注的结果 |
| **工具** | `client.tool_request` | 完整 | 要求 Client 端执行本地工具 |
| **工具** | `client.tool_timeout` | 完整 | Client 工具执行超时 |
| **Plan** | `plan.generated` | 完整 | 计划文本生成完毕，等待确认 |
| **Plan** | `plan.question` | 完整 | 计划阶段 LLM 向用户发起追问（选择题/填空/确认） |
| **Plan** | `plan.question_timeout` | 完整 | 用户超时未回答 plan.question |



| **Build** | `build.step_pending` | 完整 | 步骤待用户确认 |



| **系统** | `message.start` | 完整 | 消息开始处理 |
| **系统** | `message.complete` | 完整 | 处理完成，含 turn/token 摘要 |
| **系统** | `message.error` | 完整 | 处理异常 |

> **流终止：** `message.complete` 或 `message.error`(fatal=true) 后，服务端关闭该流。

##### 完整数据块类型定义

```typescript
type StreamChunk =
  // ═══════════════════════════════════════════
  // 1. 思考与文本（所有模式实时推送）
  // ═══════════════════════════════════════════
  | {
      type: "agent.thinking";
      seq: number;
      delta: string;                    // 思考片段（增量）
      turn: number;
      message_id: string;
    }
  | {
      type: "agent.text";
      seq: number;
      delta: string;                    // 文本片段（增量）
      turn: number;
      message_id: string;
    }

  // ═══════════════════════════════════════════
  // 2. 工具调用
  // ═══════════════════════════════════════════
  | {
      type: "agent.tool_result";
      seq: number;
      tool_call_id: string;
      tool_name: string;
      result: { success: boolean; output?: string; error?: string; duration_ms: number; };
      turn: number;
      message_id: string;
    }
  | {
      type: "client.tool_request";
      seq: number;
      request_id: string;
      tool_name: string;
      input: Record<string, unknown>;
      message_id: string;
    }
  | {
      type: "client.tool_timeout";
      seq: number;
      request_id: string;
      message: string;
    }

  // ═══════════════════════════════════════════
  // 3. Plan 模式专用
  // ═══════════════════════════════════════════
  | {
      type: "plan.generated";
      seq: number;
      message_id: string;
      plan_text: string;
    }
  | {
      type: "plan.question";
      seq: number;
      message_id: string;
      question: string;
      options?: string[];
      input_type: "select" | "text" | "confirm";
      context?: string;
    }
  | { type: "plan.question_timeout"; seq: number; message_id: string; }

  // ═══════════════════════════════════════════
  // 4. Build 模式专用
  // ═══════════════════════════════════════════
  | {
      type: "build.step_pending";
      seq: number;
      message_id: string;
      tool_name: string;
      tool_call_id: string;
      input: Record<string, unknown>;
      step: number;
      reasoning?: string;
    }
  // ═══════════════════════════════════════════
  // 5. 队列 & 生命周期 & 系统
  // ═══════════════════════════════════════════
  | {
      type: "message.start";
      seq: number;
      message_id: string;
      mode: "ask" | "plan" | "build";
      scene_mode: "office" | "code";
      workspace: string;
    }
  | {
      type: "message.complete";
      seq: number;
      message_id: string;
      summary: { turns: number; tokens_in: number; tokens_out: number; duration_ms: number; tool_calls_count: number; };
    }
  | {
      type: "message.error";
      seq: number;
      message_id: string;
      error: string;
      code: string;
      fatal: boolean;
      turn?: number;
    }
```

##### 工具分类：客户端工具 vs 服务端 MCP

所有可调用工具按执行位置分为两类：

| | 客户端工具 (Client Tools) | 服务端 MCP (Server MCP Tools) |
|--|--------------------------|------------------------------|
| **执行位置** | Electron 本地 | FastAPI 服务端 |
| **数据块流** | `client.tool_request` → Client 执行 → `POST /tool-result` → `agent.tool_result` | 服务端 dispatch → 直接 `agent.tool_result` |
| **是否需要 Client 在线** | 是（断开则超时） | 否（服务端自行完成） |
| **超时** | 120s | 由 MCP 协议控制 |
| **典型工具** | `bash`, `read_file`, `write_file`, `edit_file` | `mcp_github_*`, `mcp_slack_*`, `mcp_postgres_*` |
| **注册方式** | `POST /sessions` 时由 Client 上报完整工具定义（name + description + input_schema），服务端存为会话元数据，会话生命周期内不变 | 用户安装的 MCP 服务列表，`POST /sessions` 时配置，`POST /sessions/{id}/messages` 可逐消息覆盖启用列表 |
| **白名单标记** | `exec_location: "client"` | `exec_location: "server"` |

**完整链路对比：**

```
客户端工具:
  LLM 决定调用 bash
      → client.tool_request (前端收到，调用 shell 执行)
      → [Electron 本地执行中...]
      → POST /tool-result/{request_id} (回传 stdout/stderr)
      → agent.tool_result (结果注入 LLM 上下文，继续推理)
      → 超时 120s 则推送 client.tool_timeout

服务端 MCP:
  LLM 决定调用 mcp_github_search
      → [Server dispatch → MCP 服务]
      → agent.tool_result (结果直接推送，注入上下文)
```

> **核心区别：** `client.tool_request` 是服务端把执行权**委派**给前端的桥接数据块——前端必须响应，否则引擎卡在 WAITING_SYNC 直到超时。而服务端 MCP 对前端完全透明，前端只需渲染 tool_call → tool_result 的状态变化。

##### Plan 模式数据块详解

Plan 模式共 2 个数据块，围绕"生成计划 → 用户决策 → 自动执行"这一条线。

**`plan.generated`** — LLM 生成了执行计划

Plan 模式下 turn 1 完成后推送，流在此**暂停**，引擎切到 WAITING_SYNC。

```typescript
{
  type: "plan.generated";
  seq: number;
  message_id: string;
  plan_text: string;               // 完整计划（Markdown，含步骤列表），直接渲染
}
```

**前端：** 展示计划文本 + **[确认]** **[编辑]** **[拒绝]** 三个按钮。

---

##### Build 模式数据块详解

Build 模式共 1 个数据块，围绕"步步生成 → 步步确认 → 继续/终止"这一条线。与 Plan 的本质区别：**每一步工具调用都暂停等用户决策**。

**`build.step_pending`** — 步骤待确认

LLM 每个 tool_use 都会触发此数据块。流在此**暂停**，引擎切到 WAITING_SYNC。

```typescript
{
  type: "build.step_pending";
  seq: number;
  message_id: string;
  tool_name: string;               // 本次要调用的工具
  tool_call_id: string;            // 关联后续 tool_call / tool_result
  input: Record<string, unknown>;  // LLM 生成的工具参数
  step: number;                    // 当前步骤序号（从 1 开始递增）
  reasoning?: string;              // LLM 解释为什么做这步（如有）
}
```

**前端：** 展示步骤卡片，包含工具名、参数预览、reasoning（如有），附带 **[确认]** **[跳过]** **[终止]** 三个按钮。

> 详细流程见 [1.6 Build 模式子流程](#16-build-模式子流程)。

---

##### 客户端处理汇总

客户端收到每种 `StreamChunk` 后，需要做的处理和需要调用的接口汇总如下。

**一、文本类（增量渲染，无需调接口）**

| 数据块 | 客户端处理 | 调用的接口 |
|--------|-----------|-----------|
| `agent.thinking` | 将 `delta` 追加到思考缓冲区，渲染在可折叠面板中 | 无 |
| `agent.text` | 将 `delta` 追加到回复缓冲区，打字机效果逐字渲染 | 无 |

**二、工具类**

| 数据块 | 客户端处理 | 调用的接口 |
|--------|-----------|-----------|
| `agent.tool_result` | 渲染工具执行结果（成功/失败、output、耗时），更新对应 tool_call 的状态为"已完成" | 无（服务端推送结果，前端只读展示） |
| **`client.tool_request`** | 在 Electron 本地执行工具（如 `bash`、`read_file`、`write_file`、`edit_file`），执行完毕后回传结果 | **`POST /sessions/{id}/tool-result/{request_id}`**<br>成功: `{ status:"success", output, files?, duration_ms }`<br>失败: `{ status:"error", error, exit_code, duration_ms }` |
| `client.tool_timeout` | 渲染超时提示，标记该工具请求为"已超时" | 无（服务端已判定超时，无需回传） |

**三、Plan 模式专用（需用户交互）**

| 数据块 | 客户端处理 | 调用的接口 |
|--------|-----------|-----------|
| **`plan.generated`** | 渲染完整计划文本（Markdown），展示三个按钮：**[确认]** **[编辑]** **[拒绝]** | 确认 → **`POST /sessions/{id}/plan/confirm`**（无 Body）<br>编辑 → **`POST /sessions/{id}/plan/edit`** Body: `{ plan_text }`（服务端替换后重新推送 `plan.generated`，可反复编辑）<br>拒绝 → **`POST /sessions/{id}/plan/reject`**（无 Body，LLM 追加"计划已取消"后终止） |
| **`plan.question`** | 根据 `input_type` 渲染不同 UI：<br>• `select` → 选项卡片列表（单选）<br>• `text` → 文本输入框<br>• `confirm` → 确定/取消按钮 | **`POST /sessions/{id}/plan/answer`** Body: `{ answer }`（select 传选项文本、text 传输入字符串、confirm 传 `"true"`/`"false"`） |
| `plan.question_timeout` | 渲染"用户超时未回答"提示 | 无（服务端已注入 `[用户未回应此问题，请跳过并继续]`，LLM 自行继续） |

**四、Build 模式专用（每步确认）**

| 数据块 | 客户端处理 | 调用的接口 |
|--------|-----------|-----------|
| **`build.step_pending`** | 渲染步骤卡片：工具名、参数预览、`reasoning`（如有）、步骤序号。展示三个按钮：**[确认]** **[跳过]** **[终止]** | 确认 → **`POST /sessions/{id}/build/confirm`**（执行该工具）<br>跳过 → **`POST /sessions/{id}/build/skip`**（LLM 收到"被跳过"反馈后继续）<br>终止 → **`POST /sessions/{id}/build/abort`**（终止整条消息，引擎回 IDLE） |

**五、生命周期 / 系统**

| 数据块 | 客户端处理 | 调用的接口 |
|--------|-----------|-----------|
| `message.start` | 初始化消息 UI 容器，记录 `mode`、`scene_mode`、`workspace`，准备接收后续流数据块。将当前 `seq` 置为基准 | 无 |
| `message.complete` | 渲染摘要信息（turns、tokens、耗时、工具调用次数），标记消息为"已完成"。**此数据块后服务端关闭流** | 无 |
| `message.error` | 渲染错误信息。`fatal: true` → 标记消息终止，展示错误码和描述；`fatal: false` → 展示警告但仍等待后续数据块 | 无（但 `fatal` 错误后可能需要用户手动重发消息） |

**六、断线重连**

当 NDJSON 流因网络中断而断开时，客户端需维护当前消息 ID 和最后收到的 `seq`，在流的 `onerror` / `onclose`（非正常关闭）时自动发起重连：

```
Client 记录最后收到的 seq
  → onerror 自动触发重连
  → GET /sessions/{id}/stream?since_seq={last_seq}&since_message_id={current_msg_id}
  → 服务端从 StreamBuffer 回放 seq > last_seq 的所有数据块
  → 追上实时后继续增量推送
```

多次重试失败后展示"连接已断开，点击重试"兜底按钮。StreamBuffer 机制见 [1.8.5 流连接断开时的缓冲回放](#185-流连接断开时的缓冲回放)。

**七、客户端需要主动调用的接口汇总（按触发源）**

| 触发源 | 调用的接口 |
|--------|-----------|
| `client.tool_request` | `POST /sessions/{id}/tool-result/{request_id}` |
| 用户点 **[确认计划]** | `POST /sessions/{id}/plan/confirm` |
| 用户点 **[编辑]** → 修改 → 提交 | `POST /sessions/{id}/plan/edit` |
| 用户点 **[拒绝]** | `POST /sessions/{id}/plan/reject` |
| 用户回答 `plan.question` | `POST /sessions/{id}/plan/answer` |
| 用户点 **[确认]**（Build） | `POST /sessions/{id}/build/confirm` |
| 用户点 **[跳过]**（Build） | `POST /sessions/{id}/build/skip` |
| 用户点 **[终止]**（Build） | `POST /sessions/{id}/build/abort` |
| 流断开（自动） | `GET /sessions/{id}/stream?since_seq=N` |

其余 `agent.thinking`、`agent.text`、`agent.tool_result`、`message.*` 等均为纯渲染，不需要客户端回调任何接口。

---

#### 1.9.3 错误码参考

| code | HTTP 状态码 | 说明 |
|------|-----------|------|
| `queue_full` | 429 | 队列已满（最多 10 条） |
| `session_archived` | 410 | 会话已归档 |
| `not_found` | 404 | 消息/request_id 不存在 |
| `already_processing` | 409 | 消息已在处理中，不可移除 |
| `duplicate` | 409 | 重复回传工具结果 |
| `invalid_request` | 400 | 请求参数不合法 |
| `max_turns_exceeded` | — | 流数据块，轮次耗尽 |
| `execution_timeout` | — | 流数据块，单条消息总耗时超 300s |
| `loop_detected` | — | 流数据块，检测到重复操作死循环 |
| `content_filter` | — | 流数据块，内容被安全策略拦截 |
| `auth_failed` | — | 流数据块，LLM API 认证失败 |
| `rate_limited` | — | 流数据块，LLM API 速率限制 |

---

#### 1.9.4 典型交互时序

##### Ask 模式（"什么是闭包？"）

```
Client                              Server
  │                                    │
  │─ POST /messages {"content":"...", mode:"ask", ...} ──→│
  │◄══ Content-Type: application/x-ndjson ════════════════│
  │◄── {"type":"message.start","seq":0,"message_id":"m1","mode":"ask"}
  │◄── {"type":"agent.text","seq":1,"delta":"闭包是…"}
  │◄── {"type":"agent.text","seq":2,"delta":"…函数的…"}
  │◄── {"type":"message.complete","seq":3, ...}
  │                                    │  ← 流关闭
```

##### Plan 模式（"帮我搭建一个 React 项目"）

```
Client                              Server
  │                                    │
  │─ POST /messages {"mode":"plan",...} ─────────→│
  │◄══ NDJSON stream ════════════════════════════│
  │◄── {"type":"message.start","mode":"plan"}
  │◄── {"type":"plan.generated","plan_text":"..."}
  │   ═══ 流暂停，等待用户决策 ═══       │
  │                                    │
  │─ POST /plan/confirm                │ ← 用户点击"确认计划"
  │◄─ 200 {status:"confirmed"}         │
  │                                    │
  │◄── {"type":"message.start"}       │  ← 流继续
  │◄── {"type":"agent.tool_result","result":{...}}
  │◄── {"type":"agent.tool_result","result":{...}}
  │◄── {"type":"agent.text","delta":"项目已创建完成"}
  │◄── {"type":"message.complete",...}
  │                                    │  ← 流关闭
```

##### Build 模式（"把 src/utils.ts 重构并跑通测试"）

```
Client                              Server
  │                                    │
  │─ POST /messages {"mode":"build",...} ─────────→│
  │◄══ NDJSON stream ═════════════════════════════│
  │◄── {"type":"message.start","mode":"build"}
  │◄── {"type":"build.step_pending","tool_name":"read_file","step":1}
  │   ═══ 流暂停，等待用户决策 ═══       │
  │                                    │
  │─ POST /build/confirm               │ ← 用户点击"确认"
  │◄─ 200 {status:"confirmed"}         │
  │◄── {"type":"agent.tool_result",...}
  │◄── {"type":"build.step_pending","tool_name":"edit_file","step":2}
  │   ═══ 流暂停，等待用户决策 ═══       │
  │                                    │
  │─ POST /build/skip                  │ ← 用户点击"跳过"
  │◄─ 200 {status:"skipped"}           │
  │◄── {"type":"build.step_pending","tool_name":"bash","step":3}  │ ← 流继续
  │   ═══ 流暂停，等待用户决策 ═══       │
  │                                    │
  │─ POST /build/confirm               │
  │◄── {"type":"agent.tool_result",...}
  │◄── {"type":"message.complete",...}
  │                                    │  ← 流关闭
```

##### Client 端工具执行

```
Client                              Server
  │                                    │
  │◄══ NDJSON stream ═════════════════│
  │◄── {"type":"client.tool_request",
  │      "request_id":"r1",
  │      "tool_name":"bash",
  │      "input":{"command":"npm test"}}
  │                                    │
  │  … Client 本地执行 npm test …      │
  │                                    │
  │─ POST /tool-result/r1              │
  │   {status:"success",               │
  │    output:"Tests: 5 passed",       │
  │    duration_ms: 3200}              │
  │◄─ 200 {received:true}              │
  │                                    │
  │◄── {"type":"agent.tool_result","result":{...}}  │ ← 流继续
  │◄── {"type":"agent.text","delta":"测试全部通过"}
```

---

> **下一节**：上下文管理系统（待用户确认本节省后继续展开）
