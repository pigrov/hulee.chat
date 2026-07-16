import {
  calculateInboxV2CanonicalSha256,
  defineInboxV2RawIngressSanitizer,
  defineInboxV2RawIngressSanitizerProfile,
  defineInboxV2SourceNormalizer,
  defineInboxV2SourceNormalizerProfile,
  executeInboxV2SourceNormalizer,
  inboxV2ClientContactIdSchema,
  inboxV2EmployeeIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2NamespacedIdSchema,
  inboxV2SourceAccountIdSchema,
  inboxV2SourceConnectionIdSchema,
  inboxV2SourceExternalIdentityIdSchema,
  inboxV2TenantIdSchema,
  sanitizeInboxV2RawIngress,
  type InboxV2RawIngressInput,
  type InboxV2SanitizedRawIngressCandidate,
  type InboxV2SourceNormalizationCandidateBatch,
  type InboxV2SourceNormalizedEventDraft
} from "@hulee/contracts";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import { createSqlInboxV2RawIngressRepository } from "./sql-inbox-v2-raw-ingress-repository";
import { createSqlInboxV2SourceExternalIdentityRepository } from "./sql-inbox-v2-source-external-identity-repository";
import { createSqlInboxV2SourceIdentityResolutionRepository } from "./sql-inbox-v2-source-identity-resolution-repository";
import {
  createSqlInboxV2SourceNormalizationRepository,
  type CreateSqlInboxV2SourceNormalizationRepositoryOptions
} from "./sql-inbox-v2-source-normalization-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const suffix = `src004-${process.pid}-${Date.now().toString(36)}`;
const t0 = "2026-07-16T08:00:00.000Z";
const t1 = "2026-07-16T08:00:01.000Z";
const t2 = "2026-07-16T08:00:02.000Z";
const t3 = "2026-07-18T08:00:00.000Z";
const t4 = "2026-07-18T08:00:01.000Z";
const t5 = "2026-07-18T08:00:02.000Z";
const t6 = "2026-07-18T08:00:03.000Z";
const digestKeyGeneration = "src004-test-v1";
const digestKey = new TextEncoder().encode(
  "src004-integration-test-tenant-key-material-00000000000000000000"
);

const adapterContract = {
  contractId: "module:synthetic:source-adapter-src004",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "core:direct-messenger",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: t0
} as const;

const rawIngressSanitizerPin = {
  profileSchemaId: "core:inbox-v2.raw-ingress-sanitizer-profile",
  profileSchemaVersion: "v1",
  handlerId: "module:synthetic:sanitize-src004",
  handlerVersion: "v1",
  declarationRevision: "1",
  restrictedPayloadSchema: {
    schemaId: "module:synthetic:raw-event-src004",
    schemaVersion: "v1"
  }
} as const;

describePostgres(
  "SQL Inbox V2 source-identity resolution PostgreSQL invariants",
  () => {
    let database: HuleeDatabase;
    const ids = scope();

    beforeAll(async () => {
      if (!process.env.DATABASE_URL) {
        throw new Error(
          "DATABASE_URL is required for SRC-004 integration tests."
        );
      }
      database = createHuleeDatabase({
        connectionString: process.env.DATABASE_URL,
        poolConfig: { max: 4 }
      });
      await assertMigrationReady(database);
      await seedScope(database, ids);
    }, 30_000);

    afterAll(async () => {
      if (database) await closeHuleeDatabase(database);
    }, 30_000);

    it("persists an idempotent unresolved decision, then an explicit conflicted head without mutating history", async () => {
      const leased = await recordAndClaim(database, ids);
      const candidate = await normalizedCandidate(
        ids,
        leased.rawEventId,
        leased.restrictedMessage
      );
      await expect(
        normalizationRepository(database).complete(
          completionInput(candidate, leased)
        )
      ).resolves.toMatchObject({
        outcome: "completed",
        completion: { outcome: "normalized" }
      });

      const resolutionRepository =
        createSqlInboxV2SourceIdentityResolutionRepository(database);
      const event = await resolutionRepository.readNormalizedEventForResolution(
        {
          tenantId: ids.tenantId,
          normalizedEventId: ids.normalizedEventId
        }
      );
      expect(event).not.toBeNull();
      const observation = event?.identityObservations[0];
      if (event === null || observation === undefined) {
        throw new Error("Expected one normalized author observation.");
      }

      const identityId = inboxV2SourceExternalIdentityIdSchema.parse(
        `source_external_identity:${suffix}`
      );
      const materialized =
        await createSqlInboxV2SourceExternalIdentityRepository(
          database
        ).findOrCreate({
          tenantId: ids.tenantId,
          id: identityId,
          realm: {
            realmId: observation.realm.realmId,
            version: observation.realm.realmVersion,
            canonicalizationVersion: observation.realm.canonicalizationVersion
          },
          objectKindId: observation.objectKindId,
          scope: observation.scope,
          identityDeclaration: observation.identityDeclaration,
          materializationAuthority: {
            kind: "trusted_service",
            tenantId: ids.tenantId,
            trustedServiceId: event.adapterContract.loadedByTrustedServiceId,
            authorizationToken: `materialize-${suffix}`,
            authorizedAt: t2
          },
          materializedAt: t2,
          canonicalExternalSubject: observation.canonicalExternalSubject,
          stability: { kind: "stable" },
          createdAt: t2
        });
      expect(materialized.kind).toBe("created");

      const unresolvedInput = {
        tenantId: ids.tenantId,
        normalizedEventId: ids.normalizedEventId,
        observationKey: observation.observationKey,
        sourceExternalIdentityId: identityId,
        assessmentId: `source_identity_assessment:${suffix}-unresolved`,
        idempotencyKey: `source:v2:identity-resolution:${"a".repeat(64)}`,
        expectedAssessmentVersion: null,
        evidence: [],
        candidates: [],
        assessment: {
          outcome: "unresolved" as const,
          confidence: "none" as const,
          reason: "no_candidate" as const,
          evidenceOrdinals: [],
          candidateOrdinals: [],
          assessedAt: t3
        }
      };
      await expect(
        resolutionRepository.applyAssessment(unresolvedInput)
      ).resolves.toMatchObject({
        kind: "applied",
        assessment: { assessmentVersion: "1", outcome: "unresolved" }
      });
      await expect(
        resolutionRepository.applyAssessment(unresolvedInput)
      ).resolves.toMatchObject({
        kind: "already_applied",
        assessment: { assessmentVersion: "1", outcome: "unresolved" }
      });

      const evidence = [
        {
          ordinal: 0,
          reference: {
            kind: "normalized_inbound_event" as const,
            reference: event.normalizedInboundEvent
          },
          confidence: "strong" as const,
          provenance: {
            kind: "adapter_observation" as const,
            adapterContract: event.adapterContract,
            observationKey: observation.observationKey
          },
          observedAt: observation.observedAt
        }
      ];
      const candidates = [
        {
          ordinal: 0,
          target: {
            kind: "employee" as const,
            employee: {
              tenantId: ids.tenantId,
              kind: "employee" as const,
              id: inboxV2EmployeeIdSchema.parse(`employee:${suffix}-one`)
            }
          },
          confidence: "strong" as const,
          evidenceOrdinals: [0]
        },
        {
          ordinal: 1,
          target: {
            kind: "client_contact" as const,
            clientContact: {
              tenantId: ids.tenantId,
              kind: "client_contact" as const,
              id: inboxV2ClientContactIdSchema.parse(
                `client_contact:${suffix}-two`
              )
            }
          },
          confidence: "strong" as const,
          evidenceOrdinals: [0]
        }
      ];
      await expect(
        resolutionRepository.applyAssessment({
          ...unresolvedInput,
          assessmentId: `source_identity_assessment:${suffix}-conflicted`,
          idempotencyKey: `source:v2:identity-resolution:${"b".repeat(64)}`,
          expectedAssessmentVersion: inboxV2EntityRevisionSchema.parse("1"),
          evidence,
          candidates,
          assessment: {
            outcome: "conflicted",
            confidence: "strong",
            reason: "multiple_candidates",
            evidenceOrdinals: [0],
            candidateOrdinals: [0, 1],
            assessedAt: t4
          }
        })
      ).resolves.toMatchObject({
        kind: "applied",
        assessment: { assessmentVersion: "2", outcome: "conflicted" }
      });

      await expect(
        resolutionRepository.applyAssessment({
          ...unresolvedInput,
          assessmentId: `source_identity_assessment:${suffix}-stale`,
          idempotencyKey: `source:v2:identity-resolution:${"c".repeat(64)}`
        })
      ).resolves.toEqual({
        kind: "version_conflict",
        currentVersion: "2",
        currentAssessmentId: `source_identity_assessment:${suffix}-conflicted`
      });
      await expect(
        resolutionRepository.findCurrentAssessment({
          tenantId: ids.tenantId,
          sourceExternalIdentityId: identityId
        })
      ).resolves.toMatchObject({
        assessmentVersion: "2",
        previousAssessmentVersion: "1",
        outcome: "conflicted",
        sourceExternalIdentityFact: {
          schemaId:
            "core:inbox-v2.source-identity-materialization-subjectless-fact",
          schemaVersion: "v1",
          identityRevision: "1",
          resolutionStatus: "unresolved"
        }
      });

      const persistedProvenance = await database.execute<{
        provenance: unknown;
      }>(sql`
        select provenance
          from public.inbox_v2_source_identity_assessments
         where tenant_id = ${ids.tenantId}
           and source_external_identity_id = ${identityId}
         order by assessment_version
      `);
      expect(persistedProvenance.rows).toHaveLength(2);
      for (const row of persistedProvenance.rows) {
        const serialized = JSON.stringify(row.provenance);
        expect(serialized).toContain('"sourceExternalIdentityFact"');
        expect(serialized).toContain('"materializationDigestSha256"');
        expect(serialized).not.toContain("canonicalExternalSubject");
        expect(serialized).not.toContain("authorizationToken");
        expect(serialized).not.toContain(observation.canonicalExternalSubject);
        expect(serialized).not.toContain(`materialize-${suffix}`);
      }

      await appendTwoAssessmentsInOneTransaction(database, ids, identityId);
      await expect(
        resolutionRepository.findCurrentAssessment({
          tenantId: ids.tenantId,
          sourceExternalIdentityId: identityId
        })
      ).resolves.toMatchObject({
        assessmentVersion: "4",
        previousAssessmentVersion: "3",
        outcome: "conflicted",
        assessment: { assessedAt: t6 }
      });

      const counts = await database.execute<{
        observation_count: string;
        assessment_count: string;
        head_count: string;
      }>(sql`
        select
          (select count(*)::text
             from public.inbox_v2_source_identity_observations
            where tenant_id = ${ids.tenantId}) as observation_count,
          (select count(*)::text
             from public.inbox_v2_source_identity_assessments
            where tenant_id = ${ids.tenantId}) as assessment_count,
          (select count(*)::text
             from public.inbox_v2_source_identity_assessment_heads
            where tenant_id = ${ids.tenantId}) as head_count
      `);
      expect(counts.rows[0]).toEqual({
        observation_count: "1",
        assessment_count: "4",
        head_count: "1"
      });

      await expectSqlState(
        database.execute(sql`
          update public.inbox_v2_source_identity_observations
             set created_at = created_at
           where tenant_id = ${ids.tenantId}
        `),
        "23514"
      );
      await expectSqlState(
        database.execute(sql`
          delete from public.inbox_v2_source_identity_assessments
           where tenant_id = ${ids.tenantId}
             and assessment_version = 1
        `),
        "23514"
      );
    }, 30_000);
  }
);

type Scope = ReturnType<typeof scope>;
type LeasedRaw = Awaited<ReturnType<typeof recordAndClaim>>;

async function appendTwoAssessmentsInOneTransaction(
  database: HuleeDatabase,
  ids: Scope,
  identityId: string
): Promise<void> {
  const appends = [
    {
      previousVersion: "2",
      version: "3",
      assessmentId: `source_identity_assessment:${suffix}-batch-3`,
      digest: `sha256:${"3".repeat(64)}`,
      idempotencyKey: `source:v2:identity-resolution:${"d".repeat(64)}`,
      assessedAt: t5
    },
    {
      previousVersion: "3",
      version: "4",
      assessmentId: `source_identity_assessment:${suffix}-batch-4`,
      digest: `sha256:${"4".repeat(64)}`,
      idempotencyKey: `source:v2:identity-resolution:${"e".repeat(64)}`,
      assessedAt: t6
    }
  ] as const;

  await database.transaction(async (transaction) => {
    for (const append of appends) {
      await transaction.execute(sql`
        insert into public.inbox_v2_source_identity_assessments (
          tenant_id, id, source_external_identity_id, normalized_event_id,
          observation_key, safe_envelope_hmac_sha256,
          previous_assessment_version, assessment_version, outcome, confidence,
          evidence, evidence_count, candidates, candidate_count, provenance,
          assessment_digest_sha256, idempotency_key, claim_id, claim_version,
          claim_target_kind, claim_target_employee_id,
          claim_target_client_contact_id, assessed_at, created_at
        )
        select tenant_id, ${append.assessmentId}, source_external_identity_id,
               normalized_event_id, observation_key, safe_envelope_hmac_sha256,
               ${append.previousVersion}::bigint, ${append.version}::bigint,
               outcome, confidence, evidence, evidence_count, candidates,
               candidate_count,
               jsonb_set(
                 provenance,
                 '{assessment,assessedAt}',
                 to_jsonb(${append.assessedAt}::text),
                 false
               ),
               ${append.digest}, ${append.idempotencyKey}, claim_id,
               claim_version, claim_target_kind, claim_target_employee_id,
               claim_target_client_contact_id, ${append.assessedAt}::timestamptz,
               ${append.assessedAt}::timestamptz
          from public.inbox_v2_source_identity_assessments
         where tenant_id = ${ids.tenantId}
           and source_external_identity_id = ${identityId}
           and assessment_version = ${append.previousVersion}::bigint
      `);
      await transaction.execute(sql`
        update public.inbox_v2_source_identity_assessment_heads
           set latest_assessment_id = ${append.assessmentId},
               latest_assessment_version = ${append.version}::bigint,
               assessment_digest_sha256 = ${append.digest},
               idempotency_key = ${append.idempotencyKey},
               updated_at = ${append.assessedAt}::timestamptz
         where tenant_id = ${ids.tenantId}
           and source_external_identity_id = ${identityId}
           and latest_assessment_version = ${append.previousVersion}::bigint
      `);
    }
  });
}

function scope() {
  return {
    tenantId: inboxV2TenantIdSchema.parse(`tenant:${suffix}`),
    connectionId: inboxV2SourceConnectionIdSchema.parse(
      `source_connection:${suffix}`
    ),
    accountId: inboxV2SourceAccountIdSchema.parse(`source_account:${suffix}`),
    normalizedEventId: `normalized_inbound_event:${suffix}-0`
  } as const;
}

async function seedScope(executor: HuleeDatabase, ids: Scope): Promise<void> {
  await executor.execute(sql`
    insert into public.tenants (id, slug, display_name)
    values (${ids.tenantId}, ${suffix}, ${`SRC-004 ${suffix}`})
  `);
  await executor.execute(sql`
    insert into public.source_connections (
      id, tenant_id, source_type, source_name, display_name, status,
      auth_type, capabilities, config, diagnostics, metadata
    ) values (
      ${ids.connectionId}, ${ids.tenantId}, 'messenger', 'synthetic',
      'SRC-004 connection', 'active', 'custom', '{}'::jsonb, '{}'::jsonb,
      '{}'::jsonb, '{}'::jsonb
    )
  `);
  await executor.execute(sql`
    insert into public.source_accounts (
      id, tenant_id, source_connection_id, external_account_id,
      external_account_name, account_type, display_name, status, metadata
    ) values (
      ${ids.accountId}, ${ids.tenantId}, ${ids.connectionId},
      ${`external-${ids.accountId}`}, 'SRC-004 account', 'direct',
      'SRC-004 account', 'active', '{}'::jsonb
    )
  `);
}

async function recordAndClaim(executor: HuleeDatabase, ids: Scope) {
  const rawRepository = createSqlInboxV2RawIngressRepository(executor, {
    rawEventIdSource: () => `raw_inbound_event:${suffix}`
  });
  const restrictedMessage = `provider-${suffix}`;
  const recorded = await rawRepository.record(
    await acceptedRawCandidate(ids, restrictedMessage)
  );
  if (recorded.outcome !== "recorded") {
    throw new Error("Expected SRC-004 raw ingress to be recorded.");
  }
  const workerId = inboxV2NamespacedIdSchema.parse(`core:${suffix}-worker`);
  const leaseToken = `src004-${"t".repeat(32)}`;
  const claimed = await createSqlInboxV2RawIngressRepository(executor, {
    leaseTokenSource: () => [leaseToken]
  }).claim({
    tenantId: ids.tenantId,
    workerId,
    leaseDurationSeconds: 30,
    batchSize: 1
  });
  if (claimed.outcome !== "claimed" || claimed.claims.length !== 1) {
    throw new Error("Expected exactly one SRC-004 raw claim.");
  }
  const lease = claimed.claims[0]?.work.lease;
  if (lease === null || lease === undefined) {
    throw new Error("Expected a leased SRC-004 raw work item.");
  }
  return Object.freeze({
    rawEventId: recorded.rawEventId,
    workerId,
    leaseToken,
    leaseRevision: lease.leaseRevision,
    restrictedMessage
  });
}

async function acceptedRawCandidate(
  ids: Scope,
  identity: string
): Promise<InboxV2SanitizedRawIngressCandidate> {
  const result = await sanitizeInboxV2RawIngress({
    sanitizer: defineInboxV2RawIngressSanitizer({
      profile: rawIngressProfile(),
      handler: async () => ({
        outcome: "accepted",
        restrictedPayload: { message: identity },
        validatedAllowedHeaders: []
      }),
      parseRestrictedPayload: parseMessagePayload
    }),
    request: rawRequest(ids, identity)
  });
  if (result.outcome !== "accepted") {
    throw new Error("Expected an accepted SRC-004 raw candidate.");
  }
  return result.candidate;
}

function rawIngressProfile() {
  return defineInboxV2RawIngressSanitizerProfile({
    schemaId: rawIngressSanitizerPin.profileSchemaId,
    schemaVersion: rawIngressSanitizerPin.profileSchemaVersion,
    payload: {
      adapterContract,
      handlerId: rawIngressSanitizerPin.handlerId,
      handlerVersion: rawIngressSanitizerPin.handlerVersion,
      declarationRevision: rawIngressSanitizerPin.declarationRevision,
      restrictedPayloadSchema: rawIngressSanitizerPin.restrictedPayloadSchema,
      persistedHeaderNames: [],
      payloadClassification: {
        dataClassId: "core:raw_provider_payload",
        purposeIds: ["core:source_replay_and_diagnostics"]
      },
      allowedHeadersClassification: {
        dataClassId: "core:raw_provider_allowed_headers",
        purposeIds: ["core:source_replay_and_diagnostics"]
      }
    }
  });
}

function rawRequest(ids: Scope, identity: string): InboxV2RawIngressInput {
  return {
    tenantId: ids.tenantId,
    sourceConnectionId: ids.connectionId,
    sourceAccountId: ids.accountId,
    transport: "webhook",
    eventIdentity: { kind: "provider_event_id", value: identity },
    providerOccurredAt: t0,
    receivedAt: t1,
    sanitizedAt: t2,
    body: new TextEncoder().encode(JSON.stringify({ message: identity })),
    headers: {}
  };
}

async function normalizedCandidate(
  ids: Scope,
  rawEventId: string,
  restrictedMessage: string
): Promise<InboxV2SourceNormalizationCandidateBatch> {
  const normalizer = defineInboxV2SourceNormalizer({
    profile: normalizerProfile(),
    parseRestrictedPayload: parseMessagePayload,
    evidenceParsers: {
      "module:synthetic:message-content-src004": parseMessageEvidence
    },
    handler: () => ({
      outcome: "emitted",
      events: [messageEvent(ids)]
    })
  });
  return executeInboxV2SourceNormalizer({
    normalizer,
    raw: {
      tenantId: ids.tenantId,
      rawEventId,
      sourceConnectionId: ids.connectionId,
      sourceAccountId: ids.accountId,
      transport: "webhook",
      providerOccurredAt: t0,
      rawIngressSanitizer: rawIngressSanitizerPin,
      restrictedPayload: { message: restrictedMessage }
    }
  });
}

function normalizerProfile() {
  const identityDeclarations = [
    threadDeclaration(),
    messageDeclaration(),
    senderDeclaration()
  ].sort((left, right) =>
    String(calculateInboxV2CanonicalSha256(left)).localeCompare(
      String(calculateInboxV2CanonicalSha256(right))
    )
  );
  return defineInboxV2SourceNormalizerProfile({
    schemaId: "core:inbox-v2.source-normalizer-profile",
    schemaVersion: "v1",
    payload: {
      adapterContract,
      handlerId: "module:synthetic:normalize-src004",
      handlerVersion: "v1",
      declarationRevision: "1",
      rawIngressSanitizer: rawIngressSanitizerPin,
      eventKinds: ["message_created"],
      identityDeclarations,
      evidenceSlots: [
        {
          slotId: "module:synthetic:message-content-src004",
          schemaId: "module:synthetic:message-content-src004",
          schemaVersion: "v1",
          dataClassId: "core:normalized_event_payload",
          purposeIds: ["core:source_replay_and_diagnostics"]
        }
      ]
    }
  });
}

function messageEvent(ids: Scope): InboxV2SourceNormalizedEventDraft {
  const owner = sourceAccountReference(ids);
  return {
    direction: "inbound",
    visibility: "public",
    payloadVersion: "v1",
    providerOccurredAt: t0,
    semantic: {
      kind: "message_created",
      originKind: "webhook",
      authorObservationKey: "author-src004"
    },
    thread: {
      identityDeclaration: threadDeclaration(),
      key: {
        realm: {
          realmId: "module:synthetic:thread-realm-src004",
          realmVersion: "v1",
          canonicalizationVersion: "v1"
        },
        scope: { kind: "source_account", owner },
        objectKindId: "module:synthetic:chat-src004",
        canonicalExternalSubject: `Chat-${suffix}`
      },
      observedExternalSubject: `Chat-${suffix}`
    },
    message: {
      identityDeclaration: messageDeclaration(),
      realm: {
        realmId: "module:synthetic:message-realm-src004",
        realmVersion: "v1",
        canonicalizationVersion: "v1"
      },
      scope: { kind: "source_account", owner },
      objectKindId: "module:synthetic:message-src004",
      observedExternalSubject: `Message-${suffix}`,
      canonicalExternalSubject: `Message-${suffix}`
    },
    identityObservations: [
      {
        observationKey: "author-src004",
        purpose: "message_author",
        identityDeclaration: senderDeclaration(),
        realm: {
          realmId: "module:synthetic:sender-realm-src004",
          realmVersion: "v1",
          canonicalizationVersion: "v1"
        },
        scope: { kind: "source_account", owner },
        objectKindId: "module:synthetic:user-src004",
        observedExternalSubject: `User-${suffix}`,
        canonicalExternalSubject: `User-${suffix}`,
        stability: "stable",
        observedAt: t0
      }
    ],
    rosterObservation: null,
    capabilityObservation: {
      schemaId: "module:synthetic:capabilities-src004",
      schemaVersion: "v1",
      capabilities: []
    },
    evidence: [
      {
        slotId: "module:synthetic:message-content-src004",
        value: { text: `classified-${suffix}` }
      }
    ]
  };
}

function sourceAccountReference(ids: Scope) {
  return {
    tenantId: ids.tenantId,
    kind: "source_account" as const,
    id: ids.accountId
  };
}

function threadDeclaration() {
  return {
    adapterContract,
    identityKind: "external_thread" as const,
    realmId: "module:synthetic:thread-realm-src004",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:chat-src004",
    scopeKind: "source_account" as const,
    decisionStrength: "safe_default" as const
  };
}

function messageDeclaration() {
  return {
    adapterContract,
    identityKind: "message" as const,
    realmId: "module:synthetic:message-realm-src004",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:message-src004",
    scopeKind: "source_account" as const,
    decisionStrength: "safe_default" as const
  };
}

function senderDeclaration() {
  return {
    adapterContract,
    identityKind: "source_external_identity" as const,
    realmId: "module:synthetic:sender-realm-src004",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:user-src004",
    scopeKind: "source_account" as const,
    decisionStrength: "safe_default" as const
  };
}

function parseMessagePayload(value: unknown): { message: string } {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    typeof (value as { message?: unknown }).message !== "string"
  ) {
    throw new TypeError("Expected the exact SRC-004 message payload.");
  }
  return { message: (value as { message: string }).message };
}

function parseMessageEvidence(value: unknown): { text: string } {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    typeof (value as { text?: unknown }).text !== "string"
  ) {
    throw new TypeError("Expected the exact SRC-004 message evidence.");
  }
  return { text: (value as { text: string }).text };
}

function completionInput(
  candidate: InboxV2SourceNormalizationCandidateBatch,
  leased: LeasedRaw
) {
  return {
    candidate,
    workerId: leased.workerId,
    leaseToken: leased.leaseToken,
    expectedLeaseRevision: leased.leaseRevision
  } as const;
}

function normalizationRepository(executor: HuleeDatabase) {
  return createSqlInboxV2SourceNormalizationRepository(
    executor,
    normalizationOptions()
  );
}

function normalizationOptions(): CreateSqlInboxV2SourceNormalizationRepositoryOptions {
  return {
    normalizationDigestKeySource: ({ keyGeneration }) => {
      if (keyGeneration !== null && keyGeneration !== digestKeyGeneration) {
        throw new Error(`Unknown SRC-004 digest generation: ${keyGeneration}`);
      }
      return {
        keyGeneration: digestKeyGeneration,
        key: Uint8Array.from(digestKey)
      };
    },
    normalizedEventIdSource: () => `normalized_inbound_event:${suffix}-0`,
    quarantineIdSource: () => `core:${suffix}-quarantine`
  };
}

async function expectSqlState(
  operation: Promise<unknown>,
  expectedCode: string
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    let current: unknown = error;
    for (let depth = 0; depth < 8; depth += 1) {
      if (current === null || typeof current !== "object") break;
      if (Reflect.get(current, "code") === expectedCode) return;
      current = Reflect.get(current, "cause");
    }
    throw error;
  }
  throw new Error(`Expected PostgreSQL SQLSTATE ${expectedCode}.`);
}

async function assertMigrationReady(executor: HuleeDatabase): Promise<void> {
  const result = await executor.execute<{ observations: string | null }>(sql`
    select to_regclass(
      'public.inbox_v2_source_identity_observations'
    )::text as observations
  `);
  if (result.rows[0]?.observations === null) {
    throw new Error("SRC-004 migration 0044 is not installed.");
  }
}
