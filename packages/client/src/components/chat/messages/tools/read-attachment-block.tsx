import { useToolOutput } from '@/hooks/chat/tool-output'
import {
  attachmentToolActivity,
  getToolErrorText,
  getToolStatus,
} from '@/lib/chat'
import {
  type AttachmentSearchHit,
  parseOutputValue,
} from '@/lib/chat/tool-output'
import type { ToolUIPart } from 'ai'

import { CollapsibleBlock } from '../collapsible-block'
import { LoadFullOutput } from './load-full-output'
import { ToolIcon } from './tool-icon'

/** Reveals the recorded text page or search hits when the row is expanded. */
export function ReadAttachmentBlock({
  parts,
  messageId,
  toolErrors,
}: {
  parts: ToolUIPart[]
  messageId: string
  toolErrors?: string[]
}) {
  return (
    <div data-slot="read-attachment-block" className="flex flex-col">
      {parts.map((part) => (
        <AttachmentReadRow
          key={part.toolCallId}
          part={part}
          messageId={messageId}
          forceError={toolErrors?.includes(part.toolCallId)}
        />
      ))}
    </div>
  )
}

type AttachmentReadRowProps = {
  part: ToolUIPart
  messageId: string
  forceError?: boolean
}

function AttachmentReadRow({
  part,
  messageId,
  forceError,
}: AttachmentReadRowProps) {
  const { label, output } = attachmentToolActivity(part)
  const error = getToolErrorText(part) ?? (forceError ? 'Read failed' : '')
  const running = !error && getToolStatus(part) === 'running'
  const range = attachmentRangeLabel(output?.offset, output?.endOffset)
  const text = output?.kind === 'text' ? output.content : undefined
  const matches = output?.kind === 'search' ? output.matches : undefined
  const hasPreview = typeof text === 'string' || Array.isArray(matches)

  return (
    <CollapsibleBlock
      data-tool-call-id={part.toolCallId}
      collapsible={hasPreview}
      fullWidth={hasPreview}
      surface={hasPreview ? 'inset-row' : false}
      dense
      shimmer={running}
      leadingIcon={<ToolIcon name="read_attachment" />}
      label={
        <span className="flex flex-wrap items-center gap-x-2">
          <span className={running ? undefined : 'text-foreground font-medium'}>
            {label[0].toUpperCase() + label.slice(1)}
          </span>
          {range && <span className="font-mono">{range}</span>}
          {error && <span className="text-destructive">{error}</span>}
        </span>
      }
    >
      {typeof text === 'string' &&
        ((part as { outputRef?: string }).outputRef ? (
          <StoredAttachmentText part={part} messageId={messageId} />
        ) : (
          <AttachmentOutputCode text={text || 'No text in this page.'} />
        ))}
      {Array.isArray(matches) && <AttachmentSearchPreview matches={matches} />}
    </CollapsibleBlock>
  )
}

function StoredAttachmentText({
  part,
  messageId,
}: Pick<AttachmentReadRowProps, 'part' | 'messageId'>) {
  const { output, truncated, loadFull, loadingFull, loadError } = useToolOutput(
    part,
    messageId,
  )
  const text = parseOutputValue<{ content?: string }>(output)?.content
  return (
    <div className="flex flex-col gap-2">
      <AttachmentOutputCode text={text || 'No text in this page.'} />
      {loadError && (
        <span className="text-destructive text-xs">{loadError}</span>
      )}
      {truncated && <LoadFullOutput onLoad={loadFull} loading={loadingFull} />}
    </div>
  )
}

function AttachmentSearchPreview({
  matches,
}: {
  matches: AttachmentSearchHit[]
}) {
  const text = matches
    .map((hit) => {
      const location =
        hit.lineFromEnd !== undefined
          ? `Line ${hit.lineFromEnd} from end`
          : `Line ${hit.line}`
      return `${location}  ${hit.preview}${hit.previewClipped ? ' …' : ''}`
    })
    .join('\n')

  return <AttachmentOutputCode text={text || 'No matches on this page.'} />
}

function AttachmentOutputCode({ text }: { text: string }) {
  return (
    <pre className="bg-m3-surface-container-lowest max-h-72 overflow-auto rounded-(--work-surface-inner-radius) border p-2 font-mono text-xs wrap-anywhere whitespace-pre-wrap">
      <code>{text}</code>
    </pre>
  )
}

function attachmentRangeLabel(offset?: number, endOffset?: number) {
  if (typeof offset !== 'number' || typeof endOffset !== 'number') return
  if (endOffset <= offset) return
  return `bytes ${offset}–${endOffset - 1}`
}
