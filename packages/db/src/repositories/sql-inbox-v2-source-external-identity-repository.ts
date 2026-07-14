import {
  inboxV2AdapterIdentityDeclarationSchema,
  inboxV2EntityRevisionSchema,
  inboxV2SourceExternalIdentityIdSchema,
  inboxV2SourceExternalIdentitySchema,
  inboxV2SourceIdentityClaimIdSchema,
  inboxV2SourceIdentityClaimVersionSchema,
  inboxV2TenantIdSchema,
  type InboxV2SourceExternalIdentity,
  type InboxV2SourceExternalIdentityId,
  type InboxV2TenantId
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";

import type { HuleeDatabase } from "../client";
import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const FIND_OR_CREATE_INPUT_KEYS = new Set([
  "tenantId",
  "id",
  "realm",
  "objectKindId",
  "scope",
  "identityDeclaration",
  "materializationAuthority",
  "materializedAt",
  "canonicalExternalSubject",
  "stability",
  "createdAt"
]);

export type FindOrCreateInboxV2SourceExternalIdentityInput = Readonly<{
  tenantId: InboxV2TenantId;
  id: InboxV2SourceExternalIdentityId;
  realm: InboxV2SourceExternalIdentity["realm"];
  objectKindId: InboxV2SourceExternalIdentity["objectKindId"];
  scope: InboxV2SourceExternalIdentity["scope"];
  identityDeclaration: InboxV2SourceExternalIdentity["identityDeclaration"];
  materializationAuthority: InboxV2SourceExternalIdentity["materializationAuthority"];
  materializedAt: string;
  canonicalExternalSubject: string;
  stability: InboxV2SourceExternalIdentity["stability"];
  createdAt: string;
}>;

export type FindOrCreateInboxV2SourceExternalIdentityResult = Readonly<{
  kind:
    | "created"
    | "already_exists"
    | "identity_conflict"
    | "declaration_conflict"
    | "scoped_key_conflict";
  record: InboxV2SourceExternalIdentity;
}>;

export type InboxV2SourceExternalIdentityTransactionExecutor =
  RawSqlExecutor & {
    transaction<TResult>(
      work: (transaction: RawSqlExecutor) => Promise<TResult>
    ): Promise<TResult>;
  };

export type InboxV2SourceExternalIdentityRepository = Readonly<{
  findOrCreate(
    input: FindOrCreateInboxV2SourceExternalIdentityInput
  ): Promise<FindOrCreateInboxV2SourceExternalIdentityResult>;
  findById(input: {
    tenantId: InboxV2TenantId;
    id: InboxV2SourceExternalIdentityId;
  }): Promise<InboxV2SourceExternalIdentity | null>;
}>;

type InboxV2SourceExternalIdentityRow = {
  identity_tenant_id: unknown;
  identity_id: unknown;
  realm_id: unknown;
  realm_version: unknown;
  canonicalization_version: unknown;
  object_kind_id: unknown;
  scope_kind: unknown;
  source_connection_id: unknown;
  source_account_id: unknown;
  identity_declaration: unknown;
  declaration_contract_id: unknown;
  declaration_contract_version: unknown;
  declaration_revision: unknown;
  declaration_surface_id: unknown;
  declaration_loaded_by_trusted_service_id: unknown;
  declaration_loaded_at: unknown;
  materialized_by_trusted_service_id: unknown;
  materialization_authorization_token: unknown;
  materialized_at: unknown;
  canonical_external_subject: unknown;
  stability_kind: unknown;
  observation_kind: unknown;
  raw_inbound_event_id: unknown;
  normalized_inbound_event_id: unknown;
  observation_key: unknown;
  identity_revision: unknown;
  identity_created_at: unknown;
  identity_updated_at: unknown;
  head_source_external_identity_id: unknown;
  resolution_status: unknown;
  active_claim_id: unknown;
  latest_claim_version: unknown;
};

type IdentityIdRow = { identity_id: unknown };

export function createSqlInboxV2SourceExternalIdentityRepository(
  executor: InboxV2SourceExternalIdentityTransactionExecutor | HuleeDatabase
): InboxV2SourceExternalIdentityRepository {
  const transactionExecutor =
    executor as unknown as InboxV2SourceExternalIdentityTransactionExecutor;

  return {
    async findOrCreate(
      input: FindOrCreateInboxV2SourceExternalIdentityInput
    ): Promise<FindOrCreateInboxV2SourceExternalIdentityResult> {
      const normalized = normalizeFindOrCreateInput(input);

      return transactionExecutor.transaction(async (transaction) => {
        const insertResult = await transaction.execute<IdentityIdRow>(
          buildInsertInboxV2SourceExternalIdentitySql(normalized)
        );

        if (insertResult.rows.length > 1) {
          throw invariantError(
            "SourceExternalIdentity insert returned more than one row."
          );
        }

        if (insertResult.rows.length === 1) {
          const headResult = await transaction.execute<IdentityIdRow>(
            buildInsertInboxV2SourceExternalIdentityHeadSql(normalized)
          );

          if (headResult.rows.length > 1) {
            throw invariantError(
              "SourceExternalIdentity head insert returned more than one row."
            );
          }

          const created = await loadIdentityById(transaction, {
            tenantId: normalized.tenantId,
            id: normalized.id,
            lock: true
          });

          if (created === null) {
            throw invariantError(
              "SourceExternalIdentity create did not produce a complete aggregate."
            );
          }

          return { kind: "created", record: created };
        }

        const existingById = await loadIdentityById(transaction, {
          tenantId: normalized.tenantId,
          id: normalized.id,
          lock: true
        });

        if (existingById !== null) {
          const sameCanonicalShape = hasSameIdentityShape(
            existingById,
            normalized
          );
          return {
            kind: !sameCanonicalShape
              ? "identity_conflict"
              : !hasSameDeclarationProof(existingById, normalized)
                ? "declaration_conflict"
                : "already_exists",
            record: existingById
          };
        }

        const scopedIdentityId = await findIdentityIdByScopedKey(
          transaction,
          normalized
        );

        if (scopedIdentityId === null) {
          throw invariantError(
            "SourceExternalIdentity insert conflicted, but neither its ID nor scoped key can be loaded."
          );
        }

        const scopedIdentity = await loadIdentityById(transaction, {
          tenantId: normalized.tenantId,
          id: scopedIdentityId,
          lock: true
        });

        if (scopedIdentity === null) {
          throw invariantError(
            "Scoped SourceExternalIdentity conflict does not resolve to a complete aggregate."
          );
        }

        return {
          kind: hasSameDeclarationProof(scopedIdentity, normalized)
            ? "scoped_key_conflict"
            : "declaration_conflict",
          record: scopedIdentity
        };
      });
    },

    async findById(input): Promise<InboxV2SourceExternalIdentity | null> {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const id = inboxV2SourceExternalIdentityIdSchema.parse(input.id);

      return loadIdentityById(transactionExecutor, {
        tenantId,
        id,
        lock: false
      });
    }
  };
}

export function buildInsertInboxV2SourceExternalIdentitySql(
  identity: InboxV2SourceExternalIdentity
): SQL {
  const scope = toScopeColumns(identity.scope);
  const stability = toStabilityColumns(identity.stability);

  return sql`
    insert into inbox_v2_source_external_identities (
      tenant_id,
      id,
      realm_id,
      realm_version,
      canonicalization_version,
      object_kind_id,
      scope_kind,
      scope_source_connection_id,
      scope_source_account_id,
      identity_declaration,
      declaration_contract_id,
      declaration_contract_version,
      declaration_revision,
      declaration_surface_id,
      declaration_loaded_by_trusted_service_id,
      declaration_loaded_at,
      materialized_by_trusted_service_id,
      materialization_authorization_token,
      materialized_at,
      canonical_external_subject,
      stability_kind,
      ephemeral_raw_inbound_event_id,
      ephemeral_normalized_inbound_event_id,
      ephemeral_observation_key,
      revision,
      created_at,
      updated_at
    )
    values (
      ${identity.tenantId},
      ${identity.id},
      ${identity.realm.realmId},
      ${identity.realm.version},
      ${identity.realm.canonicalizationVersion},
      ${identity.objectKindId},
      ${identity.scope.kind},
      ${scope.sourceConnectionId},
      ${scope.sourceAccountId},
      ${identity.identityDeclaration},
      ${identity.identityDeclaration.adapterContract.contractId},
      ${identity.identityDeclaration.adapterContract.contractVersion},
      ${identity.identityDeclaration.adapterContract.declarationRevision},
      ${identity.identityDeclaration.adapterContract.surfaceId},
      ${identity.identityDeclaration.adapterContract.loadedByTrustedServiceId},
      ${identity.identityDeclaration.adapterContract.loadedAt},
      ${identity.materializationAuthority.trustedServiceId},
      ${identity.materializationAuthority.authorizationToken},
      ${identity.materializedAt},
      ${identity.canonicalExternalSubject},
      ${identity.stability.kind},
      ${stability.rawInboundEventId},
      ${stability.normalizedInboundEventId},
      ${stability.observationKey},
      1,
      ${identity.createdAt},
      ${identity.createdAt}
    )
    on conflict do nothing
    returning id as identity_id
  `;
}

export function buildInsertInboxV2SourceExternalIdentityHeadSql(
  identity: Pick<InboxV2SourceExternalIdentity, "tenantId" | "id">
): SQL {
  return sql`
    insert into inbox_v2_source_identity_claim_heads (
      tenant_id,
      source_external_identity_id,
      resolution_status,
      active_claim_id,
      latest_claim_version
    )
    values (
      ${identity.tenantId},
      ${identity.id},
      'unresolved',
      null,
      null
    )
    on conflict (tenant_id, source_external_identity_id) do nothing
    returning source_external_identity_id as identity_id
  `;
}

export function buildFindInboxV2SourceExternalIdentityByIdSql(input: {
  tenantId: InboxV2TenantId;
  id: InboxV2SourceExternalIdentityId;
}): SQL {
  return sql`
    select
      i.tenant_id as identity_tenant_id,
      i.id as identity_id,
      i.realm_id,
      i.realm_version,
      i.canonicalization_version,
      i.object_kind_id,
      i.scope_kind,
      i.scope_source_connection_id as source_connection_id,
      i.scope_source_account_id as source_account_id,
      i.identity_declaration,
      i.declaration_contract_id,
      i.declaration_contract_version,
      i.declaration_revision,
      i.declaration_surface_id,
      i.declaration_loaded_by_trusted_service_id,
      i.declaration_loaded_at,
      i.materialized_by_trusted_service_id,
      i.materialization_authorization_token,
      i.materialized_at,
      i.canonical_external_subject,
      i.stability_kind,
      case
        when i.ephemeral_raw_inbound_event_id is not null then 'raw_inbound_event'
        when i.ephemeral_normalized_inbound_event_id is not null then 'normalized_inbound_event'
        else null
      end as observation_kind,
      i.ephemeral_raw_inbound_event_id as raw_inbound_event_id,
      i.ephemeral_normalized_inbound_event_id as normalized_inbound_event_id,
      i.ephemeral_observation_key as observation_key,
      i.revision as identity_revision,
      i.created_at as identity_created_at,
      i.updated_at as identity_updated_at,
      h.source_external_identity_id as head_source_external_identity_id,
      h.resolution_status,
      h.active_claim_id,
      h.latest_claim_version
    from inbox_v2_source_external_identities i
    left join inbox_v2_source_identity_claim_heads h
      on h.tenant_id = i.tenant_id
     and h.source_external_identity_id = i.id
    where i.tenant_id = ${input.tenantId}
      and i.id = ${input.id}
  `;
}

export function buildLockInboxV2SourceExternalIdentitySql(input: {
  tenantId: InboxV2TenantId;
  id: InboxV2SourceExternalIdentityId;
}): SQL {
  return sql`
    select i.id as identity_id
    from inbox_v2_source_external_identities i
    where i.tenant_id = ${input.tenantId}
      and i.id = ${input.id}
    for update
  `;
}

export function buildLockInboxV2SourceExternalIdentityHeadSql(input: {
  tenantId: InboxV2TenantId;
  id: InboxV2SourceExternalIdentityId;
}): SQL {
  return sql`
    select h.source_external_identity_id as identity_id
    from inbox_v2_source_identity_claim_heads h
    where h.tenant_id = ${input.tenantId}
      and h.source_external_identity_id = ${input.id}
    for update
  `;
}

export function buildFindInboxV2SourceExternalIdentityIdByScopedKeySql(
  identity: InboxV2SourceExternalIdentity
): SQL {
  const scopePredicate = buildScopeKeyPredicate(identity.scope);
  const stabilityPredicate = buildStabilityKeyPredicate(identity.stability);
  const exactKeyDigest = sourceExternalIdentityExactKeyDigest(identity);

  return sql`
    select i.id as identity_id
    from inbox_v2_source_external_identities i
    where i.tenant_id = ${identity.tenantId}
      and i.realm_id = ${identity.realm.realmId}
      and i.realm_version = ${identity.realm.version}
      and i.canonicalization_version = ${identity.realm.canonicalizationVersion}
      and i.object_kind_id = ${identity.objectKindId}
      and ${scopePredicate}
      and i.canonical_external_subject = ${identity.canonicalExternalSubject}
      and ${stabilityPredicate}
      and i.exact_key_digest_sha256 = ${exactKeyDigest}
    order by i.id
    for update
  `;
}

async function loadIdentityById(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    id: InboxV2SourceExternalIdentityId;
    lock: boolean;
  }
): Promise<InboxV2SourceExternalIdentity | null> {
  if (input.lock) {
    const identityLock = await executor.execute<IdentityIdRow>(
      buildLockInboxV2SourceExternalIdentitySql(input)
    );

    if (identityLock.rows.length === 0) {
      return null;
    }
    if (identityLock.rows.length !== 1) {
      throw invariantError(
        "Tenant-scoped SourceExternalIdentity lock returned more than one row."
      );
    }

    const headLock = await executor.execute<IdentityIdRow>(
      buildLockInboxV2SourceExternalIdentityHeadSql(input)
    );

    if (headLock.rows.length !== 1) {
      throw invariantError(
        "SourceExternalIdentity exists without exactly one mandatory head."
      );
    }
  }

  const result = await executor.execute<InboxV2SourceExternalIdentityRow>(
    buildFindInboxV2SourceExternalIdentityByIdSql(input)
  );

  if (result.rows.length === 0) {
    return null;
  }
  if (result.rows.length !== 1) {
    throw invariantError(
      "Tenant-scoped SourceExternalIdentity lookup returned more than one aggregate."
    );
  }

  return mapIdentityRow(result.rows[0], input.tenantId);
}

async function findIdentityIdByScopedKey(
  executor: RawSqlExecutor,
  identity: InboxV2SourceExternalIdentity
): Promise<InboxV2SourceExternalIdentityId | null> {
  const result = await executor.execute<IdentityIdRow>(
    buildFindInboxV2SourceExternalIdentityIdByScopedKeySql(identity)
  );

  if (result.rows.length === 0) {
    return null;
  }
  if (result.rows.length !== 1) {
    throw invariantError(
      "SourceExternalIdentity scoped key resolved to more than one row."
    );
  }

  const parsed = inboxV2SourceExternalIdentityIdSchema.safeParse(
    result.rows[0]?.identity_id
  );

  if (!parsed.success) {
    throw invariantError(
      "SourceExternalIdentity scoped-key lookup returned an invalid ID."
    );
  }

  return parsed.data;
}

function normalizeFindOrCreateInput(
  input: FindOrCreateInboxV2SourceExternalIdentityInput
): InboxV2SourceExternalIdentity {
  assertStrictInput(input);

  return inboxV2SourceExternalIdentitySchema.parse({
    tenantId: input.tenantId,
    id: input.id,
    realm: input.realm,
    objectKindId: input.objectKindId,
    scope: input.scope,
    identityDeclaration: input.identityDeclaration,
    materializationAuthority: input.materializationAuthority,
    materializedAt: input.materializedAt,
    canonicalExternalSubject: input.canonicalExternalSubject,
    stability: input.stability,
    resolution: { status: "unresolved" },
    latestClaimVersion: null,
    revision: "1",
    createdAt: input.createdAt,
    updatedAt: input.createdAt
  });
}

function mapIdentityRow(
  row: InboxV2SourceExternalIdentityRow,
  expectedTenantId: InboxV2TenantId
): InboxV2SourceExternalIdentity {
  const tenantResult = inboxV2TenantIdSchema.safeParse(row.identity_tenant_id);

  if (!tenantResult.success) {
    throw invariantError(
      "SourceExternalIdentity row contains an invalid tenant ID."
    );
  }
  if (tenantResult.data !== expectedTenantId) {
    throw new CoreError("tenant.boundary_violation");
  }
  if (row.head_source_external_identity_id === null) {
    throw invariantError(
      "SourceExternalIdentity row is missing its mandatory head."
    );
  }

  const scope = mapScope(row, tenantResult.data);
  const stability = mapStability(row, tenantResult.data);
  const materializedAt = parseDatabaseTimestamp(
    row.materialized_at,
    "SourceExternalIdentity materializedAt"
  );
  const identityDeclaration = mapIdentityDeclaration(row);
  const revisionResult = inboxV2EntityRevisionSchema.safeParse(
    parseDatabaseBigint(
      row.identity_revision,
      "SourceExternalIdentity revision"
    )
  );
  if (!revisionResult.success) {
    throw invariantError(
      "SourceExternalIdentity revision is not a valid entity revision."
    );
  }
  const revision = revisionResult.data;
  const claimHead = mapClaimHead(row, tenantResult.data, revision);

  try {
    return inboxV2SourceExternalIdentitySchema.parse({
      tenantId: tenantResult.data,
      id: row.identity_id,
      realm: {
        realmId: row.realm_id,
        version: row.realm_version,
        canonicalizationVersion: row.canonicalization_version
      },
      objectKindId: row.object_kind_id,
      scope,
      identityDeclaration,
      materializationAuthority: {
        kind: "trusted_service",
        tenantId: tenantResult.data,
        trustedServiceId: row.materialized_by_trusted_service_id,
        authorizationToken: row.materialization_authorization_token,
        authorizedAt: materializedAt
      },
      materializedAt,
      canonicalExternalSubject: row.canonical_external_subject,
      stability,
      resolution: claimHead.resolution,
      latestClaimVersion: claimHead.latestClaimVersion,
      revision,
      createdAt: parseDatabaseTimestamp(
        row.identity_created_at,
        "SourceExternalIdentity createdAt"
      ),
      updatedAt: parseDatabaseTimestamp(
        row.identity_updated_at,
        "SourceExternalIdentity updatedAt"
      )
    });
  } catch (error) {
    if (error instanceof InboxV2PersistenceInvariantError) {
      throw error;
    }

    throw invariantError(
      "SourceExternalIdentity persistence row does not satisfy the canonical contract."
    );
  }
}

function mapIdentityDeclaration(
  row: InboxV2SourceExternalIdentityRow
): InboxV2SourceExternalIdentity["identityDeclaration"] {
  const parsed = inboxV2AdapterIdentityDeclarationSchema.safeParse(
    row.identity_declaration
  );
  if (!parsed.success) {
    throw invariantError(
      "SourceExternalIdentity row contains an invalid adapter declaration."
    );
  }

  const declaration = parsed.data;
  const adapter = declaration.adapterContract;
  const mirrorRevision = parseDatabaseBigint(
    row.declaration_revision,
    "SourceExternalIdentity declarationRevision"
  );
  const mirrorLoadedAt = parseDatabaseTimestamp(
    row.declaration_loaded_at,
    "SourceExternalIdentity declarationLoadedAt"
  );

  if (
    String(adapter.contractId) !== String(row.declaration_contract_id) ||
    adapter.contractVersion !== row.declaration_contract_version ||
    String(adapter.declarationRevision) !== mirrorRevision ||
    String(adapter.surfaceId) !== String(row.declaration_surface_id) ||
    String(adapter.loadedByTrustedServiceId) !==
      String(row.declaration_loaded_by_trusted_service_id) ||
    Date.parse(adapter.loadedAt) !== Date.parse(mirrorLoadedAt)
  ) {
    throw invariantError(
      "SourceExternalIdentity adapter declaration diverges from its immutable scalar mirror."
    );
  }

  return declaration;
}

function mapClaimHead(
  row: InboxV2SourceExternalIdentityRow,
  tenantId: InboxV2TenantId,
  identityRevision: string
): Pick<InboxV2SourceExternalIdentity, "resolution" | "latestClaimVersion"> {
  const latestClaimVersion = parseNullableClaimVersion(
    row.latest_claim_version
  );

  if (
    latestClaimVersion !== null &&
    BigInt(identityRevision) !== BigInt(latestClaimVersion) + 1n
  ) {
    throw invariantError(
      "SourceExternalIdentity revision must be exactly one greater than its latest claim version."
    );
  }

  if (row.resolution_status === "claimed") {
    const activeClaimId = inboxV2SourceIdentityClaimIdSchema.safeParse(
      row.active_claim_id
    );

    if (!activeClaimId.success || latestClaimVersion === null) {
      throw invariantError(
        "Claimed SourceExternalIdentity head requires an exact active claim and claim version."
      );
    }

    return {
      resolution: {
        status: "claimed",
        activeClaim: {
          tenantId,
          kind: "source_identity_claim",
          id: activeClaimId.data
        }
      },
      latestClaimVersion
    };
  }

  if (row.active_claim_id !== null) {
    throw invariantError(
      "Unresolved or conflicted SourceExternalIdentity head cannot retain an active claim."
    );
  }

  if (row.resolution_status === "unresolved") {
    if (latestClaimVersion === null && identityRevision !== "1") {
      throw invariantError(
        "Only the initial SourceExternalIdentity revision may have an empty unresolved claim head."
      );
    }

    return {
      resolution: { status: "unresolved" },
      latestClaimVersion
    };
  }

  if (row.resolution_status === "conflicted") {
    if (latestClaimVersion === null) {
      throw invariantError(
        "Conflicted SourceExternalIdentity head requires a claim version."
      );
    }

    return {
      resolution: { status: "conflicted" },
      latestClaimVersion
    };
  }

  throw invariantError(
    "SourceExternalIdentity head has an invalid resolution status."
  );
}

function parseNullableClaimVersion(
  value: unknown
): InboxV2SourceExternalIdentity["latestClaimVersion"] {
  if (value === null) {
    return null;
  }

  const parsed = inboxV2SourceIdentityClaimVersionSchema.safeParse(
    parseDatabaseBigint(value, "SourceExternalIdentity latestClaimVersion")
  );

  if (!parsed.success) {
    throw invariantError(
      "SourceExternalIdentity latestClaimVersion is not a valid claim version."
    );
  }

  return parsed.data;
}

function mapScope(
  row: InboxV2SourceExternalIdentityRow,
  tenantId: InboxV2TenantId
): InboxV2SourceExternalIdentity["scope"] {
  if (row.scope_kind === "provider") {
    if (row.source_connection_id !== null || row.source_account_id !== null) {
      throw invariantError(
        "Provider-scoped identity cannot retain an owner ID."
      );
    }

    return { kind: "provider" };
  }
  if (row.scope_kind === "source_connection") {
    if (row.source_connection_id === null || row.source_account_id !== null) {
      throw invariantError(
        "Connection-scoped identity requires exactly one SourceConnection owner."
      );
    }

    return {
      kind: "source_connection",
      owner: {
        tenantId,
        kind: "source_connection",
        id: row.source_connection_id as never
      }
    };
  }
  if (row.scope_kind === "source_account") {
    if (row.source_account_id === null || row.source_connection_id !== null) {
      throw invariantError(
        "Account-scoped identity requires exactly one SourceAccount owner."
      );
    }

    return {
      kind: "source_account",
      owner: {
        tenantId,
        kind: "source_account",
        id: row.source_account_id as never
      }
    };
  }

  throw invariantError("SourceExternalIdentity row has an invalid scope kind.");
}

function mapStability(
  row: InboxV2SourceExternalIdentityRow,
  tenantId: InboxV2TenantId
): InboxV2SourceExternalIdentity["stability"] {
  if (row.stability_kind === "stable") {
    if (
      row.observation_kind !== null ||
      row.raw_inbound_event_id !== null ||
      row.normalized_inbound_event_id !== null ||
      row.observation_key !== null
    ) {
      throw invariantError(
        "Stable SourceExternalIdentity cannot retain ephemeral observation fields."
      );
    }

    return { kind: "stable" };
  }
  if (row.stability_kind !== "observation_ephemeral") {
    throw invariantError(
      "SourceExternalIdentity row has an invalid stability kind."
    );
  }
  if (typeof row.observation_key !== "string") {
    throw invariantError(
      "Ephemeral SourceExternalIdentity requires an observation key."
    );
  }
  if (
    row.observation_kind === "raw_inbound_event" &&
    row.raw_inbound_event_id !== null &&
    row.normalized_inbound_event_id === null
  ) {
    return {
      kind: "observation_ephemeral",
      observation: {
        tenantId,
        kind: "raw_inbound_event",
        id: row.raw_inbound_event_id as never
      },
      observationKey: row.observation_key
    };
  }
  if (
    row.observation_kind === "normalized_inbound_event" &&
    row.normalized_inbound_event_id !== null &&
    row.raw_inbound_event_id === null
  ) {
    return {
      kind: "observation_ephemeral",
      observation: {
        tenantId,
        kind: "normalized_inbound_event",
        id: row.normalized_inbound_event_id as never
      },
      observationKey: row.observation_key
    };
  }

  throw invariantError(
    "Ephemeral SourceExternalIdentity requires exactly one typed observation."
  );
}

function toScopeColumns(scope: InboxV2SourceExternalIdentity["scope"]): {
  sourceConnectionId: string | null;
  sourceAccountId: string | null;
} {
  return {
    sourceConnectionId:
      scope.kind === "source_connection" ? scope.owner.id : null,
    sourceAccountId: scope.kind === "source_account" ? scope.owner.id : null
  };
}

function toStabilityColumns(
  stability: InboxV2SourceExternalIdentity["stability"]
): {
  rawInboundEventId: string | null;
  normalizedInboundEventId: string | null;
  observationKey: string | null;
} {
  if (stability.kind === "stable") {
    return {
      rawInboundEventId: null,
      normalizedInboundEventId: null,
      observationKey: null
    };
  }

  return {
    rawInboundEventId:
      stability.observation.kind === "raw_inbound_event"
        ? stability.observation.id
        : null,
    normalizedInboundEventId:
      stability.observation.kind === "normalized_inbound_event"
        ? stability.observation.id
        : null,
    observationKey: stability.observationKey
  };
}

function buildScopeKeyPredicate(
  scope: InboxV2SourceExternalIdentity["scope"]
): SQL {
  if (scope.kind === "provider") {
    return sql`i.scope_kind = 'provider'
      and i.scope_source_connection_id is null
      and i.scope_source_account_id is null`;
  }
  if (scope.kind === "source_connection") {
    return sql`i.scope_kind = 'source_connection'
      and i.scope_source_connection_id = ${scope.owner.id}
      and i.scope_source_account_id is null`;
  }

  return sql`i.scope_kind = 'source_account'
    and i.scope_source_connection_id is null
    and i.scope_source_account_id = ${scope.owner.id}`;
}

function buildStabilityKeyPredicate(
  stability: InboxV2SourceExternalIdentity["stability"]
): SQL {
  if (stability.kind === "stable") {
    return sql`i.stability_kind = 'stable'
      and i.ephemeral_raw_inbound_event_id is null
      and i.ephemeral_normalized_inbound_event_id is null
      and i.ephemeral_observation_key is null`;
  }
  if (stability.observation.kind === "raw_inbound_event") {
    return sql`i.stability_kind = 'observation_ephemeral'
      and i.ephemeral_raw_inbound_event_id = ${stability.observation.id}
      and i.ephemeral_normalized_inbound_event_id is null
      and i.ephemeral_observation_key = ${stability.observationKey}`;
  }

  return sql`i.stability_kind = 'observation_ephemeral'
    and i.ephemeral_raw_inbound_event_id is null
    and i.ephemeral_normalized_inbound_event_id = ${stability.observation.id}
    and i.ephemeral_observation_key = ${stability.observationKey}`;
}

function sourceExternalIdentityExactKeyDigest(
  identity: InboxV2SourceExternalIdentity
): string {
  const scope = toScopeColumns(identity.scope);
  const stability = toStabilityColumns(identity.stability);
  const fields = [
    identity.tenantId,
    String(identity.realm.realmId),
    identity.realm.version,
    identity.realm.canonicalizationVersion,
    String(identity.objectKindId),
    identity.scope.kind,
    scope.sourceConnectionId,
    scope.sourceAccountId,
    identity.canonicalExternalSubject,
    identity.stability.kind,
    stability.rawInboundEventId,
    stability.normalizedInboundEventId,
    stability.observationKey
  ];
  const serialized = fields
    .map((value) =>
      value === null
        ? "-"
        : `${new TextEncoder().encode(value).byteLength}:${value}`
    )
    .join("");

  return createHash("sha256").update(serialized, "utf8").digest("hex");
}

function hasSameIdentityShape(
  existing: InboxV2SourceExternalIdentity,
  requested: InboxV2SourceExternalIdentity
): boolean {
  return (
    existing.realm.realmId === requested.realm.realmId &&
    existing.realm.version === requested.realm.version &&
    existing.realm.canonicalizationVersion ===
      requested.realm.canonicalizationVersion &&
    String(existing.objectKindId) === String(requested.objectKindId) &&
    hasSameScope(existing.scope, requested.scope) &&
    existing.canonicalExternalSubject === requested.canonicalExternalSubject &&
    hasSameStability(existing.stability, requested.stability)
  );
}

function hasSameDeclarationProof(
  existing: InboxV2SourceExternalIdentity,
  requested: InboxV2SourceExternalIdentity
): boolean {
  return adapterDeclarationsEqual(
    existing.identityDeclaration,
    requested.identityDeclaration
  );
}

function adapterDeclarationsEqual(
  left: InboxV2SourceExternalIdentity["identityDeclaration"],
  right: InboxV2SourceExternalIdentity["identityDeclaration"]
): boolean {
  return (
    left.identityKind === right.identityKind &&
    String(left.realmId) === String(right.realmId) &&
    left.realmVersion === right.realmVersion &&
    left.canonicalizationVersion === right.canonicalizationVersion &&
    String(left.objectKindId) === String(right.objectKindId) &&
    left.scopeKind === right.scopeKind &&
    left.decisionStrength === right.decisionStrength &&
    String(left.adapterContract.contractId) ===
      String(right.adapterContract.contractId) &&
    left.adapterContract.contractVersion ===
      right.adapterContract.contractVersion &&
    String(left.adapterContract.declarationRevision) ===
      String(right.adapterContract.declarationRevision) &&
    String(left.adapterContract.surfaceId) ===
      String(right.adapterContract.surfaceId) &&
    String(left.adapterContract.loadedByTrustedServiceId) ===
      String(right.adapterContract.loadedByTrustedServiceId) &&
    left.adapterContract.loadedAt === right.adapterContract.loadedAt
  );
}

function hasSameScope(
  left: InboxV2SourceExternalIdentity["scope"],
  right: InboxV2SourceExternalIdentity["scope"]
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "provider" || right.kind === "provider") {
    return left.kind === right.kind;
  }

  return left.owner.id === right.owner.id;
}

function hasSameStability(
  left: InboxV2SourceExternalIdentity["stability"],
  right: InboxV2SourceExternalIdentity["stability"]
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "stable" || right.kind === "stable") {
    return left.kind === right.kind;
  }

  return (
    left.observation.kind === right.observation.kind &&
    left.observation.id === right.observation.id &&
    left.observationKey === right.observationKey
  );
}

function assertStrictInput(input: unknown): void {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new CoreError(
      "validation.failed",
      "SourceExternalIdentity input must be an object."
    );
  }

  const unexpectedKeys = Object.keys(input).filter(
    (key) => !FIND_OR_CREATE_INPUT_KEYS.has(key)
  );

  if (unexpectedKeys.length > 0) {
    throw new CoreError(
      "validation.failed",
      `SourceExternalIdentity input contains unsupported fields: ${unexpectedKeys.join(", ")}.`
    );
  }
}

function parseDatabaseBigint(value: unknown, field: string): string {
  if (typeof value === "number") {
    throw invariantError(
      `${field} was decoded as a JavaScript number and may have lost precision.`
    );
  }
  if (typeof value !== "string" && typeof value !== "bigint") {
    throw invariantError(`${field} is not a PostgreSQL bigint value.`);
  }

  return String(value);
}

function parseDatabaseTimestamp(value: unknown, field: string): string {
  const parsedTimestamp =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;

  if (parsedTimestamp === null || Number.isNaN(parsedTimestamp.getTime())) {
    throw invariantError(`${field} is not a PostgreSQL timestamp.`);
  }

  return parsedTimestamp.toISOString();
}

function invariantError(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}

export type { RawSqlExecutor, RawSqlQueryResult };
