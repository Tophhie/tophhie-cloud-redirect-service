# 📄 `tophhie-cloud-redirect-service`

A simple **Cloudflare Worker** that powers `aka.tophhie.cloud` (and dev) –  
shortname‑based redirects with a public index and request logging.

---

## 🧠 Overview

- Requests to `/SHORTNAME` are looked up in a **Hyperdrive (MySQL)** database.
  - If found → 302 redirect to `redirect_url`.
  - If missing → 404 JSON error.
- `/index` returns JSON describing all indexed links (or a single shortname when
  queried).
- Each request is asynchronously logged into a **D1** database.
- The Worker uses `mysql2/promise` on the Node‑compatibility runtime.

---

## 🔧 Project structure

```
.
├─ src/
│  ├─ index.ts            ← Worker entrypoint
│  └─ interfaces/…
├─ package.json
├─ wrangler.jsonc         ← bindings, routes, flags
├─ tsconfig.json
└─ vitest.config.mts
```

---

## 🚀 Getting started

### Prerequisites

- [Cloudflare account](https://workers.cloudflare.com/)
- `wrangler` CLI (`npm install -g wrangler`)
- A **Hyperdrive** MySQL instance containing `api_redirect_links`
  (schema inferred from `src/interfaces/interfaces.ts`)
- A **D1 database** for logs (created/defined in `wrangler.jsonc`)

### Local development

```bash
# install deps
npm install

# build types for bindings
npm run cf-typegen

# start the worker locally
npm run dev          # serves on http://localhost:8787 by default
```

The `wrangler dev` session will simulate Hyperdrive and D1 via the bindings
you configure in your `wrangler.toml`/`.env` (set `HYPERDRIVE_*` vars).

### Deploy

```bash
npm run deploy       # runs `wrangler deploy`
// optionally specify --env production, --env staging, etc.
```

> ✅ Make sure `wrangler.jsonc` contains your custom domains and your
>   `hyperdrive`/`d1_databases` bindings are correct before deploying.

---

## 📡 API

### Redirect

```
GET https://aka.tophhie.cloud/:shortname
```

- **302** to the `redirect_url` stored under `shortname`.
- **404** with `{ error: "Shortname not found" }` when missing.

### Index

```
GET https://aka.tophhie.cloud/index
GET https://aka.tophhie.cloud/index?shortname=foo
```

Response body (`IRedirectIndex`):

```json
{
  "links_count": 42,
  "root_url": "https://aka.tophhie.cloud",
  "links": [
    {
      "title": "My service",
      "shortname": "service",
      "redirect_url": "https://example.com/…",
      "short_url": "https://aka.tophhie.cloud/service"
    },
    …
  ]
}
```

When `shortname` query param is supplied, only that record is returned (if any).

---

## 🔒 Environment & bindings

`Env` interface used in `src/index.ts`:

```ts
interface Env {
  HYPERDRIVE: Hyperdrive;   // MySQL connection details
  LOGDB: D1Database;        // D1 instance for logging
  DEFAULT_RATE_LIMITER: RateLimit;  // rate limiter binding
}
```

Set the following environment variables (typical for Hyperdrive):

```
HYPERDRIVE_HOST=
HYPERDRIVE_USER=
HYPERDRIVE_PASSWORD=
HYPERDRIVE_DATABASE=
HYPERDRIVE_PORT=
```

`wrangler.jsonc` already declares the two bindings used by the worker.  The file also includes a `ratelimits` section:

```jsonc
"ratelimits": [
  {
    "name": "DEFAULT_RATE_LIMITER",
    "namespace_id": "1001",
    "simple": { "limit": 100, "period": 60 }
  }
]
```

This produces the `RateLimit` binding available as `env.DEFAULT_RATE_LIMITER`. Adjust the `limit`/`period` values as needed and rerun `wrangler deploy`.

---

## 🧪 Testing

Basic tests can be added using [Vitest](https://vitest.dev/).  
The repo includes `vitest.config.mts` and the Cloudflare pool plugin.

Run:

```bash
npm test
```

(There are currently no tests; add some to exercise index/redirect logic.)

---

## 📌 Notes & tips

- `updateCount` increments a `used_count` field in Hyperdrive – executed
  via `ctx.waitUntil()` to avoid blocking the response.
- Logging is non‑blocking and stores metadata such as IP, UA, referrer, etc.
- `nodejs_compat` flag enables the mysql2 client to work in the worker.
- The code checks a per-IP rate limiter at the top of `fetch`; a 429
  response is returned when the limit (configured under `ratelimits` in
  `wrangler.jsonc`) is exceeded.
- Requests are gated by a simple per-IP rate limiter; exceeding the configured
  threshold returns HTTP 429. Configuration is located under `ratelimits` in
  `wrangler.jsonc`.

---

Feel free to extend with authentication, management endpoints, or a UI
around the index.

Happy redirecting! 🌀