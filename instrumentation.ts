// Runs once when the server process starts (both `next dev` and the standalone
// production server). We use it to create the DB schema and storage bucket so
// the stack is self-initializing on first boot — no manual migration step.
//
// Each step is skipped when its service isn't configured, so a bare deploy
// (e.g. a first Vercel deploy with no env vars, done just to obtain the
// production domain) boots instantly instead of retrying dead connections.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  if (process.env.DATABASE_URL) {
    try {
      const { migrate } = await import("./lib/db");
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
      const { ensureBucket } = await import("./lib/storage");
      await ensureBucket();
      console.log("[startup] storage bucket ready");
    } catch (err) {
      console.error("[startup] bucket setup failed", err);
    }
  } else {
    console.warn("[startup] S3 credentials not set — skipping bucket setup");
  }
}
