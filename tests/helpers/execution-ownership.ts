import { lifecycleDatabase } from '~/tests/helpers/lifecycle-db'

export const execution = { streamId: 'stream' as never, generation: 2 }

export function fixture(status = 'streaming') {
  return lifecycleDatabase({
    streams: [
      {
        _id: 'stream',
        generation: 3,
        attempt: 0,
        sessionId: 'session',
        command: { kind: 'invoke' },
        state: {
          phase: status,
          processingMessageId: 'message',
          processingContentId: 'content',
        },
      },
    ],
    messages: [{ _id: 'message', status: 'processing' }],
    messageContents: [
      { _id: 'content', parts: [{ type: 'text', text: 'new output' }] },
    ],
  })
}

export function shellFixture() {
  return lifecycleDatabase({
    shellJobs: [
      {
        _id: 'watch',
        generation: 1,
        watcherId: 'scheduled',
        heartbeatAt: 0,
        sessionId: 'session',
        jobId: 'shell',
        term: 'old',
        termOffset: 3,
      },
    ],
    sessions: [{ _id: 'session', ownerId: 'owner', folderId: 'folder' }],
    sessionFolders: [
      {
        _id: 'folder',
        ownerId: 'owner',
        sources: [{ id: 'root', path: '/work', label: 'Work' }],
        revision: 0,
      },
    ],
  })
}

export const watcher = { shellJobId: 'watch' as never, generation: 1 }
