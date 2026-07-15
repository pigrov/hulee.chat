import {
  inboxV2PrivacyExportArtifactLifecycleRevisionSchema,
  inboxV2PrivacyExportLifecycleBootstrapInputSchema,
  inboxV2PrivacyExportLifecycleSnapshotSchema,
  inboxV2PolicyActivationAuthoritySchema,
  inboxV2PrivacyExportJobReferenceSchema,
  inboxV2PrivacyExportManifestReferenceSchema,
  inboxV2Sha256DigestSchema,
  inboxV2TenantIdSchema,
  type InboxV2PrivacyExportClaimLineage,
  type InboxV2PrivacyExportLifecycleBootstrapInput,
  type InboxV2PrivacyExportLifecycleSnapshot
} from "@hulee/contracts";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import {
  createSqlInboxV2PolicyActivationRepository,
  createSqlInboxV2PrivacyExportClaimRepository
} from "./sql-inbox-v2-data-governance-privacy-repository";
import { createSqlInboxV2PrivacyExportLifecycleRepository } from "./sql-inbox-v2-privacy-export-lifecycle-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const tenantA = inboxV2TenantIdSchema.parse(`tenant:db009-a-${suffix}`);
const tenantB = inboxV2TenantIdSchema.parse(`tenant:db009-b-${suffix}`);
const registryId = `registry:db009-${suffix}`;
const contextId = `core:db009-governance-${suffix}`;
const policyId = `core:db009-policy-${suffix}`;
const activationId = `core:db009-activation-${suffix}`;
const exportHandlerId = `core:export-db009-${suffix}`;
const jobA = `privacy-export-job:a-${suffix}`;
const jobB = `privacy-export-job:b-${suffix}`;
const jobRevocable = `privacy-export-job:revocable-${suffix}`;
const jobConcurrent = `privacy-export-job:concurrent-${suffix}`;
const manifestA = `privacy-export-manifest:a-${suffix}`;
const manifestB = `privacy-export-manifest:b-${suffix}`;
const manifestRevocable = `privacy-export-manifest:revocable-${suffix}`;
const artifactClaimKey = `artifact-claim:db009-${suffix}`;
const revocableArtifactClaimKey = `artifact-claim:revocable-${suffix}`;
const receiptKey = `receipt:db009-${suffix}`;
const revocableReceiptKey = `receipt:revocable-${suffix}`;
const principalKey = `principal:db009-${suffix}`;
const t0 = "2026-07-15T07:00:00.000Z";
const t1 = "2026-07-15T07:01:00.000Z";
const t2 = "2026-07-15T07:02:00.000Z";
const t3 = "2026-07-15T07:03:00.000Z";
const t4 = "2027-07-15T07:04:00.000Z";
const exportClock = Date.now();
const exportRequestedAt = timestamp(exportClock - 5 * 60_000);
const exportBuildingAt = timestamp(exportClock - 4 * 60_000);
const exportReadyAt = timestamp(exportClock - 3 * 60_000);
const exportReadyUpdatedAt = timestamp(exportClock - 2 * 60_000);
const exportExpiresAt = timestamp(exportClock + 23 * 60 * 60_000);
const hashA = digest(`${suffix}:a`);
const hashB = digest(`${suffix}:b`);
const hashC = digest(`${suffix}:c`);
const hashD = digest(`${suffix}:d`);
const hashE = digest(`${suffix}:e`);
const hashF = digest(`${suffix}:f`);

type ReadyExportFixture = Readonly<{
  bootstrap: InboxV2PrivacyExportLifecycleBootstrapInput;
  ready: InboxV2PrivacyExportLifecycleSnapshot;
  artifactId: string;
  artifactClaimKey: string;
}>;

let revocableFixture: ReadyExportFixture;

const authority = inboxV2PolicyActivationAuthoritySchema.parse({
  tenantId: tenantA,
  registryCompositionHash: hashA,
  governance: {
    tenantId: tenantA,
    id: contextId,
    version: "1",
    contextHash: hashB
  },
  effectivePolicy: {
    tenantId: tenantA,
    id: policyId,
    version: "1",
    policyHash: hashC
  },
  activation: {
    tenantId: tenantA,
    id: activationId,
    revision: "1",
    activationHash: hashD
  }
});

describePostgres(
  "SQL Inbox V2 data-governance/privacy repositories (PostgreSQL)",
  () => {
    let db: HuleeDatabase;

    beforeAll(async () => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error(
          "DATABASE_URL is required for the DB-009 repository integration test."
        );
      }
      db = createHuleeDatabase({
        connectionString: databaseUrl,
        poolConfig: { max: 6 }
      });
      const readiness = await db.execute<{
        policyHeads: string | null;
        exportArtifactHeads: string | null;
        exportClaims: string | null;
      }>(sql`
        select
          to_regclass(
            'public.inbox_v2_data_governance_policy_activation_heads'
          )::text as "policyHeads",
          to_regclass(
            'public.inbox_v2_data_governance_export_artifact_heads'
          )::text as "exportArtifactHeads",
          to_regclass(
            'public.inbox_v2_data_governance_export_claims'
          )::text as "exportClaims"
      `);
      expect(readiness.rows[0]).toEqual({
        policyHeads: "inbox_v2_data_governance_policy_activation_heads",
        exportArtifactHeads: "inbox_v2_data_governance_export_artifact_heads",
        exportClaims: "inbox_v2_data_governance_export_claims"
      });
      await seedAuthorityAndExports(db);
    }, 120_000);

    afterAll(async () => {
      if (db) await closeHuleeDatabase(db);
    });

    it("serializes activation bootstrap and rejects stale or missing authority", async () => {
      const repository = createSqlInboxV2PolicyActivationRepository(db);
      const key = {
        tenantId: tenantA,
        policyId: authority.effectivePolicy.id
      };

      await expect(repository.loadCurrent(key)).resolves.toEqual({
        outcome: "not_found"
      });
      const contenders = await Promise.all([
        repository.compareAndSetActivation({
          key,
          expectedCurrent: null,
          candidate: authority
        }),
        repository.compareAndSetActivation({
          key,
          expectedCurrent: null,
          candidate: authority
        })
      ]);
      expect(contenders.map(({ outcome }) => outcome).sort()).toEqual([
        "already_applied",
        "applied"
      ]);
      await expect(repository.loadCurrent(key)).resolves.toEqual({
        outcome: "found",
        current: authority
      });
      await expect(
        repository.compareAndSetActivation({
          key,
          expectedCurrent: null,
          candidate: authority
        })
      ).resolves.toEqual({ outcome: "already_applied", current: authority });

      const missingRegistry = inboxV2PolicyActivationAuthoritySchema.parse({
        ...authority,
        registryCompositionHash: hashF,
        activation: {
          ...authority.activation,
          id: `core:db009-missing-activation-${suffix}`,
          revision: "2",
          activationHash: hashF
        }
      });
      await expect(
        repository.compareAndSetActivation({
          key,
          expectedCurrent: authority,
          candidate: missingRegistry
        })
      ).resolves.toEqual({
        outcome: "not_found",
        missingAuthority: "registry_composition"
      });
    });

    it("serializes an exact export bootstrap and rejects substituted authority", async () => {
      const repository = createSqlInboxV2PrivacyExportLifecycleRepository(db);
      const input = exportBootstrap(jobConcurrent);
      const contenders = await Promise.all([
        repository.bootstrap(input),
        repository.bootstrap(input)
      ]);
      expect(contenders.map(({ outcome }) => outcome).sort()).toEqual([
        "already_applied",
        "applied"
      ]);
      await expect(
        repository.bootstrap({
          ...input,
          principalKey: "employee:substituted"
        })
      ).resolves.toMatchObject({ outcome: "conflict" });
    });

    it("rejects mixed job/manifest lineage and consumes one exact receipt once", async () => {
      const repository = createSqlInboxV2PrivacyExportClaimRepository(db);
      const correct = claimLineage(jobA, manifestA, hashE);
      const mixed = claimLineage(jobA, manifestB, hashF);

      await expect(
        repository.issue({
          artifactClaimKey,
          receiptKey,
          principalKey,
          issuedRevision: "1",
          lineage: mixed
        })
      ).resolves.toEqual({ outcome: "conflict" });
      expect(await claimCount(db)).toBe(0);

      const issued = await Promise.all([
        repository.issue({
          artifactClaimKey,
          receiptKey,
          principalKey,
          issuedRevision: "1",
          lineage: correct
        }),
        repository.issue({
          artifactClaimKey,
          receiptKey,
          principalKey,
          issuedRevision: "1",
          lineage: correct
        })
      ]);
      expect(issued.map(({ outcome }) => outcome).sort()).toEqual([
        "applied",
        "conflict"
      ]);

      await expect(
        repository.consume({
          artifactClaimKey,
          receiptKey,
          principalKey,
          expectedRevision: "1",
          nextRevision: "2",
          lineage: correct
        })
      ).resolves.toEqual({ outcome: "applied", claimRevision: "2" });
      await expect(
        repository.consume({
          artifactClaimKey,
          receiptKey,
          principalKey,
          expectedRevision: "1",
          nextRevision: "2",
          lineage: correct
        })
      ).resolves.toEqual({ outcome: "conflict" });
    });

    it("rejects an issued receipt after the authoritative artifact head is quarantined", async () => {
      const claims = createSqlInboxV2PrivacyExportClaimRepository(db);
      const lineage = claimLineage(jobRevocable, manifestRevocable, hashB);
      await expect(
        claims.issue({
          artifactClaimKey: revocableArtifactClaimKey,
          receiptKey: revocableReceiptKey,
          principalKey,
          issuedRevision: "1",
          lineage
        })
      ).resolves.toEqual({ outcome: "applied", claimRevision: "1" });

      const recordedAt = timestamp(
        Math.max(
          Date.now(),
          Date.parse(revocableFixture.ready.updatedAt) + 1_000
        )
      );
      const updatedAt = timestamp(Date.parse(recordedAt) + 1);
      const quarantined =
        inboxV2PrivacyExportArtifactLifecycleRevisionSchema.parse({
          tenantId: tenantA,
          artifactId: revocableFixture.artifactId,
          revision: "3",
          job: revocableFixture.bootstrap.key,
          artifactClaimKey: revocableFixture.artifactClaimKey,
          state: "quarantined",
          manifest: null,
          payloadChecksum: null,
          payloadLocator: `tenant/${tenantA}/exports/${suffix}/revocable`,
          packagingProofHash: null,
          archiveCompositionHash: null,
          byteCount: "1",
          readyAt: null,
          expiresAt: null,
          deletedAt: null,
          recordedAt
        });
      const revoked = inboxV2PrivacyExportLifecycleSnapshotSchema.parse({
        stateRevision: "4",
        state: "revoked",
        manifest: revocableFixture.ready.manifest,
        artifact: {
          reference: {
            tenantId: tenantA,
            artifactId: quarantined.artifactId,
            revision: quarantined.revision,
            state: quarantined.state
          },
          artifactClaimKey: quarantined.artifactClaimKey
        },
        updatedAt
      });
      await expect(
        createSqlInboxV2PrivacyExportLifecycleRepository(db).compareAndSet({
          key: revocableFixture.bootstrap.key,
          expected: revocableFixture.ready,
          candidate: revoked,
          artifactRevision: quarantined
        })
      ).resolves.toEqual({ outcome: "applied", current: revoked });

      await expect(
        claims.consume({
          artifactClaimKey: revocableArtifactClaimKey,
          receiptKey: revocableReceiptKey,
          principalKey,
          expectedRevision: "1",
          nextRevision: "2",
          lineage
        })
      ).resolves.toEqual({ outcome: "conflict" });
    });
  }
);

async function seedAuthorityAndExports(db: HuleeDatabase): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`
      insert into tenants (id, slug, display_name, deployment_type)
      values
        (${tenantA}, ${`db009-a-${suffix}`}, 'DB009 tenant A', 'saas_shared'),
        (${tenantB}, ${`db009-b-${suffix}`}, 'DB009 tenant B', 'saas_shared')
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_registry_versions (
        id, revision, schema_version, composition_hash, canonical_snapshot,
        activated_at, created_at
      ) values (${registryId}, 1, 'v1', ${hashA}, '{}'::jsonb, ${t1}, ${t0})
    `);
    await transaction.execute(sql`
      insert into inbox_v2_data_governance_lifecycle_handlers (
        registry_id, registry_revision, handler_id, kind, handler_version,
        bounded, idempotent, checks_tenant_fence, checks_revision_fence,
        checks_hold_fence, verifies_absence, canonical_snapshot
      ) values (
        ${registryId}, 1, ${exportHandlerId}, 'export_execution', 1,
        true, true, true, true, true, false, '{}'::jsonb
      )
    `);
    for (const [tenantId, contextHash, policyHash, activationHash] of [
      [tenantA, hashB, hashC, hashD],
      [tenantB, hashE, hashF, hashA]
    ] as const) {
      await transaction.execute(sql`
        insert into inbox_v2_data_governance_contexts (
          tenant_id, context_id, version, context_hash, policy_revision,
          registry_id, registry_revision, deployment_profile, time_zone,
          tzdb_version, approved_at, effective_at, review_at,
          canonical_snapshot
        ) values (
          ${tenantId}, ${contextId}, 1, ${contextHash}, 1,
          ${registryId}, 1, 'saas_shared', 'UTC', '2026a', ${t0}, ${t1},
          ${t4}, '{}'::jsonb
        )
      `);
      await transaction.execute(sql`
        insert into inbox_v2_data_governance_effective_policies (
          tenant_id, policy_id, version, policy_hash, registry_id,
          registry_revision, governance_context_id,
          governance_context_version, deployment_profile, effective_at,
          canonical_snapshot, created_at
        ) values (
          ${tenantId}, ${policyId}, 1, ${policyHash}, ${registryId}, 1,
          ${contextId}, 1, 'saas_shared', ${t2}, '{}'::jsonb, ${t1}
        )
      `);
      await transaction.execute(sql`
        insert into inbox_v2_data_governance_policy_activations (
          tenant_id, activation_id, revision, activation_hash, policy_id,
          policy_version, candidate_policy_hash, governance_context_id,
          governance_context_version, governance_context_hash,
          transition_kind, requester_principal_kind, requester_principal_key,
          requester_decision_id, requester_decision_hash,
          approver_principal_kind, approver_principal_key,
          approver_decision_id, approver_decision_hash, reason_code,
          impact_preview_hash, impact_stream_epoch, impact_sync_generation,
          impact_complete_through_position, affected_root_count,
          affected_byte_count, held_root_count, backup_copy_count,
          requested_at, approved_at, not_before, activated_at,
          canonical_snapshot
        ) values (
          ${tenantId}, ${activationId}, 1, ${activationHash}, ${policyId},
          1, ${policyHash}, ${contextId}, 1, ${contextHash},
          'initial_reviewed_bootstrap', 'service', 'service:requester',
          'decision:requester', ${hashA}, 'service', 'service:approver',
          'decision:approver', ${hashB}, 'reviewed_bootstrap', ${hashC},
          'epoch:db009', 1, 0, 0, 0, 0, 0, ${t0}, ${t1}, ${t2}, ${t3},
          '{}'::jsonb
        )
      `);
    }
    await transaction.execute(sql`set constraints all immediate`);
  });

  await seedReadyExport(db, jobA, manifestA, hashE, artifactClaimKey);
  await seedManifestOnly(db, jobB, manifestB, hashF);
  revocableFixture = await seedReadyExport(
    db,
    jobRevocable,
    manifestRevocable,
    hashB,
    revocableArtifactClaimKey
  );
}

async function seedReadyExport(
  db: HuleeDatabase,
  jobId: string,
  manifestId: string,
  manifestHash: string,
  claimKey: string
): Promise<ReadyExportFixture> {
  const bootstrap = exportBootstrap(jobId);
  const lifecycle = createSqlInboxV2PrivacyExportLifecycleRepository(db);
  await expect(lifecycle.bootstrap(bootstrap)).resolves.toEqual({
    outcome: "applied",
    current: {
      stateRevision: "1",
      state: "queued",
      manifest: null,
      artifact: null,
      updatedAt: exportRequestedAt
    }
  });
  const initial = inboxV2PrivacyExportLifecycleSnapshotSchema.parse({
    stateRevision: "1",
    state: "queued",
    manifest: null,
    artifact: null,
    updatedAt: exportRequestedAt
  });
  const artifactId = `privacy-export-artifact:${jobId}`;
  const building = inboxV2PrivacyExportArtifactLifecycleRevisionSchema.parse({
    tenantId: tenantA,
    artifactId,
    revision: "1",
    job: bootstrap.key,
    artifactClaimKey: claimKey,
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
    recordedAt: exportBuildingAt
  });
  const running = inboxV2PrivacyExportLifecycleSnapshotSchema.parse({
    stateRevision: "2",
    state: "running",
    manifest: null,
    artifact: {
      reference: {
        tenantId: tenantA,
        artifactId,
        revision: "1",
        state: "building"
      },
      artifactClaimKey: claimKey
    },
    updatedAt: exportBuildingAt
  });
  await expect(
    lifecycle.compareAndSet({
      key: bootstrap.key,
      expected: initial,
      candidate: running,
      artifactRevision: building
    })
  ).resolves.toEqual({ outcome: "applied", current: running });

  await db.execute(sql`
    insert into inbox_v2_data_governance_export_manifests (
      tenant_id, manifest_id, revision, manifest_hash, job_id, job_revision,
      scope_manifest_id, scope_manifest_revision, scope_proof_hash,
      root_set_hash, boundary, stream_epoch, sync_generation, complete_through_position,
      root_count, record_count, canonical_snapshot, created_at
    ) values (
      ${tenantA}, ${manifestId}, 1, ${manifestHash}, ${jobId}, 1,
      null, null, ${hashD}, ${hashE},
      'operated_data_plane', 'epoch:db009', 1, 0, 0, 0, '{}'::jsonb,
      ${exportReadyAt}
    )
  `);
  const manifest = inboxV2PrivacyExportManifestReferenceSchema.parse({
    tenantId: tenantA,
    manifestId,
    revision: "1",
    manifestHash
  });
  const readyArtifact =
    inboxV2PrivacyExportArtifactLifecycleRevisionSchema.parse({
      tenantId: tenantA,
      artifactId,
      revision: "2",
      job: bootstrap.key,
      artifactClaimKey: claimKey,
      state: "ready",
      manifest,
      payloadChecksum: hashF,
      payloadLocator: `tenant/${tenantA}/exports/${suffix}/${jobId}`,
      packagingProofHash: hashA,
      archiveCompositionHash: hashB,
      byteCount: "1",
      readyAt: exportReadyAt,
      expiresAt: exportExpiresAt,
      deletedAt: null,
      recordedAt: exportReadyAt
    });
  const ready = inboxV2PrivacyExportLifecycleSnapshotSchema.parse({
    stateRevision: "3",
    state: "ready",
    manifest,
    artifact: {
      reference: {
        tenantId: tenantA,
        artifactId,
        revision: "2",
        state: "ready"
      },
      artifactClaimKey: claimKey
    },
    updatedAt: exportReadyUpdatedAt
  });
  await expect(
    lifecycle.compareAndSet({
      key: bootstrap.key,
      expected: running,
      candidate: ready,
      artifactRevision: readyArtifact
    })
  ).resolves.toEqual({ outcome: "applied", current: ready });
  return { bootstrap, ready, artifactId, artifactClaimKey: claimKey };
}

async function seedManifestOnly(
  db: HuleeDatabase,
  jobId: string,
  manifestId: string,
  manifestHash: string
): Promise<void> {
  const bootstrap = exportBootstrap(jobId);
  await createSqlInboxV2PrivacyExportLifecycleRepository(db).bootstrap(
    bootstrap
  );
  await db.execute(sql`
    insert into inbox_v2_data_governance_export_manifests (
      tenant_id, manifest_id, revision, manifest_hash, job_id, job_revision,
      scope_manifest_id, scope_manifest_revision, scope_proof_hash,
      root_set_hash,
      boundary, stream_epoch, sync_generation, complete_through_position,
      root_count, record_count, canonical_snapshot, created_at
    ) values (
      ${tenantA}, ${manifestId}, 1, ${manifestHash}, ${jobId}, 1,
      null, null, ${hashD}, ${hashE},
      'operated_data_plane', 'epoch:db009', 1, 0, 0, 0, '{}'::jsonb,
      ${exportReadyAt}
    )
  `);
}

function exportBootstrap(
  jobId: string
): InboxV2PrivacyExportLifecycleBootstrapInput {
  return inboxV2PrivacyExportLifecycleBootstrapInputSchema.parse({
    key: {
      tenantId: tenantA,
      jobId,
      revision: "1",
      requestedAt: exportRequestedAt
    },
    productKind: "manager_report",
    productAuthority: {
      kind: "manager_report",
      id: `report:${jobId}`,
      revision: "1",
      hash: hashD
    },
    request: null,
    scopeManifest: null,
    registry: { id: registryId, revision: "1" },
    exportHandlerId,
    principalKey,
    createdAt: exportRequestedAt
  });
}

function claimLineage(
  jobId: string,
  manifestId: string,
  manifestHash: string
): InboxV2PrivacyExportClaimLineage {
  return {
    job: inboxV2PrivacyExportJobReferenceSchema.parse({
      tenantId: tenantA,
      jobId,
      revision: "1",
      requestedAt: exportRequestedAt
    }),
    manifest: inboxV2PrivacyExportManifestReferenceSchema.parse({
      tenantId: tenantA,
      manifestId,
      revision: "1",
      manifestHash
    }),
    packagingProofHash: hashA,
    archiveCompositionHash: hashB,
    issuedReceiptHash: hashC
  };
}

async function claimCount(db: HuleeDatabase): Promise<number> {
  const result = await db.execute<{ count: string }>(sql`
    select count(*)::text as count
      from inbox_v2_data_governance_export_claims
     where tenant_id = ${tenantA}
       and artifact_claim_key = ${artifactClaimKey}
  `);
  return Number(result.rows[0]?.count ?? "0");
}

function digest(value: string) {
  return inboxV2Sha256DigestSchema.parse(
    `sha256:${createHash("sha256").update(value).digest("hex")}`
  );
}

function timestamp(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}
