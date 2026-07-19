import { ipcMain, dialog } from 'electron'
import { readFile, writeFile, readdir } from 'fs/promises'
import { join, resolve, dirname } from 'path'
import { exec as cpExec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(cpExec)

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\x00')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/\x00/g, '(.*/)?')
  return new RegExp(`^${escaped}$`)
}

async function globFiles(basePath: string, pattern: string): Promise<string[]> {
  const results: string[] = []
  const regex = globToRegex(pattern)

  async function walk(dir: string) {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        const relativePath = fullPath.replace(basePath, '').replace(/^[/\\]/, '')
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue
          await walk(fullPath)
        } else if (entry.isFile()) {
          if (regex.test(relativePath)) {
            results.push(relativePath)
          }
        }
      }
    } catch {
      // skip inaccessible directories
    }
  }

  await walk(basePath)
  return results
}

function guardPath(workspaceRoot: string, targetPath: string): string {
  const fullPath = resolve(workspaceRoot, targetPath)
  if (!fullPath.startsWith(resolve(workspaceRoot))) {
    throw new Error('Access outside workspace is not allowed')
  }
  return fullPath
}

export function registerFileOps(workspacePath: () => string): void {
  const ws = () => {
    const p = workspacePath()
    if (!p) throw new Error('No workspace selected')
    return p
  }

  ipcMain.handle('file:glob', async (_event, pattern: string) => {
    return globFiles(ws(), pattern)
  })

  ipcMain.handle('file:read', async (_event, filePath: string) => {
    return readFile(guardPath(ws(), filePath), 'utf-8')
  })

  ipcMain.handle('file:write', async (_event, filePath: string, content: string) => {
    const fullPath = guardPath(ws(), filePath)
    await (await import('fs/promises')).mkdir(dirname(fullPath), { recursive: true })
    return writeFile(fullPath, content, 'utf-8')
  })

  ipcMain.handle('file:edit', async (_event, filePath: string, oldStr: string, newStr: string) => {
    const fullPath = guardPath(ws(), filePath)
    const content = await readFile(fullPath, 'utf-8')
    if (!content.includes(oldStr)) throw new Error('old_string not found in file')
    return writeFile(fullPath, content.replace(oldStr, newStr), 'utf-8')
  })

  ipcMain.handle('file:grep', async (_event, pattern: string, dirPath: string) => {
    const base = ws()
    const searchDir = guardPath(base, dirPath || '.')
    const results: string[] = []
    const regex = new RegExp(pattern, 'g')

    async function search(dir: string) {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue
          await search(fullPath)
        } else if (entry.isFile()) {
          try {
            const content = await readFile(fullPath, 'utf-8')
            const lines = content.split('\n')
            const relativePath = fullPath.replace(base, '').replace(/^[/\\]/, '')
            lines.forEach((line: string, i: number) => {
              if (regex.test(line)) {
                results.push(`${relativePath}:${i + 1}: ${line.trim()}`)
              }
            })
          } catch {
            // skip binary files
          }
        }
      }
    }

    await search(searchDir)
    return results
  })

  ipcMain.handle('file:exec', async (_event, command: string, timeoutMs: number = 120000) => {
    const cwd = resolve(ws())
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: Math.min(timeoutMs, 300000),
      maxBuffer: 10 * 1024 * 1024,
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
      env: { ...process.env, HOME: cwd, USERPROFILE: cwd }
    })

    return {
      stdout: stdout || '',
      stderr: stderr || '',
      exit_code: 0
    }
  })

  ipcMain.handle('workspace:select', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
