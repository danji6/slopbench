import { directoryBrowseError } from '@/lib/chat/directory-browse-error'
import { expect, test } from 'bun:test'

test('missing folders get a useful message without system details', () => {
  const message =
    "ENOENT: no such file or directory, realpath '/home/user/gone'"
  expect(directoryBrowseError(new Error(message))).toBe('Directory not found')
  expect(directoryBrowseError({ data: { message } })).toBe(
    'Directory not found',
  )
})

test.each(['EACCES', 'EPERM'])(
  'permission error %s explains the access failure',
  (code) => {
    expect(directoryBrowseError(new Error(`${code}: permission denied`))).toBe(
      'You don’t have access to this directory',
    )
  },
)

test('file paths and unknown failures get distinct messages', () => {
  expect(directoryBrowseError(new Error('ENOTDIR: not a directory'))).toBe(
    'This path isn’t a directory',
  )
  expect(directoryBrowseError(new Error('Unexpected service response'))).toBe(
    'Couldn’t open this folder',
  )
})
