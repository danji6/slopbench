# Slopbench (temporary name)

A self-hosted, collaborative AI workspace for agentic work, creative writing and
general AI use.

## Disclaimer

This application is still in early development, lacks some features and may
contain dangerous bugs. Use at your own risk. Always keep copies of your local
files if you're giving AI access to them.

## What it does

This application aims to give you full control over your models. Some features:

- Create agents with their own behavior, prompts, tools and appearance
- Work with files like you would in a coding harness
- Let your agents spawn sub-agents for side tasks
- Connect to external MCP servers
- Invite anyone to participate in your sessions, be it agents or other humans

## Requirements

- [Bun](https://bun.sh/)

Other requirements are downloaded automatically on launch. These include:

- [Convex](https://github.com/get-convex/convex-backend)
- [Node.js (pinned to v24)](https://nodejs.org)

## Run locally

Install dependencies:

```sh
bun install
```

Start the app:

```sh
./start.sh
```

On Windows:

```powershell
.\start.ps1
```

Open:

```text
http://localhost:4173
```

## First setup

After signing in, open Settings and add at least one model provider under
Models. Then create or edit an agent and select a model for it.

Workspace tools require an admin user and a bound workspace. The first created
user is automatically made an admin. \
You can then disable signups if you wish via `.env.local`:

```sh
DISABLE_SIGNUP=true
```

## Access from another device

On your local network, you can start normally, then open
`http://YOUR_HOST_LAN_IP:4173` from the other device.

Make sure the other device can reach these ports on the host:

- `4173` for the frontend
- `3210` for the Convex backend
- `3211` for Convex HTTP actions and auth

### Access from outside your network

**Set up HTTPS first**. See [docs/https.md](docs/https.md). Over plain HTTP your
password, session, and messages are **unencrypted**, and anyone on the network
path can spy on you or even hack you.

If you accept the risk of an unencrypted deployment, forward ports `4173`,
`3210`, and `3211` from your router and start with the public frontend URL:

```sh
./start.sh --expose=http://YOUR_PUBLIC_HOST_OR_IP:4173
```

The `--expose` URL must be the public frontend origin. Omitting the URL trusts
**any** origin, which lets any site you visit make authenticated requests to
your deployment. Don't do that on a public address.

### Additional configuration

It's recommended to set up a [SearXNG](https://github.com/searxng/searxng)
instance if you want to give your models access to the internet, see
[docs/searxng.md](docs/searxng.md).

### Maintenance

Run `bun run prune` if your `.data` folder ever grows too large.

## Development

```sh
./dev.sh
```

On Windows, `.\dev.ps1`.

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
