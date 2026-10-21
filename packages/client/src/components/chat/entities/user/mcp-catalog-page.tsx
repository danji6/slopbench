import { Accordion, RippleButton } from '@/components/ui'
import type { ReactNode } from 'react'

import { McpToolRow } from './mcp-tool-row'
import type { McpToolMetaFormValues } from './settings-schema'

export type CatalogRow = {
  _id: string
  name: string
  description?: string
  descriptionTruncated?: boolean
  diagnostic?: string
}

export type CatalogDescriptionProps = {
  row: CatalogRow
  override?: string
  onChange: (value: string | undefined) => void
}

type Props = {
  rows: CatalogRow[]
  error?: string
  overrides: McpToolMetaFormValues[]
  pageNumber: number
  hasNext: boolean
  onNext: () => void
  onPrevious: () => void
  onChange: (tools: McpToolMetaFormValues[]) => void
  renderDescription: (props: CatalogDescriptionProps) => ReactNode
}

/** Pages compact catalog entries and mounts full editors only for expanded tools. */
export function McpCatalogPage(props: Props) {
  return (
    <div className="flex flex-col gap-2 px-1">
      {props.error && (
        <p className="text-destructive px-2 text-xs">
          Refresh failed: {props.error}
        </p>
      )}
      <Accordion>
        {props.rows.map((row) => (
          <CatalogTool key={row._id} row={row} {...props} />
        ))}
      </Accordion>
      <div className="flex gap-2">
        <RippleButton
          size="sm"
          variant="stealth"
          disabled={props.pageNumber === 0}
          onClick={props.onPrevious}
        >
          Previous
        </RippleButton>
        <RippleButton
          size="sm"
          variant="stealth"
          disabled={!props.hasNext}
          onClick={props.onNext}
        >
          Next
        </RippleButton>
      </div>
    </div>
  )
}

function CatalogTool({
  row,
  overrides,
  onChange,
  renderDescription,
}: Pick<Props, 'overrides' | 'onChange' | 'renderDescription'> & {
  row: CatalogRow
}) {
  const override = overrides.find((tool) => tool.name === row.name)
  const tool = {
    ...override,
    name: row.name,
    description: row.description,
    diagnostic: row.diagnostic,
  }
  function update(patch: Partial<McpToolMetaFormValues>) {
    const next = { ...override, name: row.name, ...patch }
    onChange([...overrides.filter((tool) => tool.name !== row.name), next])
  }
  return (
    <McpToolRow
      value={row._id}
      tool={tool}
      clashing={false}
      onChange={update}
      descriptionEditor={renderDescription({
        row,
        override: override?.descriptionOverride,
        onChange: (descriptionOverride) => update({ descriptionOverride }),
      })}
    />
  )
}
