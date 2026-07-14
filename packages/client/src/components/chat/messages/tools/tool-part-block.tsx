import type { ToolUIPart } from 'ai'

import { ToolBlock } from '../tool-block'
import { FileChangeBlock } from './file-change-block'
import { PlanBlock } from './plan-block'
import { ShellBlock } from './shell-block'
import { SubagentBlock } from './subagent-block'
import { WebFetchBlock } from './web-fetch-block'

export type ToolRendererProps = {
  part: ToolUIPart
  messageId: string
  forceError?: boolean
}

export function ToolPartBlock(props: ToolRendererProps) {
  switch (props.part.type.slice('tool-'.length)) {
    case 'write_file':
    case 'edit_file':
      return <FileChangeBlock {...props} />
    case 'shell':
    case 'shell_output':
      return <ShellBlock {...props} />
    case 'web_fetch':
      return <WebFetchBlock {...props} />
    case 'task':
      return <SubagentBlock {...props} />
    case 'write_plan':
    case 'edit_plan':
    case 'enter_plan_mode':
    case 'exit_plan_mode':
      return <PlanBlock {...props} />
    default:
      return <ToolBlock {...props} />
  }
}
