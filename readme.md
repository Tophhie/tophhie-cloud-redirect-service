# tophhie-cloud-redirect-service

Cloudflare Worker that serves short-link redirects for `aka.tophhie.cloud` and `aka.tophhie.dev`.

## What it does

- `GET /` redirects to `https://aka.tophhie.cloud/index`
- `GET /:shortname` looks up `shortname` in MySQL (via Hyperdrive)
- If found, returns `302` to `redirect_url`
- If missing, returns `404` JSON: `{"error":"Shortname not found"}`
- `GET /index` returns indexed links
- `GET /index?shortname=foo` returns one matching link (if found)
- Every request is logged to D1 asynchronously
- Request limits are enforced with a Cloudflare `RateLimit` binding

## Runtime and bindings

Worker entrypoint: `src/index.ts`

`Env` bindings used by the Worker:

```ts
interface Env {
  HYPERDRIVE: Hyperdrive;
  LOGDB: D1Database;
  DEFAULT_RATE_LIMITER: RateLimit;
}
```

Configured in `wrangler.jsonc`:

- `hyperdrive` binding: `HYPERDRIVE`
- `d1_databases` binding: `LOGDB`
- `ratelimits` binding: `DEFAULT_RATE_LIMITER` (`100` requests per `60` seconds per key/IP)
- `compatibility_flags`: `nodejs_compat` (required for `mysql2`)
- custom domains:
  - `aka.tophhie.dev`
  - `aka.tophhie.cloud`

After changing bindings in `wrangler.jsonc`, regenerate Worker types:

```bash
npm run cf-typegen
```

## Data model expectations

MySQL table expected by redirect/index queries:

- table: `api_redirect_links`
- columns used:
  - `title`
  - `shortname`
  - `redirect_url`
  - `used_count`
  - `indexed`

D1 table expected by request logging:

- table: `logs`
- columns used:
  - `request_id`
  - `originating_ip`
  - `user_agent`
  - `originating_platform`
  - `redirect_application`
  - `redirected_to`
  - `full_request_url`
  - `request_method`
  - `result`
  - `shortname_query`
  - `referrer`
  - `timestamp`

## Local development

```bash
npm install
npm run cf-typegen
npm run dev
```

`npm run dev` starts `wrangler dev`.

## Deploy

```bash
npm run deploy
```

This runs `wrangler deploy` using `wrangler.jsonc`.

## API behavior

### `GET /`

- `302` redirect to canonical index URL (`https://aka.tophhie.cloud/index`)

### `GET /index`

- Returns:
  - `200` JSON
  - shape:

```json
{
  "links_count": 0,
  "root_url": "https://aka.tophhie.cloud",
  "links": []
}
```

### `GET /index?shortname=<name>`

- Returns only rows matching the requested shortname

### `GET /:shortname`

- `302` redirect when found
- `404` JSON when not found
- `400` JSON when stored redirect URL is invalid

### Invalid path shape

- Requests with more than one URL segment (for example `/a/b`) return `400` JSON

## Test command

```bash
npm test
```

Vitest is configured, but this repo currently has no test files.
