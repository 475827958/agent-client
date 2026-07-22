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
- [2. MCP 工具集成](#2-mcp-工具集成)
  - [2.1 架构概览](#21-架构概览)
  - [2.2 MCP 协议基础](#22-mcp-协议基础)
  - [2.3 MCP 服务生命周期](#23-mcp-服务生命周期)
  - [2.4 MCP 服务配置](#24-mcp-服务配置)
    - [2.4.1 配置文件格式](#241-配置文件格式)
    - [2.4.2 配置层级：会话级 vs 消息级](#242-配置层级会话级-vs-消息级)
    - [2.4.3 凭据管理](#243-凭据管理)
  - [2.5 工具发现与注册](#25-工具发现与注册)
    - [2.5.1 工具列表拉取](#251-工具列表拉取)
    - [2.5.2 工具命名规则](#252-工具命名规则)
    - [2.5.3 合并到 LLM 上下文](#253-合并到-llm-上下文)
  - [2.6 MCP 工具执行流程](#26-mcp-工具执行流程)
  - [2.7 错误处理](#27-错误处理)
    - [2.7.1 MCP 错误分类](#271-mcp-错误分类)
    - [2.7.2 与现有四级处理策略的映射](#272-与现有四级处理策略的映射)
    - [2.7.3 MCP 相关的 system.status 通知](#273-mcp-相关的-systemstatus-通知)
  - [2.8 MCP 服务管理（Hub）](#28-mcp-服务管理hub)
    - [2.8.1 Hub 数据来源](#281-hub-数据来源)
    - [2.8.2 安装 / 卸载流程](#282-安装--卸载流程)
    - [2.8.3 MCP 管理 API 总览](#283-mcp-管理-api-总览)
    - [2.8.4 与主对话流程的联通](#284-与主对话流程的联通)
  - [2.9 MCP 查询接口定义](#29-mcp-查询接口定义)
  - [2.10 与 Query Loop 引擎的集成点总结](#210-与-query-loop-引擎的集成点总结)
- [3. Skill 集成](#3-skill-集成)
  - [3.1 架构概览](#31-架构概览)
  - [3.2 Skill 格式与结构](#32-skill-格式与结构)
  - [3.3 Skill 生命周期](#33-skill-生命周期)
  - [3.4 Skill 配置](#34-skill-配置)
    - [3.4.1 配置文件格式](#341-配置文件格式)
    - [3.4.2 配置层级：会话级 vs 消息级](#342-配置层级会话级-vs-消息级)
  - [3.5 Skill 发现与注册](#35-skill-发现与注册)
    - [3.5.1 启动加载流程](#351-启动加载流程)
    - [3.5.2 Skill ID 命名规则](#352-skill-id-命名规则)
    - [3.5.3 合并到 LLM 上下文](#353-合并到-llm-上下文)
  - [3.6 Skill Prompt 注入](#36-skill-prompt-注入)
  - [3.7 错误处理](#37-错误处理)
  - [3.8 Skill 管理（Hub）](#38-skill-管理hub)
    - [3.8.1 Hub 数据来源](#381-hub-数据来源)
    - [3.8.2 安装 / 卸载流程](#382-安装--卸载流程)
    - [3.8.3 启用 / 禁用](#383-启用--禁用)
    - [3.8.4 自定义 Skill](#384-自定义-skill)
    - [3.8.5 与主对话流程的联通](#385-与主对话流程的联通)
  - [3.9 Skill 查询接口定义](#39-skill-查询接口定义)
  - [3.10 与 Query Loop 引擎的集成点总结](#310-与-query-loop-引擎的集成点总结)

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
│   │        turn 0..max_turns(25), timeout(300s)          │  │
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
| **PROCESSING** | 队首消息出队，执行 per-message loop（内部 turn 0..25） |
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
    plan_text_buffer = ""  # Plan 模式 turn 0 累积 LLM 输出的计划文本
    build_step = 0

    while turn < MAX_TURNS and not terminal:
        # 1. 构建上下文（含 mode 对应的 system prompt）
        ctx = await context_manager.build(session_id, turn, mode)

        # 2. LLM 流式调用
        # 构建 thinking 参数（Claude API extended thinking）
        thinking_budget = message.thinking_budget or 0
        thinking = {"type": "enabled", "budget_tokens": thinking_budget} \
            if thinking_budget >= 1024 else None

        response = await llm.stream(
            messages=ctx.messages,
            tools=ctx.available_tools if mode != "ask" else None,
            tool_choice="none" if mode == "ask" else "auto",
            system=ctx.system_prompt,
            thinking=thinking,
        )

        # 3. 逐数据块解析
        async for chunk in response:
            # ── 文本 + 思考：三种模式都直接流式推客户端 ──
            if chunk.type in ("thinking", "text"):
                await self._push_chunk({"type": f"agent.{chunk.type}", "delta": chunk.delta})
                if mode == "plan" and not plan_confirmed and chunk.type == "text":
                    plan_text_buffer += chunk.delta  # Plan 模式累积计划文本

            # ── Plan 模式专项：LLM 向用户提问 ──
            elif chunk.type == "tool_use" and chunk.tool_name == "plan_question":
                # plan_question 是一种特殊 tool，LLM 用它向用户发起选择题或追问
                # 前端渲染为选项卡片或输入框，用户回答后注入上下文
                await self._push_chunk({
                    "type": "plan.question",
                    "message_id": message.id,
                    "question": chunk.tool_input.get("question"),
                    "options": chunk.tool_input.get("options"),
                    "input_type": chunk.tool_input.get("input_type", "select"),  # select | text
                })
                answer = await self.sync_waiter.wait(self.session.id, timeout=300)
                if answer is None:
                    await context_manager.append_text(
                        session_id, "[用户未回应此问题，请跳过并继续]"
                    )
                else:
                    await context_manager.append_user_response(session_id, chunk, answer)
                plan_reask = True
                break  # 退出当前 LLM 流，下次循环用新上下文（含答案）重新调用

            # ── 工具调用：三种模式行为不同 ──
            elif chunk.type == "tool_use":

                # === Ask 模式：不应出现，忽略 ===
                if mode == "ask":
                    log.warning(f"Ask mode got tool_use, skipping")

                # === Plan 模式 ===
                elif mode == "plan":
                    if not plan_confirmed:
                        # turn 0: 把第一个 tool_use 当"计划生成"处理
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

            # ── plan_question 拿到答案后，用新上下文重启 turn ──
            if plan_reask:
                continue

            # ── 推送实时 token 统计 ──
            await self._push_chunk({
                "type": "token.usage",
                "message_id": message.id,
                "tokens_in": message.tokens_in,
                "tokens_out": message.tokens_out,
            })

            # 4. Plan 模式 turn 0 完成：推送 plan.generated，等待用户确认
        if mode == "plan" and not plan_confirmed:
            await self._push_chunk({
                "type": "plan.generated",
                "plan_text": plan_text_buffer  # turn 0 中通过 text 数据块累积的计划文本
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

        # 超时 / 轮次耗尽 → 强制终止
        elapsed_s = (time.monotonic() - msg_start_time)
        if elapsed_s > MESSAGE_TIMEOUT_S:
            terminal = True

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
| **tools 参数** | `None`, `tool_choice="none"` | turn 0 仅 plan_question; 确认后传 `auto` | `auto` |
| **LLM 行为** | 纯文本回复 | turn 0 生成计划; turn 1..n 自动执行 | 每轮正常调用工具 |
| **暂停点** | 无 | 1 次（计划→确认）+ N 次（plan.question） | 每个 tool_use 1 次 |
| **Client 交互** | 仅接收流式文本 | 流推计划 → 等 POST confirm/edit/reject; 流推问题 → 等 POST plan/answer | 流推每步 → 等 POST confirm/skip/abort |
| **终止条件** | stop_reason=end_turn 或 1 轮结束 | 计划拒绝 / 步骤全部完成 | 用户 abort / 自然完成 |
| **典型场景** | "什么是闭包？" | "帮我搭建一个 React 项目" | "把 src/utils.ts 里的 foo 重构并跑通测试" |
| **thinking** | 三种模式均支持 `thinking_budget`（与 mode 正交），启用后 LLM 每轮调用传入 `thinking={"type":"enabled","budget_tokens":N}`，思考内容通过 `agent.thinking` 推送客户端 |
### 1.5 Plan 模式子流程

Plan 模式的核心思想：**先审方案，再自动执行**。整个消息处理过程暂停一次——在 LLM 生成执行计划后、开始具体行动前。但在计划生成过程中，LLM 可以通过 `plan.question` 随时向用户发起交互式追问（选择题/填空题），确保需求没有遗漏。

#### 完整流程

```
用户发消息 "帮我写一个 Python 爬虫"
        │
        ▼
┌─ PROCESSING (turn 0, 不带 tools) ─────────────┐
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
│  │   → PROCESSING，继续 turn 0                 │ │
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
│  → turn 1..n 自动执行，工具调用不再暂停            │
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

`plan.question` 是 Plan 模式 turn 0 中 LLM 可调用的特殊 tool，用于向用户发起交互式提问。它只出现在 plan 未确认阶段，一旦用户确认计划进入 turn 1+，不再触发。

**三种问题类型：**

| `input_type` | 用途 | 前端渲染 | 用户返回值 |
|-------------|------|---------|-----------|
| `select` | 选择题，多选一 | 选项卡片列表 | 选中的 `option` 值 |
| `text` | 填空题，自由输入 | 文本输入框 | 用户输入的字符串 |

**plan.question 数据块格式：**

```typescript
{
  type: "plan.question";
  seq: number;
  message_id: string;
  question: string;                    // 问题文本，如 "你希望部署到哪个平台？"
  options?: string[];                  // select 类型时必填，选项列表
  input_type: "select" | "text";
  context?: string;                    // 可选，解释为什么问这个问题
}
```

**用户回答：**

```
POST /sessions/{id}/plan/answer
Body: { answer: "电商平台" }          // select: 选项文本; text: 自由文本
```

回答直接注入 LLM 上下文，形式为：`用户关于"<question>"的回答：<answer>`。引擎切回 PROCESSING，继续当前 turn。

**超时处理：** 300s 内用户未响应 → 推送 `plan.question_timeout` → 注入 `[用户未回应此问题，请跳过并继续]` → LLM 自行决定下一步。

**与 `plan.generated` 的关系：**

- `plan.question` 是**中途暂停**，LLM 还在收集信息
- `plan.generated` 是**最终交付物**，LLM 认为信息够了，给出完整方案
- LLM 自行判断何时不再提问、何时输出最终计划
- 一次 turn 0 中 `plan.question` 可以有 0 到 N 次

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
                await self._push_chunk({"type": "message.error", "message_id": msg.id, "message": str(e)})
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
  → 每次重试前推送 system.status(level="info") 告知用户后端正在重试
  → 3 次均失败升级为第 4 级

第 2 级：降级（可恢复错误，LLM 自适应）
  工具不存在、权限拒绝、工具执行失败、@文件不存在、格式异常
  → 错误文本注入上下文: "工具 'xxx' 执行失败: <原因>。请尝试其他方法。"
  → LLM 自行调整策略，继续 loop
  → Token 压缩等场景推送 system.status(level="warning") 告知用户上下文已变化

第 3 级：暂停（等待用户介入）
  用户 Plan/Build 无响应、Client 工具回传超时
  → 引擎进入 SUSPENDED 状态，等待用户手动恢复或取消
  → 客户端断开时推送 system.status(level="info")，重连回放时再次推送

第 4 级：终止（不可恢复，释放引擎）
  Rate Limit 耗尽、认证失败、内容安全拦截、Max turns、执行超时、死循环检测
  → 直接推送错误数据块: { type: "message.error", message: "...", fatal: true }
  → 消息标记 error，引擎回到 IDLE 或归档
```

**四级策略中 system.status 的 code 对照：**

| 级别 | 异常场景 | system.status code | 推荐 message 文案 |
|------|---------|-------------------|-------------------|
| 1 重试 | LLM 网络超时 | `llm_retrying` | "AI 服务连接超时，正在重试（第 2/3 次，4 秒后）..." |
| 1 重试 | Rate Limit 429 | `llm_rate_limited` | "请求过于频繁，AI 服务已限流，将在 4 秒后重试（第 2/3 次）..." |
| 1 重试 | DB 连接断开 | `db_retrying` | "数据库连接异常，正在重试（第 2/3 次）..." |
| 1 重试 | LLM 流中断 | `llm_stream_interrupted` | "AI 响应流意外中断，正在重新建立连接..." |
| 1 重试 | LLM 空响应 | `llm_empty_response` | "AI 未返回有效内容，正在重新请求..." |
| 2 降级 | Token 超限压缩 | `token_compressing` | "对话上下文已超过模型窗口限制，正在自动压缩较早的对话记录，被压缩部分的细节可能丢失。" |
| 2 降级 | LLM 输出格式异常 | `llm_format_error` | "AI 返回的数据格式不符合预期，已将错误反馈给模型进行修正..." |
| 3 暂停 | 客户端连接断开 | `client_disconnected` | "您的客户端已断开连接，AI 将在后台继续执行任务。重新打开或刷新页面后会自动同步进度。" |
| 3 暂停 | 重连回放缓冲 | `stream_buffer_replaying` | "已重新连接，正在同步您离线期间产生的 N 条新内容..." |
| — | 服务器重启恢复 | `session_recovering` | "服务器刚刚完成重启，您之前中断的消息将从头重新执行。" |

> **不推送 system.status 的场景：** 第 4 级终止类异常（死循环检测、内容安全拦截、执行超时、轮次耗尽、认证失败、Rate Limit 耗尽）直接走 `message.error(fatal=true)`；入队阶段异常（队列满/重复/归档）通过 HTTP 状态码直接返回；权限拒绝/工具不存在/工具执行失败通过降级注入上下文，LLM 自适应；Client 工具超时已有 `client.tool_timeout`。

#### 1.8.3 重试与退避实现

```python
import asyncio

RETRIABLE_ERRORS = (
    httpx.NetworkError,
    httpx.TimeoutException,
    httpx.HTTPStatusError,   # 仅 429, 502, 503
)

async def call_llm_with_retry(ctx, tools, system, push_status):
    last_exc = None
    MAX_RETRIES = 3
    for attempt in range(MAX_RETRIES):
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
            if attempt < MAX_RETRIES - 1:
                delay = 2 ** attempt  # 1s → 2s → 4s
                code = "llm_rate_limited" if (
                    isinstance(e, httpx.HTTPStatusError) and e.response.status_code == 429
                ) else "llm_retrying"
                await push_status({
                    "type": "system.status",
                    "code": code,
                    "message": (
                        f"请求过于频繁，AI 服务已限流，将在 {delay}s 后重试（第 {attempt+1}/{MAX_RETRIES} 次）..."
                        if code == "llm_rate_limited" else
                        f"AI 服务连接超时，正在重试（第 {attempt+1}/{MAX_RETRIES} 次，{delay}s 后）..."
                    ),
                    "detail": str(e)[:200],
                    "attempt": attempt + 1,
                    "max_attempts": MAX_RETRIES,
                })
                await asyncio.sleep(delay)

    raise MaxRetriesExceeded(last_exc)
```

**流中断处理：**

```python
async def call_llm_stream_with_reconnect(ctx, tools, system, push_status):
    """LLM 流式调用，流中断时自动重连一次"""
    try:
        async for chunk in llm.stream(messages=ctx.messages, tools=tools, system=system):
            yield chunk
    except (httpx.RemoteProtocolError, httpx.StreamClosed) as e:
        # 流意外中断 → 通知客户端后重试一次
        await push_status({
            "type": "system.status",
            "code": "llm_stream_interrupted",
            "message": "AI 响应流意外中断，正在重新建立连接...",
            "detail": str(e)[:200],
        })
        async for chunk in llm.stream(messages=ctx.messages, tools=tools, system=system):
            yield chunk
```

**空响应和格式异常处理：**

```python
async def check_llm_response(response_chunks, push_status) -> bool:
    """检查 LLM 响应是否有效，无效时推送 status 并返回 False"""
    has_content = any(c.type in ("text", "tool_use") for c in response_chunks)

    if not has_content:
        await push_status({
            "type": "system.status",
            "code": "llm_empty_response",
            "message": "AI 未返回有效内容，正在重新请求...",
        })
        return False

    for chunk in response_chunks:
        if chunk.type == "tool_use":
            try:
                json.loads(chunk.tool_input_json)
            except json.JSONDecodeError:
                await push_status({
                    "type": "system.status",
                    "code": "llm_format_error",
                    "message": "AI 返回的数据格式不符合预期，已将错误反馈给模型进行修正...",
                    "detail": f"tool={chunk.tool_name} input 不是合法 JSON",
                })
                return False
    return True
```

**上下文 Token 压缩通知：**

```python
async def _maybe_compress_context(self) -> bool:
    """Token 超限时压缩历史，并通知客户端"""
    if self.context.estimated_tokens <= self.context.max_tokens * 0.9:
        return False

    await self._push_chunk({
        "type": "system.status",
        "code": "token_compressing",
        "message": "对话上下文已超过模型窗口限制，正在自动压缩较早的对话记录，被压缩部分的细节可能丢失。",
        "detail": f"压缩前 tokens: {self.context.estimated_tokens}",
    })
    self.context.compress_earliest_turns()
    return True
```

**数据库操作重试：**

```python
async def db_execute_with_retry(query, *args, push_status, max_retries=3):
    """数据库操作带重试，重试期间通知客户端"""
    for attempt in range(max_retries):
        try:
            return await db.execute(query, *args)
        except (ConnectionError, OperationalError) as e:
            if attempt < max_retries - 1:
                delay = 2 ** attempt
                await push_status({
                    "type": "system.status",
                    "code": "db_retrying",
                    "message": f"数据库连接异常，正在重试（第 {attempt+1}/{max_retries} 次）...",
                    "detail": str(e)[:200],
                    "attempt": attempt + 1,
                    "max_attempts": max_retries,
                })
                await asyncio.sleep(delay)
    raise e
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
            "message": "检测到连续三次相同工具调用，可能是死循环，已自动终止。"
        })
        return True
    return False
```

#### 1.8.5 流连接断开时的缓冲回放

```python
class StreamBuffer:
    """客户端断开时缓冲数据块，重连后回放"""
    def __init__(self, session_id: str, max_size: int = 500,
                 push_status: Callable | None = None):
        self.buffer: list[dict] = []
        self.max_size = max_size
        self._push_status = push_status
        self._client_connected = True

    def push(self, chunk: dict):
        if self._push_status and self._client_connected:
            # 首次检测到客户端断开（流 push 失败），通知用户
            self._client_connected = False
            asyncio.create_task(self._push_status({
                "type": "system.status",
                "code": "client_disconnected",
                "message": "您的客户端已断开连接，AI 将在后台继续执行任务。重新打开或刷新页面后会自动同步进度。",
            }))
        if len(self.buffer) >= self.max_size:
            self.buffer.pop(0)
        self.buffer.append(chunk)

    async def drain(self, since_seq: int | None = None) -> list[dict]:
        """客户端重连时回放 since_seq 之后的数据块"""
        if self._push_status:
            await self._push_status({
                "type": "system.status",
                "code": "stream_buffer_replaying",
                "message": f"已重新连接，正在同步您离线期间产生的 {len(self.buffer)} 条新内容...",
            })
        self._client_connected = True
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

    engine = QueryLoopEngine(session_id)

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
            await engine._push_chunk({
                "type": "system.status",
                "code": "session_recovering",
                "message": "服务器刚刚完成重启，您之前中断的消息将从头重新执行。",
                "detail": f"message_id={msg['id']}",
            })
        await db.execute(
            "UPDATE sessions SET current_message_id=NULL WHERE id=$1",
            session["id"]
        )

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
  thinking_budget?: number;             // 会话级默认 thinking token 预算（>=1024），后续消息可逐条覆盖

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
  thinking_budget?: number;            // Claude extended thinking token 预算（>=1024，0 或不传关闭）。仅 Opus/Sonnet 生效，其他模型忽略
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
| `queue.enqueued` | 消息入队，告知当前排位和队列长度 |
| `queue.position_changed` | 前方消息完成/取消导致排位变化 |
| `token.usage` | 每次 LLM 调用完成后推送累计 token 消耗 |
| `system.status` | 后端执行补救措施时（重试、压缩、缓冲回放等），告知用户引擎正在做什么 |
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
  │◄── {"type":"queue.enqueued","queue_position":2,"queue_size":2,…}
  │       … 等待前序消息完成 …            ← 流保持连接，排位变化时推送
  │◄── {"type":"queue.position_changed","new_position":1,"queue_size":1}
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
{ answer: string; }                  // select: 选项文本; text: 自由文本
```

**Response (JSON):**

```typescript
// 200 OK — 回答已注入，引擎继续 turn 0
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
| **Plan** | `plan.question` | 完整 | 计划阶段 LLM 向用户发起追问（选择题/填空） |
| **Plan** | `plan.question_timeout` | 完整 | 用户超时未回答 plan.question |



| **Build** | `build.step_pending` | 完整 | 步骤待用户确认 |

| **队列** | `queue.enqueued` | 完整 | 消息入队，含排位和队列长度 |
| **队列** | `queue.position_changed` | 完整 | 前方消息完成/取消，排位前移 |

| **Token** | `token.usage` | 完整 | 每次 LLM 调用完成后推送累计 input/output tokens |

| **系统** | `message.start` | 完整 | 消息开始处理 |
| **系统** | `message.complete` | 完整 | 处理完成，含 turn/token 摘要 |
| **系统** | `message.error` | 完整 | 处理异常 |
| **系统** | `system.status` | 完整 | 后端正在执行补救操作（重试、降级、回放等），告知用户引擎当前状态 |

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
      input_type: "select" | "text";
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
  // 5. 队列事件
  // ═══════════════════════════════════════════
  | {
      type: "queue.enqueued";
      seq: number;
      message_id: string;
      queue_position: number;
      queue_size: number;
      ahead_message_id: string | null;
    }
  | {
      type: "queue.position_changed";
      seq: number;
      message_id: string;
      new_position: number;
      queue_size: number;
    }

  // ═══════════════════════════════════════════
  // 6. Token 统计
  // ═══════════════════════════════════════════
  | {
      type: "token.usage";
      seq: number;
      message_id: string;
      tokens_in: number;           // 累计 input tokens
      tokens_out: number;          // 累计 output tokens
    }

  // ═══════════════════════════════════════════
  // 7. 生命周期 & 系统
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
      message: string;
      code: string;
      fatal: boolean;
      turn?: number;
    }

  // ═══════════════════════════════════════════
  // 8. 系统状态通知（后端补救措施透明度）
  // ═══════════════════════════════════════════
  | {
      type: "system.status";
      seq: number;
      message_id: string;
      code: "llm_retrying" | "llm_stream_interrupted" | "llm_empty_response"
          | "llm_format_error" | "llm_rate_limited"
          | "token_compressing" | "db_retrying"
          | "client_disconnected" | "stream_buffer_replaying"
          | "session_recovering"
          | "mcp_reconnecting" | "mcp_reconnected" | "mcp_permanently_down"
          | "mcp_server_not_installed" | "mcp_server_not_ready"
          | "mcp_tool_not_found" | "mcp_tool_timeout" | "mcp_tool_error"
          | "mcp_connection_lost";
      message: string;                     // 给人看的中文描述，如 "AI 服务连接超时，正在重试（第 2/3 次，4 秒后）..."
      turn?: number;                       // 关联的 turn（可选）
      detail?: string;                     // 补充信息（可选），如异常原文截取
      attempt?: number;                    // 当前重试次数（可选，重试类场景用）
      max_attempts?: number;               // 最大重试次数（可选）
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

Plan 模式下 turn 0 完成后推送，流在此**暂停**，引擎切到 WAITING_SYNC。

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
| **`plan.question`** | 根据 `input_type` 渲染不同 UI：<br>• `select` → 选项卡片列表（单选）<br>• `text` → 文本输入框 | **`POST /sessions/{id}/plan/answer`** Body: `{ answer }`（select 传选项文本、text 传输入字符串） |
| `plan.question_timeout` | 渲染"用户超时未回答"提示 | 无（服务端已注入 `[用户未回应此问题，请跳过并继续]`，LLM 自行继续） |

**四、Build 模式专用（每步确认）**

| 数据块 | 客户端处理 | 调用的接口 |
|--------|-----------|-----------|
| **`build.step_pending`** | 渲染步骤卡片：工具名、参数预览、`reasoning`（如有）、步骤序号。展示三个按钮：**[确认]** **[跳过]** **[终止]** | 确认 → **`POST /sessions/{id}/build/confirm`**（执行该工具）<br>跳过 → **`POST /sessions/{id}/build/skip`**（LLM 收到"被跳过"反馈后继续）<br>终止 → **`POST /sessions/{id}/build/abort`**（终止整条消息，引擎回 IDLE） |

**五、队列事件**

| 数据块 | 客户端处理 | 调用的接口 |
|--------|-----------|-----------|
| `queue.enqueued` | 记录 `queue_position`，渲染排队 UI："排队中，前方还有 N 条消息"。如果 `ahead_message_id` 非空则显示前方消息预览。按 `queue_position` 排序展示排队列表。 | 无（也可调用 `GET /queue` 获取完整队列快照补充渲染） |
| `queue.position_changed` | 更新当前消息的排位（`new_position`），排队列表序号前移。当 `new_position == 1` 时提示"即将处理"。 | 无 |
| **`[取消排队]` 按钮** | — | **`DELETE /sessions/{id}/queue/{msg_id}`**（仅 `pending` 状态可取消，processing 不可取消） |

**六、生命周期 / 系统**

| 数据块 | 客户端处理 | 调用的接口 |
|--------|-----------|-----------|
| `message.start` | 初始化消息 UI 容器，记录 `mode`、`scene_mode`、`workspace`，准备接收后续流数据块。将当前 `seq` 置为基准 | 无 |
| `token.usage` | 实时更新当前消息的累计 token 消耗（input / output），可在 UI 顶部或底部展示 | 无 |
| `message.complete` | 渲染摘要信息（turns、tokens、耗时、工具调用次数），标记消息为"已完成"。**此数据块后服务端关闭流** | 无 |
| `message.error` | 渲染错误信息。`fatal: true` → 标记消息终止，展示错误码和描述；`fatal: false` → 展示警告但仍等待后续数据块 | 无（但 `fatal` 错误后可能需要用户手动重发消息） |
| `system.status` | 以 toast / 内联提示条渲染 `message` 文本（灰色提示条 + loading 图标，3~5 秒后自动消失）。同一 `code` 的新 chunk 覆盖旧提示。`detail` 可折叠展示（点击展开）。不需要用户交互 | 无（纯渲染，引擎自行继续） |

**七、断线重连**

当 NDJSON 流因网络中断而断开时，客户端需维护当前消息 ID 和最后收到的 `seq`，在流的 `onerror` / `onclose`（非正常关闭）时自动发起重连：

```
Client 记录最后收到的 seq
  → onerror 自动触发重连
  → GET /sessions/{id}/stream?since_seq={last_seq}&since_message_id={current_msg_id}
  → 服务端从 StreamBuffer 回放 seq > last_seq 的所有数据块
  → 追上实时后继续增量推送
```

多次重试失败后展示"连接已断开，点击重试"兜底按钮。StreamBuffer 机制见 [1.8.5 流连接断开时的缓冲回放](#185-流连接断开时的缓冲回放)。

**八、客户端需要主动调用的接口汇总（按触发源）**

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
| 用户点 **[取消排队]** | `DELETE /sessions/{id}/queue/{msg_id}` |
| 流断开（自动） | `GET /sessions/{id}/stream?since_seq=N` |

其余 `agent.thinking`、`agent.text`、`agent.tool_result`、`system.status`、`message.*` 等均为纯渲染，不需要客户端回调任何接口。

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

##### 消息排队（发消息时前序消息还在处理中）

```
Client 发送 msg2，此时 msg1 正在 PROCESSING

msg2 Client                          Server
  │                                    │
  │─ POST /messages {"content":"msg2",…}
  │◄══ NDJSON stream ═════════════════│
  │◄── {"type":"queue.enqueued",
  │      "message_id":"msg2",
  │      "queue_position":1,
  │      "queue_size":1,
  │      "ahead_message_id":"msg1"}
  │                                    │
  │   … msg1 处理完成，引擎 dequeue msg2 …
  │                                    │
  │◄── {"type":"message.start","message_id":"msg2",…}
  │◄── {"type":"agent.text",…}
  │◄── ...
  │◄── {"type":"message.complete",…}
  │                                    │  ← 流关闭
```

```
Client 发送 msg3，此时 msg1 正在 PROCESSING，msg2 排在前面

msg3 Client                          Server
  │                                    │
  │─ POST /messages {"content":"msg3",…}
  │◄══ NDJSON stream ═════════════════│
  │◄── {"type":"queue.enqueued",
  │      "queue_position":2,
  │      "queue_size":2,
  │      "ahead_message_id":"msg1"}
  │                                    │
  │   … msg2 被用户取消，触发 renumber …
  │                                    │
  │◄── {"type":"queue.position_changed",
  │      "message_id":"msg3",
  │      "new_position":1,
  │      "queue_size":1}
  │                                    │
  │   … msg1 完成，msg3 出队 …
  │                                    │
  │◄── {"type":"message.start","message_id":"msg3",…}
  │◄── ...
  │◄── {"type":"message.complete",…}
  │                                    │  ← 流关闭
```
---

> **下一节**：上下文管理系统（待用户确认本节省后继续展开）

---

## 2. MCP 工具集成

### 2.1 架构概览

MCP (Model Context Protocol) 是 iWork 扩展 AI 能力的核心机制。通过 MCP 协议，iWork 服务端连接外部工具提供者（GitHub、Slack、PostgreSQL 等），将外部工具无缝注册到 LLM 上下文，使 AI 能在对话中调用它们。

与客户端工具（Client Tools）不同，MCP 工具在**服务端执行**，对前端完全透明——前端只需渲染 `tool_call` / `tool_result` 的状态变化，无需参与执行链。

```
┌── Electron Client ──┐     ┌── FastAPI Server ───────────────────────────────┐
│                      │     │                                                  │
│  MCP Hub UI          │     │  ┌── MCPServerManager ───────────────────────┐  │
│  (配置面板，           │     │  │                                           │  │
│   浏览/安装/启停)      │     │  │  ┌────────┐  ┌────────┐  ┌──────────┐  │  │
│                      │◄───►│  │  │GitHub  │  │ Postgre│  │  Slack   │  │  │
│  用户消息 →           │ API │  │  │  MCP   │  │  MCP   │  │   MCP    │  │  │
│  POST /messages      │─────►│  │  │(stdio) │  │(stdio) │  │(HTTP)    │  │  │
│                      │      │  │  └────────┘  └────────┘  └──────────┘  │  │
│                      │      │  └─────────────────────────────────────────┘  │
│                      │      │           │                           ▲         │
│                      │      │           │ tools/list +              │         │
│                      │      │           │ tools/call                │         │
│                      │      │           ▼                           │         │
│                      │      │  ┌── MCPToolRegistry ─────────────────────┐   │
│                      │      │  │  合并所有 MCP 工具 → LLM 可用工具列表    │   │
│                      │      │  └────────────────────────────────────────┘   │
│                      │      │           │                                    │
│                      │      │           ▼                                    │
│                      │      │  ┌── QueryLoopEngine ──────────────────────┐  │
│                      │      │  │  context.build() → 合并全部工具          │  │
│                      │      │  │  → llm.stream(tools=[全部工具])          │  │
│                      │      │  │  → tool_dispatcher.dispatch()           │  │
│                      │      │  └─────────────────────────────────────────┘  │
└──────────────────────┘     └──────────────────────────────────────────────────┘
```

**三层架构：**

| 层 | 组件 | 职责 |
|---|---|---|
| **配置层** | `mcp_servers.yaml` + `Settings.mcp_*` | 存储服务连接定义、凭据、启用状态，用户级隔离 |
| **运行时层** | `MCPServerManager` | 管理进程/连接生命周期：启动 → 初始化 → 心跳 → 重连 → 关闭 |
| **注册层** | `MCPToolRegistry` | 从所有已连接 MCP 服务收集工具定义，合并为 LLM 可用工具列表 |

### 2.2 MCP 协议基础

iWork 的 MCP 实现基于 **JSON-RPC 2.0** 协议，支持三种传输方式。

```
MCP 通信模型：

iWork Server                          MCP Server (外部进程/服务)
       │                                        │
       │──── initialize ───────────────────────→│  握手阶段
       │←─── {protocolVersion, capabilities} ──│
       │──── initialized ──────────────────────→│
       │                                        │
       │──── tools/list ───────────────────────→│  发现阶段
       │←─── [{name, description, inputSchema}] │
       │                                        │
       │──── tools/call ───────────────────────→│  执行阶段
       │←─── {content: [...], isError: false} ──│
       │                                        │
       │──── shutdown ─────────────────────────→│  关闭阶段
```

**三种传输方式对比：**

| 传输方式 | 传输层 | 适用场景 | 配置字段 |
|---------|--------|---------|---------|
| **stdio** | 子进程 stdin/stdout | 本地 MCP 服务（npx/uvx 启动） | `command` + `args` + `env` |
| **SSE** | HTTP Server-Sent Events | 远程 MCP 服务（兼容） | `url` + `headers` |
| **Streamable HTTP** | HTTP POST + NDJSON | 远程 MCP 服务（推荐，与项目架构一致） | `url` + `headers` |

> **iWork 选择：** 优先支持 stdio（npm 生态兼容最好）和 Streamable HTTP（与项目已有 NDJSON 架构一致）。SSE 作为兼容选项保留。

**传输选择决策：**

```
mcp_servers.yaml 中的 transport 决定连接方式：

  transport: stdio
    → 服务端 spawn 子进程，通过 stdin/stdout 交换 JSON-RPC
    → 适用: npx/pipx/uvx 启动的本地 MCP 服务
    → 配置: command, args, env

  transport: streamable-http
    → 服务端通过 HTTP POST 向远端发送 JSON-RPC 请求
    → 适用: 远程 MCP 服务（公司内部 API MCP）
    → 配置: url, headers
```

**三种传输的 connect / request / disconnect 操作对比：**

```
┌─ StdioTransport ─────────────────────────────────────────────────────┐
│                                                                      │
│  connect()                                                           │
│    asyncio.create_subprocess_exec(cmd, args, stdin=PIPE, stdout=PIPE)│
│    → fork 子进程，拿到 stdin StreamWriter + stdout StreamReader       │
│                                                                      │
│  request(id=N)                                                       │
│    self._request_id += 1                                             │
│    stdin.write('{"jsonrpc":"2.0","id":N,"method":"...","params":{}}  │
│               '\n')                                                  │
│    await stdin.drain()                                               │
│    line = await stdout.readline()     ← 阻塞等待一行 JSON             │
│    return json.loads(line)["result"]                                  │
│                                                                      │
│  disconnect()                                                        │
│    transport.request("shutdown", {})  ← 优雅关闭                      │
│    stdin.close()                                                     │
│    await process.wait(timeout=5)      ← 超时则 kill()                │
│                                                                      │
│  特点: 一问一答，锁保护，进程崩溃直接体现为 ConnectionError             │
└──────────────────────────────────────────────────────────────────────┘

┌─ HttpTransport (streamable-http) ────────────────────────────────────┐
│                                                                      │
│  connect()                                                           │
│    self._client = httpx.AsyncClient(timeout=30, verify=...)          │
│    设置 Accept: application/json, text/event-stream                  │
│    → 无实际网络请求，仅创建 HTTP 客户端                                │
│                                                                      │
│  request(id=N)                                                       │
│    self._request_id += 1                                             │
│    resp = await client.post(url, json={"jsonrpc":"2.0","id":N,...},  │
│                              headers=...)                            │
│    resp.raise_for_status()                                           │
│    data = resp.json()                 ← 直接解析 JSON body            │
│    if "error" in data: raise MCPError                                │
│    return data["result"]                                              │
│                                                                      │
│  disconnect()                                                        │
│    await self._client.aclose()        ← 关闭 HTTP 连接池              │
│                                                                      │
│  特点: 每次 request 是一次完整 HTTP POST，无长连接状态，响应路径唯一    │
└──────────────────────────────────────────────────────────────────────┘

┌─ SseTransport (sse) ─────────────────────────────────────────────────┐
│                                                                      │
│  connect()                                                           │
│    ① GET /mcp (Accept: text/event-stream, stream=True)               │
│    ② 启动后台 asyncio.Task: _read_sse() 持续消费 SSE 流              │
│    ③ await _endpoint_ready.wait()   ← 等待 endpoint 事件到达         │
│       SSE 流中解析:                                                   │
│         event: endpoint                                              │
│         data: /mcp/session/abc123                                    │
│       → self._endpoint_url = urljoin(base, "/mcp/session/abc123")    │
│    ④ 超时或流错误 → disconnect → raise ConnectionError               │
│                                                                      │
│  request(id=N)                                                       │
│    ① POST endpoint_url {"jsonrpc":"2.0","id":N,...}                  │
│    ② 检查 Content-Type:                                              │
│       ├─ application/json → resp.json() 直接返回                      │
│       ├─ text/event-stream → 从 POST body 提取 SSE data              │
│       └─ 202 Accepted / 空 body → 创建 Future 放入 _pending[id]      │
│           等待后台 _read_sse() 从 GET SSE 流中匹配 id 后 resolve      │
│           超时 → raise ConnectionError                                │
│                                                                      │
│  disconnect()                                                        │
│    ① 取消所有 _pending Futures（set_exception）                       │
│    ② _read_task.cancel()              ← 取消后台 SSE 读取任务         │
│    ③ await _sse_response.aclose()     ← 关闭 GET SSE 响应流          │
│    ④ await _client.aclose()           ← 关闭 httpx 客户端             │
│                                                                      │
│  特点: 双路异步响应，                                          │
│        _read_sse() 是唯一 aiter_lines() 消费者（避免重复消费）        │
└──────────────────────────────────────────────────────────────────────┘
```

**三者核心差异：**

| 维度 | Stdio | streamable-http | SSE |
|------|-------|-----------------|-----|
| **连接建立** | fork 子进程（~2-5s） | 创建 HTTP client（瞬态） | GET SSE + 解析 endpoint |
| **request 响应路径** | 1 条：stdout 逐行读 | 1 条：POST body JSON | 2 条：POST body **或** GET SSE 流 |
| **并发模型** | 锁 + 一问一答 | 锁 + HTTP 同步 | 锁 + Future + 后台 Task |
| **断开方式** | `shutdown` → `stdin.close()` → `kill()` | `client.aclose()` | cancel Task → close SSE → close client |
| **断线感知** | 进程退出 (`returncode`) | HTTP 异常 | SSE 流关闭 / Task 异常 |
| **额外复杂度** | — | — | Event(端点同步) + Future(跨路径匹配) + 单 reader 约束 |

### 2.3 MCP 服务生命周期

每个 MCP 服务在 iWork 内部经历以下状态机：

```
                    ┌──────────────────────────────────┐
                    │          LIFECYCLE                │
    ┌──────────┐    │  ┌──────────┐    ┌────────────┐  │
    │DISCONNECT│───►│  │CONNECTING│───►│INITIALIZED │  │
    │   ED     │    │  └──┬───────┘    └─────┬──────┘  │
    └────┬─────┘    │     │                  │         │
         │          │     │ 连接/握手失败     │ tools/  │
         │ 重连     │     │ 超时或错误        │ list    │
         │          │     │                  │ 成功    │
         │          │     ▼                  ▼         │
         │          │  ┌──────┐         ┌────────┐    │
         │          │  │ERROR │         │ READY  │    │
         │          │  └──────┘         └───┬────┘    │
         │          │       ▲               │         │
         └──────────┴───────┴───────────────┘         │
                    │         连接断开 / 心跳失败        │
                    └──────────────────────────────────┘
```

**状态说明：**

| 状态 | 说明 | 该状态下可执行的操作 |
|------|------|-------------------|
| **DISCONNECTED** | 未连接或已主动断开。用户禁用的服务保持此状态 | 无 |
| **CONNECTING** | 正在启动子进程或建立 HTTP 连接 | 等待超时 |
| **INITIALIZED** | JSON-RPC 握手完成，等待工具列表拉取 | `tools/list` |
| **READY** | 工具列表已拉取，可执行工具调用 | `tools/call` |
| **ERROR** | 连接失败、握手失败、或工具列表拉取失败 | 等待重连（指数退避） |

**连接流程（伪代码）：**

```python
async def connect_server(self, server_def: MCPServerDefinition):
    """启动 MCP 服务并完成初始化握手。"""
    server = MCPServerState(
        id=server_def.id,
        name=server_def.name,
        status="CONNECTING",
    )

    try:
        # 1. 根据 transport 类型建立传输通道
        transport = self._create_transport(server_def)
        await transport.connect()
        # stdio:  spawn child process, open stdin/stdout pipes
        # http:   open httpx.AsyncClient, verify URL reachable

        # 2. 发送 initialize 请求
        init_result = await transport.request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "clientInfo": {"name": "iWork", "version": "0.1.0"},
        })
        server.protocol_version = init_result.get("protocolVersion")

        # 3. 发送 initialized 通知
        await transport.notify("initialized", {})

        server.status = "INITIALIZED"

        # 4. 拉取工具列表
        tools_result = await transport.request("tools/list", {})
        server.tools = tools_result.get("tools", [])
        server.status = "READY"

    except Exception as e:
        server.status = "ERROR"
        server.error = str(e)
        self._schedule_reconnect(server_def)  # 后台重连

    return server
```

**重连策略（指数退避）：**

```python
async def _schedule_reconnect(self, server_def: MCPServerDefinition):
    """连接失败后指数退避重连。"""
    attempts = self._retry_counts.get(server_def.id, 0)

    if attempts >= settings.mcp_reconnect_max_retries:
        logger.error(f"MCP server {server_def.id}: max retries exceeded")
        self._set_status(server_def.id, "DISCONNECTED")
        return

    delay = settings.mcp_reconnect_backoff_base_seconds * (2 ** attempts)
    self._retry_counts[server_def.id] = attempts + 1

    await asyncio.sleep(delay)
    await self.connect_server(server_def)
```

### 2.4 MCP 服务配置

#### 2.4.1 配置文件格式

MCP 服务定义存储在 `mcp_servers.yaml`（路径由 `config.py` 的 `mcp_config_file` 指定），每个用户独立一份。

```yaml
# iWork MCP 服务定义（按用户隔离）
version: 1
servers:
  # ── stdio 传输 ──
  - id: "github"
    name: "GitHub MCP"
    description: "管理 Issues、PR、仓库操作"
    enabled: true
    transport: stdio
    command: "npx"
    args: ["-y", "@anthropic-ai/mcp-server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"
    enabled_tools: []          # 空 = 全部启用
    timeout_ms: 120000
    category: "开发"
    icon: "github"
    hub_id: "mh1"
    source: hub

  - id: "postgres"
    name: "PostgreSQL MCP"
    description: "数据库查询和管理"
    enabled: true
    transport: stdio
    command: "npx"
    args: ["-y", "@anthropic-ai/mcp-server-postgres"]
    env:
      DATABASE_URL: "postgresql://user:pass@localhost:5432/mydb"
    source: hub

  # ── Streamable HTTP 传输 ──
  - id: "slack"
    name: "Slack MCP"
    description: "发送消息、管理频道通知"
    enabled: false
    transport: streamable-http
    url: "https://slack-mcp.example.com/mcp"
    headers:
      Authorization: "Bearer ${SLACK_API_KEY}"
    timeout_ms: 60000
    source: hub

  # ── 用户自定义 ──
  - id: "internal-api"
    name: "内部 API MCP"
    description: "公司内部 API 调用"
    enabled: true
    transport: streamable-http
    url: "https://api.internal.example.com/mcp"
    headers:
      X-API-Key: "${INTERNAL_API_KEY}"
    source: custom
```

**字段定义：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 唯一标识，用作工具名前缀（如 `github.search_issues`） |
| `name` | string | 是 | 显示名称 |
| `description` | string | 否 | 功能描述 |
| `enabled` | boolean | 是 | 是否启用，false 则该服务不会连接 |
| `transport` | enum | 是 | `stdio` / `sse` / `streamable-http` |
| `command` | string | stdio 时必填 | 启动命令 |
| `args` | string[] | 否 | 命令行参数 |
| `env` | dict | 否 | 环境变量（支持 `${VAR}` 引用，运行时从 OS 环境解析） |
| `url` | string | http 时必填 | 远程 MCP 服务 URL |
| `headers` | dict | 否 | 自定义 HTTP 头（支持 `${VAR}` 引用） |
| `enabled_tools` | string[] | 否 | 工具白名单，空 = 全部启用 |
| `timeout_ms` | number | 否 | 按 server 覆盖默认超时 |
| `category` | string | 否 | Hub 分类标签 |
| `icon` | string | 否 | 前端图标标识 |
| `hub_id` | string | 否 | Hub 来源 ID（Hub 安装时填充） |
| `source` | enum | 否 | `hub` / `custom` / `builtin` |

#### 2.4.2 配置层级：会话级 vs 消息级

```
配置层级（越下层优先级越高）：

┌── mcp_servers.yaml（系统默认）              ← 最底层
│   定义所有已安装服务的连接信息和全局启停状态
│
├── Session.mcp_servers（会话级默认）          ← 创建会话时设置
│   POST /sessions 时传入，或后续 PATCH 更改
│   决定该会话默认启用哪些 MCP 服务
│
├── Message.mcp_servers（消息级覆盖）          ← 最顶层
│   POST /messages 时传入，仅该消息生效
│   不传则使用会话级默认值
│
└── MCPServerConfig.enabled_tools（工具白名单）
    消息级可进一步限制具体启用哪些工具
    空 = 该 MCP 服务的全部工具可用
```

> **设计原理：** 会话级配置确保同一任务的历史消息有一致的工具集——如果 MCP 服务在对话中途被禁用，已执行的历史消息不受影响。消息级覆盖允许用户在某次具体请求中临时调整工具集（如"这次不要调用 GitHub"）。

#### 2.4.3 凭据管理

MCP 服务的 API 密钥等敏感信息不直接写在 `mcp_servers.yaml` 中，而是使用环境变量引用：

```yaml
env:
  GITHUB_TOKEN: "${GITHUB_TOKEN}"
  DATABASE_URL: "${MY_DB_URL}"
```

服务端在建立连接时解析 `${...}` 引用，从 OS 环境变量中获取实际值。解析失败的变量记录警告并跳过该条目。

### 2.5 工具发现与注册

#### 2.5.1 工具列表拉取

服务端启动时，对每个 `enabled=true` 的 MCP 服务：

```
  ┌─ MCPServerManager.connect_server(def) ──────────────┐
  │                                                      │
  │  1. 建立传输连接                                       │
  │  2. initialize 握手                                   │
  │  3. tools/list 请求                                   │
  │     → 返回: [{name, description, inputSchema}, ...]   │
  │  4. 为每个工具添加前缀: {server_id}.{tool_name}         │
  │     → 注入 MCPToolRegistry                           │
  │                                                      │
  └──────────────────────────────────────────────────────┘
```

#### 2.5.2 工具命名规则

为避免不同 MCP 服务间工具名冲突，所有 MCP 工具加前缀：

```
原始工具名                   →    iWork 内部统一工具名
────────────────────────────────────────────────────
github: search_issues       →    github.search_issues
github: create_pr           →    github.create_pr
postgres: query             →    postgres.query
slack: send_message         →    slack.send_message
```

LLM 调用时使用完整前缀名，`ToolDispatcher.classify()` 通过前缀识别 MCP 服务。

#### 2.5.3 合并到 LLM 上下文

对应 `server/engine/context.py:83` 的 TODO——构建 LLM 上下文时，将 MCP 工具合并到可用工具列表：

```python
# context.py - ContextManager.build() 增强

async def build(
    self, session_id, turn, mode, scene_mode,
    client_tools=None,
    mcp_tools=None,              # 新增：来自 MCPToolRegistry 的全部工具
    message_mcp_servers=None,    # 新增：消息级 enabled_tools 白名单
):
    # ... existing system_prompt logic ...

    tools = []
    if mode != "ask":
        # 1. 客户端工具（来自会话注册）
        if client_tools:
            tools.extend(client_tools)

        # 2. MCP 工具（按消息级白名单过滤）
        if mcp_tools and message_mcp_servers:
            # 构建白名单: { "github.": {"search_issues", "create_pr"}, "postgres.": None }
            allowed: dict[str, set | None] = {}
            for srv in message_mcp_servers:
                prefix = srv.server_id + "."
                allowed[prefix] = set(srv.enabled_tools) if srv.enabled_tools else None

            for tool in mcp_tools:
                for prefix, whitelist in allowed.items():
                    if tool["name"].startswith(prefix):
                        if whitelist is None or tool["name"][len(prefix):] in whitelist:
                            tools.append(tool)
                        break
        elif mcp_tools:
            tools.extend(mcp_tools)

    return Context(messages=history, system_prompt=system, available_tools=tools or None)
```

**冲突处理：** 客户端工具总是优先（在本地执行，有 workspace 直接访问权）。MCP 工具带有 `server_id` 前缀，几乎不可能与客户端工具 `bash`/`read_file`/`write_file`/`edit_file`/`glob`/`grep` 冲突。

### 2.6 MCP 工具执行流程

```
LLM 返回: {tool_name: "github.search_issues", input: {query: "bug"}}

        │
        ▼
┌─ QueryLoopEngine._execute_tool_chunk() ───────────────────────┐
│                                                                │
│  1. ToolDispatcher.classify("github.search_issues")            │
│     → 不在 CLIENT_TOOLS → ToolLocation.SERVER                 │
│                                                                │
│  2. ToolDispatcher.dispatch(session_id, chunk)                 │
│     ┌────────────────────────────────────────────────────┐    │
│     │ a) 从工具名解析 server_id:                          │    │
│     │    "github.search_issues"                           │    │
│     │     ↓ split(".", 1)                                 │    │
│     │    server_id="github", actual_tool="search_issues"  │    │
│     │                                                    │    │
│     │ b) MCPToolRegistry 查找:                            │    │
│     │    registry._servers["github"] → MCPServerState     │    │
│     │    ├─ id: "github"                                  │    │
│     │    ├─ status: "READY"                               │    │
│     │    ├─ tools: [{name:"search_issues", ...}, ...]     │    │
│     │    └─ transport: StdioTransport                     │    │
│     │         ├─ process: asyncio.subprocess.Process      │    │
│     │         │   (npx -y @anthropic-ai/mcp-server-github)│    │
│     │         ├─ stdin: StreamWriter  ─→ 子进程 stdin     │    │
│     │         └─ stdout: StreamReader ←─ 子进程 stdout    │    │
│     │                                                    │    │
│     │ c) 确认 server.status == READY                      │    │
│     │                                                    │    │
│     │ d) 通过 transport 写入子进程 stdin:                  │    │
│     │    transport.stdin.write(json_line + "\n")          │    │
│     │    → 字节经管道流入子进程 stdin                      │    │
│     │    → 子进程从 stdin 读到 JSON-RPC 请求:              │    │
│     │    {                                                │    │
│     │      "method": "tools/call",                        │    │
│     │      "params": {                                    │    │
│     │        "name": "search_issues",                     │    │
│     │        "arguments": {"query": "bug"}                │    │
│     │      }                                              │    │
│     │    }                                                │    │
│     │ e) 等待响应（120s 超时）:                            │    │
│     │    iWork → stdout.readline() 阻塞等待                │    │
│     │    子进程内部: 收到 stdin 请求 → 调 GitHub HTTPS API │    │
│     │    子进程 → stdout.write(结果) → iWork 读到响应行    │    │
│     │    120s 内没读到 → asyncio.TimeoutError              │    │
│     │                                                    │    │
│     │ f) 解析响应行:                                       │    │
│     │    {"result":{"content":[{"type":"text",             │    │
│     │     "text":"Found 3 issues: ..."}],"isError":false}} │    │
│     │          isError: false}                            │    │
│     │ g) 转换为统一格式:                                   │    │
│     │    {success: True, output: "Found 3 issues...",     │    │
│     │     duration_ms: 1234}                              │    │
│     └────────────────────────────────────────────────────┘    │
│                                                                │
│  3. 推送 agent.tool_result 到客户端                            │
│  4. context_mgr.append_tool_result() 注入上下文                │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Dispatcher 伪代码（替换现有桩实现）：**

```python
class ToolDispatcher:
    def __init__(self, mcp_registry: "MCPToolRegistry | None" = None):
        self._mcp = mcp_registry

    def classify(self, tool_name: str) -> ToolLocation:
        return ToolLocation.CLIENT if tool_name in CLIENT_TOOLS else ToolLocation.SERVER

    async def dispatch(self, session_id: UUID, tool_call_event) -> dict:
        tool_name = tool_call_event.tool_name  # "github.search_issues"

        if "." not in tool_name:
            return {
                "success": False,
                "error": f"无法识别的服务端工具: {tool_name}",
                "duration_ms": 0,
            }

        server_id = tool_name.split(".", 1)[0]
        actual_tool = tool_name.split(".", 1)[1]

        if self._mcp is None:
            return {"success": False, "error": "MCP 注册中心未初始化", "duration_ms": 0}

        server = self._mcp.get_server(server_id)
        if server is None or server.status != "READY":
            return {
                "success": False,
                "error": f"MCP 服务 '{server_id}' 未就绪",
                "duration_ms": 0,
            }

        # 检查工具是否存在
        available = {t["name"] for t in server.tools}
        if actual_tool not in available:
            return {
                "success": False,
                "error": f"服务 '{server_id}' 不存在工具 '{actual_tool}'。"
                         f"可用: {', '.join(sorted(available))}",
                "duration_ms": 0,
            }

        try:
            start = time.monotonic()
            result = await asyncio.wait_for(
                server.transport.request("tools/call", {
                    "name": actual_tool,
                    "arguments": tool_call_event.tool_input,
                }),
                timeout=settings.mcp_tool_timeout_seconds,
            )
            elapsed = (time.monotonic() - start) * 1000

            is_error = result.get("isError", False)
            content_parts = result.get("content", [])
            output = "\n".join(
                p.get("text", "")
                for p in content_parts
                if p.get("type") == "text"
            )

            return {
                "success": not is_error,
                "output": output or json.dumps(content_parts),
                "duration_ms": int(elapsed),
            }
        except asyncio.TimeoutError:
            return {
                "success": False,
                "error": f"MCP 工具 '{tool_name}' 执行超时 ({settings.mcp_tool_timeout_seconds}s)",
                "duration_ms": settings.mcp_tool_timeout_seconds * 1000,
            }
        except Exception as e:
            return {"success": False, "error": str(e), "duration_ms": 0}
```

**支撑 Dispatcher 的两个核心数据结构：**

`MCPToolRegistry` — 按 `server_id` 索引所有已连接的 MCP 服务：

```python
class MCPToolRegistry:
    """管理所有已连接 MCP 服务的工具注册表。"""
    _servers: dict[str, MCPServerState] = {}  # "github" → MCPServerState

    def get_server(self, server_id: str) -> MCPServerState | None:
        return self._servers.get(server_id)

    def get_all_tools(self) -> list[dict]:
        """收集所有 READY 服务的工具（已加前缀），供 context.build() 使用。"""
        tools = []
        for srv in self._servers.values():
            if srv.status == "READY":
                for t in srv.tools:
                    tools.append({**t, "name": f"{srv.id}.{t['name']}"})
        return tools
```

`StdioTransport` — 封装子进程的 stdin/stdout 管道通信：

```python
class StdioTransport:
    """通过子进程 stdin/stdout 进行 JSON-RPC 通信。"""

    def __init__(self, server_def: MCPServerDefinition):
        self.command = server_def.command       # "npx"
        self.args = server_def.args             # ["-y", "@anthropic-ai/mcp-server-github"]
        self.env = _resolve_env(server_def.env) # {"GITHUB_TOKEN": "ghp_xxx"}
        self.process: asyncio.subprocess.Process | None = None
        self._request_id = 0

    async def connect(self):
        self.process = await asyncio.create_subprocess_exec(
            self.command, *self.args,
            env={**os.environ, **self.env},
            stdin=asyncio.subprocess.PIPE,   # → StreamWriter
            stdout=asyncio.subprocess.PIPE,  # → StreamReader
            stderr=asyncio.subprocess.PIPE,
        )

    async def request(self, method: str, params: dict) -> dict:
        """发送 JSON-RPC 请求，读取响应。"""
        self._request_id += 1
        line = json.dumps({
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": method,
            "params": params,
        })

        # 关键一步：把 JSON 行写入子进程 stdin
        self.process.stdin.write((line + "\n").encode())
        await self.process.stdin.drain()

        # 从子进程 stdout 读取响应行
        response_line = await self.process.stdout.readline()
        return json.loads(response_line)["result"]
```

**以 `github.search_issues` 为例，完整的数据流：**

```
ToolDispatcher.dispatch()
│
├─ 1. server_id = "github.search_issues".split(".", 1)[0]   → "github"
├─ 2. actual_tool = "github.search_issues".split(".", 1)[1] → "search_issues"
├─ 3. server = MCPToolRegistry._servers["github"]           → MCPServerState
├─ 4. server.tools 中校验 "search_issues" 存在
├─ 5. transport.request("tools/call", {name:"search_issues", arguments:{query:"bug"}})
│      │
│      └─ StdioTransport.request()
│           ├─ json.dumps({jsonrpc:"2.0", method:"tools/call", params:{...}})
│           ├─ subprocess.stdin.write(json_line + "\n")   ← 写入管道
│           ├─ subprocess.stdin.drain()                    ← 确保发送
│           ├─ subprocess.stdout.readline()                ← 等待响应
│           └─ return json.loads(line)["result"]
│
└─ 6. 转换为 {success, output, duration_ms} 统一格式
```

**MCP 服务的启动：** `EngineManager.get_or_create(session_id)` 创建新引擎时，遍历 `servers` 配置中 `enabled=true` 的服务，调用 `StdioTransport.connect()` 启动子进程：

```python
# EngineManager 中的启动逻辑
for srv_def in mcp_config.servers:
    if not srv_def.enabled:
        continue
    transport = StdioTransport(srv_def)
    await transport.connect()      # spawn 子进程
    await transport.request("initialize", {...})   # 握手
    tools = await transport.request("tools/list", {})  # 拉工具列表
    registry._servers[srv_def.id] = MCPServerState(
        id=srv_def.id,
        status="READY",
        tools=tools["tools"],
        transport=transport,
    )
```

这样当后续 `dispatch()` 被调用时，`registry._servers["github"]` 拿到的 `MCPServerState` 已经包含了就绪的子进程和管道引用，可以直接通过 stdin 写入。

**与 Client 端工具执行的区别：**

```
客户端工具链路:
  LLM → client.tool_request → Electron 本地执行 → POST /tool-result
          → agent.tool_result → 注入上下文
  前端必须在线，超时 120s

服务端 MCP 工具链路:
  LLM → ToolDispatcher.dispatch() → MCP JSON-RPC tools/call
          → agent.tool_result → 注入上下文
  前端完全透明，只需渲染 tool_call → tool_result 状态变化
```

### 2.7 错误处理

#### 2.7.1 MCP 错误分类

将第一章 1.8.1 异常全景图中 #17"Server 工具执行失败"展开为以下子场景：

| # | 子场景 | MCP 状态变化 | 错误注入上下文格式 | 重试策略 |
|---|--------|-------------|--------------------|---------|
| 17a | **Server 启动失败** | DISCONNECTED → ERROR | `"MCP 服务 '{name}' 启动失败: {error}。该服务的工具暂不可用。"` | 指数退避重连 (最多 3 次) |
| 17b | **initialize 握手超时** | CONNECTING → ERROR | 同上 | 指数退避重连 |
| 17c | **tools/list 失败** | INITIALIZED → ERROR | `"MCP 服务 '{name}' 无法获取工具列表: {error}"` | 重连 1 次 |
| 17d | **工具不存在** | READY（不变） | `"MCP 服务 '{id}' 不存在工具 '{tool}'。可用工具: {list}"` | 不重试，LLM 自适应 |
| 17e | **tools/call 执行异常** | READY（不变） | `"MCP 工具 '{tool}' 执行失败: {error}"` | 不重试（幂等风险），LLM 自适应 |
| 17f | **tools/call 超时** (120s) | READY（不变） | `"MCP 工具 '{tool}' 执行超时 ({timeout}s)"` | 不重试，LLM 决定替代方案 |
| 17g | **连接意外断开**（进程崩溃） | READY → DISCONNECTED | 下次调用时发现服务不可用才报错 | 后台自动重连 |
| 17h | **JSON-RPC 协议错误** | 依赖错误类型 | `"MCP 服务 '{name}' 返回协议错误 (code={code}): {msg}"` | 不重试 |

#### 2.7.2 MCP 三级异常处理策略

| 级别 | MCP 场景 | 处理方式 |
|------|---------|---------|
| **1. 重试** | Server 启动失败、initialize 超时、运行中断连 | 指数退避重连（2^n s，最多 3 次），推送 `mcp_reconnecting` / `mcp_reconnected`；3 次耗尽 → `mcp_permanently_down` |
| **2. 放入上下文，LLM 决定** | tools/call 失败、工具不存在、tools/call 超时、JSON-RPC 协议错误 | 错误文本注入 LLM 上下文，LLM 自行决定重试、换方案、或告知用户 |
| **3. 终止任务** | 重连耗尽（`mcp_permanently_down`） | 该 MCP 服务标记 DISCONNECTED，推送 `system.status` 通知用户检查配置；不影响引擎和其他 MCP 服务 |

#### 2.7.3 MCP 相关的 system.status 通知

```typescript
// MCP 服务重连中
{
  type: "system.status";
  code: "mcp_reconnecting";
  message: string;          // "MCP 服务 'GitHub MCP' 连接断开，正在重连..."
  server_id: string;
  attempt: number;
  max_attempts: number;
}

// MCP 服务恢复
{
  type: "system.status";
  code: "mcp_reconnected";
  message: string;          // "MCP 服务 'GitHub MCP' 已恢复，{N} 个工具可用"
  server_id: string;
  tool_count: number;
}

// MCP 服务永久不可用
{
  type: "system.status";
  code: "mcp_permanently_down";
  message: string;          // "MCP 服务 'GitHub MCP' 多次重连失败，已停止尝试"
  server_id: string;
}

// MCP 工具调用错误（从 call_tool() 推送）
{
  type: "system.status";
  code: "mcp_server_not_installed" | "mcp_server_not_ready"
      | "mcp_tool_not_found" | "mcp_tool_timeout"
      | "mcp_tool_error" | "mcp_connection_lost";
  message: string;          // 错误详情，与 agent.tool_result.error 一致
  server_id: string;
}
```

#### 2.7.4 实现审查：已覆盖 vs 待修复

对照 2.7.1 的 17a~17h 场景，逐一审查 `server/tools/mcp_runtime.py` 中的实际处理情况。

**已正确覆盖：**

| 场景 | 代码位置 | 实际行为 |
|------|---------|---------|
| **17d** 工具不存在 | `call_tool()` L563-569 | 对比 `state.tools`，返回错误 dict（含可用工具列表），LLM 自适应 |
| **17e** tools/call 执行异常 | `call_tool()` L618 | `except Exception` 兜底捕获，返回 `{success: false, error: str(e)}` |
| **17f** tools/call 超时 120s | `call_tool()` L594 | `except asyncio.TimeoutError`，返回超时错误 |
| **17g** 连接意外断开 | `call_tool()` L600 | `except (ConnectionError, OSError)` → 清空 tools → `transport.disconnect()` → `_schedule_reconnect()` → 推送 `mcp_reconnecting` |
| **17h** JSON-RPC 协议错误 | 各 transport `request()` | 响应含 `"error"` 字段时抛出 `MCPError`（code + message），`call_tool()` L618 捕获后返回给 LLM |

**待修复的缺口：**

| # | 问题 | 严重程度 | 根因 | 修复方向 |
|---|------|---------|------|---------|
| **G1** | **初始连接失败不触发自动重连**（17a/17b/17c 的"重试策略"列实际未执行） | **高** | `_do_connect()` L676 `except → raise`，`connect_server()` 不捕获，异常最终被 `_auto_connect_installed_mcps()`（`main.py:99`）和 `install_mcp()`（`mcp_routes.py:131`）的 `logger.warning` 吞掉。`_schedule_reconnect()` 仅在两处被调用：`_reconnect_loop()` 重连链、`call_tool()` L612（运行时断连），缺少"初始连接失败 → 调度重连"路径 | `_do_connect()` 的 `except` 块中，在 `raise` 前调用 `self._schedule_reconnect(sid)` |
| **G2** | **`notify("notifications/initialized")` 失败会中断整个连接** | **中** | `_do_connect()` L667 的 `notify` 在 try 块内，如果进程/连接恰好在此时断开，抛出的异常会使 initialize 已经成功的连接被标记为 ERROR | 将该行移出 try 块，或用 `try/except` 包裹（initialized 通知按 MCP 规范是 best-effort） |
| **G3** | **SSE 流中断后等待中的 `request()` 不清醒** | **中** | `SseTransport._read_sse()` L367-373：endpoint 已就绪后若 SSE 流断开，`_pending` 中的 Futures 无人处理，硬等 120s 超时 | `_read_sse()` 异常退出时遍历 `self._pending` 全部 `set_exception(ConnectionError("SSE 流已断开"))` |`` |
| **G4** | **StdioTransport `_request()` 未包装 JSON 解析异常** | **低** | L181 `json.loads(response_line)` — 若子进程输出非 JSON 内容，`json.JSONDecodeError` 直接上抛，最终作为 raw traceback 注入 LLM 上下文 | 包装为 `MCPError`，让 LLM 看到的是有意义的错误文本 |
| **G5** | **StdioTransport `notify()` 无 null check** | **低** | L159 `self.process.stdin.write(...)` — 如果在 `connect()` 失败后调用 `notify()`，`self.process` 为 None 导致 `AttributeError`。`HttpTransport` 和 `SseTransport` 的 `notify()` 均有 null check | 加 `if self.process is None: return` 守卫 |

**重连触发路径梳理（现状 vs 设计）：**

```
设计文档约定的触发点:                    实际代码的触发点:
                                          
connect 失败 → _schedule_reconnect()    ✗ 未实现（G1）
  17a 启动失败                            异常被外层吞掉，server 卡在 ERROR
  17b 握手超时                            同上
  17c tools/list 失败                      同上
                                          
call_tool 中途断连 → _schedule_reconnect()  ✓ 已实现（L600-612）
  17g 进程崩溃 / HTTP 不可达               ConnectionError/OSError 捕获 → 重连
  
重连链 → _schedule_reconnect()             ✓ 已实现（L688-715）
  第 N 次重试失败 → 第 N+1 次               指数退避 2^n 秒，最多 3 次
  3 次耗尽 → mcp_permanently_down          推送 system.status + 停重连
```

### 2.8 MCP 服务管理（Hub）

#### 2.8.1 Hub 数据来源

Hub 数据以 JSON 配置文件形式存储于服务端 `server/mcp-hub.json`，管理员可直接编辑此文件增删条目。客户端通过 API 获取可安装的 MCP 服务列表。

每条 Hub 条目包含完整的连接信息，客户端可直接用于展示和安装：

```json
{
  "server_id": "mh1",
  "server_name": "GitHub MCP",
  "description": "管理 Issues、PR、仓库操作",
  "icon": "🐙",
  "category": "开发",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {},
  "url": null
}
```

#### 2.8.2 安装 / 卸载流程

安装/卸载状态持久化在 `server/storage/mcp_state.json`，包含已安装的 `server_id` 列表和用户自定义 MCP 的完整配置：

```json
{
  "installed_ids": ["mh1", "mh3", "mh4", "cm1"],
  "custom_servers": [
    {
      "server_id": "cm1",
      "server_name": "内部 API MCP",
      "description": "公司内部 API 接口调用",
      "icon": "🔌",
      "category": "自定义",
      "transport": "stdio",
      "command": "node",
      "args": ["./internal-api-server.js"],
      "env": {},
      "url": null
    }
  ]
}
```

```
安装:
  用户点击 [安装]
  → POST /mcp/install  Body: {server_id: "mh1"}
  → 校验 server_id 在 Hub 中存在
  → 写入 mcp_state.json 的 installed_ids
  → 返回 200: {installed: true, server_id: "mh1"}
  → 重名安装返回 409

卸载:
  用户点击 [已安装]
  → DELETE /mcp/uninstall/{server_id}
  → 从 mcp_state.json 的 installed_ids 中移除
  → 返回 200: {uninstalled: true, server_id: "mh1"}
  → 未安装的服务返回 404
```

创建自定义 MCP 时会自动分配 `server_id`（`cm` + 自增序号）并自动写入 `installed_ids`。删除自定义 MCP 时同时从 `installed_ids` 和 `custom_servers` 中移除。

#### 2.8.3 与主对话流程的联通

MCP 配置通过以下现有字段与主对话流程打通，**无需新增消息级 API**：

```
POST /sessions         body.mcp_servers    → 会话级默认启用的 MCP 服务
PATCH /sessions/{id}   body.mcp_servers    → 更新会话默认
POST /messages         body.mcp_servers    → 消息级覆盖（已在 MessageCreate 定义）
```

### 2.9 MCP 查询接口定义

所有 MCP 管理接口挂载在 `/mcp` 前缀下，由 `server/api/mcp_routes.py` 实现。

| 方法 + 路径 | 说明 | 持久化 |
|------------|------|--------|
| `GET /mcp/hub` | 浏览 Hub 中所有可安装的 MCP 服务 | 读取 `mcp-hub.json` |
| `GET /mcp/installed` | 查看已安装的 MCP（含完整连接配置） | 读取 `mcp_state.json`，关联 Hub/Custom |
| `POST /mcp/install` | 安装 Hub 中的 MCP 服务 | 写入 `mcp_state.json` installed_ids |
| `DELETE /mcp/uninstall/{server_id}` | 卸载已安装的 MCP 服务 | 移除 installed_ids 条目 |
| `GET /mcp/custom` | 查看自定义 MCP 服务列表 | 读取 `mcp_state.json` custom_servers |
| `POST /mcp/custom` | 创建自定义 MCP（自动分配 server_id + 自动安装） | 追加 custom_servers + installed_ids |
| `DELETE /mcp/custom/{server_id}` | 删除自定义 MCP（同步卸载） | 移除 custom_servers + installed_ids |

```typescript
// ═══════════════════════════════════════════
// GET /mcp/hub — 浏览 Hub 所有可安装的 MCP
// ═══════════════════════════════════════════

Response 200:
{
  servers: {
    server_id: string;        // "mh1"
    server_name: string;      // "GitHub MCP"
    description: string;      // "管理 Issues、PR、仓库操作"
    icon: string;             // "🐙"
    category: string;         // "开发"
    transport: "stdio" | "sse" | "streamable-http";
    command: string | null;   // stdio 传输时的启动命令
    args: string[];           // 命令行参数
    url: string | null;       // HTTP 传输时的远程地址
    env: Record<string, string>;  // 环境变量
  }[];
}


// ═══════════════════════════════════════════
// GET /mcp/installed — 查看已安装的 MCP
// ═══════════════════════════════════════════

Response 200:
{
  installed: {
    server_id: string;
    server_name: string;
    description: string;
    icon: string;
    category: string;
    transport: string;
    command: string | null;
    args: string[];
    url: string | null;
    env: Record<string, string>;
  }[];
}


// ═══════════════════════════════════════════
// POST /mcp/install — 安装 Hub 中的 MCP
// ═══════════════════════════════════════════

Request Body:
{ server_id: string; }       // 必须存在于 Hub 中

Response 200:
{ installed: true; server_id: string; }

// 409 — 已安装
{ detail: "MCP 服务已安装: mh1"; }

// 404 — Hub 中不存在
{ detail: "Hub 中不存在 MCP 服务: xxx"; }


// ═══════════════════════════════════════════
// DELETE /mcp/uninstall/{server_id} — 卸载 MCP
// ═══════════════════════════════════════════

Response 200:
{ uninstalled: true; server_id: string; }

// 404 — 未安装
{ detail: "未安装该 MCP 服务: xxx"; }


// ═══════════════════════════════════════════
// GET /mcp/custom — 查看自定义 MCP 列表
// ═══════════════════════════════════════════

Response 200:
{
  custom: {
    server_id: string;        // 自动生成 "cm1", "cm2", ...
    server_name: string;
    description: string;
    icon: string;             // 默认 "🔌"
    category: string;         // 默认 "自定义"
    transport: string;        // 默认 "stdio"
    command: string | null;
    args: string[];
    url: string | null;
    env: Record<string, string>;
  }[];
}


// ═══════════════════════════════════════════
// POST /mcp/custom — 创建自定义 MCP
// ═══════════════════════════════════════════

Request Body:
{
  server_name: string;        // 必填，显示名称
  description?: string;       // 默认 ""
  icon?: string;              // 默认 "🔌"
  category?: string;          // 默认 "自定义"
  transport?: string;         // 默认 "stdio"
  command?: string | null;
  args?: string[];
  url?: string | null;
  env?: Record<string, string>;
}
// server_id 由服务端自动生成（cm + 自增序号），创建后自动安装

Response 201:
{
  server_id: "cm2";
  server_name: string;
  description: string;
  icon: string;
  category: string;
  transport: string;
  command: string | null;
  args: string[];
  url: string | null;
  env: Record<string, string>;
}


// ═══════════════════════════════════════════
// DELETE /mcp/custom/{server_id} — 删除自定义 MCP
// ═══════════════════════════════════════════

Response 200:
{ deleted: true; server_id: string; }

// 404 — 不存在
{ detail: "自定义 MCP 不存在: xxx"; }
```

### 2.10 与 Query Loop 引擎的集成点总结

MCP 在第一章 Query Loop 引擎架构中的注入位置：

```
QueryLoopEngine
│
├── EngineManager.get_or_create(session_id)
│   └── 读取 mcp_servers.yaml → MCPServerManager 后台预连接        ← 新增
│
├── _run_message_loop()
│   │
│   ├── context_mgr.build()
│   │   └── tools = [client_tools] + [mcp_tools (filtered)]        ← TODO 解决
│   │
│   ├── llm.stream(tools=[全部合并后的工具列表])
│   │
│   └── _execute_tool_chunk()
│       ├── tool_dispatcher.classify(name) → CLIENT | SERVER
│       ├── if CLIENT: sync_waiter.wait(120s)                      ← 现有逻辑不变
│       └── if SERVER:
│           └── tool_dispatcher.dispatch(name, input)               ← 替换桩实现
│               └── MCPToolRegistry.get(server_id)
│                   └── transport.request("tools/call", ...)
│
├── _push_chunk() → agent.tool_result                              ← 现有逻辑不变
│
└── context_mgr.append_tool_result()                               ← 现有逻辑不变
```

**服务启动时机：** MCP 服务在 `EngineManager.get_or_create()` 创建新引擎时预连接——所有 `enabled=true` 的服务在后台启动（不阻塞引擎主循环）。选择预连接而非懒加载的原因是：工具列表必须在第一条消息的 `context.build()` 时就绪，懒加载会导致第一条消息的首个 turn 缺失 MCP 工具。

---

## 3. Skill 集成

### 3.1 架构概览

Skill 是 iWork 改变 AI 行为模式的核心机制。与 MCP 工具（为 LLM 增加外部工具调用能力）不同，Skill 通过**向 system prompt 注入预定义的提示词片段**来引导 LLM 的行为。Skill 不启动子进程、不建立网络连接、不产生任何运行时状态——它纯粹是一段文本，在每次 LLM 调用前注入到上下文中。

```
┌── Electron Client ──┐     ┌── FastAPI Server ───────────────────────────────┐
│                      │     │                                                  │
│  Skill Hub UI        │     │  ┌── SkillRegistry (内存级) ─────────────────┐  │
│  (配置面板，           │     │  │                                           │  │
│   浏览/安装/启停)      │     │  │  skill-hub.json ──→ {skill_id: SkillDef}   │  │
│                      │◄───►│  │  skill_state_{user}.json → install/disabled │  │
│  用户消息 →           │ API │  │                                           │  │
│  POST /messages      │─────►│  └──────────────┬────────────────────────────┘  │
│  body.skill_invocations      │                │                                │
│                      │      │                ▼                                │
│                      │      │  ┌── ContextManager.build() ─────────────────┐  │
│                      │      │  │  system_prompt += skill_registry           │  │
│                      │      │  │      .get_active_prompts(skill_ids)        │  │
│                      │      │  │  → llm.stream(system=augmented_prompt)     │  │
│                      │      │  └───────────────────────────────────────────┘  │
└──────────────────────┘     └──────────────────────────────────────────────────┘
```

**两层架构：**

| 层 | 组件 | 职责 |
|---|---|---|
| **配置层** | `skill-hub.json` + `skill_state_{user_id}.json` | 存储 Skill 定义（Hub 目录）和用户级安装状态。Hub 由管理员维护，state 按用户隔离 |
| **注入层** | `ContextManager.build()` + `SkillRegistry` | 解析消息/会话中引用的 `skill_ids`，加载对应定义，将其 `prompt` 片段注入 system prompt |

**Skill vs MCP 核心差异：**

| 维度 | MCP | Skill |
|------|-----|-------|
| 本质 | 外部进程运行时 | 提示词片段注入 |
| 通信方式 | JSON-RPC 2.0 over stdio/HTTP | 无（启动时读取文件） |
| 生命周期 | CONNECTING → INITIALIZED → READY → ERROR | 安装 ↔ 卸载，启用 ↔ 禁用 |
| 运行时状态 | 进程句柄、传输连接 | 内存中的 SkillDefinition 列表 |
| 执行方式 | `tools/call` → 子进程 → 结果 | 无执行——LLM 调用前注入 system prompt |
| 故障模式 | 进程崩溃、超时、协议错误 | JSON 格式错误、定义缺失 |
| 流数据块 | `system.status`（mcp_reconnecting 等） | 无（注入是同步的，发生在 LLM 调用之前） |
| 安装行为 | 写入 state + 启动子进程连接 | 纯 JSON 状态写入 |

### 3.2 Skill 格式与结构

#### 3.2.1 字段定义

每个 Skill 是一个 JSON 对象，定义如下：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `skill_id` | string | 是 | 唯一标识。Hub: `sk` + 序号，Custom: `cs` + 序号，Builtin: `bi` + 序号 |
| `skill_name` | string | 是 | 显示名称，用于 `/` 选择器和标签展示 |
| `description` | string | 是 | 功能简述，用于 Hub 卡片和 `/` 选择器 tooltip |
| `version` | string | 否 | 语义化版本号（Hub 发布用） |
| `category` | string | 否 | 分类标签，如"开发""文档""效率" |
| `icon` | string | 否 | Emoji 图标，用于 UI 展示 |
| `author` | string | 否 | 作者名（Hub 发布用） |
| `tags` | string[] | 否 | 搜索/发现标签 |
| **`prompt`** | **string** | **是** | **Skill 的核心——注入 system prompt 的文本片段** |
| `source` | enum | 否 | `hub` / `custom` / `builtin` |

#### 3.2.2 完整示例

```json
{
  "skill_id": "sk1",
  "skill_name": "代码审查",
  "description": "让 AI 以资深代码审查员的视角分析代码，关注安全性、性能和可维护性",
  "version": "1.2.0",
  "category": "开发",
  "icon": "🔍",
  "author": "iWork Team",
  "tags": ["code", "review", "security"],
  "source": "hub",
  "prompt": "\n## Skill: 代码审查\n你正在扮演一位资深代码审查员。在分析代码时，请遵循以下原则：\n1. **安全性优先**：首先检查 OWASP Top 10 漏洞（SQL注入、XSS、CSRF 等）\n2. **性能分析**：识别 N+1 查询、不必要的内存分配、阻塞操作\n3. **可维护性**：检查命名规范、函数复杂度（超过 15 行建议拆分）、重复代码\n4. **输出格式**：使用表格总结发现的问题，按严重程度排序（🔴 严重 / 🟡 中等 / 🟢 建议）\n"
}
```

> **核心理解：** `prompt` 字段就是 Skill 的全部。`description`、`icon` 等字段只是 UI 元数据，供 Hub 浏览和选择器展示。真正改变 LLM 行为的是注入到 system prompt 中的 `prompt` 文本。

#### 3.2.3 内置 Skill

系统预装、不可卸载的内置 Skill（对应 `source: "builtin"`）：

| skill_id | 名称 | 用途 | 来源 |
|----------|------|------|------|
| `bi1` | 日常办公 | 默认 `office` 模式的 system prompt 片段 | `context.py` 中的 `SYSTEM_PROMPTS["office"]` |
| `bi2` | 代码开发 | 默认 `code` 模式的 system prompt 片段 | `context.py` 中的 `SYSTEM_PROMPTS["code"]` |

内置 Skill 硬编码在服务端，不参与安装/卸载流程。现有的 `SYSTEM_PROMPTS` 和 `MODE_PROMPTS` 本质上已经是内置 Skill 的形式。

#### 3.2.4 ID 前缀规则

| 前缀 | 来源 | 示例 | 安装态 | 卸载 |
|------|------|------|--------|------|
| `sk` | Hub Skill | `sk1`, `sk42` | 可安装 | 可卸载 |
| `cs` | Custom Skill（用户自建） | `cs1`, `cs2` | 创建即安装 | 删除即卸载 |
| `bi` | Builtin Skill（系统内置） | `bi1`, `bi2` | 始终安装 | 不可卸载 |

### 3.3 Skill 生命周期

Skill 没有进程、没有连接、没有运行时状态。它的生命周期就是一个安装/卸载/启用的标记流转：

```
                    ┌──────────────────────────────────────┐
                    │          SKILL LIFECYCLE              │
                    │                                       │
    ┌──────────┐    │                                       │
    │UNINSTALL │    │                                       │
    │    ED    │───►│  INSTALLED  ──→  ENABLED              │
    │          │    │  (在 state    (在 / 选择器              │
    └────┬─────┘    │   的         中可见，                   │
         │          │   installed_  prompt 会               │
         │ 卸载     │   ids 中)     被注入)                  │
         │          │                                       │
         └──────────┼───────────────────────────────────────┘
```

| 状态 | 说明 | 用户可见行为 |
|------|------|-------------|
| **UNINSTALLED** | Skill 不在用户的 `skill_state.json` 中 | 不出现在 `/` 选择器和"已安装"标签页 |
| **INSTALLED** | `skill_id` 已写入 `installed_ids` | 出现在"已安装"标签页；如果不在 `disabled_ids` 中则 `/` 选择器可见 |
| **ENABLED** | INSTALLED 的子集，且不在 `disabled_ids` 中 | `/` 选择器中可见、可选中；消息发送时 prompt 会被注入 |

> **与 MCP 的关键区别：** MCP 有 `CONNECTING → INITIALIZED → READY → ERROR` 多种运行时状态，有指数退避重连逻辑。Skill 安装 = 纯 JSON 写入，无需 `connect_server()`、无心跳、无重连。

### 3.4 Skill 配置

#### 3.4.1 配置文件格式

**`skill-hub.json`**（服务端 Hub 目录，类似 `server/mcp-hub.json`）：

由管理员维护，用户只读。存储所有可安装的社区/团队 Skill 的完整定义：

```json
{
  "skills": [
    {
      "skill_id": "sk1",
      "skill_name": "代码审查",
      "description": "以资深代码审查员视角分析代码，关注安全性、性能和可维护性",
      "version": "1.2.0",
      "category": "开发",
      "icon": "🔍",
      "author": "iWork Team",
      "tags": ["code", "review", "security"],
      "prompt": "\n## Skill: 代码审查\n你正在扮演一位资深代码审查员..."
    },
    {
      "skill_id": "sk2",
      "skill_name": "文档生成器",
      "description": "自动生成 README、API 文档和代码注释",
      "version": "1.0.0",
      "category": "文档",
      "icon": "📝",
      "author": "iWork Team",
      "tags": ["docs", "readme", "api"],
      "prompt": "\n## Skill: 文档生成器\n你是技术文档专家。生成文档时请遵循以下规范..."
    }
  ]
}
```

**`skill_state_{user_id}.json`**（用户级安装状态，类似 `server/storage/mcp_state.json`）：

每用户独立存储，记录该用户安装了哪些 Skill、禁用了哪些、以及自定义 Skill 的完整定义：

```json
{
  "installed_ids": ["sk1", "sk3", "cs1", "bi1", "bi2"],
  "disabled_ids": ["sk3"],
  "custom_skills": [
    {
      "skill_id": "cs1",
      "skill_name": "我的代码风格",
      "description": "遵循团队 ESLint 配置的代码风格",
      "category": "自定义",
      "icon": "✨",
      "source": "custom",
      "prompt": "\n## Skill: 我的代码风格\n请严格遵循以下规则:\n- 使用 2 空格缩进\n- 单引号优先\n- 行尾不加分号\n- 每行不超过 100 字符\n"
    }
  ]
}
```

**字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `installed_ids` | string[] | 用户已安装的所有 Skill ID（含 Hub、Custom、Builtin） |
| `disabled_ids` | string[] | 已安装但临时禁用的 Skill ID 子集 |
| `custom_skills` | object[] | 用户自建/上传的 Skill 完整定义 |

> **设计要点：** `disabled_ids` 是 Skill 特有的概念——MCP 中没有，因为 MCP 的启用/禁用在每个 server 的 `enabled` 字段控制。Skill 更简单：安装后默认启用，用户可选择禁用而不卸载。

#### 3.4.2 配置层级：会话级 vs 消息级

```
配置层级（越下层优先级越高）：

┌── skill_state_{user_id}.json（用户级默认安装/启用状态）      ← 最底层
│   定义了用户安装了哪些 Skill、哪些被禁用
│
├── Session.default_skill_ids（会话级默认）                   ← 中间层
│   POST /sessions 或 PATCH /sessions/{id} 可指定
│   决定该会话默认激活哪些 Skill（新增字段）
│
├── Message.skill_invocations（消息级覆盖）                    ← 最顶层
│   POST /messages 时传入（已在 MessageCreate 模型中定义）
│   不为空时，仅使用列表中指定的 Skill
│
└── SkillRegistry.get_active_prompts() 解析逻辑：
    msg.skill_invocations 非空 → 仅使用消息级列表
    否则 session.default_skill_ids 非空 → 使用会话级列表
    否则 → 使用所有已安装且未禁用的 Skill
```

> **设计原理：** 与 MCP 配置层级完全一致。会话级默认保证同一任务的历史消息有稳定的 Skill 集；消息级覆盖允许单次请求临时调整（如"这次不要用代码审查模式"）。Skill 在消息入队时锁定配置，后续变更不影响历史消息。

#### 3.4.3 凭据管理

Skill 不需要凭据管理。Skill 只包含纯文本 prompt，不涉及 API key、token、密码等敏感信息。这是 Skill 比 MCP 简单的又一个根本原因。

### 3.5 Skill 发现与注册

#### 3.5.1 启动加载流程

与 MCP 需要 `tools/list` 网络调用不同，Skill 的"发现"就是启动时读文件：

```
  ┌─ SkillRegistry.__init__() ──────────────────────────────────┐
  │                                                               │
  │  1. 加载 skill-hub.json → hub_skills: dict[id, SkillDef]      │
  │  2. 加载 skill_state_{user_id}.json → 用户安装/禁用状态       │
  │  3. 合并 custom_skills 到 lookup                              │
  │  4. 添加 builtin skills (硬编码) → 注入 lookup                 │
  │                                                               │
  │  结果: registry._skills = {                                   │
  │    "sk1": SkillDefinition(...),  # 来自 Hub                   │
  │    "sk2": SkillDefinition(...),  # 来自 Hub                   │
  │    "cs1": SkillDefinition(...),  # 来自 Custom                │
  │    "bi1": SkillDefinition(...),  # 内置 (office)              │
  │    "bi2": SkillDefinition(...),  # 内置 (code)                │
  │  }                                                            │
  │                                                               │
  │  registry._installed = {"sk1", "cs1", "bi1", "bi2"}          │
  │  registry._disabled = {"sk2"}                                 │
  │                                                               │
  └───────────────────────────────────────────────────────────────┘
```

**SkillRegistry 核心实现：**

```python
class SkillDefinition(BaseModel):
    """Skill 的完整定义。核心是 prompt 字段。"""
    skill_id: str
    skill_name: str
    description: str
    prompt: str                          # 注入 system prompt 的文本
    version: str = "1.0.0"
    category: str = ""
    icon: str = ""
    author: str = ""
    tags: list[str] = Field(default_factory=list)
    source: Literal["hub", "custom", "builtin"] = "hub"


class SkillRegistry:
    """管理所有已知 Skill（Hub + Custom + Builtin）的内存注册表。"""

    def __init__(self, hub_path: Path, state_path: Path, user_id: str):
        self._skills: dict[str, SkillDefinition] = {}
        self._installed: set[str] = set()
        self._disabled: set[str] = set()
        self.user_id = user_id
        self._load(hub_path, state_path)

    def _load(self, hub_path: Path, state_path: Path):
        hub = _load_json(hub_path) if hub_path.exists() else {"skills": []}
        state = _load_json(state_path) if state_path.exists() else {}

        # Hub skills
        for s in hub.get("skills", []):
            self._skills[s["skill_id"]] = SkillDefinition(**s, source="hub")

        # Custom skills from user state
        for s in state.get("custom_skills", []):
            self._skills[s["skill_id"]] = SkillDefinition(**s, source="custom")

        # Builtin skills (hardcoded)
        for s in BUILTIN_SKILLS:
            self._skills[s.skill_id] = s

        # User state
        self._installed = set(state.get("installed_ids", []))
        self._disabled = set(state.get("disabled_ids", []))
        # Builtins are always installed
        self._installed.update(s.skill_id for s in BUILTIN_SKILLS)

    def get_active_prompts(self, skill_ids: list[str] | None) -> str:
        """将 skill_id 列表解析为拼接后的 prompt 文本。"""
        if skill_ids is not None:
            ids = [sid for sid in skill_ids
                   if sid in self._skills and sid not in self._disabled]
        else:
            ids = [sid for sid in self._installed
                   if sid not in self._disabled]

        parts = []
        for sid in ids:
            skill = self._skills.get(sid)
            if skill:
                parts.append(f"\n## Skill: {skill.skill_name}\n{skill.prompt}")
        return "\n".join(parts)

    def get_available_for_picker(self) -> list[SkillDefinition]:
        """返回 / 选择器所需的 Skill 列表（已安装 + 未禁用）。"""
        return [self._skills[sid] for sid in self._installed
                if sid not in self._disabled and sid in self._skills]

    def install(self, skill_id: str):
        """安装 Skill（纯状态更新）。"""
        if skill_id not in self._skills or self._skills[skill_id].source == "builtin":
            raise ValueError(f"无法安装 Skill: {skill_id}")
        self._installed.add(skill_id)

    def uninstall(self, skill_id: str):
        """卸载 Skill（纯状态更新）。"""
        if self._skills[skill_id].source == "builtin":
            raise ValueError(f"内置 Skill 不可卸载: {skill_id}")
        self._installed.discard(skill_id)
        self._disabled.discard(skill_id)
```

#### 3.5.2 Skill ID 命名规则

```
skill-hub.json 条目      →  skill_id: "sk1", "sk2", "sk3", ...
custom_skills 条目       →  skill_id: "cs1", "cs2", "cs3", ... (自动分配)
内置 Skill               →  skill_id: "bi1", "bi2", ...
```

Hub 和 Custom 的 ID 空间独立自增，互不冲突。

#### 3.5.3 合并到 LLM 上下文

对应 `server/engine/context.py` ——构建 LLM 上下文时，在 system prompt 末尾追加激活的 Skill prompt 片段：

```python
# context.py - ContextManager.build() 增强

async def build(
    self, session_id, turn, mode, scene_mode,
    client_tools=None,
    mcp_tools=None,
    skill_ids=None,              # 新增
    skill_registry=None,         # 新增
):
    history = self._contexts.get(session_id, [])
    system = SYSTEM_PROMPTS.get(scene_mode, SYSTEM_PROMPTS["office"])
    system += MODE_PROMPTS.get(mode, "")

    # ── Skill prompt 注入 ── 新增
    if skill_registry:
        skill_prompts = skill_registry.get_active_prompts(skill_ids)
        if skill_prompts:
            system += "\n\n## 激活的技能\n" + skill_prompts

    # ... rest unchanged ...
```

**冲突处理：** Skill prompt 追加在 scene/system prompt 之后、用户消息之前。同一 Skill 被会话级和消息级同时指定时，消息级优先。Skill 之间不存在命名冲突——不同 Skill 的 prompt 是独立的文本块，按 `## Skill: {name}` 分隔。

### 3.6 Skill Prompt 注入

#### 3.6.1 注入时机与流程

Skill 的"执行"本质是在 `ContextManager.build()` 中同步完成的一次字符串拼接：

```
QueryLoopEngine._run_message_loop()
        │
        ├── 1. 解析 skill_ids:
        │      if msg.skill_invocations:
        │          skill_ids = [s.skill_id for s in msg.skill_invocations]
        │      elif session.default_skill_ids:
        │          skill_ids = session.default_skill_ids
        │      else:
        │          skill_ids = None   # → 使用所有已启用
        │
        ├── 2. context_mgr.build(skill_ids=..., skill_registry=...)
        │      └── system += skill_registry.get_active_prompts(skill_ids)
        │
        ├── 3. llm.stream(system=augmented_prompt, tools=...)
        │      └── LLM 看到的是已包含 Skill 行为引导的完整 system prompt
        │
        └── 4. 后续流程无任何变化：
               tool_use → _execute_tool_chunk → dispatch
               text → _push_chunk("agent.text")
```

#### 3.6.2 system prompt 组装顺序

```
完整的 system prompt 组装顺序:
  1. SYSTEM_PROMPTS[scene_mode]     ← "你是 iWork，一个 AI 编程助手..."
  2. MODE_PROMPTS[mode]             ← "模式：build。当前处于构建模式..."
  3. Skill prompts（逐个拼接）       ← "\n## Skill: 代码审查\n你正在扮演一位资深..."
                                    ← "\n## Skill: 文档生成器\n你是技术文档专家..."
```

每个 Skill 的 prompt 前加 `## Skill: {skill_name}` 作为标题，使 LLM 能识别不同的行为指导来源。

#### 3.6.3 无流数据块

Skill 注入不产生任何 `StreamChunk`。它不涉及工具调用，不等待客户端回传，不影响流中断恢复逻辑。对客户端而言，Skill 的使用完全透明——前端只需在消息发送时携带 `skill_invocations`，其余行为全部体现在 LLM 的回复内容中。

#### 3.6.4 与 MCP 工具执行的对比

```
MCP 工具执行链路:
  LLM → tool_use("github.search_issues")
      → ToolDispatcher.classify() → SERVER
      → dispatch() → transport.request("tools/call")
      → [子进程执行...]
      → agent.tool_result → 注入上下文
  前端必须渲染 tool_call → tool_result 状态变化

Skill Prompt 注入链路:
  context.build() → skill_registry.get_active_prompts()
      → 字符串拼接 → llm.stream(system=augmented_prompt)
  前端完全透明，无任何流数据块
```

### 3.7 错误处理

Skill 无运行时连接，所有错误都发生在**启动加载**或**install/uninstall 请求**期间。不存在重试、不存在超时、不存在重连。

#### 3.7.1 错误分类

| # | 场景 | 触发条件 | 处理方式 | LLM 影响 |
|---|------|---------|---------|---------|
| S1 | **Skill 定义 JSON 格式错误** | `skill-hub.json` 或 `custom_skills` 条目非法 | 记录错误日志，跳过该条目，继续加载其余 Skill | 该 Skill 不可用 |
| S2 | **skill_id 未找到** | `skill_invocations` 引用了不存在的 ID | 记录警告日志，跳过未知 ID，注入其余 Skill | 缺失的 Skill 静默忽略 |
| S3 | **prompt 为空或过短**（< 10 字符） | Skill 定义不完整 | 加载时记录警告，标记为不可用 | 该 Skill 不可用 |
| S4 | **skill_state.json 损坏** | 文件被外部破坏 | 记录错误，回退到空状态（所有 Hub/Custom Skill 视为未安装） | 仅内置 Skill 有效 |
| S5 | **重复 skill_id**（Hub 和 Custom 重复） | 同名 ID 冲突 | Custom 覆盖 Hub（记录的优先级规则） | Custom 版本生效 |
| S6 | **skill-hub.json 文件缺失** | 服务端未配置 Hub | Hub 目录为空，仅 Custom + Builtin 可用 | Hub 标签页为空 |

#### 3.7.2 全量 Level 2（降级）处理

Skill 的所有错误都是 Level 2（对应第 1 章 1.8.2 的四级处理策略）。Skill 永远不会导致任务终止——它只是辅助性的行为引导。如果某个 Skill 加载失败或定义缺失，引擎静默跳过，不会推送 `message.error` 或 `system.status`。

**Skill 不需要以下 MCP 级别的处理：**
- 重试（没有连接可重试）
- `system.status` 通知（没有运行时状态变化）
- 终止（Skill 缺失不是致命错误）
- 权限检查（Skill 不访问文件系统或网络）

#### 3.7.3 安装态错误

| 场景 | HTTP 状态码 | 说明 |
|------|-----------|------|
| 安装不存在的 Hub Skill | 404 | Hub 中无此 skill_id |
| 重复安装 | 409 | 已安装 |
| 卸载内置 Skill | 403 | 内置 Skill 不可卸载 |
| 卸载/禁用未安装的 Skill | 404 | 未安装 |
| Custom Skill validation 失败 | 422 | prompt 过短、name 为空等 |

### 3.8 Skill 管理（Hub）

#### 3.8.1 Hub 数据来源

Hub 数据以 JSON 配置文件形式存储于服务端 `server/skill-hub.json`，管理员可直接编辑此文件增删条目。客户端通过 API 获取可安装的 Skill 列表。

每条 Hub 条目包含完整的 Skill 定义，客户端用于展示和安装：

```json
{
  "skill_id": "sk1",
  "skill_name": "代码审查",
  "description": "以资深代码审查员视角分析代码，关注安全性、性能和可维护性",
  "icon": "🔍",
  "category": "开发",
  "version": "1.2.0",
  "author": "iWork Team",
  "tags": ["code", "review", "security"]
}
```

> 注意：Hub 列表 API 响应中**不包含 `prompt` 字段**，仅安装后才可获取完整定义。

#### 3.8.2 安装 / 卸载流程

安装/卸载状态持久化在 `server/storage/skill_state_{user_id}.json`：

```
安装:
  用户点击 [安装]
  → POST /skills/install  Body: {skill_id: "sk1"}
  → 校验 skill_id 在 Hub 中存在
  → 写入 skill_state_{user_id}.json 的 installed_ids
  → SkillRegistry.install(skill_id)  更新内存注册表
  → 返回 200: {installed: true, skill_id: "sk1"}
  → 重复安装返回 409

卸载:
  用户点击 [已安装]
  → DELETE /skills/uninstall/{skill_id}
  → 从 skill_state_{user_id}.json 的 installed_ids 和 disabled_ids 中移除
  → SkillRegistry.uninstall(skill_id)  更新内存注册表
  → 返回 200: {uninstalled: true, skill_id: "sk1"}
  → 未安装返回 404，内置返回 403
```

> **与 MCP 的核心区别：** MCP 安装时触发 `connect_server()` 启动子进程，卸载时触发 `disconnect_server()` 关闭子进程。Skill 的安装/卸载是纯 JSON 文件写入，无任何运行时操作。

#### 3.8.3 启用 / 禁用

Skill 可以在不卸载的情况下临时禁用：

```
禁用:
  → POST /skills/disable  Body: {skill_id: "sk3"}
  → 写入 disabled_ids
  → Skill 保留在 installed_ids 中，但 / 选择器中移除、prompt 不再注入

启用:
  → POST /skills/enable  Body: {skill_id: "sk3"}
  → 从 disabled_ids 中移除
  → Skill 重新出现在 / 选择器中
```

MCP 使用每个 server 配置中的 `enabled: true/false` 字段来控制启停，而 Skill 使用独立的 `disabled_ids` 列表。这是两种等价的实现方式，选择独立列表是为了让 `installed_ids` 保持为纯粹的"已安装"语义。

#### 3.8.4 自定义 Skill

用户可通过三种方式创建自定义 Skill：

1. **上传 `.skill.json` 文件**：服务端验证 Schema，自动分配 `skill_id = cs{N+1}`，写入 `custom_skills` 并自动安装
2. **从 UI 表单创建**：弹窗填写 name、description、prompt，提交后验证并持久化
3. **从 Hub 克隆**：安装 Hub Skill 后"另存为自定义"，复制其 prompt 并允许修改

删除自定义 Skill 时同时从 `custom_skills`、`installed_ids` 和 `disabled_ids` 中移除。

#### 3.8.5 与主对话流程的联通

Skill 通过以下字段与主对话流程打通，**无需新增消息级 API**（`skill_invocations` 已存在）：

```
POST /sessions         body.default_skill_ids    → 会话级默认 Skill（新增字段）
PATCH /sessions/{id}   body.default_skill_ids    → 更新会话默认（新增字段）
POST /messages         body.skill_invocations    → 消息级 Skill（已在 MessageCreate.skill_invocations 定义）
```

`Session` 模型需新增可选字段 `default_skill_ids: list[str] | None`。

### 3.9 Skill 查询接口定义

所有 Skill 管理接口挂载在 `/skills` 前缀下，由 `server/api/skill_routes.py` 实现。

| 方法 + 路径 | 说明 | 持久化 |
|------------|------|--------|
| `GET /skills/hub` | 浏览 Hub 中所有可安装的 Skill | 读取 `skill-hub.json` |
| `GET /skills/installed` | 查看已安装的 Skill（含启用/禁用状态） | 读取 `skill_state_{user_id}.json` + Hub |
| `POST /skills/install` | 安装 Hub 中的 Skill | 写入 installed_ids |
| `DELETE /skills/uninstall/{skill_id}` | 卸载已安装的 Skill | 移除 installed_ids + disabled_ids |
| `POST /skills/enable` | 启用已安装的 Skill | 从 disabled_ids 移除 |
| `POST /skills/disable` | 禁用已安装的 Skill | 写入 disabled_ids |
| `GET /skills/custom` | 查看自定义 Skill 列表 | 读取 custom_skills |
| `POST /skills/custom` | 创建自定义 Skill（自动分配 ID + 自动安装） | 追加 custom_skills + installed_ids |
| `PUT /skills/custom/{skill_id}` | 更新自定义 Skill（部分字段） | 修改 custom_skills 条目 |
| `DELETE /skills/custom/{skill_id}` | 删除自定义 Skill（同步卸载） | 移除 custom_skills + installed_ids + disabled_ids |

```typescript
// ═══════════════════════════════════════════
// GET /skills/hub — 浏览 Hub 所有可安装的 Skill
// ═══════════════════════════════════════════

Response 200:
{
  skills: {
    skill_id: string;         // "sk1"
    skill_name: string;       // "代码审查"
    description: string;      // "以资深代码审查员视角分析代码..."
    version: string;          // "1.2.0"
    category: string;         // "开发"
    icon: string;             // "🔍"
    author: string;           // "iWork Team"
    tags: string[];           // ["code", "review", "security"]
    // prompt 字段不返回——Hub 列表不暴露完整提示词
  }[];
}


// ═══════════════════════════════════════════
// GET /skills/installed — 查看已安装的 Skill
// ═══════════════════════════════════════════

Response 200:
{
  installed: {
    skill_id: string;
    skill_name: string;
    description: string;
    icon: string;
    category: string;
    source: "hub" | "custom" | "builtin";
    enabled: boolean;         // true 除非在 disabled_ids 中
    prompt: string;           // 已安装的 Skill 返回完整 prompt
  }[];
}


// ═══════════════════════════════════════════
// POST /skills/install — 安装 Hub 中的 Skill
// ═══════════════════════════════════════════

Request Body:
{ skill_id: string; }         // 必须存在于 Hub 中

Response 200:
{ installed: true; skill_id: string; }

// 409 — 已安装
{ detail: "技能已安装: sk1"; }

// 404 — Hub 中不存在
{ detail: "Hub 中不存在技能: xxx"; }


// ═══════════════════════════════════════════
// DELETE /skills/uninstall/{skill_id} — 卸载 Skill
// ═══════════════════════════════════════════

Response 200:
{ uninstalled: true; skill_id: string; }

// 403 — 内置 Skill 不可卸载
{ detail: "内置技能不可卸载: bi1"; }

// 404 — 未安装
{ detail: "未安装该技能: xxx"; }


// ═══════════════════════════════════════════
// POST /skills/enable & POST /skills/disable
// ═══════════════════════════════════════════

Request Body:
{ skill_id: string; }

Response 200:
{ enabled: true; skill_id: string; }
// 或
{ disabled: true; skill_id: string; }

// 404 — 未安装
{ detail: "未安装该技能: xxx"; }


// ═══════════════════════════════════════════
// GET /skills/custom — 查看自定义 Skill 列表
// ═══════════════════════════════════════════

Response 200:
{
  custom: {
    skill_id: string;          // 自动生成 "cs1", "cs2", ...
    skill_name: string;
    description: string;
    icon: string;              // 默认 "✨"
    category: string;          // 默认 "自定义"
    prompt: string;
    created_at: string;
    updated_at: string;
  }[];
}


// ═══════════════════════════════════════════
// POST /skills/custom — 创建自定义 Skill
// ═══════════════════════════════════════════

Request Body:
{
  skill_name: string;          // 必填，最大 100 字符
  description?: string;        // 默认 ""
  icon?: string;               // 默认 "✨"
  prompt: string;              // 必填，最小 10 字符
  category?: string;           // 默认 "自定义"
}
// skill_id 由服务端自动生成（cs + 自增序号），创建后自动安装

Response 201:
{
  skill_id: "cs2";
  skill_name: string;
  description: string;
  icon: string;
  category: string;
  prompt: string;
  created_at: string;
}

// 422 — 验证失败
{ detail: "prompt 不能少于 10 个字符"; }


// ═══════════════════════════════════════════
// PUT /skills/custom/{skill_id} — 更新自定义 Skill
// ═══════════════════════════════════════════

Request Body:
{
  skill_name?: string;
  description?: string;
  icon?: string;
  prompt?: string;
  category?: string;
}
// 部分更新：仅传入的字段生效

Response 200:
{ updated: true; skill_id: string; }

// 404 — 自定义 Skill 不存在
{ detail: "自定义技能不存在: xxx"; }


// ═══════════════════════════════════════════
// DELETE /skills/custom/{skill_id} — 删除自定义 Skill
// ═══════════════════════════════════════════

Response 200:
{ deleted: true; skill_id: string; }

// 404 — 不存在
{ detail: "自定义技能不存在: xxx"; }
```

### 3.10 与 Query Loop 引擎的集成点总结

Skill 在第 1 章 Query Loop 引擎架构中的注入位置：

```
QueryLoopEngine
│
├── EngineManager.get_or_create(session_id, user_id)
│   └── skill_registry = SkillRegistry(hub_path, state_path, user_id)   ← 新增
│       (纯内存加载，同步完成，无异步，无进程管理)
│
├── _run_message_loop()
│   │
│   ├── skill_ids 解析:
│   │     msg.skill_invocations → session.default_skill_ids → None    ← 新增
│   │
│   ├── context_mgr.build()
│   │   └── system += skill_registry.get_active_prompts(skill_ids)    ← 新增
│   │   └── tools = [client_tools] + [mcp_tools]                      ← 现有逻辑不变
│   │
│   ├── llm.stream(system=augmented_prompt, tools=...)                 ← 现有逻辑不变
│   │
│   └── _execute_tool_chunk() → 无任何变化                              ← 现有逻辑不变
│
├── _push_chunk() → agent.text / agent.tool_result / ...               ← 现有逻辑不变
│   (Skill 注入不产生任何新的流数据块)
│
└── context_mgr.append_tool_result()                                   ← 现有逻辑不变
```

**需要变更的组件：**

| 组件 | 变更内容 | 复杂度 |
|------|---------|--------|
| `EngineManager.__init__()` | 接受 `skill_registry: SkillRegistry` 参数 | 低 |
| `QueryLoopEngine.__init__()` | 存储 `self._skill_registry` | 低 |
| `QueryLoopEngine._run_message_loop()` | 在 `context.build()` 前添加 `skill_ids` 解析 | 中 |
| `ContextManager.build()` | 接受 `skill_ids` + `skill_registry` 参数，追加 Skill prompt | 中 |
| `QueryLoopEngine.enqueue()` | 已透传 `skill_invocations`（`query_loop.py` L270），无需变更 | 无 |
| `main.py` lifespan | 初始化 `SkillRegistry`，传入 `EngineManager` | 低 |
| `server/models/session.py` | `Session` 模型新增可选字段 `default_skill_ids` | 低 |
| `server/models/message.py` | 已有 `SkillInvocation`，新增 `SkillDefinition` 等 API 模型 | 中 |

**服务启动时机：** Skill 的注册表初始化在 `main.py` lifespan 中同步执行（读两个 JSON 文件），无需预连接、无需异步等待。与 MCP 需要 `_auto_connect_installed_mcps()` 启动所有子进程截然不同。

**流数据块：** Skill 注入不产生任何新的 `StreamChunk` 类型。客户端无需做任何特殊处理——Skill 的行为效果完全体现在 LLM 生成的文本和工具调用中。

---

> **下一节**：上下文管理系统（待用户确认本节省后继续展开）
