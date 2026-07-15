import {
  inboxV2PrivacyExportArtifactLifecycleRevisionSchema,
  inboxV2PrivacyExportLifecycleBootstrapInputSchema,
  inboxV2PrivacyExportLifecycleSnapshotSchema,
  inboxV2TenantIdSchema,
  initialInboxV2PrivacyExportLifecycleSnapshot
} from "@hulee/contracts";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildBootstrapInboxV2PrivacyExportLifecycleSql,
  buildCompareAndSetInboxV2PrivacyExportJobSql,
  buildFindInboxV2PrivacyExportArtifactHeadSql,
  buildFindInboxV2PrivacyExportLifecycleJobSql,
  buildInsertInboxV2PrivacyExportArtifactRevisionSql,
  createSqlInboxV2PrivacyExportLifecycleRepository,
  type InboxV2PrivacyExportLifecycleTransactionExecutor
} from "./sql-inbox-v2-privacy-export-lifecycle-repository";

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;
const digestC = `sha256:${"c".repeat(64)}`;
const digestD = `sha256:${"d".repeat(64)}`;
const t0 = "2026-07-15T08:00:00.000Z";
const t1 = "2026-07-15T08:01:00.000Z";

const bootstrap = inboxV2PrivacyExportLifecycleBootstrapInputSchema.parse({
  key: {
    tenantId: "tenant:export-lifecycle-sql",
    jobId: "privacy-export-job:sql",
    revision: "1",
    requestedAt: t0
  },
  productKind: "manager_report",
  productAuthority: {
    kind: "manager_report",
    id: "report-scope:sql",
    revision: "1",
    hash: digestA
  },
  request: null,
  scopeManifest: null,
  registry: { id: "registry:sql", revision: "1" },
  exportHandlerId: "core:export-handler",
  principalKey: "employee:sql",
  createdAt: t0
});
const managerAuthority =
  bootstrap.productAuthority.kind === "manager_report"
    ? bootstrap.productAuthority
    : (() => {
        throw new Error("Expected a manager-report export fixture.");
      })();
const initial = initialInboxV2PrivacyExportLifecycleSnapshot(bootstrap);
const tenantBootstrap = inboxV2PrivacyExportLifecycleBootstrapInputSchema.parse(
  {
    ...bootstrap,
    key: {
      ...bootstrap.key,
      jobId: "privacy-export-job:tenant-deployment-sql"
    },
    productKind: "tenant_deployment",
    productAuthority: {
      kind: "tenant_deployment",
      tenantScope: {
        kind: "tenant_termination_scope",
        tenantId: bootstrap.key.tenantId,
        id: "core:tenant-termination-scope.sql",
        revision: "1",
        registryCompositionHash: digestA,
        rootSetHash: digestB,
        exportRootSetHash: digestC,
        proofHash: digestD
      },
      governance: {
        tenantId: bootstrap.key.tenantId,
        id: "core:governance.tenant-termination-sql",
        version: "1",
        contextHash: digestA
      },
      policy: {
        tenantId: bootstrap.key.tenantId,
        id: "core:policy.tenant-termination-sql",
        version: "1",
        policyHash: digestB
      },
      activation: {
        tenantId: bootstrap.key.tenantId,
        id: "core:activation.tenant-termination-sql",
        revision: "1",
        activationHash: digestC
      }
    }
  }
);
const tenantInitial =
  initialInboxV2PrivacyExportLifecycleSnapshot(tenantBootstrap);
const tenantAuthority =
  tenantBootstrap.productAuthority.kind === "tenant_deployment"
    ? tenantBootstrap.productAuthority
    : (() => {
        throw new Error("Expected a tenant-deployment export fixture.");
      })();
const artifactRevision =
  inboxV2PrivacyExportArtifactLifecycleRevisionSchema.parse({
    tenantId: bootstrap.key.tenantId,
    artifactId: "privacy-export-artifact:sql",
    revision: "1",
    job: bootstrap.key,
    artifactClaimKey: "artifact-claim:sql",
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
  state: "running",
  manifest: null,
  artifact: {
    reference: {
      tenantId: bootstrap.key.tenantId,
      artifactId: artifactRevision.artifactId,
      revision: "1",
      state: "building"
    },
    artifactClaimKey: artifactRevision.artifactClaimKey
  },
  updatedAt: t1
});
const transition = {
  key: bootstrap.key,
  expected: initial,
  candidate: running,
  artifactRevision
} as const;

describe("SQL Inbox V2 privacy export lifecycle repository", () => {
  it("bootstraps queued authority once and recognizes an exact retry", async () => {
    const created = queuedExecutor([
      [],
      [],
      [{ applied: true }],
      [jobRow(initial)]
    ]);
    await expect(
      createSqlInboxV2PrivacyExportLifecycleRepository(created).bootstrap(
        bootstrap
      )
    ).resolves.toEqual({ outcome: "applied", current: initial });
    expect(created.queries[0]).toContain("pg_advisory_xact_lock");
    expect(created.queries[2]).toContain(
      "insert into inbox_v2_data_governance_export_jobs"
    );
    expect(created.queries[2]).toContain("'queued'");

    const retry = queuedExecutor([[], [jobRow(initial)]]);
    await expect(
      createSqlInboxV2PrivacyExportLifecycleRepository(retry).bootstrap(
        bootstrap
      )
    ).resolves.toEqual({ outcome: "already_applied", current: initial });
    expect(retry.queries).toHaveLength(2);
  });

  it("loads exact typed tenant-deployment scope and current authority without JSON", async () => {
    const executor = queuedExecutor([[tenantJobRow()]]);
    await expect(
      createSqlInboxV2PrivacyExportLifecycleRepository(executor).loadCurrent(
        tenantBootstrap.key
      )
    ).resolves.toEqual({ outcome: "found", current: tenantInitial });
    expect(executor.queries[0]).toContain(
      "inbox_v2_data_governance_tenant_termination_scope_authorities"
    );
    const bootstrapSql = render(
      buildBootstrapInboxV2PrivacyExportLifecycleSql(tenantBootstrap)
    );
    expect(bootstrapSql).toContain("governance_context_hash");
    expect(bootstrapSql).toContain("activation_hash");
    expect(bootstrapSql).toContain("scope_manifest_id");

    const incomplete = {
      ...tenantJobRow(),
      tenant_scope_proof_hash: null
    };
    await expect(
      createSqlInboxV2PrivacyExportLifecycleRepository(
        queuedExecutor([[incomplete]])
      ).loadCurrent(tenantBootstrap.key)
    ).rejects.toThrow("incomplete or substituted current authority");
  });

  it("normalizes raw PostgreSQL timestamptz strings with microseconds", async () => {
    const row = jobRow(initial);
    row.created_at = "2026-07-15 08:00:00.000000+00";
    row.updated_at = "2026-07-15 08:00:00.123456+00";

    await expect(
      createSqlInboxV2PrivacyExportLifecycleRepository(
        queuedExecutor([[row]])
      ).loadCurrent(bootstrap.key)
    ).resolves.toEqual({
      outcome: "found",
      current: { ...initial, updatedAt: "2026-07-15T08:00:00.123Z" }
    });
  });

  it("atomically appends revision/head and advances the exact job CAS", async () => {
    const executor = queuedExecutor([
      [],
      [jobRow(initial)],
      [{ applied: true }],
      [{ applied: true }],
      [{ applied: true }],
      [jobRow(running)],
      [headRow()]
    ]);
    await expect(
      createSqlInboxV2PrivacyExportLifecycleRepository(executor).compareAndSet(
        transition
      )
    ).resolves.toEqual({ outcome: "applied", current: running });
    expect(executor.queries[2]).toContain(
      "insert into inbox_v2_data_governance_export_artifacts"
    );
    expect(executor.queries[3]).toContain(
      "insert into inbox_v2_data_governance_export_artifact_heads"
    );
    expect(executor.queries[4]).toContain("state_revision =");
    expect(executor.queries[4]).toContain(
      "export_artifact_revision is not distinct from"
    );
  });

  it("reloads a concurrent CAS winner and separates an exact retry from a stale contender", async () => {
    const exactWinner = queuedExecutor([
      [],
      [jobRow(initial)],
      [{ applied: true }],
      [{ applied: true }],
      [],
      [],
      [jobRow(running)],
      [headRow()]
    ]);
    await expect(
      createSqlInboxV2PrivacyExportLifecycleRepository(
        exactWinner
      ).compareAndSet(transition)
    ).resolves.toEqual({ outcome: "already_applied", current: running });
    expect(exactWinner.queries).toHaveLength(8);

    const alternateRevision =
      inboxV2PrivacyExportArtifactLifecycleRevisionSchema.parse({
        ...artifactRevision,
        artifactId: "privacy-export-artifact:concurrent-contender",
        artifactClaimKey: "artifact-claim:concurrent-contender"
      });
    const alternateRunning = inboxV2PrivacyExportLifecycleSnapshotSchema.parse({
      ...running,
      artifact: {
        reference: {
          ...running.artifact!.reference,
          artifactId: alternateRevision.artifactId
        },
        artifactClaimKey: alternateRevision.artifactClaimKey
      }
    });
    const staleContender = queuedExecutor([
      [],
      [jobRow(initial)],
      [{ applied: true }],
      [{ applied: true }],
      [],
      [],
      [jobRow(running)],
      [headRow()]
    ]);
    await expect(
      createSqlInboxV2PrivacyExportLifecycleRepository(
        staleContender
      ).compareAndSet({
        ...transition,
        candidate: alternateRunning,
        artifactRevision: alternateRevision
      })
    ).resolves.toEqual({ outcome: "conflict", current: running });
    expect(staleContender.queries).toHaveLength(8);
  });

  it("recognizes an exact retry, returns stale conflict and rejects cross-tenant input", async () => {
    const retry = queuedExecutor([[], [jobRow(running)], [headRow()]]);
    await expect(
      createSqlInboxV2PrivacyExportLifecycleRepository(retry).compareAndSet(
        transition
      )
    ).resolves.toEqual({ outcome: "already_applied", current: running });
    expect(retry.queries).toHaveLength(3);

    const alternateRevision =
      inboxV2PrivacyExportArtifactLifecycleRevisionSchema.parse({
        ...artifactRevision,
        artifactId: "privacy-export-artifact:stale-contender",
        artifactClaimKey: "artifact-claim:stale-contender"
      });
    const alternateRunning = inboxV2PrivacyExportLifecycleSnapshotSchema.parse({
      ...running,
      artifact: {
        reference: {
          ...running.artifact!.reference,
          artifactId: alternateRevision.artifactId
        },
        artifactClaimKey: alternateRevision.artifactClaimKey
      }
    });
    const stale = queuedExecutor([[], [jobRow(running)], [headRow()]]);
    await expect(
      createSqlInboxV2PrivacyExportLifecycleRepository(stale).compareAndSet({
        ...transition,
        candidate: alternateRunning,
        artifactRevision: alternateRevision
      })
    ).resolves.toEqual({ outcome: "conflict", current: running });
    expect(stale.queries).toHaveLength(3);

    await expect(
      createSqlInboxV2PrivacyExportLifecycleRepository(
        queuedExecutor([])
      ).compareAndSet({
        ...transition,
        artifactRevision:
          inboxV2PrivacyExportArtifactLifecycleRevisionSchema.parse({
            ...artifactRevision,
            tenantId: inboxV2TenantIdSchema.parse("tenant:other"),
            job: {
              ...artifactRevision.job,
              tenantId: inboxV2TenantIdSchema.parse("tenant:other")
            }
          })
      })
    ).rejects.toThrow("tenant boundary");
  });

  it("renders tenant-fenced current-head and immutable typed snapshot SQL", () => {
    const artifactSql = render(
      buildInsertInboxV2PrivacyExportArtifactRevisionSql(artifactRevision)
    );
    const jobSql = render(
      buildCompareAndSetInboxV2PrivacyExportJobSql(transition)
    );
    const loadJobSql = render(
      buildFindInboxV2PrivacyExportLifecycleJobSql({
        key: bootstrap.key,
        forUpdate: true
      })
    );
    const loadHeadSql = render(
      buildFindInboxV2PrivacyExportArtifactHeadSql({
        key: bootstrap.key,
        artifactId: artifactRevision.artifactId,
        artifactRevision: artifactRevision.revision,
        forUpdate: true
      })
    );
    expect(artifactSql).toContain("canonical_snapshot");
    expect(artifactSql).toContain("manifest_id");
    expect(artifactSql).toContain("payload_checksum");
    expect(artifactSql).not.toContain("rawContent");
    expect(jobSql).toContain("where tenant_id =");
    expect(jobSql).toContain("and job_id =");
    expect(jobSql).toContain("and revision =");
    expect(loadJobSql).toContain("for update");
    expect(loadHeadSql).toContain("current_revision =");
  });
});

function jobRow(snapshot: typeof initial | typeof running) {
  return {
    tenant_id: bootstrap.key.tenantId,
    job_id: bootstrap.key.jobId,
    revision: bootstrap.key.revision,
    state_revision: snapshot.stateRevision,
    state: snapshot.state,
    product_kind: bootstrap.productKind,
    product_authority_id: managerAuthority.id,
    product_authority_revision: managerAuthority.revision,
    product_authority_hash: managerAuthority.hash,
    tenant_scope_registry_composition_hash: null,
    tenant_scope_root_set_hash: null,
    tenant_scope_export_root_set_hash: null,
    tenant_scope_proof_hash: null,
    request_id: null,
    request_revision: null,
    scope_manifest_id: null,
    scope_manifest_revision: null,
    governance_context_id: null,
    governance_context_version: null,
    governance_context_hash: null,
    policy_id: null,
    policy_version: null,
    policy_hash: null,
    activation_id: null,
    activation_revision: null,
    activation_hash: null,
    registry_id: bootstrap.registry.id,
    registry_revision: bootstrap.registry.revision,
    export_handler_id: bootstrap.exportHandlerId,
    principal_key: bootstrap.principalKey,
    export_manifest_id: null,
    export_manifest_revision: null,
    export_manifest_hash: null,
    export_artifact_id: snapshot.artifact?.reference.artifactId ?? null,
    export_artifact_revision: snapshot.artifact?.reference.revision ?? null,
    created_at: bootstrap.createdAt,
    updated_at: snapshot.updatedAt
  };
}

function tenantJobRow() {
  return {
    tenant_id: tenantBootstrap.key.tenantId,
    job_id: tenantBootstrap.key.jobId,
    revision: tenantBootstrap.key.revision,
    state_revision: tenantInitial.stateRevision,
    state: tenantInitial.state,
    product_kind: tenantBootstrap.productKind,
    product_authority_id: tenantAuthority.tenantScope.id,
    product_authority_revision: tenantAuthority.tenantScope.revision,
    product_authority_hash: tenantAuthority.tenantScope.proofHash,
    tenant_scope_registry_composition_hash:
      tenantAuthority.tenantScope.registryCompositionHash,
    tenant_scope_root_set_hash: tenantAuthority.tenantScope.rootSetHash,
    tenant_scope_export_root_set_hash:
      tenantAuthority.tenantScope.exportRootSetHash,
    tenant_scope_proof_hash: tenantAuthority.tenantScope.proofHash,
    request_id: null,
    request_revision: null,
    scope_manifest_id: tenantAuthority.tenantScope.id,
    scope_manifest_revision: tenantAuthority.tenantScope.revision,
    governance_context_id: tenantAuthority.governance.id,
    governance_context_version: tenantAuthority.governance.version,
    governance_context_hash: tenantAuthority.governance.contextHash,
    policy_id: tenantAuthority.policy.id,
    policy_version: tenantAuthority.policy.version,
    policy_hash: tenantAuthority.policy.policyHash,
    activation_id: tenantAuthority.activation.id,
    activation_revision: tenantAuthority.activation.revision,
    activation_hash: tenantAuthority.activation.activationHash,
    registry_id: tenantBootstrap.registry.id,
    registry_revision: tenantBootstrap.registry.revision,
    export_handler_id: tenantBootstrap.exportHandlerId,
    principal_key: tenantBootstrap.principalKey,
    export_manifest_id: null,
    export_manifest_revision: null,
    export_manifest_hash: null,
    export_artifact_id: null,
    export_artifact_revision: null,
    created_at: tenantBootstrap.createdAt,
    updated_at: tenantInitial.updatedAt
  };
}

function headRow() {
  return {
    tenant_id: bootstrap.key.tenantId,
    artifact_id: artifactRevision.artifactId,
    job_id: bootstrap.key.jobId,
    job_revision: bootstrap.key.revision,
    artifact_claim_key: artifactRevision.artifactClaimKey,
    current_revision: artifactRevision.revision,
    current_state: artifactRevision.state,
    updated_at: running.updatedAt
  };
}

function queuedExecutor(rows: readonly (readonly Record<string, unknown>[])[]) {
  let index = 0;
  const queries: string[] = [];
  const executor: InboxV2PrivacyExportLifecycleTransactionExecutor & {
    queries: string[];
  } = {
    queries,
    async execute(query) {
      queries.push(render(query));
      return { rows: (rows[index++] ?? []) as never };
    },
    async transaction(work) {
      return work(executor);
    }
  };
  return executor;
}

function render(query: Parameters<PgDialect["sqlToQuery"]>[0]): string {
  return new PgDialect().sqlToQuery(query).sql.replace(/\s+/gu, " ").trim();
}
