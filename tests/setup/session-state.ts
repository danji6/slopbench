type StateDoc = Record<string, unknown>

/**
 * A stand-in for the `sessionState` table (see `model/session/state.ts`). Hot
 * session state — approvals, the command queue, reminder baselines, usage —
 * lives beside the session doc rather than on it, so the hand-rolled contexts
 * in these suites route its reads and writes through here.
 */
export function fakeSessionState(
  initial: StateDoc | null = null,
  sessionId = 'session_1',
) {
  const id = 'sessionState_1'
  const patches: StateDoc[] = []
  let row: StateDoc | null = initial
    ? { _id: id, sessionId, updatedAt: 0, ...initial }
    : null

  const record = (doc: StateDoc) => {
    const { _id, sessionId: _sessionId, updatedAt: _updatedAt, ...rest } = doc
    patches.push(rest)
  }

  return {
    id,
    /** Every write, in order, without the bookkeeping fields. */
    patches,
    get row() {
      return row
    },
    /** True when a document id addresses the state row. */
    owns: (docId: string) => docId === id,
    /** Return this from `db.query('sessionState').withIndex(…)`. */
    query: () => ({ unique: async () => row }),
    insert: (doc: StateDoc) => {
      record(doc)
      row = { _id: id, ...doc }
      return id
    },
    patch: (patch: StateDoc) => {
      record(patch)
      row = { ...row, ...patch }
    },
  }
}
