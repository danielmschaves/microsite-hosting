import { describe, expect, it } from "vitest";
import { canTransition, IllegalTransitionError } from "./deploymentStateMachine";
import type { DeploymentStatus } from "./db";

// Pure state-machine tests — no database needed. transitionDeployment's
// row-locking/concurrency behavior requires a live Postgres connection and
// is exercised manually against `docker compose up` per CLAUDE.md's
// Agent Gateway verification checklist (item 2).

const ALL_STATUSES: DeploymentStatus[] = [
  "queued",
  "building",
  "ready",
  "published",
  "failed",
  "canceled",
];

const LEGAL: [DeploymentStatus, DeploymentStatus][] = [
  ["queued", "building"],
  ["queued", "canceled"],
  ["building", "ready"],
  ["building", "failed"],
  ["building", "canceled"],
  ["ready", "published"],
  ["ready", "canceled"],
];

describe("canTransition", () => {
  it("allows every legal transition", () => {
    for (const [from, to] of LEGAL) {
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it("rejects every pair not in the legal list", () => {
    const legalSet = new Set(LEGAL.map(([from, to]) => `${from}->${to}`));
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (from === to) continue;
        const expected = legalSet.has(`${from}->${to}`);
        expect(canTransition(from, to)).toBe(expected);
      }
    }
  });

  it("treats published, failed and canceled as terminal", () => {
    for (const terminal of ["published", "failed", "canceled"] as const) {
      for (const to of ALL_STATUSES) {
        expect(canTransition(terminal, to)).toBe(false);
      }
    }
  });
});

describe("IllegalTransitionError", () => {
  it("carries the from/to/deploymentId and a readable message", () => {
    const err = new IllegalTransitionError("published", "building", "dep-123");
    expect(err.from).toBe("published");
    expect(err.to).toBe("building");
    expect(err.deploymentId).toBe("dep-123");
    expect(err.message).toContain("published");
    expect(err.message).toContain("building");
    expect(err.message).toContain("dep-123");
    expect(err.name).toBe("IllegalTransitionError");
  });
});
