import { createConnection, Connection } from "mysql2/promise"
import { IRedirectIndex, IRedirectLink, IRedirectLinkPublic } from "./interfaces/interfaces";
import { log } from "node:console";

interface Env {
	HYPERDRIVE: Hyperdrive;
	LOGDB: D1Database;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const requestId = crypto.randomUUID();

		console.log(`[${requestId}] Received request: ${request.url}`);

		const url = new URL(request.url)
		const segments = url.pathname.split('/').filter(Boolean);

		if (segments.length === 0 || segments.length > 1) {
			return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400 })
		}

		const sql = await getConnection(env)
		const shortname = segments[0]
		const query = url.searchParams.get("shortname")

		if (shortname === "index") {
			return await handleIndexRequest(request, env, sql, query || undefined, ctx)
		} else {
			return await handleRedirectRequest(request, env, sql, shortname, ctx)
		}
	},
} satisfies ExportedHandler<Env>;

async function getConnection(env: Env) {
	const sql = await createConnection({
		host: env.HYPERDRIVE.host,
		user: env.HYPERDRIVE.user,
		password: env.HYPERDRIVE.password,
		database: env.HYPERDRIVE.database,
		port: env.HYPERDRIVE.port,

		disableEval: true,
	})
	return sql
}

async function logRequest(req: Request, env: Env, requestId: string, shortname: string, redirected_to: string | null, custom_result: string | null): Promise<void> {
	const logObject = {
		request_id: requestId,
		originating_ip: req.headers.get("CF-Connecting-IP") || "",
		user_agent: req.headers.get("User-Agent") || "",
		originating_platform: req.headers.get("Sec-CH-UA-Platform")?.replace('\'', "") || "Unknown",
		redirect_application: shortname,
		redirected_to: redirected_to,
		full_request_url: req.url,
		request_method: req.method,
		result: custom_result ? custom_result : (redirected_to ? "Redirected" : "Unknown"),
		shortname_query: req.url.includes("?shortname=") ? new URL(req.url).searchParams.get("shortname") : null,
		referrer: req.headers.get("Referer") || "",
		timestamp: new Date().toISOString(),
	}
	await env.LOGDB
	.prepare(`INSERT INTO logs 
		(request_id, originating_ip, user_agent, originating_platform, redirect_application, redirected_to, full_request_url, request_method, result, shortname_query, referrer, timestamp) 
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
	).run()
}

async function updateCount(sql: Connection, shortname: string): Promise<void> {
	await sql.query(`UPDATE api_redirect_links SET used_count = used_count + 1 WHERE shortname = ?`, [shortname])
}

async function handleRedirectRequest(req: Request, env: Env, sql: Connection, shortname: string, ctx: ExecutionContext): Promise<Response> {
	ctx.waitUntil(updateCount(sql, shortname))

	const redirectUrl = await fetchRedirectLink(sql, shortname)
	if (!redirectUrl) {
		ctx.waitUntil(
			logRequest(req, env, crypto.randomUUID(), shortname, null, "Shortname not found")
		)
		return new Response(JSON.stringify({ error: "Shortname not found" }), { status: 404 })
	}
	ctx.waitUntil(
		logRequest(req, env, crypto.randomUUID(), shortname, redirectUrl, "Redirected")
	)
	return Response.redirect(redirectUrl, 302)
}

async function handleIndexRequest(req: Request, env: Env, sql: Connection, query: string | undefined, ctx: ExecutionContext): Promise<Response> {
	const redirectLinks = await fetchRedirectIndex(sql, query)
	const responseData: IRedirectIndex = {
		links_count: redirectLinks.length,
		root_url: "https://aka.tophhie.cloud",
		links: redirectLinks
	}
	ctx.waitUntil(
		logRequest(req, env, crypto.randomUUID(), "index", null, "Index requested")
	)
	return new Response(JSON.stringify(responseData), { status: 200, headers: { "Content-Type": "application/json" } })
}

async function fetchRedirectLink(sql: Connection, shortname: string): Promise<string | null> {
	const [rows] = await sql.query<IRedirectLink[]>(`SELECT redirect_url FROM api_redirect_links WHERE shortname = ?`, [shortname])
	if (rows.length === 0) {
		return null
	}
	return rows[0].redirect_url
}

async function fetchRedirectIndex(sql: Connection, query: string | undefined): Promise<IRedirectLinkPublic[]> {
	var command: string;
	if (query) {
		command = `SELECT title, shortname, redirect_url, CONCAT('https://aka.tophhie.cloud/', shortname) AS short_url FROM api_redirect_links WHERE shortname = ? ORDER BY title ASC`
	} else {
		command = `SELECT title, shortname, redirect_url, CONCAT('https://aka.tophhie.cloud/', shortname) AS short_url FROM api_redirect_links WHERE indexed = 1 ORDER BY title ASC`
	}
	const [rows] = await sql.query<IRedirectLinkPublic[]>(command, [query])
	return rows
}