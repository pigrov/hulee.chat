import type {
  InternalEgressProfileKind,
  InternalEgressStatus
} from "@hulee/contracts";
import type { I18nMessageKey } from "@hulee/i18n";

export function egressStatusKey(status: InternalEgressStatus): I18nMessageKey {
  return `integrations.egress.status.${status}` as I18nMessageKey;
}

export function egressProfileKindKey(
  profileKind: InternalEgressProfileKind
): I18nMessageKey {
  return `integrations.egress.kind.${profileKind}` as I18nMessageKey;
}

export function resolveOverallEgressStatus(
  profiles: readonly { status: InternalEgressStatus }[]
): InternalEgressStatus {
  if (profiles.length === 0) {
    return "unknown";
  }

  for (const status of egressStatusSeverityOrder) {
    if (profiles.some((profile) => profile.status === status)) {
      return status;
    }
  }

  return "unknown";
}

const egressStatusSeverityOrder = [
  "misconfigured",
  "unavailable",
  "degraded",
  "unknown",
  "ready"
] as const satisfies readonly InternalEgressStatus[];
