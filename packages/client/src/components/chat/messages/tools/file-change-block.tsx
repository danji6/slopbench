import { Code } from '@/components/ui'
import { useToolOutput } from '@/hooks/chat/tool-output'
import {
  type FileMutationOutput,
  languageFromPath,
  parseOutputValue,
} from '@/lib/chat/tool-output'
import type { ToolUIPart } from 'ai'

import { LoadFullOutput } from './load-full-output'
import { ToolShell } from './tool-shell'

type FileChangeInput = {
  path?: string
  content?: string
  edits?: unknown
}

type FileChangePart = ToolUIPart & {
  previewDiff?: string
  previewPath?: string
}

type FileChangeBlockProps = {
  part: ToolUIPart
  messageId: string
  forceError?: boolean
  grouped?: boolean
}

/**
 * Renders write_file/edit_file as a highlighted diff. Before the tool
 * runs (input streaming or approval), a preview is built from the input
 * so the change can be reviewed.
 */
export function FileChangeBlock({
  part,
  messageId,
  forceError,
  grouped = false,
}: FileChangeBlockProps) {
  const input = part.input as FileChangeInput | undefined
  const { previewDiff, previewPath } = part as FileChangePart

  const {
    output: rawOutput,
    truncated,
    loadFull,
    loadingFull,
  } = useToolOutput(part, messageId)

  const output =
    part.state === 'output-available'
      ? parseOutputValue<FileMutationOutput>(rawOutput)
      : undefined

  const path = output?.path ?? previewPath ?? input?.path
  const personal = path?.startsWith('agent://')
  const diff = output?.diff ?? previewDiff ?? undefined

  const showContentFallback = !diff && Boolean(input?.content)
  // write_file already has the complete content in its input fallback
  const showLoadFullOutput = truncated && !showContentFallback
  const isPending = !diff && !showContentFallback

  const verb =
    part.type === 'tool-write_file'
      ? isPending
        ? 'Writing'
        : 'Wrote'
      : isPending
        ? 'Editing'
        : 'Edited'

  return (
    <ToolShell
      data-slot="file-change-block"
      part={part}
      messageId={messageId}
      forceError={forceError}
      fullWidth
      surface={grouped ? 'inset' : true}
      className="w-full"
      leadingIcon={grouped ? null : undefined}
      label={
        <>
          {!grouped && `${verb} `}
          {personal && (grouped ? 'Personal folder · ' : 'personal file ')}
          <span className="text-foreground font-mono">{path ?? '…'}</span>
        </>
      }
    >
      {diff && (
        <Code
          text={diff}
          language={languageFromPath(path)}
          diff
          className="min-h-0 rounded-(--work-surface-inner-radius)"
          innerClassName="max-h-[min(384px,50dvh)] overflow-auto rounded-(--work-surface-inner-radius) text-xs w-full"
          hugParent
          noLoadingIndicator
          noCopyButton
        />
      )}
      {showContentFallback && (
        <Code
          text={input?.content}
          language={languageFromPath(path)}
          className="min-h-0 rounded-(--work-surface-inner-radius)"
          innerClassName="max-h-[min(384px,50dvh)] overflow-auto rounded-(--work-surface-inner-radius) p-3 text-xs w-full"
          hugParent
          noLoadingIndicator
          noCopyButton
        />
      )}
      {showLoadFullOutput && (
        <LoadFullOutput onLoad={loadFull} loading={loadingFull} />
      )}
    </ToolShell>
  )
}
