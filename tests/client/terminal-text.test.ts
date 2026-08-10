/// <reference types="bun-types" />
import { createTextTerminal } from '@/lib/terminal-text'
import { describe, expect, test } from 'bun:test'

import { setupDom } from '../setup/dom'

setupDom()

function mount() {
  const scroll = document.createElement('div')
  const pre = document.createElement('pre')
  scroll.appendChild(pre)
  document.body.appendChild(scroll)
  return {
    pre,
    terminal: createTextTerminal({ scroll: () => scroll, lines: () => pre }),
    lines: () => [...pre.children].map((line) => line.textContent),
  }
}

describe('createTextTerminal', () => {
  test('appends one element per line and keeps the last one open', () => {
    const { terminal, lines } = mount()
    terminal.write('first\nsecond')
    expect(lines()).toEqual(['first', 'second'])

    terminal.write(' half\nthird')
    expect(lines()).toEqual(['first', 'second half', 'third'])
  })

  test('rewrites the open line on a carriage return', () => {
    const { terminal, lines } = mount()
    terminal.write('downloading 10%')
    terminal.write('\rdownloading 90%')
    expect(lines()).toEqual(['downloading 90%'])
  })

  test('renders colors as spans and plain text as text nodes', () => {
    const { terminal, pre } = mount()
    terminal.write('plain \u001b[31mred\u001b[0m')

    const spans = pre.querySelectorAll('span')
    expect(spans).toHaveLength(1)
    expect(spans[0]?.textContent).toBe('red')
    expect(spans[0]?.style.color).toBe('var(--shiki-red)')
    expect(pre.textContent).toBe('plain red')
  })

  test('buffers writes until the elements exist, then flushes', () => {
    const pre = document.createElement('pre')
    const terminal = createTextTerminal({
      scroll: () => null,
      lines: () => (attached ? pre : null),
    })
    let attached = false

    terminal.write('early\n')
    expect(pre.children).toHaveLength(0)

    attached = true
    terminal.flush()
    expect([...pre.children].map((line) => line.textContent)).toEqual([
      'early',
      '',
    ])
  })

  test('clear() drops the rendered lines and the scanner state', () => {
    const { terminal, pre, lines } = mount()
    terminal.write('\u001b[31mred')
    terminal.clear()
    terminal.write('plain')

    expect(lines()).toEqual(['plain'])
    expect(pre.querySelectorAll('span')).toHaveLength(0)
  })
})
