import { ipcMain, dialog } from 'electron'
import { readFile, writeFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { exec as cpExec, execFile as cpExecFile } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(cpExec)
const execFileAsync = promisify(cpExecFile)

function resolveShell(): string {
  if (process.platform !== 'win32') return '/bin/bash'

  // Git Bash is needed on Windows to run Unix commands (ls, grep, etc.)
  const gitBashPaths = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ]
  for (const p of gitBashPaths) {
    if (existsSync(p)) return p
  }
  return 'cmd.exe'
}

function decodeBuffer(buf: Buffer | string | undefined): string {
  if (!buf) return ''
  if (typeof buf === 'string') return buf
  if (buf.length === 0) return ''
  if (process.platform !== 'win32') return buf.toString('utf8')

  // Try UTF-8 first (strict — invalid bytes → replacement chars).
  // Fall back to GBK if UTF-8 produces too many replacement chars.
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf)
  const utf8Bad = (utf8.match(/�/g) || []).length
  if (utf8Bad < utf8.length * 0.05) return utf8

  // Likely GBK (cmd.exe or Windows-native tool output)
  try {
    const gbk = new TextDecoder('gbk', { fatal: false }).decode(buf)
    const gbkBad = (gbk.match(/�/g) || []).length
    if (gbkBad < gbk.length * 0.05) return gbk
  } catch { /* TextDecoder('gbk') not available */ }

  return utf8
}

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
    const timeout = Math.min(timeoutMs, 300000)
    const maxBuffer = 10 * 1024 * 1024
    const env = {
      ...process.env,
      HOME: cwd,
      USERPROFILE: cwd,
      LANG: 'zh_CN.UTF-8',
      LC_ALL: 'zh_CN.UTF-8'
    }

    try {
      let stdout: Buffer
      let stderr: Buffer

      const bashPath = resolveShell()
      if (process.platform === 'win32' && bashPath.endsWith('bash.exe')) {
        const result = await execFileAsync(bashPath, ['-c', command], {
          cwd,
          timeout,
          maxBuffer,
          encoding: 'buffer' as BufferEncoding,
          env
        }) as { stdout: Buffer; stderr: Buffer }
        stdout = result.stdout
        stderr = result.stderr
      } else {
        const result = await execAsync(command, {
          cwd,
          timeout,
          maxBuffer,
          shell: bashPath,
          encoding: 'buffer' as BufferEncoding,
          env
        }) as { stdout: Buffer; stderr: Buffer }
        stdout = result.stdout
        stderr = result.stderr
      }

      return {
        stdout: decodeBuffer(stdout),
        stderr: decodeBuffer(stderr),
        exit_code: 0
      }
    } catch (err: any) {
      // Command failed — decode stderr/out buffers properly instead of
      // letting Node's raw error message propagate through IPC.
      return {
        stdout: decodeBuffer(err.stdout),
        stderr: decodeBuffer(err.stderr),
        exit_code: err.code ?? 1
      }
    }
  })

  ipcMain.handle('file:extractSkill', async (_event, base64Content: string, skillName: string): Promise<string> => {
    const fs = await import('fs/promises')
    const path = await import('path')
    const os = await import('os')
    const crypto = await import('crypto')

    // Resolve target directory: ~/.iwork/skills/{skillName}/
    const homeDir = os.homedir()
    const targetDir = path.join(homeDir, '.iwork', 'skills', skillName)

    // Ensure parent directories exist
    await fs.mkdir(targetDir, { recursive: true })

    // Decode base64 → binary zip
    const zipBuffer = Buffer.from(base64Content, 'base64')

    // Write to temp zip file
    const tmpDir = os.tmpdir()
    const zipName = `skill_${crypto.randomBytes(4).toString('hex')}.zip`
    const zipPath = path.join(tmpDir, zipName)
    await fs.writeFile(zipPath, zipBuffer)

    // Extract using shell (Git Bash on Windows, /bin/bash on macOS/Linux)
    const bashPath = resolveShell()
    try {
      await execFileAsync(bashPath, ['-c', `unzip -o "${zipPath}" -d "${targetDir}"`], {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'buffer' as BufferEncoding
      })
    } catch (err: any) {
      try { await fs.unlink(zipPath) } catch {}
      throw new Error(`Failed to extract zip: ${decodeBuffer(err.stderr) || err.message}`)
    }

    try { await fs.unlink(zipPath) } catch {}
    return targetDir
  })

  ipcMain.handle('workspace:select', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
