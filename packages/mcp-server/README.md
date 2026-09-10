# @microbuild/mcp

MCP server for MicroBuild — the 14 R1 agent tools (PRD v2.0 §9.2) plus 4 more from R2
(`set_preview_access`, `request_publish`, `get_approval_status`, `claim_trial_site`), each a thin
bridge to `app/api/agent/**` in the main app.

## Install

```
npx @microbuild/mcp install --to claude-code   # or codex | cursor
```

Writes the client's MCP config (project-scoped `.mcp.json` for Claude Code/Cursor, `~/.codex/config.toml`
for Codex) and runs the OAuth 2.1 device-code flow, printing a URL + code for you to approve in a
browser. The resulting token is cached at `~/.microbuild/credentials.json`.

## Config

- `MICROBUILD_BASE_URL` — which MicroBuild deployment to talk to (default `https://microsite-hosting.vercel.app`).
- `MICROBUILD_CREDENTIALS_PATH` — override the cached-credential location.

## Development

```
npm run dev --workspace packages/mcp-server   # run the stdio server directly via tsx
npm run build --workspace packages/mcp-server # tsc -> dist/
```

**Dependency pins are intentional.** `@modelcontextprotocol/sdk` is pinned to `1.9.0` and `zod` to
`3.23.8` (not `^` ranges) because the SDK's newer `registerTool`/`ZodRawShapeCompat` generic layer
(added in later SDK versions to support both zod v3 and v4) triggers TypeScript's "Type
instantiation is excessively deep and possibly infinite" (TS2589) once more than a couple of tool
schemas are registered in one file. `1.9.0`'s simpler `tool(name, description, shape, cb)` overload
(plain `ZodRawShape`) compiles in ~1.5s against all 18 tools here. If bumping either dependency,
re-verify `npm run build --workspace packages/mcp-server` completes in a few seconds, not minutes —
that regression is the signal something reintroduced the slow path.
