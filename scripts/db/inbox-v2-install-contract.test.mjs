import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  INBOX_V2_DATABASE_LIFECYCLE_SCHEMA_VERSION,
  INBOX_V2_DISPOSITION_MANIFEST_SCHEMA_ID,
  INBOX_V2_MIGRATION_CONTRACT_VERSION,
  INBOX_V2_MIG_001_EVIDENCE_SCHEMA_ID,
  INBOX_V2_OBJECT_STORAGE_RECEIPT_SCHEMA_ID,
  INBOX_V2_REPOSITORY_BOOTSTRAP_SCHEMA_ID,
  assertInboxV2DisposableResetAuthorized,
  assertInboxV2Mig001EvidenceMatches,
  assertInboxV2ObjectStorageReceiptMatches,
  digestInboxV2ReviewedDisposition,
  parseInboxV2DispositionManifest,
  parseInboxV2Mig001Evidence,
  parseInboxV2RepositoryBootstrap,
  readInboxV2DispositionManifest,
  sha256
} from "./inbox-v2-install-contract.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const reviewNow = "2026-07-15T10:30:00.000Z";
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});

describe("Inbox V2 database lifecycle contracts", () => {
  it("accepts a complete disposable MIG-001 manifest only with its exact digest", () => {
    const manifest = validManifest();

    expect(
      assertInboxV2DisposableResetAuthorized({
        manifest,
        manifestDigest: digest,
        confirmation: digest,
        now: reviewNow
      })
    ).toMatchObject({
      classification: "disposable",
      deploymentKind: "ephemeral_ci",
      fastPath: { inventoryTaskId: "INB2-MIG-001", decision: "eligible" },
      reset: { authorized: true, rotateStreamEpoch: true }
    });
  });

  it("rejects implicit authority from environment, classification or deployment labels", () => {
    for (const mutation of [
      (manifest) => {
        manifest.classification = "empty";
      },
      (manifest) => {
        manifest.classification = "preserve";
      },
      (manifest) => {
        manifest.deploymentKind = "shared_development";
      },
      (manifest) => {
        manifest.deploymentKind = "saas_shared";
      },
      (manifest) => {
        manifest.deploymentKind = "saas_isolated";
      },
      (manifest) => {
        manifest.deploymentKind = "on_prem";
      },
      (manifest) => {
        manifest.deploymentKind = "unknown";
      }
    ]) {
      const manifest = validManifest();
      mutation(manifest);
      expect(() =>
        assertInboxV2DisposableResetAuthorized({
          manifest,
          manifestDigest: digest,
          confirmation: digest,
          now: reviewNow
        })
      ).toThrow(/reset_(classification|deployment_kind)_forbidden/u);
    }
  });

  it("rejects a missing MIG-001 decision or any non-passing condition", () => {
    for (const decision of ["pending", "preserve"]) {
      const manifest = validManifest();
      manifest.fastPath.decision = decision;
      expect(() => authorize(manifest)).toThrow(
        /reset_fast_path_not_eligible/u
      );
    }

    const conditionNames = Object.keys(validManifest().fastPath.conditions);
    for (const condition of conditionNames) {
      const manifest = validManifest();
      manifest.fastPath.conditions[condition] = false;
      expect(() => authorize(manifest)).toThrow(
        /reset_fast_path_condition_failed/u
      );
    }
  });

  it("rejects live provider, uncertain outbox and lease inventory", () => {
    for (const field of [
      "activeProviderSessions",
      "pendingOrUncertainOutbox",
      "activeLeases"
    ]) {
      const manifest = validManifest();
      manifest.inventory[field] = 1;
      expect(() => authorize(manifest)).toThrow(
        /reset_active_effects_present/u
      );
    }
  });

  it("requires explicit reset, epoch rotation and a coherent object-store receipt", () => {
    const unauthorized = validManifest();
    unauthorized.reset.authorized = false;
    expect(() => authorize(unauthorized)).toThrow(
      /reset_authorization_incomplete/u
    );

    const noRotation = validManifest();
    noRotation.reset.rotateStreamEpoch = false;
    expect(() => authorize(noRotation)).toThrow(
      /reset_authorization_incomplete/u
    );

    const wrongScope = validManifest();
    wrongScope.objectStorage.scope = "bucket/customer-data";
    expect(() => authorize(wrongScope)).toThrow(
      /reset_object_storage_scope_invalid/u
    );

    const manifest = validManifest();
    expect(
      assertInboxV2ObjectStorageReceiptMatches({
        manifest,
        receipt: validObjectReceipt(),
        receiptDigest: digest
      })
    ).toEqual(validObjectReceipt());
    expect(() =>
      assertInboxV2ObjectStorageReceiptMatches({
        manifest,
        receipt: { ...validObjectReceipt(), scope: "other" },
        receiptDigest: digest
      })
    ).toThrow(/reset_object_receipt_mismatch/u);
    expect(() =>
      assertInboxV2ObjectStorageReceiptMatches({
        manifest,
        receipt: validObjectReceipt(),
        receiptDigest: `sha256:${"c".repeat(64)}`
      })
    ).toThrow(/reset_object_receipt_digest_mismatch/u);
  });

  it("requires a separate MIG-001 receipt bound to the manifest generation and target", () => {
    const manifest = validManifest();
    expect(
      assertInboxV2Mig001EvidenceMatches({
        manifest,
        evidence: validMig001Evidence(),
        evidenceDigest: digest
      })
    ).toEqual(parseInboxV2Mig001Evidence(validMig001Evidence()));

    for (const mutation of [
      (evidence) => {
        evidence.manifestId = "manifest:other";
      },
      (evidence) => {
        evidence.resetGeneration = "reset:generation:other";
      },
      (evidence) => {
        evidence.target.databaseName = "hulee_db008_other";
      },
      (evidence) => {
        evidence.conditions.noRealCustomerData = false;
      }
    ]) {
      const evidence = validMig001Evidence();
      mutation(evidence);
      expect(() =>
        assertInboxV2Mig001EvidenceMatches({
          manifest,
          evidence,
          evidenceDigest: digest
        })
      ).toThrow(/reset_mig_001_evidence_mismatch/u);
    }

    const changedDisposition = validManifest();
    changedDisposition.inventory.tenantCount = 1;
    expect(() =>
      assertInboxV2Mig001EvidenceMatches({
        manifest: changedDisposition,
        evidence: validMig001Evidence(),
        evidenceDigest: digest
      })
    ).toThrow(/reset_mig_001_disposition_digest_mismatch/u);
  });

  it("requires the exact manifest SHA-256 instead of an environment confirmation", () => {
    const otherDigest = `sha256:${"b".repeat(64)}`;
    expect(() =>
      assertInboxV2DisposableResetAuthorized({
        manifest: validManifest(),
        manifestDigest: digest,
        confirmation: otherDigest
      })
    ).toThrow(/reset_confirmation_mismatch/u);
  });

  it("rejects expired, stale, future or overlong disposition authority", () => {
    const expired = validManifest();
    expect(() =>
      assertInboxV2DisposableResetAuthorized({
        manifest: expired,
        manifestDigest: digest,
        confirmation: digest,
        now: expired.expiresAt
      })
    ).toThrow(/reset_disposition_expired/u);

    const stale = validManifest();
    stale.fastPath.verifiedAt = "2026-07-15T08:59:59.999Z";
    stale.inventory.recordedAt = "2026-07-15T08:59:59.999Z";
    stale.objectStorage.verifiedAt = "2026-07-15T08:59:59.999Z";
    expect(() =>
      assertInboxV2DisposableResetAuthorized({
        manifest: stale,
        manifestDigest: digest,
        confirmation: digest,
        now: reviewNow
      })
    ).toThrow(/reset_disposition_evidence_stale/u);

    const reversedChronology = validManifest();
    reversedChronology.inventory.recordedAt = "2026-07-15T10:00:00.001Z";
    expect(() =>
      assertInboxV2DisposableResetAuthorized({
        manifest: reversedChronology,
        manifestDigest: digest,
        confirmation: digest,
        now: reviewNow
      })
    ).toThrow(/reset_disposition_chronology_invalid/u);

    const future = validManifest();
    expect(() =>
      assertInboxV2DisposableResetAuthorized({
        manifest: future,
        manifestDigest: digest,
        confirmation: digest,
        now: "2026-07-15T09:00:00.000Z"
      })
    ).toThrow(/reset_disposition_from_future/u);

    const overlong = validManifest();
    overlong.expiresAt = "2026-07-16T10:00:00.001Z";
    expect(() =>
      assertInboxV2DisposableResetAuthorized({
        manifest: overlong,
        manifestDigest: digest,
        confirmation: digest,
        now: reviewNow
      })
    ).toThrow(/reset_disposition_lifetime_invalid/u);
  });

  it("hashes the exact manifest bytes selected by the operator", async () => {
    const directory = await mkdtemp(join(tmpdir(), "hulee-db008-contract-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "manifest.json");
    const content = `${JSON.stringify(validManifest(), null, 2)}\n`;
    await writeFile(path, content, "utf8");

    await expect(readInboxV2DispositionManifest(path)).resolves.toMatchObject({
      digest: sha256(Buffer.from(content, "utf8")),
      manifest: { manifestId: "manifest:db008-test" }
    });
  });

  it("validates an explicit, unique repository bootstrap without legacy inbox rows", () => {
    const bootstrap = parseInboxV2RepositoryBootstrap(validBootstrap());
    expect(bootstrap).toEqual(validBootstrap());
    expect(Object.isFrozen(bootstrap)).toBe(true);
    expect(Object.isFrozen(bootstrap.tenant)).toBe(true);

    const duplicate = validBootstrap();
    duplicate.projections.push({ ...duplicate.projections[0] });
    expect(() => parseInboxV2RepositoryBootstrap(duplicate)).toThrow(
      /bootstrap_projection_duplicate/u
    );
  });

  it("rejects malformed versions, timestamps, digests and counters", () => {
    const mutations = [
      (manifest) => {
        manifest.schemaVersion = "v1";
      },
      (manifest) => {
        manifest.approvedAt = "not-a-time";
      },
      (manifest) => {
        manifest.fastPath.evidenceSha256 = "sha256:no";
      },
      (manifest) => {
        manifest.inventory.tenantCount = -1;
      },
      (manifest) => {
        manifest.target.postgresSystemIdentifier = "cluster-name";
      }
    ];
    for (const mutation of mutations) {
      const manifest = validManifest();
      mutation(manifest);
      expect(() => parseInboxV2DispositionManifest(manifest)).toThrow(
        /inbox_v2\.database_lifecycle_contract/u
      );
    }
  });
});

function authorize(manifest) {
  return assertInboxV2DisposableResetAuthorized({
    manifest,
    manifestDigest: digest,
    confirmation: digest,
    now: reviewNow
  });
}

function validManifest() {
  return {
    schemaId: INBOX_V2_DISPOSITION_MANIFEST_SCHEMA_ID,
    schemaVersion: INBOX_V2_DATABASE_LIFECYCLE_SCHEMA_VERSION,
    migrationContractVersion: INBOX_V2_MIGRATION_CONTRACT_VERSION,
    manifestId: "manifest:db008-test",
    deploymentId: "deployment:db008-test",
    deploymentKind: "ephemeral_ci",
    classification: "disposable",
    approvedBy: "operator:db008-test",
    approvedAt: "2026-07-15T10:00:00.000Z",
    expiresAt: "2026-07-15T11:00:00.000Z",
    reason: "Disposable integration database for guarded reset verification.",
    target: {
      postgresSystemIdentifier: "123456789",
      databaseName: "hulee_db008_test",
      databaseOwner: "hulee",
      migrationJournalSha256: digest,
      migrationContractSha256: digest
    },
    fastPath: {
      inventoryTaskId: "INB2-MIG-001",
      evidenceId: "evidence:db008-test",
      evidenceSha256: digest,
      decision: "eligible",
      verifiedAt: "2026-07-15T10:00:00.000Z",
      conditions: {
        noSupportedDeployment: true,
        noPromisedPublicApiConsumer: true,
        noRealCustomerData: true,
        noLegalHoldOrRequiredAudit: true,
        noActiveProviderOrUncertainEffect: true,
        noUnknownConsumerOrInstallation: true
      }
    },
    inventory: {
      recordedAt: "2026-07-15T10:00:00.000Z",
      databaseInventorySha256: digest,
      tenantCount: 0,
      v1BusinessRowCount: 0,
      activeProviderSessions: 0,
      pendingOrUncertainOutbox: 0,
      activeLeases: 0,
      publishedV2Cursor: false
    },
    objectStorage: {
      status: "not_configured",
      scope: "none",
      inventoryCheckpoint: "object-inventory:db008-test",
      receiptSha256: digest,
      verifiedAt: "2026-07-15T10:00:00.000Z"
    },
    reset: {
      generation: "reset:generation:db008-test",
      bootstrapSha256: digest,
      authorized: true,
      rotateStreamEpoch: true
    }
  };
}

function validBootstrap() {
  return {
    schemaId: INBOX_V2_REPOSITORY_BOOTSTRAP_SCHEMA_ID,
    schemaVersion: INBOX_V2_DATABASE_LIFECYCLE_SCHEMA_VERSION,
    tenant: {
      id: "tenant:db008-test",
      slug: "db008-test",
      displayName: "DB008 Test",
      deploymentType: "saas_shared"
    },
    projections: [
      {
        projectionId: "core:inbox-recipient-projection",
        scopeId: "tenant",
        projectionSchemaVersion: "v1"
      }
    ]
  };
}

function validObjectReceipt() {
  return {
    schemaId: INBOX_V2_OBJECT_STORAGE_RECEIPT_SCHEMA_ID,
    schemaVersion: INBOX_V2_DATABASE_LIFECYCLE_SCHEMA_VERSION,
    manifestId: "manifest:db008-test",
    resetGeneration: "reset:generation:db008-test",
    deploymentId: "deployment:db008-test",
    postgresSystemIdentifier: "123456789",
    databaseName: "hulee_db008_test",
    databaseOwner: "hulee",
    databaseInventorySha256: digest,
    status: "not_configured",
    scope: "none",
    inventoryCheckpoint: "object-inventory:db008-test",
    verifiedAt: "2026-07-15T10:00:00.000Z"
  };
}

function validMig001Evidence() {
  return {
    schemaId: INBOX_V2_MIG_001_EVIDENCE_SCHEMA_ID,
    schemaVersion: INBOX_V2_DATABASE_LIFECYCLE_SCHEMA_VERSION,
    taskId: "INB2-MIG-001",
    status: "completed",
    decision: "eligible",
    evidenceId: "evidence:db008-test",
    manifestId: "manifest:db008-test",
    resetGeneration: "reset:generation:db008-test",
    reviewedDispositionSha256:
      digestInboxV2ReviewedDisposition(validManifest()),
    target: {
      postgresSystemIdentifier: "123456789",
      databaseName: "hulee_db008_test",
      databaseOwner: "hulee"
    },
    verifiedAt: "2026-07-15T10:00:00.000Z",
    conditions: {
      noSupportedDeployment: true,
      noPromisedPublicApiConsumer: true,
      noRealCustomerData: true,
      noLegalHoldOrRequiredAudit: true,
      noActiveProviderOrUncertainEffect: true,
      noUnknownConsumerOrInstallation: true
    }
  };
}
