import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const INBOX_V2_DISPOSITION_MANIFEST_SCHEMA_ID =
  "core:inbox-v2.database-disposition-manifest";
export const INBOX_V2_REPOSITORY_BOOTSTRAP_SCHEMA_ID =
  "core:inbox-v2.repository-bootstrap";
export const INBOX_V2_OBJECT_STORAGE_RECEIPT_SCHEMA_ID =
  "core:inbox-v2.object-storage-reset-receipt";
export const INBOX_V2_MIG_001_EVIDENCE_SCHEMA_ID =
  "core:inbox-v2.mig-001-disposition-evidence";
export const INBOX_V2_DATABASE_LIFECYCLE_SCHEMA_VERSION = "v2";
export const INBOX_V2_MIGRATION_CONTRACT_VERSION = "inbox-v2-clean-install-v2";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const MAX_DISPOSITION_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const MAX_EVIDENCE_AGE_MS = 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const POSTGRES_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/u;
const DISPOSABLE_DEPLOYMENT_KINDS = new Set(["personal_local", "ephemeral_ci"]);
const DEPLOYMENT_KINDS = new Set([
  ...DISPOSABLE_DEPLOYMENT_KINDS,
  "shared_development",
  "saas_shared",
  "saas_isolated",
  "on_prem",
  "unknown"
]);
const CLASSIFICATIONS = new Set(["empty", "disposable", "preserve"]);
const OBJECT_STORAGE_STATUSES = new Set([
  "not_configured",
  "verified_empty",
  "reset_completed"
]);
const DEPLOYMENT_TYPES = new Set(["saas_shared", "saas_isolated", "on_prem"]);
const FAST_PATH_CONDITIONS = [
  "noSupportedDeployment",
  "noPromisedPublicApiConsumer",
  "noRealCustomerData",
  "noLegalHoldOrRequiredAudit",
  "noActiveProviderOrUncertainEffect",
  "noUnknownConsumerOrInstallation"
];

export class InboxV2DatabaseLifecycleContractError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "InboxV2DatabaseLifecycleContractError";
    this.code = code;
  }
}

export async function readInboxV2DispositionManifest(path) {
  const bytes = await readFile(requiredString(path, "manifest path"));
  const digest = sha256(bytes);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw contractError(
      "inbox_v2.reset_manifest_json_invalid",
      `Disposition manifest is not valid JSON: ${errorMessage(error)}`
    );
  }
  return Object.freeze({
    manifest: parseInboxV2DispositionManifest(value),
    digest
  });
}

export async function readInboxV2RepositoryBootstrap(path) {
  const bytes = await readFile(requiredString(path, "bootstrap path"));
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw contractError(
      "inbox_v2.bootstrap_json_invalid",
      `Repository bootstrap is not valid JSON: ${errorMessage(error)}`
    );
  }
  return Object.freeze({
    bootstrap: parseInboxV2RepositoryBootstrap(value),
    digest: sha256(bytes)
  });
}

export async function readInboxV2ObjectStorageReceipt(path) {
  const bytes = await readFile(requiredString(path, "object receipt path"));
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw contractError(
      "inbox_v2.object_receipt_json_invalid",
      `Object-storage receipt is not valid JSON: ${errorMessage(error)}`
    );
  }
  return Object.freeze({
    receipt: parseInboxV2ObjectStorageReceipt(value),
    digest: sha256(bytes)
  });
}

export async function readInboxV2Mig001Evidence(path) {
  const bytes = await readFile(requiredString(path, "MIG-001 evidence path"));
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw contractError(
      "inbox_v2.mig_001_evidence_json_invalid",
      `MIG-001 evidence is not valid JSON: ${errorMessage(error)}`
    );
  }
  return Object.freeze({
    evidence: parseInboxV2Mig001Evidence(value),
    digest: sha256(bytes)
  });
}

export function parseInboxV2DispositionManifest(value) {
  const manifest = record(value, "disposition manifest");
  exactValue(
    manifest.schemaId,
    INBOX_V2_DISPOSITION_MANIFEST_SCHEMA_ID,
    "schemaId"
  );
  exactValue(
    manifest.schemaVersion,
    INBOX_V2_DATABASE_LIFECYCLE_SCHEMA_VERSION,
    "schemaVersion"
  );
  exactValue(
    manifest.migrationContractVersion,
    INBOX_V2_MIGRATION_CONTRACT_VERSION,
    "migrationContractVersion"
  );

  const target = record(manifest.target, "target");
  const fastPath = record(manifest.fastPath, "fastPath");
  const conditions = record(fastPath.conditions, "fastPath.conditions");
  const inventory = record(manifest.inventory, "inventory");
  const objectStorage = record(manifest.objectStorage, "objectStorage");
  const reset = record(manifest.reset, "reset");

  const parsed = {
    schemaId: INBOX_V2_DISPOSITION_MANIFEST_SCHEMA_ID,
    schemaVersion: INBOX_V2_DATABASE_LIFECYCLE_SCHEMA_VERSION,
    migrationContractVersion: INBOX_V2_MIGRATION_CONTRACT_VERSION,
    manifestId: boundedString(manifest.manifestId, "manifestId", 3, 256),
    deploymentId: boundedString(manifest.deploymentId, "deploymentId", 3, 256),
    deploymentKind: enumValue(
      manifest.deploymentKind,
      DEPLOYMENT_KINDS,
      "deploymentKind"
    ),
    classification: enumValue(
      manifest.classification,
      CLASSIFICATIONS,
      "classification"
    ),
    approvedBy: boundedString(manifest.approvedBy, "approvedBy", 3, 256),
    approvedAt: isoTimestamp(manifest.approvedAt, "approvedAt"),
    expiresAt: isoTimestamp(manifest.expiresAt, "expiresAt"),
    reason: boundedString(manifest.reason, "reason", 10, 2_000),
    target: {
      postgresSystemIdentifier: digitString(
        target.postgresSystemIdentifier,
        "target.postgresSystemIdentifier"
      ),
      databaseName: postgresIdentifier(
        target.databaseName,
        "target.databaseName"
      ),
      databaseOwner: postgresIdentifier(
        target.databaseOwner,
        "target.databaseOwner"
      ),
      migrationJournalSha256: sha256Value(
        target.migrationJournalSha256,
        "target.migrationJournalSha256"
      ),
      migrationContractSha256: sha256Value(
        target.migrationContractSha256,
        "target.migrationContractSha256"
      )
    },
    fastPath: {
      inventoryTaskId: boundedString(
        fastPath.inventoryTaskId,
        "fastPath.inventoryTaskId",
        3,
        64
      ),
      evidenceId: boundedString(
        fastPath.evidenceId,
        "fastPath.evidenceId",
        3,
        256
      ),
      evidenceSha256: sha256Value(
        fastPath.evidenceSha256,
        "fastPath.evidenceSha256"
      ),
      decision: enumValue(
        fastPath.decision,
        new Set(["eligible", "preserve", "pending"]),
        "fastPath.decision"
      ),
      verifiedAt: isoTimestamp(fastPath.verifiedAt, "fastPath.verifiedAt"),
      conditions: Object.fromEntries(
        FAST_PATH_CONDITIONS.map((name) => [
          name,
          booleanValue(conditions[name], `fastPath.conditions.${name}`)
        ])
      )
    },
    inventory: {
      recordedAt: isoTimestamp(inventory.recordedAt, "inventory.recordedAt"),
      databaseInventorySha256: sha256Value(
        inventory.databaseInventorySha256,
        "inventory.databaseInventorySha256"
      ),
      tenantCount: nonnegativeInteger(
        inventory.tenantCount,
        "inventory.tenantCount"
      ),
      v1BusinessRowCount: nonnegativeInteger(
        inventory.v1BusinessRowCount,
        "inventory.v1BusinessRowCount"
      ),
      activeProviderSessions: nonnegativeInteger(
        inventory.activeProviderSessions,
        "inventory.activeProviderSessions"
      ),
      pendingOrUncertainOutbox: nonnegativeInteger(
        inventory.pendingOrUncertainOutbox,
        "inventory.pendingOrUncertainOutbox"
      ),
      activeLeases: nonnegativeInteger(
        inventory.activeLeases,
        "inventory.activeLeases"
      ),
      publishedV2Cursor: booleanValue(
        inventory.publishedV2Cursor,
        "inventory.publishedV2Cursor"
      )
    },
    objectStorage: {
      status: enumValue(
        objectStorage.status,
        OBJECT_STORAGE_STATUSES,
        "objectStorage.status"
      ),
      scope: boundedString(objectStorage.scope, "objectStorage.scope", 1, 512),
      inventoryCheckpoint: boundedString(
        objectStorage.inventoryCheckpoint,
        "objectStorage.inventoryCheckpoint",
        3,
        512
      ),
      receiptSha256: sha256Value(
        objectStorage.receiptSha256,
        "objectStorage.receiptSha256"
      ),
      verifiedAt: isoTimestamp(
        objectStorage.verifiedAt,
        "objectStorage.verifiedAt"
      )
    },
    reset: {
      generation: boundedString(reset.generation, "reset.generation", 8, 256),
      bootstrapSha256: sha256Value(
        reset.bootstrapSha256,
        "reset.bootstrapSha256"
      ),
      authorized: booleanValue(reset.authorized, "reset.authorized"),
      rotateStreamEpoch: booleanValue(
        reset.rotateStreamEpoch,
        "reset.rotateStreamEpoch"
      )
    }
  };

  return deepFreeze(parsed);
}

export function parseInboxV2RepositoryBootstrap(value) {
  const bootstrap = record(value, "repository bootstrap");
  exactValue(
    bootstrap.schemaId,
    INBOX_V2_REPOSITORY_BOOTSTRAP_SCHEMA_ID,
    "schemaId"
  );
  exactValue(
    bootstrap.schemaVersion,
    INBOX_V2_DATABASE_LIFECYCLE_SCHEMA_VERSION,
    "schemaVersion"
  );
  const tenant = record(bootstrap.tenant, "tenant");
  if (
    !Array.isArray(bootstrap.projections) ||
    bootstrap.projections.length < 1
  ) {
    throw contractError(
      "inbox_v2.bootstrap_projections_invalid",
      "At least one projection bootstrap is required."
    );
  }
  if (bootstrap.projections.length > 64) {
    throw contractError(
      "inbox_v2.bootstrap_projections_invalid",
      "At most 64 projection bootstraps are allowed."
    );
  }
  const projections = bootstrap.projections.map((rawProjection, index) => {
    const projection = record(rawProjection, `projections[${index}]`);
    return {
      projectionId: boundedString(
        projection.projectionId,
        `projections[${index}].projectionId`,
        3,
        256
      ),
      scopeId: boundedString(
        projection.scopeId,
        `projections[${index}].scopeId`,
        1,
        256
      ),
      projectionSchemaVersion: boundedString(
        projection.projectionSchemaVersion,
        `projections[${index}].projectionSchemaVersion`,
        1,
        64
      )
    };
  });
  const keys = projections.map(
    ({ projectionId, scopeId }) => `${projectionId}\u0000${scopeId}`
  );
  if (new Set(keys).size !== keys.length) {
    throw contractError(
      "inbox_v2.bootstrap_projection_duplicate",
      "Projection bootstrap identities must be unique."
    );
  }

  return deepFreeze({
    schemaId: INBOX_V2_REPOSITORY_BOOTSTRAP_SCHEMA_ID,
    schemaVersion: INBOX_V2_DATABASE_LIFECYCLE_SCHEMA_VERSION,
    tenant: {
      id: boundedString(tenant.id, "tenant.id", 3, 256),
      slug: boundedString(tenant.slug, "tenant.slug", 1, 128),
      displayName: boundedString(
        tenant.displayName,
        "tenant.displayName",
        1,
        256
      ),
      deploymentType: enumValue(
        tenant.deploymentType,
        DEPLOYMENT_TYPES,
        "tenant.deploymentType"
      )
    },
    projections
  });
}

export function parseInboxV2ObjectStorageReceipt(value) {
  const receipt = record(value, "object-storage receipt");
  exactValue(
    receipt.schemaId,
    INBOX_V2_OBJECT_STORAGE_RECEIPT_SCHEMA_ID,
    "schemaId"
  );
  exactValue(
    receipt.schemaVersion,
    INBOX_V2_DATABASE_LIFECYCLE_SCHEMA_VERSION,
    "schemaVersion"
  );
  return deepFreeze({
    schemaId: INBOX_V2_OBJECT_STORAGE_RECEIPT_SCHEMA_ID,
    schemaVersion: INBOX_V2_DATABASE_LIFECYCLE_SCHEMA_VERSION,
    manifestId: boundedString(receipt.manifestId, "manifestId", 3, 256),
    resetGeneration: boundedString(
      receipt.resetGeneration,
      "resetGeneration",
      8,
      256
    ),
    deploymentId: boundedString(receipt.deploymentId, "deploymentId", 3, 256),
    postgresSystemIdentifier: digitString(
      receipt.postgresSystemIdentifier,
      "postgresSystemIdentifier"
    ),
    databaseName: postgresIdentifier(receipt.databaseName, "databaseName"),
    databaseOwner: postgresIdentifier(receipt.databaseOwner, "databaseOwner"),
    databaseInventorySha256: sha256Value(
      receipt.databaseInventorySha256,
      "databaseInventorySha256"
    ),
    status: enumValue(receipt.status, OBJECT_STORAGE_STATUSES, "status"),
    scope: boundedString(receipt.scope, "scope", 1, 512),
    inventoryCheckpoint: boundedString(
      receipt.inventoryCheckpoint,
      "inventoryCheckpoint",
      3,
      512
    ),
    verifiedAt: isoTimestamp(receipt.verifiedAt, "verifiedAt")
  });
}

export function parseInboxV2Mig001Evidence(value) {
  const evidence = record(value, "MIG-001 evidence");
  exactValue(
    evidence.schemaId,
    INBOX_V2_MIG_001_EVIDENCE_SCHEMA_ID,
    "schemaId"
  );
  exactValue(
    evidence.schemaVersion,
    INBOX_V2_DATABASE_LIFECYCLE_SCHEMA_VERSION,
    "schemaVersion"
  );
  const target = record(evidence.target, "target");
  const conditions = record(evidence.conditions, "conditions");
  return deepFreeze({
    schemaId: INBOX_V2_MIG_001_EVIDENCE_SCHEMA_ID,
    schemaVersion: INBOX_V2_DATABASE_LIFECYCLE_SCHEMA_VERSION,
    taskId: boundedString(evidence.taskId, "taskId", 3, 64),
    status: enumValue(evidence.status, new Set(["completed"]), "status"),
    decision: enumValue(evidence.decision, new Set(["eligible"]), "decision"),
    evidenceId: boundedString(evidence.evidenceId, "evidenceId", 3, 256),
    manifestId: boundedString(evidence.manifestId, "manifestId", 3, 256),
    resetGeneration: boundedString(
      evidence.resetGeneration,
      "resetGeneration",
      8,
      256
    ),
    reviewedDispositionSha256: sha256Value(
      evidence.reviewedDispositionSha256,
      "reviewedDispositionSha256"
    ),
    target: {
      postgresSystemIdentifier: digitString(
        target.postgresSystemIdentifier,
        "target.postgresSystemIdentifier"
      ),
      databaseName: postgresIdentifier(
        target.databaseName,
        "target.databaseName"
      ),
      databaseOwner: postgresIdentifier(
        target.databaseOwner,
        "target.databaseOwner"
      )
    },
    verifiedAt: isoTimestamp(evidence.verifiedAt, "verifiedAt"),
    conditions: Object.fromEntries(
      FAST_PATH_CONDITIONS.map((name) => [
        name,
        booleanValue(conditions[name], `conditions.${name}`)
      ])
    )
  });
}

export function assertInboxV2ObjectStorageReceiptMatches(input) {
  const manifest = parseInboxV2DispositionManifest(input.manifest);
  const receipt = parseInboxV2ObjectStorageReceipt(input.receipt);
  const receiptDigest = sha256Value(input.receiptDigest, "receiptDigest");
  if (receiptDigest !== manifest.objectStorage.receiptSha256) {
    throw contractError(
      "inbox_v2.reset_object_receipt_digest_mismatch",
      "The selected object-storage receipt does not match the manifest digest."
    );
  }
  for (const [receiptField, manifestValue] of [
    ["manifestId", manifest.manifestId],
    ["resetGeneration", manifest.reset.generation],
    ["deploymentId", manifest.deploymentId],
    ["postgresSystemIdentifier", manifest.target.postgresSystemIdentifier],
    ["databaseName", manifest.target.databaseName],
    ["databaseOwner", manifest.target.databaseOwner],
    ["databaseInventorySha256", manifest.inventory.databaseInventorySha256],
    ["status", manifest.objectStorage.status],
    ["scope", manifest.objectStorage.scope],
    ["inventoryCheckpoint", manifest.objectStorage.inventoryCheckpoint],
    ["verifiedAt", manifest.objectStorage.verifiedAt]
  ]) {
    if (receipt[receiptField] !== manifestValue) {
      throw contractError(
        "inbox_v2.reset_object_receipt_mismatch",
        `Object-storage receipt field ${receiptField} does not match the manifest.`
      );
    }
  }
  return receipt;
}

export function assertInboxV2Mig001EvidenceMatches(input) {
  const manifest = parseInboxV2DispositionManifest(input.manifest);
  const evidence = parseInboxV2Mig001Evidence(input.evidence);
  const evidenceDigest = sha256Value(input.evidenceDigest, "evidenceDigest");
  if (evidenceDigest !== manifest.fastPath.evidenceSha256) {
    throw contractError(
      "inbox_v2.reset_mig_001_evidence_digest_mismatch",
      "The selected MIG-001 evidence does not match the manifest digest."
    );
  }
  if (
    evidence.reviewedDispositionSha256 !==
    digestInboxV2ReviewedDisposition(manifest)
  ) {
    throw contractError(
      "inbox_v2.reset_mig_001_disposition_digest_mismatch",
      "MIG-001 evidence does not bind the exact reviewed disposition payload."
    );
  }
  for (const [evidenceValue, manifestValue, label] of [
    [evidence.taskId, manifest.fastPath.inventoryTaskId, "taskId"],
    [evidence.decision, manifest.fastPath.decision, "decision"],
    [evidence.evidenceId, manifest.fastPath.evidenceId, "evidenceId"],
    [evidence.manifestId, manifest.manifestId, "manifestId"],
    [evidence.resetGeneration, manifest.reset.generation, "resetGeneration"],
    [evidence.verifiedAt, manifest.fastPath.verifiedAt, "verifiedAt"]
  ]) {
    if (evidenceValue !== manifestValue) {
      throw contractError(
        "inbox_v2.reset_mig_001_evidence_mismatch",
        `MIG-001 evidence field ${label} does not match the manifest.`
      );
    }
  }
  for (const name of FAST_PATH_CONDITIONS) {
    if (evidence.conditions[name] !== manifest.fastPath.conditions[name]) {
      throw contractError(
        "inbox_v2.reset_mig_001_evidence_mismatch",
        `MIG-001 evidence condition ${name} does not match the manifest.`
      );
    }
  }
  for (const key of [
    "postgresSystemIdentifier",
    "databaseName",
    "databaseOwner"
  ]) {
    if (evidence.target[key] !== manifest.target[key]) {
      throw contractError(
        "inbox_v2.reset_mig_001_evidence_mismatch",
        `MIG-001 evidence target ${key} does not match the manifest.`
      );
    }
  }
  return evidence;
}

export function digestInboxV2ReviewedDisposition(value) {
  const manifest = parseInboxV2DispositionManifest(value);
  const { evidenceSha256: _evidenceSha256, ...fastPath } = manifest.fastPath;
  return sha256(
    Buffer.from(
      JSON.stringify({
        ...manifest,
        fastPath
      }),
      "utf8"
    )
  );
}

export function assertInboxV2DisposableResetAuthorized(input) {
  const manifest = assertInboxV2DisposableResetContract(input);
  assertDispositionFreshness(manifest, input.now);
  return manifest;
}

export function assertInboxV2DisposableResetContract(input) {
  const manifest = parseInboxV2DispositionManifest(input.manifest);
  const confirmation = sha256Value(input.confirmation, "confirmation");
  const manifestDigest = sha256Value(input.manifestDigest, "manifestDigest");
  if (confirmation !== manifestDigest) {
    throw contractError(
      "inbox_v2.reset_confirmation_mismatch",
      "The exact disposition manifest SHA-256 must be supplied as confirmation."
    );
  }
  if (manifest.classification !== "disposable") {
    throw contractError(
      "inbox_v2.reset_classification_forbidden",
      "Only an explicitly disposable deployment can be reset."
    );
  }
  if (!DISPOSABLE_DEPLOYMENT_KINDS.has(manifest.deploymentKind)) {
    throw contractError(
      "inbox_v2.reset_deployment_kind_forbidden",
      "Shared, SaaS, on-prem and unknown deployments cannot use this reset path."
    );
  }
  if (
    manifest.fastPath.inventoryTaskId !== "INB2-MIG-001" ||
    manifest.fastPath.decision !== "eligible"
  ) {
    throw contractError(
      "inbox_v2.reset_fast_path_not_eligible",
      "INB2-MIG-001 must record an eligible fast-path disposition."
    );
  }
  for (const condition of FAST_PATH_CONDITIONS) {
    if (manifest.fastPath.conditions[condition] !== true) {
      throw contractError(
        "inbox_v2.reset_fast_path_condition_failed",
        `Fast-path condition ${condition} must be explicitly true.`
      );
    }
  }
  if (
    manifest.inventory.activeProviderSessions !== 0 ||
    manifest.inventory.pendingOrUncertainOutbox !== 0 ||
    manifest.inventory.activeLeases !== 0
  ) {
    throw contractError(
      "inbox_v2.reset_active_effects_present",
      "Active provider sessions, uncertain outbox effects and leases must all be zero."
    );
  }
  if (!manifest.reset.authorized || !manifest.reset.rotateStreamEpoch) {
    throw contractError(
      "inbox_v2.reset_authorization_incomplete",
      "Reset authorization and stream-epoch rotation must both be explicit."
    );
  }
  if (
    manifest.objectStorage.status === "not_configured" &&
    manifest.objectStorage.scope !== "none"
  ) {
    throw contractError(
      "inbox_v2.reset_object_storage_scope_invalid",
      "An unconfigured object store must use the exact scope none."
    );
  }
  return manifest;
}

export function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function contractError(code, message) {
  return new InboxV2DatabaseLifecycleContractError(code, message);
}

function assertDispositionFreshness(manifest, nowInput) {
  const now =
    nowInput === undefined
      ? Date.now()
      : nowInput instanceof Date
        ? nowInput.getTime()
        : Date.parse(nowInput);
  if (!Number.isFinite(now)) {
    throw contractError(
      "inbox_v2.database_lifecycle_contract_invalid",
      "Reset authorization time must be a valid timestamp."
    );
  }
  const approvedAt = Date.parse(manifest.approvedAt);
  const expiresAt = Date.parse(manifest.expiresAt);
  const evidenceTimes = [
    manifest.fastPath.verifiedAt,
    manifest.inventory.recordedAt,
    manifest.objectStorage.verifiedAt
  ].map((value) => Date.parse(value));
  if (evidenceTimes.some((timestamp) => timestamp > approvedAt)) {
    throw contractError(
      "inbox_v2.reset_disposition_chronology_invalid",
      "Inventory and external evidence must be verified no later than final approval."
    );
  }
  if (
    evidenceTimes.some(
      (timestamp) => approvedAt - timestamp > MAX_EVIDENCE_AGE_MS
    )
  ) {
    throw contractError(
      "inbox_v2.reset_disposition_evidence_stale",
      "Inventory and external evidence must be refreshed within one hour of final approval."
    );
  }
  if (
    approvedAt > now + MAX_CLOCK_SKEW_MS ||
    evidenceTimes.some((timestamp) => timestamp > now + MAX_CLOCK_SKEW_MS)
  ) {
    throw contractError(
      "inbox_v2.reset_disposition_from_future",
      "Disposition approval or evidence is later than the allowed clock skew."
    );
  }
  if (
    expiresAt <= approvedAt ||
    expiresAt - approvedAt > MAX_DISPOSITION_LIFETIME_MS
  ) {
    throw contractError(
      "inbox_v2.reset_disposition_lifetime_invalid",
      "Disposition expiry must be after approval and no more than 24 hours later."
    );
  }
  if (now >= expiresAt) {
    throw contractError(
      "inbox_v2.reset_disposition_expired",
      "Disposition approval has expired and must be refreshed before reset."
    );
  }
}

function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw contractError(
      "inbox_v2.database_lifecycle_contract_invalid",
      `${label} must be an object.`
    );
  }
  return value;
}

function exactValue(value, expected, label) {
  if (value !== expected) {
    throw contractError(
      "inbox_v2.database_lifecycle_contract_version_unsupported",
      `${label} must be ${expected}.`
    );
  }
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw contractError(
      "inbox_v2.database_lifecycle_contract_invalid",
      `${label} must be a non-empty string.`
    );
  }
  return value;
}

function boundedString(value, label, minimum, maximum) {
  const parsed = requiredString(value, label);
  if (parsed.length < minimum || parsed.length > maximum) {
    throw contractError(
      "inbox_v2.database_lifecycle_contract_invalid",
      `${label} must contain between ${minimum} and ${maximum} characters.`
    );
  }
  return parsed;
}

function enumValue(value, choices, label) {
  if (!choices.has(value)) {
    throw contractError(
      "inbox_v2.database_lifecycle_contract_invalid",
      `${label} has an unsupported value.`
    );
  }
  return value;
}

function booleanValue(value, label) {
  if (typeof value !== "boolean") {
    throw contractError(
      "inbox_v2.database_lifecycle_contract_invalid",
      `${label} must be a boolean.`
    );
  }
  return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw contractError(
      "inbox_v2.database_lifecycle_contract_invalid",
      `${label} must be a non-negative safe integer.`
    );
  }
  return value;
}

function isoTimestamp(value, label) {
  const parsed = requiredString(value, label);
  const timestamp = Date.parse(parsed);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== parsed
  ) {
    throw contractError(
      "inbox_v2.database_lifecycle_contract_invalid",
      `${label} must be an exact UTC ISO-8601 timestamp.`
    );
  }
  return parsed;
}

function sha256Value(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw contractError(
      "inbox_v2.database_lifecycle_contract_invalid",
      `${label} must be a lowercase sha256:<64 hex> digest.`
    );
  }
  return value;
}

function digitString(value, label) {
  if (typeof value !== "string" || !/^\d{1,32}$/u.test(value)) {
    throw contractError(
      "inbox_v2.database_lifecycle_contract_invalid",
      `${label} must be a decimal PostgreSQL system identifier.`
    );
  }
  return value;
}

function postgresIdentifier(value, label) {
  if (typeof value !== "string" || !POSTGRES_IDENTIFIER_PATTERN.test(value)) {
    throw contractError(
      "inbox_v2.database_lifecycle_contract_invalid",
      `${label} must be a bounded PostgreSQL identifier.`
    );
  }
  return value;
}

function deepFreeze(value) {
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === "object") deepFreeze(nested);
  }
  return Object.freeze(value);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
