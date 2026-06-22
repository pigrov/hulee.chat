import type { Entitlement } from "./entitlement";

export type LicenseSnapshot = {
  licenseId: string;
  customerId: string;
  deploymentId: string;
  validFrom: string;
  validUntil?: string;
  offlineGraceUntil?: string;
  entitlements: Entitlement[];
  issuer: string;
  signature?: string;
};

export function isLicenseActive(snapshot: LicenseSnapshot, now: Date): boolean {
  const startsAt = new Date(snapshot.validFrom).getTime();
  const validUntil = snapshot.validUntil
    ? new Date(snapshot.validUntil).getTime()
    : Number.POSITIVE_INFINITY;
  const offlineGraceUntil = snapshot.offlineGraceUntil
    ? new Date(snapshot.offlineGraceUntil).getTime()
    : validUntil;
  const current = now.getTime();

  return (
    current >= startsAt && current <= Math.max(validUntil, offlineGraceUntil)
  );
}
