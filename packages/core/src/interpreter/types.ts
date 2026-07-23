export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue } // prettier-ignore

export type EvalContext = {
  user?: string
  assistant?: string
  owner?: string
  tools?: string[]
  isAdmin?: boolean
  userCount?: number
  agentCount?: number
  workDir?: string
}

export interface VariableStore {
  get(key: string): JsonValue | undefined
  set(key: string, value: JsonValue): void
  toRecord(): Record<string, JsonValue>
  isDirty(): boolean
  markClean(): void
}

/** The condition of an `#if`/`#elif` directive. */
export type Condition =
  | { kind: 'expr'; expr: string }
  | { kind: 'block'; code: string } // prettier-ignore

export type Segment =
  | { type: 'literal'; text: string }
  | { type: 'block'; code: string }
  | { type: 'inline'; expr: string }
  | { type: 'if'; cond: Condition }
  | { type: 'elif'; cond: Condition }
  | { type: 'else' }
  | { type: 'endif' }
