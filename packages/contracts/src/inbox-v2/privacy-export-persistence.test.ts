import { describe, expect, it } from "vitest";

import { inboxV2TenantIdSchema } from "./ids";
import {
  bootstrapInboxV2PrivacyExportLifecycle,
  compareAndSetInboxV2PrivacyExportLifecycle,
  defineInboxV2PrivacyExportLifecycleRepository,
  inboxV2PrivacyExportArtifactLifecycleRevisionSchema,
  inboxV2PrivacyExportLifecycleBootstrapInputSchema,
  inboxV2PrivacyExportLifecycleSnapshotSchema,
  inboxV2PrivacyExportLifecycleTransitionInputSchema,
  initialInboxV2PrivacyExportLifecycleSnapshot
} from "./privacy-export-persistence";

const tenantA = inboxV2TenantIdSchema.parse("tenant:export-lifecycle-a");
const tenantB = inboxV2TenantIdSchema.parse("tenant:export-lifecycle-b");
const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const digestC = `sha256:${"c".repeat(64)}`;
const digestD = `sha256:${"d".repeat(64)}`;
const t0 = "2026-07-15T07:00:00.000Z";
const t1 = "2026-07-15T07:01:00.000Z";
const t2 = "2026-07-15T07:02:00.000Z";
const t3 = "2026-07-15T07:03:00.000Z";

const bootstrap = inboxV2PrivacyExportLifecycleBootstrapInputSchema.parse({
  key: {
    tenantId: tenantA,
    jobId: "privacy-export-job:lifecycle-a",
    revision: "1",
    requestedAt: t0
  },
  productKind: "manager_report",
  productAuthority: {
    kind: "manager_report",
    id: "report-scope:lifecycle-a",
    revision: "1",
    hash: digestA
  },
  request: null,
  scopeManifest: null,
  registry: { id: "registry:lifecycle-a", revision: "1" },
  exportHandlerId: "core:export-handler",
  principalKey: "employee:operator-a",
  createdAt: t0
});

const initial = initialInboxV2PrivacyExportLifecycleSnapshot(bootstrap);
const buildingRevision =
  inboxV2PrivacyExportArtifactLifecycleRevisionSchema.parse({
    tenantId: tenantA,
    artifactId: "privacy-export-artifact:lifecycle-a",
    revision: "1",
    job: bootstrap.key,
    artifactClaimKey: "artifact-claim:lifecycle-a",
    state: "building",
    manifest: null,
    payloadChecksum: null,
    payloadLocator: null,
    packagingProofHash: null,
    archiveCompositionHash: null,
    byteCount: "0",
    readyAt: null,
    expiresAt: null,
    deletedAt: null,
    recordedAt: t1
  });
const running = inboxV2PrivacyExportLifecycleSnapshotSchema.parse({
  stateRevision: "2",
  state: "running" as const,
  manifest: null,
  artifact: {
    reference: {
      tenantId: tenantA,
      artifactId: buildingRevision.artifactId,
      revision: buildingRevision.revision,
      state: buildingRevision.state
    },
    artifactClaimKey: buildingRevision.artifactClaimKey
  },
  updatedAt: t1
});

describe("Inbox V2 privacy export lifecycle persistence contract", () => {
  it("defines an exact queued bootstrap and rejects product/raw payload ambiguity", () => {
    expect(initial).toEqual({
      stateRevision: "1",
      state: "queued",
      manifest: null,
      artifact: null,
      updatedAt: t0
    });
    expect(
      inboxV2PrivacyExportLifecycleBootstrapInputSchema.safeParse({
        ...bootstrap,
        productKind: "data_subject"
      }).success
    ).toBe(false);
    expect(
      inboxV2PrivacyExportLifecycleBootstrapInputSchema.safeParse({
        ...bootstrap,
        canonicalSnapshot: { rawContent: "forbidden" }
      }).success
    ).toBe(false);
    expect(
      inboxV2PrivacyExportArtifactLifecycleRevisionSchema.safeParse({
        ...buildingRevision,
        rawContent: "forbidden"
      }).success
    ).toBe(false);
  });

  it("binds tenant deployment to one typed current scope/governance/policy authority", () => {
    const tenantDeployment = {
      ...bootstrap,
      productKind: "tenant_deployment" as const,
      productAuthority: {
        kind: "tenant_deployment" as const,
        tenantScope: {
          kind: "tenant_termination_scope" as const,
          tenantId: tenantA,
          id: "core:tenant-termination-scope.a",
          revision: "1",
          registryCompositionHash: digestA,
          rootSetHash: digestB,
          exportRootSetHash: digestC,
          proofHash: digestD
        },
        governance: {
          tenantId: tenantA,
          id: "core:governance.tenant-termination-a",
          version: "1",
          contextHash: digestA
        },
        policy: {
          tenantId: tenantA,
          id: "core:policy.tenant-termination-a",
          version: "1",
          policyHash: digestB
        },
        activation: {
          tenantId: tenantA,
          id: "core:activation.tenant-termination-a",
          revision: "1",
          activationHash: digestC
        }
      }
    };
    expect(
      inboxV2PrivacyExportLifecycleBootstrapInputSchema.parse(tenantDeployment)
        .productAuthority
    ).toEqual(tenantDeployment.productAuthority);
    expect(
      inboxV2PrivacyExportLifecycleBootstrapInputSchema.safeParse({
        ...tenantDeployment,
        productAuthority: {
          ...tenantDeployment.productAuthority,
          governance: {
            ...tenantDeployment.productAuthority.governance,
            tenantId: tenantB
          }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2PrivacyExportLifecycleBootstrapInputSchema.safeParse({
        ...tenantDeployment,
        productAuthority: {
          kind: "tenant_deployment",
          id: "scope:untyped",
          revision: "1",
          hash: digestA
        }
      }).success
    ).toBe(false);
  });

  it("requires +1 state/artifact revisions, strict time and legal tenant-safe edges", () => {
    const valid = {
      key: bootstrap.key,
      expected: initial,
      candidate: running,
      artifactRevision: buildingRevision
    };
    expect(
      inboxV2PrivacyExportLifecycleTransitionInputSchema.parse(valid)
    ).toEqual(valid);
    expect(
      inboxV2PrivacyExportLifecycleTransitionInputSchema.safeParse({
        ...valid,
        candidate: { ...running, updatedAt: initial.updatedAt },
        artifactRevision: { ...buildingRevision, recordedAt: initial.updatedAt }
      }).success
    ).toBe(false);
    expect(
      inboxV2PrivacyExportLifecycleTransitionInputSchema.safeParse({
        ...valid,
        candidate: { ...running, state: "completed" }
      }).success
    ).toBe(false);
    expect(
      inboxV2PrivacyExportLifecycleTransitionInputSchema.safeParse({
        ...valid,
        artifactRevision: { ...buildingRevision, tenantId: tenantB }
      }).success
    ).toBe(false);
  });

  it("keeps the artifact claim key stable through a safe terminal edge", () => {
    const quarantined =
      inboxV2PrivacyExportArtifactLifecycleRevisionSchema.parse({
        ...buildingRevision,
        revision: "2",
        state: "quarantined",
        payloadLocator: "tenant/export/quarantine/object",
        recordedAt: t2
      });
    const failed = inboxV2PrivacyExportLifecycleSnapshotSchema.parse({
      stateRevision: "3",
      state: "failed_retryable",
      manifest: null,
      artifact: {
        reference: {
          tenantId: tenantA,
          artifactId: quarantined.artifactId,
          revision: quarantined.revision,
          state: quarantined.state
        },
        artifactClaimKey: quarantined.artifactClaimKey
      },
      updatedAt: t2
    });
    expect(
      inboxV2PrivacyExportLifecycleTransitionInputSchema.safeParse({
        key: bootstrap.key,
        expected: running,
        candidate: failed,
        artifactRevision: quarantined
      }).success
    ).toBe(true);
    expect(
      inboxV2PrivacyExportLifecycleTransitionInputSchema.safeParse({
        key: bootstrap.key,
        expected: running,
        candidate: {
          ...failed,
          artifact: {
            ...failed.artifact,
            artifactClaimKey: "artifact-claim:substituted"
          }
        },
        artifactRevision: {
          ...quarantined,
          artifactClaimKey: "artifact-claim:substituted"
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2PrivacyExportLifecycleTransitionInputSchema.safeParse({
        key: bootstrap.key,
        expected: failed,
        candidate: {
          ...failed,
          stateRevision: "4",
          state: "revoked",
          updatedAt: t3
        },
        artifactRevision: null
      }).success
    ).toBe(true);
  });

  it("requires the registered port and verifies exact applied snapshots", async () => {
    const repository = defineInboxV2PrivacyExportLifecycleRepository({
      async bootstrap() {
        return { outcome: "applied", current: initial };
      },
      async loadCurrent() {
        return { outcome: "found", current: initial };
      },
      async compareAndSet() {
        return { outcome: "applied", current: running };
      }
    });
    await expect(
      bootstrapInboxV2PrivacyExportLifecycle({ repository, bootstrap })
    ).resolves.toEqual({ outcome: "applied", current: initial });
    await expect(
      compareAndSetInboxV2PrivacyExportLifecycle({
        repository,
        mutation: {
          key: bootstrap.key,
          expected: initial,
          candidate: running,
          artifactRevision: buildingRevision
        }
      })
    ).resolves.toEqual({ outcome: "applied", current: running });

    const raw = {
      bootstrap: async () => ({
        outcome: "applied" as const,
        current: initial
      }),
      loadCurrent: async () => ({
        outcome: "found" as const,
        current: initial
      }),
      compareAndSet: async () => ({
        outcome: "applied" as const,
        current: running
      })
    };
    await expect(
      bootstrapInboxV2PrivacyExportLifecycle({ repository: raw, bootstrap })
    ).rejects.toThrow("registered durable repository");
  });
});
