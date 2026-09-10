---
name: microbuild
description: Publish static HTML pages to MicroBuild — a private-by-default, expiring web host built for agent workflows. Use whenever a finished HTML artifact needs a shareable URL, especially when it should only be seen by specific people or should disappear after a few days. Requires the @microbuild/mcp server to be installed and authorized (run `npx @microbuild/mcp install --to claude-code` once per machine).
---

# MicroBuild publishing

MicroBuild's wedge over other site hosts is that **visibility and expiry are first-class
arguments on every publish** — nothing here defaults to public-forever. Always pass explicit
`visibility` and `ttl` on `create_site_from_html`; never leave them to a tool default.

## Workflow

1. **Check for an existing site first.** Look for `.microbuild/site.json` in the repository root.
   If present, it names a `siteId`/`slug` this repo has already published to — prefer
   `apply_site_patch` + `publish_site` on that site over creating a duplicate one.
2. **Preview before you publish.** Call `create_preview` and share the returned `previewUrl` (or
   describe what it shows) before calling `publish_site`. Never call `publish_site` on a fresh
   set of changes without a preview first — if you skip this, `publish_site`'s first response
   will include a `warning` field; read it and go back to `create_preview` unless the human has
   explicitly told you to publish immediately.
3. **Choose visibility deliberately.** Default to `allowlist` with the specific people who asked
   for this, not `public`, unless the human says otherwise. `only_me` is right for scratch work
   nobody else needs yet.
4. **Choose a TTL that matches the artifact's actual lifetime.** A one-off report for a meeting
   this week is `24h` or `7d`, not `90d`. Extend later with `set_site_expiry` if it turns out to
   be needed longer — don't over-provision up front.
5. **Two-step tools (`publish_site`, `rollback_to_version`, `delete_site`) require confirmation.**
   The first call returns a `confirmToken` and a summary — read the summary back to the human (or
   at minimum log it) before calling the tool again with that `confirmToken`. Never auto-chain the
   confirm call without the summary having been seen by whoever is driving this session.
6. **`delete_site` and `rollback_to_version` are destructive.** Don't call them speculatively.
   `rollback_to_version` publishes immediately with no preview step by design — treat it as
   equivalent in weight to `publish_site`.

## After a successful `create_site_from_html`

Write (or update) `.microbuild/site.json` in the repo root:

```json
{ "siteId": "<returned siteId>", "slug": "<returned slug>" }
```

This is how step 1 above finds the site on a later run. It's plain JSON, safe to commit if the
team wants to share the association — MicroBuild doesn't require it to be committed.

## Tool reference

All 14 tools are documented via MCP tool descriptions (`list_projects`, `list_sites`,
`get_site_context`, `create_site_from_html`, `apply_site_patch`, `create_preview`,
`get_preview_status`, `delete_preview`, `publish_site`, `list_site_versions`,
`rollback_to_version`, `set_site_visibility`, `set_site_expiry`, `delete_site`) — read a tool's
own description before calling it for parameter details; this file only covers workflow judgment
calls the tool descriptions can't express on their own.
