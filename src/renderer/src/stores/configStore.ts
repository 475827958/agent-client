import { create } from 'zustand'
import type { HubSkill, CustomSkill, McpServer, CustomMcp, MemoryItem, RuleItem } from '../types'

const HUB_SKILLS: HubSkill[] = [
  { id: 'h1', name: 'GitHub 集成', desc: '管理 Issues、PR、仓库操作', icon: '🐙', category: '开发' },
  { id: 'h2', name: 'Slack 通知', desc: '发送消息、管理频道通知', icon: '💬', category: '协作' },
  { id: 'h3', name: 'PDF 解析器', desc: '解析和提取 PDF 内容', icon: '📕', category: '文档' },
  { id: 'h4', name: '图片生成', desc: '通过 AI 生成和编辑图片', icon: '🎨', category: '创作' },
  { id: 'h5', name: '邮件助手', desc: '自动读取、分类和回复邮件', icon: '📧', category: '办公' },
  { id: 'h6', name: '数据可视化', desc: '生成图表和数据分析报告', icon: '📊', category: '数据' },
  { id: 'h7', name: 'API 测试', desc: 'REST API 自动化测试工具', icon: '🧪', category: '开发' },
  { id: 'h8', name: '翻译助手', desc: '多语言实时翻译', icon: '🌍', category: '办公' }
]

const MCP_HUB: McpServer[] = [
  { id: 'mh1', name: 'GitHub MCP', desc: '管理 Issues、PR、仓库操作', icon: '🐙', category: '开发' },
  { id: 'mh2', name: 'Slack MCP', desc: '发送消息、管理频道通知', icon: '💬', category: '协作' },
  { id: 'mh3', name: 'PostgreSQL MCP', desc: '数据库查询和管理', icon: '🗄️', category: '数据' },
  { id: 'mh4', name: 'Filesystem MCP', desc: '安全文件系统访问', icon: '📁', category: '文件' },
  { id: 'mh5', name: 'Redis MCP', desc: '缓存管理和数据操作', icon: '🔴', category: '数据' },
  { id: 'mh6', name: 'Docker MCP', desc: '容器管理和部署操作', icon: '🐳', category: '运维' },
  { id: 'mh7', name: 'Jira MCP', desc: '任务跟踪和项目管理', icon: '📋', category: '协作' },
  { id: 'mh8', name: 'Notion MCP', desc: '文档和知识库管理', icon: '📝', category: '办公' }
]

interface ConfigState {
  // Skills
  hubSkills: HubSkill[]
  installedSkillIds: string[]
  customSkills: CustomSkill[]
  // MCP
  mcpHub: McpServer[]
  installedMcpIds: string[]
  customMcps: CustomMcp[]
  // Memory & Rules
  memoryItems: MemoryItem[]
  rulesItems: RuleItem[]

  // Skills actions
  installSkill: (id: string) => void
  uninstallSkill: (id: string) => void
  addCustomSkill: (skill: CustomSkill) => void
  deleteCustomSkill: (id: string) => void

  // MCP actions
  installMcp: (id: string) => void
  uninstallMcp: (id: string) => void
  addCustomMcp: (mcp: CustomMcp) => void
  deleteCustomMcp: (id: string) => void

  // Memory actions
  addMemory: (text: string) => void
  updateMemory: (id: string, text: string) => void
  deleteMemory: (id: string) => void

  // Rule actions
  addRule: (text: string) => void
  updateRule: (id: string, text: string) => void
  deleteRule: (id: string) => void
}

let memId = 10
let ruleId = 10

export const useConfigStore = create<ConfigState>((set) => ({
  hubSkills: HUB_SKILLS,
  installedSkillIds: ['h1', 'h3', 'h8'],
  customSkills: [
    { id: 'c1', name: '自定义日志分析', desc: '解析应用日志并生成报告', icon: '📋', source: 'create', time: '1周前' },
    { id: 'c2', name: '数据库备份脚本', desc: '定时备份 PostgreSQL 数据库', icon: '💾', source: 'upload', fileName: 'db-backup.skill', time: '2周前' }
  ],

  mcpHub: MCP_HUB,
  installedMcpIds: ['mh1', 'mh3', 'mh4'],
  customMcps: [
    { id: 'cm1', name: '内部 API MCP', desc: '公司内部 API 接口调用', icon: '🔌', source: 'create', time: '3天前' }
  ],

  memoryItems: [
    { id: 'm1', text: '用户偏好简洁回复，不要冗余解释', time: '3天前' },
    { id: 'm2', text: '项目使用 TypeScript + React + Tailwind CSS 技术栈', time: '1周前' },
    { id: 'm3', text: '用户是高级前端工程师，熟悉 React 生态', time: '2周前' }
  ],
  rulesItems: [
    { id: 'r1', text: '所有 API 调用需要统一的错误处理', time: '1周前' },
    { id: 'r2', text: '组件命名使用 PascalCase，文件与组件同名', time: '2周前' }
  ],

  // Skills
  installSkill: (id) =>
    set((s) => ({
      installedSkillIds: s.installedSkillIds.includes(id) ? s.installedSkillIds : [...s.installedSkillIds, id]
    })),

  uninstallSkill: (id) =>
    set((s) => ({
      installedSkillIds: s.installedSkillIds.filter((x) => x !== id)
    })),

  addCustomSkill: (skill) =>
    set((s) => ({ customSkills: [skill, ...s.customSkills] })),

  deleteCustomSkill: (id) =>
    set((s) => ({ customSkills: s.customSkills.filter((x) => x.id !== id) })),

  // MCP
  installMcp: (id) =>
    set((s) => ({
      installedMcpIds: s.installedMcpIds.includes(id) ? s.installedMcpIds : [...s.installedMcpIds, id]
    })),

  uninstallMcp: (id) =>
    set((s) => ({
      installedMcpIds: s.installedMcpIds.filter((x) => x !== id)
    })),

  addCustomMcp: (mcp) =>
    set((s) => ({ customMcps: [mcp, ...s.customMcps] })),

  deleteCustomMcp: (id) =>
    set((s) => ({ customMcps: s.customMcps.filter((x) => x.id !== id) })),

  // Memory
  addMemory: (text) =>
    set((s) => ({
      memoryItems: [{ id: `m${memId++}`, text, time: '刚才' }, ...s.memoryItems]
    })),

  updateMemory: (id, text) =>
    set((s) => ({
      memoryItems: s.memoryItems.map((m) => (m.id === id ? { ...m, text } : m))
    })),

  deleteMemory: (id) =>
    set((s) => ({
      memoryItems: s.memoryItems.filter((m) => m.id !== id)
    })),

  // Rules
  addRule: (text) =>
    set((s) => ({
      rulesItems: [{ id: `r${ruleId++}`, text, time: '刚才' }, ...s.rulesItems]
    })),

  updateRule: (id, text) =>
    set((s) => ({
      rulesItems: s.rulesItems.map((r) => (r.id === id ? { ...r, text } : r))
    })),

  deleteRule: (id) =>
    set((s) => ({
      rulesItems: s.rulesItems.filter((r) => r.id !== id)
    }))
}))
