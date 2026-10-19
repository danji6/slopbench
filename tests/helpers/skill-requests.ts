import type { ActionCtx } from '@sb/convex/_generated/server'
import { prepare } from '@sb/convex/actions/stream/engineSetup'
import { _save, getBySessionAgent } from '@sb/convex/model/session/cache'
import { folderWorkspace } from '@sb/convex/model/session/folderTree'
import { prepareSkillContext } from '@sb/convex/model/skills/context'
import { assignments } from '@sb/convex/model/skills/endpoints'
import { prepareWorkspaceContext } from '@sb/convex/model/stream/contextNotes'
import { _getProviderHistory } from '@sb/convex/model/stream/reads'
import { filesystemToolContext } from '@sb/convex/model/tool/filesystemContext'
import type {
  PrepareContextNoteArgs,
  StreamExecutionArgs,
} from '@sb/convex/types'
import { projectSkillCatalog } from '@sb/sidecar/agent-files/project-catalog'
import { getFunctionName } from 'convex/server'

import { skillsDatabase } from './skills-db'

/** Exercises production request preparation and persisted skill notes against a local database. */
export function skillRequests(root: string) {
  const fixture = skillsDatabase()
  const { rows, db } = fixture
  const agent = {
    _id: 'agent',
    ownerId: 'owner',
    name: 'Agent',
    home: null as {
      path: string
      revision: number
      originAgentId?: string
    } | null,
    tools: ['read_file', 'write_file', 'edit_file', 'shell'],
    maskOtherAgents: false,
    shareUserDisplayNames: false,
    shareAgentDisplayNames: false,
  }
  const session = {
    _id: 'session',
    ownerId: 'owner',
    activeAgentId: 'agent',
    folderId: 'folder',
    model: { id: 'fixture-model' },
  }
  const folder = {
    _id: 'folder',
    name: 'Repo',
    ownerId: 'owner',
    revision: 1,
    sources: [{ id: 'root', path: root, label: 'Repo', discoverSkills: true }],
  }
  rows('agents').push(agent)
  rows('sessions').push(session)
  rows('users').push({ _id: 'owner', role: 'admin' })
  rows('sessionFolders').push(folder)
  let clock = 0
  const insert = db.insert
  db.insert = (table, fields) =>
    insert(table, { ...fields, _creationTime: ++clock })
  const execution = { streamId: 'stream', generation: 1 } as StreamExecutionArgs
  const snapshot = {
    items: [
      {
        id: 'system',
        name: 'System',
        role: 'system',
        enabled: true,
        visible: false,
        content: 'Frozen instructions',
      },
    ],
    _id: 'snapshot',
    sessionId: session._id,
    agentId: agent._id,
    filesystemAccess: true,
    tools: {
      names: [
        'read_file',
        'write_file',
        'edit_file',
        'shell',
        'shell_output',
        'kill_shell',
        'list_skills',
      ],
      shell: '/bin/bash',
    },
  }

  rows('sessionCache').push(snapshot)

  const action = {
    runQuery: async (
      reference: Parameters<typeof getFunctionName>[0],
      args: unknown,
    ) => {
      switch (getFunctionName(reference)) {
        case 'streams:_getContext': {
          const stream = await db.get('stream')
          if (stream?.generation !== (args as StreamExecutionArgs).generation)
            return null
          const output = await db.get(
            (stream.state as { processingMessageId: string })
              .processingMessageId,
          )
          return {
            stream: structuredClone(await db.get('stream')),
            session: {
              ...session,
              workspace: folderWorkspace(folder as never),
            },
            agent,
            invoker: { _id: 'owner', role: 'admin' },
            owner: { _id: 'owner' },
            settings: null,
            invokerSettings: null,
            ownerSettings: null,
            output,
            sessionCache: await getBySessionAgent(
              fixture.ctx,
              session._id as never,
              agent._id as never,
              true,
            ),
            environment: {},
            prompts: { own: [], library: [] },
            modelProviders: [
              {
                id: 'openai',
                enabled: true,
                apiKey: 'fixture',
                models: [{ id: 'fixture-model' }],
              },
            ],
            mcpServers: [],
            spawnableAgents: [],
          }
        }
        case 'streams:_getProviderHistory':
          return _getProviderHistory(fixture.ctx, args as StreamExecutionArgs)
        case 'streams:_getFilesystemContext':
          return filesystemToolContext(fixture.ctx, args as StreamExecutionArgs)
        case 'skills:_agent':
          return agent
        case 'skills:_assignments':
          return assignments(fixture.ctx, args as never)
        default:
          throw new Error(`Unexpected query ${getFunctionName(reference)}`)
      }
    },
    runMutation: async (
      reference: Parameters<typeof getFunctionName>[0],
      args: unknown,
    ) => {
      if (getFunctionName(reference) === 'streams:_prepareSkillContext')
        return prepareSkillContext(fixture.ctx, args as PrepareContextNoteArgs)
      if (getFunctionName(reference) === 'streams:_prepareWorkspaceContext')
        return prepareWorkspaceContext(
          fixture.ctx,
          args as PrepareContextNoteArgs,
        )
      if (getFunctionName(reference) === 'streams:_saveSessionCache')
        return _save(fixture.ctx, args as never)
      throw new Error(`Unexpected mutation ${getFunctionName(reference)}`)
    },
  } as unknown as ActionCtx

  async function nextTurn(text = 'Continue') {
    const previous = await db.get('stream')
    if (previous) {
      const outputId = (previous.state as { processingMessageId: string })
        .processingMessageId
      await db.patch(outputId, { status: 'done', contextEligible: true })
      const content = rows('messageContents').find(
        (row) => row.messageId === outputId,
      )!
      content.parts = [{ type: 'text', text: 'Previous reply' }]
    }
    const messageId = await db.insert('messages', {
      sessionId: session._id,
      status: 'done',
      contextEligible: true,
      selectedVersion: 1,
      sender: { type: 'user', id: 'owner' },
      senderName: 'User',
      role: 'user',
    })
    await db.insert('messageContents', {
      messageId,
      version: 1,
      segmentIndex: 0,
      parts: [{ type: 'text', text }],
    })
    const outputId = await db.insert('messages', {
      sessionId: session._id,
      status: 'processing',
      contextEligible: false,
      selectedVersion: 1,
      sender: { type: 'agent', id: agent._id },
      role: 'assistant',
    })
    const contentId = await db.insert('messageContents', {
      messageId: outputId,
      version: 1,
      segmentIndex: 0,
      parts: [],
    })
    const stream = {
      _id: 'stream',
      generation: 1,
      sessionId: 'session',
      agentId: agent._id,
      invokedBy: 'owner',
      command: { kind: 'invoke' },
      state: {
        phase: 'streaming',
        processingMessageId: outputId,
        processingContentId: contentId,
      },
      contextBoundaryCreationTime: (await db.get(messageId))!._creationTime,
    }
    const index = rows('streams').findIndex((row) => row._id === 'stream')
    if (index >= 0) rows('streams')[index] = stream
    else rows('streams').push(stream)
    return prepare(action, execution)
  }

  const originalFetch = globalThis.fetch
  const secret = process.env.SIDECAR_SECRET
  process.env.SIDECAR_SECRET = 'fixture-secret'
  globalThis.fetch = (async (url, init) => {
    if (String(url).endsWith('/agent-files/project-catalog')) {
      return Response.json(
        await projectSkillCatalog(JSON.parse(String(init?.body))),
      )
    }
    if (String(url).endsWith('/agent-files/status'))
      return Response.json({ exists: true })
    if (String(url).endsWith('/agent-files/home')) {
      const input = JSON.parse(String(init?.body))
      return Response.json(input)
    }
    if (String(url).endsWith('/agent-files/metadata'))
      return Response.json({ entries: [] })
    throw new Error(`Unexpected fetch ${String(url)}`)
  }) as typeof fetch

  return {
    ...fixture,
    folder,
    agent,
    nextTurn,
    async compact() {
      const last = Math.max(
        ...rows('messages').map((row) => Number(row._creationTime)),
      )
      const messageId = await db.insert('messages', {
        sessionId: 'session',
        type: 'summary',
        role: 'assistant',
        status: 'done',
        contextEligible: true,
        selectedVersion: 1,
        summaryBoundaryCreationTime: last,
        sender: { type: 'agent', id: agent._id },
      })
      await db.insert('messageContents', {
        messageId,
        version: 1,
        segmentIndex: 0,
        parts: [{ type: 'text', text: 'Summary' }],
      })
    },
    repeat: () => prepare(action, execution),
    restore: () => {
      globalThis.fetch = originalFetch
      if (secret === undefined) delete process.env.SIDECAR_SECRET
      else process.env.SIDECAR_SECRET = secret
    },
  }
}
