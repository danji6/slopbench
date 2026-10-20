import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { captureRequest } from '../helpers/provider-request'
import { skillRequests } from '../helpers/skill-requests'

type WireMessage = { role: string; content: unknown }

test.each([false, true])(
  'reservation and preparation announce the workspace once (personal folder: %s)',
  async (personalFolder) => {
    const root = await mkdtemp(path.join(tmpdir(), 'context-notes-'))
    const fixture = skillRequests(root)
    try {
      if (personalFolder) {
        fixture.agent.home = { path: '/fixture-personal-home', revision: 1 }
      }
      const directory = path.join(root, '.agents/skills/review')
      await mkdir(directory, { recursive: true })
      await writeFile(
        path.join(directory, 'SKILL.md'),
        '---\nname: review\ndescription: Review this project\n---\nReview instructions',
      )
      const first = (await fixture.nextTurn('List skills'))!
      const notes = fixture
        .rows('messages')
        .filter((row) => row.type === 'workspace')
      expect(notes).toHaveLength(1)
      expect(notes[0].extra).toMatchObject({
        anchorMessageId: first.output._id,
      })
      expect(String(first.stream.contextBoundaryMessageId)).toBe(
        fixture.rows('messages')[0]._id,
      )

      const initial = await captureRequest('openrouter', first)
      const messages = initial.messages as WireMessage[]
      expect(messages.map((item) => item.role)).toEqual([
        'system',
        'user',
        'system',
        'system',
      ])
      expect(JSON.stringify(messages[2].content)).toContain(
        'Folder: \\"Repo\\"',
      )
      expect(JSON.stringify(messages[3].content)).toContain(
        'Review this project',
      )
      const personalGuidance = personalFolder
        ? 'Your persistent personal folder is agent://'
        : 'No personal folder is currently available'
      expect(JSON.stringify(messages[2].content)).toContain(personalGuidance)
      if (personalFolder) {
        expect(JSON.stringify(messages)).not.toContain(
          'No personal folder is currently available',
        )
      }
      expect((await fixture.repeat())!.messages).toEqual(first.messages)

      // A tool step replays the context before the same turn's assistant output.
      const content = fixture
        .rows('messageContents')
        .find((row) => row.messageId === first.output._id)!
      content.parts = [
        {
          type: 'tool-list_skills',
          toolCallId: 'call_1',
          state: 'output-available',
          input: {},
          output: { entries: [] },
        },
      ]
      const continuation = (await fixture.repeat())!
      const next = await captureRequest('openrouter', continuation)
      const continued = next.messages as WireMessage[]
      expect(continued.slice(0, messages.length)).toEqual(messages)
      expect(continued.slice(messages.length).map((item) => item.role)).toEqual(
        ['assistant', 'tool'],
      )

      await fixture.nextTurn()
      expect(
        fixture.rows('messages').filter((row) => row.type === 'workspace'),
      ).toHaveLength(1)
      expect(
        fixture.rows('messages').filter((row) => row.type === 'skills'),
      ).toHaveLength(1)
    } finally {
      fixture.restore()
      await rm(root, { recursive: true, force: true })
    }
  },
)
