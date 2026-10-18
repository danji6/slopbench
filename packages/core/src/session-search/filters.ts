export type SessionSearchTarget = {
  folderNames: readonly string[]
  participants: readonly { kind: 'agent' | 'user'; name: string }[]
}

type SearchFilterDefinition = {
  description: string
  example: string
  names: (target: SessionSearchTarget) => readonly string[]
}

/** Defines the available prefixes, their help text, and their searchable names. */
export const SESSION_SEARCH_FILTERS = {
  folder: {
    description: 'Folder names',
    example: 'folder:Project',
    names: (target) => target.folderNames,
  },
  agent: {
    description: 'Agent names',
    example: 'agent:Alice',
    names: (target) =>
      target.participants.filter((p) => p.kind === 'agent').map((p) => p.name),
  },
  user: {
    description: 'User names',
    example: 'user:Jane',
    names: (target) =>
      target.participants.filter((p) => p.kind === 'user').map((p) => p.name),
  },
  participant: {
    description: 'Agent or user names',
    example: 'participant:Alice',
    names: (target) => target.participants.map((p) => p.name),
  },
} satisfies Record<string, SearchFilterDefinition>

export type SessionSearchFilterKey = keyof typeof SESSION_SEARCH_FILTERS

export type SessionSearchClause = {
  key: SessionSearchFilterKey
  values: string[]
}

export type SessionSearch = {
  text: string
  clauses: SessionSearchClause[]
}

export function isSessionSearchFilter(
  key: string,
): key is SessionSearchFilterKey {
  return Object.hasOwn(SESSION_SEARCH_FILTERS, key)
}

/** Requires every clause, allowing any value to match any name in that clause. */
export function matchesSessionSearch(
  clauses: readonly SessionSearchClause[],
  target: SessionSearchTarget,
): boolean {
  return clauses.every(({ key, values }) => {
    const names = SESSION_SEARCH_FILTERS[key]
      .names(target)
      .map((name) => name.toLowerCase())
    return values.some((value) =>
      names.some((name) => name.includes(value.toLowerCase())),
    )
  })
}
