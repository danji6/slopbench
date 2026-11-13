import type { Id } from '@cv/convex/_generated/dataModel'
import type { ActionCtx } from '@cv/convex/_generated/server'
import { prepare } from '@cv/convex/actions/stream/engineSetup'
import { prepareChanges } from '@cv/convex/model/changes'
import { reserveStream } from '@cv/convex/model/chat/reserve'
import { _save, removeForSession } from '@cv/convex/model/session/cache'
import { prepareSkillContext } from '@cv/convex/model/skills/context'
import { assignments } from '@cv/convex/model/skills/endpoints'
import { prepareCapabilities } from '@cv/convex/model/stream/capabilities'
import { prepareWorkspaceContext } from '@cv/convex/model/stream/contextNotes'
import { _getContext, _getProviderHistory } from '@cv/convex/model/stream/reads'
import { filesystemToolContext } from '@cv/convex/model/tool/filesystemContext'
import { assertToolAccess } from '@cv/convex/model/tool/liveAccess'
import { availableToolkits } from '@cv/convex/model/toolkits/access'
import { executionToolkits } from '@cv/convex/model/toolkits/execution'
import { observe } from '@cv/convex/model/toolkits/observation'
import { skillContext } from '@cv/convex/model/toolkits/skills'
import type {
  PrepareContextNoteArgs,
  StreamExecutionArgs,
} from '@cv/convex/types'
import {
  toolkitCatalogSchema,
  toolkitSkillCatalog,
} from '@cv/sidecar/toolkits/catalog'
import { inspectToolkit } from '@cv/sidecar/toolkits/manifest'
import { getFunctionName } from 'convex/server'
import { type Value, convexToJson, jsonToConvex } from 'convex/values'

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
    tools: ['read_file', 'edit_files', 'shell', 'skills'],
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
  rows('userSessions').push({
    _id: 'membership',
    sessionId: session._id,
    userId: 'owner',
    role: 'owner',
  })
  rows('users').push({ _id: 'owner', role: 'admin' })
  rows('sessionFolders').push(folder)
  let clock = 0
  const insert = db.insert
  db.insert = (table, fields) =>
    insert(table, { ...fields, _creationTime: ++clock })
  const execution = { streamId: 'stream', generation: 1 } as StreamExecutionArgs
  rows('prompts').push({
    _id: 'system-prompt',
    ownerId: 'owner',
    agentId: 'agent',
    scope: 'own',
    item: {
      id: 'system',
      name: 'System',
      role: 'system',
      enabled: true,
      visible: false,
      content: 'Frozen instructions',
    },
  })

  const action = {
    runQuery: async (
      reference: Parameters<typeof getFunctionName>[0],
      args: unknown,
    ) => {
      args = convexRoundTrip(args)
      switch (getFunctionName(reference)) {
        case 'streams:_getContext': {
          if (!agent.home && 'homeId' in agent) {
            await db.patch(String(agent.homeId), { path: undefined })
          }
          if (agent.home) {
            Object.assign(agent, { homeId: 'fixture-home' })
            const home = {
              _id: 'fixture-home',
              ownerId: 'owner',
              originAgentId: 'agent',
              ...agent.home,
            }
            const previous = rows('agentHomes').find(
              (row) => row._id === home._id,
            )
            if (previous) Object.assign(previous, home)
            else rows('agentHomes').push(home)
          }
          const data = await _getContext(
            fixture.ctx,
            args as StreamExecutionArgs,
          )
          return (
            data &&
            convexRoundTrip({
              ...data,
              modelProviders: [
                {
                  id: 'openai',
                  enabled: true,
                  apiKey: 'fixture',
                  models: [{ id: 'fixture-model' }],
                },
              ],
            })
          )
        }
        case 'streams:_assertToolAccess':
          return assertToolAccess(fixture.ctx, args as never)
        case 'streams:_getProviderHistory':
          return _getProviderHistory(fixture.ctx, args as StreamExecutionArgs)
        case 'streams:_getFilesystemContext':
          return filesystemToolContext(fixture.ctx, args as StreamExecutionArgs)
        case 'toolkits:_execution':
          return executionToolkits(fixture.ctx, args as StreamExecutionArgs)
        case 'toolkits:_available':
          return availableToolkits(
            fixture.ctx,
            (args as { agentId: Id<'agents'> }).agentId,
            (args as { sessionId?: Id<'sessions'> }).sessionId,
          )
        case 'toolkits:_skillContext':
          return skillContext(fixture.ctx, args as StreamExecutionArgs)
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
      args = convexRoundTrip(args)
      if (getFunctionName(reference) === 'toolkits:_observe')
        return observe(fixture.ctx, args as never)
      if (getFunctionName(reference) === 'streams:_prepareCapabilities')
        return prepareCapabilities(fixture.ctx, args as never)
      if (getFunctionName(reference) === 'chat:_prepareChanges')
        return prepareChanges(fixture.ctx, args as never)
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
    const previous = await db.get(execution.streamId)
    if (previous) {
      const outputId = (previous.state as { processingMessageId: string })
        .processingMessageId
      await db.patch(outputId, { status: 'done', contextEligible: true })
      const content = rows('messageContents').find(
        (row) => row.messageId === outputId,
      )!
      content.parts = [{ type: 'text', text: 'Previous reply' }]
      await db.delete(previous._id)
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
    rows('sessionAgents').splice(0, rows('sessionAgents').length, {
      _id: 'link',
      sessionId: session._id,
      agentId: agent._id,
    })
    const streamId = await reserveStream(fixture.ctx, {
      sessionId: session._id as never,
      agentId: agent._id as never,
      invokedBy: 'owner' as never,
      boundaryId: messageId as never,
      command: { kind: 'invoke' },
    })
    if (!streamId) throw new Error('Expected a reserved stream')
    execution.streamId = streamId
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
    await db.patch(streamId, {
      state: {
        phase: 'streaming',
        processingMessageId: outputId,
        processingContentId: contentId,
      },
    })
    return prepare(action, execution)
  }

  const originalFetch = globalThis.fetch
  const secret = process.env.SIDECAR_SECRET
  process.env.SIDECAR_SECRET = 'fixture-secret'
  globalThis.fetch = (async (url, init) => {
    if (String(url).endsWith('/eval/prompts')) {
      const input = JSON.parse(String(init?.body))
      return Response.json({
        items: input.items,
        environment: input.environment,
        dirty: false,
      })
    }
    if (String(url).endsWith('/shell/info'))
      return Response.json({ shell: '/bin/bash' })
    if (String(url).endsWith('/checkpoints/begin'))
      return Response.json({ queued: false })
    if (String(url).endsWith('/toolkits/inspect')) {
      const input = JSON.parse(String(init?.body))
      return Response.json(await inspectToolkit(input.root))
    }
    if (String(url).endsWith('/toolkits/catalog')) {
      return Response.json(
        await toolkitSkillCatalog(
          toolkitCatalogSchema.parse(JSON.parse(String(init?.body))),
        ),
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
    action,
    execution,
    nextTurn,
    async compact() {
      await removeForSession(fixture.ctx, 'session' as never)
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

/** Reproduces Convex's key ordering and omission of undefined object fields. */
function convexRoundTrip<T>(value: T): T {
  return jsonToConvex(convexToJson(value as Value)) as T
}
