/// <reference types="bun-types" />
import { renderSanitizedHtml } from '@/lib/markdown/html'
import { describe, expect, test } from 'bun:test'

describe('sanitized html previews', () => {
  test('keeps allowed markup', () => {
    expect(renderSanitizedHtml('<b>x</b>')).toBe('<b>x</b>')
    expect(renderSanitizedHtml('a <em>b</em> c')).toBe('a <em>b</em> c')
  })

  test('keeps inline styling, which is the point of previewing html', () => {
    expect(renderSanitizedHtml('<div style="color:red">x</div>')).toContain(
      'style="color:red"',
    )
  })

  test('drops scripts and javascript urls', () => {
    expect(renderSanitizedHtml('<script>alert(1)</script>')).toBe('')
    expect(
      renderSanitizedHtml('<a href="javascript:alert(1)">x</a>'),
    ).not.toContain('javascript:')
  })

  test('renders nothing for markup with no visible content', () => {
    expect(renderSanitizedHtml('<span></span>')).toBe('')
    expect(renderSanitizedHtml('<b>   </b>')).toBe('')
    expect(renderSanitizedHtml('<div><span></span></div>')).toBe('')
  })

  test('counts self-sufficient elements as visible', () => {
    expect(renderSanitizedHtml('<br>')).toBe('<br>')
    expect(renderSanitizedHtml('<img src="a.png">')).toContain('<img')
    expect(renderSanitizedHtml('<div><hr></div>')).toContain('<hr>')
  })

  test('returns the same string for a repeated source', () => {
    const source = '<div style="color:red">🎉</div>'
    expect(renderSanitizedHtml(source)).toBe(renderSanitizedHtml(source))
  })
})
