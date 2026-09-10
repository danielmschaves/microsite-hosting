import type { DeploymentStatus } from "./db";

// Pure state-machine logic, split out from lib/deployments.ts so it can be
// unit-tested (lib/deploymentStateMachine.test.ts) without pulling in the
// rest of the app's import graph (createSite -> teams -> auth -> next-auth),
// which needs a real Next.js runtime to resolve.

const TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
  queued: ["building", "canceled"],
  building: ["ready", "failed", "canceled"],
  ready: ["published", "canceled"],
  published: [],
  failed: [],
  canceled: [],
};

export function canTransition(from: DeploymentStatus, to: DeploymentStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class IllegalTransitionError extends Error {
  constructor(
    public from: DeploymentStatus,
    public to: DeploymentStatus,
    public deploymentId: string,
  ) {
    super(`Cannot transition deployment ${deploymentId} from "${from}" to "${to}"`);
    this.name = "IllegalTransitionError";
  }
}
