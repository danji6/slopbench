import { useToolOutput } from '@/hooks/chat/tool-output'
import { getToolErrorText } from '@/lib/chat'
import { parseOutputValue } from '@/lib/chat/tool-output'

import { LoadFullOutput } from './load-full-output'
import type { ToolRendererProps } from './tool-part-block'
import { ToolShell } from './tool-shell'

/** Shows the names returned by a skill catalog lookup. */
export function ListSkillsBlock({
  part,
  messageId,
  forceError,
}: ToolRendererProps) {
  const { output, truncated, loadFull, loadingFull } = useToolOutput(
    part,
    messageId,
  )
  const input = parseOutputValue<{ search?: unknown }>(part.input)
  const search = typeof input?.search === 'string' ? input.search.trim() : ''
  const label = search
    ? `Listed skills containing "${search}"`
    : 'Listed skills'
  const hasOutput = part.state === 'output-available' && !getToolErrorText(part)
  const names = skillNames(output)

  return (
    <ToolShell
      data-slot="list-skills-block"
      part={part}
      messageId={messageId}
      forceError={forceError}
      className="min-w-0 overflow-x-hidden"
      label={<span className="text-foreground font-medium">{label}</span>}
    >
      {hasOutput && (
        <>
          {names?.length ? (
            <ul
              aria-label="Skills"
              tabIndex={0}
              className="bg-background max-h-48 overflow-x-hidden overflow-y-auto rounded px-2 py-1 text-xs wrap-anywhere"
            >
              {names.map((name, index) => (
                <li key={index} className="py-1">
                  {name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-xs">
              {names ? 'No skills found.' : 'Skill names unavailable.'}
            </p>
          )}
          {truncated && (
            <LoadFullOutput onLoad={loadFull} loading={loadingFull} />
          )}
        </>
      )}
    </ToolShell>
  )
}

function skillNames(output: unknown): string[] | undefined {
  const page = parseOutputValue<{ entries?: unknown }>(output)
  if (!Array.isArray(page?.entries)) return undefined

  return page.entries.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return []
    const name = 'name' in entry ? entry.name : undefined
    return typeof name === 'string' && name.trim() ? [name] : []
  })
}
