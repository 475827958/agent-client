import { ipcMain, dialog } from 'electron'
import { readFile, writeFile, readdir, stat } from 'fs/promises'
import { join, resolve, dirname } from 'path'

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '<<<DOUBLESTAR>>>')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/<<<DOUBLESTAR>>>/g, '(.*/)?')
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
          // skip node_modules, .git
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

export function registerFileOps(workspacePath: () => string): void {
  ipcMain.handle('file:glob', async (_event, pattern: string) => {
    const base = workspacePath()
    if (!base) throw new Error('No workspace selected')
    return globFiles(base, pattern)
  })

  ipcMain.handle('file:read', async (_event, filePath: string) => {
    const base = workspacePath()
    if (!base) throw new Error('No workspace selected')
    const fullPath = resolve(base, filePath)
    // security: ensure path is within workspace
    if (!fullPath.startsWith(resolve(base))) throw new Error('Path traversal denied')
    return readFile(fullPath, 'utf-8')
  })

  ipcMain.handle('file:grep', async (_event, pattern: string, dirPath: string) => {
    const base = workspacePath()
    if (!base) throw new Error('No workspace selected')
    const searchDir = resolve(base, dirPath || '.')
    if (!searchDir.startsWith(resolve(base))) throw new Error('Path traversal denied')

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
            lines.forEach((line, i) => {
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

  ipcMain.handle('file:write', async (_event, filePath: string, content: string) => {
    const base = workspacePath()
    if (!base) throw new Error('No workspace selected')
    const fullPath = resolve(base, filePath)
    if (!fullPath.startsWith(resolve(base))) throw new Error('Path traversal denied')

    // ensure parent directory exists
    await (await import('fs/promises')).mkdir(dirname(fullPath), { recursive: true })
    return writeFile(fullPath, content, 'utf-8')
  })

  ipcMain.handle('file:edit', async (_event, filePath: string, oldStr: string, newStr: string) => {
    const base = workspacePath()
    if (!base) throw new Error('No workspace selected')
    const fullPath = resolve(base, filePath)
    if (!fullPath.startsWith(resolve(base))) throw new Error('Path traversal denied')

    const content = await readFile(fullPath, 'utf-8')
    if (!content.includes(oldStr)) throw new Error('old_string not found in file')
    const newContent = content.replace(oldStr, newStr)
    return writeFile(fullPath, newContent, 'utf-8')
  })

  ipcMain.handle('workspace:select', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
