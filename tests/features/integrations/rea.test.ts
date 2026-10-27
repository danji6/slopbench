import type { Id } from '@sb/convex/_generated/dataModel'
import { select } from '@sb/convex/model/integrations/selection'
import { remove } from '@sb/convex/model/integrations/settings'
import { resumeOperations, settle } from '@sb/convex/model/mcpOperationActions'
import { cancelForStream } from '@sb/convex/model/mcpOperations'
import { control, runtimeScope } from '@sb/convex/model/mcpRuntime'
import { _claim, _handoff } from '@sb/convex/model/stream/lifecycle'
import { mcpConnectionSchema } from '@sb/core/types'
import { integrationSkillCatalog } from '@sb/sidecar/integrations/catalog'
import { afterEach, expect, spyOn, test } from 'bun:test'
import { untilOperation } from '~/tests/helpers/mcp-operations'
import {
  type ReaFixture,
  reaConformanceFixture,
  reaData,
} from '~/tests/helpers/rea-conformance'

// Explicit opt-in: normal tests never download REA or depend on a developer's checkout.
const toolkit = process.env.SLOPBENCH_REA_ROOT
const conformance = test.skipIf(!toolkit)
let active: ReaFixture | undefined
afterEach(async () => {
  await active?.close()
  active = undefined
})

async function fixture() {
  return (active = await reaConformanceFixture(toolkit!))
}

conformance(
  'real REA catalog and retained JavaScript evidence survive later turns with isolated chats and children',
  async () => {
    const f = await fixture()
    const first = await f.turn()
    const session = reaData(await first.invoke('binary_session')).result
    expect(session.open).toBe(false)
    expect(session.server_identity.package.version).toBe(
      f.snapshot.manifest.version,
    )
    await verifyCatalog(f, first, session)
    const runtime = f
      .rows('mcpRuntimes')
      .find((row) => row.serverKey === f.serverKey)!
    expect(JSON.parse(String(runtime.initialization)).instructions).toContain(
      'REA provides',
    )
    const target = await f.target('alpha')
    const analysis = reaData(
      await first.invoke('analyze_javascript_application', {
        input_path: target,
      }),
    )
    expect(JSON.stringify(analysis)).toContain('example.invalid/alpha')
    const evidenceId = analysis.evidence_id
    expect(evidenceId).toMatch(/^ev_[a-f0-9]{64}$/)
    const generation = f.sidecar.registry.list()[0].generation
    await f.db.patch(first.execution.streamId, { state: { phase: 'complete' } })
    const later = await f.turn()
    await verifyRetained(later, evidenceId)
    expect(f.sidecar.registry.list()[0].generation).toBe(generation)
    await verifyOtherChat(f, evidenceId)
    await verifyChild(f, evidenceId)
    await remove(f.ctx, f.integrationId)
    await f.flushCleanup()
    expect(f.sidecar.registry.list()).toEqual([])
  },
  120_000,
)

conformance(
  'real REA survives watcher handoff without redispatching and receives durable cancellation',
  async () => {
    const f = await fixture()
    const turn = await f.turn()
    await turn.invoke('binary_session')
    const calls = spyOn(f.sidecar.registry, 'call')
    const target = await f.target('handoff')
    const detached = new AbortController()
    afterStart(() => detached.abort())
    const input = { input_path: target }
    await expect(
      turn.invoke(
        'analyze_javascript_application',
        input,
        'handoff-call',
        detached.signal,
      ),
    ).rejects.toThrow('watcher detached')
    expect(await _handoff(f.ctx, turn.execution)).toBe(true)
    turn.execution.generation++
    expect(await _claim(f.ctx, turn.execution)).not.toBeNull()
    expect(
      await resumeOperations(f.action, turn.execution, Date.now() + 30_000),
    ).toBe(true)
    const output = reaData(
      await turn.invoke(
        'analyze_javascript_application',
        input,
        'handoff-call',
      ),
    )
    expect(output.evidence_id).toMatch(/^ev_[a-f0-9]{64}$/)
    expect(
      calls.mock.calls.filter(
        (call) => call[1] === 'analyze_javascript_application',
      ),
    ).toHaveLength(1)
    await verifyCancellation(f, turn)
  },
  120_000,
)

/** Simulates watcher loss after the real sidecar has accepted the operation. */
function afterStart(callback: () => void | Promise<void>) {
  const original = globalThis.fetch
  let intercepted = false
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const response = await original(input, init)
      const operationStarted = new URL(String(input)).pathname.endsWith(
        '/operations/start',
      )
      if (!intercepted && operationStarted) {
        intercepted = true
        globalThis.fetch = original
        await callback()
      }
      return response
    },
    { preconnect: original.preconnect },
  )
}

async function verifyCancellation(f: ReaFixture, turn: Turn) {
  const target = await f.target('cancelled')
  afterStart(async () => {
    await cancelForStream(
      f.ctx,
      turn.execution.streamId,
      'Stopped by conformance test',
    )
    const row = f
      .rows('mcpOperations')
      .find((row) => row.toolCallId === 'cancel-call')!
    await settle(f.action, { operationId: row._id as Id<'mcpOperations'> })
  })
  await expect(
    turn.invoke(
      'analyze_javascript_application',
      { input_path: target },
      'cancel-call',
    ),
  ).rejects.toThrow('Stopped by conformance test')
  const row = f
    .rows('mcpOperations')
    .find((row) => row.toolCallId === 'cancel-call')!
  expect(row.state).toBe('cancelled')
  const status = await f.sidecar.operations.status({
    id: row._id,
    scope: row.scope,
  } as never)
  expect(status?.state).toBe('cancelled')
}

conformance(
  'real REA process failure requires explicit recovery and missing launch prerequisites are diagnosed',
  async () => {
    const f = await fixture()
    const turn = await f.turn()
    await turn.invoke('binary_session')
    const [pid] = await f.pids()
    expect(pid).toBeGreaterThan(0)
    process.kill(pid, 'SIGKILL')
    await untilOperation(
      async () => f.sidecar.registry.list()[0]?.state === 'lost',
    )
    await expect(turn.invoke('binary_session')).rejects.toThrow('lost')
    expect(await f.pids()).toEqual([pid])
    const scope = {
      ...f.sidecar.registry.list()[0].scope,
      key: crypto.randomUUID(),
      serverId: 'missing-prerequisite',
    }
    const missing = mcpConnectionSchema.parse({
      transport: 'stdio',
      command: `${f.root}/missing-node-runtime`,
    })
    await expect(f.sidecar.registry.connect(scope, missing)).rejects.toThrow()
    expect(f.sidecar.registry.status(scope)).toMatchObject({
      state: 'lost',
      stderr: expect.stringContaining('MCP executable could not be started'),
    })
  },
  120_000,
)

type Turn = Awaited<ReturnType<ReaFixture['turn']>>
type ReaSession = {
  tool_availability: { groups: { names: string[] }[] }
  server_identity: { catalog: { counts: { mcp_tools: number } } }
  analysis_provider_candidates: {
    provider: { id: string }
    availability: { status: string; reason: string }
  }[]
}

async function verifyCatalog(f: ReaFixture, turn: Turn, session: ReaSession) {
  const tools = []
  let cursor: string | undefined
  do {
    const page = await turn.search('', cursor)
    tools.push(...page.tools)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  const availabilityNames = session.tool_availability.groups.flatMap(
    (group) => group.names,
  )
  expect(tools.map((tool) => tool.name).sort()).toEqual(
    availabilityNames.sort(),
  )
  expect(tools.length).toBe(session.server_identity.catalog.counts.mcp_tools)
  expect(tools.length).toBeGreaterThan(100)
  expect(tools.filter((tool) => tool.diagnostic)).toEqual([])
  const skills = await integrationSkillCatalog({
    sources: [
      {
        root: f.snapshot.root,
        origin: 'REA',
        integrationId: f.integrationId,
        revision: f.snapshot.revision,
        disabledSkills: [],
      },
    ],
    assigned: [],
    offset: 0,
    limit: 100,
  })
  expect(
    skills.entries.some((skill) => skill.name === 'reverse-engineer-anything'),
  ).toBe(true)
  console.info(
    `REA ${f.snapshot.manifest.version}: ${tools.length} tools; ${skills.total} skills; native candidates:`,
    session.analysis_provider_candidates.map((candidate) => ({
      id: candidate.provider.id,
      status: candidate.availability.status,
      reason: candidate.availability.reason,
    })),
  )
}

async function verifyRetained(turn: Turn, evidenceId: string) {
  const bundle = reaData(
    await turn.invoke('get_evidence_bundle', { detail: 'summary' }),
  )
  expect(JSON.stringify(bundle)).toContain(evidenceId)
  const view = reaData(
    await turn.invoke('inspect_analysis_view', {
      source: { kind: 'retained-evidence', evidence_id: evidenceId },
      view: { kind: 'summary' },
    }),
  )
  expect(JSON.stringify(view)).toContain(evidenceId)
}

async function verifyOtherChat(f: ReaFixture, parentEvidence: string) {
  const sessionId = (await f.db.insert('sessions', {
    ownerId: 'owner',
  })) as Id<'sessions'>
  await f.db.insert('userSessions', {
    sessionId,
    userId: 'owner',
    role: 'owner',
  })
  const turn = await f.turn({ sessionId, agentId: f.agentId })
  const empty = reaData(
    await turn.invoke('get_evidence_bundle', { detail: 'summary' }),
  )
  expect(JSON.stringify(empty)).not.toContain(parentEvidence)
  const denied = await turn.invoke('inspect_analysis_view', {
    source: { kind: 'retained-evidence', evidence_id: parentEvidence },
    view: { kind: 'summary' },
  })
  expect(denied.result.isError).toBe(true)
  const target = await f.target('beta')
  const own = reaData(
    await turn.invoke('analyze_javascript_application', { input_path: target }),
  )
  expect(JSON.stringify(own)).toContain('example.invalid/beta')
  expect(JSON.stringify(own)).not.toContain('example.invalid/alpha')
  expect(own.evidence_id).not.toBe(parentEvidence)
  expect(f.sidecar.registry.list()).toHaveLength(2)
}

async function verifyChild(f: ReaFixture, parentEvidence: string) {
  const agentId = (await f.db.insert('agents', {
    ownerId: 'owner',
    name: 'Child',
    integrationIds: [f.integrationId],
  })) as Id<'agents'>
  const sessionId = (await f.db.insert('sessions', {
    ownerId: 'owner',
    parent: { sessionId: f.sessionId, agentId: f.agentId },
  })) as Id<'sessions'>
  const turn = await f.turn({ sessionId, agentId })
  const bundle = reaData(
    await turn.invoke('get_evidence_bundle', { detail: 'summary' }),
  )
  expect(JSON.stringify(bundle)).not.toContain(parentEvidence)
  expect(f.sidecar.registry.list()).toHaveLength(3)
  expect(
    f.sidecar.registry.list().some((row) => row.scope.sessionId === sessionId),
  ).toBe(true)
}

conformance(
  'real REA loses state only on explicit reconnect, deselection or workspace revocation',
  async () => {
    const f = await fixture()
    const turn = await f.turn()
    const target = await f.target('gamma')
    const analysis = reaData(
      await turn.invoke('analyze_javascript_application', {
        input_path: target,
      }),
    )
    const live = f
      .rows('mcpRuntimes')
      .find((row) => row.serverKey === f.serverKey)!
    const runtimeId = live._id as Id<'mcpRuntimes'>
    const previousScope = runtimeScope(live as never)
    await control(f.ctx, { runtimeId, reconnect: true })
    await f.flushCleanup()
    expect(f.sidecar.registry.list()).toEqual([])
    const fresh = reaData(
      await turn.invoke('get_evidence_bundle', { detail: 'summary' }),
    )
    expect(JSON.stringify(fresh)).not.toContain(analysis.evidence_id)
    expect(f.sidecar.registry.list()[0].scope.key).not.toBe(previousScope.key)
    await select(f.ctx, {
      integrationId: f.integrationId,
      agentId: f.agentId,
      enabled: false,
    })
    await expect(turn.invoke('binary_session')).rejects.toThrow('unavailable')
    await f.flushCleanup()
    await select(f.ctx, {
      integrationId: f.integrationId,
      agentId: f.agentId,
      enabled: true,
    })
    await expect(turn.invoke('binary_session')).rejects.toThrow('reconnect')
    await control(f.ctx, { runtimeId, reconnect: true })
    await f.flushCleanup()
    await turn.invoke('binary_session')
    await f.sidecar.registry.disconnectSessions([f.sessionId])
    expect(f.sidecar.registry.list()).toEqual([])
    await expect(turn.invoke('binary_session')).rejects.toThrow()
    await verifyWorkspaceChange(f, turn, runtimeId)
  },
  120_000,
)

async function verifyWorkspaceChange(
  f: ReaFixture,
  turn: Turn,
  runtimeId: Id<'mcpRuntimes'>,
) {
  await control(f.ctx, { runtimeId, reconnect: true })
  await f.flushCleanup()
  await turn.invoke('binary_session')
  const previous = f.sidecar.registry.list()[0]
  const target = await f.target('newworkspace')
  const folderId = await f.db.insert('sessionFolders', {
    ownerId: 'owner',
    name: 'Changed workspace',
    revision: 1,
    sources: [{ id: 'target', path: target, label: 'Target' }],
  })
  await f.db.patch(f.sessionId, { folderId })
  await turn.invoke('binary_session')
  const replacement = f.sidecar.registry.list()[0]
  expect(replacement.generation).not.toBe(previous.generation)
  await expect(
    f.sidecar.registry.call(previous.scope, 'binary_session', {}, previous),
  ).rejects.toThrow()
  const bundle = reaData(
    await turn.invoke('get_evidence_bundle', { detail: 'summary' }),
  )
  expect(bundle.result.records).toEqual([])
  await f.flushCleanup()
  expect(f.sidecar.registry.list()).toHaveLength(1)
}
