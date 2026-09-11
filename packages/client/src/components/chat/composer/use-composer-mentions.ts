import type { WorkspaceFileIndex } from '@/hooks/chat/workspace'
import type { MentionEntry } from '@/lib/chat/file-mentions'
import { filterMentions } from '@/lib/chat/file-mentions'
import { getActiveMention, mentionToken } from '@sb/core/mentions/parse'
import type { Editor } from '@tiptap/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'

const MENTION_KEYS = new Set(['Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'Escape'])

type UseComposerMentionsOptions = {
  caret: number
  editorRef: RefObject<Editor | null>
  enabled: boolean
  fileIndex?: WorkspaceFileIndex
  message: string
}

/** Owns workspace mention matching, navigation, and index refresh effects. */
export function useComposerMentions({
  caret,
  editorRef,
  enabled,
  fileIndex,
  message,
}: UseComposerMentionsOptions) {
  const [dismissedMention, setDismissedMention] = useState<string | null>(null)

  const activeMention = useMemo(
    () => (enabled ? getActiveMention(message, caret) : null),
    [caret, enabled, message],
  )

  const matches = useMemo(
    () =>
      activeMention && fileIndex
        ? filterMentions(fileIndex.files, activeMention.query)
        : [],
    [activeMention, fileIndex],
  )

  const signature = activeMention
    ? `${activeMention.start}:${activeMention.query}`
    : null
  const open = matches.length > 0 && signature !== dismissedMention

  const [selectedIndex, setSelectedIndex] = useState(0)
  const [previousMatches, setPreviousMatches] = useState(matches)
  if (previousMatches !== matches) {
    setPreviousMatches(matches)
    setSelectedIndex(0)
  }

  const ensureFiles = fileIndex?.ensureLoaded
  const refreshFiles = fileIndex?.refresh
  const mentionStart = activeMention?.start ?? null
  const lastRefreshedMentionStart = useRef<number | null>(null)

  useEffect(() => {
    if (mentionStart === null) {
      lastRefreshedMentionStart.current = null
      return
    }
    if (!ensureFiles && !refreshFiles) return
    if (lastRefreshedMentionStart.current === mentionStart) return

    lastRefreshedMentionStart.current = mentionStart
    ensureFiles?.()
    refreshFiles?.()
  }, [ensureFiles, mentionStart, refreshFiles])

  const select = useCallback(
    (entry: MentionEntry) => {
      const editor = editorRef.current
      if (!activeMention || !editor) return
      const token = mentionToken(entry.path)
      const insert = entry.isDir ? token : `${token} `
      const to = editor.state.selection.from
      const from = to - (activeMention.end - activeMention.start)
      editor.chain().insertContentAt({ from, to }, insert).focus().run()
    },
    [activeMention, editorRef],
  )

  const handleKey = useCallback(
    (event: KeyboardEvent): boolean => {
      if (
        !open ||
        !MENTION_KEYS.has(event.key) ||
        (event.key === 'Enter' && event.shiftKey)
      ) {
        return false
      }

      const count = matches.length
      if (event.key === 'ArrowDown') {
        setSelectedIndex((index) => (index + 1) % count)
      } else if (event.key === 'ArrowUp') {
        setSelectedIndex((index) => (index - 1 + count) % count)
      } else if (
        event.key === 'Tab' ||
        (event.key === 'Enter' && !event.shiftKey)
      ) {
        select(matches[selectedIndex] ?? matches[0]!)
      } else if (event.key === 'Escape') {
        setDismissedMention(signature)
      }
      return true
    },
    [matches, open, select, selectedIndex, signature],
  )

  return { handleKey, matches, open, select, selectedIndex, setSelectedIndex }
}
