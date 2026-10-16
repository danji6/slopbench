import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@sb/core/auth'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { username } from 'better-auth/plugins'
import { expect, test } from 'bun:test'

const ORIGIN = 'http://localhost:4178'
const OLD_PASSWORD = 'old-password-fixture'
const NEW_PASSWORD = 'new-password-fixture'

function fixtureAuth() {
  return betterAuth({
    baseURL: ORIGIN,
    secret: 'synthetic-test-auth-secret-9e72434f09d8444e8be7',
    database: memoryAdapter({
      user: [],
      account: [],
      session: [],
      verification: [],
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
    },
    plugins: [username()],
    rateLimit: { enabled: false },
    logger: { disabled: true },
  })
}

type FixtureAuth = ReturnType<typeof fixtureAuth>

async function request(
  auth: FixtureAuth,
  path: string,
  body?: unknown,
  cookie?: string,
) {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}

function sessionCookie(response: Response) {
  const cookies = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
  expect(cookies.length).toBeGreaterThan(0)
  return cookies.join('; ')
}

async function signIn(auth: FixtureAuth, password = OLD_PASSWORD) {
  return request(auth, 'sign-in/username', {
    username: 'fixture_user',
    password,
  })
}

test('password changes revoke other sessions, rotate the current session and replace the credential', async () => {
  const auth = fixtureAuth()
  const signup = await request(auth, 'sign-up/email', {
    email: 'fixture-user@sb.local',
    username: 'fixture_user',
    name: 'Fixture user',
    password: OLD_PASSWORD,
  })
  expect(signup.status).toBe(200)
  const firstCookie = sessionCookie(signup)
  const secondCookie = sessionCookie(await signIn(auth))

  const denied = await request(
    auth,
    'change-password',
    {
      currentPassword: 'wrong-password',
      newPassword: NEW_PASSWORD,
      revokeOtherSessions: true,
    },
    firstCookie,
  )
  expect(denied.status).toBe(400)
  expect((await denied.json()).code).toBe('INVALID_PASSWORD')
  expect(
    await (await request(auth, 'get-session', undefined, secondCookie)).json(),
  ).not.toBeNull()

  const changed = await request(
    auth,
    'change-password',
    {
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
      revokeOtherSessions: true,
    },
    firstCookie,
  )
  expect(changed.status).toBe(200)
  const currentCookie = sessionCookie(changed)
  expect(
    await (await request(auth, 'get-session', undefined, currentCookie)).json(),
  ).not.toBeNull()
  expect(
    await (await request(auth, 'get-session', undefined, secondCookie)).json(),
  ).toBeNull()
  expect((await signIn(auth)).ok).toBe(false)
  expect((await signIn(auth, NEW_PASSWORD)).ok).toBe(true)

  const loggedOut = await request(auth, 'sign-out', {}, currentCookie)
  expect(loggedOut.status).toBe(200)
  expect(
    await (await request(auth, 'get-session', undefined, currentCookie)).json(),
  ).toBeNull()
})
