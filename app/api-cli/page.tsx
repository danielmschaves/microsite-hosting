import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { query } from "@/lib/db";
import { FREE_SITE_LIMIT, FREE_STORAGE_BYTES } from "@/lib/plan";
import { listTokens } from "@/lib/apiTokens";
import { AppBar } from "@/components/AppBar";
import { ApiTokensPanel } from "@/components/ApiTokensPanel";

export const dynamic = "force-dynamic";

const ENDPOINTS: {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  desc: string;
}[] = [
  { method: "GET", path: "/api/v1/sites", desc: "List your live sites" },
  { method: "POST", path: "/api/v1/sites", desc: "Create a site + slug" },
  { method: "PUT", path: "/api/v1/sites/{slug}/content", desc: "Upload / re-upload HTML" },
  { method: "PATCH", path: "/api/v1/sites/{slug}", desc: "Change TTL, visibility or slug" },
  { method: "DELETE", path: "/api/v1/sites/{slug}", desc: "Move to trash" },
];

function methodTone(m: string): string {
  if (m === "DELETE") return "pill-danger";
  if (m === "POST") return "pill-success";
  if (m === "PUT" || m === "PATCH") return "pill-accent";
  return "pill-neutral";
}

export default async function ApiCliPage() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) redirect("/login?callbackUrl=/api-cli");

  const tokens = await listTokens(email);

  const live = await query<{ size_bytes: string }>(
    "SELECT size_bytes FROM sites WHERE owner_email = $1 AND deleted_at IS NULL",
    [email],
  );
  const usedBytes = live.reduce((s, r) => s + Number(r.size_bytes), 0);

  return (
    <>
      <AppBar
        email={email}
        name={session?.user?.name}
        active="api"
        usedBytes={usedBytes}
        siteCount={live.length}
        siteLimit={FREE_SITE_LIMIT}
        storageLimitBytes={FREE_STORAGE_BYTES}
      />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "30px 30px 100px" }}>
        <h1
          style={{
            margin: "0 0 6px",
            font: "800 26px/1 var(--font-ui)",
            letterSpacing: "-.02em",
            color: "var(--text)",
          }}
        >
          API &amp; CLI
        </h1>
        <p
          style={{
            margin: "0 0 24px",
            font: "400 13.5px/1 var(--font-ui)",
            color: "var(--text-muted)",
          }}
        >
          Publish from a script, a Makefile, or your CI job. Same auth, same TTLs.
        </p>

        {/* terminal card */}
        <div className="card" style={{ padding: 22, marginBottom: 18 }}>
          <div
            style={{
              font: "700 15px/1 var(--font-ui)",
              color: "var(--text)",
              marginBottom: 16,
            }}
          >
            Deploy in one command
          </div>
          <div
            style={{
              borderRadius: "var(--r-md)",
              background: "var(--surface-2)",
              border: "1px solid var(--border-strong)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "9px 14px",
                borderBottom: "1px solid var(--border)",
                background: "color-mix(in srgb, var(--surface-3) 60%, transparent)",
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: 999, background: "var(--danger)" }} />
              <span style={{ width: 9, height: 9, borderRadius: 999, background: "var(--warning)" }} />
              <span style={{ width: 9, height: 9, borderRadius: 999, background: "var(--success)" }} />
              <span
                className="mb-mono"
                style={{
                  marginLeft: 6,
                  font: "500 10.5px/1 var(--font-mono)",
                  color: "var(--text-subtle)",
                }}
              >
                curl
              </span>
            </div>
            <div
              className="mb-mono"
              style={{
                padding: "16px 16px 18px",
                font: "500 12.5px/1.9 var(--font-mono)",
                color: "var(--text-muted)",
                overflowX: "auto",
              }}
            >
              <div>
                <span style={{ color: "var(--text-subtle)" }}>$ </span>
                <span style={{ color: "var(--text)" }}>
                  curl -X POST -H &quot;Authorization: Bearer $MICROBUILD_TOKEN&quot; \
                </span>
              </div>
              <div style={{ paddingLeft: 22, color: "var(--text)" }}>
                -F file=@report.html -F ttl=7d -F slug=plotly-retention \
              </div>
              <div style={{ paddingLeft: 22, color: "var(--text)" }}>
                https://your-host/api/v1/sites
              </div>
              <div style={{ marginTop: 8, color: "var(--success)" }}>
                ✓ published → /s/plotly-retention · expires in 7d 00h
              </div>
              <div style={{ marginTop: 10, color: "var(--text-subtle)" }}>
                # dedicated CLI (npm i -g @microbuild/cli) — coming soon
              </div>
            </div>
          </div>
        </div>

        {/* tokens */}
        <ApiTokensPanel tokens={tokens} />

        {/* endpoints */}
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "17px 20px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ font: "700 15px/1 var(--font-ui)", color: "var(--text)" }}>
              REST endpoints
            </div>
            <div
              style={{
                font: "400 12px/1.4 var(--font-ui)",
                color: "var(--text-muted)",
                marginTop: 5,
              }}
            >
              Bearer token in{" "}
              <span className="mb-mono" style={{ color: "var(--text)" }}>
                Authorization
              </span>
              . Uploads are multipart form-data (≤4 MB — larger sites use the web
              upload); everything else is JSON in, JSON out.
            </div>
          </div>
          {ENDPOINTS.map((e) => (
            <div
              key={`${e.method} ${e.path}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "12px 20px",
                borderTop: "1px solid var(--border)",
              }}
            >
              <span
                className={`pill ${methodTone(e.method)}`}
                style={{ width: 62, justifyContent: "center", flex: "none" }}
              >
                <span className="mb-mono">{e.method}</span>
              </span>
              <span
                className="mb-mono"
                style={{
                  flex: 1,
                  minWidth: 0,
                  font: "500 12.5px/1 var(--font-mono)",
                  color: "var(--text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {e.path}
              </span>
              <span
                style={{
                  font: "400 12px/1.3 var(--font-ui)",
                  color: "var(--text-muted)",
                  textAlign: "right",
                }}
              >
                {e.desc}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
