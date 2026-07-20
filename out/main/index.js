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
