import {
  calculateInboxV2CanonicalSha256,
  calculateInboxV2RawIngressLeaseTokenHash,
  defineInboxV2SourceNormalizer,
  defineInboxV2SourceNormalizerProfile,
  executeInboxV2SourceNormalizer,
  inboxV2EntityRevisionSchema,
  inboxV2RawIngressWorkerIdSchema,
  type InboxV2CompleteSourceNormalizationInput,
  type InboxV2SourceNormalizationCandidateBatch,
  type InboxV2SourceNormalizedEventDraft,
  type InboxV2SourceNormalizerDecision
} from "@hulee/contracts";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  InboxV2SourceNormalizationPersistenceInvariantError,
  createSqlInboxV2SourceNormalizationRepository,
  type InboxV2SourceNormalizationTransactionExecutor
} from "./sql-inbox-v2-source-normalization-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const t0 = "2026-07-16T08:00:00.000Z";
const dbNow = "2026-07-16T08:00:10.000Z";
const leaseClaimedAt = "2026-07-16T07:59:00.000Z";
const leaseExpiresAt = "2026-07-16T08:10:00.000Z";
const tenantId = "tenant:alpha";
const rawEventId = "raw_inbound_event:raw-1";
const sourceConnectionId = "source_connection:synthetic-1";
const sourceAccountId = "source_account:synthetic-1";
const normalizedEventId = "normalized_inbound_event:normalized-1";
const workerId = inboxV2RawIngressWorkerIdSchema.parse(
  "core:source-normalization-worker"
);
const expectedLeaseRevision = inboxV2EntityRevisionSchema.parse("1");
const leaseToken = "normalization-lease-token-00000000000000000001";
const quarantineId = "core:source-normalization-quarantine-test";
const classifiedSentinel = "classified-message-content";

const adapterContract = {
  contractId: "module:synthetic:source-adapter",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "core:direct-messenger",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: t0
} as const;

const rawIngressSanitizer = {
  profileSchemaId: "core:inbox-v2.raw-ingress-sanitizer-profile",
  profileSchemaVersion: "v1",
  handlerId: "module:synthetic:sanitize",
  handlerVersion: "v1",
  declarationRevision: "1",
  restrictedPayloadSchema: {
    schemaId: "module:synthetic:raw-event",
    schemaVersion: "v1"
  }
} as const;

describe("SQL Inbox V2 source-normalization repository", () => {
  it("rejects a schema-valid clone before reading or opening a transaction", async () => {
    const candidate = await emittedCandidate();
    const executor = new StatefulNormalizationExecutor();
    const repository = repositoryFor(executor);

    await expect(
      repository.complete({
        candidate: structuredClone(candidate),
        workerId,
        leaseToken,
        expectedLeaseRevision
      })
    ).rejects.toThrow("authentic candidate batch");
    expect(executor.queries).toHaveLength(0);
    expect(executor.transactionCalls).toBe(0);
  });

  it("loads only the exact persisted provider evidence under the active lease fence", async () => {
    const candidate = await emittedCandidate();
    const executor = new StatefulNormalizationExecutor();
    const repository = repositoryFor(executor);
    const input = {
      tenantId: candidate.tenantId,
      rawEventId: candidate.rawEventId,
      workerId,
      leaseToken,
      expectedLeaseRevision
    } as const;

    const loaded = await repository.loadClaimedInput(input);
    expect(loaded).toMatchObject({
      outcome: "loaded",
      sourceTypeId: "core:messenger",
      sourceName: "telegram",
      raw: {
        tenantId,
        rawEventId,
        sourceConnectionId,
        sourceAccountId,
        transport: "webhook",
        providerOccurredAt: t0,
        restrictedPayload: { eventId: "provider-event-1" }
      }
    });
    if (loaded.outcome !== "loaded") throw new Error("Expected loaded input.");
    expect(Object.isFrozen(loaded.raw)).toBe(true);
    expect(Object.isFrozen(loaded.raw.restrictedPayload)).toBe(true);

    executor.work!.restricted_payload = { eventId: "tampered" };
    await expect(repository.loadClaimedInput(input)).resolves.toEqual({
      outcome: "evidence_unavailable",
      tenantId,
      rawEventId,
      reasonCode: "source.evidence_unavailable"
    });
  });

  it("atomically writes empty legacy anchors, protected envelopes/evidence and an exact retry result", async () => {
    const candidate = await emittedCandidate();
    const executor = new StatefulNormalizationExecutor();
    const repository = repositoryFor(executor);

    const completed = await repository.complete(completeInput(candidate));
    expect(completed).toMatchObject({
      outcome: "completed",
      completion: {
        tenantId,
        rawEventId,
        outcome: "normalized",
        normalizedEventIds: [normalizedEventId],
        quarantineId: null,
        completedAt: dbNow
      }
    });
    if (completed.outcome !== "completed") throw new Error("fixture invariant");
    expect(completed.completion.orderedEventHmacSha256).toMatch(
      /^hmac-sha256:[a-f0-9]{64}$/u
    );
    expect(completed.completion.candidateCompletionHmacSha256).toMatch(
      /^hmac-sha256:[a-f0-9]{64}$/u
    );

    const anchor = executor.oneQuery(
      "insert into public.normalized_inbound_events"
    );
    expect(anchor.sql).toContain("null, null, null");
    expect(anchor.sql).toContain("'{}'::jsonb, '{}'::jsonb");
    expect(anchor.sql).toContain("'ignored'");
    expect(anchor.params).not.toContain(classifiedSentinel);

    const envelope = executor.oneQuery(
      "insert into public.inbox_v2_source_normalized_envelopes"
    );
    expect(envelope.params).toContain("messenger");
    expect(envelope.params).toContain("telegram");
    expect(envelope.params).not.toContain(classifiedSentinel);
    expect(
      envelope.params.filter(
        (value) => typeof value === "string" && value.startsWith("hmac-sha256:")
      ).length
    ).toBeGreaterThanOrEqual(2);
    expect(
      envelope.params.some(
        (value) =>
          typeof value === "string" &&
          value.includes(
            '"domain":"core:inbox-v2.normalized-event-safe-envelope"'
          )
      )
    ).toBe(true);

    const evidenceReference = executor.oneQuery(
      "insert into public.inbox_v2_source_normalized_evidence ("
    );
    expect(evidenceReference.params).toContain(
      '["core:source_replay_and_diagnostics"]'
    );
    expect(evidenceReference.params).not.toContainEqual([
      "core:source_replay_and_diagnostics"
    ]);

    const payload = executor.oneQuery(
      "insert into public.inbox_v2_source_normalized_evidence_payloads"
    );
    expect(JSON.stringify(payload.params)).toContain(classifiedSentinel);
    expect(payload.params).toContain(
      JSON.stringify({ text: classifiedSentinel })
    );
    expect(
      executor.oneQuery("delete from public.inbox_v2_source_raw_work_items")
    ).toBeDefined();
    expect(executor.oneQuery("set constraints all immediate")).toBeDefined();
    expect(executor.transactionCalls).toBe(1);

    executor.evidencePayloadPresent = false;
    const queryCountBeforeRetry = executor.queries.length;
    const replay = await repository.complete(completeInput(candidate));
    expect(replay).toEqual({
      outcome: "already_completed",
      completion: completed.completion
    });
    const retryQueries = executor.queries.slice(queryCountBeforeRetry);
    expect(
      retryQueries.some((query) =>
        query.sql.includes("source_normalized_evidence_payloads")
      )
    ).toBe(false);
    expect(executor.normalizedEventIds).toEqual([normalizedEventId]);
  });

  it("fails closed when an authentic retry changes classified evidence content", async () => {
    const originalCandidate = await emittedCandidate();
    const executor = new StatefulNormalizationExecutor();
    const repository = repositoryFor(executor);
    const completed = await repository.complete(
      completeInput(originalCandidate)
    );
    const originalCompletion = structuredClone(executor.completion);
    const originalEventIds = [...executor.normalizedEventIds];
    const queryCountBeforeMismatch = executor.queries.length;

    const changedEvidenceCandidate = await emittedCandidate({
      evidenceText: "different-classified-message-content"
    });
    await expect(
      repository.complete(completeInput(changedEvidenceCandidate))
    ).rejects.toBeInstanceOf(
      InboxV2SourceNormalizationPersistenceInvariantError
    );

    expect(completed.outcome).toBe("completed");
    expect(executor.completion).toEqual(originalCompletion);
    expect(executor.normalizedEventIds).toEqual(originalEventIds);
    expect(
      executor.queries
        .slice(queryCountBeforeMismatch)
        .some((query) => /^(?:insert|update|delete) /u.test(query.sql))
    ).toBe(false);
  });

  it("quarantines a same server key with a different raw scope and never returns or inserts the unrelated row", async () => {
    const candidate = await emittedCandidate();
    const executor = new StatefulNormalizationExecutor({ collision: true });
    const repository = repositoryFor(executor);

    const result = await repository.complete(completeInput(candidate));

    expect(result).toEqual({
      outcome: "quarantined",
      quarantineId,
      reasonCode: "source.idempotency_collision"
    });
    expect(
      executor.queries.some((query) =>
        query.sql.includes("insert into public.normalized_inbound_events")
      )
    ).toBe(false);
    expect(
      executor.oneQuery(
        "insert into public.inbox_v2_source_normalized_quarantines"
      )
    ).toBeDefined();
    expect(executor.completion?.outcome).toBe("quarantined");
    expect(executor.work).toBeNull();
  });

  it("fails closed for forced same-key raw, account, event-type and digest collision dimensions", async () => {
    const candidate = await emittedCandidate();
    const baseline = new StatefulNormalizationExecutor();
    await repositoryFor(baseline).complete(completeInput(candidate));
    const envelopeHmacs = baseline
      .oneQuery("insert into public.inbox_v2_source_normalized_envelopes")
      .params.filter(
        (value): value is string =>
          typeof value === "string" && value.startsWith("hmac-sha256:")
      );
    const exactSafeEnvelopeHmac = envelopeHmacs.at(-1);
    if (exactSafeEnvelopeHmac === undefined) {
      throw new Error("Expected a persisted safe-envelope HMAC fixture.");
    }
    const exactAccountScope = `1:${Buffer.byteLength(
      sourceAccountId,
      "utf8"
    )}:${sourceAccountId}`;
    const variants: readonly Readonly<{
      label: string;
      collision: ForcedCollision;
    }>[] = [
      {
        label: "raw event",
        collision: {
          rawEventId: "raw_inbound_event:forced-unrelated",
          sourceAccountScopeKey: exactAccountScope,
          eventType: "message_created",
          safeEnvelopeHmacSha256: exactSafeEnvelopeHmac
        }
      },
      {
        label: "source account",
        collision: {
          rawEventId,
          sourceAccountScopeKey: "1:31:source_account:forced-unrelated",
          eventType: "message_created",
          safeEnvelopeHmacSha256: exactSafeEnvelopeHmac
        }
      },
      {
        label: "event type",
        collision: {
          rawEventId,
          sourceAccountScopeKey: exactAccountScope,
          eventType: "message_edited",
          safeEnvelopeHmacSha256: exactSafeEnvelopeHmac
        }
      },
      {
        label: "safe envelope digest",
        collision: {
          rawEventId,
          sourceAccountScopeKey: exactAccountScope,
          eventType: "message_created",
          safeEnvelopeHmacSha256: `hmac-sha256:${"f".repeat(64)}`
        }
      }
    ];

    for (const variant of variants) {
      const executor = new StatefulNormalizationExecutor({
        collision: variant.collision
      });
      await expect(
        repositoryFor(executor).complete(completeInput(candidate)),
        variant.label
      ).resolves.toEqual({
        outcome: "quarantined",
        quarantineId,
        reasonCode: "source.idempotency_collision"
      });
      expect(
        executor.queries.some((query) =>
          query.sql.includes("insert into public.normalized_inbound_events")
        ),
        variant.label
      ).toBe(false);
    }
  });

  it("closes an ignored candidate without inventing a normalized event", async () => {
    const candidate = await ignoredCandidate();
    const executor = new StatefulNormalizationExecutor({
      rawPayloadDigestSha256: candidate.restrictedPayloadDigestSha256
    });
    const result = await repositoryFor(executor).complete(
      completeInput(candidate)
    );

    expect(result).toMatchObject({
      outcome: "completed",
      completion: {
        outcome: "ignored",
        normalizedEventIds: [],
        quarantineId: null
      }
    });
    expect(executor.normalizedEventIds).toEqual([]);
    expect(
      executor.queries.some((query) =>
        query.sql.includes("insert into public.normalized_inbound_events")
      )
    ).toBe(false);
    const completion = executor.oneQuery(
      "insert into public.inbox_v2_source_normalization_results"
    );
    expect(completion.params).toContain("source.event_not_actionable");
    expect(executor.work).toBeNull();
  });

  it("fails closed on source-scope drift and classifies stale and expired leases without writes", async () => {
    const candidate = await emittedCandidate();
    const scopeDrift = new StatefulNormalizationExecutor();
    scopeDrift.work = {
      ...scopeDrift.work!,
      source_connection_id: "source_connection:other"
    };
    await expect(
      repositoryFor(scopeDrift).complete(completeInput(candidate))
    ).rejects.toBeInstanceOf(
      InboxV2SourceNormalizationPersistenceInvariantError
    );
    expect(scopeDrift.hasWrite()).toBe(false);

    const stale = new StatefulNormalizationExecutor();
    const staleResult = await repositoryFor(stale).complete({
      ...completeInput(candidate),
      leaseToken: "different-lease-token-000000000000000000000001"
    });
    expect(staleResult).toEqual({
      outcome: "stale_token",
      tenantId,
      rawEventId,
      currentLeaseRevision: "1"
    });
    expect(stale.hasWrite()).toBe(false);

    const expired = new StatefulNormalizationExecutor();
    expired.work = {
      ...expired.work!,
      lease_expires_at: "2026-07-16T08:00:09.000Z"
    };
    const expiredResult = await repositoryFor(expired).complete(
      completeInput(candidate)
    );
    expect(expiredResult).toEqual({
      outcome: "lease_expired",
      tenantId,
      rawEventId,
      currentLeaseRevision: "1",
      expiredAt: "2026-07-16T08:00:09.000Z"
    });
    expect(expired.hasWrite()).toBe(false);
  });

  it("retries the whole transaction on 40001 and rolls every partial write back on a terminal failure", async () => {
    const candidate = await emittedCandidate();
    const retrying = new StatefulNormalizationExecutor({
      failOnce: {
        marker: "clock_timestamp() as db_now",
        error: Object.assign(new Error("serialization"), { code: "40001" })
      }
    });
    const completed = await repositoryFor(retrying).complete(
      completeInput(candidate)
    );
    expect(completed.outcome).toBe("completed");
    expect(retrying.transactionCalls).toBe(2);
    expect(retrying.normalizedEventIds).toEqual([normalizedEventId]);

    const rollback = new StatefulNormalizationExecutor({
      failOnce: {
        marker:
          "insert into public.inbox_v2_source_normalized_evidence_payloads",
        error: new Error("injected terminal persistence failure")
      }
    });
    await expect(
      repositoryFor(rollback).complete(completeInput(candidate))
    ).rejects.toThrow("injected terminal persistence failure");
    expect(rollback.work).not.toBeNull();
    expect(rollback.normalizedEventIds).toEqual([]);
    expect(rollback.completion).toBeNull();
  });
});

function repositoryFor(executor: StatefulNormalizationExecutor) {
  return createSqlInboxV2SourceNormalizationRepository(executor, {
    normalizationDigestKeySource: ({ keyGeneration }) => ({
      keyGeneration: keyGeneration ?? "normalization-key-g1",
      key: new Uint8Array(32).fill(0x5a)
    }),
    normalizedEventIdSource: () => normalizedEventId,
    quarantineIdSource: () => quarantineId
  });
}

function completeInput(candidate: InboxV2SourceNormalizationCandidateBatch) {
  return {
    candidate,
    workerId,
    leaseToken,
    expectedLeaseRevision
  } satisfies InboxV2CompleteSourceNormalizationInput;
}

async function emittedCandidate(
  rawOverrides: Readonly<{
    rawEventId?: string;
    sourceConnectionId?: string;
    sourceAccountId?: string;
    evidenceText?: string;
  }> = {}
): Promise<InboxV2SourceNormalizationCandidateBatch> {
  const profile = defineInboxV2SourceNormalizerProfile(profileInput());
  const normalizer = defineInboxV2SourceNormalizer({
    profile,
    parseRestrictedPayload: (value) => value,
    evidenceParsers: {
      "module:synthetic:message-content": (value) => value
    },
    handler: () =>
      emitted(messageEvent(rawOverrides.evidenceText ?? classifiedSentinel))
  });
  return executeInboxV2SourceNormalizer({
    normalizer,
    raw: {
      tenantId,
      rawEventId: rawOverrides.rawEventId ?? rawEventId,
      sourceConnectionId: rawOverrides.sourceConnectionId ?? sourceConnectionId,
      sourceAccountId: rawOverrides.sourceAccountId ?? sourceAccountId,
      transport: "webhook",
      providerOccurredAt: t0,
      rawIngressSanitizer,
      restrictedPayload: { eventId: "provider-event-1" }
    }
  });
}

async function ignoredCandidate(): Promise<InboxV2SourceNormalizationCandidateBatch> {
  const profile = defineInboxV2SourceNormalizerProfile(profileInput());
  const normalizer = defineInboxV2SourceNormalizer({
    profile,
    parseRestrictedPayload: (value) => value,
    evidenceParsers: {
      "module:synthetic:message-content": (value) => value
    },
    handler: () => ({
      outcome: "ignored",
      reasonCode: "source.event_not_actionable"
    })
  });
  return executeInboxV2SourceNormalizer({
    normalizer,
    raw: {
      tenantId,
      rawEventId,
      sourceConnectionId,
      sourceAccountId,
      transport: "webhook",
      providerOccurredAt: t0,
      rawIngressSanitizer,
      restrictedPayload: { eventId: "provider-event-ignored" }
    }
  });
}

function profileInput() {
  const declarations = [
    threadDeclaration(),
    messageDeclaration(),
    senderDeclaration()
  ].sort((left, right) =>
    String(calculateInboxV2CanonicalSha256(left)).localeCompare(
      String(calculateInboxV2CanonicalSha256(right))
    )
  );
  return {
    schemaId: "core:inbox-v2.source-normalizer-profile" as const,
    schemaVersion: "v1" as const,
    payload: {
      adapterContract,
      handlerId: "module:synthetic:normalize",
      handlerVersion: "v1",
      declarationRevision: "1",
      rawIngressSanitizer,
      eventKinds: ["message_created" as const],
      identityDeclarations: declarations,
      evidenceSlots: [
        {
          slotId: "module:synthetic:message-content",
          schemaId: "module:synthetic:message-content",
          schemaVersion: "v1",
          dataClassId: "core:normalized_event_payload" as const,
          purposeIds: ["core:source_replay_and_diagnostics" as const]
        }
      ]
    }
  };
}

function messageEvent(evidenceText: string): InboxV2SourceNormalizedEventDraft {
  return {
    direction: "inbound",
    visibility: "public",
    payloadVersion: "v1",
    providerOccurredAt: t0,
    semantic: {
      kind: "message_created",
      originKind: "webhook",
      authorObservationKey: "author-0001"
    },
    thread: {
      identityDeclaration: threadDeclaration(),
      key: {
        realm: {
          realmId: "module:synthetic:thread-realm",
          realmVersion: "v1",
          canonicalizationVersion: "v1"
        },
        scope: { kind: "source_account", owner: sourceAccountReference() },
        objectKindId: "module:synthetic:chat",
        canonicalExternalSubject: "Chat-ABC"
      },
      observedExternalSubject: "Chat-ABC"
    },
    message: {
      identityDeclaration: messageDeclaration(),
      realm: {
        realmId: "module:synthetic:message-realm",
        realmVersion: "v1",
        canonicalizationVersion: "v1"
      },
      scope: { kind: "source_account", owner: sourceAccountReference() },
      objectKindId: "module:synthetic:message",
      observedExternalSubject: "Message-ABC",
      canonicalExternalSubject: "Message-ABC"
    },
    identityObservations: [
      {
        observationKey: "author-0001",
        purpose: "message_author",
        identityDeclaration: senderDeclaration(),
        realm: {
          realmId: "module:synthetic:sender-realm",
          realmVersion: "v1",
          canonicalizationVersion: "v1"
        },
        scope: { kind: "source_account", owner: sourceAccountReference() },
        objectKindId: "module:synthetic:user",
        observedExternalSubject: "User-ABC",
        canonicalExternalSubject: "User-ABC",
        stability: "stable",
        observedAt: t0
      }
    ],
    rosterObservation: null,
    capabilityObservation: {
      schemaId: "module:synthetic:capabilities",
      schemaVersion: "v1",
      capabilities: []
    },
    evidence: [
      {
        slotId: "module:synthetic:message-content",
        value: { text: evidenceText }
      }
    ]
  };
}

function emitted(
  event: InboxV2SourceNormalizedEventDraft
): InboxV2SourceNormalizerDecision {
  return { outcome: "emitted", events: [event] };
}

function sourceAccountReference() {
  return { tenantId, kind: "source_account" as const, id: sourceAccountId };
}

function threadDeclaration() {
  return {
    adapterContract,
    identityKind: "external_thread" as const,
    realmId: "module:synthetic:thread-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:chat",
    scopeKind: "source_account" as const,
    decisionStrength: "safe_default" as const
  };
}

function messageDeclaration() {
  return {
    adapterContract,
    identityKind: "message" as const,
    realmId: "module:synthetic:message-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:message",
    scopeKind: "source_account" as const,
    decisionStrength: "safe_default" as const
  };
}

function senderDeclaration() {
  return {
    adapterContract,
    identityKind: "source_external_identity" as const,
    realmId: "module:synthetic:sender-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic:user",
    scopeKind: "source_account" as const,
    decisionStrength: "safe_default" as const
  };
}

type QueryRecord = Readonly<{
  sql: string;
  params: unknown[];
  inTransaction: boolean;
}>;

type StoredCompletion = Readonly<{
  outcome: "normalized" | "ignored" | "quarantined";
  quarantine_id: string | null;
  digest_key_generation: string;
  ordered_event_hmac_sha256: string;
  candidate_completion_hmac_sha256: string;
  result_hmac_sha256: string;
  completed_at: string;
}>;

type ForcedCollision = Readonly<{
  rawEventId: string;
  sourceAccountScopeKey: string;
  eventType: string;
  safeEnvelopeHmacSha256: string;
}>;

class StatefulNormalizationExecutor implements InboxV2SourceNormalizationTransactionExecutor {
  readonly queries: QueryRecord[] = [];
  transactionCalls = 0;
  inTransaction = false;
  normalizedEventIds: string[] = [];
  evidencePayloadPresent = true;
  completion: StoredCompletion | null = null;
  work: Record<string, unknown> | null;
  private readonly collision: true | ForcedCollision | null;
  private readonly rawPayloadDigestSha256: string;
  private failOnce: Readonly<{ marker: string; error: Error }> | null;

  constructor(
    options: Readonly<{
      collision?: true | ForcedCollision;
      rawPayloadDigestSha256?: string;
      failOnce?: Readonly<{ marker: string; error: Error }>;
    }> = {}
  ) {
    this.collision = options.collision ?? null;
    this.rawPayloadDigestSha256 =
      options.rawPayloadDigestSha256 ??
      calculateInboxV2CanonicalSha256({ eventId: "provider-event-1" });
    this.failOnce = options.failOnce ?? null;
    this.work = this.initialWork();
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config?: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    expect(config).toEqual({ isolationLevel: "read committed" });
    this.transactionCalls += 1;
    const snapshot = {
      work: this.work === null ? null : structuredClone(this.work),
      normalizedEventIds: [...this.normalizedEventIds],
      completion: this.completion === null ? null : { ...this.completion },
      evidencePayloadPresent: this.evidencePayloadPresent
    };
    this.inTransaction = true;
    try {
      return await work(this);
    } catch (error) {
      this.work = snapshot.work;
      this.normalizedEventIds = snapshot.normalizedEventIds;
      this.completion = snapshot.completion;
      this.evidencePayloadPresent = snapshot.evidencePayloadPresent;
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  async execute<Row extends Record<string, unknown>>(
    query: Parameters<RawSqlExecutor["execute"]>[0]
  ): Promise<RawSqlQueryResult<Row>> {
    const rendered = new PgDialect().sqlToQuery(query);
    const statement = rendered.sql.replace(/\s+/gu, " ").trim();
    const params = [...rendered.params];
    const respond = (
      values: readonly Record<string, unknown>[]
    ): RawSqlQueryResult<Row> => ({
      rows: values as readonly Row[]
    });
    this.queries.push({
      sql: statement,
      params,
      inTransaction: this.inTransaction
    });
    if (this.failOnce !== null && statement.includes(this.failOnce.marker)) {
      const error = this.failOnce.error;
      this.failOnce = null;
      throw error;
    }

    if (
      statement.includes("select result.digest_key_generation") &&
      !statement.includes("result.outcome::text")
    ) {
      return respond(
        this.completion === null
          ? []
          : [{ digest_key_generation: this.completion.digest_key_generation }]
      );
    }
    if (
      statement.includes("clock_timestamp() as db_now") &&
      statement.includes("work.state::text as state")
    ) {
      return respond(this.work === null ? [] : [this.work]);
    }
    if (
      statement.includes("select clock_timestamp() as db_now") &&
      statement.includes("work.state = 'leased'")
    ) {
      return respond(this.work === null ? [] : [{ db_now: dbNow }]);
    }
    if (
      statement.includes("select raw.source_connection_id") &&
      !statement.includes("clock_timestamp()")
    ) {
      return respond([this.rawScope()]);
    }
    if (statement.includes("select result.outcome::text as outcome")) {
      return respond(this.completion === null ? [] : [this.completion]);
    }
    if (
      statement.includes("select envelope.normalized_event_id") &&
      !statement.includes("for update")
    ) {
      return respond(
        this.normalizedEventIds.map((id) => ({ normalized_event_id: id }))
      );
    }
    if (statement.includes("pg_advisory_xact_lock")) return respond([]);
    if (
      statement.includes(
        "from public.inbox_v2_source_normalized_envelopes envelope"
      ) &&
      statement.includes("idempotency_key in")
    ) {
      return respond(
        this.collision === null ? [] : [this.collisionRow(params)]
      );
    }
    if (
      statement.includes(
        "from public.inbox_v2_source_normalized_envelopes envelope"
      ) &&
      statement.includes("normalized_ordinal in")
    ) {
      return respond([]);
    }
    if (statement.includes("insert into public.normalized_inbound_events")) {
      const id = requiredParam(params, normalizedEventId);
      this.normalizedEventIds = [String(id)];
      return respond([{ id }]);
    }
    if (
      statement.includes(
        "insert into public.inbox_v2_source_normalized_envelopes"
      )
    ) {
      return respond([{ id: requiredParam(params, normalizedEventId) }]);
    }
    if (
      statement.includes(
        "insert into public.inbox_v2_source_normalized_evidence ("
      )
    ) {
      return respond([{ id: evidenceKeyParam(params) }]);
    }
    if (
      statement.includes(
        "insert into public.inbox_v2_source_normalized_evidence_payloads"
      )
    ) {
      this.evidencePayloadPresent = true;
      return respond([{ id: evidenceKeyParam(params) }]);
    }
    if (
      statement.includes(
        "insert into public.inbox_v2_source_normalized_quarantines"
      )
    ) {
      return respond([{ id: requiredParam(params, quarantineId) }]);
    }
    if (
      statement.includes(
        "from public.inbox_v2_source_normalized_quarantines quarantine"
      )
    ) {
      return respond([{ id: quarantineId }]);
    }
    if (
      statement.includes(
        "insert into public.inbox_v2_source_normalization_results"
      )
    ) {
      const hmacs = params.filter(
        (value): value is string =>
          typeof value === "string" && value.startsWith("hmac-sha256:")
      );
      const outcome = params.find(
        (value) =>
          value === "normalized" ||
          value === "ignored" ||
          value === "quarantined"
      ) as StoredCompletion["outcome"] | undefined;
      if (outcome === undefined || hmacs.length !== 3) {
        throw new Error("Unexpected completion SQL parameters.");
      }
      this.completion = {
        outcome,
        quarantine_id: params.includes(quarantineId) ? quarantineId : null,
        digest_key_generation: "normalization-key-g1",
        ordered_event_hmac_sha256: hmacs[0]!,
        candidate_completion_hmac_sha256: hmacs[1]!,
        result_hmac_sha256: hmacs[2]!,
        completed_at: dbNow
      };
      return respond([{ id: rawEventId }]);
    }
    if (
      statement.includes("delete from public.inbox_v2_source_raw_work_items")
    ) {
      this.work = null;
      return respond([{ id: rawEventId }]);
    }
    if (statement.includes("set constraints all immediate")) return respond([]);
    throw new Error(`Unexpected SQL in normalization fake: ${statement}`);
  }

  oneQuery(marker: string): QueryRecord {
    const matches = this.queries.filter((query) => query.sql.includes(marker));
    expect(matches, `query marker ${marker}`).toHaveLength(1);
    return matches[0]!;
  }

  hasWrite(): boolean {
    return this.queries.some((query) =>
      /^(?:insert|update|delete) /u.test(query.sql)
    );
  }

  private initialWork(): Record<string, unknown> {
    return {
      db_now: dbNow,
      state: "leased",
      attempt_count: "1",
      lease_owner_id: workerId,
      lease_token_hash: calculateInboxV2RawIngressLeaseTokenHash(leaseToken),
      lease_revision: "1",
      lease_claimed_at: leaseClaimedAt,
      lease_expires_at: leaseExpiresAt,
      reclaim_count: "0",
      revision: "2",
      updated_at: leaseClaimedAt,
      provider_timestamp: t0,
      restricted_payload: { eventId: "provider-event-1" },
      ...this.rawScope()
    };
  }

  private rawScope(): Record<string, unknown> {
    return {
      source_connection_id: sourceConnectionId,
      source_account_id: sourceAccountId,
      source_account_scope_key: `1:${Buffer.byteLength(
        sourceAccountId,
        "utf8"
      )}:${sourceAccountId}`,
      transport_kind: "webhook",
      sanitizer_id: rawIngressSanitizer.handlerId,
      sanitizer_version: rawIngressSanitizer.handlerVersion,
      sanitizer_declaration_revision: rawIngressSanitizer.declarationRevision,
      raw_payload_digest_sha256: this.rawPayloadDigestSha256,
      raw_payload_schema_id:
        rawIngressSanitizer.restrictedPayloadSchema.schemaId,
      raw_payload_schema_version:
        rawIngressSanitizer.restrictedPayloadSchema.schemaVersion,
      source_type: "messenger",
      source_name: "telegram"
    };
  }

  private collisionRow(params: unknown[]): Record<string, unknown> {
    const key = params.find(
      (value): value is string =>
        typeof value === "string" && value.startsWith("source:v2:normalized:")
    );
    if (key === undefined) throw new Error("Missing normalized key parameter.");
    const collision =
      this.collision === true
        ? {
            rawEventId: "raw_inbound_event:unrelated",
            sourceAccountScopeKey: String(
              this.rawScope().source_account_scope_key
            ),
            eventType: "message_created",
            safeEnvelopeHmacSha256: `hmac-sha256:${"f".repeat(64)}`
          }
        : this.collision;
    if (collision === null) {
      throw new Error("Missing forced collision fixture.");
    }
    return {
      normalized_event_id: "normalized_inbound_event:existing-unrelated",
      raw_event_id: collision.rawEventId,
      source_connection_id: sourceConnectionId,
      source_account_scope_key: collision.sourceAccountScopeKey,
      normalized_ordinal: 0,
      idempotency_key: key,
      event_type: collision.eventType,
      digest_key_generation: "normalization-key-g1",
      safe_envelope_hmac_sha256: collision.safeEnvelopeHmacSha256,
      normalizer_id: "module:synthetic:normalize",
      normalizer_version: "v1",
      normalizer_declaration_revision: "1"
    };
  }
}

function requiredParam(params: unknown[], expected: string): unknown {
  const value = params.find((candidate) => candidate === expected);
  if (value === undefined)
    throw new Error(`Missing SQL parameter ${expected}.`);
  return value;
}

function evidenceKeyParam(params: unknown[]): string {
  const value = params.find(
    (candidate): candidate is string =>
      typeof candidate === "string" &&
      candidate.startsWith("core:normalized-event-evidence.")
  );
  if (value === undefined) throw new Error("Missing evidence key parameter.");
  return value;
}
