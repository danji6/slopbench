export type SessionEnvEntry = {
  /** Identifier injected into dynamic blocks. */
  name: string
  /** Description shown in the prompt content guide. */
  description: string
  kind: 'variable' | 'helper'
  /** Completion snippet for helpers, e.g. `$get($0)` (`$0` is the caret). */
  snippet?: string
}

/** List of all session environment variables and functions. */
export const SESSION_ENV: SessionEnvEntry[] = [
  {
    name: 'user',
    description: "The invoking user's name",
    kind: 'variable',
  },
  {
    name: 'owner',
    description: "The agent's owner's name",
    kind: 'variable',
  },
  {
    name: 'agent',
    description: "The agent's name",
    kind: 'variable',
  },
  {
    name: 'assistant',
    description: 'Alias to agent',
    kind: 'variable',
  },
  {
    name: 'char',
    description: 'Alias to agent',
    kind: 'variable',
  },
  {
    name: 'ai',
    description: 'Alias to agent',
    kind: 'variable',
  },
  {
    name: 'tools',
    description: 'List of all the available tools',
    kind: 'variable',
  },
  {
    name: 'isAdmin',
    description: '`true` when the invoking user is an admin',
    kind: 'variable',
  },
  {
    name: 'userCount',
    description: 'Number of users participating in the session',
    kind: 'variable',
  },
  {
    name: 'agentCount',
    description: 'Number of agents participating in the session',
    kind: 'variable',
  },
  {
    name: '$get',
    description: 'Get a value from the current session',
    kind: 'helper',
    snippet: '$get($0)',
  },
  {
    name: '$set',
    description: 'Store a value in the current session',
    kind: 'helper',
    snippet: '$set($0)',
  },
]

/** Names injected into every dynamic block, in binding order. */
export const SESSION_ENV_NAMES = SESSION_ENV.map((entry) => entry.name)
