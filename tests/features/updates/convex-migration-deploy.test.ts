/// <reference types="bun-types" />
import { describe, expect, test } from 'bun:test'
import {
  disableSchemaValidation,
  migrationBootMode,
  runMigrationDeployment,
} from '~/scripts/runner/convex'

type Event = 'deploy:migration' | 'migrate' | 'deploy:strict' | 'complete'

function deployment(...failAt: Event[]) {
  const events: Event[] = []
  const record = async (event: Event) => {
    events.push(event)
    if (failAt.includes(event)) throw new Error(`failed at ${event}`)
  }

  return {
    events,
    ops: {
      complete: () => record('complete'),
      deploy: (phase: 'migration' | 'strict') => record(`deploy:${phase}`),
      migrate: () => record('migrate'),
    },
  }
}

describe('runMigrationDeployment', () => {
  test('migrates between permissive and strict deployments', async () => {
    const { events, ops } = deployment()

    await runMigrationDeployment(ops)

    expect(events).toEqual([
      'deploy:migration',
      'migrate',
      'deploy:strict',
      'complete',
    ])
  })

  test('restores strict validation after migration failure', async () => {
    const { events, ops } = deployment('migrate')

    await expect(runMigrationDeployment(ops)).rejects.toThrow(
      'failed at migrate',
    )

    expect(events).toEqual(['deploy:migration', 'migrate', 'deploy:strict'])
  })

  test('reports when migration and strict recovery both fail', async () => {
    const { events, ops } = deployment('migrate', 'deploy:strict')

    await expect(runMigrationDeployment(ops)).rejects.toThrow(
      'strict schema validation could not be restored',
    )

    expect(events).toEqual(['deploy:migration', 'migrate', 'deploy:strict'])
  })

  test('does not mark a release complete when strict deployment fails', async () => {
    const { events, ops } = deployment('deploy:strict')

    await expect(runMigrationDeployment(ops)).rejects.toThrow(
      'failed at deploy:strict',
    )

    expect(events).toEqual(['deploy:migration', 'migrate', 'deploy:strict'])
  })
})

describe('migrationBootMode', () => {
  const complete = {
    key: 'schema' as const,
    phase: 'complete' as const,
    targetVersion: 3,
    updatedAt: 1,
    version: 3,
  }

  test('bootstraps databases without durable release state', () => {
    expect(migrationBootMode(undefined, 3)).toBe('migrate')
  })

  test('uses only the strict deploy when the release is current', () => {
    expect(migrationBootMode(complete, 3)).toBe('strict')
  })

  test('migrates skipped and interrupted releases', () => {
    expect(
      migrationBootMode({ ...complete, targetVersion: 2, version: 2 }, 3),
    ).toBe('migrate')
    expect(migrationBootMode({ ...complete, phase: 'migrating' }, 3)).toBe(
      'migrate',
    )
  })

  test('rejects an app older than the database migration state', () => {
    expect(() => migrationBootMode(complete, 2)).toThrow(
      "newer than this app's version",
    )
  })
})

describe('disableSchemaValidation', () => {
  test('changes only the isolated schema declaration', () => {
    expect(
      disableSchemaValidation(
        'const schemaValidation = true\nexport default schemaValidation\n',
      ),
    ).toBe('const schemaValidation = false\nexport default schemaValidation\n')
  })

  test('fails when the strict schema declaration drifts', () => {
    expect(() => disableSchemaValidation('export default true')).toThrow(
      'Could not locate the schema validation declaration',
    )
  })
})
