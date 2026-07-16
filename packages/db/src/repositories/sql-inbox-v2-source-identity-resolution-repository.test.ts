import {
  inboxV2SourceExternalIdentitySchema,
  type InboxV2SourceExternalIdentityId,
  type InboxV2TenantId
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import {
  buildAcquireInboxV2SourceIdentityAssessmentLocksSql,
  buildAdvanceInboxV2SourceIdentityAssessmentHeadSql,
  buildFindInboxV2SourceIdentityAssessmentByOperationSql,
  buildInsertInboxV2SourceIdentityAssessmentSql,
  buildReadInboxV2NormalizedEventForIdentityResolutionSql,
  calculateInboxV2SourceIdentitySubjectlessFact,
  createSqlInboxV2SourceIdentityResolutionRepository,
  type RawSqlExecutor,
  type RawSqlQueryResult
} from "./sql-inbox-v2-source-identity-resolution-repository";

const tenantId = "tenant:src004-unit" as InboxV2TenantId;
const normalizedEventId = "normalized_inbound_event:src004-unit-event";
const identityId =
  "source_external_identity:src004-unit-user" as InboxV2SourceExternalIdentityId;
const t0 = "2026-07-17T08:00:00.000Z";
const t1 = "2026-07-17T08:00:01.000Z";
const safeEnvelopeHmacSha256 = `hmac-sha256:${"a".repeat(64)}`;

describe("SQL Inbox V2 source identity resolution repository", () => {
  it("projects an explicit typed SRC-003 resolution envelope", () => {
    const query = renderQuery(
      buildReadInboxV2NormalizedEventForIdentityResolutionSql({
        tenantId,
        normalizedEventId
      })
    );

    expect(query.sql).toContain("jsonb_build_object");
    expect(query.sql).toContain("'normalizedInboundEvent'");
    expect(query.sql).toContain("'safeEnvelopeHmacSha256'");
    expect(query.sql).toContain("safe_envelope -> 'identityObservations'");
    expect(query.sql).toContain("safe_envelope #> '{thread,key}'");
    expect(query.sql).toContain("to_char");
    expect(query.sql).toContain('YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    expect(query.sql).toContain("where envelope.tenant_id = $1");
    expect(query.sql).toContain("and envelope.normalized_event_id = $2");
    expect(query.sql).not.toContain("select envelope.safe_envelope");
    expect(query.params).toEqual([tenantId, normalizedEventId]);
  });

  it("parses the closed projection through contracts", async () => {
    const executor = new QueueExecutor([
      [
        {
          resolution_event: normalizedResolutionProjection(),
          safe_envelope_hmac_sha256: safeEnvelopeHmacSha256
        }
      ]
    ]);
    const repository = createSqlInboxV2SourceIdentityResolutionRepository(
      executor as never
    );

    await expect(
      repository.readNormalizedEventForResolution({
        tenantId,
        normalizedEventId
      })
    ).resolves.toMatchObject({
      tenantId,
      normalizedInboundEvent: { id: normalizedEventId },
      safeEnvelopeHmacSha256,
      identityObservations: [
        {
          observationKey: "author-0001",
          canonicalExternalSubject: "User-ABC"
        }
      ]
    });
  });

  it("rejects persisted arbitrary JSON instead of trusting a cast", async () => {
    const projection = normalizedResolutionProjection();
    const executor = new QueueExecutor([
      [
        {
          resolution_event: {
            ...projection,
            identityObservations: [{ observationKey: "author-0001" }]
          },
          safe_envelope_hmac_sha256: safeEnvelopeHmacSha256
        }
      ]
    ]);
    const repository = createSqlInboxV2SourceIdentityResolutionRepository(
      executor as never
    );

    await expect(
      repository.readNormalizedEventForResolution({
        tenantId,
        normalizedEventId
      })
    ).rejects.toBeInstanceOf(InboxV2PersistenceInvariantError);
  });

  it("uses ordered advisory keys and a version-fenced head update", () => {
    const lock = renderQuery(
      buildAcquireInboxV2SourceIdentityAssessmentLocksSql({
        tenantId,
        assessmentId: "source_identity_assessment:src004-unit-1",
        idempotencyKey: `source:v2:identity-resolution:${"b".repeat(64)}`
      } as never)
    );
    expect(lock.sql).toContain("pg_advisory_xact_lock");
    expect(lock.sql).toContain("order by lock_key");

    const prepared = preparedAssessment();
    const insert = renderQuery(
      buildInsertInboxV2SourceIdentityAssessmentSql(prepared as never)
    );
    const advance = renderQuery(
      buildAdvanceInboxV2SourceIdentityAssessmentHeadSql(prepared as never)
    );
    expect(insert.sql).toContain(
      "insert into public.inbox_v2_source_identity_assessments"
    );
    expect(insert.sql).toContain("evidence, evidence_count");
    expect(insert.sql).toContain("candidates, candidate_count, provenance");
    expect(insert.params).toContainEqual(
      expect.stringContaining(
        '"schemaId":"core:inbox-v2.source-identity-assessment-provenance"'
      )
    );
    const serializedProvenance = insert.params.find(
      (value): value is string =>
        typeof value === "string" &&
        value.includes(
          '"schemaId":"core:inbox-v2.source-identity-assessment-provenance"'
        )
    );
    expect(serializedProvenance).toContain('"schemaVersion":"v2"');
    expect(serializedProvenance).toContain('"sourceExternalIdentityFact"');
    expect(serializedProvenance).toContain('"materializationDigestSha256"');
    expect(serializedProvenance).not.toContain("canonicalExternalSubject");
    expect(serializedProvenance).not.toContain("authorizationToken");
    expect(serializedProvenance).not.toContain("User-ABC");
    expect(serializedProvenance).not.toContain("materialize-src004-unit");
    expect(advance.sql).toContain("latest_assessment_version = $2::bigint");
    expect(advance.sql).toContain("and latest_assessment_version =");
    expect(advance.params).toContain("1");
    expect(advance.params).toContain("2");
  });

  it("keeps the materialization fact digest independent of clear subject and authority token", () => {
    const first = sourceIdentitySnapshot();
    const second = inboxV2SourceExternalIdentitySchema.parse({
      ...first,
      canonicalExternalSubject: "Another-Clear-Provider-Subject",
      materializationAuthority: {
        ...first.materializationAuthority,
        authorizationToken: "another-materialization-secret"
      }
    });
    const firstFact = calculateInboxV2SourceIdentitySubjectlessFact(first);
    const secondFact = calculateInboxV2SourceIdentitySubjectlessFact(second);

    expect(secondFact).toEqual(firstFact);
    const serialized = JSON.stringify(firstFact);
    expect(serialized).not.toContain(first.canonicalExternalSubject);
    expect(serialized).not.toContain(
      first.materializationAuthority.authorizationToken
    );
  });

  it("reads one exact historical assessment by its operation ID and idempotency pair", async () => {
    const assessmentId = "source_identity_assessment:src004-unit-2";
    const idempotencyKey = `source:v2:identity-resolution:${"c".repeat(64)}`;
    const lookup = renderQuery(
      buildFindInboxV2SourceIdentityAssessmentByOperationSql({
        tenantId,
        assessmentId,
        idempotencyKey
      })
    );
    expect(lookup.sql).toContain(
      "from public.inbox_v2_source_identity_assessments"
    );
    expect(lookup.sql).toContain("id = $2");
    expect(lookup.sql).toContain("idempotency_key = $3");
    expect(lookup.params).toEqual([tenantId, assessmentId, idempotencyKey]);

    const repository = createSqlInboxV2SourceIdentityResolutionRepository(
      new QueueExecutor([[assessmentRow()]]) as never
    );
    await expect(
      repository.findAssessmentByOperation({
        tenantId,
        assessmentId,
        idempotencyKey
      })
    ).resolves.toMatchObject({
      assessmentId,
      idempotencyKey,
      normalizedEventId,
      assessmentVersion: "2"
    });

    const conflicting = createSqlInboxV2SourceIdentityResolutionRepository(
      new QueueExecutor([
        [assessmentRow({ id: "source_identity_assessment:other" })]
      ]) as never
    );
    await expect(
      conflicting.findAssessmentByOperation({
        tenantId,
        assessmentId,
        idempotencyKey
      })
    ).rejects.toBeInstanceOf(InboxV2PersistenceInvariantError);
  });
});

function normalizedResolutionProjection() {
  const sourceConnection = {
    tenantId,
    kind: "source_connection" as const,
    id: "source_connection:src004-unit"
  };
  const sourceAccount = {
    tenantId,
    kind: "source_account" as const,
    id: "source_account:src004-unit"
  };
  const adapterContract = {
    contractId: "module:synthetic:source-adapter",
    contractVersion: "v1",
    declarationRevision: "1",
    surfaceId: "core:direct-messenger",
    loadedByTrustedServiceId: "core:source-runtime",
    loadedAt: t0
  };
  const threadDeclaration = {
    adapterContract,
    identityKind: "external_thread" as const,
    realmId: "module:synthetic:thread-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:chat",
    scopeKind: "source_account" as const,
    decisionStrength: "safe_default" as const
  };
  const identityDeclaration = {
    adapterContract,
    identityKind: "source_external_identity" as const,
    realmId: "module:synthetic:sender-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:user",
    scopeKind: "source_account" as const,
    decisionStrength: "safe_default" as const
  };
  return {
    tenantId,
    rawInboundEvent: {
      tenantId,
      kind: "raw_inbound_event" as const,
      id: "raw_inbound_event:src004-unit-event"
    },
    normalizedInboundEvent: {
      tenantId,
      kind: "normalized_inbound_event" as const,
      id: normalizedEventId
    },
    sourceConnection,
    sourceAccount,
    domain: "core:inbox-v2.normalized-event-safe-envelope" as const,
    schemaId: "core:inbox-v2.normalized-event-envelope" as const,
    schemaVersion: "v1" as const,
    safeEnvelopeHmacSha256,
    adapterContract,
    thread: {
      sourceConnection,
      sourceAccount,
      identityDeclaration: threadDeclaration,
      key: {
        realm: {
          realmId: "module:synthetic:thread-realm",
          realmVersion: "v1",
          canonicalizationVersion: "v1"
        },
        scope: { kind: "source_account" as const, owner: sourceAccount },
        objectKindId: "module:synthetic:chat",
        canonicalExternalSubject: "Chat-ABC"
      },
      observedExternalSubject: "Chat-ABC"
    },
    identityObservations: [
      {
        observationKey: "author-0001",
        purpose: "message_author" as const,
        identityDeclaration,
        realm: {
          realmId: "module:synthetic:sender-realm",
          realmVersion: "v1",
          canonicalizationVersion: "v1"
        },
        scope: { kind: "source_account" as const, owner: sourceAccount },
        objectKindId: "module:synthetic:user",
        observedExternalSubject: "User-ABC",
        canonicalExternalSubject: "User-ABC",
        stability: "stable" as const,
        observedAt: t0
      }
    ],
    rosterObservation: null,
    recordedAt: t1
  };
}

function preparedAssessment() {
  return {
    input: {
      tenantId,
      normalizedEventId,
      observationKey: "author-0001",
      sourceExternalIdentityId: identityId,
      assessmentId: "source_identity_assessment:src004-unit-2",
      idempotencyKey: `source:v2:identity-resolution:${"c".repeat(64)}`
    },
    observation: normalizedResolutionProjection().identityObservations[0],
    observationDigestSha256: `sha256:${"d".repeat(64)}`,
    safeEnvelopeHmacSha256,
    previousVersion: "1",
    version: "2",
    outcome: "conflicted",
    confidence: "strong",
    evidence: [
      {
        ordinal: 0,
        reference: {
          kind: "normalized_inbound_event",
          reference: {
            tenantId,
            kind: "normalized_inbound_event",
            id: normalizedEventId
          }
        },
        confidence: "strong",
        provenance: {
          kind: "adapter_observation",
          adapterContract: normalizedResolutionProjection().adapterContract,
          observationKey: "author-0001"
        },
        observedAt: t0
      }
    ],
    candidates: [],
    sourceExternalIdentityFact: sourceIdentityFact(),
    assessment: {
      outcome: "conflicted",
      confidence: "strong",
      reason: "contradictory_evidence",
      evidenceOrdinals: [0],
      candidateOrdinals: [0, 1],
      assessedAt: "2026-07-17T08:00:02.000Z"
    },
    assessmentDigestSha256: `sha256:${"e".repeat(64)}`,
    claim: null
  };
}

function assessmentRow(overrides: Record<string, unknown> = {}) {
  const prepared = preparedAssessment();
  return {
    id: prepared.input.assessmentId,
    source_external_identity_id: identityId,
    normalized_event_id: normalizedEventId,
    observation_key: prepared.input.observationKey,
    safe_envelope_hmac_sha256: safeEnvelopeHmacSha256,
    previous_assessment_version: prepared.previousVersion,
    assessment_version: prepared.version,
    outcome: prepared.outcome,
    confidence: prepared.confidence,
    evidence: prepared.evidence,
    candidates: prepared.candidates,
    provenance: {
      schemaId: "core:inbox-v2.source-identity-assessment-provenance",
      schemaVersion: "v2",
      sourceExternalIdentityFact: prepared.sourceExternalIdentityFact,
      assessment: prepared.assessment
    },
    assessment_digest_sha256: prepared.assessmentDigestSha256,
    idempotency_key: prepared.input.idempotencyKey,
    claim_id: null,
    claim_version: null,
    claim_target_kind: null,
    claim_target_employee_id: null,
    claim_target_client_contact_id: null,
    assessed_at: prepared.assessment.assessedAt,
    ...overrides
  };
}

function sourceIdentityFact() {
  return {
    schemaId: "core:inbox-v2.source-identity-materialization-subjectless-fact",
    schemaVersion: "v1",
    materializationDigestSha256: `sha256:${"f".repeat(64)}`,
    identityRevision: "1",
    resolutionStatus: "unresolved",
    latestClaimVersion: null,
    materializedAt: t0,
    identityUpdatedAt: t0
  } as const;
}

function sourceIdentitySnapshot() {
  const event = normalizedResolutionProjection();
  const observation = event.identityObservations[0]!;
  return inboxV2SourceExternalIdentitySchema.parse({
    tenantId,
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
      tenantId,
      trustedServiceId: event.adapterContract.loadedByTrustedServiceId,
      authorizationToken: "materialize-src004-unit",
      authorizedAt: t0
    },
    materializedAt: t0,
    canonicalExternalSubject: observation.canonicalExternalSubject,
    stability: { kind: "stable" },
    resolution: { status: "unresolved" },
    latestClaimVersion: null,
    revision: "1",
    createdAt: t0,
    updatedAt: t0
  });
}

class QueueExecutor implements RawSqlExecutor {
  private readonly queue: readonly (readonly unknown[])[];
  private index = 0;

  constructor(queue: readonly (readonly unknown[])[]) {
    this.queue = queue;
  }

  async execute<Row>(_query: SQL): Promise<RawSqlQueryResult<Row>> {
    const rows = this.queue[this.index++] ?? [];
    return { rows: rows as readonly Row[] };
  }
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  const rendered = new PgDialect().sqlToQuery(query);
  return { sql: rendered.sql, params: rendered.params };
}
