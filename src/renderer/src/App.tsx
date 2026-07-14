import { useEffect } from 'react'
import { useSettingsStore } from './stores/settingsStore'
import { useConversationStore } from './stores/conversationStore'
import { AppLayout } from './components/layout/AppLayout'

export default function App() {
  const load = useSettingsStore((s) => s.load)
  const create = useConversationStore((s) => s.create)

  useEffect(() => {
    load()
    // Create initial conversation if none
    create()
  }, [])

  return <AppLayout />
}
