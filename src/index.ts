import { createConnection, Connection } from "mysql2/promise"
import { IRedirectIndex, IRedirectLink, IRedirectLinkPublic } from "./interfaces/interfaces";

interface Env {
	HYPERDRIVE: Hyperdrive;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url)
		const segments = url.pathname.split('/').filter(Boolean);

		if (segments.length === 0 || segments.length > 1) {
			return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400 })
		}

		const sql = await getConnection(env)
		const shortname = segments[0]
		const query = url.searchParams.get("shortname")

		if (shortname === "index") {
			return await handleIndexRequest(sql, query || undefined)
		} else {
			return await handleRedirectRequest(sql, shortname, ctx)
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

async function updateCount(sql: Connection, shortname: string): Promise<void> {
	await sql.query(`UPDATE api_redirect_links SET used_count = used_count + 1 WHERE shortname = ?`, [shortname])
}

async function handleRedirectRequest(sql: Connection, shortname: string, ctx: ExecutionContext): Promise<Response> {
	ctx.waitUntil(updateCount(sql, shortname))

	const redirectUrl = await fetchRedirectLink(sql, shortname)
	if (!redirectUrl) {
		return new Response(JSON.stringify({ error: "Shortname not found" }), { status: 404 })
	}
	return Response.redirect(redirectUrl, 302)
}

async function handleIndexRequest(sql: Connection, query: string | undefined): Promise<Response> {
	const redirectLinks = await fetchRedirectIndex(sql, query)
	const responseData: IRedirectIndex = {
		links_count: redirectLinks.length,
		root_url: "https://aka.tophhie.cloud",
		links: redirectLinks
	}
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