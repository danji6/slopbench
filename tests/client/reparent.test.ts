/// <reference types="bun-types" />
import { hostBox, moveHost, trackHostFocus } from '@/lib/reparent'
import { afterEach, describe, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()

type Fixture = {
  host: HTMLElement
  inline: HTMLElement
  overlay: HTMLElement
  box: HTMLElement
  input: HTMLInputElement
}

function fixture(): Fixture {
  document.body.innerHTML = ''

  const inline = document.createElement('div')
  const overlay = document.createElement('div')
  document.body.append(inline, overlay)

  const host = document.createElement('div')
  host.style.display = 'contents'

  const wrapper = document.createElement('div')
  wrapper.style.display = 'contents'
  const box = document.createElement('div')
  const input = document.createElement('input')

  box.append(input)
  wrapper.append(box)
  host.append(wrapper)
  inline.append(host)

  return { host, inline, overlay, box, input }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('moveHost', () => {
  test('keeps the moved nodes alive rather than re-creating them', () => {
    const { host, inline, overlay, input } = fixture()

    moveHost(host, overlay)
    expect(host.parentElement).toBe(overlay)
    expect(overlay.contains(input)).toBe(true)
    expect(input.isConnected).toBe(true)

    moveHost(host, inline)
    expect(host.parentElement).toBe(inline)
    // Same node object, not a replacement rendered into the new slot
    expect(inline.querySelector('input')).toBe(input)
  })

  test('does nothing when the host already sits in the slot', () => {
    const { host, inline } = fixture()
    moveHost(host, inline)
    expect(host.parentElement).toBe(inline)
  })
})

describe('trackHostFocus', () => {
  test('restores the focus a move dropped', () => {
    const { host, overlay, input } = fixture()
    const focus = trackHostFocus(host)

    input.focus()
    expect(focus.target()).toBe(input)

    moveHost(host, overlay)
    focus.restore()
    expect(document.activeElement).toBe(input)

    focus.stop()
  })

  test('forgets focus the user moved away from the host', () => {
    const { host, input } = fixture()
    const outside = document.createElement('input')
    document.body.append(outside)
    const focus = trackHostFocus(host)

    input.focus()
    outside.focus()

    expect(focus.target()).toBeNull()
    focus.stop()
  })

  test('stops listening once stopped', () => {
    const { host, input } = fixture()
    const focus = trackHostFocus(host)
    focus.stop()

    input.focus()
    expect(focus.target()).toBeNull()
  })
})

describe('hostBox', () => {
  test('walks past the `display: contents` wrappers to the real box', () => {
    const { host, box } = fixture()

    expect(hostBox(host)).toBe(box)
  })

  test('returns null for an empty host', () => {
    const host = document.createElement('div')
    host.style.display = 'contents'
    document.body.append(host)

    expect(hostBox(host)).toBeNull()
  })
})
