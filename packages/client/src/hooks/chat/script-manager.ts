import { type ViewHandle, useView } from '@/hooks/view'
import { useCallback } from 'react'

/** `?view=` segment owned by the script manager; its value is the selection. */
const SCRIPT_MANAGER_VIEW = 'scripts'

export function useScriptManagerView(): ViewHandle {
  return useView(SCRIPT_MANAGER_VIEW)
}

export function useOpenScriptManager(): () => void {
  const view = useScriptManagerView()
  return useCallback(() => view.open(), [view])
}
