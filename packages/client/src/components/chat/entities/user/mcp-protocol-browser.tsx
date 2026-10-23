import { McpResultContent } from '@/components/chat/messages/tools/mcp-result-content'
import { Combobox, Input, RippleButton } from '@/components/ui'
import type {
  McpProtocolMethod,
  McpProtocolRequest,
} from '@sb/core/types/mcp-protocol'
import type { McpResult } from '@sb/core/types/mcp-result'
import { useState } from 'react'

type Props = {
  onRequest: (request: McpProtocolRequest) => void
  output?: McpResult
  busy?: boolean
  error?: string
  initialization?: string
  onInsert?: (output: McpResult) => void
}

/** Browses server data only after an explicit check or read. */
export function McpProtocolBrowser({
  onRequest,
  output,
  busy,
  error,
  initialization,
  onInsert,
}: Props) {
  const [method, setMethod] = useState<McpProtocolMethod>('list_prompts')
  const [name, setName] = useState('')
  const [uri, setUri] = useState('')
  const [args, setArgs] = useState('{}')
  const [parseError, setParseError] = useState('')

  function request() {
    try {
      setParseError('')
      onRequest({
        method,
        name: name || undefined,
        uri: uri || undefined,
        arguments: method === 'get_prompt' ? JSON.parse(args) : undefined,
      })
    } catch {
      setParseError(
        'Prompt arguments must be a JSON object with string values.',
      )
    }
  }

  function select(value: McpProtocolRequest) {
    setMethod(value.method)
    setName(value.name ?? '')
    setUri(value.uri ?? '')
  }

  return (
    <div className="flex flex-col gap-2 p-2 text-xs">
      <p className="text-muted-foreground">
        Prompts and resources. Checks start an isolated temporary connection.
        Save configuration changes first.
      </p>
      <MethodPicker method={method} onChange={setMethod} />
      {method === 'get_prompt' && (
        <>
          <label>
            Prompt name
            <Input value={name} onValueChange={setName} />
          </label>
          <label>
            Prompt arguments (JSON)
            <Input value={args} onValueChange={setArgs} />
          </label>
        </>
      )}
      {method === 'read_resource' && (
        <label>
          Resource URI
          <Input
            value={uri}
            onValueChange={setUri}
            placeholder="Enter a URI or expand a listed template"
          />
        </label>
      )}
      <RippleButton
        type="button"
        size="sm"
        variant="input"
        disabled={busy}
        onClick={request}
      >
        {busy ? 'Checking…' : 'Check server'}
      </RippleButton>
      {(error || parseError) && (
        <p role="alert" className="text-destructive">
          {parseError || error}
        </p>
      )}
      {output && (
        <>
          <Inventory output={output} onSelect={select} />
          <McpResultContent output={output} />
          {Array.isArray(output.result.messages) && onInsert && (
            <RippleButton
              type="button"
              size="sm"
              variant="input"
              onClick={() => onInsert(output)}
            >
              Insert prompt into message
            </RippleButton>
          )}
        </>
      )}
      {initialization && (
        <details>
          <summary>
            Initialization instructions and capabilities (server data)
          </summary>
          <pre className="max-h-64 overflow-auto wrap-break-word whitespace-pre-wrap">
            {initialization}
          </pre>
        </details>
      )}
    </div>
  )
}

function Inventory({
  output,
  onSelect,
}: {
  output: McpResult
  onSelect: (value: McpProtocolRequest) => void
}) {
  const [page, setPage] = useState(0)
  const result = output.result

  const rows = (result.prompts ??
    result.resources ??
    result.resourceTemplates) as Record<string, unknown>[] | undefined
  if (!Array.isArray(rows)) return null

  const current = Math.min(page, Math.max(0, Math.ceil(rows.length / 25) - 1))

  return (
    <div className="flex flex-col gap-1">
      <p>
        {rows.length} entries. Page {current + 1}.
      </p>
      {rows.slice(current * 25, (current + 1) * 25).map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 wrap-break-word">
            {String(row.name ?? row.uri ?? row.uriTemplate)}
          </span>
          <RippleButton
            type="button"
            size="sm"
            variant="stealth"
            onClick={() =>
              onSelect(
                result.prompts
                  ? { method: 'get_prompt', name: String(row.name) }
                  : {
                      method: 'read_resource',
                      uri: String(row.uri ?? row.uriTemplate),
                    },
              )
            }
          >
            Select
          </RippleButton>
        </div>
      ))}
      <div className="flex gap-2">
        <RippleButton
          type="button"
          size="sm"
          disabled={current === 0}
          onClick={() => setPage(current - 1)}
        >
          Previous
        </RippleButton>
        <RippleButton
          type="button"
          size="sm"
          disabled={(current + 1) * 25 >= rows.length}
          onClick={() => setPage(current + 1)}
        >
          Next
        </RippleButton>
      </div>
    </div>
  )
}

const OPERATIONS: { value: McpProtocolMethod; label: string }[] = [
  { value: 'get_server_info', label: 'Server instructions and capabilities' },
  { value: 'list_prompts', label: 'List prompts' },
  { value: 'get_prompt', label: 'Get prompt' },
  { value: 'list_resources', label: 'List resources' },
  { value: 'list_resource_templates', label: 'List resource templates' },
  { value: 'read_resource', label: 'Read resource' },
]

function MethodPicker({
  method,
  onChange,
}: {
  method: McpProtocolMethod
  onChange: (method: McpProtocolMethod) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <span>Operation</span>
      <Combobox
        value={method}
        onValueChange={(value) => onChange(value as McpProtocolMethod)}
        noDeselect
      >
        <Combobox.Trigger
          aria-label="MCP protocol operation"
          variant="input"
          size="sm"
        >
          <Combobox.DisplayValue>
            {() =>
              OPERATIONS.find((operation) => operation.value === method)?.label
            }
          </Combobox.DisplayValue>
        </Combobox.Trigger>
        <Combobox.Content>
          <Combobox.List>
            {OPERATIONS.map((operation) => (
              <Combobox.Item key={operation.value} value={operation.value}>
                {operation.label}
              </Combobox.Item>
            ))}
          </Combobox.List>
        </Combobox.Content>
      </Combobox>
    </div>
  )
}
