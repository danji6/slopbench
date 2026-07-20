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
const planPrompts = [prompt('plan-framing')]

describe('planSnapshotEval', () => {
  test('no snapshot: evaluates everything and freezes items', () => {
    const plan = planSnapshotEval({
      cache: null,
      planMode: false,
      planPrompts: [],
      prompts,
    })
    expect(plan.evalItems).toEqual(prompts)

    const result = evaluated(prompts)
    expect(plan.snapshotPatch(result)).toEqual({ items: result })
    expect(plan.requestItems(result)).toEqual(result)
  })

  test('frozen snapshot in normal mode: no eval, request from snapshot', () => {
    const items = evaluated(prompts)
    const plan = planSnapshotEval({
      cache: { items },
      planMode: false,
      planPrompts: [],
      prompts,
    })
    expect(plan.evalItems).toEqual([])
    expect(plan.snapshotPatch([])).toBeNull()
    expect(plan.requestItems([])).toEqual(items)
  })

  test('first plan-mode invoke on a frozen base: plan block only', () => {
    const items = evaluated(prompts)
    const plan = planSnapshotEval({
      cache: { items },
      planMode: true,
      planPrompts,
      prompts,
    })
    expect(plan.evalItems).toEqual(planPrompts)

    const result = evaluated(planPrompts)
    expect(plan.snapshotPatch(result)).toEqual({ planItems: result })
    expect(plan.requestItems(result)).toEqual([...result, ...items])
  })

  test('no snapshot in plan mode: evaluates and splits both blocks', () => {
    const plan = planSnapshotEval({
      cache: null,
      planMode: true,
      planPrompts,
      prompts,
    })
    expect(plan.evalItems).toEqual([...planPrompts, ...prompts])

    const result = evaluated([...planPrompts, ...prompts])
    expect(plan.snapshotPatch(result)).toEqual({
      items: result.slice(1),
      planItems: result.slice(0, 1),
    })
    expect(plan.requestItems(result)).toEqual(result)
  })

  test('fully frozen snapshot in plan mode: composes frozen blocks', () => {
    const items = evaluated(prompts)
    const planItems = evaluated(planPrompts)
    const plan = planSnapshotEval({
      cache: { items, planItems },
      planMode: true,
      planPrompts,
      prompts,
    })
    expect(plan.evalItems).toEqual([])
    expect(plan.snapshotPatch([])).toBeNull()
    expect(plan.requestItems([])).toEqual([...planItems, ...items])
  })

  test('mode flip back to normal omits the frozen plan block', () => {
    const items = evaluated(prompts)
    const planItems = evaluated(planPrompts)
    const plan = planSnapshotEval({
      cache: { items, planItems },
      planMode: false,
      planPrompts: [],
      prompts,
    })
    expect(plan.evalItems).toEqual([])
    expect(plan.requestItems([])).toEqual(items)
  })
})
