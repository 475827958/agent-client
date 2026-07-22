import { create } from 'zustand'
import type { HubSkill, InstalledSkill, CustomSkillDef, CreateCustomSkillRequest, McpHubServer, McpInstalledServer, CustomMcpServer, CreateCustomMcpRequest } from '../types'
import {
  fetchMcpHub, fetchMcpInstalled, fetchMcpCustom,
  installMcpApi, uninstallMcpApi, createCustomMcpApi, deleteCustomMcpApi,
  fetchSkillHub, fetchInstalledSkills, fetchCustomSkillsApi,
  installSkillApi, uninstallSkillApi, enableSkillApi, disableSkillApi,
  createCustomSkillApi, deleteCustomSkillApi
} from '../services/api'

interface ConfigState {
  // Skills — API-backed
  hubSkills: HubSkill[]
  hubSkillsLoading: boolean
  hubSkillsError: string | null
  installedSkills: InstalledSkill[]
  installedSkillsLoading: boolean
  installedSkillsError: string | null
  customSkills: CustomSkillDef[]
  customSkillsLoading: boolean
  customSkillsError: string | null

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
  loadSkillHub: () => Promise<void>
  loadInstalledSkills: () => Promise<void>
  loadCustomSkills: () => Promise<void>
  loadAllSkills: () => Promise<void>
  installSkill: (skillId: string) => Promise<void>
  uninstallSkill: (skillId: string) => Promise<void>
  enableSkill: (skillId: string) => Promise<void>
  disableSkill: (skillId: string) => Promise<void>
  createCustomSkill: (req: CreateCustomSkillRequest) => Promise<void>
  deleteCustomSkill: (skillId: string) => Promise<void>

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
  // Skills — API-backed
  hubSkills: [],
  hubSkillsLoading: false,
  hubSkillsError: null,
  installedSkills: [],
  installedSkillsLoading: false,
  installedSkillsError: null,
  customSkills: [],
  customSkillsLoading: false,
  customSkillsError: null,

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
  loadSkillHub: async () => {
    const s = get()
    if (s.hubSkillsLoading) return
    set({ hubSkillsLoading: true, hubSkillsError: null })
    try {
      const data = await fetchSkillHub()
      set({ hubSkills: data.skills, hubSkillsLoading: false })
    } catch (err: any) {
      set({ hubSkillsError: err.message || '加载 Skill Hub 失败', hubSkillsLoading: false })
    }
  },

  loadInstalledSkills: async () => {
    const s = get()
    if (s.installedSkillsLoading) return
    set({ installedSkillsLoading: true, installedSkillsError: null })
    try {
      const data = await fetchInstalledSkills()
      set({ installedSkills: data.installed, installedSkillsLoading: false })
    } catch (err: any) {
      set({ installedSkillsError: err.message || '加载已安装 Skill 失败', installedSkillsLoading: false })
    }
  },

  loadCustomSkills: async () => {
    const s = get()
    if (s.customSkillsLoading) return
    set({ customSkillsLoading: true, customSkillsError: null })
    try {
      const data = await fetchCustomSkillsApi()
      set({ customSkills: data.custom, customSkillsLoading: false })
    } catch (err: any) {
      set({ customSkillsError: err.message || '加载自定义 Skill 失败', customSkillsLoading: false })
    }
  },

  loadAllSkills: async () => {
    await Promise.all([get().loadSkillHub(), get().loadInstalledSkills(), get().loadCustomSkills()])
  },

  installSkill: async (skillId) => {
    try {
      await installSkillApi(skillId)
      await get().loadInstalledSkills()
    } catch (err: any) {
      throw err
    }
  },

  uninstallSkill: async (skillId) => {
    try {
      await uninstallSkillApi(skillId)
      await get().loadInstalledSkills()
    } catch (err: any) {
      throw err
    }
  },

  enableSkill: async (skillId) => {
    await enableSkillApi(skillId)
    await get().loadInstalledSkills()
  },

  disableSkill: async (skillId) => {
    await disableSkillApi(skillId)
    await get().loadInstalledSkills()
  },

  createCustomSkill: async (req) => {
    await createCustomSkillApi(req)
    await Promise.all([get().loadCustomSkills(), get().loadInstalledSkills()])
  },

  deleteCustomSkill: async (skillId) => {
    await deleteCustomSkillApi(skillId)
    await Promise.all([get().loadCustomSkills(), get().loadInstalledSkills()])
  },

  // MCP actions
  loadMcpHub: async () => {
    const s = get()
    if (s.mcpHubLoading) return
    set({ mcpHubLoading: true, mcpHubError: null })
    try {
      const data = await fetchMcpHub()
      set({ mcpHub: data.servers, mcpHubLoading: false })
    } catch (err: any) {
      set({ mcpHubError: err.message || '加载 Hub 失败', mcpHubLoading: false })
    }
  },

  loadInstalledMcps: async () => {
    const s = get()
    if (s.installedLoading) return
    set({ installedLoading: true, installedError: null })
    try {
      const data = await fetchMcpInstalled()
      set({ installedMcps: data.installed, installedLoading: false })
    } catch (err: any) {
      set({ installedError: err.message || '加载已安装列表失败', installedLoading: false })
    }
  },

  loadCustomMcps: async () => {
    const s = get()
    if (s.customLoading) return
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
