export type SessionEnvEntry = {
  /** Identifier injected into dynamic blocks. `$` prefix marks a function. */
  name: string
  /** Description shown in the prompt content guide. */
  description: string
  /** Completion snippet for helpers, e.g. `$get($0)` (`$0` is the caret). */
  snippet?: string
}

/** List of all session environment variables and functions. */
export const SESSION_ENV: SessionEnvEntry[] = [
  {
    name: 'user',
    description: "The invoking user's name",
  },
  {
    name: 'owner',
    description: "The agent's owner's name",
  },
  {
    name: 'agent',
    description: "The agent's name",
  },
  {
    name: 'assistant',
    description: 'Alias to agent',
  },
  {
    name: 'char',
    description: 'Alias to agent',
  },
  {
    name: 'ai',
    description: 'Alias to agent',
  },
  {
    name: 'tools',
    description: 'List of all the available tools',
  },
  {
    name: 'isAdmin',
    description: '`true` when the invoking user is an admin',
  },
  {
    name: 'userCount',
    description: 'Number of users participating in the session',
  },
  {
    name: 'agentCount',
    description: 'Number of agents participating in the session',
  },
  {
    name: 'workDir',
    description:
      'Absolute path of the workspace directory',
  },
  {
    name: '$get',
    description: 'Get a value from the current session',
    snippet: '$get($0)',
  },
  {
    name: '$set',
    description: 'Store a value in the current session',
    snippet: '$set($0)',
  },
]

/** Names injected into every dynamic block, in binding order. */
export const SESSION_ENV_NAMES = SESSION_ENV.map((entry) => entry.name)
