import { ScrollCoordinator } from '@/lib/scroll-coordinator'
import { describe, expect, test } from 'bun:test'

describe('scroll operation ownership', () => {
  test('navigation supersedes restoration and rejects passive follow', () => {
    const coordinator = new ScrollCoordinator()
    let cancelled = false
    const restore = coordinator.begin('restore')!
    restore.onCancel(() => {
      cancelled = true
    })
    const navigate = coordinator.begin('navigate')!
    expect(cancelled).toBe(true)
    expect(restore.isCurrent()).toBe(false)
    expect(navigate.isCurrent()).toBe(true)
    expect(coordinator.begin('follow')).toBeNull()
    expect(coordinator.begin('restore')).toBeNull()
  })

  test('manual input invalidates delayed work until following explicitly resumes', () => {
    const coordinator = new ScrollCoordinator()
    const operation = coordinator.begin('navigate')!
    const layoutCurrent = coordinator.checkpoint()
    coordinator.interrupt()
    expect(operation.isCurrent()).toBe(false)
    expect(layoutCurrent()).toBe(false)
    expect(coordinator.begin('follow')).toBeNull()
    coordinator.resumeFollow()
    expect(coordinator.begin('follow')).not.toBeNull()
  })

  test('editing blocks following and stale completion cannot release a new owner', () => {
    const coordinator = new ScrollCoordinator()
    const old = coordinator.begin('restore')!
    const next = coordinator.begin('navigate')!
    old.finish()
    expect(next.isCurrent()).toBe(true)
    next.finish()
    coordinator.setEditing(true)
    expect(coordinator.begin('follow')).toBeNull()
    coordinator.setEditing(false)
    expect(coordinator.begin('follow')).not.toBeNull()
  })
})
