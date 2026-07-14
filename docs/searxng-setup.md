# SearXNG Setup for Web Search

This guide explains how to set up a local SearXNG instance for the `web_search` tool. It requires having `docker` and `docker-compose` installed and configured.

## 1. Create `docker-compose.yml`

Create an empty folder (`/path/to/searxng`), then a `docker-compose.yml` file in it with the following contents:

```yaml
name: searxng-local

services:
  searxng:
    image: docker.io/searxng/searxng:latest
    container_name: searxng-local
    restart: unless-stopped
    ports:
      - '127.0.0.1:8888:8080'
    volumes:
      - ./config:/etc/searxng:rw
      - searxng-cache:/var/cache/searxng:rw
    environment:
      SEARXNG_BASE_URL: 'http://127.0.0.1:8888/'
      FORCE_OWNERSHIP: 'true'

volumes:
  searxng-cache:
```

This binds SearXNG to `127.0.0.1:8888`.

## 3. Create `config/settings.yml`

Generate a secret key:

```sh
openssl rand -hex 32
```

Create `/path/to/searxng/config/settings.yml` and replace `CHANGE_ME` with the generated value:

```yaml
use_default_settings: true

general:
  debug: false
  instance_name: 'Local SearXNG'

search:
  safe_search: 0
  autocomplete: ''
  default_lang: ''
  formats:
    - html
    - json

server:
  base_url: 'http://127.0.0.1:8888/'
  secret_key: 'CHANGE_ME'
  limiter: false
  public_instance: false
  image_proxy: false
  method: 'GET'

outgoing:
  request_timeout: 5.0
  max_request_timeout: 10.0
  pool_connections: 100
  pool_maxsize: 20
```

The critical setting is:

```yaml
search:
  formats:
    - html
    - json
```

Without `json`, SearXNG rejects `/search?format=json`, which makes the app's `web_search` tool fail.

## 4. Start SearXNG

From the SearXNG directory:

```sh
docker compose up -d
```

Check status:

```sh
docker compose ps
```

View logs:

```sh
docker compose logs -f searxng
```

## 5. Configure the App

In the app, open Settings -> Tools and add a web search instance:

- Engine: `SearXNG`
- URL: `http://127.0.0.1:8888` (or `http://localhost:8888`)

Then make sure your agent has the `web_search` tool enabled.