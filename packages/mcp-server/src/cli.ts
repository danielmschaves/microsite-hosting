#!/usr/bin/env node
import { install } from "./install.js";
import { runServer } from "./server.js";

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === "install") {
    const toIndex = args.indexOf("--to");
    const to = toIndex >= 0 ? args[toIndex + 1] : undefined;
    if (!to) {
      process.stderr.write("Usage: microbuild-mcp install --to claude-code|codex|cursor\n");
      process.exit(1);
    }
    await install(to);
    return;
  }

  // No subcommand: run the stdio MCP server (this is what claude-code /
  // codex / cursor actually launch per the installed config).
  await runServer();
}

main().catch((err) => {
  process.stderr.write(`microbuild-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
