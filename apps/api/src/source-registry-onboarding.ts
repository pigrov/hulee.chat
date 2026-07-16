import type {
  EmployeeId,
  InboxV2AuthorizationDecisionReference,
  InboxV2AuthorizationEpochSnapshot,
  InboxV2ClientMutationId,
  InboxV2Sha256Digest,
  InboxV2StreamEpoch,
  InboxV2SourceRegistryLifecycleLocator,
  InboxV2SourceRegistrySecretReference,
  SourceCatalogItem,
  SourceConnectionId,
  TenantId
} from "@hulee/contracts";
import {
  INBOX_V2_SOURCE_ONBOARDING_ONE_TIME_RESPONSE_SCHEMA_ID,
  INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_ID,
  INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_VERSION,
  INBOX_V2_SOURCE_ONBOARDING_WEBHOOK_TOKEN_FIELD_ID,
  calculateInboxV2CanonicalSha256,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2AuthorizationEpochSnapshotSchema,
  inboxV2CatalogIdSchema,
  inboxV2DomainEventSchema,
  inboxV2EntityRevisionSchema,
  inboxV2InternalEntityReferenceSchema,
  inboxV2OutboxIntentSchema,
  inboxV2PayloadReferenceSchema,
  inboxV2RequestIdSchema,
  inboxV2Sha256DigestSchema,
  inboxV2SourceThreadBindingTransitionActorSchema,
  inboxV2StreamEpochSchema,
  inboxV2TenantStreamChangeSchema,
  inboxV2TenantIdSchema,
  inboxV2TimestampSchema
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type {
  InboxV2AuthorizedCommandCoordinator,
  InboxV2AuthorizedCommandRecords,
  InboxV2AuthorizedCommandRevisionPlan,
  InboxV2SourceRegistryRepository,
  InboxV2PrivilegedAuthorizationMutationReplayStatus,
  SourceConnectionRecord
} from "@hulee/db";
import { computeInboxV2LeafHashDigest } from "@hulee/db";
import type {
  SourceAdapterOnboardingPrepareInput,
  SourceAdapterOnboardingPrepared,
  SourceAdapterRegistration
} from "@hulee/modules";
import { createHmac, randomBytes, randomUUID } from "node:crypto";

const SOURCE_ONBOARDING_COMMAND_TYPE_ID =
  "core:source-connection.create" as const;
const SOURCE_ONBOARDING_PERMISSION_ID = "core:tenant.manage" as const;
const SOURCE_ONBOARDING_PUBLIC_RESULT_CODE =
  "core:source-connection.created" as const;
const SOURCE_ONBOARDING_PROJECTION_HANDLER_ID =
  "core:source-connection-projection" as const;
const SOURCE_ONBOARDING_CREDENTIAL_FINGERPRINT_PURPOSE =
  "core:source-onboarding.webhook-token" as const;
const SOURCE_ONBOARDING_RESULT_LIFECYCLE_PURPOSE_ID =
  "core:source_replay_and_diagnostics" as const;
const SOURCE_ONBOARDING_CREDENTIAL_LIFECYCLE_PURPOSE_ID =
  "core:security_and_fraud_prevention" as const;

type SourceOnboardingContext = {
  requestId: string;
  tenantId: TenantId;
  employeeId: EmployeeId;
};

type SourceOnboardingEmployeeActor = Extract<
  SourceAdapterOnboardingPrepareInput["actor"],
  { kind: "employee" }
>;

export type SourceOnboardingAuthorization = Readonly<{
  actor: SourceOnboardingEmployeeActor;
  snapshot: InboxV2AuthorizationEpochSnapshot;
  decisionRefs: readonly InboxV2AuthorizationDecisionReference[];
  expectedStreamEpoch: InboxV2StreamEpoch;
}>;

export type SourceOnboardingCredentialFingerprint = Readonly<{
  keyGeneration: string;
  digest: InboxV2Sha256Digest;
}>;

/** Server-only boundary; raw credential bytes never leave this call. */
export type SourceOnboardingCredentialFingerprintProvider = Readonly<{
  fingerprint(input: {
    tenantId: TenantId;
    purpose: typeof SOURCE_ONBOARDING_CREDENTIAL_FINGERPRINT_PURPOSE;
    material: Uint8Array;
  }): Promise<SourceOnboardingCredentialFingerprint>;
}>;

export function createHmacSourceOnboardingCredentialFingerprintProvider(input: {
  keyGeneration: string;
  hmacKey: Uint8Array;
}): SourceOnboardingCredentialFingerprintProvider {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$/u.test(input.keyGeneration) ||
    input.hmacKey.byteLength < 32 ||
    input.hmacKey.byteLength > 128
  ) {
    throw new TypeError(
      "Source-onboarding fingerprint key metadata is invalid."
    );
  }
  const key = Uint8Array.from(input.hmacKey);
  const keyGeneration = input.keyGeneration;

  return Object.freeze({
    async fingerprint(fingerprintInput) {
      const tenantId = inboxV2TenantIdSchema.parse(fingerprintInput.tenantId);
      if (
        fingerprintInput.purpose !==
          SOURCE_ONBOARDING_CREDENTIAL_FINGERPRINT_PURPOSE ||
        !(fingerprintInput.material instanceof Uint8Array) ||
        fingerprintInput.material.byteLength === 0
      ) {
        throw new TypeError(
          "Source-onboarding credential fingerprint input is invalid."
        );
      }
      const hmac = createHmac("sha256", key);
      for (const field of [
        Buffer.from("core:source-onboarding-credential-fingerprint@v1"),
        Buffer.from(tenantId, "utf8"),
        Buffer.from(fingerprintInput.purpose, "utf8"),
        Buffer.from(keyGeneration, "utf8"),
        Buffer.from(fingerprintInput.material)
      ]) {
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(field.byteLength);
        hmac.update(length);
        hmac.update(field);
      }
      return {
        keyGeneration,
        digest: inboxV2Sha256DigestSchema.parse(`sha256:${hmac.digest("hex")}`)
      };
    }
  });
}

/**
 * Resolves a current, server-issued RBAC-003 epoch for the user command. The
 * legacy internal API permission header is not authorization-epoch authority.
 */
export type SourceOnboardingAuthorizationResolver = {
  resolveSourceOnboardingAuthorization(input: {
    requestId: string;
    tenantId: TenantId;
    employeeId: EmployeeId;
    sourceName: string;
    requestedAt: Date;
  }): Promise<SourceOnboardingAuthorization | null>;
};

export type SourceRegistryOnboardingUnitOfWork = {
  onboardStandaloneSource(input: {
    requestId: string;
    clientMutationId: InboxV2ClientMutationId;
    requestHash: InboxV2Sha256Digest;
    authorization: SourceOnboardingAuthorization;
    registration: SourceAdapterRegistration;
    sourceConnection: {
      id: SourceConnectionId;
      tenantId: TenantId;
      sourceType: SourceConnectionRecord["sourceType"];
      sourceName: string;
      displayName: string;
      status: SourceConnectionRecord["status"];
      authType: SourceConnectionRecord["authType"];
      createdByEmployeeId: EmployeeId;
      updatedAt: Date;
    };
    prepared: SourceAdapterOnboardingPrepared;
  }): Promise<SourceRegistryOnboardingResult>;
};

export type SourceRegistryOnboardingResult = Readonly<{
  kind: "applied" | "already_applied";
  connection: SourceConnectionRecord;
  commit: InboxV2PrivilegedAuthorizationMutationReplayStatus;
}>;

export function createSourceRegistryOnboardingUnitOfWork(
  dependencies: Readonly<{
    repository: Pick<
      InboxV2SourceRegistryRepository,
      "persistSourceConnectionOnboarding" | "loadSourceOnboardingResultSnapshot"
    >;
    coordinator: InboxV2AuthorizedCommandCoordinator;
  }>
): SourceRegistryOnboardingUnitOfWork {
  return {
    async onboardStandaloneSource(commandInput) {
      const transition =
        commandInput.prepared.authority.connection.transitions[0];

      if (
        transition === undefined ||
        commandInput.prepared.authority.connection.transitions.length !== 1 ||
        commandInput.prepared.authority.accounts.length !== 0 ||
        transition.payload.entityKind !== "source_connection" ||
        transition.payload.intent !== "create" ||
        transition.payload.previousState !== null ||
        transition.payload.resultingState.payload.entityKind !==
          "source_connection" ||
        transition.payload.resultingState.payload.sourceConnection.id !==
          commandInput.prepared.authority.connection.head.payload
            .sourceConnection.id
      ) {
        throw new CoreError("module.unhealthy");
      }

      const occurredAt = inboxV2TimestampSchema.parse(
        transition.payload.committedAt
      );
      const authorization = normalizeSourceOnboardingAuthorization({
        authorization: commandInput.authorization,
        tenantId: commandInput.sourceConnection.tenantId,
        employeeId: commandInput.sourceConnection.createdByEmployeeId,
        requestedAt: new Date(occurredAt)
      });

      if (
        authorization === null ||
        !sameSourceOnboardingActor(
          transition.payload.actor,
          authorization.actor
        ) ||
        !sameSourceOnboardingActor(
          transition.payload.resultingState.payload.createdBy,
          authorization.actor
        ) ||
        transition.payload.tenantId !==
          commandInput.sourceConnection.tenantId ||
        transition.payload.resultingState.payload.sourceConnection.id !==
          commandInput.sourceConnection.id ||
        transition.payload.resultingState.payload.tenantId !==
          commandInput.sourceConnection.tenantId ||
        transition.payload.resultingState.payload.updatedAt !== occurredAt ||
        commandInput.sourceConnection.updatedAt.toISOString() !== occurredAt
      ) {
        throw new CoreError("permission.denied");
      }

      const primaryDecision = authorization.decisionRefs.find(
        (decision) => decision.permissionId === SOURCE_ONBOARDING_PERMISSION_ID
      );
      if (primaryDecision === undefined) {
        throw new CoreError("permission.denied");
      }

      const identityDigest = calculateInboxV2CanonicalSha256({
        protocol: "core:source-onboarding-command-identity@v1",
        tenantId: commandInput.sourceConnection.tenantId,
        employeeId: commandInput.sourceConnection.createdByEmployeeId,
        clientMutationId: commandInput.clientMutationId
      });
      const commandId = deterministicInternalId("command", identityDigest);
      const mutationId = deterministicInternalId(
        "source-onboarding-mutation",
        identityDigest
      );
      const streamCommitId = deterministicInternalId(
        "source-onboarding-commit",
        identityDigest
      );
      const correlationId = deterministicInternalId(
        "source-onboarding-correlation",
        identityDigest
      );
      const changeId = deterministicInternalId(
        "source-onboarding-change",
        identityDigest
      );
      const eventId = deterministicInternalId("event", identityDigest);
      const outboxIntentId = deterministicInternalId(
        "source-onboarding-outbox",
        identityDigest
      );
      const expectedStreamEpoch = authorization.expectedStreamEpoch;
      const resultSnapshotId = deterministicInternalId(
        "source-onboarding-result",
        identityDigest
      );
      const expectedConnectionResult = expectedSourceOnboardingConnection(
        commandInput.sourceConnection
      );
      const resultReference = inboxV2PayloadReferenceSchema.parse({
        tenantId: commandInput.sourceConnection.tenantId,
        recordId: resultSnapshotId,
        schemaId: INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_ID,
        schemaVersion: INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_VERSION,
        digest: calculateSourceOnboardingResultDigest(expectedConnectionResult)
      });
      const auditTargetRef = randomInternalReference();
      const tenantFacetRef = randomInternalReference();
      const grantSourceMappings = authorization.decisionRefs
        .map((decision) => ({
          internalReference: randomInternalReference(),
          authorizationDecisionId: decision.id
        }))
        .sort((left, right) =>
          compareRawStrings(left.internalReference, right.internalReference)
        );
      const commitReference = {
        tenantId: commandInput.sourceConnection.tenantId,
        streamEpoch: expectedStreamEpoch,
        commitId: streamCommitId,
        streamPosition: "1"
      } as const;
      const sourceEntity = {
        tenantId: commandInput.sourceConnection.tenantId,
        entityTypeId: "core:source-connection",
        entityId: commandInput.sourceConnection.id
      } as const;
      const stateHash = calculateInboxV2CanonicalSha256(
        transition.payload.resultingState
      );
      const transitionHash = calculateInboxV2CanonicalSha256(transition);
      const stateReference = inboxV2PayloadReferenceSchema.parse({
        tenantId: commandInput.sourceConnection.tenantId,
        // The source-registry head is the resolvable canonical state record.
        recordId: resultSnapshotId,
        schemaId: transition.payload.resultingState.schemaId,
        schemaVersion: transition.payload.resultingState.schemaVersion,
        digest: stateHash
      });
      const transitionReference = inboxV2PayloadReferenceSchema.parse({
        tenantId: commandInput.sourceConnection.tenantId,
        // The immutable source-registry transition is the domain commit record.
        recordId: resultSnapshotId,
        schemaId: transition.schemaId,
        schemaVersion: transition.schemaVersion,
        digest: transitionHash
      });
      const parsedChange = inboxV2TenantStreamChangeSchema.parse({
        reference: {
          tenantId: commandInput.sourceConnection.tenantId,
          commitId: streamCommitId,
          streamPosition: "1",
          changeId,
          ordinal: "1"
        },
        entity: sourceEntity,
        resultingRevision: transition.payload.cas.resultingRevision,
        timeline: null,
        audience: "staff_only",
        state: {
          kind: "upsert",
          stateSchemaId: transition.payload.resultingState.schemaId,
          stateSchemaVersion: transition.payload.resultingState.schemaVersion,
          stateHash,
          payloadReference: stateReference,
          domainCommitReference: transitionReference
        }
      });
      const { reference: _changeReference, ...contractChange } = parsedChange;
      const eventHash = calculateInboxV2CanonicalSha256({
        protocol: "core:source-onboarding-event@v1",
        tenantId: commandInput.sourceConnection.tenantId,
        eventId,
        commandId,
        clientMutationId: commandInput.clientMutationId,
        sourceEntity,
        changeId,
        stateHash,
        transitionHash,
        authorizationDecisionHashes: authorization.decisionRefs.map(
          (decision) => decision.decisionHash
        ),
        occurredAt
      });
      const parsedEvent = inboxV2DomainEventSchema.parse({
        tenantId: commandInput.sourceConnection.tenantId,
        id: eventId,
        typeId: "core:source-connection.changed",
        payloadSchemaId: "core:inbox-v2.source-connection-change",
        payloadSchemaVersion: "v1",
        commit: commitReference,
        ordinal: "1",
        changeIds: [changeId],
        subjects: [sourceEntity],
        payloadReference: null,
        correlationId,
        commandIds: [commandId],
        clientMutationIds: [commandInput.clientMutationId],
        authorizationDecisionRefs: authorization.decisionRefs,
        accessEffect: { kind: "none" },
        occurredAt,
        recordedAt: occurredAt,
        eventHash
      });
      const {
        tenantId: _eventTenantId,
        commit: _eventCommit,
        ...contractEvent
      } = parsedEvent;
      const consumerDedupeKey = calculateInboxV2CanonicalSha256({
        protocol: "core:source-onboarding-projection-dedupe@v1",
        tenantId: commandInput.sourceConnection.tenantId,
        commandId,
        handlerId: SOURCE_ONBOARDING_PROJECTION_HANDLER_ID
      });
      const intentHash = calculateInboxV2CanonicalSha256({
        protocol: "core:source-onboarding-projection-intent@v1",
        tenantId: commandInput.sourceConnection.tenantId,
        outboxIntentId,
        eventId,
        changeId,
        consumerDedupeKey,
        correlationId,
        availableAt: occurredAt
      });
      const parsedIntent = inboxV2OutboxIntentSchema.parse({
        tenantId: commandInput.sourceConnection.tenantId,
        id: outboxIntentId,
        typeId: "core:projection.update",
        handlerId: SOURCE_ONBOARDING_PROJECTION_HANDLER_ID,
        effectClass: "projection",
        commit: commitReference,
        eventId,
        changeIds: [changeId],
        payloadReference: null,
        consumerDedupeKey,
        correlationId,
        availableAt: occurredAt,
        intentHash
      });
      const {
        tenantId: _intentTenantId,
        commit: _intentCommit,
        ...contractIntent
      } = parsedIntent;
      const auditTarget = inboxV2InternalEntityReferenceSchema.parse({
        tenantId: commandInput.sourceConnection.tenantId,
        entityTypeId: "core:source-connection",
        entityId: auditTargetRef
      });
      const tenantFacetReference = inboxV2InternalEntityReferenceSchema.parse({
        tenantId: commandInput.sourceConnection.tenantId,
        entityTypeId: "core:tenant",
        entityId: tenantFacetRef
      });
      const facetHash = calculateInboxV2CanonicalSha256({
        protocol: "core:source-onboarding-audit-facet@v1",
        dimension: "tenant",
        reference: tenantFacetReference,
        relation: "affected"
      });
      const revisionDeltaHash = inboxV2Sha256DigestSchema.parse(
        computeInboxV2LeafHashDigest([stateHash])
      );
      const auditHash = calculateInboxV2CanonicalSha256({
        protocol: "core:source-onboarding-audit@v1",
        tenantId: commandInput.sourceConnection.tenantId,
        commandId,
        clientMutationId: commandInput.clientMutationId,
        requestHash: commandInput.requestHash,
        target: auditTarget,
        authorizationDecisionHashes: authorization.decisionRefs.map(
          (decision) => decision.decisionHash
        ),
        revisionDeltaHash,
        transitionHash,
        occurredAt
      });
      const authorizationNotAfter = earliestAuthorizationNotAfter(
        authorization.decisionRefs
      );
      const records: InboxV2AuthorizedCommandRecords = {
        mutationId,
        relationKind: null,
        streamCommitId,
        expectedStreamEpoch,
        audienceImpact: { kind: "none" },
        commitHash: inboxV2Sha256DigestSchema.parse(
          computeInboxV2LeafHashDigest([stateHash, eventHash, intentHash])
        ),
        correlationId,
        changes: [{ id: changeId, ordinal: 1, ...contractChange }],
        events: [contractEvent],
        outboxIntents: [{ ordinal: 1, ...contractIntent }],
        audit: {
          id: deterministicInternalId(
            "source-onboarding-audit",
            identityDigest
          ),
          actionId: SOURCE_ONBOARDING_COMMAND_TYPE_ID,
          target: auditTarget,
          reasonCodeId: "core:source-connection-created",
          matchedPermissionIds: uniqueSortedStrings(
            authorization.decisionRefs.map((decision) => decision.permissionId)
          ),
          grantSourceIds: uniqueSortedStrings(
            grantSourceMappings.map((mapping) => mapping.internalReference)
          ),
          authorizationScopeIds: uniqueSortedStrings(
            authorization.decisionRefs.map(
              (decision) => decision.resourceScopeId
            )
          ),
          overrideReasonCodeId: null,
          policyVersion: "v1",
          evidenceReference: transitionReference,
          authorizationDecisionRefs: authorization.decisionRefs,
          correlationId,
          outcome: "succeeded",
          revisionDeltaHash,
          previousAuditHash: null,
          auditHash,
          occurredAt,
          recordedAt: occurredAt,
          expiresAt: authorizationNotAfter,
          facets: [
            {
              ordinal: 1,
              dimension: "tenant",
              reference: tenantFacetReference,
              relation: "affected",
              facetHash
            }
          ]
        }
      };
      const revisions: InboxV2AuthorizedCommandRevisionPlan = {
        expectedTenantRbacRevision:
          authorization.snapshot.dependencies.tenantRbacRevision,
        expectedSharedAccessRevision:
          authorization.snapshot.dependencies.sharedAccessRevision,
        advanceTenantRbac: false,
        advanceSharedAccess: false,
        employees: [
          {
            employeeId: commandInput.sourceConnection.createdByEmployeeId,
            expectedEmployeeAccessRevision:
              authorization.snapshot.dependencies.employeeAccessRevision,
            expectedEmployeeInboxRelationRevision:
              authorization.snapshot.dependencies.employeeInboxRelationRevision,
            advanceEmployeeAccess: false,
            advanceEmployeeInboxRelation: false
          }
        ],
        resources: []
      };

      const result =
        await dependencies.coordinator.withAuthorizedCommandMutation<SourceConnectionRecord>(
          {
            tenantId: commandInput.sourceConnection.tenantId,
            command: {
              id: commandId,
              requestId: inboxV2RequestIdSchema.parse(commandInput.requestId),
              clientMutationId: commandInput.clientMutationId,
              commandTypeId: inboxV2CatalogIdSchema.parse(
                SOURCE_ONBOARDING_COMMAND_TYPE_ID
              ),
              requestHash: commandInput.requestHash,
              actor: {
                kind: "employee",
                employeeId: commandInput.sourceConnection.createdByEmployeeId
              },
              authorizationDecisionId: primaryDecision.id,
              authorizationEpoch: authorization.snapshot.value,
              authorizedAt: occurredAt,
              publicResultCode: SOURCE_ONBOARDING_PUBLIC_RESULT_CODE,
              resultReference,
              sensitiveResultReference: null
            },
            revisions,
            records,
            occurredAt
          },
          async (context) => ({
            result:
              await dependencies.repository.persistSourceConnectionOnboarding(
                context,
                {
                  onboarding: {
                    declaration: commandInput.registration.declaration,
                    lifecycleBinding:
                      commandInput.registration.lifecycleBinding,
                    transition,
                    compatibilityConnection: commandInput.sourceConnection,
                    artifactWrites: commandInput.prepared.artifactWrites,
                    secretWrites: commandInput.prepared.secretWrites,
                    routeWrites: commandInput.prepared.routeWrites
                  },
                  resultSnapshot: {
                    resultReference,
                    streamCommitId,
                    lifecycle: sourceRegistryLifecycleLocator({
                      registration: commandInput.registration,
                      copySlot: "source_onboarding_result_snapshot",
                      purposeId: SOURCE_ONBOARDING_RESULT_LIFECYCLE_PURPOSE_ID
                    }),
                    auditTargetRef,
                    tenantFacetRef,
                    grantSourceMappings
                  }
                }
              )
          }),
          async (context, status) => {
            if (status.resultReference === null) {
              throw new CoreError("module.unhealthy");
            }
            const replay =
              await dependencies.repository.loadSourceOnboardingResultSnapshot(
                context,
                { resultReference: status.resultReference }
              );
            if (replay === null) {
              throw new CoreError("module.unhealthy");
            }
            return replay;
          }
        );

      if (result.kind === "applied") {
        if (result.status.sensitiveResultReference !== null) {
          throw new CoreError("module.unhealthy");
        }
        assertSourceOnboardingConnectionResult(
          result.result,
          commandInput.sourceConnection
        );
        assertSourceOnboardingCommitStatus(result.status, {
          commandId,
          mutationId,
          streamCommitId,
          expectedStreamEpoch,
          resultReference
        });
        return {
          kind: "applied",
          connection: result.result,
          commit: result.status
        };
      }

      if (result.kind === "already_applied") {
        assertSourceOnboardingCommitStatus(result.status, {
          commandId,
          mutationId,
          streamCommitId,
          resultReference
        });
        const connection = result.result;
        if (connection === undefined) {
          throw new CoreError("module.unhealthy");
        }
        assertSourceOnboardingConnectionResult(
          connection,
          commandInput.sourceConnection
        );
        return {
          kind: "already_applied",
          connection,
          commit: result.status
        };
      }

      if (result.kind === "idempotency_conflict") {
        throw new CoreError("command.idempotency_conflict");
      }
      if (
        result.kind === "revision_conflict" ||
        result.kind === "resource_not_found"
      ) {
        throw new CoreError("permission.denied");
      }
      throw new CoreError("module.unhealthy");
    }
  };
}

export async function resolveSourceOnboardingAuthorization(input: {
  context: SourceOnboardingContext;
  sourceName: string;
  requestedAt: Date;
  authorizationResolver?: SourceOnboardingAuthorizationResolver;
}): Promise<SourceOnboardingAuthorization> {
  if (!input.authorizationResolver) {
    throw new CoreError("module.unhealthy");
  }

  const authorization =
    await input.authorizationResolver.resolveSourceOnboardingAuthorization({
      requestId: input.context.requestId,
      tenantId: input.context.tenantId,
      employeeId: input.context.employeeId,
      sourceName: input.sourceName,
      requestedAt: input.requestedAt
    });
  const normalized = normalizeSourceOnboardingAuthorization({
    authorization,
    tenantId: input.context.tenantId,
    employeeId: input.context.employeeId,
    requestedAt: input.requestedAt
  });

  if (normalized === null) {
    throw new CoreError("permission.denied");
  }

  return normalized;
}

export async function resolveSourceOnboardingEmployeeActor(input: {
  context: SourceOnboardingContext;
  sourceName: string;
  requestedAt: Date;
  authorizationResolver?: SourceOnboardingAuthorizationResolver;
}): Promise<SourceOnboardingEmployeeActor> {
  return (await resolveSourceOnboardingAuthorization(input)).actor;
}

function normalizeSourceOnboardingAuthorization(input: {
  authorization: SourceOnboardingAuthorization | null;
  tenantId: TenantId;
  employeeId: EmployeeId;
  requestedAt: Date;
}): SourceOnboardingAuthorization | null {
  if (input.authorization === null) return null;

  const actor = inboxV2SourceThreadBindingTransitionActorSchema.safeParse(
    input.authorization.actor
  );
  const snapshot = inboxV2AuthorizationEpochSnapshotSchema.safeParse(
    input.authorization.snapshot
  );
  const expectedStreamEpoch = inboxV2StreamEpochSchema.safeParse(
    input.authorization.expectedStreamEpoch
  );
  if (
    !actor.success ||
    actor.data.kind !== "employee" ||
    !snapshot.success ||
    !expectedStreamEpoch.success ||
    !Array.isArray(input.authorization.decisionRefs) ||
    input.authorization.decisionRefs.length === 0 ||
    input.authorization.decisionRefs.length > 64
  ) {
    return null;
  }

  const decisions: InboxV2AuthorizationDecisionReference[] = [];
  for (const decision of input.authorization.decisionRefs) {
    const parsed =
      inboxV2AuthorizationDecisionReferenceSchema.safeParse(decision);
    if (!parsed.success) return null;
    decisions.push(parsed.data);
  }
  decisions.sort((left, right) => compareRawStrings(left.id, right.id));

  const requestedAt = input.requestedAt.getTime();
  const evaluatedAt = Date.parse(snapshot.data.evaluatedAt);
  const snapshotNotAfter = Date.parse(snapshot.data.notAfter);
  const nextBoundary =
    snapshot.data.nextAuthorizationBoundary === null
      ? null
      : Date.parse(snapshot.data.nextAuthorizationBoundary);
  const snapshotTemporalFence = Math.min(
    snapshotNotAfter,
    nextBoundary ?? Number.POSITIVE_INFINITY
  );
  const decisionNotAfter = Math.min(
    ...decisions.map((decision) => Date.parse(decision.notAfter))
  );

  if (
    !Number.isFinite(requestedAt) ||
    actor.data.employee.tenantId !== input.tenantId ||
    actor.data.employee.id !== input.employeeId ||
    actor.data.authorizationEpoch !== snapshot.data.value ||
    snapshot.data.tenantId !== input.tenantId ||
    snapshot.data.employee.tenantId !== input.tenantId ||
    snapshot.data.employee.id !== input.employeeId ||
    snapshot.data.dependencies.resourceDependencies.length !== 0 ||
    evaluatedAt > requestedAt ||
    requestedAt >= snapshotTemporalFence ||
    decisionNotAfter > snapshotTemporalFence ||
    new Set(decisions.map((decision) => decision.id)).size !==
      decisions.length ||
    !decisions.some(
      (decision) => decision.permissionId === SOURCE_ONBOARDING_PERMISSION_ID
    ) ||
    decisions.some(
      (decision) =>
        decision.tenantId !== input.tenantId ||
        decision.authorizationEpoch !== snapshot.data.value ||
        decision.principal.kind !== "employee" ||
        decision.principal.employee.tenantId !== input.tenantId ||
        decision.principal.employee.id !== input.employeeId ||
        decision.resource.tenantId !== input.tenantId ||
        decision.resourceScopeId !== "core:permission-scope.tenant" ||
        decision.resource.entityTypeId !== "core:tenant" ||
        String(decision.resource.entityId) !== String(input.tenantId) ||
        decision.outcome !== "allowed" ||
        Date.parse(decision.decidedAt) > evaluatedAt ||
        Date.parse(decision.decidedAt) > requestedAt ||
        Date.parse(decision.notAfter) <= requestedAt
    )
  ) {
    return null;
  }

  return {
    actor: actor.data,
    snapshot: snapshot.data,
    decisionRefs: decisions,
    expectedStreamEpoch: expectedStreamEpoch.data
  };
}

function sameSourceOnboardingActor(
  left: unknown,
  right: SourceOnboardingEmployeeActor
): boolean {
  const parsed =
    inboxV2SourceThreadBindingTransitionActorSchema.safeParse(left);
  return (
    parsed.success &&
    parsed.data.kind === "employee" &&
    parsed.data.employee.tenantId === right.employee.tenantId &&
    parsed.data.employee.id === right.employee.id &&
    parsed.data.authorizationEpoch === right.authorizationEpoch
  );
}

function deterministicInternalId(
  namespace: string,
  digest: InboxV2Sha256Digest
): string {
  return `${namespace}:${digestHex(digest)}`;
}

function randomInternalReference(): string {
  return `internal-ref:${randomBytes(32).toString("hex")}`;
}

function digestHex(digest: InboxV2Sha256Digest): string {
  return inboxV2Sha256DigestSchema.parse(digest).slice("sha256:".length);
}

function uniqueSortedStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareRawStrings);
}

function compareRawStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function earliestAuthorizationNotAfter(
  decisions: readonly InboxV2AuthorizationDecisionReference[]
): string {
  const first = decisions[0];
  if (first === undefined) throw new CoreError("permission.denied");
  return decisions.reduce(
    (earliest, decision) =>
      Date.parse(decision.notAfter) < Date.parse(earliest)
        ? decision.notAfter
        : earliest,
    first.notAfter
  );
}

function assertSourceOnboardingConnectionResult(
  record: SourceConnectionRecord,
  expected: SourceRegistryOnboardingUnitOfWork["onboardStandaloneSource"] extends (
    input: infer TInput
  ) => Promise<unknown>
    ? TInput extends { sourceConnection: infer TConnection }
      ? TConnection
      : never
    : never
): void {
  if (record.tenantId !== expected.tenantId) {
    throw new CoreError("tenant.boundary_violation");
  }
  if (
    record.id !== expected.id ||
    record.sourceType !== expected.sourceType ||
    record.sourceName !== expected.sourceName ||
    record.displayName !== expected.displayName ||
    record.status !== expected.status ||
    record.authType !== expected.authType ||
    record.createdByEmployeeId !== expected.createdByEmployeeId
  ) {
    throw new CoreError("module.unhealthy");
  }
}

function expectedSourceOnboardingConnection(
  expected: SourceRegistryOnboardingUnitOfWork["onboardStandaloneSource"] extends (
    input: infer TInput
  ) => Promise<unknown>
    ? TInput extends { sourceConnection: infer TConnection }
      ? TConnection
      : never
    : never
): SourceConnectionRecord {
  return {
    ...expected,
    capabilities: {},
    config: {},
    diagnostics: {},
    metadata: {},
    createdAt: expected.updatedAt
  } as SourceConnectionRecord;
}

function calculateSourceOnboardingResultDigest(
  record: SourceConnectionRecord
): InboxV2Sha256Digest {
  return calculateInboxV2CanonicalSha256({
    protocol: `${INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_ID}@${INBOX_V2_SOURCE_ONBOARDING_RESULT_SCHEMA_VERSION}`,
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
  });
}

function assertSourceOnboardingCommitStatus(
  status: InboxV2PrivilegedAuthorizationMutationReplayStatus,
  expected: {
    commandId: string;
    mutationId: string;
    streamCommitId: string;
    expectedStreamEpoch?: string;
    resultReference: InboxV2PrivilegedAuthorizationMutationReplayStatus["resultReference"];
  }
): void {
  if (
    status.commandId !== expected.commandId ||
    status.mutationId !== expected.mutationId ||
    status.publicResultCode !== SOURCE_ONBOARDING_PUBLIC_RESULT_CODE ||
    status.streamCommitId !== expected.streamCommitId ||
    (expected.expectedStreamEpoch !== undefined &&
      status.streamEpoch !== expected.expectedStreamEpoch) ||
    !inboxV2StreamEpochSchema.safeParse(status.streamEpoch).success ||
    JSON.stringify(status.resultReference) !==
      JSON.stringify(expected.resultReference) ||
    !inboxV2TimestampSchema.safeParse(status.committedAt).success
  ) {
    throw new CoreError("module.unhealthy");
  }
}

export function createSourceAdapterOnboardingPrepareInput(input: {
  context: SourceOnboardingContext;
  actor: SourceOnboardingEmployeeActor;
  source: SourceCatalogItem;
  sourceConnectionId: SourceConnectionId;
  registration: SourceAdapterRegistration;
  displayName: string;
  publicBaseUrl?: string;
  webhookToken?: string;
  createWebhookToken(): string;
  createIngressRouteMaterial(): Uint8Array;
  requestedAt: Date;
}): {
  prepareInput: SourceAdapterOnboardingPrepareInput;
  expectedStandardWebhookSecretToken?: string;
} {
  const tenantId = inboxV2TenantIdSchema.parse(input.context.tenantId);
  const credentialMode = input.registration.declaration.payload.credentialMode;
  const standardWebhookSecretProfile = isStandardWebhookSecretProfile({
    registration: input.registration,
    source: input.source
  });
  let credentialBindings: readonly InboxV2SourceRegistrySecretReference[] = [];
  let ephemeralCredentials: SourceAdapterOnboardingPrepareInput["ephemeralCredentials"] =
    [];
  let expectedStandardWebhookSecretToken: string | undefined;
  let ephemeralIngressRouteMaterial: Uint8Array | null = null;

  if (input.registration.declaration.payload.ingress.mode !== "not_supported") {
    ephemeralIngressRouteMaterial = input.createIngressRouteMaterial();
    if (
      !(ephemeralIngressRouteMaterial instanceof Uint8Array) ||
      ephemeralIngressRouteMaterial.byteLength !== 32
    ) {
      ephemeralIngressRouteMaterial?.fill(0);
      throw new CoreError("module.unhealthy");
    }
  }

  if (credentialMode === "revocable_secret_binding") {
    if (!standardWebhookSecretProfile) {
      throw new CoreError("validation.failed");
    }
    expectedStandardWebhookSecretToken =
      input.webhookToken?.trim() || input.createWebhookToken();
    if (
      expectedStandardWebhookSecretToken.length < 16 ||
      expectedStandardWebhookSecretToken.length > 200
    ) {
      throw new CoreError("validation.failed");
    }
    const credentialBinding: InboxV2SourceRegistrySecretReference = {
      tenantId,
      bindingId: `source-credential:v1:${randomUUID()}`,
      revision: inboxV2EntityRevisionSchema.parse("1"),
      status: "active",
      lifecycle: sourceRegistryLifecycleLocator({
        registration: input.registration,
        copySlot: "credential_binding",
        purposeId: SOURCE_ONBOARDING_CREDENTIAL_LIFECYCLE_PURPOSE_ID
      })
    };
    credentialBindings = [credentialBinding];
    ephemeralCredentials = [
      {
        bindingId: credentialBinding.bindingId,
        material: new TextEncoder().encode(expectedStandardWebhookSecretToken)
      }
    ];
  } else if (input.webhookToken?.trim()) {
    throw new CoreError("validation.failed");
  }

  return {
    prepareInput: {
      tenantId,
      sourceName: input.source.sourceName,
      sourceConnection: {
        tenantId,
        kind: "source_connection",
        id: input.sourceConnectionId
      },
      actor: input.actor,
      requestedAt: input.requestedAt.toISOString(),
      publicBaseUrl: input.publicBaseUrl ?? "",
      displayName: input.displayName,
      artifacts: [],
      credentialBindings,
      ephemeralCredentials,
      ephemeralIngressRouteMaterial
    },
    ...(expectedStandardWebhookSecretToken
      ? { expectedStandardWebhookSecretToken }
      : {})
  };
}

export function createSourceOnboardingRequestHash(input: {
  tenantId: TenantId;
  sourceName: string;
  displayName: string;
  clientMutationId: InboxV2ClientMutationId;
  credentialFingerprint: SourceOnboardingCredentialFingerprint | null;
}): InboxV2Sha256Digest {
  const credentialFingerprint =
    input.credentialFingerprint === null
      ? null
      : {
          keyGeneration: requireCredentialFingerprintKeyGeneration(
            input.credentialFingerprint.keyGeneration
          ),
          digest: inboxV2Sha256DigestSchema.parse(
            input.credentialFingerprint.digest
          )
        };
  return calculateInboxV2CanonicalSha256({
    protocol: "core:source-onboarding-request@v1",
    tenantId: input.tenantId,
    sourceName: input.sourceName,
    displayName: input.displayName,
    clientMutationId: input.clientMutationId,
    credentialFingerprint
  });
}

/** Initial internal-API credential profile; other auth flows need own input. */
function isStandardWebhookSecretProfile(input: {
  registration: SourceAdapterRegistration;
  source: SourceCatalogItem;
}): boolean {
  const declaration = input.registration.declaration.payload;
  const onboarding = declaration.onboarding;
  const oneTimeResponse =
    onboarding.mode === "not_supported" ? null : onboarding.oneTimeResponse;

  return (
    declaration.credentialMode === "revocable_secret_binding" &&
    declaration.ingress.mode === "webhook" &&
    input.source.authTypes.includes("webhook_secret") &&
    oneTimeResponse?.schemaId ===
      INBOX_V2_SOURCE_ONBOARDING_ONE_TIME_RESPONSE_SCHEMA_ID &&
    oneTimeResponse.schemaVersion === "v1" &&
    oneTimeResponse.fieldIds.length === 1 &&
    oneTimeResponse.fieldIds[0] ===
      INBOX_V2_SOURCE_ONBOARDING_WEBHOOK_TOKEN_FIELD_ID
  );
}

/** Resolves only the registered standard webhook-secret response profile. */
export function resolveStandardWebhookSecretOneTimeToken(input: {
  prepared: SourceAdapterOnboardingPrepared;
  expected?: string;
}): string | undefined {
  const response = input.prepared.oneTimeResponse;

  if (!input.expected) {
    if (response !== null) {
      throw new CoreError("module.unhealthy");
    }
    return undefined;
  }

  if (
    response === null ||
    response.schemaId !==
      INBOX_V2_SOURCE_ONBOARDING_ONE_TIME_RESPONSE_SCHEMA_ID ||
    response.schemaVersion !== "v1" ||
    response.fields.length !== 1 ||
    response.fields[0]?.fieldId !==
      INBOX_V2_SOURCE_ONBOARDING_WEBHOOK_TOKEN_FIELD_ID
  ) {
    throw new CoreError("module.unhealthy");
  }

  const material = response.fields[0].value;
  let token: string;

  try {
    token = new TextDecoder("utf-8", { fatal: true }).decode(material);
  } catch {
    throw new CoreError("module.unhealthy");
  }

  if (
    token !== input.expected ||
    token.length < 16 ||
    token.length > 200 ||
    !input.prepared.secretWrites.some((write) =>
      sameBytes(write.material, material)
    ) ||
    input.prepared.routeWrites.some((write) =>
      sameBytes(write.material, material)
    ) ||
    input.prepared.artifactWrites.some((write) =>
      sameBytes(write.material, material)
    )
  ) {
    throw new CoreError("module.unhealthy");
  }

  return token;
}

export function sourceAuthTypeForAdapterRegistration(input: {
  registration: SourceAdapterRegistration;
  source: SourceCatalogItem;
}): SourceConnectionRecord["authType"] {
  if (
    input.registration.declaration.payload.credentialMode ===
      "revocable_secret_binding" &&
    input.source.authTypes.includes("webhook_secret")
  ) {
    return "webhook_secret";
  }

  const authType = input.source.authTypes[0];

  if (!authType) {
    throw new CoreError("module.unhealthy");
  }

  return authType;
}

export function validateCommittedSourceOnboarding(input: {
  context: SourceOnboardingContext;
  source: SourceCatalogItem;
  sourceConnectionId: SourceConnectionId;
  record: SourceConnectionRecord;
}): void {
  if (input.record.tenantId !== input.context.tenantId) {
    throw new CoreError("tenant.boundary_violation");
  }

  if (
    input.record.id !== input.sourceConnectionId ||
    input.record.sourceName !== input.source.sourceName ||
    input.record.sourceType !== input.source.sourceType ||
    input.record.createdByEmployeeId !== input.context.employeeId
  ) {
    throw new CoreError("module.unhealthy");
  }
}

/** Best-effort lifetime bound for plaintext transient adapter material. */
export function clearSourceOnboardingTransientMaterial(input: {
  prepareInput: SourceAdapterOnboardingPrepareInput;
  prepared?: SourceAdapterOnboardingPrepared;
}): void {
  for (const credential of input.prepareInput.ephemeralCredentials) {
    credential.material.fill(0);
  }
  input.prepareInput.ephemeralIngressRouteMaterial?.fill(0);
  for (const write of input.prepared?.secretWrites ?? []) {
    write.material.fill(0);
  }
  for (const write of input.prepared?.artifactWrites ?? []) {
    write.material.fill(0);
  }
  for (const write of input.prepared?.routeWrites ?? []) {
    write.material.fill(0);
  }
  for (const field of input.prepared?.oneTimeResponse?.fields ?? []) {
    field.value.fill(0);
  }
}

function sourceRegistryLifecycleLocator(input: {
  registration: SourceAdapterRegistration;
  copySlot: "credential_binding" | "source_onboarding_result_snapshot";
  purposeId:
    | typeof SOURCE_ONBOARDING_CREDENTIAL_LIFECYCLE_PURPOSE_ID
    | typeof SOURCE_ONBOARDING_RESULT_LIFECYCLE_PURPOSE_ID;
}): InboxV2SourceRegistryLifecycleLocator {
  const binding = input.registration.lifecycleBinding.payload.bindings.find(
    (candidate) => candidate.copySlot === input.copySlot
  );
  const purpose = binding?.processingPurposes.find(
    (candidate) => candidate.id === input.purposeId
  );

  if (!binding || !purpose) {
    throw new CoreError("module.unhealthy");
  }

  return {
    registry: input.registration.lifecycleBinding.payload.registry,
    copySlot: input.copySlot,
    dataClassId: binding.dataClass.id,
    storageRootId: binding.storageRoot.id,
    purposeId: purpose.id,
    lineageRevision: binding.lineageRevision
  };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function requireCredentialFingerprintKeyGeneration(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$/u.test(value)) {
    throw new TypeError(
      "Source-onboarding credential fingerprint generation is invalid."
    );
  }
  return value;
}
