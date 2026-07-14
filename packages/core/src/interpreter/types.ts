export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export type EvalContext = {
  user?: string
  assistant?: string
  owner?: string
  tools?: string[]
  isAdmin?: boolean
  userCount?: number
  agentCount?: number
}

export interface VariableStore {
  get(key: string): JsonValue | undefined
  set(key: string, value: JsonValue): void
  toRecord(): Record<string, JsonValue>
  isDirty(): boolean
  markClean(): void
}

export type Segment =
  | { type: 'literal'; text: string }
  | { type: 'block'; code: string }
  | { type: 'inline'; expr: string }
