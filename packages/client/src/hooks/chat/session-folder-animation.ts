import type { GroupRow } from '@/lib/chat/session-groups'
import { useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'

const FOLDER_TRANSITION_MS = 200

/** Retains closing branches until their virtualized rows finish animating. */
export function useSessionFolderAnimation(collapsed: Record<string, boolean>) {
  const [settled, setSettled] = useState(collapsed)
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    if (settled === collapsed) return
    const timer = setTimeout(
      () => setSettled(collapsed),
      FOLDER_TRANSITION_MS + 50,
    )
    return () => clearTimeout(timer)
  }, [collapsed, settled])

  const renderedCollapsed = useMemo(() => {
    if (reducedMotion) return collapsed
    return Object.fromEntries(
      Object.keys(collapsed).map((key) => [
        key,
        Boolean(collapsed[key] && settled[key]),
      ]),
    )
  }, [collapsed, settled, reducedMotion])

  return {
    renderedCollapsed,
    isClosing: (row: GroupRow) => rowInsideCollapsedFolder(row, collapsed),
    isOpening: (row: GroupRow) =>
      !reducedMotion && rowInsideCollapsedFolder(row, settled),
  }
}

/** Leaves a folder's own header visible while hiding its descendants. */
function rowInsideCollapsedFolder(
  row: GroupRow,
  collapsed: Record<string, boolean>,
) {
  if (row.key === 'search' || row.key === 'ungrouped') return false
  if (row.ancestorIds?.some((key) => collapsed[key])) return true
  return row.kind !== 'header' && Boolean(collapsed[row.key])
}
