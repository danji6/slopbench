/// <reference types="bun-types" />
import { type FileItem, isTextFileItem } from '@/hooks/file-previews'
import {
  readAttachmentTextPreview,
  readTextPreview,
} from '@/lib/text-file-preview'
import { describe, expect, test } from 'bun:test'

function fileItem(
  name: string,
  type: string,
  url = 'data:text/plain,hello',
): FileItem {
  return { id: name, url, file: new File([], name, { type }) }
}

describe('text file viewer', () => {
  test('recognizes text MIME types and filenames without treating images as text', () => {
    expect(isTextFileItem(fileItem('notes.txt', 'text/plain'))).toBe(true)
    expect(isTextFileItem(fileItem('README.md', ''))).toBe(true)
    expect(isTextFileItem(fileItem('icon.svg', 'image/svg+xml'))).toBe(false)
    expect(isTextFileItem(fileItem('photo.png', 'image/png'))).toBe(false)
  })

  test('bounds streamed previews and preserves UTF-8 character boundaries', async () => {
    const content = 'abcd😀rest'
    const result = await readTextPreview(
      `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`,
      new AbortController().signal,
      6,
    )

    expect(result).toEqual({
      text: 'abcd',
      shownBytes: 4,
      truncated: true,
    })
  })

  test('reads a complete short preview', async () => {
    const result = await readTextPreview(
      'data:text/plain;charset=utf-8,one%0Atwo',
      new AbortController().signal,
      64,
    )

    expect(result).toEqual({
      text: 'one\ntwo',
      shownBytes: 7,
      truncated: false,
    })
  })

  test('shows the readable parts of an attachment with malformed UTF-8', async () => {
    const url = 'data:text/plain,%80first%0Asecond%FF%0Athird'
    const { signal } = new AbortController()

    expect(await readAttachmentTextPreview(url, signal)).toEqual({
      text: '�first\nsecond�\nthird',
      shownBytes: 20,
      truncated: false,
    })
    await expect(readTextPreview(url, signal)).rejects.toBeInstanceOf(TypeError)
  })
})
