import type { WebAccessSession } from "./access";

export const privilegedActionSessionFreshnessMs = 30 * 60 * 1000;

const defaultFutureClockSkewMs = 30 * 1000;

export class PrivilegedActionReauthRequiredError extends Error {
  constructor() {
    super("Privileged action requires a recent session.");
    this.name = "PrivilegedActionReauthRequiredError";
  }
}

export function isPrivilegedActionReauthRequiredError(
  error: unknown
): error is PrivilegedActionReauthRequiredError {
  return error instanceof PrivilegedActionReauthRequiredError;
}

export function assertRecentPrivilegedActionSession(
  session: Pick<WebAccessSession, "sessionCreatedAt">,
  options: {
    readonly now?: Date;
    readonly maxAgeMs?: number;
    readonly allowMissingSessionCreatedAt?: boolean;
    readonly futureClockSkewMs?: number;
  } = {}
): void {
  const allowMissingSessionCreatedAt =
    options.allowMissingSessionCreatedAt ?? true;

  if (session.sessionCreatedAt === undefined) {
    if (allowMissingSessionCreatedAt) {
      return;
    }

    throw new PrivilegedActionReauthRequiredError();
  }

  const nowMs = (options.now ?? new Date()).getTime();
  const createdAtMs = new Date(session.sessionCreatedAt).getTime();
  const maxAgeMs = options.maxAgeMs ?? privilegedActionSessionFreshnessMs;
  const futureClockSkewMs =
    options.futureClockSkewMs ?? defaultFutureClockSkewMs;

  if (
    Number.isNaN(createdAtMs) ||
    createdAtMs > nowMs + futureClockSkewMs ||
    nowMs - createdAtMs > maxAgeMs
  ) {
    throw new PrivilegedActionReauthRequiredError();
  }
}
