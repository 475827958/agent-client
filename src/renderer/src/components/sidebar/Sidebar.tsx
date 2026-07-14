import { useState } from 'react'
import { MessageSquare, Settings } from 'lucide-react'
import { ConversationList } from './ConversationList'
import { SettingsPanel } from './SettingsPanel'

type Tab = 'conversations' | 'settings'

export function Sidebar() {
  const [tab, setTab] = useState<Tab>('conversations')

  return (
    <div className="h-full bg-sidebar-bg border-r border-sidebar-border flex flex-col">
      <div className="flex border-b border-sidebar-border">
        <button
          onClick={() => setTab('conversations')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm transition-colors ${
            tab === 'conversations'
              ? 'text-accent border-b-2 border-accent'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <MessageSquare size={16} />
          对话
        </button>
        <button
          onClick={() => setTab('settings')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm transition-colors ${
            tab === 'settings'
              ? 'text-accent border-b-2 border-accent'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          <Settings size={16} />
          设置
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'conversations' ? <ConversationList /> : <SettingsPanel />}
      </div>
    </div>
  )
}
