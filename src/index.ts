import { createConnection, Connection } from "mysql2/promise";
import { IRedirectIndex, IRedirectLink, IRedirectLinkPublic } from "./interfaces/interfaces";

interface Env {
  HYPERDRIVE: Hyperdrive;
  LOGDB: D1Database;
  DEFAULT_RATE_LIMITER: RateLimit;
}

const CANONICAL_HOST = "aka.tophhie.cloud";
const ALLOWED_METHODS = new Set(["GET", "HEAD"]);

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const connectingIp = request.headers.get("CF-Connecting-IP") || "Undefined";
    const { success } = await env.DEFAULT_RATE_LIMITER.limit({ key: connectingIp });
    if (!success) {
      return jsonResponse({ error: "Too many requests." }, 429);
    }

    if (!ALLOWED_METHODS.has(request.method)) {
      return jsonResponse({ error: "Method not allowed" }, 405, { Allow: "GET, HEAD" });
    }

    const url = new URL(request.url);
    const segments = url.pathname.split("/").filter(Boolean);

    if (segments.length === 0) {
      return Response.redirect(`https://${CANONICAL_HOST}/index`, 302);
    }

    if (segments.length > 1) {
      return jsonResponse({ error: "Too many URL segments. Please provide only one." }, 400);
    }

    const shortname = segments[0];
    if (!/^[a-zA-Z0-9_-]+$/.test(shortname)) {
      return jsonResponse({ error: "Invalid shortname format" }, 400);
    }

    const sql = await getConnection(env);
    try {
      const query = url.searchParams.get("shortname");
      if (shortname === "index" || shortname === "private-index") {
        return await handleIndexRequest(
          request,
          env,
          sql,
          query || undefined,
          CANONICAL_HOST,
          ctx,
          shortname === "index"
        );
      }

      return await handleRedirectRequest(request, env, sql, shortname, ctx);
    } catch (error) {
      console.error("Request handling failed", error);
      ctx.waitUntil(logRequest(request, env, crypto.randomUUID(), shortname, null, "Worker error"));
      return jsonResponse({ error: "Service temporarily unavailable" }, 503);
    } finally {
      await sql.end();
    }
  },
} satisfies ExportedHandler<Env>;

function jsonResponse(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

async function getConnection(env: Env) {
  return createConnection({
    host: env.HYPERDRIVE.host,
    user: env.HYPERDRIVE.user,
    password: env.HYPERDRIVE.password,
    database: env.HYPERDRIVE.database,
    port: env.HYPERDRIVE.port,
    disableEval: true,
  });
}

async function logRequest(
  req: Request,
  env: Env,
  requestId: string,
  shortname: string,
  redirected_to: string | null,
  custom_result: string | null
): Promise<void> {
  const logObject = {
    request_id: requestId,
    originating_ip: req.headers.get("CF-Connecting-IP") || "0.0.0.0",
    user_agent: req.headers.get("User-Agent") || null,
    originating_platform:
      req.headers.get("Sec-CH-UA-Platform")?.replace(/"/g, "") || "Unknown",
    redirect_application: shortname,
    redirected_to,
    full_request_url: req.url,
    request_method: req.method,
    result: custom_result ? custom_result : redirected_to ? "Redirected" : "Unknown",
    shortname_query: req.url.includes("?shortname=")
      ? new URL(req.url).searchParams.get("shortname")
      : null,
    referrer: req.headers.get("Referer") || null,
    timestamp: new Date().toISOString(),
  };
  await env.LOGDB.prepare(
    `INSERT INTO logs 
      (request_id, originating_ip, user_agent, originating_platform, redirect_application, redirected_to,
       full_request_url, request_method, result, shortname_query, referrer, timestamp) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      logObject.request_id,
      logObject.originating_ip,
      logObject.user_agent,
      logObject.originating_platform,
      logObject.redirect_application,
      logObject.redirected_to,
      logObject.full_request_url,
      logObject.request_method,
      logObject.result,
      logObject.shortname_query,
      logObject.referrer,
      logObject.timestamp
    )
    .run();
}

async function updateCount(sql: Connection, shortname: string): Promise<void> {
  await sql.query(
    `UPDATE api_redirect_links SET used_count = used_count + 1 WHERE shortname = ?`,
    [shortname]
  );
}

async function handleRedirectRequest(
  req: Request,
  env: Env,
  sql: Connection,
  shortname: string,
  ctx: ExecutionContext
): Promise<Response> {
  const redirectUrl = await fetchRedirectLink(sql, shortname);
  if (!redirectUrl) {
    ctx.waitUntil(logRequest(req, env, crypto.randomUUID(), shortname, null, "Shortname not found"));
    return jsonResponse({ error: "Shortname not found" }, 404);
  }

  try {
    new URL(redirectUrl);
  } catch {
    ctx.waitUntil(logRequest(req, env, crypto.randomUUID(), shortname, null, "Invalid redirect target"));
    return jsonResponse({ error: "Invalid redirect target" }, 400);
  }

  ctx.waitUntil(updateCount(sql, shortname));
  ctx.waitUntil(logRequest(req, env, crypto.randomUUID(), shortname, redirectUrl, "Redirected"));
  return Response.redirect(redirectUrl, 302);
}

async function handleIndexRequest(
  req: Request,
  env: Env,
  sql: Connection,
  query: string | undefined,
  baseHost: string,
  ctx: ExecutionContext,
  publicIndex: boolean
): Promise<Response> {
  const redirectLinks = await fetchRedirectIndex(sql, query, baseHost, publicIndex);
  const responseData: IRedirectIndex = {
    links_count: redirectLinks.length,
    root_url: `https://${baseHost}`,
    links: redirectLinks,
  };
  const indexRoute = publicIndex ? "index" : "private-index";
  ctx.waitUntil(logRequest(req, env, crypto.randomUUID(), indexRoute, null, "Index requested"));
  return jsonResponse(responseData, 200);
}

async function fetchRedirectLink(
  sql: Connection,
  shortname: string
): Promise<string | null> {
  const [rows] = await sql.query<IRedirectLink[]>(
    `SELECT redirect_url FROM api_redirect_links WHERE shortname = ? and indexed = 1`,
    [shortname]
  );
  if (rows.length === 0) return null;
  return rows[0].redirect_url;
}

async function fetchRedirectIndex(
  sql: Connection,
  query: string | undefined,
  baseHost: string,
  publicIndex: boolean = true
): Promise<IRedirectLinkPublic[]> {
  let command: string;
  const params: string[] = [];
  const publicClause = publicIndex ? "AND public = 1" : "";
  if (query) {
    command = `SELECT title, shortname, redirect_url FROM api_redirect_links WHERE shortname = ? ${publicClause} AND indexed = 1 ORDER BY title ASC`;
    params.push(query);
  } else {
    command = `SELECT title, shortname, redirect_url FROM api_redirect_links WHERE indexed = 1 ${publicClause} ORDER BY title ASC`;
  }
  const [rows] = await sql.query<IRedirectLink[]>(command, params);
  return rows.map((row) => ({
    title: row.title,
    shortname: row.shortname,
    redirect_url: row.redirect_url,
    short_url: `https://${baseHost}/${row.shortname}`,
  }));
}
