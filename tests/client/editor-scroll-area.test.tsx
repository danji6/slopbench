/// <reference types="bun-types" />
import { EditorScrollArea } from '@/components/ui/editor-scroll-area'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

describe('EditorScrollArea', () => {
  test('owns the bounded editor scroll contract', () => {
    const html = renderToStaticMarkup(
      <EditorScrollArea editor={null} className="custom" />,
    )

    expect(html).toContain('min-h-0')
    expect(html).toContain('flex-1')
    expect(html).toContain('overflow-auto')
    expect(html).toContain('custom')
  })
})
