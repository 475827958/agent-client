import { create } from 'zustand'
import type { HubSkill, InstalledSkill, CustomSkillDef, CreateCustomSkillRequest, McpHubServer, McpInstalledServer, CustomMcpServer, CreateCustomMcpRequest, McpConnectionStatus, McpToolDef, McpInstallResponse } from '../types'
import {
  fetchMcpHub, fetchMcpInstalled, fetchMcpCustom,
  installMcpApi, uninstallMcpApi, createCustomMcpApi, deleteCustomMcpApi,
  fetchSkillHub, fetchInstalledSkills, fetchCustomSkillsApi,
  installSkillApi, uninstallSkillApi, enableSkillApi, disableSkillApi,
  createCustomSkillApi, deleteCustomSkillApi,
  reportMcpTools
} from '../services/api'
import { ipcClient } from '../services/ipcClient'
import { useTaskStore } from './taskStore'

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

  // Installing state
  installingMcpIds: Set<string>
  installingSkillIds: Set<string>

  // MCP connection statuses per server
  mcpConnectionStatuses: Record<string, McpConnectionStatus>
  // Discovered tools per server (from tools/list after connect)
  mcpDiscoveredTools: Record<string, McpToolDef[]>

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
  setMcpConnectionStatus: (serverId: string, status: Partial<McpConnectionStatus>) => void

  // MCP session helpers
  getMcpServersForSession: () => { server_id: string; server_name: string; enabled_tools?: string[] }[]
  reportMcpToolsToSession: (sessionId: string) => Promise<void>
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

  installingMcpIds: new Set<string>(),
  installingSkillIds: new Set<string>(),

  mcpConnectionStatuses: {},
  mcpDiscoveredTools: {},

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
    const s = get()
    if (s.installingSkillIds.has(skillId)) return
    set({ installingSkillIds: new Set([...s.installingSkillIds, skillId]) })
    try {
      await installSkillApi(skillId)
      await get().loadInstalledSkills()
    } catch (err: any) {
      throw err
    } finally {
      set((st) => {
        const next = new Set(st.installingSkillIds)
        next.delete(skillId)
        return { installingSkillIds: next }
      })
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
    const s = get()
    if (s.installingMcpIds.has(serverId)) return
    set({ installingMcpIds: new Set([...s.installingMcpIds, serverId]) })

    try {
      // 1. Call API to register on server + get config
      const config: McpInstallResponse = await installMcpApi(serverId)

      // 2. Set connecting status
      set((st) => ({
        mcpConnectionStatuses: {
          ...st.mcpConnectionStatuses,
          [serverId]: { server_id: serverId, status: 'connecting', tool_count: 0 }
        }
      }))

      console.log('....')

      // 3. Connect client-side based on transport type
      const tools = await ipcClient.mcp.connect(serverId, config)

      console.log(tools)

      // 4. Store discovered tools and update status
      set((st) => ({
        mcpDiscoveredTools: { ...st.mcpDiscoveredTools, [serverId]: tools },
        mcpConnectionStatuses: {
          ...st.mcpConnectionStatuses,
          [serverId]: { server_id: serverId, status: 'connected', tool_count: tools.length }
        }
      }))

      // 5. Report tools to the current session if one is active
      const currentTask = useTaskStore.getState().getCurrentTask()
      if (currentTask?.sessionId) {
        try {
          await reportMcpTools(currentTask.sessionId, serverId, tools)
        } catch (err) {
          console.error(`Failed to report tools for ${serverId}:`, err)
        }
      }

      await get().loadInstalledMcps()
    } catch (err: any) {
      set((st) => ({
        mcpConnectionStatuses: {
          ...st.mcpConnectionStatuses,
          [serverId]: { server_id: serverId, status: 'error', tool_count: 0, error: err.message }
        }
      }))
      throw err
    } finally {
      set((st) => {
        const next = new Set(st.installingMcpIds)
        next.delete(serverId)
        return { installingMcpIds: next }
      })
    }
  },

  uninstallMcp: async (serverId) => {
    try {
      // 1. Disconnect client-side (kill process / close HTTP)
      try {
        await ipcClient.mcp.disconnect(serverId)
      } catch {
        // disconnect error is non-fatal — the process may already be dead
      }

      // 2. Unregister from server
      await uninstallMcpApi(serverId)

      // 3. Clean up local state
      set((st) => {
        const { [serverId]: _, ...restStatuses } = st.mcpConnectionStatuses
        const { [serverId]: __, ...restTools } = st.mcpDiscoveredTools
        return { mcpConnectionStatuses: restStatuses, mcpDiscoveredTools: restTools }
      })

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
  },

  setMcpConnectionStatus: (serverId, partial) => {
    set((st) => ({
      mcpConnectionStatuses: {
        ...st.mcpConnectionStatuses,
        [serverId]: {
          server_id: serverId,
          status: 'disconnected' as const,
          tool_count: 0,
          ...st.mcpConnectionStatuses[serverId],
          ...partial
        }
      }
    }))
  },

  // Build mcp_servers payload for CreateSessionRequest
  getMcpServersForSession: () => {
    const { mcpConnectionStatuses, mcpDiscoveredTools } = get()
    const servers: { server_id: string; server_name: string; enabled_tools?: string[] }[] = []

    for (const [serverId, status] of Object.entries(mcpConnectionStatuses)) {
      if (status.status === 'connected' && status.tool_count > 0) {
        const tools = mcpDiscoveredTools[serverId] || []
        servers.push({
          server_id: serverId,
          server_name: serverId,
          enabled_tools: tools.length > 0 ? tools.map(t => t.name) : undefined
        })
      }
    }

    return servers
  },

  // Report all connected MCP tools to a given session
  reportMcpToolsToSession: async (sessionId) => {
    const { mcpConnectionStatuses, mcpDiscoveredTools } = get()

    for (const [serverId, status] of Object.entries(mcpConnectionStatuses)) {
      if (status.status === 'connected') {
        const tools = mcpDiscoveredTools[serverId] || []
        try {
          await reportMcpTools(sessionId, serverId, tools)
        } catch (err) {
          console.error(`Failed to report tools for ${serverId}:`, err)
        }
      }
    }
  }
}))
