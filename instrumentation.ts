// Runs once when the server process starts (both `next dev` and the standalone
// production server). We use it to create the DB schema and storage bucket so
// the stack is self-initializing on first boot — no manual migration step.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { migrate } = await import("./lib/db");
  const { ensureBucket } = await import("./lib/storage");

  try {
    await migrate();
    console.log("[startup] database schema ready");
  } catch (err) {
    console.error("[startup] database migration failed", err);
  }

  try {
    await ensureBucket();
    console.log("[startup] storage bucket ready");
  } catch (err) {
    console.error("[startup] bucket setup failed", err);
  }
}
