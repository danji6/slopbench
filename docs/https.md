# HTTPS with a Reverse Proxy

This guide shows how to put a reverse proxy in front of the app with automatic
Let's Encrypt certificates. You need a machine that can receive traffic on ports
80 and 443.

## 1. Expose the ports

A browser talks to three listeners:

| Service          | Local port | Purpose                  |
| ---------------- | ---------- | ------------------------ |
| Frontend         | `4173`     | The web app              |
| Convex backend   | `3210`     | Queries, mutations       |
| Convex HTTP site | `3211`     | Auth, uploads, shell SSE |

**With a domain**, give each listener a hostname, all served over 443:

```
client.example.com       ->  127.0.0.1:4173
server-ws.example.com    ->  127.0.0.1:3210
server-site.example.com  ->  127.0.0.1:3211
```

Point all three at your public IP with `A` records (or one `A` plus two
`CNAME`s), and forward ports 80 and 443.

**Without a domain**, forward 80, 443, 3210 and 3211. \
Let's Encrypt [certifies IP addresses](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability),
but the certificate is bound to the address and lasts six days, so this needs a
static public IP and a machine that stays online to renew. If your address
changes or you are behind CGNAT, borrow a hostname instead:

- [sslip.io](https://sslip.io)
- [DuckDNS](https://www.duckdns.org)

## 2. Configure the app

`.env.local` in the project root:

```sh
FRONTEND_URL=https://client.example.com
CONVEX_SELF_HOSTED_URL=https://server-ws.example.com
CONVEX_SITE_URL=https://server-site.example.com

# The proxy should be the only way in
CONVEX_INTERFACE=127.0.0.1
FRONTEND_HOST=127.0.0.1

# Set this once your own account exists
DISABLE_SIGNUP=true
```

Write the origins exactly as a browser sends them, no trailing slash or port.

`CONVEX_INTERFACE` and `FRONTEND_HOST` are important. By default the app binds
`0.0.0.0` and would answer plain HTTP on 3210/3211/4173 to anyone who reaches it
directly, bypassing your proxy entirely.

**Without a domain**, you need to move the app off 3210/3211 to let the proxy
have them:

```sh
FRONTEND_URL=https://YOUR_PUBLIC_IP
CONVEX_SELF_HOSTED_URL=https://YOUR_PUBLIC_IP:3210
CONVEX_SITE_URL=https://YOUR_PUBLIC_IP:3211
CONVEX_PORT=4210
CONVEX_SITE_PORT=4211
```

Remember to also configure your firewall if you use one. Example with `ufw`:

```sh
sudo ufw allow 80,443/tcp  # add 3210,3211 if you have no domain
```

## 3. Run Caddy

[Caddy](https://caddyserver.com/docs/install) obtains and renews certificates on
its own, redirects HTTP to HTTPS, and passes the Convex websocket through
without extra directives. Write `/etc/caddy/Caddyfile`:

```caddyfile
client.example.com {
	reverse_proxy 127.0.0.1:4173
}

server-ws.example.com {
	reverse_proxy 127.0.0.1:3210
}

server-site.example.com {
	reverse_proxy 127.0.0.1:3211
}
```

Without a domain, name the ports and ask for a public certificate. Caddy issues
its own untrusted one for an IP address otherwise. Needs Caddy 2.11 or newer:

```caddyfile
{
	cert_issuer acme {
		profile shortlived
	}
}

https://YOUR_PUBLIC_IP {
	reverse_proxy 127.0.0.1:4173
}

https://YOUR_PUBLIC_IP:3210 {
	reverse_proxy 127.0.0.1:4210
}

https://YOUR_PUBLIC_IP:3211 {
	reverse_proxy 127.0.0.1:4211
}
```

```sh
sudo systemctl enable --now caddy
sudo journalctl -u caddy -f     # watch the first issuance
```

Failed issuance is almost always DNS not resolving yet, or port 80 not reaching
the machine. A "local" or "internal" certificate in the log means the
`cert_issuer` block is not being applied.

## 4. Start the app

```sh
./start.sh
```

You do **not** need `--expose`. `FRONTEND_URL` already tells the backend which
origin to trust. Never use `--expose` on a public deployment, it trusts every
origin, which lets any website you visit make authenticated requests to your
deployment.

Open your frontend URL and sign in.

## 5. Troubleshooting

| Symptom                         | Cause                            |
| ------------------------------- | -------------------------------- |
| Loads, but nothing streams      | websocket to the backend blocked |
| Sign-in fails                   | wrong `CONVEX_SITE_URL`          |
| Avatars and images broken       | wrong `CONVEX_SELF_HOSTED_URL`   |
| Signs in, then every call fails | typo in an origin                |

From another machine, `curl http://YOUR_HOST:3210/version` should refuse to
connect.

## Alternatives

**nginx**, if you already run it. One `server` block for each hostname with
`proxy_pass` to the local port, `certbot` for certificates, and these lines on
the backend block or the websocket will not connect:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 3600s;
```

**A VPN**, if the app never needs to be public. WireGuard or Tailscale encrypt
and authenticate both ends, nothing is exposed to the internet, and the default
configuration works as-is over the VPN address.

**A private CA**, for LAN use. [`mkcert`](https://github.com/FiloSottile/mkcert)
issues certificates for local names and IP addresses. Install its root CA on
every device that connects, otherwise the app will hang on the websocket and
auth calls.

**Other ports**: `CONVEX_PORT`, `CONVEX_SITE_PORT` and `FRONTEND_PORT` move the
local listeners. Update the `reverse_proxy` targets to match; the public URLs
are unaffected.
