// Runs once when the server process starts (both `next dev` and the standalone
// production server). We use it to create the DB schema and storage bucket so
// the stack is self-initializing on first boot — no manual migration step.
//
// Each step is skipped when its service isn't configured, so a bare deploy
// (e.g. a first Vercel deploy with no env vars, done just to obtain the
// production domain) boots instantly instead of retrying dead connections.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // PRD v2.0 CD-20 added middleware.ts, which makes Next also compile this
  // file for the Edge runtime (middleware's own instrumentation hook target)
  // — even though the `NEXT_RUNTIME !== "nodejs"` guard above makes the pg-
  // touching code below unreachable at runtime on that build, a *literal*
  // `import("./lib/db")` is still resolved by webpack while code-splitting,
  // and pg's transitive deps (fs/path/stream) don't exist on Edge, hard-
  // failing the build. Building the specifier from a variable makes it a
  // fully dynamic (non-literal) import, which webpack can't statically
  // resolve and so doesn't try to bundle — Node's real runtime resolves it
  // fine regardless, since this line only ever executes in the Node.js
  // instrumentation invocation anyway (see the early return above).
  const dbModule = "./lib/db";
  const storageModule = "./lib/storage";

  if (process.env.DATABASE_URL) {
    try {
      const { migrate } = await import(dbModule);
      await migrate();
      console.log("[startup] database schema ready");
    } catch (err) {
      console.error("[startup] database migration failed", err);
    }
  } else {
    console.warn("[startup] DATABASE_URL not set — skipping schema setup");
  }

  if (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY) {
    try {
      const { ensureBucket } = await import(storageModule);
      await ensureBucket();
      console.log("[startup] storage bucket ready");
    } catch (err) {
      console.error("[startup] bucket setup failed", err);
    }
  } else {
    console.warn("[startup] S3 credentials not set — skipping bucket setup");
  }
}
