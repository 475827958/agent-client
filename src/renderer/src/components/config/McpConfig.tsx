import { useState } from 'react'
import { useConfigStore } from '../../stores/configStore'

export function McpConfig() {
  const [tab, setTab] = useState<'hub' | 'installed' | 'custom'>('hub')
  const [search, setSearch] = useState('')
  const {
    mcpHub, installedMcpIds, customMcps,
    installMcp, uninstallMcp, addCustomMcp, deleteCustomMcp
  } = useConfigStore()

  const filtered = mcpHub.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.desc.toLowerCase().includes(search.toLowerCase()) ||
    s.category.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div className="flex items-center gap-2 mb-5">
        <div className="flex gap-0.5 bg-[#f1f5f9] rounded-md p-0.5">
          {(['hub', 'installed', 'custom'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-[18px] py-[7px] rounded-[5px] text-[13px] font-medium transition-colors ${
                tab === t ? 'bg-white text-[#0f172a] shadow-sm' : 'text-[#64748b] hover:text-[#0f172a] bg-transparent border-none cursor-pointer'
              }`}
            >
              {t === 'hub' ? 'Hub' : t === 'installed' ? '已安装' : '自己添加'}
            </button>
          ))}
        </div>
        {tab === 'hub' && (
          <div className="relative ml-auto">
            <svg className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8]" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/>
            </svg>
            <input
              className="w-[200px] py-[6px] px-2.5 pl-[30px] border border-[#e2e8f0] rounded-md text-[13px] bg-white outline-none focus:border-[#a7f3d0]"
              placeholder="搜索 MCP..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
      </div>

      {tab === 'hub' && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5">
          {filtered.map(s => {
            const installed = installedMcpIds.includes(s.id)
            return (
              <div key={s.id} className="bg-white border border-[#e2e8f0] rounded-[10px] p-[18px] flex gap-3.5 hover:border-[#cbd5e1] hover:shadow-sm transition-all">
                <div className="w-[38px] h-[38px] rounded-md bg-[#f1f5f9] flex items-center justify-center flex-shrink-0 text-lg">{s.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-[#0f172a]">{s.name}</div>
                  <div className="text-xs text-[#94a3b8] mt-1">{s.desc}</div>
                  <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded mt-1.5 bg-[#fffbeb] text-[#b45309]">{s.category}</span>
                </div>
                <div className="flex-shrink-0 self-center">
                  <button
                    onClick={() => installed ? uninstallMcp(s.id) : installMcp(s.id)}
                    className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors border cursor-pointer ${
                      installed
                        ? 'border-[#e2e8f0] text-[#94a3b8] bg-[#f1f5f9]'
                        : 'border-[#a7f3d0] text-[#047857] bg-[#f0fdf4] hover:bg-[#a7f3d0]'
                    }`}
                  >
                    {installed ? '已安装' : '安装'}
                  </button>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && <div className="text-[#94a3b8] text-[13px] py-3">未找到匹配的 MCP</div>}
        </div>
      )}

      {tab === 'installed' && (
        <div>
          <div className="text-[11px] font-semibold text-[#94a3b8] uppercase tracking-wider mb-2">Hub 已安装</div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5">
            {mcpHub.filter(s => installedMcpIds.includes(s.id)).map(s => (
              <div key={s.id} className="bg-white border border-l-[3px] border-l-[#a7f3d0] border-[#e2e8f0] rounded-[10px] p-[18px] flex gap-3.5">
                <div className="w-[38px] h-[38px] rounded-md bg-[#f1f5f9] flex items-center justify-center flex-shrink-0 text-lg">{s.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-[#0f172a]">{s.name}</div>
                  <div className="text-xs text-[#94a3b8] mt-1">{s.desc}</div>
                  <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded mt-1.5 bg-[#fffbeb] text-[#b45309]">{s.category}</span>
                </div>
                <div className="flex-shrink-0 self-center">
                  <button onClick={() => uninstallMcp(s.id)} className="px-3.5 py-1.5 rounded-md text-xs font-medium border border-[#e2e8f0] text-[#94a3b8] bg-[#f1f5f9] cursor-pointer">卸载</button>
                </div>
              </div>
            ))}
            {mcpHub.filter(s => installedMcpIds.includes(s.id)).length === 0 && <div className="text-[#94a3b8] text-[13px] py-3">暂无已安装的 Hub MCP</div>}
          </div>
        </div>
      )}

      {tab === 'custom' && (
        <div>
          <div className="flex gap-2 mb-5">
            <button
              onClick={() => {
                const name = prompt('输入 MCP 名称:')
                if (name) addCustomMcp({ id: 'cm' + Date.now(), name, desc: '自定义创建的 MCP', icon: '🔧', source: 'create', time: '刚才' })
              }}
              className="flex items-center gap-1.5 px-4 py-2 border border-dashed border-[#e2e8f0] rounded-md text-[13px] text-[#64748b] hover:border-[#a7f3d0] hover:text-[#047857] hover:bg-[#f0fdf4] transition-colors cursor-pointer bg-white"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 10V2M4 6l4-4 4 4"/><path d="M2 12v2h12v-2"/></svg>
              上传 MCP
            </button>
            <button
              onClick={() => {
                const name = prompt('输入 MCP 名称:')
                if (name) addCustomMcp({ id: 'cm' + Date.now(), name, desc: '自定义创建的 MCP', icon: '🔧', source: 'create', time: '刚才' })
              }}
              className="flex items-center gap-1.5 px-4 py-2 border border-dashed border-[#e2e8f0] rounded-md text-[13px] text-[#64748b] hover:border-[#a7f3d0] hover:text-[#047857] hover:bg-[#f0fdf4] transition-colors cursor-pointer bg-white"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 3v10M3 8h10"/></svg>
              自己创建
            </button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2.5">
            {customMcps.map(s => (
              <div key={s.id} className="bg-white border border-l-[3px] border-l-[#a7f3d0] border-[#e2e8f0] rounded-[10px] p-[18px] flex gap-3.5">
                <div className="w-[38px] h-[38px] rounded-md bg-[#f1f5f9] flex items-center justify-center flex-shrink-0 text-lg">{s.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-[#0f172a]">{s.name}</div>
                  <div className="text-xs text-[#94a3b8] mt-1">{s.desc}</div>
                  <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded mt-1.5 ${s.source === 'create' ? 'bg-[#f0fdf4] text-[#047857]' : 'bg-[#fffbeb] text-[#b45309]'}`}>
                    {s.source === 'create' ? '自建' : `上传 · ${s.fileName || ''}`}
                  </span>
                </div>
                <div className="flex-shrink-0 self-center">
                  <button onClick={() => deleteCustomMcp(s.id)} className="px-3.5 py-1.5 rounded-md text-xs font-medium border border-[#e2e8f0] text-[#94a3b8] bg-[#f1f5f9] cursor-pointer">删除</button>
                </div>
              </div>
            ))}
            {customMcps.length === 0 && <div className="text-[#94a3b8] text-[13px] py-3">暂无自定义 MCP，点击上方按钮添加</div>}
          </div>
        </div>
      )}
    </div>
  )
}
