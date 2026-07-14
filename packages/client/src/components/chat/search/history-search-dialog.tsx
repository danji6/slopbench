import { Avatar, Dialog, Input, RippleButton } from '@/components/ui'
import { useAvatarUrls } from '@/hooks/chat'
import { type MessageSearchResult, useMessageSearch } from '@/hooks/chat/search'
import { useActiveSessionId } from '@/hooks/chat/session'
import type { MessageRole } from '@/lib/chat'
import { formatRelativeTime } from '@/lib/utils'
import type { Id } from '@sb/convex/_generated/dataModel'
import { BotIcon, CogIcon, SearchIcon, UserIcon } from 'lucide-react'
import { type ReactNode, useCallback } from 'react'

import { useMessageHighlight } from '../messages/message-highlight-context'
import type { MessageListHandle } from '../messages/message-list/message-list'

// Lead should be kept short so the highlighted match lands near the start
const SNIPPET_LEAD = 24
const SNIPPET_TRAIL = 220

export type HistorySearchDialogProps = {
  open: boolean
  onClose: () => void
  messageListRef: React.RefObject<MessageListHandle | null>
}

export function HistorySearchDialog({
  open,
  onClose,
  messageListRef,
}: HistorySearchDialogProps) {
  const sessionId = useActiveSessionId() as Id<'sessions'> | null
  const highlight = useMessageHighlight()
  const { query, term, setSearch, results, status, loadMore, isLoading } =
    useMessageSearch(open ? sessionId : null)

  const handleSelect = useCallback(
    (id: Id<'messages'>, creationTime: number, segmentIndex: number) => {
      highlight?.setTarget({
        messageId: id,
        segmentIndex: null,
        groupIndex: null,
      })
      messageListRef.current?.requestScrollToMessage(
        id,
        creationTime,
        segmentIndex,
      )
      onClose()
    },
    [highlight, messageListRef, onClose],
  )

  const showEmpty = term.length > 0 && !isLoading && results.length === 0

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Content
        showCloseButton={false}
        className="top-[15%] flex max-h-[70vh] translate-y-0 flex-col gap-3 overflow-hidden p-3 sm:max-w-xl"
      >
        <Dialog.Title className="sr-only">Search messages</Dialog.Title>
        <div className="flex items-center gap-2 px-1">
          <SearchIcon className="text-muted-foreground size-5 shrink-0" />
          <Input
            autoFocus
            placeholder="Search this conversation..."
            value={query}
            onValueChange={setSearch}
            className="h-10 border-0 bg-transparent px-1 shadow-none"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {showEmpty ? (
            <p className="text-muted-foreground p-6 text-center text-sm">
              No messages match “{term}”.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {results.map((result) => (
                <HistorySearchResultRow
                  key={`${result._id}:${result.segmentIndex}`}
                  result={result}
                  term={term}
                  onSelect={handleSelect}
                />
              ))}
            </ul>
          )}

          {status === 'CanLoadMore' && (
            <div className="flex justify-center p-2">
              <RippleButton
                variant="input"
                size="sm"
                onClick={() => loadMore(20)}
              >
                Load more
              </RippleButton>
            </div>
          )}
        </div>
      </Dialog.Content>
    </Dialog>
  )
}

type HistorySearchResultRowProps = {
  result: MessageSearchResult
  term: string
  onSelect: (
    id: Id<'messages'>,
    creationTime: number,
    segmentIndex: number,
  ) => void
}

function HistorySearchResultRow({
  result,
  term,
  onSelect,
}: HistorySearchResultRowProps) {
  const avatarUrls = useAvatarUrls(result.senderSnapshot?.avatarId)

  return (
    <li>
      <button
        type="button"
        onClick={() =>
          onSelect(result._id, result._creationTime, result.segmentIndex)
        }
        className="hover:bg-m3-surface-container flex w-full items-start gap-3 rounded-lg p-2 text-left transition-colors"
      >
        <Avatar
          src={avatarUrls.thumbnail ?? avatarUrls.original}
          alt={result.senderSnapshot?.name}
          size="sm"
          fallbackIcon={<RoleIcon role={result.role} />}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-foreground/80 truncate text-sm font-semibold">
              {result.senderSnapshot?.name ?? roleLabel(result.role)}
            </span>
            <span className="text-muted-foreground shrink-0 text-xs">
              {formatRelativeTime(result._creationTime)}
            </span>
          </div>
          <p className="text-muted-foreground line-clamp-2 text-sm">
            {buildSnippet(result.text, term)}
          </p>
        </div>
      </button>
    </li>
  )
}

function RoleIcon({ role }: { role: MessageRole }) {
  const Icon =
    role === 'user' ? UserIcon : role === 'system' ? CogIcon : BotIcon
  return <Icon className="size-full" />
}

function roleLabel(role: MessageRole): string {
  return role === 'user' ? 'You' : role === 'system' ? 'System' : 'Assistant'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function searchTokens(term: string): string[] {
  return term
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map(escapeRegExp)
}

function matchPattern(clean: string, tokens: string[]): string | null {
  const wordPrefix = (token: string) => `\\b${token}\\w*`
  const candidates =
    tokens.length > 1
      ? [
          tokens.map(wordPrefix).join('\\W+'),
          tokens.join('\\W+'),
          tokens.map(wordPrefix).join('|'),
          tokens.join('|'),
        ]
      : [wordPrefix(tokens[0]), tokens[0]]
  return (
    candidates.find((pattern) => new RegExp(pattern, 'i').test(clean)) ?? null
  )
}

function buildSnippet(text: string, term: string): ReactNode {
  const clean = text.replace(/\s+/g, ' ').trim()
  const tokens = searchTokens(term)
  const pattern = tokens.length ? matchPattern(clean, tokens) : null

  if (!pattern || !clean) return clean.slice(0, SNIPPET_LEAD + SNIPPET_TRAIL)

  const center = new RegExp(pattern, 'i').exec(clean)?.index ?? 0
  const start = Math.max(0, center - SNIPPET_LEAD)
  const end = Math.min(clean.length, center + SNIPPET_TRAIL)
  const windowText = clean.slice(start, end)

  const segments: ReactNode[] = []
  if (start > 0) segments.push('…')

  const matcher = new RegExp(pattern, 'ig')
  let last = 0
  for (const match of windowText.matchAll(matcher)) {
    const index = match.index ?? 0
    if (index > last) segments.push(windowText.slice(last, index))
    segments.push(
      <mark
        key={`${index}-${match[0]}`}
        className="bg-primary/20 text-foreground rounded-sm"
      >
        {match[0]}
      </mark>,
    )
    last = index + match[0].length
  }
  if (last < windowText.length) segments.push(windowText.slice(last))
  if (end < clean.length) segments.push('…')

  return segments
}
