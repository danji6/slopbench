/// <reference types="bun-types" />
import type { PromptItem } from '@sb/convex/model/prompt/prompts'
import { planSnapshotEval } from '@sb/convex/model/prompt/snapshots'
import { describe, expect, test } from 'bun:test'

function prompt(name: string, content = `${name} raw`): PromptItem {
  return {
    id: name,
    name,
    role: 'system',
    content,
    enabled: true,
    visible: false,
  }
}

function evaluated(items: PromptItem[]): PromptItem[] {
  return items.map((item) =>
    'content' in item
      ? { ...item, content: `${item.content} (evaluated)` }
      : item,
  )
}

const prompts = [prompt('system'), prompt('extra')]

describe('planSnapshotEval', () => {
  test('no snapshot: evaluates everything and freezes items', () => {
    const plan = planSnapshotEval({ cache: null, prompts })
    expect(plan.evalItems).toEqual(prompts)

    const result = evaluated(prompts)
    expect(plan.snapshotPatch(result)).toEqual({ items: result })
    expect(plan.requestItems(result)).toEqual(result)
  })

  test('frozen snapshot: no eval, request from snapshot', () => {
    const items = evaluated(prompts)
    const plan = planSnapshotEval({ cache: { items }, prompts })

    expect(plan.evalItems).toEqual([])
    expect(plan.snapshotPatch([])).toBeNull()
    expect(plan.requestItems([])).toEqual(items)
  })

  // Plan mode is framed by an injected note, never by the request prefix
  test('a mode flip cannot change the frozen prefix', () => {
    const items = evaluated(prompts)
    const plan = planSnapshotEval({ cache: { items }, prompts })

    expect(plan.requestItems([])).toEqual(items)
  })
})
