import { create } from 'zustand'

interface QueueState {
  queue: string[]
  addToQueue: (text: string) => void
  removeFromQueue: (index: number) => void
  shiftQueue: () => string | undefined
  clearQueue: () => void
}

export const useQueueStore = create<QueueState>((set, get) => ({
  queue: [],

  addToQueue: (text) => set((s) => ({ queue: [...s.queue, text] })),

  removeFromQueue: (index) =>
    set((s) => ({ queue: s.queue.filter((_, i) => i !== index) })),

  shiftQueue: () => {
    const q = get().queue
    if (q.length === 0) return undefined
    const first = q[0]
    set({ queue: q.slice(1) })
    return first
  },

  clearQueue: () => set({ queue: [] })
}))
