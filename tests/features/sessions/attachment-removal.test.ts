import { removeAttachment } from '@sb/convex/model/attachments'
import { describe, expect, test } from 'bun:test'
import { OWNER, makeCtx } from '~/tests/helpers/session-duplicate'

describe('refcount-safe attachment removal', () => {
  test('keeps blobs another session references, frees unreferenced ones', async () => {
    const { ctx, tables, deletedBlobs } = makeCtx()
    tables.sessions.push(
      { _id: 's_src', ownerId: OWNER },
      {
        _id: 's_copy',
        ownerId: OWNER,
      },
    )
    tables.attachments.push(
      {
        _id: 'att_src',
        fileId: 'file_shared',
        sessionId: 's_src',
        storageId: 'blob_shared',
        previewStorageId: 'thumb_shared',
      },
      {
        _id: 'att_copy',
        fileId: 'file_shared',
        sessionId: 's_copy',
        storageId: 'blob_shared',
        previewStorageId: 'thumb_shared',
      },
    )
    tables.attachmentFiles.push({
      _id: 'file_shared',
      storageId: 'blob_shared',
      previewStorageId: 'thumb_shared',
    })

    const srcRow = tables.attachments[0]
    await removeAttachment(ctx as never, srcRow as never)
    expect(deletedBlobs).not.toContain('blob_shared')
    expect(deletedBlobs).not.toContain('thumb_shared')
    expect(tables.attachments.some((row) => row._id === 'att_src')).toBe(false)

    // Once the copy goes too, nothing references the blobs anymore
    await removeAttachment(ctx as never, tables.attachments[0] as never)
    expect(deletedBlobs).toContain('blob_shared')
    expect(deletedBlobs).toContain('thumb_shared')
  })

  test('unshared blobs are freed immediately', async () => {
    const { ctx, tables, deletedBlobs } = makeCtx()
    tables.sessions.push({ _id: 's_solo', ownerId: OWNER })
    tables.attachments.push({
      _id: 'att_solo',
      fileId: 'file_private',
      sessionId: 's_solo',
      storageId: 'blob_private',
    })
    tables.attachmentFiles.push({
      _id: 'file_private',
      storageId: 'blob_private',
    })

    await removeAttachment(ctx as never, tables.attachments[0] as never)
    expect(deletedBlobs).toEqual(['blob_private'])
  })
})
