import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiCall, MicroBuildApiError } from "./api.js";
import { AuthRequiredError } from "./auth.js";

// The 14 R1 tools (PRD v2.0 §9.2), each a thin bridge to app/api/agent/**.
// Every description leads with visibility/TTL where relevant — "the tool
// description is the only marketing copy an agent ever reads" (PRD §9.3).
//
// Uses McpServer's plain `tool(name, description, shape, cb)` overload
// (ZodRawShape, not the newer registerTool/ZodRawShapeCompat generic layer)
// — the newer overload set triggers TS2589 "Type instantiation is
// excessively deep" with this many distinct tool schemas in one file. See
// packages/mcp-server/README.md.

function text(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(err: unknown) {
  if (err instanceof AuthRequiredError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `auth_required: ${err.message}${err.authorizationUrl ? ` (${err.authorizationUrl})` : ""}`,
        },
      ],
    };
  }
  if (err instanceof MicroBuildApiError) {
    return {
      isError: true,
      content: [{ type: "text" as const, text: `${err.code}: ${err.message}` }],
    };
  }
  return {
    isError: true,
    content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
  };
}

const fileShape = z.object({ path: z.string(), content: z.string() });
const ttlShape = z.enum(["24h", "7d", "30d", "90d"]);
const visibilityShape = z.enum(["only_me", "allowlist", "team", "public"]);
const accessModeShape = z.enum(["password", "organization", "hybrid", "inherit"]);

export function registerTools(server: McpServer): void {
  server.tool(
    "list_projects",
    "List the workspaces (projects) this agent's token can act in.",
    async () => {
      try {
        return text(await apiCall("GET", "/api/agent/projects"));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "list_sites",
    "List sites in the current workspace, including their visibility and TTL.",
    async () => {
      try {
        return text(await apiCall("GET", "/api/agent/sites"));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "get_site_context",
    "Read one site's live URL, visibility, viewers, TTL, and version count.",
    { siteId: z.string() },
    async ({ siteId }) => {
      try {
        return text(await apiCall("GET", `/api/agent/sites/${siteId}`));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "create_site_from_html",
    "Publish a set of static HTML files to a new (or your own existing) site. Takes visibility and ttl as REQUIRED arguments — publish to exactly the people who should see it, for exactly as long as it needs to exist.",
    {
      slug: z.string().optional(),
      files: z.array(fileShape).min(1),
      index: z.string().optional(),
      ttl: ttlShape,
      visibility: visibilityShape,
      viewers: z.array(z.string()).optional(),
    },
    async (args) => {
      try {
        return text(await apiCall("POST", "/api/agent/sites", { body: args, idempotent: true }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "apply_site_patch",
    "Replace or add specific files on an existing site and publish the result as a new version.",
    { siteId: z.string(), files: z.array(fileShape).min(1) },
    async ({ siteId, files }) => {
      try {
        return text(await apiCall("PATCH", `/api/agent/sites/${siteId}/files`, { body: { files } }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "create_preview",
    "Publish a private, unmetered preview of a site — never touches the live URL. Use this before publish_site so you (and reviewers) can see the result first.",
    { siteId: z.string(), files: z.array(fileShape).optional() },
    async ({ siteId, files }) => {
      try {
        return text(
          await apiCall("POST", `/api/agent/sites/${siteId}/previews`, { body: { files } }),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "get_preview_status",
    "Poll a preview deployment's build status and URL.",
    { deploymentId: z.string() },
    async ({ deploymentId }) => {
      try {
        return text(await apiCall("GET", `/api/agent/previews/${deploymentId}`));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "delete_preview",
    "Delete a preview deployment and its storage.",
    { deploymentId: z.string() },
    async ({ deploymentId }) => {
      try {
        return text(await apiCall("DELETE", `/api/agent/previews/${deploymentId}`));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "set_preview_access",
    "Set who can view a preview deployment: password-protected, organization-only (workspace members), hybrid (both), or inherit (the site's own visibility — the default).",
    { deploymentId: z.string(), accessMode: accessModeShape, password: z.string().optional() },
    async ({ deploymentId, accessMode, password }) => {
      try {
        return text(
          await apiCall("PATCH", `/api/agent/previews/${deploymentId}`, {
            body: { accessMode, password },
          }),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "publish_site",
    "Publish live, visible to your audience. Two-step: call once to get a confirmToken and a change summary, review it, then call again with that confirmToken to actually go live. Prefer promoting a deploymentId from create_preview over publishing blind.",
    {
      siteId: z.string(),
      deploymentId: z.string().optional(),
      ttl: ttlShape.optional(),
      confirmToken: z.string().optional(),
    },
    async ({ siteId, deploymentId, ttl, confirmToken }) => {
      try {
        return text(
          await apiCall("POST", `/api/agent/sites/${siteId}/publish`, {
            body: { deploymentId, ttl, confirmToken },
            idempotent: Boolean(confirmToken),
          }),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "list_site_versions",
    "List a site's publish history, newest first.",
    { siteId: z.string(), before: z.number().optional() },
    async ({ siteId, before }) => {
      try {
        const qs = before ? `?before=${before}` : "";
        return text(await apiCall("GET", `/api/agent/sites/${siteId}/versions${qs}`));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "rollback_to_version",
    "Revert the live site to an older version. Publishes immediately without a preview step by design. Two-step: call once to get a confirmToken, then again with it to execute.",
    { siteId: z.string(), version: z.number().int(), confirmToken: z.string().optional() },
    async ({ siteId, version, confirmToken }) => {
      try {
        return text(
          await apiCall("POST", `/api/agent/sites/${siteId}/rollback`, {
            body: { version, confirmToken },
            idempotent: Boolean(confirmToken),
          }),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "request_publish",
    "Request human approval to publish or roll back a site. Required when the workspace's publish_mode is \"approval\" — publish_site/rollback_to_version reject with approval_required in that mode instead of executing. Returns an approvalId to poll with get_approval_status.",
    {
      siteId: z.string(),
      action: z.enum(["publish", "rollback"]),
      deploymentId: z.string().optional(),
      targetVersion: z.number().int().optional(),
      ttlOverride: ttlShape.optional(),
      message: z.string().optional(),
    },
    async ({ siteId, action, deploymentId, targetVersion, ttlOverride, message }) => {
      try {
        return text(
          await apiCall("POST", `/api/agent/sites/${siteId}/publish/request`, {
            body: { action, deploymentId, targetVersion, ttlOverride, message },
          }),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "get_approval_status",
    "Check the status of a publish/rollback approval request: pending, approved (with the resulting version), rejected, or expired.",
    { approvalId: z.string() },
    async ({ approvalId }) => {
      try {
        return text(await apiCall("GET", `/api/agent/approvals/${approvalId}`));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "set_site_visibility",
    "Change who can view a site: only_me, allowlist (+ viewer emails), team, or public.",
    { siteId: z.string(), visibility: visibilityShape, viewers: z.array(z.string()).optional() },
    async ({ siteId, visibility, viewers }) => {
      try {
        return text(
          await apiCall("PATCH", `/api/agent/sites/${siteId}`, { body: { visibility, viewers } }),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "set_site_expiry",
    "Change or extend a site's TTL (24h, 7d, 30d, 90d). Resets the expiry countdown from now.",
    { siteId: z.string(), ttl: ttlShape },
    async ({ siteId, ttl }) => {
      try {
        return text(await apiCall("PATCH", `/api/agent/sites/${siteId}`, { body: { ttl } }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "delete_site",
    "Move a site to trash for good, purging its storage. Two-step: call once to get a confirmToken and cascade summary, then again with it to execute.",
    { siteId: z.string(), confirmToken: z.string().optional() },
    async ({ siteId, confirmToken }) => {
      try {
        const qs = confirmToken ? `?confirmToken=${encodeURIComponent(confirmToken)}` : "";
        return text(await apiCall("DELETE", `/api/agent/sites/${siteId}${qs}`));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "list_site_domains",
    "List a site's custom domains, their DNS records, verification status, and certificate state.",
    { siteId: z.string() },
    async ({ siteId }) => {
      try {
        return text(await apiCall("GET", `/api/agent/sites/${siteId}/domains`));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "add_custom_domain",
    "Point a domain you own at this site. Returns the exact DNS records to create (a CNAME for a subdomain, ALIAS/ANAME guidance for an apex domain, plus a TXT ownership challenge) — nothing resolves until verify_custom_domain confirms them.",
    { siteId: z.string(), hostname: z.string() },
    async ({ siteId, hostname }) => {
      try {
        return text(await apiCall("POST", `/api/agent/sites/${siteId}/domains`, { body: { hostname } }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "verify_custom_domain",
    "Re-check DNS for a domain added with add_custom_domain. Idempotent — safe to call repeatedly while waiting for DNS to propagate.",
    { siteId: z.string(), domainId: z.string() },
    async ({ siteId, domainId }) => {
      try {
        return text(
          await apiCall("POST", `/api/agent/sites/${siteId}/domains/${domainId}/verify`),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "get_site_insights",
    "Visitor analytics for a site: total and unique views, views over time, top pages, referrers, and — unlike most hosts — the actual named viewers, since viewers here are authenticated. Anonymous public views only ever show up as counts, never a name. Requires the Team plan.",
    { siteId: z.string(), days: z.number().int().min(1).max(90).optional() },
    async ({ siteId, days }) => {
      try {
        const qs = days ? `?days=${days}` : "";
        return text(await apiCall("GET", `/api/agent/sites/${siteId}/insights${qs}`));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "claim_trial_site",
    "Claim an anonymous trial site (published via the /try no-signup flow) on behalf of the human this agent token was granted by — transfers ownership and extends the TTL to 7 days. Requires the raw guest token the browser session received.",
    { guestToken: z.string(), trialId: z.string().optional() },
    async ({ guestToken, trialId }) => {
      try {
        return text(await apiCall("POST", "/api/agent/guest/claim", { body: { guestToken, trialId } }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
