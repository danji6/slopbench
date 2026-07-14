# Slopbench (temporary name)

A self-hosted AI workspace for agentic work, creative writing, and
collaborative sessions.

## What it does

- One tool for both coding/agentic workflows and creative writing.
- Invite anyone to participate in your sessions, be it agents or other humans.
- Create agents with their own behavior, prompts, tools and appearance.
- Work with files in the same way you would with any harness.
- Bring your own model providers.

## Requirements

- [Bun](https://bun.sh/)

## Run locally

Install dependencies:

```sh
bun install
```

Start the app:

```sh
./start.sh
```

Open:

```text
http://localhost:4173
```

The runner starts the frontend, self-hosted Convex backend, Convex functions,
and local sidecar server. It creates `.env.local` with local secrets on first
run and stores local data under `.data/`.

## First setup

After signing in, open Settings and add at least one model provider under
Models. Then create or edit an agent and select a model for it.

Workspace tools require an admin user and a bound workspace. The first created
user is automatically made an admin.
Tools that can change files or run commands ask for approval before executing.

## Access from another device

On your local network, you can still start normally:

```sh
./start.sh
```

Then open `http://YOUR_HOST_LAN_IP:4173` from the other device.

Make sure the other device can reach these ports on the host:

- `4173` for the frontend
- `3210` for the Convex backend
- `3211` for Convex HTTP actions and auth

The app automatically trusts local-network origins for auth.

### Access from outside your network

To let someone connect over the internet, forward these ports from your router
or tunnel to the machine running `chat`:

- `4173`
- `3210`
- `3211`

Then start with the public frontend URL:

```sh
./start.sh --expose=http://YOUR_PUBLIC_HOST_OR_IP:4173
```

The `--expose` URL must be the public frontend origin. The browser also needs to
be able to reach the forwarded Convex ports `3210` and `3211`.

`--expose` without a URL trusts any origin and is intended only for quick
testing.

### Maintenance

Run `bun run prune` if your data folder ever grows too large.

## Development

```sh
./dev.sh
```

Development mode also starts the local Convex dashboard when Docker is
available:

```text
http://localhost:6791/
```

To log in, copy `CONVEX_SELF_HOSTED_ADMIN_KEY` from `.env.local` and paste it
into the dashboard login form.

Useful checks:

```sh
bun test
bun typecheck
bun lint
bun run build
```
