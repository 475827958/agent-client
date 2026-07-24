# 客户端安装 MCP 和 Skill — 架构调整

## Context

当前 MCP 服务和 Skill 脚本都在服务端安装和执行，导致无法操作客户端本地文件。
目标：服务端保持 Catalog（目录），真正的安装和执行下沉到客户端。

## 整体流程

```
1. 客户端浏览 Catalog
   GET /skills/hub  →  查看可用 Skill 列表
   GET /mcp/hub    →  查看可用 MCP 列表

2. 客户端安装 Skill
   POST /skills/install  →  服务端登记 + 返回 zip
                         →  客户端解压到 ~/.iwork/skills/{name}/

3. 客户端安装 MCP
   POST /mcp/install  →  服务端登记 + 返回配置（command/url/transport）
                      →  客户端按 transport 类型建立连接
                      →  客户端 tools/list 发现工具
                      →  POST /sessions/{id}/mcp/tools 上报工具清单

4. LLM 运行时调用
   LLM 调用 skill / mcp_xxx 工具
   →  服务端推送 client.tool_request
   →  客户端本地执行（读 SKILL.md / 转发 MCP 进程）
   →  POST /tool-result 回传结果

5. 卸载
   DELETE /skills/uninstall/{id}  →  服务端移除登记，客户端保留本地文件
   DELETE /mcp/uninstall/{id}     →  服务端移除登记，客户端断开连接、上报空工具列表
```

## 改动

### 一、Skill — 改造安装接口，返回文件

**`server/api/skill_routes.py`** — 改造 `POST /skills/install`

- 现有逻辑：服务端安装（写 `skill_state.json`）
- 新增：响应中附带 skill 目录的 zip 包（Content-Type: application/zip），客户端解压到 `~/.iwork/skills/{skill_name}/`
- 客户端一次调用完成：服务端登记 + 本地文件下载
- 客户端下载后拥有完整 skill 目录：`SKILL.md` + `scripts/` + `references/`
- `scripts/` 由 LLM 通过 `bash`（客户端工具）在本地执行
- `SKILL.md` 的加载也走客户端：
  - **Preloading**：用户输入 `/pdf` → 客户端先读本地 `~/.iwork/skills/pdf/SKILL.md`，把内容附在消息里发给服务端 → 服务端注入上下文
  - **On-demand**（`skill` 工具）：LLM 调用 `skill("pdf")` → 服务端推送 `client.tool_request` → 客户端读本地 `~/.iwork/skills/pdf/SKILL.md` → 返回内容注入上下文

### 二、MCP — 改造安装接口，返回配置 + 新增工具上报端点

**2.1 `server/api/mcp_routes.py`** — 改造 `POST /mcp/install`

- 现有逻辑：服务端登记（写 `mcp_state.json`）
- 新增：响应中返回 MCP 的完整配置，客户端根据 `transport` 类型处理：

**stdio（npx 子进程）：**
```json
{
  "server_id": "mh6",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "hefeng-mcp-server"],
  "env": {"HEFENG_API_KEY": "${HEFENG_API_KEY}"}
}
```
客户端 spawn 子进程，通过 stdin/stdout 做 JSON-RPC 通信。

**streamable-http：**
```json
{
  "server_id": "mh9",
  "transport": "streamable-http",
  "url": "https://mcp.map.baidu.com/mcp?ak=${BAIDU_MAP_AK}",
  "headers": {}
}
```
客户端直接 HTTP POST JSON-RPC，不需要 spawn 进程。

**sse：**
```json
{
  "server_id": "mh10",
  "transport": "sse",
  "url": "https://mcp.example.com/sse",
  "headers": {}
}
```
客户端先 GET 建立 SSE 连接获取 endpoint，再 POST JSON-RPC。

- `${VAR}` 占位符由客户端用本地环境变量替换
- 客户端一次调用完成：服务端登记 + 获取配置 → 按 transport 类型启动本地连接

**2.2 `server/api/routes.py`** — 新增 `POST /sessions/{id}/mcp/tools`

客户端发现 MCP 工具后上报，body：
```json
{
  "server_id": "mh6",
  "tools": [
    {"name": "get_weather", "description": "...", "input_schema": {...}}
  ]
}
```
服务端存储到 `Session.client_mcp_tools` 字段，后续 LLM 上下文中这些工具名前缀 `{server_id}_`，执行位置标记为 CLIENT。

**2.3 `server/models/session.py`** — `Session` 新增字段

- `client_mcp_tools: list[dict]` — 客户端上报的 MCP 工具清单
- `SessionUpdate` 无需新增字段（MCP 工具走专用端点）

### 三、卸载流程

**Skill 卸载 — `DELETE /skills/uninstall/{skill_id}`**

服务端：
- 从 `skill_state.json` 的 `installed_ids` 中移除
- 响应返回 `{success: true}`

客户端：
- 收到 200 后不删本地文件，仅标记为已卸载
- 下次构建上下文时该 skill 不再出现在 `<available_skills>` 中
- 重新安装时无需重复下载（本地已有）

**MCP 卸载 — `DELETE /mcp/uninstall/{server_id}`**

服务端：
- 从 `mcp_state.json` 的 `installed_ids` 中移除
- 清理 Session 中该 server 的工具列表

客户端：
- 收到 200 后断开与 MCP 服务的连接：stdio → kill 子进程，streamable-http → 关闭 HTTP client，sse → 关闭 SSE + HTTP client
- 调用 `POST /sessions/{id}/mcp/tools` 上报空工具列表（`tools: []`）
- 不删本地配置/二进制，重新安装时直接复用

### 四、引擎 — 工具执行路由调整

**`server/engine/query_loop.py`**

- `skill` 工具从服务端自执行改为 CLIENT：加入 `CLIENT_TOOLS` 集合，走 `client.tool_request` 路径
- 移除 `_execute_skill_tool()` 方法（服务端不再读取 SKILL.md）
- MCP 工具（客户端上报的）归类为 CLIENT，走 `client.tool_request`

**`server/tools/dispatcher.py`**

- `CLIENT_TOOLS` 集合新增 `"skill"`

### 五、启动行为 — 服务端不再启动任何 MCP 进程

**`server/main.py`** — 移除 `_auto_connect_installed_mcps()`

所有 MCP（stdio / HTTP / SSE）统一由客户端 spawn。服务端不再启动任何 MCP 子进程，`mcp_state.json` 只记录安装状态。

### 六、mcp_state.json 不变

保持现有结构，无需新增字段：
```json
{
  "installed_ids": ["mh6", "mh8", "mh9", "mh10"],
  "custom_servers": []
}
```

## 接口定义

### Skill 安装 — `POST /skills/install`

**Request:**
```json
{
  "skill_id": "sk6"
}
```

**Response (200):**
```
Content-Type: application/zip
Content-Disposition: attachment; filename="pdf.zip"
```
Body 为 skill 目录的 zip 包，包含 `SKILL.md` + `scripts/` + `references/`。

**Response (404):**
```json
{ "error": "not_found", "message": "skill_id 不在 hub 中" }
```

**Response (409):**
```json
{ "error": "already_installed", "message": "该 skill 已安装" }
```

---

### Skill 卸载 — `DELETE /skills/uninstall/{skill_id}`

**Request:** 无 Body

**Response (200):**
```json
{ "success": true }
```

**Response (404):**
```json
{ "error": "not_found", "message": "skill 不存在" }
```

---

### MCP 安装 — `POST /mcp/install`

**Request:**
```json
{
  "server_id": "mh6"
}
```

**Response (200):**

根据 `transport` 类型返回不同格式：

*stdio:*
```json
{
  "server_id": "mh6",
  "server_name": "和风天气 MCP",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "hefeng-mcp-server"],
  "env": { "HEFENG_API_KEY": "${HEFENG_API_KEY}" }
}
```

*streamable-http:*
```json
{
  "server_id": "mh9",
  "server_name": "百度地图 MCP",
  "transport": "streamable-http",
  "url": "https://mcp.map.baidu.com/mcp?ak=${BAIDU_MAP_AK}",
  "headers": {}
}
```

*sse:*
```json
{
  "server_id": "mh10",
  "server_name": "12306 MCP",
  "transport": "sse",
  "url": "https://mcp.example.com/sse",
  "headers": {}
}
```

**Response (404):**
```json
{ "error": "not_found", "message": "server_id 不在 hub 中" }
```

**Response (409):**
```json
{ "error": "already_installed", "message": "该 MCP 已安装" }
```

---

### MCP 卸载 — `DELETE /mcp/uninstall/{server_id}`

**Request:** 无 Body

**Response (200):**
```json
{ "success": true }
```

**Response (404):**
```json
{ "error": "not_found", "message": "MCP 不存在" }
```

---

### MCP 工具上报 — `POST /sessions/{id}/mcp/tools`

客户端 spawn MCP 进程、完成 `tools/list` 后调用。

**Request:**
```json
{
  "server_id": "mh6",
  "tools": [
    {
      "name": "get_weather",
      "description": "查询指定城市的天气信息",
      "input_schema": {
        "type": "object",
        "properties": {
          "city": { "type": "string", "description": "城市名称" }
        },
        "required": ["city"]
      }
    }
  ]
}
```

卸载时上报空列表：
```json
{
  "server_id": "mh6",
  "tools": []
}
```

**Response (200):**
```json
{ "received": true, "tool_count": 1 }
```

---

## 不影响的部分

- `mcp-hub.json` 和 `skill-hub.json` 不变，仍是服务端 Catalog
- `GET /skills/hub`、`GET /mcp/hub` 不变
- LLM 上下文构建逻辑不变，工具合并方式不变
- `client.tool_request` → `POST /tool-result` 链路不变，MCP 工具复用

## 验证

1. `POST /skills/install {"skill_id": "sk6"}` 响应包含 zip 文件，解压后有 SKILL.md + scripts/
2. `POST /mcp/install {"server_id": "mh6"}` 响应包含完整配置，客户端据此 spawn 子进程
3. 客户端本地 `npx -y hefeng-mcp-server` → tools/list → `POST /sessions/{id}/mcp/tools` 上报
4. LLM 调用 `mh6_get_weather` → 服务端推送 `client.tool_request` → 客户端执行 → 回传结果
