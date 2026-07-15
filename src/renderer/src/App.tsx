import { useEffect } from 'react'
import { useSettingsStore } from './stores/settingsStore'
import { AppLayout } from './components/layout/AppLayout'

export default function App() {
  const load = useSettingsStore((s) => s.load)

  useEffect(() => {
    load()
  }, [])

  return <AppLayout />
}
