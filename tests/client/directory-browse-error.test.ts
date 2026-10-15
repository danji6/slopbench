import { directoryBrowseError } from '@/lib/chat/directory-browse-error'
import { expect, test } from 'bun:test'

test('missing folders get a useful message without system details', () => {
  const message =
    "ENOENT: no such file or directory, realpath '/home/user/gone'"
  expect(directoryBrowseError(new Error(message))).toBe(
    'Folder not found. Check the path and try again.',
  )
  expect(directoryBrowseError({ data: { message } })).toBe(
    'Folder not found. Check the path and try again.',
  )
})

test.each(['EACCES', 'EPERM'])(
  'permission error %s suggests checking access',
  (code) => {
    expect(directoryBrowseError(new Error(`${code}: permission denied`))).toBe(
      'You don’t have access to this folder. Choose another folder or check its permissions.',
    )
  },
)

test('file paths and unknown failures get distinct instructions', () => {
  expect(directoryBrowseError(new Error('ENOTDIR: not a directory'))).toBe(
    'This path isn’t a folder. Choose a folder and try again.',
  )
  expect(directoryBrowseError(new Error('Unexpected service response'))).toBe(
    'Couldn’t open this folder. Try again.',
  )
})
