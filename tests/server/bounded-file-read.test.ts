import { TEXT_READ_BYTES, readTextPage } from '@sb/sidecar/files/read-text'
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

let root: string
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'bounded-read-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

test('bounds reads of huge single-line files and supplies byte continuation', async () => {
  const filename = path.join(root, 'huge.txt')
  const file = await open(filename, 'w')
  await file.truncate(1024 * 1024 * 1024)
  await file.write(
    Buffer.alloc(TEXT_READ_BYTES * 2 + 10, 120),
    0,
    TEXT_READ_BYTES * 2 + 10,
    0,
  )
  await file.close()
  const first = await readTextPage(filename)
  expect(Buffer.byteLength(first.content)).toBe(TEXT_READ_BYTES)
  expect(first.truncated).toBe(true)
  expect(first.nextByteOffset).toBe(TEXT_READ_BYTES)
  expect(first.totalLines).toBeUndefined()
  const next = await readTextPage(filename, {
    byteOffset: first.nextByteOffset,
  })
  expect(next.content.length).toBe(TEXT_READ_BYTES)
  expect(next.nextByteOffset).toBe(TEXT_READ_BYTES * 2)
})

test('retains line offset/limit behavior and handles CRLF', async () => {
  const filename = path.join(root, 'lines.txt')
  await writeFile(filename, 'one\r\ntwo\r\nthree\r\nfour')
  const page = await readTextPage(filename, { offset: 2, limit: 2 })
  expect(page.content).toBe('two\nthree')
  expect(page.nextByteOffset).toBe(17)
  expect(
    (await readTextPage(filename, { byteOffset: page.nextByteOffset })).content,
  ).toBe('four')
})

test('does not split multibyte characters between pages', async () => {
  const filename = path.join(root, 'unicode.txt')
  const text = 'x'.repeat(TEXT_READ_BYTES - 1) + '🌍end'
  await writeFile(filename, text)
  const first = await readTextPage(filename)
  const second = await readTextPage(filename, {
    byteOffset: first.nextByteOffset,
  })
  expect(first.content + second.content).toBe(text)
  expect(first.content).not.toContain('�')
})

test('rejects binary inspection and limits line-offset scans', async () => {
  const filename = path.join(root, 'binary.bin')
  await writeFile(filename, Buffer.from([0, 1, 2]))
  await expect(readTextPage(filename)).rejects.toThrow('Binary')
  const long = path.join(root, 'long.txt')
  await writeFile(long, 'x'.repeat(9 * 1024 * 1024))
  await expect(readTextPage(long, { offset: 2 })).rejects.toThrow('scan budget')
})
