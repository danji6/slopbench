import { md } from '@/components/markdown'
import { inline } from '@sb/core/utils/strings'

const start = inline`
  Prompts are instructions that guide the AI's behavior and responses. You can
  add, edit, and reorder prompts to customize how the AI interacts with you.

  Some prompts are static and non-editable. These are not prompts but
  **markers**, they mark specific places in the message history. Adding a prompt
  after a marker will make it appear after that point in the conversation. For
  example if you add a prompt after 'Message History', it will be appended after
  the last message in the history. Available markers:
`

const messageHistory =
  '- **Message History**: the entire conversation so far.'

const systemBoundary = inline`
- **System Boundary**: ends the system instructions block. System prompts
  above it are sent in the provider's system field; those below it are
  sent as ordinary system messages instead.
`

const agentPrompts =
  "- **Agent Prompts**: where the agent's own prompt list is merged at."

export function promptHelp(withAgentPromps?: boolean) {
  const buf = [start, messageHistory, systemBoundary]

  if (withAgentPromps) {
    buf.push(agentPrompts)
  }

  return md`${buf.join('\n')}`
}
