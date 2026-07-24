var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
(function() {
  var Module = require("module");
  var _resolveFilename = Module._resolveFilename;
  Module._resolveFilename = function(request, parent) {
    if (request === "electron") {
      try {
        var res = _resolveFilename.call(this, request, parent);
        var cached = require.cache[res];
        if (cached && typeof cached.exports === "string") {
          delete require.cache[res];
        }
        var loaded = require(res);
        if (typeof loaded === "string") {
          try {
            return _resolveFilename.call(this, "electron/js2c/browser_init", parent);
          } catch (e2) {
          }
        }
        return res;
      } catch (e) {
        try {
          return _resolveFilename.call(this, "electron/js2c/browser_init", parent);
        } catch (e2) {
        }
        return _resolveFilename.call(this, request, parent);
      }
    }
    return _resolveFilename.call(this, request, parent);
  };
})();
"use strict";
const electron = require("electron");
const path = require("path");
const promises = require("fs/promises");
const fs = require("fs");
const child_process = require("child_process");
const util = require("util");
const Store = require("electron-store");
const readline = require("readline");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const readline__namespace = /* @__PURE__ */ _interopNamespaceDefault(readline);
const execAsync = util.promisify(child_process.exec);
const execFileAsync = util.promisify(child_process.execFile);
function resolveShell() {
  if (process.platform !== "win32") return "/bin/bash";
  const gitBashPaths = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe"
  ];
  for (const p of gitBashPaths) {
    if (fs.existsSync(p)) return p;
  }
  return "cmd.exe";
}
function decodeBuffer(buf) {
  if (!buf) return "";
  if (typeof buf === "string") return buf;
  if (buf.length === 0) return "";
  if (process.platform !== "win32") return buf.toString("utf8");
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  const utf8Bad = (utf8.match(/�/g) || []).length;
  if (utf8Bad < utf8.length * 0.05) return utf8;
  try {
    const gbk = new TextDecoder("gbk", { fatal: false }).decode(buf);
    const gbkBad = (gbk.match(/�/g) || []).length;
    if (gbkBad < gbk.length * 0.05) return gbk;
  } catch {
  }
  return utf8;
}
function globToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "\0").replace(/\*/g, "[^/\\\\]*").replace(/\x00/g, "(.*/)?");
  return new RegExp(`^${escaped}$`);
}
async function globFiles(basePath, pattern) {
  const results = [];
  const regex = globToRegex(pattern);
  async function walk(dir) {
    try {
      const entries = await promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = fullPath.replace(basePath, "").replace(/^[/\\]/, "");
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".git") continue;
          await walk(fullPath);
        } else if (entry.isFile()) {
          if (regex.test(relativePath)) {
            results.push(relativePath);
          }
        }
      }
    } catch {
    }
  }
  await walk(basePath);
  return results;
}
function guardPath(workspaceRoot, targetPath) {
  const fullPath = path.resolve(workspaceRoot, targetPath);
  if (!fullPath.startsWith(path.resolve(workspaceRoot))) {
    throw new Error("Access outside workspace is not allowed");
  }
  return fullPath;
}
function registerFileOps(workspacePath) {
  const ws = () => {
    const p = workspacePath();
    if (!p) throw new Error("No workspace selected");
    return p;
  };
  electron.ipcMain.handle("file:glob", async (_event, pattern) => {
    return globFiles(ws(), pattern);
  });
  electron.ipcMain.handle("file:read", async (_event, filePath) => {
    return promises.readFile(guardPath(ws(), filePath), "utf-8");
  });
  electron.ipcMain.handle("file:write", async (_event, filePath, content) => {
    const fullPath = guardPath(ws(), filePath);
    await (await import("fs/promises")).mkdir(path.dirname(fullPath), { recursive: true });
    return promises.writeFile(fullPath, content, "utf-8");
  });
  electron.ipcMain.handle("file:edit", async (_event, filePath, oldStr, newStr) => {
    const fullPath = guardPath(ws(), filePath);
    const content = await promises.readFile(fullPath, "utf-8");
    if (!content.includes(oldStr)) throw new Error("old_string not found in file");
    return promises.writeFile(fullPath, content.replace(oldStr, newStr), "utf-8");
  });
  electron.ipcMain.handle("file:grep", async (_event, pattern, dirPath) => {
    const base = ws();
    const searchDir = guardPath(base, dirPath || ".");
    const results = [];
    const regex = new RegExp(pattern, "g");
    async function search(dir) {
      const entries = await promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".git") continue;
          await search(fullPath);
        } else if (entry.isFile()) {
          try {
            const content = await promises.readFile(fullPath, "utf-8");
            const lines = content.split("\n");
            const relativePath = fullPath.replace(base, "").replace(/^[/\\]/, "");
            lines.forEach((line, i) => {
              if (regex.test(line)) {
                results.push(`${relativePath}:${i + 1}: ${line.trim()}`);
              }
            });
          } catch {
          }
        }
      }
    }
    await search(searchDir);
    return results;
  });
  electron.ipcMain.handle("file:exec", async (_event, command, timeoutMs = 12e4) => {
    const cwd = path.resolve(ws());
    const timeout = Math.min(timeoutMs, 3e5);
    const maxBuffer = 10 * 1024 * 1024;
    const env = {
      ...process.env,
      HOME: cwd,
      USERPROFILE: cwd,
      LANG: "zh_CN.UTF-8",
      LC_ALL: "zh_CN.UTF-8"
    };
    try {
      let stdout;
      let stderr;
      const bashPath = resolveShell();
      if (process.platform === "win32" && bashPath.endsWith("bash.exe")) {
        const result = await execFileAsync(bashPath, ["-c", command], {
          cwd,
          timeout,
          maxBuffer,
          encoding: "buffer",
          env
        });
        stdout = result.stdout;
        stderr = result.stderr;
      } else {
        const result = await execAsync(command, {
          cwd,
          timeout,
          maxBuffer,
          shell: bashPath,
          encoding: "buffer",
          env
        });
        stdout = result.stdout;
        stderr = result.stderr;
      }
      return {
        stdout: decodeBuffer(stdout),
        stderr: decodeBuffer(stderr),
        exit_code: 0
      };
    } catch (err) {
      return {
        stdout: decodeBuffer(err.stdout),
        stderr: decodeBuffer(err.stderr),
        exit_code: err.code ?? 1
      };
    }
  });
  electron.ipcMain.handle("file:extractSkill", async (_event, base64Content, skillName) => {
    const fs2 = await import("fs/promises");
    const path2 = await import("path");
    const os = await import("os");
    const crypto = await import("crypto");
    const homeDir = os.homedir();
    const targetDir = path2.join(homeDir, ".iwork", "skills", skillName);
    await fs2.mkdir(targetDir, { recursive: true });
    const zipBuffer = Buffer.from(base64Content, "base64");
    const tmpDir = os.tmpdir();
    const zipName = `skill_${crypto.randomBytes(4).toString("hex")}.zip`;
    const zipPath = path2.join(tmpDir, zipName);
    await fs2.writeFile(zipPath, zipBuffer);
    const bashPath = resolveShell();
    try {
      await execFileAsync(bashPath, ["-c", `unzip -o "${zipPath}" -d "${targetDir}"`], {
        timeout: 3e4,
        maxBuffer: 10 * 1024 * 1024,
        encoding: "buffer"
      });
    } catch (err) {
      try {
        await fs2.unlink(zipPath);
      } catch {
      }
      throw new Error(`Failed to extract zip: ${decodeBuffer(err.stderr) || err.message}`);
    }
    try {
      await fs2.unlink(zipPath);
    } catch {
    }
    return targetDir;
  });
  electron.ipcMain.handle("workspace:select", async () => {
    const result = await electron.dialog.showOpenDialog({
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}
const defaults = {
  apiBaseUrl: "",
  apiKey: "",
  model: "deepseek-v4-pro",
  workspacePath: "",
  fullAccess: false
};
function registerSettings() {
  const store = new Store({ defaults });
  electron.ipcMain.handle("settings:save", async (_event, settings) => {
    store.set(settings);
  });
  electron.ipcMain.handle("settings:load", async () => {
    return store.store;
  });
  return {
    store,
    get: () => store.store
  };
}
function resolveEnv(value) {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || "");
}
function resolveEnvVars(env) {
  if (!env) return void 0;
  const resolved = {};
  for (const [k, v] of Object.entries(env)) {
    resolved[k] = resolveEnv(v);
  }
  return resolved;
}
class StdioConnection {
  constructor(config) {
    this.config = config;
  }
  process = null;
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  buffer = "";
  async connect() {
    const send = (req) => this.sendRpc(req);
    await this.spawnProcess();
    await this.initialize(send);
    return this.listTools(send);
  }
  spawnProcess() {
    return new Promise((resolve, reject) => {
      const command = this.config.command;
      const args = this.config.args || [];
      const env = {
        ...process.env,
        ...resolveEnvVars(this.config.env)
      };
      const child = child_process.spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env,
        shell: process.platform === "win32"
      });
      this.process = child;
      const rl = readline__namespace.createInterface({ input: child.stdout, crlfDelay: Infinity });
      rl.on("line", (line) => {
        try {
          const msg = JSON.parse(line);
          if (msg.id && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            p.resolve(msg);
          }
        } catch {
        }
      });
      let stderrLog = "";
      child.stderr?.on("data", (data) => {
        stderrLog += data.toString();
      });
      child.on("error", (err) => {
        reject(new Error(`Failed to spawn ${command}: ${err.message}`));
      });
      child.on("exit", (code, signal) => {
        if (code !== 0 && code !== null) {
          const errMsg = stderrLog.trim() || `Process exited with code ${code}`;
          for (const [, p] of this.pending) {
            p.reject(new Error(errMsg));
          }
          this.pending.clear();
        }
      });
      setTimeout(() => resolve(), 200);
    });
  }
  sendRpc(req) {
    return new Promise((resolve, reject) => {
      if (!this.process || this.process.killed) {
        reject(new Error("Process not running"));
        return;
      }
      const id = this.nextId++;
      const request = { ...req, id };
      this.pending.set(id, { resolve, reject });
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${req.method}`));
      }, 3e4);
      const origResolve = resolve;
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timeout);
          origResolve(v);
        },
        reject: (e) => {
          clearTimeout(timeout);
          reject(e);
        }
      });
      this.process.stdin.write(JSON.stringify(request) + "\n");
    });
  }
  async initialize(send) {
    const resp = await send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "agent-electron-app", version: "1.0.0" }
      }
    });
    if (resp.error) {
      throw new Error(`MCP initialize error: ${resp.error.message}`);
    }
    if (this.process && !this.process.killed) {
      this.process.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }) + "\n");
    }
  }
  async listTools(send) {
    const resp = await send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    });
    if (resp.error) {
      throw new Error(`tools/list error: ${resp.error.message}`);
    }
    const result = resp.result;
    return result?.tools || [];
  }
  async callTool(name, args) {
    const resp = await this.sendRpc({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/call",
      params: { name, arguments: args }
    });
    if (resp.error) {
      throw new Error(`tools/call error: ${resp.error.message}`);
    }
    return resp.result;
  }
  disconnect() {
    if (this.process && !this.process.killed) {
      this.process.kill();
      this.process = null;
    }
    for (const [, p] of this.pending) {
      p.reject(new Error("Connection closed"));
    }
    this.pending.clear();
  }
}
class HttpConnection {
  constructor(config) {
    this.config = config;
    this.endpoint = "";
    this.headers = {};
  }
  endpoint;
  nextId = 1;
  headers;
  async connect() {
    if (this.config.transport === "sse") {
      this.endpoint = await this.resolveSseEndpoint();
    } else {
      this.endpoint = resolveEnv(this.config.url || "");
    }
    this.headers = { "Content-Type": "application/json", ...this.config.headers || {} };
    const send = (req) => this.sendRpc(req);
    await this.initialize(send);
    return this.listTools(send);
  }
  async resolveSseEndpoint() {
    const url = resolveEnv(this.config.url || "");
    const response = await fetch(url, {
      headers: { Accept: "text/event-stream", ...this.config.headers || {} }
    });
    if (!response.ok) {
      throw new Error(`SSE connection failed: ${response.status}`);
    }
    const body = response.body;
    if (!body) throw new Error("SSE response has no body");
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let endpoint = "";
    const start = Date.now();
    while (Date.now() - start < 1e4) {
      const { done, value } = await reader.read({ timeout: 5e3 });
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("event: endpoint")) {
          continue;
        }
        if (line.startsWith("data: ") && endpoint === "") {
          const prevIdx = lines.indexOf(line) - 1;
          if (prevIdx >= 0 && lines[prevIdx] === "event: endpoint") {
            endpoint = line.slice(6).trim();
          }
        }
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data && (data.startsWith("http://") || data.startsWith("https://"))) {
            endpoint = data;
          }
        }
      }
      if (endpoint) break;
    }
    reader.cancel();
    if (!endpoint) throw new Error("Failed to get SSE endpoint");
    return endpoint;
  }
  async sendRpc(req) {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(req)
    });
    if (!response.ok) {
      throw new Error(`MCP HTTP error: ${response.status}`);
    }
    const data = await response.json();
    return data;
  }
  async initialize(send) {
    const resp = await send({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "agent-electron-app", version: "1.0.0" }
      }
    });
    if (resp.error) {
      throw new Error(`MCP initialize error: ${resp.error.message}`);
    }
    await fetch(this.endpoint, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialized" })
    });
  }
  async listTools(send) {
    const resp = await send({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/list",
      params: {}
    });
    if (resp.error) {
      throw new Error(`tools/list error: ${resp.error.message}`);
    }
    const result = resp.result;
    return result?.tools || [];
  }
  async callTool(name, args) {
    const resp = await this.sendRpc({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/call",
      params: { name, arguments: args }
    });
    if (resp.error) {
      throw new Error(`tools/call error: ${resp.error.message}`);
    }
    return resp.result;
  }
  disconnect() {
  }
}
class McpManager {
  connections = /* @__PURE__ */ new Map();
  async connect(serverId, config) {
    this.disconnect(serverId);
    let conn;
    if (config.transport === "stdio") {
      conn = new StdioConnection(config);
    } else {
      conn = new HttpConnection(config);
    }
    this.connections.set(serverId, conn);
    return conn.connect();
  }
  async callTool(serverId, toolName, input) {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`MCP server ${serverId} is not connected`);
    return conn.callTool(toolName, input);
  }
  disconnect(serverId) {
    const conn = this.connections.get(serverId);
    if (conn) {
      conn.disconnect();
      this.connections.delete(serverId);
    }
  }
  disconnectAll() {
    for (const [id] of this.connections) {
      this.disconnect(id);
    }
  }
}
const mcpManager = new McpManager();
function registerMcpIpc() {
  electron.ipcMain.handle("mcp:connect", async (_event, serverId, config) => {
    return mcpManager.connect(serverId, config);
  });
  electron.ipcMain.handle("mcp:disconnect", async (_event, serverId) => {
    mcpManager.disconnect(serverId);
  });
  electron.ipcMain.handle("mcp:call-tool", async (_event, serverId, toolName, input) => {
    return mcpManager.callTool(serverId, toolName, input);
  });
}
function createWindow() {
  const mainWindow = new electron.BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: "default",
    backgroundColor: "#181825",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  mainWindow.webContents.openDevTools();
  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (!electron.app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(() => {
  electron.app.setAppUserModelId("com.agent.electron-app");
  const { get: getSettings } = registerSettings();
  registerFileOps(() => getSettings().workspacePath);
  registerMcpIpc();
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
