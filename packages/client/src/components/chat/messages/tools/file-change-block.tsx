import { Code } from '@/components/ui'
import { useToolOutput } from '@/hooks/chat/tool-output'
import {
  type FileMutationOutput,
  buildEditsPreviewDiff,
  languageFromPath,
  parseFileEdits,
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

/**
 * Renders write_file/edit_file as a highlighted diff. Before the tool
 * runs (input streaming or approval), a preview is built from the input
 * so the change can be reviewed.
 */
export function FileChangeBlock({
  part,
  messageId,
  forceError,
}: {
  part: ToolUIPart
  messageId: string
  forceError?: boolean
}) {
  const verb = part.type === 'tool-write_file' ? 'Write' : 'Edit'
  const input = part.input as FileChangeInput | undefined

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

  const path = output?.path ?? input?.path
  const inputEdits = parseFileEdits(input?.edits)

  const previewDiff = (part as { previewDiff?: string }).previewDiff
  const diff =
    output?.diff ??
    (previewDiff || undefined) ??
    (inputEdits ? buildEditsPreviewDiff(path, inputEdits) : undefined)

  const showContentFallback = !diff && Boolean(input?.content)

  return (
    <ToolShell
      data-slot="file-change-block"
      part={part}
      messageId={messageId}
      forceError={forceError}
      collapsible={false}
      className="w-full"
      label={
        <>
          {verb}{' '}
          <span className="text-foreground font-mono">{path ?? '…'}</span>
        </>
      }
    >
      {diff && (
        <Code
          text={diff}
          language={languageFromPath(path)}
          diff
          className="my-1 rounded-lg"
          innerClassName="max-h-80 p-3 text-xs w-full"
          hugParent
          noLoadingIndicator
          noCopyButton
        />
      )}
      {showContentFallback && (
        <Code
          text={input?.content}
          language={languageFromPath(path)}
          className="my-1 rounded-lg"
          innerClassName="max-h-80 p-3 text-xs w-full"
          hugParent
          noLoadingIndicator
          noCopyButton
        />
      )}
      {truncated && <LoadFullOutput onLoad={loadFull} loading={loadingFull} />}
    </ToolShell>
  )
}
