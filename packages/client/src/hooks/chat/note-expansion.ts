import { noteExpansion } from '@/lib/chat/note-state'
import { useCallback, useSyncExternalStore } from 'react'

export function useNoteExpansion(key: string) {
  const open = useSyncExternalStore(noteExpansion.subscribe, () =>
    noteExpansion.getSnapshot().has(key),
  )
  const onOpenChange = useCallback(
    (next: boolean, mountedRows?: ReadonlySet<string>) =>
      noteExpansion.setOpen(key, next, mountedRows),
    [key],
  )
  return [open, onOpenChange] as const
}
