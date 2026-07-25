import Link from "next/link";
import { ShieldCheck, LayoutGrid, Settings, HardDrive, Users } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SignOutButton } from "@/components/AuthButtons";

export interface AppBarProps {
  email: string;
  name?: string | null;
  active: "sites" | "teams" | "settings";
  usedBytes: number;
  siteCount: number;
  siteLimit: number;
  storageLimitBytes: number;
}

function initials(name: string | null | undefined, email: string): string {
  const base = (name || email).trim();
  const parts = base.split(/[\s@._-]+/).filter(Boolean);
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : base.slice(0, 2);
  return chars.toUpperCase();
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export function AppBar({
  email,
  name,
  active,
  usedBytes,
  siteCount,
  siteLimit,
  storageLimitBytes,
}: AppBarProps) {
  const navItem = (
    href: string,
    label: string,
    icon: React.ReactNode,
    on: boolean,
  ) => (
    <Link
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "7px 12px",
        borderRadius: 8,
        font: "600 13px/1 var(--font-ui)",
        whiteSpace: "nowrap",
        background: on ? "var(--surface-2)" : "transparent",
        color: on ? "var(--text)" : "var(--text-muted)",
      }}
    >
      {icon}
      {label}
    </Link>
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "14px 30px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface-1)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
        <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: "var(--accent-soft)",
              border: "1px solid var(--accent-border)",
              display: "grid",
              placeItems: "center",
              color: "var(--accent)",
              boxShadow: "var(--glow-accent)",
            }}
          >
            <ShieldCheck size={17} />
          </div>
          <span style={{ font: "800 16px/1 var(--font-ui)", letterSpacing: "-.02em", color: "var(--text)" }}>
            MicroBuild
          </span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {navItem("/dashboard", "Sites", <LayoutGrid size={14} />, active === "sites")}
          {navItem("/teams", "Teams", <Users size={14} />, active === "teams")}
          {navItem("/settings", "Settings", <Settings size={14} />, active === "settings")}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            font: "500 12px/1 var(--font-mono)",
            color: "var(--text-subtle)",
          }}
        >
          <HardDrive size={13} />
          {mb(usedBytes)} / {mb(storageLimitBytes)} MB
        </span>
        <span style={{ width: 1, height: 20, background: "var(--border)" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              background:
                "linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 40%,#000))",
              display: "grid",
              placeItems: "center",
              font: "700 12px/1 var(--font-ui)",
              color: "#fff",
            }}
          >
            {initials(name, email)}
          </div>
          <div style={{ lineHeight: 1.2 }}>
            <div style={{ font: "600 12.5px/1 var(--font-ui)", color: "var(--text)" }}>{email}</div>
            <div style={{ font: "500 10.5px/1 var(--font-mono)", color: "var(--text-subtle)", marginTop: 3 }}>
              Free · {siteCount} of {siteLimit} sites
            </div>
          </div>
        </div>
        <ThemeToggle />
        <SignOutButton variant="icon" />
      </div>
    </div>
  );
}
