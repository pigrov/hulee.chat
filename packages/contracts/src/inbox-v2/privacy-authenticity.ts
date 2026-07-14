/**
 * Internal runtime authenticity registry for mutually-referencing privacy
 * contracts. This module is intentionally not part of the package public API;
 * it prevents request/deletion modules from importing each other at runtime.
 */
const privacyRequests = new WeakSet<object>();
const privacyRequestDescriptors = new WeakMap<
  object,
  InboxV2PrivacyRequestAuthenticityDescriptor
>();
const deletionPlans = new WeakSet<object>();
const deletionRuns = new WeakSet<object>();
const terminalExportDescriptors = new WeakMap<
  object,
  InboxV2PrivacyTerminalExportAuthenticityDescriptor
>();
const terminalExportCurrentAssertions = new WeakMap<
  object,
  (checkedAt: string) => void
>();

/**
 * Cycle-free proof carried by an authentic, ready privacy-export bundle.
 *
 * `privacy-export.ts` owns construction of the bundle. Privacy request
 * completion only consumes this descriptor, so neither contract has to import
 * the other at runtime.
 */
export type InboxV2PrivacyTerminalExportAuthenticityDescriptor = Readonly<{
  tenantId: string;
  productKind: "data_subject" | "manager_report" | "tenant_deployment";
  jobId: string;
  jobRevision: string;
  manifestId: string;
  manifestRevision: string;
  manifestHash: string;
  artifactId: string;
  artifactRevision: string;
  artifactChecksum: string;
  artifactReadyAt: string;
  artifactExpiresAt: string;
  governanceContextId: string;
  governanceContextVersion: string;
  governanceContextHash: string;
  policyId: string;
  policyVersion: string;
  policyHash: string;
  rootKeys: readonly string[];
  rootSetHash: string;
  tenantScopeProofHash: string | null;
}>;

export type InboxV2PrivacyRequestAuthenticityDescriptor = Readonly<{
  tenantId: string;
  requestId: string;
  revision: string;
  intent: string;
  governanceContextId: string;
  governanceContextVersion: string;
  governanceContextHash: string;
  authorityCheckedAt: string;
  tenantScopeProofHash: string | null;
  tenantRootKeys: readonly string[];
  tenantExportRootKeys: readonly string[];
  terminalExport: InboxV2PrivacyTerminalExportAuthenticityDescriptor | null;
  terminalExportProof: object | null;
}>;

export function registerInboxV2PrivacyRequestAuthenticity(
  value: object,
  descriptor: InboxV2PrivacyRequestAuthenticityDescriptor
): void {
  privacyRequests.add(value);
  privacyRequestDescriptors.set(
    value,
    Object.freeze({
      ...descriptor,
      tenantRootKeys: Object.freeze([...descriptor.tenantRootKeys]),
      tenantExportRootKeys: Object.freeze([...descriptor.tenantExportRootKeys])
    })
  );
}

export function hasInboxV2PrivacyRequestAuthenticity(value: unknown): boolean {
  return (
    typeof value === "object" && value !== null && privacyRequests.has(value)
  );
}

export function getInboxV2PrivacyRequestAuthenticity(
  value: unknown
): InboxV2PrivacyRequestAuthenticityDescriptor | null {
  return typeof value === "object" && value !== null
    ? (privacyRequestDescriptors.get(value) ?? null)
    : null;
}

export function registerInboxV2DeletionPlanAuthenticity(value: object): void {
  deletionPlans.add(value);
}

export function hasInboxV2DeletionPlanAuthenticity(value: unknown): boolean {
  return (
    typeof value === "object" && value !== null && deletionPlans.has(value)
  );
}

export function registerInboxV2DeletionRunAuthenticity(value: object): void {
  deletionRuns.add(value);
}

export function hasInboxV2DeletionRunAuthenticity(value: unknown): boolean {
  return typeof value === "object" && value !== null && deletionRuns.has(value);
}

export function registerInboxV2PrivacyTerminalExportAuthenticity(
  value: object,
  descriptor: InboxV2PrivacyTerminalExportAuthenticityDescriptor,
  assertCurrent: (checkedAt: string) => void
): void {
  terminalExportDescriptors.set(
    value,
    Object.freeze({
      ...descriptor,
      rootKeys: Object.freeze([...descriptor.rootKeys])
    })
  );
  terminalExportCurrentAssertions.set(value, assertCurrent);
}

export function getInboxV2PrivacyTerminalExportAuthenticity(
  value: unknown
): InboxV2PrivacyTerminalExportAuthenticityDescriptor | null {
  return typeof value === "object" && value !== null
    ? (terminalExportDescriptors.get(value) ?? null)
    : null;
}

export function assertInboxV2PrivacyTerminalExportCurrent(
  value: unknown,
  checkedAt: string
): void {
  const assertion =
    typeof value === "object" && value !== null
      ? terminalExportCurrentAssertions.get(value)
      : undefined;
  if (assertion === undefined) {
    throw new Error(
      "Terminal export current-state check requires an authentic ready bundle capability."
    );
  }
  assertion(checkedAt);
}
