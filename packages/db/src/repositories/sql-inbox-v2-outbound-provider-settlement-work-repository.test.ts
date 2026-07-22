import {
  INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_EFFECT_DISPOSITION,
  calculateInboxV2OutboundProviderSourceOccurrenceDetailDigest,
  deriveInboxV2OutboundDispatchArtifactId,
  deriveInboxV2OutboundProviderObservationId,
  inboxV2OutboundDispatchArtifactSchema,
  inboxV2OutboundProviderObservationSchema,
  inboxV2SourceOccurrenceSchema,
  type InboxV2OutboundProviderObservation
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  calculateInboxV2OutboundProviderSettlementLeaseTokenHash,
  claimInboxV2OutboundProviderSettlementWorkInTransaction,
  enqueueInboxV2OutboundProviderSettlementWorkInTransaction,
  finalizeInboxV2OutboundProviderSettlementWorkInTransaction,
  lockInboxV2OutboundProviderSettlementWorkLeaseInTransaction
} from "./sql-inbox-v2-outbound-provider-settlement-work-repository";
import {
  createOutboundTransportContractFixture,
  OUTBOUND_TEST_TIMES
} from "./sql-inbox-v2-outbound-transport-repository.test-support";
import type { RawSqlExecutor } from "./sql-outbox-repository";

const fixture = createOutboundTransportContractFixture({
  suffix: "settlement-work"
});
const observation = providerEchoObservation();
const enqueueInput = {
  observation,
  candidateExternalMessageReferenceId:
    "external_message_reference:settlement-work",
  candidateTransportLinkId: "message_transport_occurrence_link:settlement-work"
} as const;
const workerId = "core:settlement-worker";
const leaseToken = `settlement-lease:${"a".repeat(40)}`;
const leaseTokenHash =
  calculateInboxV2OutboundProviderSettlementLeaseTokenHash(leaseToken);

describe("Inbox V2 outbound provider settlement durable work", () => {
  it("enqueues an exact observation handoff inside the caller transaction", async () => {
    const executor = new ScriptedExecutor(() => [
      { observation_id: observation.id }
    ]);

    await expect(
      enqueueInboxV2OutboundProviderSettlementWorkInTransaction(
        executor,
        enqueueInput
      )
    ).resolves.toEqual({ kind: "committed" });

    const query = render(executor.queries[0]!);
    expect(normalize(query.sql)).toContain(
      "insert into inbox_v2_outbound_provider_settlement_work_items"
    );
    expect(query.params).toEqual(
      expect.arrayContaining([
        observation.id,
        enqueueInput.candidateExternalMessageReferenceId,
        enqueueInput.candidateTransportLinkId,
        observation.observedByTrustedServiceId
      ])
    );
  });

  it("accepts an exact enqueue replay but rejects a transport-link collision", async () => {
    const exact = new ScriptedExecutor((index) =>
      index === 0
        ? []
        : [
            {
              observation_id: observation.id,
              candidate_external_message_reference_id:
                enqueueInput.candidateExternalMessageReferenceId,
              candidate_transport_link_id:
                enqueueInput.candidateTransportLinkId,
              trusted_service_id: observation.observedByTrustedServiceId,
              created_at: new Date(observation.recordedAt)
            }
          ]
    );
    await expect(
      enqueueInboxV2OutboundProviderSettlementWorkInTransaction(
        exact,
        enqueueInput
      )
    ).resolves.toEqual({ kind: "already_exists" });

    const collision = new ScriptedExecutor((index) =>
      index === 0
        ? []
        : [
            {
              observation_id: "outbound_provider_observation:other",
              candidate_external_message_reference_id:
                enqueueInput.candidateExternalMessageReferenceId,
              candidate_transport_link_id:
                enqueueInput.candidateTransportLinkId,
              trusted_service_id: observation.observedByTrustedServiceId,
              created_at: new Date(observation.recordedAt)
            }
          ]
    );
    await expect(
      enqueueInboxV2OutboundProviderSettlementWorkInTransaction(
        collision,
        enqueueInput
      )
    ).resolves.toEqual({ kind: "conflict" });
  });

  it("claims due and expired work with SKIP LOCKED and never persists a raw token", async () => {
    const executor = new ScriptedExecutor(() => [claimRow()]);

    await expect(
      claimInboxV2OutboundProviderSettlementWorkInTransaction(
        executor,
        {
          tenantId: fixture.tenantId,
          workerId,
          limit: 1,
          leaseDurationMs: 30_000
        },
        () => leaseToken
      )
    ).resolves.toEqual([
      expect.objectContaining({
        observationId: observation.id,
        workerId,
        leaseToken,
        leaseRevision: "1",
        attemptCount: "1"
      })
    ]);

    const query = render(executor.queries[0]!);
    const statement = normalize(query.sql);
    expect(statement).toContain("for update of work_row skip locked");
    expect(statement).toContain("work_row.state = 'leased'");
    expect(statement).toContain(
      "work_row.lease_expires_at <= claim_clock.claimed_at"
    );
    expect(statement).toContain("lease_token_hash = token.lease_token_hash");
    const tokenParameter = query.params.find(
      (parameter): parameter is string =>
        typeof parameter === "string" && parameter.includes(leaseTokenHash)
    );
    expect(tokenParameter).toBeDefined();
    expect(JSON.parse(tokenParameter!)).toEqual([
      { ordinal: 1, lease_token_hash: leaseTokenHash }
    ]);
    expect(JSON.stringify(query.params)).not.toContain(leaseToken);
  });

  it("rejects a duplicate token batch before touching the database", async () => {
    const executor = new ScriptedExecutor(() => {
      throw new Error("must not execute");
    });
    await expect(
      claimInboxV2OutboundProviderSettlementWorkInTransaction(
        executor,
        {
          tenantId: fixture.tenantId,
          workerId,
          limit: 2,
          leaseDurationMs: 30_000
        },
        () => leaseToken
      )
    ).rejects.toThrow("duplicate");
    expect(executor.queries).toHaveLength(0);
  });

  it("locks one exact unexpired lease before canonical settlement without binding its raw token", async () => {
    const executor = new ScriptedExecutor(() => [
      { observation_id: observation.id }
    ]);
    const lease = {
      tenantId: fixture.tenantId,
      observationId: observation.id,
      candidateExternalMessageReferenceId:
        enqueueInput.candidateExternalMessageReferenceId,
      candidateTransportLinkId: enqueueInput.candidateTransportLinkId,
      trustedServiceId: observation.observedByTrustedServiceId,
      workerId,
      leaseToken,
      leaseRevision: "1"
    };

    await expect(
      lockInboxV2OutboundProviderSettlementWorkLeaseInTransaction(
        executor,
        lease
      )
    ).resolves.toBe(true);

    const query = render(executor.queries[0]!);
    const statement = normalize(query.sql);
    expect(statement).toContain("state = 'leased'");
    expect(statement).toContain("lease_expires_at > clock_timestamp()");
    expect(statement).toContain("for update");
    expect(query.params).toContain(leaseTokenHash);
    expect(query.params).not.toContain(leaseToken);
  });

  it("marks work settled only behind the durable settlement row and exact live lease", async () => {
    const executor = new ScriptedExecutor(() => [
      { observation_id: observation.id }
    ]);
    await expect(
      finalizeInboxV2OutboundProviderSettlementWorkInTransaction(executor, {
        tenantId: fixture.tenantId,
        observationId: observation.id,
        workerId,
        leaseToken,
        expectedLeaseRevision: "1",
        outcome: { kind: "settled" }
      })
    ).resolves.toEqual({ kind: "committed" });

    const query = render(executor.queries[0]!);
    const statement = normalize(query.sql);
    expect(statement).toContain(
      "from inbox_v2_outbound_provider_observation_settlements settlement_row"
    );
    expect(statement).toContain(
      "work_row.lease_expires_at > finalize_clock.finalized_at"
    );
    expect(query.params).toContain(leaseTokenHash);
    expect(query.params).not.toContain(leaseToken);
  });

  it("recognizes a retry-finalization replay without mutating a later claim", async () => {
    let resultHash = "";
    const executor = new ScriptedExecutor((index, query) => {
      if (index === 0) {
        const hashes = render(query).params.filter(
          (value): value is string =>
            typeof value === "string" && value.startsWith("sha256:")
        );
        resultHash = hashes.find((value) => value !== leaseTokenHash) ?? "";
        return [];
      }
      return [
        {
          state: "pending",
          last_finalized_lease_owner_id: workerId,
          last_finalized_lease_token_hash: leaseTokenHash,
          last_finalized_lease_revision: "1",
          last_finalized_result_hash: resultHash
        }
      ];
    });
    await expect(
      finalizeInboxV2OutboundProviderSettlementWorkInTransaction(executor, {
        tenantId: fixture.tenantId,
        observationId: observation.id,
        workerId,
        leaseToken,
        expectedLeaseRevision: "1",
        outcome: {
          kind: "retry",
          availableAt: "2026-07-14T08:04:00.000Z",
          errorCode: "core:settlement-retry"
        }
      })
    ).resolves.toEqual({ kind: "already_finalized" });
  });

  it("fails closed for a stale lease or mismatched replay result", async () => {
    const executor = new ScriptedExecutor((index) =>
      index === 0
        ? []
        : [
            {
              state: "leased",
              last_finalized_lease_owner_id: null,
              last_finalized_lease_token_hash: null,
              last_finalized_lease_revision: null,
              last_finalized_result_hash: null
            }
          ]
    );
    await expect(
      finalizeInboxV2OutboundProviderSettlementWorkInTransaction(executor, {
        tenantId: fixture.tenantId,
        observationId: observation.id,
        workerId,
        leaseToken,
        expectedLeaseRevision: "1",
        outcome: { kind: "dead", errorCode: "core:settlement-invalid" }
      })
    ).resolves.toEqual({ kind: "conflict" });
  });
});

class ScriptedExecutor implements RawSqlExecutor {
  readonly queries: SQL[] = [];
  private index = 0;

  constructor(
    private readonly handler: (
      index: number,
      query: SQL
    ) => readonly Record<string, unknown>[]
  ) {}

  async execute<Row extends Record<string, unknown>>(query: SQL) {
    this.queries.push(query);
    const rows = this.handler(this.index, query);
    this.index += 1;
    return { rows: rows as readonly Row[] };
  }
}

function providerEchoObservation(): InboxV2OutboundProviderObservation {
  const occurrence = inboxV2SourceOccurrenceSchema.parse({
    ...fixture.echoAssociation.occurrenceResolution.before,
    recordedAt: OUTBOUND_TEST_TIMES.artifactAt,
    createdAt: OUTBOUND_TEST_TIMES.artifactAt,
    updatedAt: OUTBOUND_TEST_TIMES.artifactAt
  });
  const artifact = inboxV2OutboundDispatchArtifactSchema.parse({
    tenantId: fixture.tenantId,
    id: deriveInboxV2OutboundDispatchArtifactId({
      tenantId: fixture.tenantId,
      dispatch: fixture.pendingAttempt.dispatch,
      route: fixture.pendingAttempt.route,
      attempt: {
        tenantId: fixture.tenantId,
        kind: "outbound_dispatch_attempt",
        id: fixture.pendingAttempt.id
      },
      ordinal: 1
    }),
    dispatch: fixture.pendingAttempt.dispatch,
    route: fixture.pendingAttempt.route,
    attempt: {
      tenantId: fixture.tenantId,
      kind: "outbound_dispatch_attempt",
      id: fixture.pendingAttempt.id
    },
    ordinal: 1,
    state: "accepted",
    diagnostic: null,
    createdAt: fixture.pendingAttempt.openedAt,
    revision: "1"
  });
  return inboxV2OutboundProviderObservationSchema.parse({
    tenantId: fixture.tenantId,
    id: deriveInboxV2OutboundProviderObservationId({
      tenantId: fixture.tenantId,
      attempt: artifact.attempt,
      artifactOrdinal: 1,
      sourceOccurrence: {
        tenantId: fixture.tenantId,
        kind: "source_occurrence",
        id: occurrence.id
      },
      evidenceKind: "provider_echo_correlation"
    }),
    artifact,
    dispatch: fixture.attemptingDispatch,
    route: fixture.route,
    attempt: fixture.pendingAttempt,
    sourceOccurrence: occurrence,
    sourceOccurrenceDetailDigestSha256:
      calculateInboxV2OutboundProviderSourceOccurrenceDetailDigest(occurrence),
    evidence: {
      kind: "provider_echo_correlation",
      artifactOrdinal: 1,
      providerReferenceKindId: "module:synthetic:client-correlation-token",
      correlationToken:
        fixture.pendingAttempt.retrySafety.providerCorrelationToken
    },
    effectDisposition:
      INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_EFFECT_DISPOSITION,
    observedByTrustedServiceId:
      fixture.route.adapterContract.loadedByTrustedServiceId,
    recordedAt: OUTBOUND_TEST_TIMES.artifactAt,
    revision: "1"
  });
}

function claimRow() {
  return {
    observation_id: observation.id,
    candidate_external_message_reference_id:
      enqueueInput.candidateExternalMessageReferenceId,
    candidate_transport_link_id: enqueueInput.candidateTransportLinkId,
    trusted_service_id: observation.observedByTrustedServiceId,
    lease_token_hash: leaseTokenHash,
    lease_revision: "1",
    attempt_count: "1",
    lease_claimed_at: new Date("2026-07-14T08:03:00.000Z"),
    lease_expires_at: new Date("2026-07-14T08:03:30.000Z"),
    revision: "2"
  };
}

function render(query: SQL) {
  return new PgDialect().sqlToQuery(query);
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}
