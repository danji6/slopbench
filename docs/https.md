# HTTPS with a Reverse Proxy

This (Linux) guide shows how to put a reverse proxy in front of the app with
automatic Let's Encrypt certificates using Caddy. You need a machine that can
receive traffic on ports 80 and 443.

## 1. Expose the ports

A browser talks to three listeners:

| Service          | Local port | Purpose                       |
| ---------------- | ---------- | ----------------------------- |
| Frontend         | `4173`     | The web app                   |
| Convex backend   | `3210`     | Queries, mutations, websocket |
| Convex HTTP site | `3211`     | Auth, uploads, shell SSE      |

**With a domain**, give each listener a hostname, all served over 443:

```
app.example.com   ->  127.0.0.1:4173
srv.example.com   ->  127.0.0.1:3210
site.example.com  ->  127.0.0.1:3211
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
# No trailing slash or port
FRONTEND_URL=https://app.example.com
CONVEX_SELF_HOSTED_URL=https://srv.example.com
CONVEX_SITE_URL=https://site.example.com

# The proxy should be the only way in
CONVEX_INTERFACE=127.0.0.1
FRONTEND_HOST=127.0.0.1

# Set this once your own account exists
DISABLE_SIGNUP=true
```

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
sudo ufw allow 80,443/tcp # 3210,3211 if you have no domain
```

## 3. Run Caddy

[Caddy](https://caddyserver.com/docs/install) obtains and renews certificates on
its own, redirects HTTP to HTTPS, and passes the Convex websocket through
without extra directives. Write `/etc/caddy/Caddyfile`:

```caddyfile
app.example.com {
	reverse_proxy 127.0.0.1:4173
}

srv.example.com {
	reverse_proxy 127.0.0.1:3210
}

site.example.com {
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

From another machine, `curl http://YOUR_HOST:3210` (or `3211`) should refuse to
connect.

## Alternatives

### SSH tunnel

If you are the only user, an SSH tunnel is a viable alternative to HTTPS.

Leave `FRONTEND_URL`, `CONVEX_SELF_HOSTED_URL` and `CONVEX_SITE_URL` unset and
bind the listeners to loopback:

```sh
CONVEX_INTERFACE=127.0.0.1
FRONTEND_HOST=127.0.0.1
```

Run `./start.sh`, then from the client machine:

```sh
ssh -N \
  -L 4173:localhost:4173 \
  -L 3210:localhost:3210 \
  -L 3211:localhost:3211 \
  user@host
```

Then in the client browser open <http://localhost:4173>.

To make it easier, you can add this to `~/.ssh/config` on the client:

```
Host your_host_machine
	HostName your_ip
	User your_host_user
	IdentityFile /path/to/key
	IdentitiesOnly yes
	ServerAliveInterval 30
	LocalForward 4173 localhost:4173
	LocalForward 3210 localhost:3210
	LocalForward 3211 localhost:3211
```

Then `ssh -N your_host_machine`.

Before forwarding port 22, it's advised to harden the host's SSH configuration
to disable password authentication and root login.
In `/etc/ssh/sshd_config.d/10-hardening.conf`:

```sh
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowUsers YOUR_USER
MaxAuthTries 3
```

Generate an SSH key on the client (with a passphrase) by using `ssh-keygen`,
then copy it to the host with `ssh-copy-id user@host`. After that, reload the
service on the host to apply the hardening: `sudo systemctl reload sshd`.
