/** A single parameter of a session environment function. */
export type SessionEnvParam = {
  /** Parameter name, as it appears in the signature. */
  name: string
  /** Short description shown in the function's parameter list. */
  description: string
  /** Marks an optional parameter (rendered with a trailing `?`). */
  optional?: boolean
}

export type SessionEnvEntry = {
  /** Identifier injected into dynamic blocks. */
  name: string
  /** Description shown in the prompt content guide. */
  description: string
  /**
   * Parameter list. When present, the entry is a function; when absent, it is
   * a plain variable.
   */
  params?: SessionEnvParam[]
  /**
   * Completion snippet for helpers. Supports numbered tab stops (`$1`, `$2`, …)
   * that the user cycles through with Tab, an optional final caret (`$0`), and
   * `${n:label}` placeholders whose label is pre-selected for easy overwrite.
   */
  snippet?: string
}

/** Whether an entry is a callable function (as opposed to a variable). */
export const isEnvFunction = (entry: SessionEnvEntry): boolean =>
  entry.params !== undefined

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
    description: 'Absolute path of the workspace directory',
  },
  {
    name: 'file',
    description: 'Read a workspace file and inject its contents',
    params: [
      {
        name: 'path',
        description: 'Workspace-relative path of the file to read',
      },
      {
        name: 'wrap',
        description: 'Wrap the contents in a fenced code block (default: true)',
        optional: true,
      },
    ],
    snippet: "file('${1:path}')",
  },
  {
    name: 'get',
    description: 'Get a value from the current session',
    params: [
      {
        name: 'key',
        description: 'Name of the stored value to read back',
      },
    ],
    snippet: "get('${1:key}')",
  },
  {
    name: 'set',
    description: 'Store a value in the current session',
    params: [
      {
        name: 'key',
        description: 'Name to store the value under',
      },
      {
        name: 'value',
        description: 'Any JSON-serializable value to persist for the session',
      },
    ],
    snippet: "set('${1:key}', ${2:value})",
  },
]

/** Names injected into every dynamic block, in binding order. */
export const SESSION_ENV_NAMES = SESSION_ENV.map((entry) => entry.name)
