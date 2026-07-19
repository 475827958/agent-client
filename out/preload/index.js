"use strict";
const electron = require("electron");
const api = {
  file: {
    glob: (pattern) => electron.ipcRenderer.invoke("file:glob", pattern),
    read: (path) => electron.ipcRenderer.invoke("file:read", path),
    grep: (pattern, dirPath) => electron.ipcRenderer.invoke("file:grep", pattern, dirPath),
    write: (path, content) => electron.ipcRenderer.invoke("file:write", path, content),
    edit: (path, oldStr, newStr) => electron.ipcRenderer.invoke("file:edit", path, oldStr, newStr),
    exec: (command, timeoutMs) => electron.ipcRenderer.invoke("file:exec", command, timeoutMs)
  },
  workspace: {
    select: () => electron.ipcRenderer.invoke("workspace:select")
  },
  settings: {
    save: (settings) => electron.ipcRenderer.invoke("settings:save", settings),
    load: () => electron.ipcRenderer.invoke("settings:load")
  }
};
electron.contextBridge.exposeInMainWorld("electronAPI", api);
