import type { CompletionParameter } from '../code-completion/types'

/** A documented parameter of a session environment function. */
export type SessionEnvParam = CompletionParameter & {
  description: string
}

const FILE_SCOPE_OPTIONS: SessionEnvParam = {
  name: 'options',
  description:
    'Use { scope: "workspace" } (default) or { scope: "agent" } for relative paths',
  optional: true,
  values: ['workspace', 'agent'].map((scope) => ({
    label: scope,
    insertText: `{ scope: '${scope}' }`,
    description: `Resolve relative paths in the ${scope} folder`,
  })),
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
    name: 'modelId',
    description:
      'The selected provider model ID (undefined if none is selected)',
  },
  {
    name: 'modelName',
    description:
      'The selected model label, falling back to its ID (undefined if none is selected)',
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
    name: 'agentDir',
    description: 'Absolute path of the active agent’s personal folder',
  },
  {
    name: 'workDir',
    description: 'Absolute path of the workspace directory',
  },
  {
    name: 'fileExists',
    description: 'Check whether a file exists in the selected scope',
    params: [
      {
        name: 'path',
        description: 'Path relative to the selected scope, or an absolute path',
      },
      FILE_SCOPE_OPTIONS,
    ],
    snippet: "fileExists('${1:path}')",
  },
  {
    name: 'readFile',
    description: 'Read a file in the selected scope and inject its contents',
    params: [
      {
        name: 'path',
        description: 'Path relative to the selected scope, or an absolute path',
      },
      {
        name: 'wrap',
        description: 'Wrap the contents in a fenced code block (default: true)',
        optional: true,
        values: ['true', 'false'].map((value) => ({
          label: value,
          insertText: value,
        })),
      },
      FILE_SCOPE_OPTIONS,
    ],
    snippet: "readFile('${1:path}')",
  },
  {
    name: 'getVar',
    description: 'Get a value from the current session',
    params: [
      {
        name: 'key',
        description: 'Name of the stored value to read back',
      },
    ],
    snippet: "getVar('${1:key}')",
  },
  {
    name: 'setVar',
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
    snippet: "setVar('${1:key}', ${2:value})",
  },
]

/** Names injected into every dynamic block, in binding order. */
export const SESSION_ENV_NAMES = SESSION_ENV.map((entry) => entry.name)
