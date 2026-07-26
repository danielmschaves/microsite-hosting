import type { CSSProperties, ReactNode } from "react";

/**
 * Small stateless design-system pieces shared across panels. These wrap the
 * `.pill` / `.stat-tile` / `.banner` class primitives in globals.css so the
 * variants stay centralized instead of being re-implemented inline.
 */

export type PillTone = "default" | "accent" | "success" | "warning" | "danger" | "neutral";

export function Pill({
  tone = "default",
  mono = false,
  style,
  children,
}: {
  tone?: PillTone;
  mono?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const cls = tone === "default" ? "pill" : `pill pill-${tone}`;
  return (
    <span className={cls} style={style}>
      {mono ? <span className="mb-mono">{children}</span> : children}
    </span>
  );
}

export function StatTile({
  icon,
  label,
  value,
  unit,
  valueColor,
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  unit?: ReactNode;
  valueColor?: string;
}) {
  return (
    <div className="stat-tile">
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className="stat-value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
        {unit != null && <span className="stat-unit"> {unit}</span>}
      </div>
    </div>
  );
}

export function Banner({
  tone = "default",
  icon,
  style,
  children,
}: {
  tone?: "default" | "warning" | "danger" | "success";
  icon?: ReactNode;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const cls = tone === "default" ? "banner" : `banner banner-${tone}`;
  return (
    <div className={cls} style={style}>
      {icon}
      <span style={{ flex: 1 }}>{children}</span>
    </div>
  );
}
