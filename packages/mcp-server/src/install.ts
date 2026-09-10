import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { homedir } from "os";
import { detectClientKind, type ClientKind } from "./config.js";
import { authorize } from "./auth.js";

interface InstallTarget {
  kind: ClientKind;
  configPath: string;
  write: (existing: string | null) => string;
}

const SERVER_ENTRY = { command: "npx", args: ["-y", "@microbuild/mcp"] };

function claudeCodeTarget(cwd: string): InstallTarget {
  // Project-scoped .mcp.json — the documented Claude Code mechanism for
  // sharing an MCP server config via the repo itself.
  const configPath = join(cwd, ".mcp.json");
  return {
    kind: "claude-code",
    configPath,
    write(existing) {
      const config = existing ? JSON.parse(existing) : {};
      config.mcpServers = config.mcpServers || {};
      config.mcpServers.microbuild = SERVER_ENTRY;
      return JSON.stringify(config, null, 2) + "\n";
    },
  };
}

function cursorTarget(cwd: string): InstallTarget {
  const configPath = join(cwd, ".cursor", "mcp.json");
  return {
    kind: "cursor",
    configPath,
    write(existing) {
      const config = existing ? JSON.parse(existing) : {};
      config.mcpServers = config.mcpServers || {};
      config.mcpServers.microbuild = SERVER_ENTRY;
      return JSON.stringify(config, null, 2) + "\n";
    },
  };
}

function codexTarget(): InstallTarget {
  const configPath = join(homedir(), ".codex", "config.toml");
  return {
    kind: "codex",
    configPath,
    write(existing) {
      const block = [
        "",
        "[mcp_servers.microbuild]",
        `command = "${SERVER_ENTRY.command}"`,
        `args = ${JSON.stringify(SERVER_ENTRY.args)}`,
        "",
      ].join("\n");
      if (existing?.includes("[mcp_servers.microbuild]")) {
        return existing; // already present; leave as-is rather than duplicate
      }
      return (existing || "") + block;
    },
  };
}

function resolveTarget(to: string, cwd: string): InstallTarget {
  const kind = detectClientKind(to);
  switch (kind) {
    case "claude-code":
      return claudeCodeTarget(cwd);
    case "cursor":
      return cursorTarget(cwd);
    case "codex":
      return codexTarget();
    default:
      throw new Error(`Unknown --to target "${to}". Use claude-code, codex, or cursor.`);
  }
}

/** `microbuild-mcp install --to <client>` — write config, then authorize. */
export async function install(to: string, cwd: string = process.cwd()): Promise<void> {
  const target = resolveTarget(to, cwd);

  let existing: string | null = null;
  try {
    existing = await readFile(target.configPath, "utf8");
  } catch {
    /* no existing config */
  }

  const next = target.write(existing);
  await mkdir(dirname(target.configPath), { recursive: true });
  await writeFile(target.configPath, next, "utf8");
  process.stderr.write(`MicroBuild: wrote MCP config to ${target.configPath}\n`);

  await authorize(`microbuild-mcp (${target.kind})`, target.kind);
  process.stderr.write(
    `MicroBuild: install complete. Restart ${to} to pick up the new MCP server.\n`,
  );
}
