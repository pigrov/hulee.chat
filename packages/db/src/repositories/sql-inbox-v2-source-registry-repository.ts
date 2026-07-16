import {
  INBOX_V2_CATALOG_REGISTRATION_SCHEMA_ID,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  INBOX_V2_SOURCE_ADAPTER_DECLARATION_SCHEMA_ID,
  INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_ID,
  INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_VERSION,
  assertInboxV2SourceRegistryLifecycleLocator,
  calculateInboxV2CanonicalSha256,
  canonicalizeInboxV2Json,
  inboxV2PayloadReferenceSchema,
  isInboxV2SourceAdapterDeclaration,
  isInboxV2SourceAdapterDeclarationLifecycleBinding,
  isInboxV2SourceRegistryLifecycleBinding,
  isInboxV2SourceRegistryTransition,
  type InboxV2SourceAdapterDeclaration,
  type InboxV2SourceRegistryArtifactReference,
  type InboxV2SourceRegistryLifecycleBinding,
  type InboxV2SourceRegistryLifecycleLocator,
  type InboxV2SourceRegistryRelatedAuthorityReference,
  type InboxV2SourceRegistrySecretReference,
  type InboxV2SourceRegistryTransition,
  type InboxV2PayloadReference,
  type SourceConnectionId,
  type TenantId
} from "@hulee/contracts";
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import {
  assertInboxV2AuthorizedCommandMutationContext,
  type InboxV2AuthorizedCommandMutationContext
} from "./sql-inbox-v2-authorization-repository";
import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import type { SourceConnectionRecord } from "./sql-source-integration-repository";
import type { TenantSecretCipher } from "./sql-tenant-secret-repository";

const SOURCE_REGISTRY_TRANSACTION_CONFIG = {
  isolationLevel: "read committed"
} as const;

export type InboxV2SourceRegistryTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult>;
};

export type InboxV2SourceRegistryCompatibilityConnection = Readonly<{
  id: string;
  tenantId: TenantId;
  sourceType: SourceConnectionRecord["sourceType"];
  sourceName: string;
  displayName: string;
  status: SourceConnectionRecord["status"];
  authType: SourceConnectionRecord["authType"];
  createdByEmployeeId: string | null;
  updatedAt: Date;
}>;

export type InboxV2SourceRegistryEphemeralArtifactWrite = Readonly<{
  artifact: InboxV2SourceRegistryArtifactReference;
  material: Uint8Array;
}>;

export type InboxV2SourceRegistryClassifiedPayloadWrite = Readonly<{
  tenantId: TenantId;
  authorityId: string;
  authorityRevision: string;
  transitionId: string;
  artifact: InboxV2SourceRegistryArtifactReference;
  material: Uint8Array;
  materialDigest: string;
  occurredAt: Date;
}>;

export type InboxV2SourceRegistryClassifiedPayloadWriter = Readonly<{
  /** Returns SQL only; the repository executes every statement itself. */
  buildWriteSql(
    input: InboxV2SourceRegistryClassifiedPayloadWrite
  ): SQL | readonly SQL[];
}>;

export type SqlInboxV2SourceRegistryRepositoryOptions = Readonly<{
  classifiedPayloadWriter?: InboxV2SourceRegistryClassifiedPayloadWriter;
}>;

export type InboxV2SourceRegistryEphemeralSecretWrite = Readonly<{
  binding: InboxV2SourceRegistrySecretReference;
  material: Uint8Array;
  materialDigest: string;
}>;

export type InboxV2SourceRegistryEphemeralRouteWrite = Readonly<{
  route: Extract<
    InboxV2SourceRegistryRelatedAuthorityReference,
    { kind: "source_ingress_route" }
  >;
  material: Uint8Array;
  materialDigest: string;
}>;

export type CommitInboxV2SourceConnectionOnboardingInput = Readonly<{
  declaration: InboxV2SourceAdapterDeclaration;
  lifecycleBinding: InboxV2SourceRegistryLifecycleBinding;
  transition: InboxV2SourceRegistryTransition;
  compatibilityConnection: InboxV2SourceRegistryCompatibilityConnection;
  artifactWrites: readonly InboxV2SourceRegistryEphemeralArtifactWrite[];
  secretWrites: readonly InboxV2SourceRegistryEphemeralSecretWrite[];
  routeWrites: readonly InboxV2SourceRegistryEphemeralRouteWrite[];
}>;

export type PersistInboxV2AuthorizedSourceConnectionOnboardingInput = Readonly<{
  onboarding: CommitInboxV2SourceConnectionOnboardingInput;
  resultSnapshot: Readonly<{
    resultReference: InboxV2PayloadReference;
    streamCommitId: string;
    lifecycle: InboxV2SourceRegistryLifecycleLocator;
    auditTargetRef: string;
    tenantFacetRef: string;
    grantSourceMappings: readonly Readonly<{
      internalReference: string;
      authorizationDecisionId: string;
    }>[];
  }>;
}>;

export type InboxV2SourceRegistryIngressResolution = Readonly<{
  tenantId: string;
  sourceConnectionId: string;
  parentAuthorityId: string;
  routeId: string;
  routeRevision: string;
  routeGeneration: string;
  adapterHandlerId: string;
}>;

export type InboxV2SourceRegistryRepository = Readonly<{
  commitSourceConnectionOnboarding(
    input: CommitInboxV2SourceConnectionOnboardingInput
  ): Promise<SourceConnectionRecord>;
  /**
   * DB-only callback for the generic authorized-command coordinator. The
   * supplied executor already belongs to the coordinator-owned transaction;
   * this method never opens, commits or retries a transaction itself.
   */
  persistSourceConnectionOnboarding(
    context: InboxV2AuthorizedCommandMutationContext,
    input: PersistInboxV2AuthorizedSourceConnectionOnboardingInput
  ): Promise<SourceConnectionRecord>;
  findCommittedSourceConnection(input: {
    tenantId: TenantId;
    sourceConnectionId: SourceConnectionId;
  }): Promise<SourceConnectionRecord | null>;
  loadSourceOnboardingResultSnapshot(
    context: InboxV2AuthorizedCommandMutationContext,
    input: {
      resultReference: InboxV2PayloadReference;
    }
  ): Promise<SourceConnectionRecord | null>;
  resolveSourceOnboardingInternalReference(input: {
    tenantId: TenantId;
    internalReference: string;
  }): Promise<Readonly<{
    entityTypeId:
      | "core:source-connection"
      | "core:tenant"
      | "core:authorization-decision";
    entityId: string;
  }> | null>;
  resolveIngressRoute(input: {
    material: Uint8Array;
  }): Promise<InboxV2SourceRegistryIngressResolution | null>;
}>;

type LifecycleAuthorityRow = {
  canonical_anchor_id: unknown;
  effective_policy_id: unknown;
  effective_policy_version: unknown;
  effective_rule_id: unknown;
  effective_rule_revision: unknown;
  policy_activation_id: unknown;
  policy_activation_revision: unknown;
  policy_activation_head_revision: unknown;
  legal_hold_set_revision: unknown;
  restriction_set_revision: unknown;
};

type LifecycleAuthority = Readonly<{
  locator: InboxV2SourceRegistryLifecycleLocator;
  registryCompositionHash: string;
  canonicalAnchorId: string;
  effectivePolicyId: string;
  effectivePolicyVersion: bigint;
  effectiveRuleId: string;
  effectiveRuleRevision: bigint;
  policyActivationId: string;
  policyActivationRevision: bigint;
  policyActivationHeadRevision: bigint;
  legalHoldSetRevision: bigint;
  restrictionSetRevision: bigint;
}>;

type SourceConnectionRow = {
  id: string;
  tenant_id: string;
  source_type: string;
  source_name: string;
  display_name: string;
  status: string;
  auth_type: string;
  capabilities: unknown;
  config: unknown;
  diagnostics: unknown;
  metadata: unknown;
  created_by_employee_id: string | null;
  created_at: unknown;
  updated_at: unknown;
};

type SourceOnboardingResultSnapshotRow = {
  tenant_id: unknown;
  id: unknown;
  command_record_id: unknown;
  mutation_id: unknown;
  source_connection_id: unknown;
  source_type: unknown;
  source_name: unknown;
  display_name: unknown;
  status: unknown;
  auth_type: unknown;
  created_by_employee_id: unknown;
  connection_created_at: unknown;
  connection_updated_at: unknown;
  result_digest_sha256: unknown;
};

type SourceOnboardingInternalReferenceRow = {
  source_connection_id: unknown;
  audit_target_ref: unknown;
  tenant_facet_ref: unknown;
  authorization_decision_id: unknown;
};

type IngressResolutionRow = {
  tenant_id: unknown;
  source_connection_id: unknown;
  parent_authority_id: unknown;
  route_id: unknown;
  route_revision: unknown;
  route_generation: unknown;
  adapter_handler_id: unknown;
};

type PreparedSecretWrite = Readonly<{
  binding: InboxV2SourceRegistrySecretReference;
  secretRef: string;
  encryptedValue: string;
}>;

type PreparedArtifactWrite = Readonly<{
  artifact: InboxV2SourceRegistryArtifactReference;
  material: Uint8Array;
  materialDigest: string;
}>;

type PreparedRouteWrite = Readonly<
  InboxV2SourceRegistryEphemeralRouteWrite & {
    digestSha256: string;
  }
>;

export function createSqlInboxV2SourceRegistryRepository(
  executor: InboxV2SourceRegistryTransactionExecutor | HuleeDatabase,
  cipher: TenantSecretCipher,
  options: SqlInboxV2SourceRegistryRepositoryOptions = {}
): InboxV2SourceRegistryRepository {
  const transactionExecutor =
    executor as unknown as InboxV2SourceRegistryTransactionExecutor;

  const persistNormalizedOnboarding = async (
    transaction: RawSqlExecutor,
    normalized: NormalizedOnboarding
  ): Promise<SourceConnectionRecord> => {
    const lifecycleAuthorities = new Map<string, LifecycleAuthority>();
    const lifecycleFor = async (
      locator: InboxV2SourceRegistryLifecycleLocator,
      requiresExport: boolean
    ): Promise<LifecycleAuthority> => {
      const key = `${lifecycleKey(locator)}\u0000${requiresExport}`;
      const cached = lifecycleAuthorities.get(key);
      if (cached) return cached;
      const resolved = await resolveLifecycleAuthority(transaction, {
        tenantId: normalized.tenantId,
        locator,
        requiresExport
      });
      lifecycleAuthorities.set(key, resolved);
      return resolved;
    };

    const authorityLifecycle = await lifecycleFor(
      normalized.state.lifecycle,
      true
    );
    const artifactLifecycles = await Promise.all(
      normalized.state.artifacts.map((artifact) =>
        lifecycleFor(artifact.lifecycle, artifact.kind !== "diagnostic")
      )
    );
    const secretLifecycles = await Promise.all(
      normalized.state.credentialBindings.map((binding) =>
        lifecycleFor(binding.lifecycle, false)
      )
    );
    const relatedLifecycles = await Promise.all(
      normalized.state.relatedAuthorities.map((authority) =>
        lifecycleFor(
          authority.lifecycle,
          authority.kind === "channel_connector" ||
            authority.kind === "source_ingress_route"
        )
      )
    );

    const connectionResult = await transaction.execute<SourceConnectionRow>(
      buildInsertCompatibilitySourceConnectionSql(
        normalized.compatibilityConnection
      )
    );
    const connectionRow = expectExactlyOneRow(
      connectionResult,
      "SourceConnection compatibility insert"
    );

    for (const secret of normalized.secrets) {
      await transaction.execute(
        buildInsertTenantSecretSql({
          tenantId: normalized.tenantId,
          secretRef: secret.secretRef,
          encryptedValue: secret.encryptedValue,
          encryptionKeyRef: cipher.keyRef,
          occurredAt: normalized.occurredAt
        })
      );
    }

    await transaction.execute(
      buildInsertSourceRegistryTransitionSql({
        normalized,
        lifecycle: authorityLifecycle
      })
    );

    for (const [index, artifactWrite] of normalized.artifacts.entries()) {
      const writerMaterial = Uint8Array.from(artifactWrite.material);
      try {
        const built = options.classifiedPayloadWriter!.buildWriteSql({
          tenantId: normalized.tenantId,
          authorityId: normalized.authorityId,
          authorityRevision: normalized.resultingRevision.toString(),
          transitionId: normalized.transition.payload.transitionId,
          artifact: artifactWrite.artifact,
          material: writerMaterial,
          materialDigest: artifactWrite.materialDigest,
          occurredAt: normalized.occurredAt
        });
        for (const statement of Array.isArray(built) ? built : [built]) {
          await transaction.execute(statement);
        }
      } finally {
        writerMaterial.fill(0);
      }
      await transaction.execute(
        buildInsertSourceRegistryArtifactSql({
          tenantId: normalized.tenantId,
          authorityId: normalized.authorityId,
          authorityRevision: normalized.resultingRevision,
          transitionId: normalized.transition.payload.transitionId,
          artifact: artifactWrite.artifact,
          lifecycle: artifactLifecycles[index]!,
          occurredAt: normalized.occurredAt
        })
      );
    }

    for (const [index, secret] of normalized.secrets.entries()) {
      await transaction.execute(
        buildInsertSourceRegistrySecretSql({
          tenantId: normalized.tenantId,
          authorityId: normalized.authorityId,
          authorityRevision: normalized.resultingRevision,
          transitionId: normalized.transition.payload.transitionId,
          secret,
          lifecycle: secretLifecycles[index]!,
          occurredAt: normalized.occurredAt
        })
      );
    }

    for (const [index, routeWrite] of normalized.routes.entries()) {
      await transaction.execute(
        buildInsertSourceRegistryRouteSql({
          tenantId: normalized.tenantId,
          parentAuthorityId: normalized.authorityId,
          parentAuthorityRevision: normalized.resultingRevision,
          parentTransitionId: normalized.transition.payload.transitionId,
          routeWrite,
          adapterHandlerId: normalized.adapterHandlerId,
          lifecycle:
            relatedLifecycles[
              normalized.state.relatedAuthorities.indexOf(routeWrite.route)
            ] ?? relatedLifecycles[index]!,
          occurredAt: normalized.occurredAt
        })
      );
    }

    for (const [
      index,
      authority
    ] of normalized.state.relatedAuthorities.entries()) {
      await transaction.execute(
        buildInsertSourceRegistryRelatedAuthoritySql({
          tenantId: normalized.tenantId,
          parentAuthorityId: normalized.authorityId,
          parentAuthorityRevision: normalized.resultingRevision,
          parentTransitionId: normalized.transition.payload.transitionId,
          authority,
          lifecycle: relatedLifecycles[index]!,
          occurredAt: normalized.occurredAt
        })
      );
    }

    await transaction.execute(
      buildInsertSourceRegistryHeadSql({
        normalized,
        lifecycle: authorityLifecycle
      })
    );

    return mapSourceConnectionRow(connectionRow);
  };

  return {
    async commitSourceConnectionOnboarding(input) {
      const normalized = normalizeOnboardingInput(
        input,
        cipher,
        options.classifiedPayloadWriter,
        "direct_commit"
      );
      try {
        return await transactionExecutor.transaction(
          (transaction) => persistNormalizedOnboarding(transaction, normalized),
          SOURCE_REGISTRY_TRANSACTION_CONFIG
        );
      } finally {
        zeroNormalizedTransientMaterials(normalized);
      }
    },

    async persistSourceConnectionOnboarding(context, input) {
      assertInboxV2AuthorizedCommandMutationContext(context);
      assertAuthorizedSourceOnboardingContext(context, input);
      const normalized = normalizeOnboardingInput(
        input.onboarding,
        cipher,
        options.classifiedPayloadWriter,
        "coordinated"
      );
      try {
        const resultLifecycleLocator =
          assertInboxV2SourceRegistryLifecycleLocator({
            binding: input.onboarding.lifecycleBinding,
            locator: input.resultSnapshot.lifecycle
          });
        if (
          resultLifecycleLocator.copySlot !==
            "source_onboarding_result_snapshot" ||
          resultLifecycleLocator.dataClassId !==
            "core:source_account_connector_metadata" ||
          resultLifecycleLocator.storageRootId !== "core:source-registry-sql" ||
          resultLifecycleLocator.purposeId !==
            "core:source_replay_and_diagnostics"
        ) {
          throw invariantError(
            "Source onboarding result snapshot requires its retained production lifecycle copy."
          );
        }
        const resultLifecycle = await resolveLifecycleAuthority(
          context.executor,
          {
            tenantId: context.tenantId,
            locator: resultLifecycleLocator,
            requiresExport: true
          }
        );
        const record = await persistNormalizedOnboarding(
          context.executor,
          normalized
        );
        await expectExactlyOneWrite(
          context.executor,
          buildInsertSourceOnboardingResultSnapshotSql({
            context,
            input,
            record,
            lifecycle: resultLifecycle
          }),
          "Source onboarding result snapshot"
        );
        return record;
      } finally {
        zeroNormalizedTransientMaterials(normalized);
      }
    },

    async findCommittedSourceConnection(input) {
      const result = await transactionExecutor.execute<SourceConnectionRow>(
        buildFindCommittedSourceConnectionSql(input)
      );
      const row = atMostOneRow(result, "Committed SourceConnection lookup");
      return row === null ? null : mapSourceConnectionRow(row);
    },

    async loadSourceOnboardingResultSnapshot(context, input) {
      assertInboxV2AuthorizedCommandMutationContext(context);
      if (
        context.profile !== "domain" ||
        context.commandTypeId !== "core:source-connection.create" ||
        context.revisionEffects.length !== 0
      ) {
        throw invariantError(
          "Source onboarding replay requires an authorized domain-command context."
        );
      }
      const reference = inboxV2PayloadReferenceSchema.parse(
        input.resultReference
      );
      if (
        reference.tenantId !== context.tenantId ||
        reference.schemaId !== INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_ID ||
        reference.schemaVersion !==
          INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_VERSION
      ) {
        return null;
      }
      const result =
        await context.executor.execute<SourceOnboardingResultSnapshotRow>(
          buildFindSourceOnboardingResultSnapshotSql({
            tenantId: context.tenantId as TenantId,
            commandRecordId: context.commandId,
            mutationId: context.mutationId,
            resultReference: reference
          })
        );
      const row = atMostOneRow(result, "Source onboarding result replay");
      if (row === null) return null;
      const record = mapSourceOnboardingResultSnapshotRow(row);
      if (
        calculateSourceOnboardingResultDigest(record) !== reference.digest ||
        readText(row.result_digest_sha256, "result_digest_sha256") !==
          reference.digest
      ) {
        throw invariantError(
          "Source onboarding result snapshot digest does not match its reference."
        );
      }
      return record;
    },

    async resolveSourceOnboardingInternalReference(input) {
      const result =
        await transactionExecutor.execute<SourceOnboardingInternalReferenceRow>(
          buildResolveSourceOnboardingInternalReferenceSql(input)
        );
      const row = atMostOneRow(result, "Source onboarding internal reference");
      if (row === null) return null;
      const sourceConnectionId = readText(
        row.source_connection_id,
        "source_connection_id"
      );
      if (row.audit_target_ref === input.internalReference) {
        return {
          entityTypeId: "core:source-connection",
          entityId: sourceConnectionId
        };
      }
      if (row.tenant_facet_ref === input.internalReference) {
        return { entityTypeId: "core:tenant", entityId: input.tenantId };
      }
      if (row.authorization_decision_id !== null) {
        return {
          entityTypeId: "core:authorization-decision",
          entityId: readText(
            row.authorization_decision_id,
            "authorization_decision_id"
          )
        };
      }
      throw invariantError("Resolved source onboarding reference is invalid.");
    },

    async resolveIngressRoute(input) {
      assertNonEmptyBytes(input.material, "Ingress route material");
      const digest = calculateBytesSha256Hex(input.material);
      const result = await transactionExecutor.execute<IngressResolutionRow>(
        buildResolveSourceRegistryIngressRouteSql(digest)
      );
      const row = atMostOneRow(result, "Ingress route resolution");
      return row === null ? null : mapIngressResolutionRow(row);
    }
  };
}

type NormalizedOnboarding = ReturnType<typeof normalizeOnboardingInput>;

type SourceOnboardingPersistenceMode = "direct_commit" | "coordinated";

function assertAuthorizedSourceOnboardingContext(
  context: InboxV2AuthorizedCommandMutationContext,
  input: PersistInboxV2AuthorizedSourceConnectionOnboardingInput
): void {
  const onboarding = input.onboarding;
  const reference = inboxV2PayloadReferenceSchema.safeParse(
    input.resultSnapshot.resultReference
  );
  const grantMappings = input.resultSnapshot.grantSourceMappings;
  const grantRefs = grantMappings.map((mapping) => mapping.internalReference);
  const grantDecisionIds = grantMappings.map(
    (mapping) => mapping.authorizationDecisionId
  );
  if (
    context.profile !== "domain" ||
    context.commandTypeId !== "core:source-connection.create" ||
    context.revisionEffects.length !== 0 ||
    context.tenantId !== onboarding.compatibilityConnection.tenantId ||
    context.tenantId !== onboarding.transition.payload.tenantId ||
    !reference.success ||
    reference.data.tenantId !== context.tenantId ||
    reference.data.schemaId !== INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_ID ||
    reference.data.schemaVersion !==
      INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_VERSION ||
    input.resultSnapshot.streamCommitId.trim().length === 0 ||
    !/^internal-ref:[a-f0-9]{64}$/u.test(input.resultSnapshot.auditTargetRef) ||
    !/^internal-ref:[a-f0-9]{64}$/u.test(input.resultSnapshot.tenantFacetRef) ||
    input.resultSnapshot.auditTargetRef ===
      input.resultSnapshot.tenantFacetRef ||
    grantMappings.length === 0 ||
    grantMappings.length > 64 ||
    new Set(grantRefs).size !== grantRefs.length ||
    new Set(grantDecisionIds).size !== grantDecisionIds.length ||
    grantMappings.some(
      (mapping) =>
        !/^internal-ref:[a-f0-9]{64}$/u.test(mapping.internalReference) ||
        mapping.internalReference === input.resultSnapshot.auditTargetRef ||
        mapping.internalReference === input.resultSnapshot.tenantFacetRef ||
        mapping.authorizationDecisionId.trim().length === 0
    )
  ) {
    throw invariantError(
      "Source onboarding persistence crossed its authorized command context."
    );
  }
}

function sourceOnboardingResultPayload(record: SourceConnectionRecord): object {
  return {
    connection: {
      id: record.id,
      tenantId: record.tenantId,
      sourceType: record.sourceType,
      sourceName: record.sourceName,
      displayName: record.displayName,
      status: record.status,
      authType: record.authType,
      capabilities: record.capabilities,
      config: record.config,
      diagnostics: record.diagnostics,
      metadata: record.metadata,
      createdByEmployeeId: record.createdByEmployeeId,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString()
    }
  };
}

function calculateSourceOnboardingResultDigest(
  record: SourceConnectionRecord
): string {
  return calculateInboxV2CanonicalSha256(sourceOnboardingResult(record));
}

function sourceOnboardingResult(record: SourceConnectionRecord): object {
  return {
    protocol: `${INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_ID}@${INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_VERSION}`,
    ...sourceOnboardingResultPayload(record)
  };
}

async function expectExactlyOneWrite(
  executor: RawSqlExecutor,
  statement: SQL,
  label: string
): Promise<void> {
  const result = await executor.execute<{ id: unknown }>(statement);
  expectExactlyOneRow(result, label);
}

function normalizeOnboardingInput(
  input: CommitInboxV2SourceConnectionOnboardingInput,
  cipher: TenantSecretCipher,
  classifiedPayloadWriter:
    | InboxV2SourceRegistryClassifiedPayloadWriter
    | undefined,
  persistenceMode: SourceOnboardingPersistenceMode
) {
  if (
    !isInboxV2SourceAdapterDeclaration(input.declaration) ||
    !isInboxV2SourceAdapterDeclarationLifecycleBinding({
      declaration: input.declaration,
      lifecycleBinding: input.lifecycleBinding
    }) ||
    !isInboxV2SourceRegistryLifecycleBinding(input.lifecycleBinding) ||
    !isInboxV2SourceRegistryTransition(input.transition)
  ) {
    throw invariantError(
      "Source onboarding requires authentic declaration, lifecycle, and transition authority."
    );
  }
  const declaration = input.declaration.payload;
  const transition = input.transition.payload;
  const stateEnvelope = transition.resultingState;
  if (
    transition.entityKind !== "source_connection" ||
    stateEnvelope.payload.entityKind !== "source_connection" ||
    transition.intent !== "create" ||
    transition.previousState !== null ||
    transition.cas.expectedRevision !== null ||
    transition.cas.expectedRouteGeneration !== null
  ) {
    throw invariantError(
      "Standalone SourceConnection onboarding must commit one authentic create transition."
    );
  }
  const state = stateEnvelope.payload;
  if (
    state.tenantId !== transition.tenantId ||
    state.sourceName !== declaration.sourceName ||
    state.sourceTypeId !== declaration.sourceTypeId ||
    !sameJson(state.adapterContract, declaration.adapterContract) ||
    !sameJson(transition.lifecycle, state.lifecycle) ||
    !sameJson(
      input.lifecycleBinding.payload.registry,
      declaration.lifecycleRegistry
    )
  ) {
    throw invariantError(
      "Source onboarding declaration, lifecycle, and resulting state differ."
    );
  }
  if (
    persistenceMode === "direct_commit" &&
    state.createdBy.kind === "employee"
  ) {
    throw invariantError(
      "Employee source onboarding requires the generic authorized-command coordinator."
    );
  }
  const compatibility = input.compatibilityConnection;
  const expectedCompatibilitySourceType = legacySourceTypeForDeclaration(
    declaration.sourceTypeId
  );
  const expectedCompatibilityAuthType =
    legacyAuthTypeForDeclaration(declaration);
  const creatorEmployeeId =
    state.createdBy.kind === "employee" ? state.createdBy.employee.id : null;
  if (
    compatibility.tenantId !== state.tenantId ||
    compatibility.id !== state.sourceConnection.id ||
    compatibility.sourceName !== state.sourceName ||
    compatibility.displayName !== state.displayName ||
    compatibility.sourceType !== expectedCompatibilitySourceType ||
    compatibility.status !== "onboarding" ||
    compatibility.authType !== expectedCompatibilityAuthType ||
    compatibility.createdByEmployeeId !== creatorEmployeeId ||
    compatibility.updatedAt.toISOString() !== transition.committedAt ||
    !sameJson(state.createdBy, transition.actor)
  ) {
    throw invariantError(
      "Compatibility SourceConnection or actor crosses the authentic create authority."
    );
  }

  const artifactWrites = indexExactArtifactWrites(
    input.declaration,
    state.artifacts,
    input.artifactWrites,
    classifiedPayloadWriter
  );
  const secretWrites = indexExactSecretWrites(
    state.credentialBindings,
    input.secretWrites,
    cipher,
    state.tenantId
  );
  const routeAuthorities = state.relatedAuthorities.filter(
    (
      authority
    ): authority is Extract<
      InboxV2SourceRegistryRelatedAuthorityReference,
      { kind: "source_ingress_route" }
    > => authority.kind === "source_ingress_route"
  );
  if (
    state.relatedAuthorities.some(
      (authority) => authority.kind !== "source_ingress_route"
    )
  ) {
    throw invariantError(
      "Standalone SourceConnection onboarding cannot synthesize connector/session authority."
    );
  }
  const routes = indexExactRouteWrites(routeAuthorities, input.routeWrites);
  const ingress = declaration.ingress;
  const adapterHandlerId =
    ingress.mode === "not_supported"
      ? declaration.onboarding.mode === "not_supported"
        ? null
        : declaration.onboarding.handlerId
      : ingress.handlerId;
  if (routes.length > 0 && ingress.mode === "not_supported") {
    throw invariantError(
      "Ingress route has no handler in the authentic adapter declaration."
    );
  }
  const transientMaterials = cloneTransientMaterials(artifactWrites, routes);

  return {
    transition: input.transition,
    state,
    tenantId: state.tenantId,
    authorityId: state.sourceConnection.id,
    resultingRevision: BigInt(state.revision),
    routeGeneration: BigInt(state.routeAuthority.generation),
    compatibilityConnection: compatibility,
    artifacts: transientMaterials.artifacts,
    secrets: secretWrites,
    routes: transientMaterials.routes,
    adapterHandlerId,
    occurredAt: new Date(transition.committedAt),
    transitionDigestSha256: calculateCanonicalJsonSha256Hex(input.transition)
  };
}

function legacySourceTypeForDeclaration(sourceTypeId: string): string {
  if (!sourceTypeId.startsWith("core:") || sourceTypeId.indexOf(":", 5) >= 0) {
    throw invariantError(
      "No reviewed legacy SourceConnection sourceType mapping exists for the adapter declaration."
    );
  }
  return sourceTypeId.slice("core:".length);
}

function legacyAuthTypeForDeclaration(
  declaration: InboxV2SourceAdapterDeclaration["payload"]
): string {
  if (
    declaration.credentialMode === "revocable_secret_binding" &&
    declaration.ingress.mode === "webhook"
  ) {
    return "webhook_secret";
  }
  if (declaration.credentialMode === "none") return "custom";
  throw invariantError(
    "No reviewed legacy SourceConnection authType mapping exists for the adapter declaration."
  );
}

function indexExactArtifactWrites(
  declaration: InboxV2SourceAdapterDeclaration,
  artifacts: readonly InboxV2SourceRegistryArtifactReference[],
  writes: readonly InboxV2SourceRegistryEphemeralArtifactWrite[],
  classifiedPayloadWriter:
    | InboxV2SourceRegistryClassifiedPayloadWriter
    | undefined
): readonly PreparedArtifactWrite[] {
  assertArtifactDeclarations(declaration, artifacts);
  if (artifacts.length !== writes.length) {
    throw invariantError(
      "Every classified artifact requires exactly one transient payload write."
    );
  }
  if (artifacts.length > 0 && classifiedPayloadWriter === undefined) {
    throw invariantError(
      "Classified artifact material requires a transactional payload writer that is not configured."
    );
  }
  return artifacts.map((artifact) => {
    const matches = writes.filter((write) =>
      sameJson(write.artifact, artifact)
    );
    if (matches.length !== 1) {
      throw invariantError(
        "Artifact write does not match one exact classified payload reference."
      );
    }
    const write = matches[0]!;
    assertNonEmptyBytes(write.material, "Classified artifact material");
    assertPrefixedDigestMatches(write.material, artifact.payload.digest);
    return {
      artifact,
      material: write.material,
      materialDigest: artifact.payload.digest
    };
  });
}

function assertArtifactDeclarations(
  declaration: InboxV2SourceAdapterDeclaration,
  artifacts: readonly InboxV2SourceRegistryArtifactReference[]
): void {
  for (const [kind, reference] of [
    ["configuration", declaration.payload.configurationSchema],
    ["capability", declaration.payload.capabilitySchema],
    ["metadata", declaration.payload.metadataSchema],
    ["diagnostic", declaration.payload.diagnosticSchema]
  ] as const) {
    const matching = artifacts.filter((artifact) => artifact.kind === kind);
    if ((reference === null) !== (matching.length === 0)) {
      throw invariantError(
        `Adapter ${kind} declaration and persisted artifact must be present together.`
      );
    }
    if (
      reference !== null &&
      matching.some(
        (artifact) =>
          artifact.payload.schemaId !== reference.schemaId ||
          !reference.supportedVersions.includes(artifact.payload.schemaVersion)
      )
    ) {
      throw invariantError(
        `Adapter ${kind} artifact uses an undeclared schema or version.`
      );
    }
  }
  for (const artifact of artifacts) {
    if (
      artifact.kind === "catalog_registration" &&
      (artifact.payload.schemaId !== INBOX_V2_CATALOG_REGISTRATION_SCHEMA_ID ||
        artifact.payload.schemaVersion !== INBOX_V2_INITIAL_SCHEMA_VERSION)
    ) {
      throw invariantError(
        "Catalog-registration artifact must pin the canonical catalog envelope."
      );
    }
    if (
      artifact.kind === "module_registration" &&
      (artifact.payload.schemaId !==
        INBOX_V2_SOURCE_ADAPTER_DECLARATION_SCHEMA_ID ||
        artifact.payload.schemaVersion !== INBOX_V2_INITIAL_SCHEMA_VERSION)
    ) {
      throw invariantError(
        "Module-registration artifact must pin the source-adapter declaration envelope."
      );
    }
  }
}

function indexExactSecretWrites(
  bindings: readonly InboxV2SourceRegistrySecretReference[],
  writes: readonly InboxV2SourceRegistryEphemeralSecretWrite[],
  cipher: TenantSecretCipher,
  tenantId: string
): readonly PreparedSecretWrite[] {
  if (bindings.length !== writes.length) {
    throw invariantError(
      "Every onboarding credential requires exactly one transient secret write."
    );
  }
  return bindings.map((binding) => {
    const matches = writes.filter((write) => sameJson(write.binding, binding));
    if (matches.length !== 1 || binding.status !== "active") {
      throw invariantError("Secret write does not match active authority ref.");
    }
    const write = matches[0]!;
    assertNonEmptyBytes(write.material, "Secret material");
    assertPrefixedDigestMatches(write.material, write.materialDigest);
    const bindingDigest = calculateUtf8Sha256Hex(binding.bindingId);
    const secretRef = `secret:${tenantId}/source-registry/${bindingDigest}`;
    const exactByteEncoding = `bytes:v1:${Buffer.from(write.material).toString("base64url")}`;
    return {
      binding,
      secretRef,
      encryptedValue: cipher.encrypt(exactByteEncoding)
    };
  });
}

function indexExactRouteWrites(
  routes: readonly Extract<
    InboxV2SourceRegistryRelatedAuthorityReference,
    { kind: "source_ingress_route" }
  >[],
  writes: readonly InboxV2SourceRegistryEphemeralRouteWrite[]
): readonly PreparedRouteWrite[] {
  if (routes.length !== writes.length) {
    throw invariantError(
      "Every ingress authority requires exactly one transient route material write."
    );
  }
  return routes.map((route) => {
    const matches = writes.filter((write) => sameJson(write.route, route));
    if (matches.length !== 1 || route.status !== "active") {
      throw invariantError("Route write does not match active authority ref.");
    }
    const write = matches[0]!;
    assertNonEmptyBytes(write.material, "Ingress route material");
    assertPrefixedDigestMatches(write.material, write.materialDigest);
    return {
      ...write,
      digestSha256: stripSha256Prefix(write.materialDigest)
    };
  });
}

function cloneTransientMaterials(
  artifacts: readonly PreparedArtifactWrite[],
  routes: readonly PreparedRouteWrite[]
): Readonly<{
  artifacts: readonly PreparedArtifactWrite[];
  routes: readonly PreparedRouteWrite[];
}> {
  const ownedMaterials: Uint8Array[] = [];
  try {
    const ownedArtifacts = artifacts.map((write) => {
      const material = Uint8Array.from(write.material);
      ownedMaterials.push(material);
      return { ...write, material };
    });
    const ownedRoutes = routes.map((write) => {
      const material = Uint8Array.from(write.material);
      ownedMaterials.push(material);
      return { ...write, material };
    });
    return { artifacts: ownedArtifacts, routes: ownedRoutes };
  } catch (error) {
    for (const material of ownedMaterials) material.fill(0);
    throw error;
  }
}

function zeroNormalizedTransientMaterials(
  normalized: NormalizedOnboarding
): void {
  for (const write of normalized.artifacts) write.material.fill(0);
  for (const write of normalized.routes) write.material.fill(0);
}

async function resolveLifecycleAuthority(
  executor: RawSqlExecutor,
  input: {
    tenantId: string;
    locator: InboxV2SourceRegistryLifecycleLocator;
    requiresExport: boolean;
  }
): Promise<LifecycleAuthority> {
  const result = await executor.execute<LifecycleAuthorityRow>(
    buildResolveSourceRegistryLifecycleAuthoritySql(input)
  );
  const row = expectExactlyOneRow(
    result,
    "Source-registry lifecycle authority"
  );
  return {
    locator: input.locator,
    registryCompositionHash: stripSha256Prefix(
      input.locator.registry.compositionHash
    ),
    canonicalAnchorId: readText(row.canonical_anchor_id, "canonical_anchor_id"),
    effectivePolicyId: readText(row.effective_policy_id, "effective_policy_id"),
    effectivePolicyVersion: readBigInt(
      row.effective_policy_version,
      "effective_policy_version"
    ),
    effectiveRuleId: readText(row.effective_rule_id, "effective_rule_id"),
    effectiveRuleRevision: readBigInt(
      row.effective_rule_revision,
      "effective_rule_revision"
    ),
    policyActivationId: readText(
      row.policy_activation_id,
      "policy_activation_id"
    ),
    policyActivationRevision: readBigInt(
      row.policy_activation_revision,
      "policy_activation_revision"
    ),
    policyActivationHeadRevision: readBigInt(
      row.policy_activation_head_revision,
      "policy_activation_head_revision"
    ),
    legalHoldSetRevision: readBigInt(
      row.legal_hold_set_revision,
      "legal_hold_set_revision"
    ),
    restrictionSetRevision: readBigInt(
      row.restriction_set_revision,
      "restriction_set_revision"
    )
  };
}

export function buildResolveSourceRegistryLifecycleAuthoritySql(input: {
  tenantId: string;
  locator: InboxV2SourceRegistryLifecycleLocator;
  requiresExport: boolean;
}): SQL {
  return sql`
    select lineage_row.canonical_anchor_id,
           policy_row.policy_id as effective_policy_id,
           policy_row.version as effective_policy_version,
           rule_row.rule_id as effective_rule_id,
           rule_row.rule_revision as effective_rule_revision,
           activation_head.current_activation_id as policy_activation_id,
           activation_head.current_activation_revision as policy_activation_revision,
           activation_head.head_revision as policy_activation_head_revision,
           control_head.legal_hold_set_revision,
           control_head.restriction_set_revision
      from inbox_v2_data_governance_registry_versions registry_row
      join inbox_v2_data_governance_data_use_lineages lineage_row
        on lineage_row.registry_id = registry_row.id
       and lineage_row.registry_revision = registry_row.revision
      join inbox_v2_data_governance_effective_policies policy_row
        on policy_row.tenant_id = ${input.tenantId}
       and policy_row.registry_id = registry_row.id
       and policy_row.registry_revision = registry_row.revision
      join inbox_v2_data_governance_effective_policy_rules rule_row
        on rule_row.tenant_id = policy_row.tenant_id
       and rule_row.policy_id = policy_row.policy_id
       and rule_row.policy_version = policy_row.version
       and rule_row.data_class_id = lineage_row.data_class_id
       and rule_row.purpose_id = lineage_row.purpose_id
       and rule_row.retention_anchor_id = lineage_row.canonical_anchor_id
      join inbox_v2_data_governance_policy_activation_heads activation_head
        on activation_head.tenant_id = policy_row.tenant_id
       and activation_head.policy_id = policy_row.policy_id
       and activation_head.current_policy_version = policy_row.version
      join inbox_v2_data_governance_control_set_heads control_head
        on control_head.tenant_id = policy_row.tenant_id
     where registry_row.id = ${input.locator.registry.id}
       and registry_row.revision = ${BigInt(input.locator.registry.revision)}
       and registry_row.composition_hash = ${input.locator.registry.compositionHash}
       and lineage_row.data_class_id = ${input.locator.dataClassId}
       and lineage_row.storage_root_id = ${input.locator.storageRootId}
       and lineage_row.purpose_id = ${input.locator.purposeId}
       and lineage_row.lineage_revision = ${BigInt(input.locator.lineageRevision)}
       and lineage_row.lifecycle_handler_id is not null
       and lineage_row.delete_handler_id is not null
       and lineage_row.verification_handler_id is not null
       and (
         not ${input.requiresExport}
         or (
           lineage_row.subject_discovery_handler_id is not null
           and lineage_row.export_projection_handler_id is not null
           and lineage_row.export_handler_id is not null
         )
       )
     for share of registry_row, lineage_row, policy_row, rule_row,
                  activation_head, control_head
  `;
}

function buildInsertCompatibilitySourceConnectionSql(
  input: InboxV2SourceRegistryCompatibilityConnection
): SQL {
  return sql`
    insert into source_connections (
      id, tenant_id, source_type, source_name, display_name, status, auth_type,
      capabilities, config, diagnostics, metadata, created_by_employee_id,
      created_at, updated_at
    ) values (
      ${input.id}, ${input.tenantId}, ${input.sourceType}, ${input.sourceName},
      ${input.displayName}, ${input.status}, ${input.authType},
      '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
      ${input.createdByEmployeeId}, ${input.updatedAt}, ${input.updatedAt}
    )
    returning id, tenant_id, source_type, source_name, display_name, status,
              auth_type, capabilities, config, diagnostics, metadata,
              created_by_employee_id, created_at, updated_at
  `;
}

function buildFindCommittedSourceConnectionSql(input: {
  tenantId: TenantId;
  sourceConnectionId: SourceConnectionId;
}): SQL {
  return sql`
    select sc.id, sc.tenant_id, sc.source_type, sc.source_name,
           sc.display_name, sc.status, sc.auth_type, sc.capabilities,
           sc.config, sc.diagnostics, sc.metadata,
           sc.created_by_employee_id, sc.created_at, sc.updated_at
      from source_connections sc
      join inbox_v2_source_registry_heads head
        on head.tenant_id = sc.tenant_id
       and head.authority_id = sc.id
       and head.authority_kind = 'source_connection'
     where sc.tenant_id = ${input.tenantId}
       and sc.id = ${input.sourceConnectionId}
     limit 2
  `;
}

function buildInsertSourceOnboardingResultSnapshotSql(input: {
  context: InboxV2AuthorizedCommandMutationContext;
  input: PersistInboxV2AuthorizedSourceConnectionOnboardingInput;
  record: SourceConnectionRecord;
  lifecycle: LifecycleAuthority;
}): SQL {
  const { context, record } = input;
  const onboarding = input.input.onboarding;
  const snapshot = input.input.resultSnapshot;
  const transition = onboarding.transition;
  const state = transition.payload.resultingState;
  const resultCanonicalJson = canonicalizeInboxV2Json(
    sourceOnboardingResult(record)
  );
  const stateCanonicalJson = canonicalizeInboxV2Json(state);
  const transitionCanonicalJson = canonicalizeInboxV2Json(transition);
  const resultDigest = calculateSourceOnboardingResultDigest(record);
  const stateDigest = calculateInboxV2CanonicalSha256(state);
  const transitionDigest = calculateInboxV2CanonicalSha256(transition);
  if (
    snapshot.resultReference.recordId.trim().length === 0 ||
    snapshot.resultReference.digest !== resultDigest ||
    record.tenantId !== context.tenantId ||
    record.id !== onboarding.compatibilityConnection.id ||
    record.status !== "onboarding" ||
    record.createdByEmployeeId === null ||
    record.createdAt.toISOString() !== transition.payload.committedAt ||
    record.updatedAt.toISOString() !== transition.payload.committedAt ||
    !isEmptyPlainObject(record.capabilities) ||
    !isEmptyPlainObject(record.config) ||
    !isEmptyPlainObject(record.diagnostics) ||
    !isEmptyPlainObject(record.metadata)
  ) {
    throw invariantError(
      "Source onboarding result is not a safe immutable command snapshot."
    );
  }

  return sql`
    insert into inbox_v2_source_onboarding_result_snapshots (
      tenant_id, id, command_record_id, client_mutation_id, mutation_id,
      stream_commit_id, source_connection_id, source_transition_id,
      source_registry_revision, source_type, source_name, display_name,
      status, auth_type, created_by_employee_id, connection_created_at,
      connection_updated_at, result_digest_sha256, result_canonical_json,
      state_payload, state_digest_sha256, state_canonical_json,
      transition_payload, transition_digest_sha256,
      transition_canonical_json, audit_target_ref, tenant_facet_ref,
      grant_source_mappings, ${lifecycleColumnNamesSql()}, created_at
    ) values (
      ${context.tenantId}, ${snapshot.resultReference.recordId},
      ${context.commandId}, ${context.clientMutationId}, ${context.mutationId},
      ${snapshot.streamCommitId}, ${record.id},
      ${transition.payload.transitionId},
      ${BigInt(transition.payload.cas.resultingRevision)}, ${record.sourceType},
      ${record.sourceName}, ${record.displayName}, ${record.status},
      ${record.authType}, ${record.createdByEmployeeId}, ${record.createdAt},
      ${record.updatedAt}, ${resultDigest}, ${resultCanonicalJson},
      ${JSON.stringify(state)}::jsonb, ${stateDigest}, ${stateCanonicalJson},
      ${JSON.stringify(transition)}::jsonb, ${transitionDigest},
      ${transitionCanonicalJson}, ${snapshot.auditTargetRef},
      ${snapshot.tenantFacetRef},
      ${JSON.stringify(snapshot.grantSourceMappings)}::jsonb,
      ${lifecycleValuesSql(input.lifecycle)},
      ${record.createdAt}
    )
    returning id
  `;
}

function buildFindSourceOnboardingResultSnapshotSql(input: {
  tenantId: TenantId;
  resultReference: InboxV2PayloadReference;
  commandRecordId: string;
  mutationId: string;
}): SQL {
  return sql`
    select result.tenant_id, result.id, result.command_record_id,
           result.mutation_id, result.source_connection_id,
           result.source_type, result.source_name, result.display_name,
           result.status, result.auth_type, result.created_by_employee_id,
           result.connection_created_at, result.connection_updated_at,
           result.result_digest_sha256
      from inbox_v2_source_onboarding_result_snapshots result
      join inbox_v2_auth_command_records command
        on command.tenant_id = result.tenant_id
       and command.id = result.command_record_id
       and command.mutation_id = result.mutation_id
      join inbox_v2_tenant_stream_commits stream_commit
        on stream_commit.tenant_id = result.tenant_id
       and stream_commit.id = result.stream_commit_id
       and stream_commit.mutation_id = result.mutation_id
      join inbox_v2_auth_mutation_commits mutation_commit
        on mutation_commit.tenant_id = result.tenant_id
       and mutation_commit.mutation_id = result.mutation_id
     where result.tenant_id = ${input.tenantId}
       and result.id = ${input.resultReference.recordId}
       and result.result_digest_sha256 = ${input.resultReference.digest}
       and result.command_record_id = ${input.commandRecordId}
       and result.mutation_id = ${input.mutationId}
       and command.state = 'completed'
       and command.command_type_id = 'core:source-connection.create'
       and command.public_result_code = 'core:source-connection.created'
       and command.result_reference =
         ${JSON.stringify(input.resultReference)}::jsonb
     limit 2
  `;
}

function buildResolveSourceOnboardingInternalReferenceSql(input: {
  tenantId: TenantId;
  internalReference: string;
}): SQL {
  return sql`
    select result.source_connection_id, result.audit_target_ref,
           result.tenant_facet_ref,
           grant_mapping->>'authorizationDecisionId' as authorization_decision_id
      from inbox_v2_source_onboarding_result_snapshots result
      left join lateral jsonb_array_elements(result.grant_source_mappings)
        grant_mapping on
          grant_mapping->>'internalReference' = ${input.internalReference}
     where result.tenant_id = ${input.tenantId}
       and (${input.internalReference} = result.audit_target_ref
         or ${input.internalReference} = result.tenant_facet_ref
         or grant_mapping is not null)
     limit 2
  `;
}

function buildInsertTenantSecretSql(input: {
  tenantId: string;
  secretRef: string;
  encryptedValue: string;
  encryptionKeyRef: string;
  occurredAt: Date;
}): SQL {
  return sql`
    insert into tenant_secrets (
      tenant_id, secret_ref, purpose, encrypted_value, encryption_key_ref,
      created_at, updated_at
    ) values (
      ${input.tenantId}, ${input.secretRef}, 'source_registry.credential',
      ${input.encryptedValue}, ${input.encryptionKeyRef},
      ${input.occurredAt}, ${input.occurredAt}
    )
  `;
}

function buildInsertSourceRegistryTransitionSql(input: {
  normalized: NormalizedOnboarding;
  lifecycle: LifecycleAuthority;
}): SQL {
  const { normalized, lifecycle } = input;
  const transition = normalized.transition.payload;
  const state = normalized.state;
  const creator = actorColumns(state.createdBy);
  const actor = actorColumns(transition.actor);
  const adapter = state.adapterContract;
  return sql`
    insert into inbox_v2_source_registry_transitions (
      tenant_id, transition_id, authority_id, authority_kind,
      source_connection_id, source_account_id, connector_id, session_id,
      auth_challenge_id, intent, expected_revision, expected_route_generation,
      resulting_revision, from_state, to_state, route_generation,
      route_authority_state, route_authority_reason_code_id,
      route_authority_changed_at, account_identity_transition_id,
      account_identity_revision, account_generation, account_identity_state,
      account_identity_fence_digest_sha256,
      account_canonical_key_digest_sha256, account_access_resource_head_id,
      account_resource_access_revision, account_structural_relation_revision,
      adapter_contract_id, adapter_contract_version,
      adapter_declaration_revision, adapter_surface_id,
      adapter_loaded_by_trusted_service_id, adapter_loaded_at,
      adapter_handler_id, authority_copy_slot, authority_registry_id,
      authority_registry_composition_hash, authority_registry_revision,
      authority_data_class_id, authority_storage_root_id, authority_purpose_id,
      authority_canonical_anchor_id, authority_lineage_revision,
      authority_effective_policy_id, authority_effective_policy_version,
      authority_effective_rule_id, authority_effective_rule_revision,
      authority_policy_activation_id, authority_policy_activation_revision,
      authority_policy_activation_head_revision,
      authority_legal_hold_set_revision, authority_restriction_set_revision,
      transition_digest_sha256, created_by_actor_kind,
      created_by_employee_id, created_by_trusted_service_id,
      created_by_authorization_epoch, authority_created_at,
      actor_kind, actor_employee_id, actor_trusted_service_id,
      actor_authorization_epoch, occurred_at
    ) values (
      ${normalized.tenantId}, ${transition.transitionId},
      ${normalized.authorityId}, 'source_connection',
      ${state.sourceConnection.id}, null, null, null, null,
      ${transition.intent}, 0, null, ${normalized.resultingRevision}, null,
      ${state.status}, ${normalized.routeGeneration},
      ${state.routeAuthority.state}, ${state.routeAuthority.reasonCodeId},
      ${new Date(state.routeAuthority.changedAt)},
      null, null, null, null, null, null, null, null, null,
      ${adapter.contractId}, ${adapter.contractVersion},
      ${BigInt(adapter.declarationRevision)}, ${adapter.surfaceId},
      ${adapter.loadedByTrustedServiceId}, ${new Date(adapter.loadedAt)},
      ${normalized.adapterHandlerId},
      ${lifecycle.locator.copySlot}, ${lifecycle.locator.registry.id},
      ${lifecycle.registryCompositionHash},
      ${BigInt(lifecycle.locator.registry.revision)},
      ${lifecycle.locator.dataClassId}, ${lifecycle.locator.storageRootId},
      ${lifecycle.locator.purposeId}, ${lifecycle.canonicalAnchorId},
      ${BigInt(lifecycle.locator.lineageRevision)},
      ${lifecycle.effectivePolicyId}, ${lifecycle.effectivePolicyVersion},
      ${lifecycle.effectiveRuleId}, ${lifecycle.effectiveRuleRevision},
      ${lifecycle.policyActivationId}, ${lifecycle.policyActivationRevision},
      ${lifecycle.policyActivationHeadRevision},
      ${lifecycle.legalHoldSetRevision}, ${lifecycle.restrictionSetRevision},
      ${normalized.transitionDigestSha256}, ${creator.kind},
      ${creator.employeeId}, ${creator.trustedServiceId},
      ${creator.authorizationEpoch}, ${new Date(state.createdAt)},
      ${actor.kind}, ${actor.employeeId}, ${actor.trustedServiceId},
      ${actor.authorizationEpoch}, ${normalized.occurredAt}
    )
  `;
}

function buildInsertSourceRegistryHeadSql(input: {
  normalized: NormalizedOnboarding;
  lifecycle: LifecycleAuthority;
}): SQL {
  const { normalized, lifecycle } = input;
  const state = normalized.state;
  const creator = actorColumns(state.createdBy);
  const adapter = state.adapterContract;
  return sql`
    insert into inbox_v2_source_registry_heads (
      tenant_id, authority_id, authority_kind, source_connection_id,
      source_account_id, connector_id, session_id, auth_challenge_id,
      revision, state, route_generation, route_authority_state,
      route_authority_reason_code_id, route_authority_changed_at,
      account_identity_transition_id, account_identity_revision,
      account_generation, account_identity_state,
      account_identity_fence_digest_sha256,
      account_canonical_key_digest_sha256, account_access_resource_head_id,
      account_resource_access_revision, account_structural_relation_revision,
      adapter_contract_id, adapter_contract_version,
      adapter_declaration_revision, adapter_surface_id,
      adapter_loaded_by_trusted_service_id, adapter_loaded_at,
      adapter_handler_id, authority_copy_slot, authority_registry_id,
      authority_registry_composition_hash, authority_registry_revision,
      authority_data_class_id, authority_storage_root_id, authority_purpose_id,
      authority_canonical_anchor_id, authority_lineage_revision,
      authority_effective_policy_id, authority_effective_policy_version,
      authority_effective_rule_id, authority_effective_rule_revision,
      authority_policy_activation_id, authority_policy_activation_revision,
      authority_policy_activation_head_revision,
      authority_legal_hold_set_revision, authority_restriction_set_revision,
      last_transition_id, created_by_actor_kind, created_by_employee_id,
      created_by_trusted_service_id, created_by_authorization_epoch,
      created_at, updated_at
    ) values (
      ${normalized.tenantId}, ${normalized.authorityId}, 'source_connection',
      ${state.sourceConnection.id}, null, null, null, null,
      ${normalized.resultingRevision}, ${state.status},
      ${normalized.routeGeneration}, ${state.routeAuthority.state},
      ${state.routeAuthority.reasonCodeId},
      ${new Date(state.routeAuthority.changedAt)},
      null, null, null, null, null, null, null, null, null,
      ${adapter.contractId}, ${adapter.contractVersion},
      ${BigInt(adapter.declarationRevision)}, ${adapter.surfaceId},
      ${adapter.loadedByTrustedServiceId}, ${new Date(adapter.loadedAt)},
      ${normalized.adapterHandlerId},
      ${lifecycle.locator.copySlot}, ${lifecycle.locator.registry.id},
      ${lifecycle.registryCompositionHash},
      ${BigInt(lifecycle.locator.registry.revision)},
      ${lifecycle.locator.dataClassId}, ${lifecycle.locator.storageRootId},
      ${lifecycle.locator.purposeId}, ${lifecycle.canonicalAnchorId},
      ${BigInt(lifecycle.locator.lineageRevision)},
      ${lifecycle.effectivePolicyId}, ${lifecycle.effectivePolicyVersion},
      ${lifecycle.effectiveRuleId}, ${lifecycle.effectiveRuleRevision},
      ${lifecycle.policyActivationId}, ${lifecycle.policyActivationRevision},
      ${lifecycle.policyActivationHeadRevision},
      ${lifecycle.legalHoldSetRevision}, ${lifecycle.restrictionSetRevision},
      ${normalized.transition.payload.transitionId}, ${creator.kind},
      ${creator.employeeId}, ${creator.trustedServiceId},
      ${creator.authorizationEpoch}, ${new Date(state.createdAt)},
      ${normalized.occurredAt}
    )
  `;
}

function buildInsertSourceRegistryArtifactSql(input: {
  tenantId: string;
  authorityId: string;
  authorityRevision: bigint;
  transitionId: string;
  artifact: InboxV2SourceRegistryArtifactReference;
  lifecycle: LifecycleAuthority;
  occurredAt: Date;
}): SQL {
  const { artifact, lifecycle } = input;
  return sql`
    insert into inbox_v2_source_registry_artifact_refs (
      tenant_id, authority_id, authority_revision, transition_id,
      artifact_kind, payload_record_id, payload_schema_id,
      payload_schema_version, payload_digest_sha256,
      ${lifecycleColumnNamesSql()}, created_at
    ) values (
      ${input.tenantId}, ${input.authorityId}, ${input.authorityRevision},
      ${input.transitionId}, ${artifact.kind}, ${artifact.payload.recordId},
      ${artifact.payload.schemaId}, ${artifact.payload.schemaVersion},
      ${stripSha256Prefix(artifact.payload.digest)},
      ${lifecycleValuesSql(lifecycle)}, ${input.occurredAt}
    )
  `;
}

function buildInsertSourceRegistrySecretSql(input: {
  tenantId: string;
  authorityId: string;
  authorityRevision: bigint;
  transitionId: string;
  secret: PreparedSecretWrite;
  lifecycle: LifecycleAuthority;
  occurredAt: Date;
}): SQL {
  return sql`
    insert into inbox_v2_source_registry_secret_refs (
      tenant_id, authority_id, authority_revision, transition_id,
      binding_id, binding_revision, secret_ref,
      ${lifecycleColumnNamesSql()}, created_at, revoked_at,
      revoked_by_transition_id
    ) values (
      ${input.tenantId}, ${input.authorityId}, ${input.authorityRevision},
      ${input.transitionId}, ${input.secret.binding.bindingId},
      ${BigInt(input.secret.binding.revision)}, ${input.secret.secretRef},
      ${lifecycleValuesSql(input.lifecycle)}, ${input.occurredAt}, null, null
    )
  `;
}

function buildInsertSourceRegistryRouteSql(input: {
  tenantId: string;
  parentAuthorityId: string;
  parentAuthorityRevision: bigint;
  parentTransitionId: string;
  routeWrite: InboxV2SourceRegistryEphemeralRouteWrite & {
    digestSha256: string;
  };
  adapterHandlerId: string | null;
  lifecycle: LifecycleAuthority;
  occurredAt: Date;
}): SQL {
  if (input.adapterHandlerId === null) {
    throw invariantError("Ingress route requires a registered handler.");
  }
  return sql`
    insert into inbox_v2_source_registry_ingress_routes (
      tenant_id, route_id, route_revision, route_digest_sha256,
      parent_authority_id, parent_authority_revision, parent_transition_id,
      route_generation, adapter_handler_id,
      ${lifecycleColumnNamesSql()}, created_at, invalidated_at,
      invalidated_by_transition_id, invalidation_reason_code
    ) values (
      ${input.tenantId}, ${input.routeWrite.route.authorityId},
      ${BigInt(input.routeWrite.route.revision)},
      ${input.routeWrite.digestSha256}, ${input.parentAuthorityId},
      ${input.parentAuthorityRevision}, ${input.parentTransitionId},
      ${BigInt(input.routeWrite.route.handlerGeneration)},
      ${input.adapterHandlerId}, ${lifecycleValuesSql(input.lifecycle)},
      ${input.occurredAt}, null, null, null
    )
  `;
}

function buildInsertSourceRegistryRelatedAuthoritySql(input: {
  tenantId: string;
  parentAuthorityId: string;
  parentAuthorityRevision: bigint;
  parentTransitionId: string;
  authority: InboxV2SourceRegistryRelatedAuthorityReference;
  lifecycle: LifecycleAuthority;
  occurredAt: Date;
}): SQL {
  const authority = input.authority;
  const connectorAuthorityId =
    authority.kind === "channel_session" ||
    authority.kind === "channel_session_event" ||
    authority.kind === "channel_auth_challenge"
      ? authority.connectorAuthorityId
      : null;
  const sessionAuthorityId =
    authority.kind === "channel_session_event" ||
    authority.kind === "channel_auth_challenge"
      ? authority.sessionAuthorityId
      : null;
  const routeParentAuthorityId =
    authority.kind === "source_ingress_route"
      ? authority.parentAuthorityId
      : null;
  const handlerGeneration =
    authority.kind === "source_ingress_route"
      ? BigInt(authority.handlerGeneration)
      : null;
  return sql`
    insert into inbox_v2_source_registry_related_authority_refs (
      tenant_id, parent_authority_id, parent_authority_revision,
      parent_transition_id, kind, authority_id, authority_revision, status,
      child_transition_id, source_connection_id, source_account_id,
      connector_authority_id, session_authority_id, route_parent_authority_id,
      handler_generation, ${lifecycleColumnNamesSql()}, created_at
    ) values (
      ${input.tenantId}, ${input.parentAuthorityId},
      ${input.parentAuthorityRevision}, ${input.parentTransitionId},
      ${authority.kind}, ${authority.authorityId},
      ${BigInt(authority.revision)}, ${authority.status}, null,
      ${authority.sourceConnection.id}, ${authority.sourceAccount?.id ?? null},
      ${connectorAuthorityId}, ${sessionAuthorityId},
      ${routeParentAuthorityId}, ${handlerGeneration},
      ${lifecycleValuesSql(input.lifecycle)}, ${input.occurredAt}
    )
  `;
}

function lifecycleColumnNamesSql(): SQL {
  return sql.raw(
    "copy_slot, registry_id, registry_composition_hash, registry_revision, " +
      "data_class_id, storage_root_id, purpose_id, canonical_anchor_id, " +
      "lineage_revision, effective_policy_id, effective_policy_version, " +
      "effective_rule_id, effective_rule_revision, policy_activation_id, " +
      "policy_activation_revision, policy_activation_head_revision, " +
      "legal_hold_set_revision, restriction_set_revision"
  );
}

function lifecycleValuesSql(lifecycle: LifecycleAuthority): SQL {
  return sql.join(
    [
      lifecycle.locator.copySlot,
      lifecycle.locator.registry.id,
      lifecycle.registryCompositionHash,
      BigInt(lifecycle.locator.registry.revision),
      lifecycle.locator.dataClassId,
      lifecycle.locator.storageRootId,
      lifecycle.locator.purposeId,
      lifecycle.canonicalAnchorId,
      BigInt(lifecycle.locator.lineageRevision),
      lifecycle.effectivePolicyId,
      lifecycle.effectivePolicyVersion,
      lifecycle.effectiveRuleId,
      lifecycle.effectiveRuleRevision,
      lifecycle.policyActivationId,
      lifecycle.policyActivationRevision,
      lifecycle.policyActivationHeadRevision,
      lifecycle.legalHoldSetRevision,
      lifecycle.restrictionSetRevision
    ].map((value) => sql`${value}`),
    sql`, `
  );
}

export function buildResolveSourceRegistryIngressRouteSql(
  digestSha256: string
): SQL {
  return sql`
    select route_row.tenant_id,
           head_row.source_connection_id,
           route_row.parent_authority_id,
           route_row.route_id,
           route_row.route_revision,
           route_row.route_generation,
           route_row.adapter_handler_id
      from inbox_v2_source_registry_ingress_routes route_row
      join inbox_v2_source_registry_heads head_row
        on head_row.tenant_id = route_row.tenant_id
       and head_row.authority_id = route_row.parent_authority_id
       and head_row.route_generation = route_row.route_generation
       and head_row.adapter_handler_id = route_row.adapter_handler_id
     where route_row.route_digest_sha256 = ${digestSha256}
       and route_row.invalidated_at is null
       and head_row.state in ('active', 'degraded')
       and head_row.route_authority_state in ('enabled', 'inbound_only')
     limit 2
  `;
}

function actorColumns(
  actor:
    | NormalizedOnboarding["state"]["createdBy"]
    | NormalizedOnboarding["transition"]["payload"]["actor"]
) {
  return actor.kind === "employee"
    ? {
        kind: actor.kind,
        employeeId: actor.employee.id,
        trustedServiceId: null,
        authorizationEpoch: actor.authorizationEpoch
      }
    : {
        kind: actor.kind,
        employeeId: null,
        trustedServiceId: actor.trustedServiceId,
        authorizationEpoch: null
      };
}

function lifecycleKey(locator: InboxV2SourceRegistryLifecycleLocator): string {
  return [
    locator.registry.id,
    locator.registry.revision,
    locator.registry.compositionHash,
    locator.copySlot,
    locator.dataClassId,
    locator.storageRootId,
    locator.purposeId,
    locator.lineageRevision
  ].join("\u0000");
}

function calculateCanonicalJsonSha256Hex(value: unknown): string {
  return calculateUtf8Sha256Hex(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function calculateUtf8Sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function calculateBytesSha256Hex(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertPrefixedDigestMatches(
  material: Uint8Array,
  expected: string
): void {
  const actual = calculateBytesSha256Hex(material);
  if (stripSha256Prefix(expected) !== actual) {
    throw invariantError("Transient material digest does not match bytes.");
  }
}

function stripSha256Prefix(value: string): string {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw invariantError("Expected a canonical sha256 digest.");
  }
  return value.slice("sha256:".length);
}

function assertNonEmptyBytes(value: Uint8Array, label: string): void {
  if (!(value instanceof Uint8Array) || value.byteLength === 0) {
    throw invariantError(`${label} must be non-empty exact bytes.`);
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function expectExactlyOneRow<Row>(
  result: RawSqlQueryResult<Row>,
  label: string
): Row {
  if (result.rows.length !== 1) {
    throw invariantError(`${label} did not return exactly one row.`);
  }
  return result.rows[0]!;
}

function atMostOneRow<Row>(
  result: RawSqlQueryResult<Row>,
  label: string
): Row | null {
  if (result.rows.length > 1) {
    throw invariantError(`${label} returned more than one row.`);
  }
  return result.rows[0] ?? null;
}

function readText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw invariantError(`Invalid ${field}.`);
  }
  return value;
}

function readBigInt(value: unknown, field: string): bigint {
  try {
    const parsed = BigInt(value as string | number | bigint);
    if (parsed < 0n) throw new Error("negative");
    return parsed;
  } catch {
    throw invariantError(`Invalid ${field}.`);
  }
}

function mapSourceConnectionRow(
  row: SourceConnectionRow
): SourceConnectionRecord {
  return {
    id: row.id as SourceConnectionRecord["id"],
    tenantId: row.tenant_id as SourceConnectionRecord["tenantId"],
    sourceType: row.source_type,
    sourceName: row.source_name,
    displayName: row.display_name,
    status: row.status,
    authType: row.auth_type,
    capabilities: row.capabilities,
    config: row.config,
    diagnostics: row.diagnostics,
    metadata: row.metadata,
    createdByEmployeeId:
      row.created_by_employee_id as SourceConnectionRecord["createdByEmployeeId"],
    createdAt: normalizeDate(row.created_at),
    updatedAt: normalizeDate(row.updated_at)
  };
}

function mapSourceOnboardingResultSnapshotRow(
  row: SourceOnboardingResultSnapshotRow
): SourceConnectionRecord {
  return {
    id: readText(
      row.source_connection_id,
      "source_connection_id"
    ) as SourceConnectionRecord["id"],
    tenantId: readText(
      row.tenant_id,
      "tenant_id"
    ) as SourceConnectionRecord["tenantId"],
    sourceType: readText(row.source_type, "source_type"),
    sourceName: readText(row.source_name, "source_name"),
    displayName: readText(row.display_name, "display_name"),
    status: readText(row.status, "status"),
    authType: readText(row.auth_type, "auth_type"),
    capabilities: {},
    config: {},
    diagnostics: {},
    metadata: {},
    createdByEmployeeId: readText(
      row.created_by_employee_id,
      "created_by_employee_id"
    ) as SourceConnectionRecord["createdByEmployeeId"],
    createdAt: normalizeDate(row.connection_created_at),
    updatedAt: normalizeDate(row.connection_updated_at)
  };
}

function mapIngressResolutionRow(
  row: IngressResolutionRow
): InboxV2SourceRegistryIngressResolution {
  return {
    tenantId: readText(row.tenant_id, "tenant_id"),
    sourceConnectionId: readText(
      row.source_connection_id,
      "source_connection_id"
    ),
    parentAuthorityId: readText(row.parent_authority_id, "parent_authority_id"),
    routeId: readText(row.route_id, "route_id"),
    routeRevision: readBigInt(row.route_revision, "route_revision").toString(),
    routeGeneration: readBigInt(
      row.route_generation,
      "route_generation"
    ).toString(),
    adapterHandlerId: readText(row.adapter_handler_id, "adapter_handler_id")
  };
}

function isEmptyPlainObject(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

function normalizeDate(value: unknown): Date {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw invariantError("Invalid PostgreSQL timestamp.");
  }
  return parsed;
}

function invariantError(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}
