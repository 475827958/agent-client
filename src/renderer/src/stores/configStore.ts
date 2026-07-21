import { create } from 'zustand'
import type { HubSkill, CustomSkill, McpHubServer, McpInstalledServer, CustomMcpServer, CreateCustomMcpRequest } from '../types'
import {
  fetchMcpHub, fetchMcpInstalled, fetchMcpCustom,
  installMcpApi, uninstallMcpApi, createCustomMcpApi, deleteCustomMcpApi
} from '../services/api'

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

interface ConfigState {
  // Skills (hardcoded for now)
  hubSkills: HubSkill[]
  installedSkillIds: string[]
  customSkills: CustomSkill[]

  // MCP — API-backed
  mcpHub: McpHubServer[]
  mcpHubLoading: boolean
  mcpHubError: string | null
  installedMcps: McpInstalledServer[]
  installedLoading: boolean
  installedError: string | null
  customMcps: CustomMcpServer[]
  customLoading: boolean
  customError: string | null

  // Skills actions
  installSkill: (id: string) => void
  uninstallSkill: (id: string) => void
  addCustomSkill: (skill: CustomSkill) => void
  deleteCustomSkill: (id: string) => void

  // MCP actions
  loadMcpHub: () => Promise<void>
  loadInstalledMcps: () => Promise<void>
  loadCustomMcps: () => Promise<void>
  loadAllMcps: () => Promise<void>
  installMcp: (serverId: string) => Promise<void>
  uninstallMcp: (serverId: string) => Promise<void>
  createCustomMcp: (req: CreateCustomMcpRequest) => Promise<void>
  deleteCustomMcp: (serverId: string) => Promise<void>
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  hubSkills: HUB_SKILLS,
  installedSkillIds: ['h1', 'h3', 'h8'],
  customSkills: [
    { id: 'c1', name: '自定义日志分析', desc: '解析应用日志并生成报告', icon: '📋', source: 'create', time: '1周前' },
    { id: 'c2', name: '数据库备份脚本', desc: '定时备份 PostgreSQL 数据库', icon: '💾', source: 'upload', fileName: 'db-backup.skill', time: '2周前' }
  ],

  // MCP — API-backed
  mcpHub: [],
  mcpHubLoading: false,
  mcpHubError: null,
  installedMcps: [],
  installedLoading: false,
  installedError: null,
  customMcps: [],
  customLoading: false,
  customError: null,

  // Skills actions
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

  // MCP actions
  loadMcpHub: async () => {
    set({ mcpHubLoading: true, mcpHubError: null })
    try {
      const data = await fetchMcpHub()
      set({ mcpHub: data.servers, mcpHubLoading: false })
    } catch (err: any) {
      set({ mcpHubError: err.message || '加载 Hub 失败', mcpHubLoading: false })
    }
  },

  loadInstalledMcps: async () => {
    set({ installedLoading: true, installedError: null })
    try {
      const data = await fetchMcpInstalled()
      set({ installedMcps: data.installed, installedLoading: false })
    } catch (err: any) {
      set({ installedError: err.message || '加载已安装列表失败', installedLoading: false })
    }
  },

  loadCustomMcps: async () => {
    set({ customLoading: true, customError: null })
    try {
      const data = await fetchMcpCustom()
      set({ customMcps: data.custom, customLoading: false })
    } catch (err: any) {
      set({ customError: err.message || '加载自定义 MCP 失败', customLoading: false })
    }
  },

  loadAllMcps: async () => {
    await Promise.all([get().loadMcpHub(), get().loadInstalledMcps(), get().loadCustomMcps()])
  },

  installMcp: async (serverId) => {
    try {
      await installMcpApi(serverId)
      await get().loadInstalledMcps()
    } catch (err: any) {
      throw err
    }
  },

  uninstallMcp: async (serverId) => {
    try {
      await uninstallMcpApi(serverId)
      await get().loadInstalledMcps()
    } catch (err: any) {
      throw err
    }
  },

  createCustomMcp: async (req) => {
    await createCustomMcpApi(req)
    await get().loadCustomMcps()
    await get().loadInstalledMcps()
  },

  deleteCustomMcp: async (serverId) => {
    await deleteCustomMcpApi(serverId)
    await get().loadCustomMcps()
    await get().loadInstalledMcps()
  }
}))
